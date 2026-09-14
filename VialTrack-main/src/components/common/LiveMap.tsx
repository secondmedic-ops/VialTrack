import React, { useEffect, useState, useMemo, useRef } from 'react';
import L from 'leaflet';
import { RouteStop, DestinationLab, PickupBoy, PickupTask, StopExecution } from '../../types';
import { Navigation, Radio } from 'lucide-react';
import { resolveMarkerOverlaps } from '../../utils/spiderfy';
import { isRiderLocationStale } from '../../services/locationService';
import 'leaflet/dist/leaflet.css';

// Fix default Leaflet asset icon paths
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
});

export interface LiveMapProps {
  stops?: (RouteStop | StopExecution | any)[];
  destination?: DestinationLab | { lat: number; lng: number; name?: string; address?: string } | any;
  rider?: PickupBoy | null;
  riders?: PickupBoy[];
  tasks?: PickupTask[];
  activeTaskId?: string | null;
  height?: string;
  autoFit?: boolean;
  enableFirestoreSync?: boolean;
}

// Marker Icon Generators
const createRiderIcon = (name: string, vehicleNo?: string) => {
  return L.divIcon({
    className: 'custom-rider-marker',
    html: `
      <div style="display: flex; flex-direction: column; align-items: center; transform: translate(-50%, -100%);">
        <div style="background: #0284c7; color: white; padding: 2px 7px; border-radius: 12px; font-size: 10px; font-weight: 700; white-space: nowrap; box-shadow: 0 2px 6px rgba(0,0,0,0.35); border: 1.5px solid white; display: flex; align-items: center; gap: 4px;">
          <span style="width: 7px; height: 7px; background: #22c55e; border-radius: 50%; display: inline-block; box-shadow: 0 0 6px #22c55e;"></span>
          ${name} ${vehicleNo ? `<span style="opacity: 0.85; font-size: 8.5px;">(${vehicleNo})</span>` : ''}
        </div>
        <div style="position: relative; margin-top: 2px;">
          <div style="position: absolute; width: 44px; height: 44px; border-radius: 50%; background: rgba(2, 132, 199, 0.25); top: -5px; left: -5px; animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
          <div style="background: #0284c7; width: 34px; height: 34px; border-radius: 50%; border: 3px solid white; display: flex; align-items: center; justify-content: center; color: white; box-shadow: 0 4px 10px rgba(0,0,0,0.35); position: relative; z-index: 2;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>
            </svg>
          </div>
        </div>
        <div style="width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 6px solid #0284c7;"></div>
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0]
  });
};

const createStopIcon = (index: number, name: string, isCompleted: boolean) => {
  const bg = isCompleted ? '#10b981' : '#0284c7';
  return L.divIcon({
    className: 'custom-stop-marker',
    html: `
      <div style="display: flex; flex-direction: column; align-items: center; transform: translate(-50%, -100%);">
        <div style="background: white; color: #1e293b; padding: 2px 6px; border-radius: 6px; font-size: 10px; font-weight: 700; white-space: nowrap; border: 1px solid #cbd5e1; box-shadow: 0 2px 4px rgba(0,0,0,0.15); margin-bottom: 2px;">
          ${name}
        </div>
        <div style="background: ${bg}; width: 26px; height: 26px; border-radius: 50%; border: 2.5px solid white; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 11px; box-shadow: 0 3px 8px rgba(0,0,0,0.25);">
          ${isCompleted ? '✓' : index + 1}
        </div>
        <div style="width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 5px solid ${bg};"></div>
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0]
  });
};

const createDestinationIcon = (name?: string) => {
  return L.divIcon({
    className: 'custom-dest-marker',
    html: `
      <div style="display: flex; flex-direction: column; align-items: center; transform: translate(-50%, -100%);">
        ${name ? `<div style="background: #047857; color: white; padding: 2px 6px; border-radius: 6px; font-size: 10px; font-weight: 700; white-space: nowrap; box-shadow: 0 2px 5px rgba(0,0,0,0.25);">
          ${name}
        </div>` : ''}
        <div style="background: #059669; width: 30px; height: 30px; border-radius: 8px; border: 2.5px solid white; display: flex; align-items: center; justify-content: center; color: white; box-shadow: 0 3px 8px rgba(0,0,0,0.3); margin-top: 2px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>
          </svg>
        </div>
        <div style="width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 5px solid #059669;"></div>
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0]
  });
};

export const LiveMap: React.FC<LiveMapProps> = ({
  stops = [],
  destination,
  rider,
  riders = [],
  tasks = [],
  activeTaskId,
  height = '400px'
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const polylinesLayerRef = useRef<L.LayerGroup | null>(null);
  const initialFitDoneRef = useRef<boolean>(false);

  // Default Enroute Live Mode to true
  const [enrouteLive, setEnrouteLive] = useState<boolean>(true);
  const [routeStats, setRouteStats] = useState<{ distanceKm: string; durationMin: number; etaTime: string } | null>(null);

  // Active Rider Extraction
  const activeRider = useMemo(() => {
    if (rider && rider.name !== 'Unassigned' && rider.id) return rider;
    if (activeTaskId) {
      const activeTask = tasks.find((t) => t.id === activeTaskId);
      if (activeTask?.riderId && activeTask.riderId !== 'Unassigned') {
        return riders.find((r) => r.id === activeTask.riderId);
      }
    }
    return undefined;
  }, [rider, activeTaskId, tasks, riders]);

  // Whether the rider being drawn has reported a position recently. The ETA badge used to always
  // read "Live ETA", even for a rider whose app had been closed for hours, so an admin had no way
  // to tell a live position from a stale one.
  const riderIsStale = useMemo(() => isRiderLocationStale(activeRider as any, 10), [activeRider]);

  const riderCoords: [number, number] | null = useMemo(() => {
    const lat = activeRider?.lat ?? activeRider?.currentLocation?.lat;
    const lng = activeRider?.lng ?? activeRider?.currentLocation?.lng;
    if (typeof lat === 'number' && typeof lng === 'number') {
      return [lat, lng];
    }
    return null;
  }, [activeRider]);

  // Construct Road Waypoints
  const waypoints = useMemo(() => {
    const pts: [number, number][] = [];
    const isValidCoord = (lat: any, lng: any): boolean => {
      const numLat = Number(lat);
      const numLng = Number(lng);
      return (
        !isNaN(numLat) &&
        !isNaN(numLng) &&
        isFinite(numLat) &&
        isFinite(numLng) &&
        !(numLat === 0 && numLng === 0) &&
        Math.abs(numLat) > 0.01 &&
        Math.abs(numLng) > 0.01
      );
    };

    if (riderCoords && isValidCoord(riderCoords[0], riderCoords[1])) {
      pts.push(riderCoords);
    }
    (stops || []).forEach((s) => {
      const lat = s?.lat ?? (s as any)?.latitude;
      const lng = s?.lng ?? (s as any)?.longitude;
      if (isValidCoord(lat, lng)) {
        let numLat = Number(lat);
        let numLng = Number(lng);
        if (numLat > 50 && numLng < 40) {
          const temp = numLat;
          numLat = numLng;
          numLng = temp;
        }
        pts.push([numLat, numLng]);
      }
    });
    if (destination && isValidCoord(destination.lat, destination.lng)) {
      let destLat = Number(destination.lat);
      let destLng = Number(destination.lng);
      if (destLat > 50 && destLng < 40) {
        const temp = destLat;
        destLat = destLng;
        destLng = temp;
      }
      pts.push([destLat, destLng]);
    }
    return pts;
  }, [riderCoords, stops, destination]);

  // Initialize Leaflet Map Instance
  useEffect(() => {
    if (!containerRef.current) return;

    if (!mapRef.current) {
      const defaultCenter: [number, number] = riderCoords || waypoints[0] || [19.0330, 73.0297];

      const map = L.map(containerRef.current, {
        center: defaultCenter,
        zoom: 13,
        zoomControl: true,
        attributionControl: true
      });

      if (map.attributionControl) {
        map.attributionControl.setPrefix(false);
      }

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: 'SecondMedic GIS Telematics Engine • Spatial Fleet Layer'
      }).addTo(map);

      polylinesLayerRef.current = L.layerGroup().addTo(map);
      markersLayerRef.current = L.layerGroup().addTo(map);

      mapRef.current = map;
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Handle Container Resize Invalidation
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.invalidateSize();
    const timer = setTimeout(() => {
      mapRef.current?.invalidateSize();
    }, 200);
    return () => clearTimeout(timer);
  }, [height]);

  // Fetch Road Geometry & Update Layers
  useEffect(() => {
    const map = mapRef.current;
    const markersLayer = markersLayerRef.current;
    const polylinesLayer = polylinesLayerRef.current;
    if (!map || !markersLayer || !polylinesLayer) return;

    markersLayer.clearLayers();
    polylinesLayer.clearLayers();

    // 1. Draw Active Rider Marker
    if (activeRider && riderCoords) {
      const riderMarker = L.marker(riderCoords, {
        icon: createRiderIcon(activeRider.name, activeRider.vehicleNumber || activeRider.plateNumber),
        zIndexOffset: 1000
      }).addTo(markersLayer);

      riderMarker.bindPopup(`
        <div style="font-family: 'Plus Jakarta Sans', sans-serif; min-width: 180px; padding: 4px;">
          <div style="font-size: 13px; font-weight: 800; color: #0f172a;">${activeRider.name}</div>
          <div style="font-size: 11px; color: #64748b; margin-top: 2px;">${activeRider.phone || '—'}</div>
          <div style="font-size: 10px; font-weight: 700; color: #059669; margin-top: 4px;">Live Enroute GPS Active</div>
        </div>
      `);
    }

    // 2. Draw Collection Stop Markers (With Anti-Overlap Resolution)
    const resolvedStops = resolveMarkerOverlaps(
      stops,
      (stop, idx) => {
        const lat = stop.lat ?? stop.latitude;
        const lng = stop.lng ?? stop.longitude;
        if (typeof lat !== 'number' || typeof lng !== 'number') return null;
        return { id: stop.id || stop.stopId || `stop-${idx}`, lat, lng };
      },
      0.0003,
      0.0004
    );

    resolvedStops.forEach((point, idx) => {
      const stop = point.data;
      const stopName = stop.name || stop.stopName || `Stop ${idx + 1}`;
      const stopAddress = stop.address || '—';
      const isCompleted = stop.status === 'picked_up' || stop.status === 'collected' || stop.status === 'completed';

      if (point.isOffset) {
        L.polyline([[point.originalLat, point.originalLng], [point.lat, point.lng]], {
          color: '#0284c7',
          weight: 1.5,
          dashArray: '3, 4',
          opacity: 0.7
        }).addTo(markersLayer);
      }

      const stopMarker = L.marker([point.lat, point.lng], {
        icon: createStopIcon(idx, stopName, isCompleted),
        zIndexOffset: 800
      }).addTo(markersLayer);

      stopMarker.bindPopup(`
        <div style="font-family: 'Plus Jakarta Sans', sans-serif; min-width: 180px; padding: 4px;">
          <div style="font-size: 10px; font-weight: 800; color: #0284c7; text-transform: uppercase;">Stop #${idx + 1}</div>
          <div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-top: 2px;">${stopName}</div>
          <div style="font-size: 11px; color: #64748b; margin-top: 2px;">${stopAddress}</div>
          <div style="font-size: 10px; font-weight: 700; color: ${isCompleted ? '#059669' : '#0284c7'}; margin-top: 4px;">
            Status: ${stop.status ? String(stop.status).toUpperCase() : 'PENDING'}
          </div>
        </div>
      `);
    });

    // 3. Draw Destination Lab Marker
    if (destination && typeof destination.lat === 'number' && typeof destination.lng === 'number') {
      const destMarker = L.marker([destination.lat, destination.lng], {
        icon: createDestinationIcon(destination.name),
        zIndexOffset: 900
      }).addTo(markersLayer);

      destMarker.bindPopup(`
        <div style="font-family: 'Plus Jakarta Sans', sans-serif; min-width: 180px; padding: 4px;">
          <div style="font-size: 10px; font-weight: 800; color: #047857; text-transform: uppercase;">Destination Lab</div>
          <div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-top: 2px;">${destination.name || ''}</div>
          ${destination.address ? `<div style="font-size: 11px; color: #64748b; margin-top: 2px;">${destination.address}</div>` : ''}
          <div style="font-size: 10px; font-weight: 700; color: #059669; margin-top: 4px;">Final Intake Destination</div>
        </div>
      `);
    }

    // 4. Calculate Road Geometry via OSRM & Render Polyline
    let isCancelled = false;

    if (waypoints.length >= 2) {
      const cleanWaypoints = waypoints.filter(
        (pt) =>
          Array.isArray(pt) &&
          pt.length === 2 &&
          !isNaN(pt[0]) &&
          !isNaN(pt[1]) &&
          !(pt[0] === 0 && pt[1] === 0) &&
          Math.abs(pt[0]) > 0.01 &&
          Math.abs(pt[1]) > 0.01
      );

      if (cleanWaypoints.length >= 2) {
        const coordString = cleanWaypoints.map((pt) => `${pt[1]},${pt[0]}`).join(';');
        const url = `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson`;

        fetch(url)
          .then((res) => {
            if (!res.ok) throw new Error('OSRM routing network error');
            return res.json();
          })
          .then((data) => {
            if (isCancelled || !polylinesLayer) return;

            let roadPoints: [number, number][] = [];
            if (data?.routes && data.routes.length > 0) {
              const route = data.routes[0];
              roadPoints = route.geometry.coordinates.map((c: [number, number]) => [c[1], c[0]]);

              const distanceKm = (route.distance / 1000).toFixed(1);
              const durationMin = Math.round(route.duration / 60);

              const now = new Date();
              now.setMinutes(now.getMinutes() + durationMin);
              const etaTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

              setRouteStats({ distanceKm, durationMin, etaTime });
            } else {
              roadPoints = cleanWaypoints;
            }

            if (roadPoints.length > 0) {
              // Glow border polyline
              L.polyline(roadPoints, {
                color: '#0284c7',
                weight: 6,
                opacity: 0.3,
                lineCap: 'round',
                lineJoin: 'round'
              }).addTo(polylinesLayer);

              // Main sharp road route
              L.polyline(roadPoints, {
                color: '#0369a1',
                weight: 3.5,
                opacity: 0.95,
                lineCap: 'round',
                lineJoin: 'round'
              }).addTo(polylinesLayer);
            }
          })
          .catch(() => {
            if (isCancelled || !polylinesLayer) return;
            // Fallback direct waypoints line if offline or OSRM unavailable
            L.polyline(cleanWaypoints, {
              color: '#0369a1',
              weight: 3.5,
              opacity: 0.85,
              lineCap: 'round',
              lineJoin: 'round'
            }).addTo(polylinesLayer);
          });
      }
    } else {
      setRouteStats(null);
    }

    // 5. Follow Mode / Initial Fit
    if (enrouteLive && riderCoords) {
      map.flyTo(riderCoords, 14, { animate: true, duration: 1.0 });
    } else if (!initialFitDoneRef.current && waypoints.length > 0) {
      const bounds = L.latLngBounds(waypoints.map((p) => L.latLng(p[0], p[1])));
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15, animate: true });
      initialFitDoneRef.current = true;
    }

    return () => {
      isCancelled = true;
    };
  }, [waypoints, riderCoords, activeRider, stops, destination, enrouteLive]);

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-slate-200 shadow-inner z-0 isolate" style={{ height }}>
      {/* Top Enroute Live Navigation HUD Bar */}
      <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setEnrouteLive((prev) => !prev)}
          className={`px-3 py-1.5 rounded-xl border shadow-md font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer backdrop-blur-md ${
            enrouteLive
              ? 'bg-sky-700 text-white border-sky-800 ring-2 ring-sky-400/40'
              : 'bg-white/95 text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Radio className={`w-3.5 h-3.5 ${enrouteLive ? 'text-emerald-400 animate-pulse' : 'text-slate-400'}`} />
          <span>Enroute Live</span>
          <span className={`text-[9px] px-1.5 py-0.2 rounded-full ${enrouteLive ? 'bg-emerald-500 text-white font-mono' : 'bg-slate-200 text-slate-600'}`}>
            {enrouteLive ? 'DEFAULT ON' : 'PAUSED'}
          </span>
        </button>
      </div>

      {/* Real-Time Road ETA & Telemetry Badge */}
      {routeStats && activeRider && (
        /* On a narrow screen this sat top-right over the map and, with the Enroute Live pill on the
           left, covered most of the visible area. It now docks along the bottom edge on phones and
           returns to the top-right corner from sm: upwards. */
        <div className="absolute bottom-3 left-3 right-3 sm:left-auto sm:bottom-auto sm:top-3 sm:right-3 z-20 bg-white/95 backdrop-blur-md px-3 py-2 sm:px-3.5 sm:py-2.5 rounded-xl border border-slate-200 shadow-xl text-xs space-y-1 animate-in fade-in">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-1.5">
            <span className="font-bold text-slate-900 flex items-center gap-1.5">
              <Navigation className="w-3.5 h-3.5 text-sky-700" />
              <span>Enroute Road Route</span>
            </span>
            <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-1.5 py-0.5 rounded border border-emerald-200">
              {riderIsStale ? 'Last Known' : 'Live ETA'}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 pt-0.5 font-mono text-[11px]">
            <div>
              <span className="text-[9px] text-slate-400 block font-sans uppercase font-bold">Remaining</span>
              <span className="font-bold text-slate-800">{routeStats.distanceKm} km</span>
            </div>
            <div>
              <span className="text-[9px] text-slate-400 block font-sans uppercase font-bold">Est. Duration</span>
              <span className="font-bold text-sky-700">{routeStats.durationMin} mins</span>
            </div>
            <div>
              <span className="text-[9px] text-slate-400 block font-sans uppercase font-bold">Target Arrival</span>
              <span className="font-bold text-emerald-700">{routeStats.etaTime}</span>
            </div>
          </div>
        </div>
      )}

      {/* Leaflet Map DOM Canvas */}
      <div ref={containerRef} className="w-full h-full z-0" />
    </div>
  );
};
