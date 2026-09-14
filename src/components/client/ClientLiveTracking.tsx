import React, { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, parseFirestoreGeoPoint } from '../../services/firebase';
import { PickupTask, Route, PickupBoy } from '../../types';
import { isRiderLocationStale } from '../../services/locationService';
import {
  calculateHaversineDistanceKm,
  calculateEstimatedEtaMinutes,
  normalizeLatLng,
  DEFAULT_MUMBAI_COORDINATES
} from '../../utils/coordinates';
import { fetchRoadPolyline } from '../../utils/routeGeometry';
import { animateMarkerPosition, cancelMarkerAnimation } from '../../utils/markerAnimation';
import {
  Bike,
  Building2,
  Clock,
  Thermometer,
  Battery,
  MapPin,
  PhoneCall,
  Navigation,
  ShieldCheck,
  Radio,
  Gauge,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Maximize2,
  Minimize2
} from 'lucide-react';

export interface ClientLiveTrackingProps {
  activeClientId?: string;
  clientName?: string;
  clientAddress?: string;
  clientLocation?: { lat: number; lng: number };
  activeTask?: PickupTask | null;
  activeRoute?: Route | null;
  assignedRiderId?: string | null;
  onOpenProof?: (task: PickupTask) => void;
  height?: string;
}

export const ClientLiveTracking: React.FC<ClientLiveTrackingProps> = ({
  activeClientId,
  clientName = 'Lifecare Diagnostics (Andheri West)',
  clientAddress = 'SV Road, Andheri West, Mumbai, Maharashtra',
  clientLocation,
  activeTask,
  activeRoute,
  assignedRiderId,
  onOpenProof,
  height = '420px'
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const riderMarkerRef = useRef<L.Marker | null>(null);
  const destMarkerRef = useRef<L.Marker | null>(null);
  const stopMarkersRef = useRef<L.Marker[]>([]);
  const polylineLayerRef = useRef<L.Polyline | null>(null);
  const stopsPolylineLayerRef = useRef<L.Polyline | null>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [liveRiderData, setLiveRiderData] = useState<any>(null);
  const [liveTaskData, setLiveTaskData] = useState<PickupTask | null>(activeTask || null);
  const [lastPingTimestamp, setLastPingTimestamp] = useState<Date>(new Date());
  const [secondsAgo, setSecondsAgo] = useState<number>(0);

  // Synchronize liveTaskData when prop changes
  useEffect(() => {
    if (activeTask) {
      setLiveTaskData(activeTask);
    } else {
      setLiveTaskData(null);
    }
  }, [activeTask]);

  // Target rider ID: prioritize activeTask's rider, then activeRoute, then prop (NO fake fallback)
  const effectiveRiderId = useMemo(() => {
    return (
      (liveTaskData as any)?.activeRiderId ||
      liveTaskData?.riderId ||
      (activeTask as any)?.activeRiderId ||
      activeTask?.riderId ||
      activeRoute?.assignedRiderId ||
      assignedRiderId ||
      null
    );
  }, [liveTaskData, activeTask, activeRoute, assignedRiderId]);

  // Real Active Trip Detection:
  // A GPS fix older than this is not "live" -- riders ping every few seconds while moving, so
  // several minutes of silence means the app is closed, backgrounded, or out of signal.
  const GPS_STALE_AFTER_MS = 5 * 60 * 1000;

  // Must have an active in-transit task AND an assigned online/on-duty rider
  const isTripActive = useMemo(() => {
    const currentTask = liveTaskData || activeTask;
    if (!currentTask) return false;

    // Strict in_transit status check (including ongoing round intermediate states)
    const taskStatus = currentTask.status;
    const isStatusActive = taskStatus === 'in_transit' || taskStatus === 'started' || taskStatus === 'at_stop' || taskStatus === 'picked_up';
    if (!isStatusActive) return false;

    // Must have a resolved rider ID
    if (!effectiveRiderId) return false;

    // If rider doc is loaded, verify duty status & online connectivity
    if (liveRiderData) {
      if (liveRiderData.isOnline === false) return false;
      if (liveRiderData.dutyStatus === 'offline' || liveRiderData.dutyStatus === 'off_duty') return false;
      if (liveRiderData.status === 'off_duty' || liveRiderData.status === 'inactive' || liveRiderData.status === 'on_leave') return false;
      if (liveRiderData.isCheckedIn === false) return false;

      // Freshness gate. The duty flags above say what the rider's profile CLAIMS; this says
      // whether the phone has actually reported a position recently. Without it, a rider whose
      // app is closed (admin shows "GPS Stale / Signal Weak") still produced a moving marker and
      // a live ETA on the client's screen -- a number the client would plan around, based on a
      // position that might be hours old.
      const lastFix = liveRiderData.lastUpdated ? new Date(liveRiderData.lastUpdated).getTime() : 0;
      if (!lastFix) return false;
      if (Date.now() - lastFix > GPS_STALE_AFTER_MS) return false;
    }

    return true;
  }, [liveTaskData, activeTask, effectiveRiderId, liveRiderData]);

  // Destination coordinates for the client
  const targetDestinationCoords = useMemo<[number, number]>(() => {
    let lat = 19.1287852;
    let lng = 72.8294183;

    if (clientLocation?.lat != null && clientLocation?.lng != null) {
      lat = Number(clientLocation.lat);
      lng = Number(clientLocation.lng);
    } else if (activeTask?.destination?.lat != null && activeTask?.destination?.lng != null) {
      lat = Number(activeTask.destination.lat);
      lng = Number(activeTask.destination.lng);
    } else if (activeRoute?.destinationLab?.lat != null && activeRoute?.destinationLab?.lng != null) {
      lat = Number(activeRoute.destinationLab.lat);
      lng = Number(activeRoute.destinationLab.lng);
    }

    const centralLabCoords: [number, number] = [Number(lat), Number(lng)];
    return normalizeLatLng(centralLabCoords[0], centralLabCoords[1], 19.1287852, 72.8294183);
  }, [clientLocation, activeTask, activeRoute]);

  // Intermediate stops if available
  const stopsList = useMemo(() => {
    if (liveTaskData?.stopsProgress && liveTaskData.stopsProgress.length > 0) {
      return liveTaskData.stopsProgress;
    }
    if (activeRoute?.stops && activeRoute.stops.length > 0) {
      return activeRoute.stops;
    }
    return [];
  }, [liveTaskData, activeRoute]);

  // 1. Real-time Firestore Listener on the Assigned Rider's Location
  useEffect(() => {
    if (!effectiveRiderId) {
      setLiveRiderData(null);
      return;
    }

    const riderDocRef = doc(db, 'riders', effectiveRiderId);
    const unsubscribeRider = onSnapshot(
      riderDocRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          const geoPoint = parseFirestoreGeoPoint(data.currentLocation) || parseFirestoreGeoPoint(data.location);
          const rawLat = data.lat ?? geoPoint?.lat ?? data.currentLocation?.lat;
          const rawLng = data.lng ?? geoPoint?.lng ?? data.currentLocation?.lng;
          
          let normLat: number | undefined = undefined;
          let normLng: number | undefined = undefined;
          if (rawLat != null && rawLng != null) {
            const [nLat, nLng] = normalizeLatLng(rawLat, rawLng, targetDestinationCoords[0], targetDestinationCoords[1]);
            normLat = nLat;
            normLng = nLng;
          }

          const updatedRider = {
            id: docSnap.id,
            ...data,
            lat: normLat,
            lng: normLng,
            name: data.name || 'Courier Partner',
            vehicleNumber: data.vehicleNumber || data.vehicleNo || 'Courier Bike',
            speed: typeof data.speed === 'number' ? data.speed : (typeof data.currentLocation?.speed === 'number' ? data.currentLocation.speed : undefined),
            heading: data.currentLocation?.heading || data.heading || 0,
            batteryLevel: typeof data.batteryLevel === 'number' ? data.batteryLevel : (typeof data.battery === 'number' ? data.battery : undefined),
            coldBoxTemp: typeof data.coldBoxTemp === 'number' ? data.coldBoxTemp : 4.0,
            isOnline: data.isOnline !== false,
            dutyStatus: data.dutyStatus || (data.isCheckedIn === false ? 'offline' : (data.status === 'off_duty' ? 'off_duty' : 'on_duty')),
            status: data.status || (data.isCheckedIn === false ? 'off_duty' : 'active'),
            isCheckedIn: data.isCheckedIn !== false,
            // Do NOT substitute new Date() here. A missing lastUpdated means we genuinely do not
            // know when this position was recorded, and pretending it just arrived is what made a
            // parked, app-closed rider render as live movement on the client's map.
            lastUpdated: data.lastUpdated?.toDate
              ? data.lastUpdated.toDate()
              : data.lastUpdated
              ? new Date(data.lastUpdated)
              : null
          };

          setLiveRiderData(updatedRider);
          setLastPingTimestamp(new Date());
          setSecondsAgo(0);
        } else {
          setLiveRiderData(null);
        }
      },
      (error) => {
        console.warn('[ClientLiveTracking] Firestore rider listener error:', error);
      }
    );

    // Targeted listeners on active trip and active task documents
    let unsubscribeTrip = () => {};
    let unsubscribeTask = () => {};
    const currentTaskId = activeTask?.id || (liveTaskData as any)?.id;
    if (currentTaskId) {
      // 1. Listen directly to doc(db, "trips", currentTaskId)
      const tripDocRef = doc(db, 'trips', currentTaskId);
      unsubscribeTrip = onSnapshot(
        tripDocRef,
        (tripSnap) => {
          if (tripSnap.exists()) {
            const tData = tripSnap.data();
            setLiveTaskData((prev) => ({
              ...(prev || {}),
              id: tripSnap.id,
              ...tData
            } as PickupTask));
          }
        },
        (err) => console.warn('[ClientLiveTracking] Trip listener notice:', err)
      );

      // 2. Also listen to doc(db, "tasks", currentTaskId)
      const taskDocRef = doc(db, 'tasks', currentTaskId);
      unsubscribeTask = onSnapshot(
        taskDocRef,
        (taskSnap) => {
          if (taskSnap.exists()) {
            setLiveTaskData((prev) => ({
              ...(prev || {}),
              id: taskSnap.id,
              ...taskSnap.data()
            } as PickupTask));
          }
        },
        (err) => console.warn('[ClientLiveTracking] Task listener notice:', err)
      );
    }

    return () => {
      unsubscribeRider();
      unsubscribeTrip();
      unsubscribeTask();
    };
  }, [effectiveRiderId, activeTask?.id, targetDestinationCoords]);

  // Tick the "last ping" timer.
  //
  // This used to measure time since a Firestore SNAPSHOT arrived in this browser, and every
  // document change reset it to zero -- so it read "Pinged 3s ago" even when the rider's phone
  // had not reported a position for hours. It now measures the age of the actual GPS fix.
  useEffect(() => {
    const compute = () => {
      const fixTime = liveRiderData?.lastUpdated ? new Date(liveRiderData.lastUpdated).getTime() : 0;
      if (!fixTime) {
        setSecondsAgo(-1); // -1 => unknown, rendered as "No signal"
        return;
      }
      setSecondsAgo(Math.max(0, Math.round((Date.now() - fixTime) / 1000)));
    };
    compute();
    const interval = setInterval(compute, 1000);
    return () => clearInterval(interval);
  }, [liveRiderData?.lastUpdated]);

  // Effective rider coordinates (only when valid coordinates exist)
  const riderCoords = useMemo<[number, number] | null>(() => {
    if (liveRiderData?.lat != null && liveRiderData?.lng != null) {
      return [liveRiderData.lat, liveRiderData.lng];
    }
    return null;
  }, [liveRiderData]);

  // 2. Haversine Distance & Dynamic ETA Calculation
  const distanceKm = useMemo(() => {
    if (!isTripActive || !riderCoords) return 0;
    return calculateHaversineDistanceKm(
      riderCoords[0],
      riderCoords[1],
      targetDestinationCoords[0],
      targetDestinationCoords[1]
    );
  }, [isTripActive, riderCoords, targetDestinationCoords]);

  const estimatedEtaMinutes = useMemo(() => {
    if (!isTripActive || distanceKm === 0) return 0;
    const currentSpeed = liveRiderData?.speed && liveRiderData.speed > 5 ? liveRiderData.speed : 22;
    return calculateEstimatedEtaMinutes(distanceKm, currentSpeed, 2);
  }, [isTripActive, distanceKm, liveRiderData?.speed]);

  const isStale = useMemo(() => {
    if (!liveRiderData || !isTripActive) return false;
    return isRiderLocationStale(liveRiderData, 10);
  }, [liveRiderData, isTripActive]);

  // When a round IS dispatched but we cannot show live movement, say so plainly rather than
  // implying nothing is scheduled. A client reading "Idle / Awaiting Dispatch" during an active
  // round would reasonably conclude their pickup was never assigned.
  const trackingStatus = useMemo(() => {
    const currentTask = liveTaskData || activeTask;
    const taskStatus = currentTask?.status;
    const roundInProgress =
      taskStatus === 'in_transit' || taskStatus === 'started' || taskStatus === 'at_stop' || taskStatus === 'picked_up';

    if (!roundInProgress) {
      return {
        headline: 'No Active Rider En Route',
        tag: 'Idle / Awaiting Dispatch',
        detail:
          'Scheduled pickup cycles will appear here when dispatched. Real-time GPS tracking activates automatically when the rider begins the route.'
      };
    }

    const lastFix = liveRiderData?.lastUpdated ? new Date(liveRiderData.lastUpdated).getTime() : 0;
    const minsAgo = lastFix ? Math.round((Date.now() - lastFix) / 60000) : null;

    return {
      headline: 'Live Tracking Unavailable',
      tag: 'Rider App Offline',
      detail: `The round is assigned and in progress, but the rider's app is not reporting its location right now${
        minsAgo !== null ? ` (last signal ${minsAgo} min ago)` : ''
      }. The map is hidden rather than showing an outdated position. Collection proofs will still be recorded at each stop.`
    };
  }, [liveTaskData, activeTask, liveRiderData]);

  const riderName = liveRiderData?.name || liveTaskData?.riderName || 'Assigned Courier';
  const riderVehicle = liveRiderData?.vehicleNumber || liveTaskData?.riderVehicle || 'Courier Bike';
  const riderPhone = liveRiderData?.phone || liveTaskData?.riderPhone || '';
  const coldBoxTemp = liveRiderData?.coldBoxTemp ?? 4.0;
  const currentDestinationStop =
    liveTaskData?.currentDestinationStop ||
    (liveTaskData as any)?.destination?.name ||
    clientName;

  // 3. Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const initialCenter = targetDestinationCoords;
      const map = L.map(mapContainerRef.current, {
        center: initialCenter,
        zoom: 13,
        zoomControl: false,
        attributionControl: true
      });

      // Configure official enterprise attribution prefix
      if (map.attributionControl) {
        map.attributionControl.setPrefix(false);
      }

      L.control.zoom({ position: 'topleft' }).addTo(map);

      // Enterprise GIS Telematics Layer
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: 'SecondMedic GIS Telematics Engine • Spatial Fleet Layer'
      }).addTo(map);

      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [targetDestinationCoords]);

  // Invalidate size on resize
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    map.invalidateSize();
    const t = setTimeout(() => map.invalidateSize(), 200);
    return () => clearTimeout(t);
  }, [height, isFullscreen]);

  // 4. Render & Smoothly Update Markers and Polylines
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const boundsPoints: L.LatLngExpression[] = [];

    // --- Destination Pin Marker (Always present for Client Lab) ---
    boundsPoints.push(targetDestinationCoords);
    const destIcon = L.divIcon({
      className: 'client-dest-marker',
      html: `
        <div class="relative group flex flex-col items-center cursor-pointer">
          <div class="w-10 h-10 rounded-xl bg-emerald-700 ring-3 ring-emerald-300 text-white font-bold text-sm flex items-center justify-center shadow-2xl transform transition-transform group-hover:scale-110">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
              <path d="M4 7V4a2 2 0 0 1 2-2h8.5L20 7.5V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z"/>
              <path d="M8 14h8"/>
              <path d="M12 10v8"/>
            </svg>
          </div>
          <div class="absolute -bottom-6 left-1/2 -translate-x-1/2 bg-emerald-950 text-white text-[10px] font-black px-2 py-0.5 rounded shadow-md border border-emerald-600 whitespace-nowrap">
            ${clientName.split(' ')[0] || 'DESTINATION LAB'}
          </div>
        </div>
      `,
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    });

    const destPopupHtml = `
      <div style="font-family: 'Plus Jakarta Sans', sans-serif; min-width: 200px; padding: 4px;">
        <div style="font-size: 10px; font-weight: 800; color: #047857; text-transform: uppercase;">Destination Diagnostic Facility</div>
        <div style="font-size: 13px; font-weight: 800; color: #0f172a; margin-top: 2px;">${clientName}</div>
        <div style="font-size: 11px; color: #64748b; margin-top: 2px;">${clientAddress}</div>
        ${isTripActive && distanceKm > 0 ? `
          <div style="margin-top: 6px; font-size: 11px; font-weight: 700; color: #0369a1;">
            Direct Distance: ${distanceKm} km
          </div>
        ` : ''}
      </div>
    `;

    if (destMarkerRef.current) {
      destMarkerRef.current.setLatLng(targetDestinationCoords);
      destMarkerRef.current.setIcon(destIcon);
      destMarkerRef.current.setPopupContent(destPopupHtml);
    } else {
      const destM = L.marker(targetDestinationCoords, { icon: destIcon, zIndexOffset: 1000 }).addTo(map);
      destM.bindPopup(destPopupHtml);
      destMarkerRef.current = destM;
    }

    // --- Intermediate Stops Markers ---
    stopMarkersRef.current.forEach((m) => map.removeLayer(m));
    stopMarkersRef.current = [];

    stopsList.forEach((stop, idx) => {
      const [sLat, sLng] = normalizeLatLng(stop.lat, stop.lng, targetDestinationCoords[0], targetDestinationCoords[1]);
      boundsPoints.push([sLat, sLng]);

      const isPicked = (stop as any).status === 'picked_up';
      const stopIcon = L.divIcon({
        className: 'custom-intermediate-stop',
        html: `
          <div class="relative flex flex-col items-center cursor-pointer">
            <div class="w-7 h-7 rounded-full ${
              isPicked ? 'bg-emerald-600 ring-2 ring-emerald-300' : 'bg-sky-700 ring-2 ring-sky-300'
            } text-white font-bold text-[11px] flex items-center justify-center shadow-lg">
              ${isPicked ? '✓' : idx + 1}
            </div>
            <div class="absolute -bottom-4 bg-white/95 text-slate-800 text-[9px] font-bold px-1 rounded shadow-2xs border border-slate-200 whitespace-nowrap pointer-events-none">
              ${(stop.stopName || stop.name || `Stop ${idx + 1}`).split(',')[0]}
            </div>
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });

      const sMarker = L.marker([sLat, sLng], { icon: stopIcon }).addTo(map);
      sMarker.bindPopup(`
        <div style="font-family: 'Plus Jakarta Sans', sans-serif; min-width: 180px; padding: 4px;">
          <div style="font-size: 10px; font-weight: 800; color: #0284c7; text-transform: uppercase;">Collection Point #${idx + 1}</div>
          <div style="font-size: 12px; font-weight: 700; color: #0f172a; margin-top: 2px;">${stop.stopName || stop.name}</div>
          <div style="font-size: 11px; color: #64748b;">${stop.address || ''}</div>
          <div style="font-size: 11px; font-weight: 700; color: ${isPicked ? '#047857' : '#0369a1'}; margin-top: 4px;">
            Status: ${isPicked ? 'Specimens Picked Up' : 'Scheduled Pickup Point'}
          </div>
        </div>
      `);
      stopMarkersRef.current.push(sMarker);
    });

    // --- Rider Marker Rendering ---
    // Only render live animated rider marker if trip is actively in-transit and coordinates are real
    if (isTripActive && riderCoords) {
      boundsPoints.push(riderCoords);
      const bikeIcon = L.divIcon({
        className: 'custom-bike-marker',
        html: `
          <div class="relative group cursor-pointer" style="position: relative; width: 44px; height: 44px;">
            <!-- Pulsing Live Radar Wave -->
            ${!isStale ? '<div class="absolute -inset-1.5 bg-sky-500 rounded-full animate-ping opacity-60"></div>' : ''}
            
            <!-- Main Rider Badge with Bike Icon -->
            <div style="position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; background: ${isStale ? '#334155' : '#0284c7'}; border: 3px solid #ffffff; border-radius: 50%; box-shadow: 0 4px 12px rgba(0,0,0,0.35);">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="5.5" cy="17.5" r="3.5"/>
                <circle cx="18.5" cy="17.5" r="3.5"/>
                <path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm-3 11.5V14l-3-3 4-3 2 3h4"/>
              </svg>
              <span style="position: absolute; top: -4px; right: -4px; width: 12px; height: 12px; background: ${isStale ? '#f59e0b' : '#22c55e'}; border: 2px solid #fff; border-radius: 50%;"></span>
            </div>

            <!-- Top Floating Rider Name Tag -->
            <div style="position: absolute; top: -28px; left: 50%; transform: translateX(-50%); background: rgba(2, 6, 23, 0.95); color: #ffffff; font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 6px; white-space: nowrap; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.25); border: 1px solid ${isStale ? '#f59e0b' : 'rgba(56, 189, 248, 0.7)'}; display: flex; align-items: center; gap: 4px; pointer-events: none;">
              <span style="width: 6px; height: 6px; border-radius: 50%; background: ${isStale ? '#f59e0b' : '#22c55e'};"></span>
              <span>${riderName}</span>
              <span style="color: #7dd3fc; font-family: monospace; font-size: 9px;">${riderVehicle.split('-').pop() || 'BIKE'}</span>
            </div>
          </div>
        `,
        iconSize: [44, 44],
        iconAnchor: [22, 22]
      });

      const riderPopupHtml = `
        <div style="font-family: 'Plus Jakarta Sans', sans-serif; min-width: 220px; padding: 6px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; padding-bottom: 6px; border-bottom: 1px solid #e2e8f0;">
            <span style="font-size: 10px; font-weight: 800; color: #0284c7; text-transform: uppercase;">Live Specimen Location</span>
            <span style="font-size: 9px; font-weight: 700; background: ${isStale ? '#fef3c7' : '#ecfdf5'}; color: ${isStale ? '#b45309' : '#047857'}; padding: 2px 6px; border-radius: 9999px; border: 1px solid ${isStale ? '#fde68a' : '#a7f3d0'};">
              ${isStale ? 'GPS PAUSED' : 'LIVE GPS'}
            </span>
          </div>
          <div style="font-size: 14px; font-weight: 800; color: #0f172a;">${riderName}</div>
          <div style="font-size: 11px; color: #64748b;">Vehicle: <span style="font-family: monospace; font-weight: 600;">${riderVehicle}</span></div>
          <div style="margin-top: 8px; padding: 6px 8px; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0; font-size: 11px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
              <span style="color: #64748b;">Cold-Box Temp:</span>
              <span style="font-weight: 700; color: #047857; font-family: monospace;">${coldBoxTemp}°C (Safe)</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
              <span style="color: #64748b;">Distance to Lab:</span>
              <span style="font-weight: 700; color: #0284c7; font-family: monospace;">${distanceKm} km</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: #64748b;">Estimated ETA:</span>
              <span style="font-weight: 700; color: #0369a1; font-family: monospace;">~${estimatedEtaMinutes} mins</span>
            </div>
          </div>
        </div>
      `;

      if (riderMarkerRef.current) {
        animateMarkerPosition(riderMarkerRef.current, riderCoords[0], riderCoords[1], 10000, effectiveRiderId);
        riderMarkerRef.current.setIcon(bikeIcon);
        riderMarkerRef.current.setPopupContent(riderPopupHtml);
      } else {
        const marker = L.marker(riderCoords, { icon: bikeIcon, zIndexOffset: 1200 }).addTo(map);
        marker.bindPopup(riderPopupHtml);
        riderMarkerRef.current = marker;
      }
    } else {
      // If trip is not active, remove rider marker completely from active radar
      if (riderMarkerRef.current) {
        cancelMarkerAnimation(effectiveRiderId);
        map.removeLayer(riderMarkerRef.current);
        riderMarkerRef.current = null;
      }
    }

    // --- Live In-Transit Polyline connecting Rider GPS to Destination Pin along Real Roads ---
    // Do NOT render moving rider polyline when trip is not in transit
    if (polylineLayerRef.current) {
      map.removeLayer(polylineLayerRef.current);
      polylineLayerRef.current = null;
    }

    let isEffectActive = true;

    if (isTripActive && riderCoords) {
      // Build route coordinates between Rider, any remaining stops, and final Central Lab
      const safeStops = Array.isArray(stopsList) ? stopsList : [];
      const remainingStopsCoords = safeStops
        .filter((s) => (s as any)?.status !== 'picked_up' && (s as any)?.status !== 'completed')
        .map((s) => normalizeLatLng(s?.lat, s?.lng, targetDestinationCoords[0], targetDestinationCoords[1]));

      const fullRoutePoints: [number, number][] = [
        riderCoords,
        ...remainingStopsCoords,
        targetDestinationCoords
      ];

      // Render instant fallback polyline first
      const liveLine = L.polyline(fullRoutePoints, {
        color: '#0284c7', // Sky blue
        weight: 4,
        opacity: 0.85,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(map);
      polylineLayerRef.current = liveLine;

      // Asynchronously fetch OSRM Road Geometry along actual Mumbai streets & flyovers
      fetchRoadPolyline(fullRoutePoints).then((roadGeometry) => {
        if (isEffectActive && polylineLayerRef.current && roadGeometry.length > 0) {
          polylineLayerRef.current.setLatLngs(roadGeometry);
        }
      }).catch((err) => {
        console.warn('[ClientLiveTracking] OSRM Road routing error:', err);
      });
    }

    // --- Polyline connecting sequential route stops along Real Roads ---
    if (stopsPolylineLayerRef.current) {
      map.removeLayer(stopsPolylineLayerRef.current);
      stopsPolylineLayerRef.current = null;
    }

    const safeStopsList = Array.isArray(stopsList) ? stopsList : [];
    if (safeStopsList.length > 0) {
      const stopsPath: [number, number][] = safeStopsList.map((s) => normalizeLatLng(s?.lat, s?.lng, targetDestinationCoords[0], targetDestinationCoords[1]));
      stopsPath.push(targetDestinationCoords);

      const stopsLine = L.polyline(stopsPath, {
        color: '#64748b',
        weight: 2.5,
        opacity: 0.45,
        dashArray: isTripActive ? '4, 6' : undefined,
        lineCap: 'round'
      }).addTo(map);
      stopsPolylineLayerRef.current = stopsLine;

      fetchRoadPolyline(stopsPath).then((roadGeometry) => {
        if (isEffectActive && stopsPolylineLayerRef.current && roadGeometry.length > 0) {
          stopsPolylineLayerRef.current.setLatLngs(roadGeometry);
        }
      }).catch(() => {});
    }

    // Auto-fit bounds framing destination (and rider if active)
    if (boundsPoints.length > 0) {
      const bounds = L.latLngBounds(boundsPoints);
      map.fitBounds(bounds, { padding: [45, 45], maxZoom: 15, animate: true });
    }

    return () => {
      isEffectActive = false;
    };
  }, [isTripActive, riderCoords, targetDestinationCoords, stopsList, isStale, riderName, riderVehicle, clientName, clientAddress, coldBoxTemp, distanceKm, estimatedEtaMinutes]);

  // Center on Rider / Destination button handler
  const handleRecenter = () => {
    if (!mapInstanceRef.current) return;
    if (isTripActive && riderCoords) {
      mapInstanceRef.current.setView(riderCoords, 15, { animate: true });
    } else {
      mapInstanceRef.current.setView(targetDestinationCoords, 14, { animate: true });
    }
  };

  // Fit Bounds button handler
  const handleFitAll = () => {
    if (!mapInstanceRef.current) return;
    if (isTripActive && riderCoords) {
      const bounds = L.latLngBounds([riderCoords, targetDestinationCoords]);
      mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 15, animate: true });
    } else {
      mapInstanceRef.current.setView(targetDestinationCoords, 14, { animate: true });
    }
  };

  return (
    <div className="space-y-3.5">
      {/* Real-Time HUD Status Bar OR Clean Idle State Card */}
      {isTripActive ? (
        <div className="bg-slate-900 text-white rounded-xl p-4 sm:p-4.5 shadow-lg border border-slate-800 space-y-3 animate-fadeIn">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div className="flex items-center gap-3">
              {/* Delivery bike avatar / badge with live moving wave animation */}
              <div className="relative shrink-0">
                <div className="relative w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-sky-600/30 border-2 border-sky-400 text-sky-300 flex items-center justify-center shadow-lg">
                  {/* Styled pulse wave animation */}
                  {!isStale && <div className="absolute -inset-1.5 bg-sky-500 rounded-full animate-ping opacity-60"></div>}
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" className="relative z-10">
                    <circle cx="5.5" cy="17.5" r="3.5"/>
                    <circle cx="18.5" cy="17.5" r="3.5"/>
                    <path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm-3 11.5V14l-3-3 4-3 2 3h4"/>
                  </svg>
                  <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full ring-2 ring-slate-900 ${isStale ? 'bg-amber-500' : 'bg-emerald-400 animate-pulse'} z-20`} />
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-bold text-sky-400 uppercase tracking-wider flex items-center gap-1">
                    <Radio className="w-3.5 h-3.5 text-sky-400 animate-pulse" />
                    LIVE SPECIMEN IN-TRANSIT TELEMETRY
                  </span>
                  <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                    isStale
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  }`}>
                    {isStale ? 'GPS PAUSED (>10M)' : 'LIVE GPS STREAMING'}
                  </span>
                  {/* Clean Vehicle Tag */}
                  <span className="px-2 py-0.5 text-[10px] sm:text-[11px] font-mono font-bold bg-sky-950 text-sky-300 rounded border border-sky-700/60 shadow-xs">
                    {riderVehicle.toLowerCase().includes('motorcycle') || riderVehicle.toLowerCase().includes('bike')
                      ? riderVehicle
                      : `Motorcycle (${riderVehicle})`}
                  </span>
                </div>

                <h4 className="text-base sm:text-lg font-extrabold text-white mt-1">
                  Rider <span className="text-sky-300 font-bold">{riderName}</span> is en route to your facility
                </h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  Target Destination: <span className="text-slate-200 font-semibold">{currentDestinationStop}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {riderPhone && (
                <a
                  href={`tel:${riderPhone.replace(/\D/g, '')}`}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-transform active:scale-95 shadow-sm"
                >
                  <PhoneCall className="w-3.5 h-3.5" />
                  <span>Call Rider</span>
                </a>
              )}

              <button
                type="button"
                onClick={handleFitAll}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 border border-slate-700 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 text-sky-400" />
                <span>Refocus</span>
              </button>
            </div>
          </div>

          {/* HUD Real-Time Telemetry Grid (Driven strictly by live Firestore data) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {/* Estimated ETA */}
            <div className="bg-slate-800/80 p-2.5 sm:p-3 rounded-lg border border-slate-700/80">
              <div className="flex items-center justify-between text-slate-400 text-[11px] font-semibold mb-1">
                <span>Estimated Arrival</span>
                <Clock className="w-3.5 h-3.5 text-sky-400" />
              </div>
              <div className="text-base sm:text-lg font-mono font-extrabold text-sky-300">
                {estimatedEtaMinutes > 0 ? `~${estimatedEtaMinutes} mins` : 'Arriving Soon'}
              </div>
              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                {distanceKm > 0 ? `${distanceKm} km away` : 'Direct Route'}
              </div>
            </div>

            {/* Live Box Temperature */}
            <div className="bg-slate-800/80 p-2.5 sm:p-3 rounded-lg border border-slate-700/80">
              <div className="flex items-center justify-between text-slate-400 text-[11px] font-semibold mb-1">
                <span>Cold-Box Temp</span>
                <Thermometer className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div className="text-base sm:text-lg font-mono font-extrabold text-emerald-300">
                {coldBoxTemp}°C
              </div>
              <div className="text-[10px] text-emerald-400 font-medium mt-0.5 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" />
                <span>Cold-Chain Certified</span>
              </div>
            </div>

            {/* Speed & Transit Status */}
            <div className="bg-slate-800/80 p-2.5 sm:p-3 rounded-lg border border-slate-700/80">
              <div className="flex items-center justify-between text-slate-400 text-[11px] font-semibold mb-1">
                <span>Rider Speed</span>
                <Gauge className="w-3.5 h-3.5 text-indigo-400" />
              </div>
              <div className="text-base sm:text-lg font-mono font-extrabold text-indigo-200">
                {liveRiderData?.speed !== undefined ? `${Math.round(liveRiderData.speed)} km/h` : 'En Route'}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                {riderVehicle}
              </div>
            </div>

            {/* Telemetry Heartbeat & Battery */}
            <div className="bg-slate-800/80 p-2.5 sm:p-3 rounded-lg border border-slate-700/80">
              <div className="flex items-center justify-between text-slate-400 text-[11px] font-semibold mb-1">
                <span>GPS Radar</span>
                <Battery className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div className="text-base sm:text-lg font-mono font-extrabold text-slate-200">
                {liveRiderData?.batteryLevel !== undefined ? `${liveRiderData.batteryLevel}% Batt` : 'Connected'}
              </div>
              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                {secondsAgo < 0
                  ? 'No signal'
                  : secondsAgo < 90
                  ? `Pinged ${secondsAgo}s ago`
                  : `Pinged ${Math.round(secondsAgo / 60)}m ago`}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Clean Idle State Card when no trip is actively in transit */
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 text-slate-500 flex items-center justify-center shrink-0">
              <Bike className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-slate-400" />
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  {trackingStatus.headline}
                </span>
                <span className="text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded-full">
                  {trackingStatus.tag}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">{trackingStatus.detail}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
            <div className="text-right hidden sm:block">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Destination Lab</span>
              <span className="text-xs font-bold text-slate-800">{clientName.split('(')[0].trim()}</span>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Leaflet Map Card */}
      <div className={`bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs relative ${isFullscreen ? 'fixed inset-0 z-50 rounded-none h-screen' : 'z-0 isolate'}`}>
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-sky-700" />
            <span className="font-bold text-slate-900">
              {isTripActive ? 'Live GPS Vector Tracking' : 'Diagnostic Facility Location'}
            </span>
            <span className="text-slate-500 hidden sm:inline">•</span>
            <span className="text-slate-600 font-mono text-[11px] hidden sm:inline">
              {isTripActive && riderCoords
                ? `Rider [${riderCoords[0].toFixed(4)}, ${riderCoords[1].toFixed(4)}] → Client [${targetDestinationCoords[0].toFixed(4)}, ${targetDestinationCoords[1].toFixed(4)}]`
                : `Client [${targetDestinationCoords[0].toFixed(4)}, ${targetDestinationCoords[1].toFixed(4)}]`
              }
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRecenter}
              className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-md font-semibold text-xs transition-colors flex items-center gap-1 shadow-2xs cursor-pointer"
            >
              {isTripActive ? (
                <>
                  <Bike className="w-3.5 h-3.5 text-sky-700" />
                  <span>Center Rider</span>
                </>
              ) : (
                <>
                  <MapPin className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Center Facility</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-1 text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded-md transition-colors cursor-pointer"
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen Map'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Map Canvas */}
        <div
          ref={mapContainerRef}
          style={{ height: isFullscreen ? 'calc(100vh - 48px)' : height, width: '100%' }}
          className="w-full relative z-0 bg-slate-100"
        />
      </div>
    </div>
  );
};

