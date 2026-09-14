import { LocationPing, PickupBoy, PickupTask } from '../types';
import { StorageService } from './storage';
import { CloudSync, db } from './firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { getCachedBatteryLevel } from '../utils/deviceBattery';

// Distance calculation (Haversine formula in km)
export function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Distance in meters
export function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return calculateDistanceKm(lat1, lon1, lat2, lon2) * 1000;
}

// Calculate ETA in minutes based on distance and average Mumbai city bike speed (24 km/h)
export function calculateEtaMinutes(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const distKm = calculateDistanceKm(fromLat, fromLng, toLat, toLng);
  const avgSpeedKmh = 24; // avg bike speed in traffic
  const hours = distKm / avgSpeedKmh;
  const minutes = Math.ceil(hours * 60) + 2; // +2 mins buffer
  return Math.max(3, minutes);
}

/**
 * Checks if a rider's last known location update is older than the staleness threshold (default 10 minutes).
 */
export function isRiderLocationStale(rider?: PickupBoy | null, maxAgeMinutes: number = 10): boolean {
  if (!rider) return true;
  if (!rider.isOnline && rider.status !== 'active') return true;

  const rawTimestamp = rider.lastUpdated || rider.currentLocation?.timestamp || rider.lastPingTime;
  if (!rawTimestamp) return true;

  let timestampMs = 0;
  if (typeof rawTimestamp === 'object' && typeof rawTimestamp.toMillis === 'function') {
    timestampMs = rawTimestamp.toMillis();
  } else if (typeof rawTimestamp === 'object' && typeof rawTimestamp.seconds === 'number') {
    timestampMs = rawTimestamp.seconds * 1000;
  } else if (typeof rawTimestamp === 'number') {
    timestampMs = rawTimestamp;
  } else if (typeof rawTimestamp === 'string') {
    timestampMs = new Date(rawTimestamp).getTime();
  }

  if (isNaN(timestampMs) || timestampMs <= 0) return true;

  const diffMinutes = (Date.now() - timestampMs) / (1000 * 60);
  return diffMinutes > maxAgeMinutes;
}

export interface GpsStatusEvent {
  isActive: boolean;
  mode: 'real' | 'idle';
  isPermissionDenied: boolean;
  errorCode: number | null;
  errorMessage: string | null;
  lastPingTime: string | null;
}

class LocationTrackerService {
  private watchId: number | null = null;
  
  // Throttling state: 5 seconds or 15 meters
  private lastSentTimestamp: number = 0;
  private lastSentCoords: { lat: number; lng: number } | null = null;
  
  // GPS Permission & Error state
  private isPermissionDenied: boolean = false;
  private lastErrorCode: number | null = null;
  private lastErrorMessage: string | null = null;

  private listeners: Array<(ping: LocationPing) => void> = [];
  private statusListeners: Array<(status: GpsStatusEvent) => void> = [];

  public subscribe(callback: (ping: LocationPing) => void) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  public subscribeStatus(callback: (status: GpsStatusEvent) => void) {
    this.statusListeners.push(callback);
    // Send current status immediately
    callback(this.getStatus());
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== callback);
    };
  }

  public getStatus(): GpsStatusEvent {
    return {
      isActive: this.watchId !== null,
      mode: this.watchId !== null ? 'real' : 'idle',
      isPermissionDenied: this.isPermissionDenied,
      errorCode: this.lastErrorCode,
      errorMessage: this.lastErrorMessage,
      lastPingTime: this.lastSentCoords ? new Date(this.lastSentTimestamp).toISOString() : null
    };
  }

  private notifyStatus() {
    const status = this.getStatus();
    this.statusListeners.forEach((fn) => fn(status));
  }

  private notify(ping: LocationPing) {
    this.listeners.forEach((fn) => fn(ping));
  }

  /**
   * Start real browser geolocation watch for production live telemetry
   * Throttles writes to Firestore to at most once every 15 seconds OR if moved > 30 meters.
   */
  public startRealGeolocation(riderId: string, riderName: string, taskId?: string) {
    this.stop();
    this.isPermissionDenied = false;
    this.lastErrorCode = null;
    this.lastErrorMessage = null;

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      this.lastErrorMessage = 'Geolocation is not supported by this browser';
      this.lastErrorCode = 2;
      this.notifyStatus();
      return;
    }

    try {
      this.watchId = navigator.geolocation.watchPosition(
        async (pos) => {
          this.isPermissionDenied = false;
          this.lastErrorCode = null;
          this.lastErrorMessage = null;

          const currentLat = pos.coords.latitude;
          const currentLng = pos.coords.longitude;
          const currentHeading = pos.coords.heading || 0;
          const currentSpeed = pos.coords.speed ? Math.round(pos.coords.speed * 3.6) : 0;
          const now = Date.now();

          const liveBattery = getCachedBatteryLevel();

          const ping: LocationPing = {
            id: `ping-${Date.now()}`,
            riderId,
            riderName,
            timestamp: new Date().toISOString(),
            lat: currentLat,
            lng: currentLng,
            speed: currentSpeed,
            heading: currentHeading,
            battery: liveBattery,
            taskId
          };

          // Always record locally and notify active UI subscribers immediately
          this.recordPing(ping);
          this.notify(ping);

          // ADAPTIVE THROTTLING -- the single biggest battery saving available here.
          //
          // A flat 10-second write interval drained riders' phones all shift (one arrived at 10%).
          // But a flat 5- or 10-minute interval is not usable either: during an active round the
          // client is watching that marker move on their own screen, and a position 10 minutes old
          // is worse than none. So the interval depends on what the rider is actually doing:
          //
          //   moving, on a round      -> 15s  (live tracking the client can rely on)
          //   stationary, on a round  -> 2min (at a stop; the marker is not going anywhere)
          //   on duty, no round       -> 5min (between rounds; presence only)
          //
          // Any movement past the distance filter still writes immediately, whatever the timer
          // says, so setting off is reflected within one GPS sample rather than minutes later.
          const distMoved = this.lastSentCoords
            ? calculateDistanceMeters(this.lastSentCoords.lat, this.lastSentCoords.lng, currentLat, currentLng)
            : 999;

          const isOnActiveRound = Boolean(taskId);
          const STATIONARY_METERS = 30;
          const isStationary = this.lastSentCoords !== null && distMoved < STATIONARY_METERS;

          const TIME_THROTTLE_MS = !isOnActiveRound
            ? 5 * 60 * 1000
            : isStationary
            ? 2 * 60 * 1000
            : 15 * 1000;

          const DISTANCE_FILTER_METERS = isOnActiveRound ? 25 : 100;
          const timeSinceLastWrite = now - this.lastSentTimestamp;

          if (this.lastSentCoords && timeSinceLastWrite < TIME_THROTTLE_MS && distMoved < DISTANCE_FILTER_METERS) {
            this.notifyStatus();
            return;
          }

          this.lastSentTimestamp = now;
          this.lastSentCoords = { lat: currentLat, lng: currentLng };

          // Direct single rider document update in Firestore 'riders' collection with serverTimestamp
          try {
            if (taskId) {
              await CloudSync.updateTripRiderLocation(taskId, riderId, currentLat, currentLng, {
                heading: currentHeading,
                speed: currentSpeed,
                battery: liveBattery,
                riderName
              });
            } else {
              await setDoc(
                doc(db, 'riders', riderId),
                {
                  id: riderId,
                  name: riderName || 'Rider',
                  lat: currentLat,
                  lng: currentLng,
                  heading: currentHeading,
                  speed: currentSpeed,
                  battery: liveBattery,
                  batteryLevel: liveBattery,
                  lastPing: serverTimestamp(),
                  lastPingTime: new Date().toISOString(),
                  lastUpdated: serverTimestamp(),
                  isOnline: true,
                  status: 'active',
                  currentLocation: {
                    lat: currentLat,
                    lng: currentLng,
                    timestamp: new Date().toISOString(),
                    heading: currentHeading,
                    speed: currentSpeed,
                    accuracy: pos.coords.accuracy || 5
                  }
                },
                { merge: true }
              );
            }
          } catch (fireErr: any) {
            if (fireErr?.code === 'resource-exhausted' || fireErr?.message?.includes('Quota exceeded')) {
              console.warn('[LocationService] Firestore rate limit or quota reached; continuing with local tracking.');
            } else {
              console.error("Firestore Write Error:", fireErr);
            }
          }

          this.notifyStatus();
        },
        (err) => {
          console.warn('[LocationService] Geolocation watch notice:', err.code, err.message);
          this.lastErrorCode = err.code;
          if (err.code === 1) { // PERMISSION_DENIED
            this.isPermissionDenied = true;
            this.lastErrorMessage = 'Location permission denied. Please allow GPS location access in your browser settings to broadcast live telemetry.';
          } else if (err.code === 2) { // POSITION_UNAVAILABLE
            this.lastErrorMessage = 'GPS position unavailable. Please enable device location / GPS services.';
          } else if (err.code === 3) { // TIMEOUT
            this.lastErrorMessage = 'GPS location request timed out. Retrying high-accuracy signal...';
          } else {
            this.lastErrorMessage = err.message || 'Unknown GPS error';
          }

          this.notifyStatus();
        },
        {
          // High-accuracy GPS keeps the radio powered continuously. It is worth it during a round,
          // where the client is tracking the rider, and wasteful between rounds where a coarse
          // network fix is plenty to show presence.
          enableHighAccuracy: Boolean(taskId),
          maximumAge: taskId ? 5000 : 60000,
          timeout: 15000
        }
      );

      this.notifyStatus();
    } catch (e: any) {
      console.warn('[LocationService] Exception starting watchPosition:', e);
      this.lastErrorMessage = e?.message || 'Failed to start GPS tracking';
      this.notifyStatus();
    }
  }

  private recordPing(ping: LocationPing) {
    StorageService.addPing(ping);

    // Update rider's active location in local storage
    const rider = StorageService.getRiderById(ping.riderId);
    if (rider) {
      const updatedRider: PickupBoy = {
        ...rider,
        currentLocation: {
          lat: ping.lat,
          lng: ping.lng,
          timestamp: ping.timestamp,
          heading: ping.heading,
          speed: ping.speed,
          accuracy: 5
        },
        lat: ping.lat,
        lng: ping.lng,
        heading: ping.heading || 0,
        batteryLevel: ping.battery,
        isOnline: true,
        lastPingTime: ping.timestamp
      };
      StorageService.updateRider(updatedRider);
    }

    // Sync straight to Firestore 'locations' and 'riders/{riderId}' with GeoPoint and serverTimestamp
    CloudSync.recordLocationPing(ping).catch((err) => {
      console.warn('[LocationService] Firestore location sync notice:', err);
    });

    this.notify(ping);
  }

  public startTracking(callbackOrRiderId?: ((ping: LocationPing) => void) | string, riderName?: string, taskId?: string) {
    if (typeof callbackOrRiderId === 'function') {
      this.subscribe(callbackOrRiderId);
      const riders = StorageService.getRiders();
      const activeRider = riders.find((r) => r.status === 'active') || riders[0];
      if (activeRider) {
        this.startRealGeolocation(activeRider.id, activeRider.name);
      }
    } else if (typeof callbackOrRiderId === 'string' && riderName) {
      this.startRealGeolocation(callbackOrRiderId, riderName, taskId);
    }
  }

  public stop() {
    if (this.watchId !== null && typeof navigator !== 'undefined') {
      navigator.geolocation?.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.notifyStatus();
  }
}

export const LocationService = new LocationTrackerService();
