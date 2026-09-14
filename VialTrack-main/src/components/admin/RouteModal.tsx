import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Route, RouteStop, Client } from '../../types';
import { normalizeLatLng } from '../../utils/coordinates';
import { geocodeAddress } from '../../utils/geocoding';
import { RouteStopItem } from './RouteStopItem';
import { normalizeTimeValue } from '../../utils/timeSlots';
import {
  X,
  MapPin,
  Clock,
  Plus,
  Building2,
  Compass,
  CheckCircle2,
  Sparkles,
  RefreshCw,
  Navigation
} from 'lucide-react';

interface RouteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveRoute: (route: Partial<Route>) => void;
  client: Client;
  initialRoute?: Route | null;
}

export const RouteModal: React.FC<RouteModalProps> = ({
  isOpen,
  onClose,
  onSaveRoute,
  client,
  initialRoute
}) => {
  const [name, setName] = useState(initialRoute?.name || '');
  const [description, setDescription] = useState(initialRoute?.description || '');
  const [timeSlots, setTimeSlots] = useState<string[]>(initialRoute?.timeSlots || []);
  const [newSlotInput, setNewSlotInput] = useState('');

  const [destinationName, setDestinationName] = useState(
    initialRoute?.destinationLab?.name || client?.name || ''
  );
  const [destinationAddress, setDestinationAddress] = useState(
    initialRoute?.destinationLab?.address || client?.address || ''
  );
  const [destinationLat, setDestinationLat] = useState<number | string>(
    initialRoute?.destinationLab?.lat ?? client?.lat ?? ''
  );
  const [destinationLng, setDestinationLng] = useState<number | string>(
    initialRoute?.destinationLab?.lng ?? client?.lng ?? ''
  );
  const [destinationContact, setDestinationContact] = useState(
    initialRoute?.destinationLab?.contactPerson || client?.contactPerson || ''
  );
  const [destinationPhone, setDestinationPhone] = useState(
    initialRoute?.destinationLab?.phone || client?.phone || ''
  );
  const [isGeocodingDest, setIsGeocodingDest] = useState(false);
  const [destGeocodeMsg, setDestGeocodeMsg] = useState<string | null>(null);

  const [stops, setStops] = useState<RouteStop[]>(
    initialRoute?.stops || [
      {
        id: `stop_${Date.now()}_0`,
        stopIndex: 1,
        order: 1,
        name: '',
        address: '',
        lat: '' as any,
        lng: '' as any,
        contactPerson: '',
        phone: '',
        estDurationMin: 10,
        avgPickupDurationMinutes: 10,
        status: 'pending'
      }
    ]
  );

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersGroupRef = useRef<L.LayerGroup | null>(null);
  const polylineGroupRef = useRef<L.LayerGroup | null>(null);

  // Initialize Map
  useEffect(() => {
    if (!isOpen || !mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [19.1624, 72.8465],
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

      markersGroupRef.current = L.layerGroup().addTo(map);
      polylineGroupRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [isOpen]);

  // Synchronize Leaflet Markers & Polyline with Strict Coordinate Validation
  useEffect(() => {
    if (!isOpen || !mapInstanceRef.current || !markersGroupRef.current || !polylineGroupRef.current) return;

    const map = mapInstanceRef.current;
    const markersGroup = markersGroupRef.current;
    const polylineGroup = polylineGroupRef.current;

    markersGroup.clearLayers();
    polylineGroup.clearLayers();

    // 1. Enforce Destination Coordinate Precision [Latitude, Longitude]
    const [normDestLat, normDestLng] = normalizeLatLng(
      destinationLat || client.lat,
      destinationLng || client.lng,
      19.1287852,
      72.8294183
    );
    const destinationPos: [number, number] = [Number(normDestLat), Number(normDestLng)];

    // 2. Polyline Path: stops mapped strictly as [Number(s.lat), Number(s.lng)]
    const polylinePath: [number, number][] = stops.map((s) => {
      const [sLat, sLng] = normalizeLatLng(s.lat, s.lng, 19.1624, 72.8465);
      return [Number(sLat), Number(sLng)];
    });

    // 3. Push Destination Position to polyline
    polylinePath.push([Number(destinationPos[0]), Number(destinationPos[1])]);

    // A. Render Stop Markers
    stops.forEach((stop, idx) => {
      const [sLat, sLng] = normalizeLatLng(stop.lat, stop.lng, 19.1624, 72.8465);
      const stopPos: [number, number] = [Number(sLat), Number(sLng)];

      const stopIcon = L.divIcon({
        className: 'route-modal-stop-pin',
        html: `
          <div class="relative flex flex-col items-center">
            <div class="w-7 h-7 rounded-full bg-sky-700 text-white font-extrabold text-xs flex items-center justify-center shadow-md border-2 border-white ring-2 ring-sky-300">
              ${idx + 1}
            </div>
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });

      const m = L.marker(stopPos, { icon: stopIcon }).addTo(markersGroup);
      m.bindPopup(`
        <div style="font-family: sans-serif; font-size: 12px; line-height: 1.3;">
          <b style="color: #0284c7;">Stop #${idx + 1}</b>: ${stop.name}<br/>
          <span style="color: #64748b; font-size: 10px;">${stop.address}</span>
        </div>
      `);
    });

    // B. Render Destination Lab Marker
    const destIcon = L.divIcon({
      className: 'route-modal-dest-pin',
      html: `
        <div class="relative flex flex-col items-center">
          <div class="w-8 h-8 rounded-lg bg-emerald-600 text-white font-bold text-xs flex items-center justify-center shadow-lg border-2 border-white ring-2 ring-emerald-300">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </div>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    const dm = L.marker(destinationPos, { icon: destIcon, zIndexOffset: 999 }).addTo(markersGroup);
    dm.bindPopup(`
      <div style="font-family: sans-serif; font-size: 12px; line-height: 1.3;">
        <b style="color: #059669;">Final Destination Lab</b>: ${destinationName}<br/>
        <span style="color: #64748b; font-size: 10px;">${destinationAddress}</span>
      </div>
    `);

    // C. Render Strict Sequential Polyline
    if (polylinePath.length >= 2) {
      L.polyline(polylinePath, {
        color: '#0284c7',
        weight: 5,
        opacity: 0.4
      }).addTo(polylineGroup);

      L.polyline(polylinePath, {
        color: '#0369a1',
        weight: 3,
        opacity: 0.9,
        dashArray: '8, 6'
      }).addTo(polylineGroup);
    }

    // D. Auto-fit Map Bounds with 40px padding
    if (polylinePath.length > 0) {
      setTimeout(() => {
        map.invalidateSize();
        map.fitBounds(polylinePath, { padding: [40, 40], maxZoom: 15 });
      }, 100);
    }
  }, [isOpen, stops, destinationLat, destinationLng, destinationName, destinationAddress, client]);

  if (!isOpen) return null;

  const handleAddSlot = () => {
    if (!newSlotInput || timeSlots.includes(newSlotInput)) return;
    setTimeSlots([...timeSlots, newSlotInput].sort());
    setNewSlotInput('');
  };

  const handleRemoveSlot = (slot: string) => {
    setTimeSlots(timeSlots.filter((s) => s !== slot));
  };

  const handleAddStop = () => {
    const nextIdx = stops.length;
    const newStop: RouteStop = {
      id: `stop_${Date.now()}_${nextIdx}`,
      stopIndex: nextIdx + 1,
      order: nextIdx + 1,
      name: `Hospital Collection Center ${nextIdx + 1}`,
      address: '',
      lat: 19.1860,
      lng: 72.8485,
      contactPerson: '',
      phone: '',
      estDurationMin: 10,
      avgPickupDurationMinutes: 10,
      status: 'pending'
    };
    setStops([...stops, newStop]);
  };

  const handleUpdateStop = (index: number, updated: Partial<RouteStop>) => {
    const copy = [...stops];
    copy[index] = { ...copy[index], ...updated };
    setStops(copy);
  };

  const handleMoveStop = (index: number, dir: 'up' | 'down') => {
    const target = dir === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= stops.length) return;
    const copy = [...stops];
    const [moved] = copy.splice(index, 1);
    copy.splice(target, 0, moved);
    setStops(copy.map((s, idx) => ({ ...s, stopIndex: idx + 1, order: idx + 1 })));
  };

  const handleDeleteStop = (index: number) => {
    if (stops.length <= 1) return;
    const filtered = stops.filter((_, idx) => idx !== index);
    setStops(filtered.map((s, idx) => ({ ...s, stopIndex: idx + 1, order: idx + 1 })));
  };

  const handleGeocodeDestination = async () => {
    const query = destinationAddress || destinationName;
    if (!query) return;
    setIsGeocodingDest(true);
    try {
      const res = await geocodeAddress(query, 99);
      setDestinationLat(res.lat);
      setDestinationLng(res.lng);
      setDestGeocodeMsg(`Pinned: ${res.lat.toFixed(4)}, ${res.lng.toFixed(4)}`);
      setTimeout(() => setDestGeocodeMsg(null), 3000);
    } catch (e) {
      setDestGeocodeMsg('Lookup failed');
      setTimeout(() => setDestGeocodeMsg(null), 2500);
    } finally {
      setIsGeocodingDest(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const [dLat, dLng] = normalizeLatLng(
      destinationLat || client.lat,
      destinationLng || client.lng,
      19.1287852,
      72.8294183
    );

    const processedStops: RouteStop[] = stops.map((stop, index) => ({
      id: stop.id || `stop_${Date.now()}_${index}`,
      stopIndex: index + 1,
      order: index + 1,
      name: stop.name,
      address: stop.address,
      contactPerson: stop.contactPerson || '',
      phone: stop.phone || '',
      lat: parseFloat(stop.lat as any) || 0,
      lng: parseFloat(stop.lng as any) || 0,
      pickupTime: normalizeTimeValue(stop.pickupTime),
      estDurationMin: parseInt((stop.estDurationMin ?? stop.avgPickupDurationMinutes ?? 10) as any, 10) || 10,
      avgPickupDurationMinutes: parseInt((stop.estDurationMin ?? stop.avgPickupDurationMinutes ?? 10) as any, 10) || 10,
      status: 'pending' as const
    }));

    onSaveRoute({
      id: initialRoute?.id || `route-${Date.now()}`,
      clientId: client.id,
      name: name.trim(),
      description: description.trim(),
      timeSlots: timeSlots,
      destinationLab: {
        id: initialRoute?.destinationLab?.id || `dest-${Date.now()}`,
        name: destinationName.trim(),
        address: destinationAddress.trim(),
        lat: Number(dLat),
        lng: Number(dLng),
        contactPerson: destinationContact.trim(),
        phone: destinationPhone.trim()
      },
      stops: processedStops,
      active: true
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-fadeIn">
      <div className="w-full max-w-4xl bg-white border border-slate-200 rounded-2xl shadow-2xl space-y-4 my-6 max-h-[92vh] overflow-y-auto p-5 sm:p-6">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2">
              <Compass className="w-5 h-5 text-sky-700" />
              <span>{initialRoute ? `Edit Route: ${initialRoute.name}` : `Create Route for ${client.name}`}</span>
            </h3>
            <p className="text-xs text-slate-500">
              Configure collection stops, destination lab handover, and sequential polyline paths.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-100 text-slate-500 hover:text-slate-900 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Main Grid: Form Inputs Left, Live Map Right */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Left Inputs (7 cols) */}
            <div className="lg:col-span-7 space-y-3.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Route Name *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-semibold focus:bg-white focus:border-sky-700"
                />
              </div>

              {/* Time Slots */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                <label className="block text-[10px] font-bold text-slate-600 uppercase">
                  Pickup Schedule Time Slots:
                </label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {timeSlots.map((slot) => (
                    <span
                      key={slot}
                      className="bg-white border border-slate-300 text-slate-800 font-mono font-bold px-2 py-0.5 rounded flex items-center gap-1 shadow-2xs"
                    >
                      <Clock className="w-3 h-3 text-sky-700" />
                      {slot}
                      <button
                        type="button"
                        onClick={() => handleRemoveSlot(slot)}
                        className="text-slate-400 hover:text-rose-600 ml-0.5 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="time"
                    value={newSlotInput}
                    onChange={(e) => setNewSlotInput(e.target.value)}
                    className="px-2 py-1 bg-white border border-slate-300 rounded text-slate-900 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={handleAddSlot}
                    className="px-2.5 py-1 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded cursor-pointer"
                  >
                    + Add Slot
                  </button>
                </div>
              </div>

              {/* Ordered Stops */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-bold text-slate-700 uppercase flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-sky-700" />
                    <span>HOSPITAL / LAB COLLECTION STOPS ({stops.length})</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleAddStop}
                    className="px-2.5 py-1 bg-sky-50 hover:bg-sky-100 text-sky-700 font-bold rounded-md border border-sky-200 flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Stop
                  </button>
                </div>

                <div className="space-y-2.5 max-h-[320px] overflow-y-auto pr-1">
                  {stops.map((stop, idx) => (
                    <RouteStopItem
                      key={stop.id || idx}
                      stop={stop}
                      index={idx}
                      totalStops={stops.length}
                      onChange={(updated) => handleUpdateStop(idx, updated)}
                      onRemove={() => handleDeleteStop(idx)}
                      onMoveUp={() => handleMoveStop(idx, 'up')}
                      onMoveDown={() => handleMoveStop(idx, 'down')}
                      canRemove={stops.length > 1}
                    />
                  ))}
                </div>
              </div>

              {/* Destination Lab */}
              <div className="p-3 bg-emerald-50/90 border border-emerald-200 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-bold text-emerald-800 uppercase flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-emerald-700" />
                    <span>Destination Lab Handover</span>
                  </label>
                  <div className="flex items-center gap-2">
                    {destGeocodeMsg && (
                      <span className="text-[10px] bg-emerald-200 text-emerald-900 font-semibold px-2 py-0.5 rounded flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-700" />
                        {destGeocodeMsg}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={handleGeocodeDestination}
                      disabled={isGeocodingDest}
                      className="text-[10px] text-emerald-800 hover:text-emerald-950 font-bold flex items-center gap-1 cursor-pointer bg-emerald-100 hover:bg-emerald-200 px-2 py-0.5 rounded border border-emerald-300"
                    >
                      {isGeocodingDest ? (
                        <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-2.5 h-2.5" />
                      )}
                      <span>Pin Lab Coordinates</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    required
                    placeholder="Lab Name"
                    value={destinationName}
                    onChange={(e) => setDestinationName(e.target.value)}
                    className="px-2 py-1.5 bg-white border border-emerald-300 rounded-lg text-slate-900 text-xs font-semibold"
                  />
                  <input
                    type="text"
                    placeholder="Lab Address"
                    value={destinationAddress}
                    onChange={(e) => setDestinationAddress(e.target.value)}
                    className="px-2 py-1.5 bg-white border border-emerald-300 rounded-lg text-slate-900 text-xs"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-2 bg-white rounded-lg border border-emerald-200">
                  <div>
                    <label className="text-[10px] font-bold text-emerald-800 uppercase flex items-center gap-1 mb-0.5">
                      <Navigation className="w-3 h-3 text-emerald-700" />
                      <span>Destination Lab Latitude</span>
                    </label>
                    <input
                      type="number"
                      step="any"
                      placeholder="19.1287852"
                      value={destinationLat}
                      onChange={(e) => setDestinationLat(parseFloat(e.target.value) || 0)}
                      className="w-full px-2 py-1 bg-emerald-50/50 border border-emerald-300 rounded-md text-slate-900 font-mono text-xs font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-emerald-800 uppercase flex items-center gap-1 mb-0.5">
                      <Navigation className="w-3 h-3 text-emerald-700" />
                      <span>Destination Lab Longitude</span>
                    </label>
                    <input
                      type="number"
                      step="any"
                      placeholder="72.8294183"
                      value={destinationLng}
                      onChange={(e) => setDestinationLng(parseFloat(e.target.value) || 0)}
                      className="w-full px-2 py-1 bg-emerald-50/50 border border-emerald-300 rounded-md text-slate-900 font-mono text-xs font-bold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Lab Intake Lead"
                    value={destinationContact}
                    onChange={(e) => setDestinationContact(e.target.value)}
                    className="px-2 py-1 bg-white border border-emerald-300 rounded text-slate-800 text-xs"
                  />
                  <input
                    type="text"
                    placeholder="Lab Phone Number"
                    value={destinationPhone}
                    onChange={(e) => setDestinationPhone(e.target.value)}
                    className="px-2 py-1 bg-white border border-emerald-300 rounded text-slate-800 font-mono text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Right Map Preview (5 cols) */}
            <div className="lg:col-span-5 flex flex-col space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                  Live Route Preview
                </span>
                <span className="text-[9px] text-emerald-800 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded font-bold">
                  Bounds Fit (40px)
                </span>
              </div>
              <div className="relative rounded-xl overflow-hidden border border-slate-300 shadow-inner bg-slate-100 h-64 lg:h-full min-h-[300px] z-0 isolate">
                <div ref={mapContainerRef} className="w-full h-full z-0" />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-sky-700 hover:bg-sky-800 text-white font-bold rounded-lg shadow-xs cursor-pointer transition-colors flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Save Route Configuration</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
