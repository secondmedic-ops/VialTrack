import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import {
  MapPin,
  Clock,
  Trash2,
  Edit2,
  ArrowUp,
  ArrowDown,
  GripVertical,
  Plus,
  X,
  Check,
  AlertCircle,
  Building2,
  Phone,
  User,
  Navigation,
  Compass,
  Maximize2,
  Minimize2,
  ShieldCheck,
  Info
} from 'lucide-react';
import { Route, RouteStop } from '../../types';
import { StorageService } from '../../services/storage';
import { normalizeLatLng } from '../../utils/coordinates';
import { fetchRoadPolyline } from '../../utils/routeGeometry';
import { geocodeAddress } from '../../utils/geocoding';
import { formatTimeLabel, normalizeTimeValue, mergeTimeSlots } from '../../utils/timeSlots';

interface RouteStopsManagerProps {
  route: Route;
  onRouteUpdated: (updatedRoute: Route) => void;
  onDeleteRoute?: (routeId: string, routeName: string) => void;
}

export const RouteStopsManager: React.FC<RouteStopsManagerProps> = ({
  route,
  onRouteUpdated,
  onDeleteRoute
}) => {
  const [showMap, setShowMap] = useState<boolean>(true);
  const [isExpandedMap, setIsExpandedMap] = useState<boolean>(false);
  const [editingStop, setEditingStop] = useState<RouteStop | null>(null);
  const [isAddingStop, setIsAddingStop] = useState<boolean>(false);

  // Stop form states
  const [stopForm, setStopForm] = useState({
    id: '',
    name: '',
    address: '',
    lat: '' as any,
    lng: '' as any,
    contactPerson: '',
    phone: '',
    pickupTime: '',
    avgPickupDurationMinutes: 10
  });
  const [formError, setFormError] = useState<string | null>(null);

  // Drag and Drop state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isGeocoding, setIsGeocoding] = useState<boolean>(false);

  const handleGeocodeStopAddress = async () => {
    if (!stopForm.address && !stopForm.name) {
      setFormError('Please enter a stop name or address to geocode.');
      return;
    }
    setIsGeocoding(true);
    setFormError(null);
    try {
      const coords = await geocodeAddress(`${stopForm.name}, ${stopForm.address}`);
      if (coords) {
        setStopForm(prev => ({
          ...prev,
          lat: coords.lat,
          lng: coords.lng
        }));
      } else {
        setFormError('Could not auto-resolve coordinates. Please enter latitude & longitude manually.');
      }
    } catch {
      setFormError('Geocoding service unavailable. Please enter coordinates manually.');
    } finally {
      setIsGeocoding(false);
    }
  };

  // Leaflet map refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const polylinesLayerRef = useRef<L.LayerGroup | null>(null);

  // 1. Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: true
      }).setView([19.1624, 72.8465], 12);

      if (map.attributionControl) {
        map.attributionControl.setPrefix(false);
      }

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: 'SecondMedic GIS Telematics Engine • Spatial Fleet Layer'
      }).addTo(map);

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      markersLayerRef.current = L.layerGroup().addTo(map);
      polylinesLayerRef.current = L.layerGroup().addTo(map);

      mapInstanceRef.current = map;
    }

    return () => {
      // Map cleanup on unmount handled gracefully
    };
  }, [showMap]);

  // 2. Render Markers and Sequential Polyline on Stops / Route changes
  useEffect(() => {
    if (!mapInstanceRef.current || !markersLayerRef.current || !polylinesLayerRef.current) return;

    const map = mapInstanceRef.current;
    const markersGroup = markersLayerRef.current;
    const polylineGroup = polylinesLayerRef.current;

    markersGroup.clearLayers();
    polylineGroup.clearLayers();

    // Polyline Path & Bounds Enforcement
    // Map stops strictly as [Number(s.lat), Number(s.lng)]
    const safeStops = Array.isArray(route.stops) ? route.stops : [];
    const polylinePath: [number, number][] = safeStops.map((s) => {
      const [sLat, sLng] = normalizeLatLng(s.lat, s.lng, 19.1624, 72.8465);
      return [Number(sLat), Number(sLng)];
    });

    // A. Add Stop Markers in Sequential Order
    safeStops.forEach((stop, idx) => {
      const [sLat, sLng] = normalizeLatLng(stop.lat, stop.lng, 19.1624, 72.8465);
      const stopPos: [number, number] = [Number(sLat), Number(sLng)];

      const stopIcon = L.divIcon({
        className: 'custom-route-stop-icon',
        html: `
          <div class="relative flex items-center justify-center cursor-pointer group">
            <div class="w-7 h-7 rounded-full bg-sky-700 text-white font-bold text-xs flex items-center justify-center shadow-md border-2 border-white transform transition-transform group-hover:scale-110">
              ${idx + 1}
            </div>
            <div class="absolute -bottom-1 w-1.5 h-1.5 bg-sky-900 rounded-full"></div>
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 28]
      });

      const marker = L.marker(stopPos, { icon: stopIcon }).addTo(markersGroup);
      marker.bindPopup(`
        <div style="font-family: 'Plus Jakarta Sans', sans-serif; min-width: 180px; padding: 4px 2px;">
          <div style="font-size: 10px; font-weight: 800; color: #0284c7; text-transform: uppercase; margin-bottom: 2px;">
            Stop ${idx + 1} of ${route.stops.length}
          </div>
          <div style="font-weight: 700; color: #0f172a; font-size: 13px; line-height: 1.2;">
            ${stop.name}
          </div>
          <div style="font-size: 11px; color: #64748b; margin-top: 3px; line-height: 1.3;">
            ${stop.address}
          </div>
          <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid #e2e8f0; font-size: 11px;">
            <div style="color: #334155;"><b>Contact:</b> ${stop.contactPerson || 'N/A'}</div>
            <div style="color: #334155;"><b>Phone:</b> ${stop.phone || 'N/A'}</div>
            ${stop.pickupTime ? `<div style="color: #0f172a; font-weight: 700; margin-top: 2px;"><b>Pickup Time:</b> ${formatTimeLabel(stop.pickupTime)}</div>` : ''}
            <div style="color: #0284c7; font-weight: 600; margin-top: 2px;"><b>Est. Pickup:</b> ${stop.avgPickupDurationMinutes || 10} mins</div>
            <div style="color: #64748b; font-family: monospace; font-size: 10px; margin-top: 2px;">[${stopPos[0].toFixed(5)}, ${stopPos[1].toFixed(5)}]</div>
          </div>
        </div>
      `);
    });

    // B. Add Destination Lab Marker & Append to Polyline Path
    if (route.destinationLab) {
      const [destLat, destLng] = normalizeLatLng(
        route.destinationLab.lat,
        route.destinationLab.lng,
        19.1287852,
        72.8294183
      );
      const destinationPos: [number, number] = [Number(destLat), Number(destLng)];
      polylinePath.push(destinationPos);

      const destIcon = L.divIcon({
        className: 'custom-dest-lab-icon',
        html: `
          <div class="relative flex items-center justify-center cursor-pointer group">
            <div class="w-8 h-8 rounded-full bg-emerald-600 text-white font-bold text-xs flex items-center justify-center shadow-lg border-2 border-white transform transition-transform group-hover:scale-110">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </div>
            <div class="absolute -bottom-1 w-2 h-2 bg-emerald-800 rounded-full"></div>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 32]
      });

      const destMarker = L.marker(destinationPos, { icon: destIcon, zIndexOffset: 1000 }).addTo(markersGroup);
      destMarker.bindPopup(`
        <div style="font-family: 'Plus Jakarta Sans', sans-serif; min-width: 190px; padding: 4px 2px;">
          <div style="font-size: 10px; font-weight: 800; color: #059669; text-transform: uppercase; margin-bottom: 2px;">
            Final Destination Lab
          </div>
          <div style="font-weight: 700; color: #0f172a; font-size: 13px;">
            ${route.destinationLab.name}
          </div>
          <div style="font-size: 11px; color: #64748b; margin-top: 3px;">
            ${route.destinationLab.address}
          </div>
          <div style="margin-top: 6px; font-size: 11px; color: #334155; border-top: 1px solid #e2e8f0; padding-top: 4px;">
            <b>Lab Intake Head:</b> ${route.destinationLab.contactPerson || 'Dr. Lab Coord'}<br/>
            <span style="color: #047857; font-family: monospace; font-size: 10px;">[${destinationPos[0].toFixed(5)}, ${destinationPos[1].toFixed(5)}]</span>
          </div>
        </div>
      `);
    }

    // C. Draw Sequential Connected Road Polyline with directional styling along Mumbai road network
    if (polylinePath.length >= 2) {
      // Glow/Background line
      const glowLine = L.polyline(polylinePath, {
        color: '#0284c7',
        weight: 6,
        opacity: 0.35,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(polylineGroup);

      // Core Solid/Dashed Line
      const coreLine = L.polyline(polylinePath, {
        color: '#0369a1',
        weight: 3.5,
        opacity: 0.95,
        dashArray: '8, 6',
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(polylineGroup);

      // Fetch real street road geometry via OSRM
      fetchRoadPolyline(polylinePath).then((roadCoords) => {
        if (roadCoords.length > 0 && polylineGroup.hasLayer(coreLine)) {
          glowLine.setLatLngs(roadCoords);
          coreLine.setLatLngs(roadCoords);
        }
      }).catch(() => {});
    }

    // D. Auto-fit bounds tightly framing stops to destination without panning into ocean
    if (polylinePath.length > 0) {
      setTimeout(() => {
        map.invalidateSize();
        map.fitBounds(polylinePath, { padding: [40, 40], maxZoom: 15 });
      }, 100);
    }
  }, [route.stops, route.destinationLab, showMap, isExpandedMap]);

  // Recalculate size when map is toggled or resized
  useEffect(() => {
    if (mapInstanceRef.current) {
      setTimeout(() => {
        mapInstanceRef.current?.invalidateSize();
      }, 150);
    }
  }, [showMap, isExpandedMap]);

  // --- REORDER LOGIC ---
  const handleMoveStop = (currentIndex: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= route.stops.length) return;

    const newStops = [...route.stops];
    const [moved] = newStops.splice(currentIndex, 1);
    newStops.splice(targetIndex, 0, moved);

    // Re-index order property
    const reorderedStops = newStops.map((s, idx) => ({
      ...s,
      order: idx + 1
    }));

    const updatedRoute: Route = {
      ...route,
      stops: reorderedStops
    };

    StorageService.updateRoute(updatedRoute);
    onRouteUpdated(updatedRoute);
  };

  // --- DRAG AND DROP HANDLERS ---
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `${index}`);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    setDragOverIndex(null);

    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      return;
    }

    const newStops = [...route.stops];
    const [moved] = newStops.splice(draggedIndex, 1);
    newStops.splice(dropIndex, 0, moved);

    // Re-index order
    const reorderedStops = newStops.map((s, idx) => ({
      ...s,
      order: idx + 1
    }));

    const updatedRoute: Route = {
      ...route,
      stops: reorderedStops
    };

    setDraggedIndex(null);
    StorageService.updateRoute(updatedRoute);
    onRouteUpdated(updatedRoute);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  // --- DELETE STOP ---
  const handleDeleteStop = (stopId: string, stopName: string) => {
    if (route.stops.length <= 1) {
      alert('A collection route must contain at least one stop. To remove the entire route, use the "Delete Route" action.');
      return;
    }

    if (window.confirm(`Are you sure you want to remove stop "${stopName}" from this route? The polyline and sequence will update immediately.`)) {
      const remainingStops = route.stops
        .filter((s) => s.id !== stopId)
        .map((s, idx) => ({
          ...s,
          order: idx + 1
        }));

      const updatedRoute: Route = {
        ...route,
        stops: remainingStops
      };

      StorageService.updateRoute(updatedRoute);
      onRouteUpdated(updatedRoute);
    }
  };

  // --- OPEN EDIT MODAL ---
  const handleOpenEditStop = (stop: RouteStop) => {
    setEditingStop(stop);
    setStopForm({
      id: stop.id,
      name: stop.name,
      address: stop.address,
      lat: stop.lat ?? '',
      lng: stop.lng ?? '',
      contactPerson: stop.contactPerson || '',
      phone: stop.phone || '',
      pickupTime: normalizeTimeValue(stop.pickupTime),
      avgPickupDurationMinutes: stop.avgPickupDurationMinutes || 10
    });
    setFormError(null);
  };

  // --- OPEN ADD STOP MODAL ---
  const handleOpenAddStop = () => {
    setIsAddingStop(true);
    setStopForm({
      id: `stop-${Date.now()}-${route.stops.length + 1}`,
      name: '',
      address: '',
      lat: '' as any,
      lng: '' as any,
      contactPerson: '',
      phone: '',
      pickupTime: normalizeTimeValue((route.timeSlots || [])[0]) || '',
      avgPickupDurationMinutes: 10
    });
    setFormError(null);
  };

  // --- SAVE STOP EDIT / ADD ---
  const handleSaveStopForm = (e: React.FormEvent) => {
    e.preventDefault();

    if (!stopForm.name.trim()) {
      setFormError('Stop Name is required.');
      return;
    }
    if (!stopForm.address.trim()) {
      setFormError('Full Address is required.');
      return;
    }
    if (isNaN(Number(stopForm.lat)) || isNaN(Number(stopForm.lng))) {
      setFormError('Latitude and Longitude must be valid numerical coordinates.');
      return;
    }

    const safeStops = Array.isArray(route.stops) ? route.stops : [];

    if (editingStop) {
      // Edit existing stop
      const updatedStops = safeStops.map((s) => {
        if (s.id === editingStop.id) {
          return {
            ...s,
            name: stopForm.name.trim(),
            address: stopForm.address.trim(),
            lat: Number(stopForm.lat),
            lng: Number(stopForm.lng),
            contactPerson: stopForm.contactPerson.trim(),
            phone: stopForm.phone.trim(),
            pickupTime: normalizeTimeValue(stopForm.pickupTime),
            avgPickupDurationMinutes: Number(stopForm.avgPickupDurationMinutes) || 10
          };
        }
        return s;
      });

      const updatedRoute: Route = {
        ...route,
        stops: updatedStops
      };

      StorageService.updateRoute(updatedRoute);
      onRouteUpdated(updatedRoute);
      setEditingStop(null);
    } else if (isAddingStop) {
      // Add new stop to end of list
      const newStop: RouteStop = {
        id: stopForm.id || `stop-${Date.now()}-${safeStops.length + 1}`,
        name: stopForm.name.trim(),
        address: stopForm.address.trim(),
        lat: Number(stopForm.lat),
        lng: Number(stopForm.lng),
        contactPerson: stopForm.contactPerson.trim(),
        phone: stopForm.phone.trim(),
        pickupTime: normalizeTimeValue(stopForm.pickupTime),
        order: safeStops.length + 1,
        avgPickupDurationMinutes: Number(stopForm.avgPickupDurationMinutes) || 10
      };

      const updatedRoute: Route = {
        ...route,
        stops: [...safeStops, newStop]
      };

      StorageService.updateRoute(updatedRoute);
      onRouteUpdated(updatedRoute);
      setIsAddingStop(false);
    }
  };

  return (
    <div className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200 shadow-xs space-y-4">
      {/* Route Card Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <h5 className="font-bold text-slate-900 text-sm sm:text-base">{route.name}</h5>
            <span className="bg-sky-50 text-sky-700 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-sky-200">
              {route.stops.length} Stops
            </span>
          </div>
          {route.description && (
            <p className="text-xs text-slate-500 mt-0.5">{route.description}</p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setShowMap(!showMap)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer border ${
              showMap
                ? 'bg-sky-50 text-sky-700 border-sky-300'
                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
            }`}
            title="Toggle Live Route Map Preview"
          >
            <Compass className="w-3.5 h-3.5 text-sky-700" />
            <span>{showMap ? 'Hide Route Map' : 'Show Route Map'}</span>
          </button>

          <button
            type="button"
            onClick={handleOpenAddStop}
            className="px-2.5 py-1.5 bg-sky-700 hover:bg-sky-800 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
            title="Add a new stop to this route"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Stop</span>
          </button>

          {onDeleteRoute && (
            <button
              type="button"
              onClick={() => onDeleteRoute(route.id, route.name)}
              className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 hover:text-rose-700 transition-colors border border-transparent hover:border-rose-200 cursor-pointer"
              title="Delete Entire Route"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Fixed Daily Pickup Time Slots */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
            <Clock className="w-3 h-3 text-sky-700" />
            Fixed Daily Pickup Time Slots:
          </span>
          <span className="text-[10px] text-slate-400 font-medium">
            Riders will see stops scheduled for each configured slot
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(route.timeSlots || []).map((slot) => (
            <span
              key={slot}
              className="bg-slate-100 border border-slate-200 text-slate-800 font-mono font-bold text-xs px-2.5 py-1 rounded-md flex items-center gap-1.5"
            >
              <Clock className="w-3 h-3 text-sky-700" />
              <span>{slot}</span>
              <button
                type="button"
                onClick={() => {
                  const updatedSlots = (route.timeSlots || []).filter((s) => s !== slot);
                  const updatedRoute: Route = { ...route, timeSlots: updatedSlots };
                  StorageService.updateRoute(updatedRoute);
                  onRouteUpdated(updatedRoute);
                }}
                className="text-slate-400 hover:text-rose-600 transition-colors ml-0.5"
                title="Remove this slot"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}

          {/* Add Slot inline */}
          <div className="flex items-center gap-1">
            <input
              type="time"
              id={`add-slot-input-${route.id}`}
              className="px-2 py-0.5 border border-slate-300 rounded text-xs font-mono focus:ring-1 focus:ring-sky-500"
            />
            <button
              type="button"
              onClick={() => {
                const input = document.getElementById(`add-slot-input-${route.id}`) as HTMLInputElement;
                if (input && input.value) {
                  const val = input.value;
                  const current = route.timeSlots || [];
                  if (!current.includes(val)) {
                    const updatedRoute: Route = { ...route, timeSlots: [...current, val].sort() };
                    StorageService.updateRoute(updatedRoute);
                    onRouteUpdated(updatedRoute);
                  }
                  input.value = '';
                }
              }}
              className="px-2 py-1 bg-sky-50 text-sky-700 hover:bg-sky-100 text-xs font-semibold rounded border border-sky-200 transition-colors flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              <span>Add Slot</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Interactive Grid: Ordered Stop Sequence + Live Map */}
      <div className={`grid grid-cols-1 ${showMap ? 'lg:grid-cols-12' : ''} gap-4`}>
        {/* Left Column: Reorderable Stops List */}
        <div className={`${showMap ? 'lg:col-span-6 xl:col-span-7' : 'w-full'} space-y-2`}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
              <Navigation className="w-3.5 h-3.5 text-sky-700" />
              <span>Ordered Stop Sequence ({(route.stops || []).length})</span>
            </span>
            <span className="text-[10px] text-slate-400 font-medium hidden sm:inline">
              Use ↑ ↓ arrows or drag handle to rearrange
            </span>
          </div>

          <div className="space-y-2">
            {(route.stops || []).map((stop, sIdx) => {
              const isFirst = sIdx === 0;
              const isLast = sIdx === route.stops.length - 1;
              const isDragging = draggedIndex === sIdx;
              const isOver = dragOverIndex === sIdx;

              return (
                <div
                  key={stop.id || sIdx}
                  draggable
                  onDragStart={(e) => handleDragStart(e, sIdx)}
                  onDragOver={(e) => handleDragOver(e, sIdx)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, sIdx)}
                  onDragEnd={handleDragEnd}
                  className={`bg-slate-50 p-3 rounded-lg border transition-all duration-150 relative ${
                    isDragging
                      ? 'opacity-40 border-dashed border-sky-400 bg-sky-50/50'
                      : isOver
                      ? 'border-sky-500 bg-sky-50 shadow-xs'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {/* Drag Handle & Sequence Badge */}
                    <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                      <div
                        className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 p-0.5"
                        title="Drag to rearrange stop order"
                      >
                        <GripVertical className="w-4 h-4" />
                      </div>
                      <span className="w-5 h-5 rounded-full bg-sky-700 text-white font-bold text-[11px] flex items-center justify-center shadow-xs">
                        {sIdx + 1}
                      </span>
                    </div>

                    {/* Stop Details */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <div className="font-bold text-slate-900 text-xs sm:text-sm truncate">
                          {stop.name}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {stop.pickupTime && (
                            <span className="text-[10px] font-bold font-mono text-sky-800 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded flex items-center gap-1">
                              <Clock className="w-2.5 h-2.5 text-sky-700" />
                              {formatTimeLabel(stop.pickupTime)}
                            </span>
                          )}
                          <span className="text-[10px] text-slate-400 font-mono">
                            {stop.avgPickupDurationMinutes || 10}m pickup
                          </span>
                        </div>
                      </div>

                      <div className="text-slate-500 text-[11px] truncate mt-0.5">
                        {stop.address}
                      </div>

                      <div className="flex items-center gap-3 text-[10px] text-slate-600 mt-1.5 flex-wrap">
                        {stop.contactPerson && (
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3 text-slate-400" />
                            <span>{stop.contactPerson}</span>
                          </span>
                        )}
                        {stop.phone && (
                          <span className="flex items-center gap-1 font-mono">
                            <Phone className="w-3 h-3 text-slate-400" />
                            <span>{stop.phone}</span>
                          </span>
                        )}
                        <span className="text-slate-400 font-mono text-[9px]">
                          [{Number(stop.lat || 19.162).toFixed(4)}, {Number(stop.lng || 72.846).toFixed(4)}]
                        </span>
                      </div>
                    </div>

                    {/* Action Buttons: Move Up, Move Down, Edit, Delete */}
                    <div className="flex items-center gap-1 shrink-0 bg-white p-1 rounded-lg border border-slate-200 shadow-2xs">
                      {/* Move Up Button */}
                      <button
                        type="button"
                        disabled={isFirst}
                        onClick={() => handleMoveStop(sIdx, 'up')}
                        className={`p-1 rounded transition-colors ${
                          isFirst
                            ? 'text-slate-300 cursor-not-allowed'
                            : 'text-slate-600 hover:text-sky-700 hover:bg-sky-50 cursor-pointer'
                        }`}
                        title={isFirst ? 'Already at top' : 'Move stop up'}
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>

                      {/* Move Down Button */}
                      <button
                        type="button"
                        disabled={isLast}
                        onClick={() => handleMoveStop(sIdx, 'down')}
                        className={`p-1 rounded transition-colors ${
                          isLast
                            ? 'text-slate-300 cursor-not-allowed'
                            : 'text-slate-600 hover:text-sky-700 hover:bg-sky-50 cursor-pointer'
                        }`}
                        title={isLast ? 'Already at bottom' : 'Move stop down'}
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>

                      <div className="w-[1px] h-3.5 bg-slate-200 mx-0.5"></div>

                      {/* Edit Stop Button */}
                      <button
                        type="button"
                        onClick={() => handleOpenEditStop(stop)}
                        className="p-1 rounded text-slate-600 hover:text-amber-700 hover:bg-amber-50 transition-colors cursor-pointer"
                        title="Edit Stop Details (Name, Address, Coordinates, Contact)"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>

                      {/* Remove Stop Button */}
                      <button
                        type="button"
                        onClick={() => handleDeleteStop(stop.id, stop.name)}
                        className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                        title="Remove Stop from Route"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Final Destination Lab Handover Summary */}
          {route.destinationLab && (
            <div className="bg-emerald-50/80 p-3 rounded-lg border border-emerald-200 text-xs flex items-center justify-between mt-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-2xs font-bold text-[10px]">
                  <ShieldCheck className="w-3.5 h-3.5" />
                </div>
                <div>
                  <span className="text-[9px] text-emerald-800 font-bold uppercase tracking-wider block">
                    Final Lab Handover & Delivery Destination
                  </span>
                  <span className="font-bold text-slate-900 text-xs">{route.destinationLab.name}</span>
                </div>
              </div>
              <span className="text-[11px] text-emerald-800 font-medium">
                {route.destinationLab.contactPerson}
              </span>
            </div>
          )}
        </div>

        {/* Right Column: Live Synchronized Route Map */}
        {showMap && (
          <div className="lg:col-span-6 xl:col-span-5 flex flex-col space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                <Compass className="w-3.5 h-3.5 text-sky-700" />
                <span>Live Route Polyline Preview</span>
              </span>
              <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                Connected: {route.stops.length} Stops → Lab
              </span>
            </div>

            {/* Interactive Leaflet Map View */}
            <div className="relative rounded-lg overflow-hidden border border-slate-200 shadow-inner bg-slate-100 h-64 sm:h-80 md:h-96 z-0 isolate">
              <div ref={mapContainerRef} className="w-full h-full z-0" />

              {/* Map Info Overlay */}
              <div className="absolute top-2 left-2 z-10 bg-white/90 backdrop-blur-xs px-2.5 py-1 rounded-md border border-slate-200 text-[10px] text-slate-700 shadow-xs flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-sky-600 animate-pulse"></span>
                <span>Sequential Polyline Path</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* EDIT / ADD STOP MODAL */}
      {(editingStop || isAddingStop) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <MapPin className="w-5 h-5 text-sky-700" />
                <span>{editingStop ? `Edit Stop: ${editingStop.name}` : 'Add New Collection Stop'}</span>
              </h3>
              <button
                type="button"
                onClick={() => {
                  setEditingStop(null);
                  setIsAddingStop(false);
                }}
                className="p-1 rounded-lg bg-slate-100 text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveStopForm} className="space-y-3.5">
              {/* Stop Name */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Collection Center / Hospital Name *
                </label>
                <input
                  type="text"
                  required
                  value={stopForm.name}
                  onChange={(e) => setStopForm({ ...stopForm, name: e.target.value })}
                  placeholder="e.g. Oscar Hospital, Kandivali West"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs focus:bg-white focus:border-sky-700 focus:outline-hidden"
                />
              </div>

              {/* Full Address */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Full Hospital / Clinic Address *
                </label>
                <textarea
                  required
                  rows={2}
                  value={stopForm.address}
                  onChange={(e) => setStopForm({ ...stopForm, address: e.target.value })}
                  placeholder="e.g. Plot 18, Mathuradas Road, Kandivali West, Mumbai 400067"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs focus:bg-white focus:border-sky-700 focus:outline-hidden resize-none"
                />
              </div>

              {/* Contact Person & Phone */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Contact Person / OPD Head
                  </label>
                  <input
                    type="text"
                    value={stopForm.contactPerson}
                    onChange={(e) => setStopForm({ ...stopForm, contactPerson: e.target.value })}
                    placeholder="e.g. Sister Sunita Rao"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs focus:bg-white focus:border-sky-700 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    OPD Phone / Mobile
                  </label>
                  <input
                    type="text"
                    value={stopForm.phone}
                    onChange={(e) => setStopForm({ ...stopForm, phone: e.target.value })}
                    placeholder="e.g. +91 98201 12345"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs focus:bg-white focus:border-sky-700 focus:outline-hidden"
                  />
                </div>
              </div>

              {/* Scheduled Pickup Time for THIS stop */}
              <div className="p-2.5 bg-sky-50/60 border border-sky-200 rounded-lg space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-sky-700" />
                    <span>Pickup Time at this Stop</span>
                  </label>
                  {stopForm.pickupTime && (
                    <span className="text-[10px] font-bold text-sky-800 bg-white border border-sky-200 px-2 py-0.5 rounded-md font-mono">
                      {formatTimeLabel(stopForm.pickupTime)}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={stopForm.pickupTime}
                    onChange={(e) => setStopForm({ ...stopForm, pickupTime: e.target.value })}
                    className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono focus:border-sky-700 focus:outline-hidden"
                  />
                  {stopForm.pickupTime && (
                    <button
                      type="button"
                      onClick={() => setStopForm({ ...stopForm, pickupTime: '' })}
                      className="text-[11px] font-semibold text-slate-500 hover:text-rose-600 px-2 py-1 rounded cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Quick-pick from the loop's configured slots */}
                {mergeTimeSlots(route.timeSlots).length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span className="text-[10px] text-slate-500 font-semibold">Use loop slot:</span>
                    {mergeTimeSlots(route.timeSlots).map((slot) => (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => setStopForm({ ...stopForm, pickupTime: slot })}
                        className={`px-2 py-0.5 rounded border text-[10px] font-bold font-mono transition-colors cursor-pointer ${
                          stopForm.pickupTime === slot
                            ? 'bg-sky-700 text-white border-sky-700'
                            : 'bg-white text-slate-700 border-slate-300 hover:border-sky-400'
                        }`}
                      >
                        {formatTimeLabel(slot)}
                      </button>
                    ))}
                  </div>
                )}

                <p className="text-[10px] text-slate-500 leading-snug">
                  Optional. Leave blank to fall back to the round's time slot at dispatch. Any custom time is allowed.
                </p>
              </div>

              {/* Coordinates (Lat, Lng) & Duration */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                    Geographical Coordinates
                  </span>
                  <button
                    type="button"
                    onClick={handleGeocodeStopAddress}
                    disabled={isGeocoding}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-700 hover:text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-200 px-2 py-0.5 rounded cursor-pointer transition-colors"
                  >
                    <MapPin className="w-3 h-3 text-sky-600" />
                    <span>{isGeocoding ? 'Pinning...' : 'Pin Coordinates from Address'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Latitude *
                    </label>
                    <input
                      type="number"
                      step="any"
                      required
                      placeholder="e.g. 19.2082"
                      value={stopForm.lat}
                      onChange={(e) => setStopForm({ ...stopForm, lat: parseFloat(e.target.value) || 0 })}
                      className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono focus:bg-white focus:border-sky-700 focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Longitude *
                    </label>
                    <input
                      type="number"
                      step="any"
                      required
                      placeholder="e.g. 72.8398"
                      value={stopForm.lng}
                      onChange={(e) => setStopForm({ ...stopForm, lng: parseFloat(e.target.value) || 0 })}
                      className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono focus:bg-white focus:border-sky-700 focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Est. Duration
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min="2"
                        max="60"
                        value={stopForm.avgPickupDurationMinutes}
                        onChange={(e) => setStopForm({ ...stopForm, avgPickupDurationMinutes: parseInt(e.target.value) || 10 })}
                        className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono focus:bg-white focus:border-sky-700 focus:outline-hidden"
                      />
                      <span className="absolute right-2 top-1.5 text-[10px] text-slate-400 pointer-events-none">
                        min
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Form Action Buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setEditingStop(null);
                    setIsAddingStop(false);
                  }}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-sky-700 hover:bg-sky-800 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>{editingStop ? 'Save Changes' : 'Add Stop to Route'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
