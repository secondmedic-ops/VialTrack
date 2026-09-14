import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { RouteStop, Client } from '../../types';
import { normalizeLatLng } from '../../utils/coordinates';
import {
  MapPin,
  Building2,
  Navigation,
  ArrowUp,
  ArrowDown,
  Trash2,
  Plus,
  Compass,
  CheckCircle2,
  Maximize2,
  Minimize2
} from 'lucide-react';

interface RouteBuilderProps {
  client?: Client | { name: string; lat: number | string; lng: number | string; address?: string; contactPerson?: string };
  initialStops?: RouteStop[];
  destinationLocation?: { name?: string; lat: number | string; lng: number | string; address?: string; contactPerson?: string };
  onStopsChange?: (stops: RouteStop[]) => void;
  onSave?: (routeData: { name: string; stops: RouteStop[]; destinationPos: [number, number] }) => void;
}

export const RouteBuilder: React.FC<RouteBuilderProps> = ({
  client = {
    name: 'Lifecare Diagnostic Hub (Andheri West)',
    lat: 19.1287852,
    lng: 72.8294183,
    address: 'SV Road / Link Road Junction, Andheri West, Mumbai'
  },
  initialStops = [],
  destinationLocation,
  onStopsChange,
  onSave
}) => {
  const [routeName, setRouteName] = useState('');
  const [stops, setStops] = useState<RouteStop[]>(initialStops);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // New Stop State
  const [newStopName, setNewStopName] = useState('');
  const [newStopAddress, setNewStopAddress] = useState('');
  const [newStopLat, setNewStopLat] = useState<number | string>(19.1624);
  const [newStopLng, setNewStopLng] = useState<number | string>(72.8465);
  const [newStopContact, setNewStopContact] = useState('');
  const [newStopPhone, setNewStopPhone] = useState('');

  // Leaflet refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const polylinesLayerRef = useRef<L.LayerGroup | null>(null);

  // 1. Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [19.1624, 72.8398],
        zoom: 12,
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

      markersLayerRef.current = L.layerGroup().addTo(map);
      polylinesLayerRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // 2. Render Markers, Polyline, and Auto-Fit Bounds
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markersGroup = markersLayerRef.current;
    const polylineGroup = polylinesLayerRef.current;
    if (!map || !markersGroup || !polylineGroup) return;

    markersGroup.clearLayers();
    polylineGroup.clearLayers();

    // STRICT COORDINATE ENFORCEMENT
    // Latitude (Mumbai): ~19.1287852, Longitude (Mumbai): ~72.8294183
    const destSource = destinationLocation || client;
    const [normDestLat, normDestLng] = normalizeLatLng(
      destSource.lat,
      destSource.lng,
      19.1287852,
      72.8294183
    );
    const destinationPos: [number, number] = [Number(normDestLat), Number(normDestLng)];

    // Polyline Path: stops mapped strictly as [Number(s.lat), Number(s.lng)]
    const polylinePath: [number, number][] = stops.map((s) => {
      const [sLat, sLng] = normalizeLatLng(s.lat, s.lng, 19.1624, 72.8465);
      return [Number(sLat), Number(sLng)];
    });

    // Append Destination Client Position
    polylinePath.push(destinationPos);

    // A. Render Stop Markers in sequential order
    stops.forEach((stop, idx) => {
      const [sLat, sLng] = normalizeLatLng(stop.lat, stop.lng, 19.1624, 72.8465);
      const stopPos: [number, number] = [Number(sLat), Number(sLng)];

      const stopIcon = L.divIcon({
        className: 'route-stop-custom-pin',
        html: `
          <div class="relative flex flex-col items-center group cursor-pointer">
            <div class="w-8 h-8 rounded-full bg-sky-700 text-white font-extrabold text-xs flex items-center justify-center shadow-lg border-2 border-white ring-2 ring-sky-300">
              ${idx + 1}
            </div>
            <div class="absolute -bottom-5 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-xs border border-slate-700 whitespace-nowrap">
              Stop ${idx + 1}
            </div>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      const marker = L.marker(stopPos, { icon: stopIcon }).addTo(markersGroup);
      marker.bindPopup(`
        <div style="font-family: sans-serif; min-width: 190px; padding: 4px;">
          <div style="font-size: 10px; font-weight: 800; color: #0284c7; text-transform: uppercase;">
            Stop #${idx + 1} Collection Hub
          </div>
          <div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-top: 2px;">
            ${stop.name}
          </div>
          <div style="font-size: 11px; color: #64748b; margin-top: 2px;">
            ${stop.address}
          </div>
          <div style="font-size: 10px; font-family: monospace; color: #0369a1; margin-top: 4px;">
            Lat: ${stopPos[0].toFixed(6)} | Lng: ${stopPos[1].toFixed(6)}
          </div>
        </div>
      `);
    });

    // B. Render Destination Lab Marker
    const destIcon = L.divIcon({
      className: 'dest-lab-custom-pin',
      html: `
        <div class="relative flex flex-col items-center group cursor-pointer">
          <div class="w-9 h-9 rounded-lg bg-emerald-600 text-white font-bold text-sm flex items-center justify-center shadow-xl border-2 border-white ring-3 ring-emerald-300">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </div>
          <div class="absolute -bottom-5 left-1/2 -translate-x-1/2 bg-emerald-950 text-emerald-200 text-[9px] font-extrabold px-1.5 py-0.5 rounded shadow-xs border border-emerald-700 whitespace-nowrap">
            DESTINATION LAB
          </div>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });

    const destMarker = L.marker(destinationPos, { icon: destIcon, zIndexOffset: 1000 }).addTo(markersGroup);
    destMarker.bindPopup(`
      <div style="font-family: sans-serif; min-width: 200px; padding: 4px;">
        <div style="font-size: 10px; font-weight: 800; color: #059669; text-transform: uppercase;">
          Final Destination Lab
        </div>
        <div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-top: 2px;">
          ${destSource.name || 'Central Intake Lab'}
        </div>
        <div style="font-size: 11px; color: #64748b; margin-top: 2px;">
          ${destSource.address || 'Mumbai, Maharashtra'}
        </div>
        <div style="font-size: 10px; font-family: monospace; color: #047857; margin-top: 4px;">
          Lat: ${destinationPos[0].toFixed(6)} | Lng: ${destinationPos[1].toFixed(6)}
        </div>
      </div>
    `);

    // C. Draw Strict Polyline Path
    if (polylinePath.length >= 2) {
      // Background Glow
      L.polyline(polylinePath, {
        color: '#0284c7',
        weight: 6,
        opacity: 0.35,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(polylineGroup);

      // Foreground Primary Path
      L.polyline(polylinePath, {
        color: '#0369a1',
        weight: 3.5,
        opacity: 0.95,
        dashArray: '8, 6',
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(polylineGroup);
    }

    // D. Auto-fit Map Bounds tightly framing stops to destination
    if (polylinePath.length > 0) {
      setTimeout(() => {
        map.invalidateSize();
        map.fitBounds(polylinePath, { padding: [40, 40], maxZoom: 15 });
      }, 60);
    }
  }, [stops, client, destinationLocation]);

  // Handle Reordering Stops
  const handleMove = (index: number, direction: 'up' | 'down') => {
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= stops.length) return;
    const updated = [...stops];
    const [moved] = updated.splice(index, 1);
    updated.splice(target, 0, moved);
    const reordered = updated.map((s, idx) => ({ ...s, order: idx + 1 }));
    setStops(reordered);
    if (onStopsChange) onStopsChange(reordered);
  };

  // Handle Delete Stop
  const handleDelete = (stopId: string) => {
    const updated = stops.filter((s) => s.id !== stopId).map((s, idx) => ({ ...s, order: idx + 1 }));
    setStops(updated);
    if (onStopsChange) onStopsChange(updated);
  };

  // Handle Add Stop
  const handleAddStop = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStopName.trim()) return;

    const [vLat, vLng] = normalizeLatLng(newStopLat, newStopLng, 19.1624, 72.8465);

    const newStop: RouteStop = {
      id: `stop-${Date.now()}`,
      name: newStopName.trim(),
      address: newStopAddress.trim() || 'Mumbai, Maharashtra',
      lat: Number(vLat),
      lng: Number(vLng),
      contactPerson: newStopContact.trim() || 'OPD In-charge',
      phone: newStopPhone.trim() || '+91 98200 00000',
      order: stops.length + 1,
      avgPickupDurationMinutes: 10
    };

    const updated = [...stops, newStop];
    setStops(updated);
    if (onStopsChange) onStopsChange(updated);

    // Reset inputs
    setNewStopName('');
    setNewStopAddress('');
    setNewStopContact('');
    setNewStopPhone('');
  };

  return (
    <div className="space-y-4">
      {/* Builder Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200 p-4 rounded-xl shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <Compass className="w-5 h-5 text-sky-700" />
            <h3 className="font-bold text-slate-900 text-base sm:text-lg">Visual Route Builder</h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time sequential route mapping with verified latitude/longitude coordinates.
          </p>
        </div>

        {onSave && (
          <button
            type="button"
            onClick={() => {
              const [dLat, dLng] = normalizeLatLng(client.lat, client.lng, 19.1287852, 72.8294183);
              onSave({
                name: routeName,
                stops,
                destinationPos: [Number(dLat), Number(dLng)]
              });
            }}
            className="px-4 py-2 bg-sky-700 hover:bg-sky-800 text-white font-bold text-xs rounded-lg shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Save Route Sequence</span>
          </button>
        )}
      </div>

      {/* Main Grid: Left Controls & Right Interactive Map */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column: Stops and Add Form (6 cols) */}
        <div className="lg:col-span-6 space-y-4">
          {/* Route Name Input */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Route Name</label>
            <input
              type="text"
              value={routeName}
              onChange={(e) => setRouteName(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-900 focus:outline-hidden focus:border-sky-700 shadow-2xs"
            />
          </div>

          {/* Ordered Stops List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1">
                <Navigation className="w-3.5 h-3.5 text-sky-700" />
                Ordered Stops ({stops.length})
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                Order matches collection sequence
              </span>
            </div>

            {stops.map((stop, idx) => (
              <div
                key={stop.id}
                className="p-3 bg-white border border-slate-200 rounded-lg shadow-xs flex items-center justify-between gap-3 hover:border-slate-300 transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-6 h-6 rounded-full bg-sky-700 text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-2xs">
                    {idx + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-xs text-slate-900 truncate">{stop.name}</div>
                    <div className="text-[11px] text-slate-500 truncate">{stop.address}</div>
                    <div className="text-[10px] font-mono text-sky-800">
                      [{Number(stop.lat).toFixed(4)}, {Number(stop.lng).toFixed(4)}]
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => handleMove(idx, 'up')}
                    className={`p-1 rounded ${idx === 0 ? 'text-slate-300' : 'text-slate-600 hover:bg-slate-100 hover:text-sky-700'} cursor-pointer`}
                    title="Move stop up"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === stops.length - 1}
                    onClick={() => handleMove(idx, 'down')}
                    className={`p-1 rounded ${idx === stops.length - 1 ? 'text-slate-300' : 'text-slate-600 hover:bg-slate-100 hover:text-sky-700'} cursor-pointer`}
                    title="Move stop down"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(stop.id)}
                    className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded cursor-pointer ml-1"
                    title="Delete stop"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}

            {/* Destination Lab Indicator */}
            <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-lg flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-md bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs">
                  <Building2 className="w-3.5 h-3.5" />
                </div>
                <div>
                  <div className="text-[10px] font-bold text-emerald-800 uppercase">Final Destination Lab</div>
                  <div className="font-bold text-slate-900 text-xs">{client.name}</div>
                </div>
              </div>
              <div className="font-mono text-[10px] text-emerald-800 font-bold">
                [{Number(client.lat).toFixed(4)}, {Number(client.lng).toFixed(4)}]
              </div>
            </div>
          </div>

          {/* Add Stop Form */}
          <form onSubmit={handleAddStop} className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5 text-sky-700" />
                Add Collection Stop
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                required
                placeholder="Hospital / Hub Name"
                value={newStopName}
                onChange={(e) => setNewStopName(e.target.value)}
                className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-md text-xs text-slate-900"
              />
              <input
                type="text"
                placeholder="Address"
                value={newStopAddress}
                onChange={(e) => setNewStopAddress(e.target.value)}
                className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-md text-xs text-slate-900"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-slate-600 mb-0.5">Latitude (e.g. 19.1624)</label>
                <input
                  type="number"
                  step="any"
                  required
                  value={newStopLat}
                  onChange={(e) => setNewStopLat(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-md text-xs font-mono text-slate-900"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-600 mb-0.5">Longitude (e.g. 72.8465)</label>
                <input
                  type="number"
                  step="any"
                  required
                  value={newStopLng}
                  onChange={(e) => setNewStopLng(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-md text-xs font-mono text-slate-900"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-1.5 bg-sky-700 hover:bg-sky-800 text-white font-bold text-xs rounded-md shadow-xs transition-colors cursor-pointer flex items-center justify-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Stop to Route
            </button>
          </form>
        </div>

        {/* Right Column: Interactive Leaflet Map Preview (6 cols) */}
        <div className="lg:col-span-6 flex flex-col space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-sky-700" />
              Live Route Preview
            </span>
            <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
              Auto-Framed Map Bounds (40px padding)
            </span>
          </div>

          <div className="relative rounded-xl overflow-hidden border border-slate-300 shadow-inner bg-slate-100 h-80 sm:h-[480px] z-0 isolate">
            <div ref={mapContainerRef} className="w-full h-full z-0" />

            <div className="absolute top-2 left-2 z-10 bg-white/95 backdrop-blur-xs px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-xs text-[10px] text-slate-800 space-y-0.5">
              <div className="font-bold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-sky-600 animate-pulse"></span>
                <span>Active Route Leg Sequence</span>
              </div>
              <div className="text-slate-500 font-mono text-[9px]">
                {stops.length} Stops ➔ Final Destination Lab
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
