import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { LocationPing } from '../types';
import { getCachedBatteryLevel } from '../utils/deviceBattery';

export interface GpsCoords {
  lat: number;
  lng: number;
}

export interface GpsOptions {
  throttleMs?: number; // Default: 10000ms (10 seconds)
  distanceFilterMeters?: number; // Default: 15 meters
  highAccuracy?: boolean;
}

/**
 * Calculates straight-line distance in meters between two lat/lng coordinates (Haversine formula).
 */
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
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

class GpsTrackingManager {
  private watchId: number | null = null;
  private lastSentTimestamp: number = 0;
  private lastSentCoords: GpsCoords | null = null;
  private currentRiderId: string | null = null;
  private currentRiderName: string = '';
  private currentTaskId: string | undefined = undefined;
  private throttleMs: number = 10000; // 10 seconds throttle
  private distanceFilterMeters: number = 15; // 15 meters distance filter
  private statusListeners: Array<(status: any) => void> = [];

  constructor() {
    this.throttleMs = 10000;
    this.distanceFilterMeters = 15;
  }

  /**
   * Start tracking rider GPS and pushing throttled in-place updates to `riders/{riderId}`.
   */
  start(
    riderId: string,
    riderName: string = '',
    taskId?: string,
    options?: GpsOptions
  ) {
    this.currentRiderId = riderId;
    this.currentRiderName = riderName;
    this.currentTaskId = taskId;
    if (options?.throttleMs) this.throttleMs = options.throttleMs;
    if (options?.distanceFilterMeters) this.distanceFilterMeters = options.distanceFilterMeters;

    this.stop();

    if (!('geolocation' in navigator)) {
      console.warn('[GpsTracking] Geolocation API not supported');
      return;
    }

    try {
      this.watchId = navigator.geolocation.watchPosition(
        (pos) => this.handlePosition(pos),
        (err) => {
          console.warn('[GpsTracking] Geolocation watch error:', err.message);
        },
        {
          enableHighAccuracy: options?.highAccuracy ?? true,
          timeout: 15000,
          maximumAge: 5000
        }
      );
    } catch (e) {
      console.warn('[GpsTracking] Failed to start watchPosition:', e);
    }
  }

  /**
   * Process raw GPS position, apply throttling and distance filter, and update Firestore in-place.
   */
  async handlePosition(pos: GeolocationPosition) {
    if (!this.currentRiderId) return;

    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const speed = Math.max(0, Math.round((pos.coords.speed || 0) * 3.6));
    const heading = Math.round(pos.coords.heading || 0);
    const now = Date.now();

    // Check throttle (10 seconds) and distance filter (15 meters)
    const timeSinceLastWrite = now - this.lastSentTimestamp;
    const distMoved = this.lastSentCoords
      ? calculateDistanceMeters(this.lastSentCoords.lat, this.lastSentCoords.lng, lat, lng)
      : 9999;

    // Skip cloud write if not enough time passed AND rider moved less than 15 meters
    if (this.lastSentCoords && timeSinceLastWrite < this.throttleMs && distMoved < this.distanceFilterMeters) {
      return;
    }

    this.lastSentTimestamp = now;
    this.lastSentCoords = { lat, lng };

    // Update single document in-place: doc(db, 'riders', riderId)
    const liveBatt = getCachedBatteryLevel();
    await this.updateRiderInPlace(this.currentRiderId, {
      lat,
      lng,
      speed,
      heading,
      battery: liveBatt,
      name: this.currentRiderName
    });
  }

  /**
   * Updates `riders/{riderId}` in-place without creating documents in `locations`.
   */
  async updateRiderInPlace(
    riderId: string,
    data: {
      lat: number;
      lng: number;
      speed?: number;
      heading?: number;
      battery?: number;
      name?: string;
    }
  ) {
    if (!riderId) return;

    const nowIso = new Date().toISOString();
    const riderRef = doc(db, 'riders', riderId);
    const batt = data.battery ?? getCachedBatteryLevel();

    const payload = {
      id: riderId,
      lat: data.lat,
      lng: data.lng,
      heading: data.heading ?? 0,
      speed: data.speed ?? 0,
      battery: batt,
      batteryLevel: batt,
      lastPing: serverTimestamp(),
      lastPingTime: nowIso,
      lastUpdated: serverTimestamp(),
      isOnline: true,
      status: 'active',
      currentLocation: {
        lat: data.lat,
        lng: data.lng,
        timestamp: nowIso,
        heading: data.heading ?? 0,
        speed: data.speed ?? 0,
        accuracy: 5
      }
    };

    try {
      await setDoc(riderRef, payload, { merge: true });
    } catch (err: any) {
      // Gracefully handle Firestore rate limits or offline state
      if (err?.code === 'resource-exhausted' || err?.message?.includes('Quota exceeded')) {
        console.warn('[GpsTracking] Free tier quota reached; continuing with in-memory tracking.');
      } else {
        console.warn('[GpsTracking] Rider in-place update warning:', err?.message || err);
      }
    }
  }

  stop() {
    if (this.watchId !== null && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  reset() {
    this.stop();
    this.lastSentCoords = null;
    this.lastSentTimestamp = 0;
    this.currentRiderId = null;
  }
}

export const GpsTrackingService = new GpsTrackingManager();
export default GpsTrackingService;
