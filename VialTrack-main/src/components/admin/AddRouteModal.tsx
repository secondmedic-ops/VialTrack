import React, { useState } from 'react';
import { Client, Route, RouteStop } from '../../types';
import { RouteStopItem } from './RouteStopItem';
import { normalizeTimeValue } from '../../utils/timeSlots';
import { geocodeAddress } from '../../utils/geocoding';
import { normalizeLatLng } from '../../utils/coordinates';
import {
  MapPin,
  Clock,
  Building2,
  Plus,
  X,
  CheckCircle2,
  Compass,
  Sparkles,
  RefreshCw,
  Navigation
} from 'lucide-react';

interface AddRouteModalProps {
  isOpen: boolean;
  onClose: () => void;
  client: Client;
  onSaveRoute: (routeData: Route) => Promise<void> | void;
}

export const AddRouteModal: React.FC<AddRouteModalProps> = ({
  isOpen,
  onClose,
  client,
  onSaveRoute
}) => {
  // Destination Lab (auto-fill from client if provided, or empty strings)
  const defaultClientLat = client?.lat || '';
  const defaultClientLng = client?.lng || '';

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [timeSlots, setTimeSlots] = useState<string[]>([]);
  const [newSlotInput, setNewSlotInput] = useState('');

  // Destination Handover state strictly from client or blank
  const [destinationName, setDestinationName] = useState(client?.name || '');
  const [destinationAddress, setDestinationAddress] = useState(client?.address || '');
  const [destinationLat, setDestinationLat] = useState<number | string>(defaultClientLat);
  const [destinationLng, setDestinationLng] = useState<number | string>(defaultClientLng);
  const [destinationContact, setDestinationContact] = useState(client?.contactPerson || '');
  const [destinationPhone, setDestinationPhone] = useState(client?.phone || '');
  const [isGeocodingDest, setIsGeocodingDest] = useState(false);
  const [destGeocodeMsg, setDestGeocodeMsg] = useState<string | null>(null);

  // Dynamic Stops State initialized strictly with clean blank stop template
  const [formStops, setFormStops] = useState<RouteStop[]>([
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
  ]);

  if (!isOpen) return null;

  const handleAddStop = () => {
    const nextIdx = formStops.length;
    const newStop: RouteStop = {
      id: `stop_${Date.now()}_${nextIdx}`,
      stopIndex: nextIdx + 1,
      order: nextIdx + 1,
      name: '',
      address: '',
      lat: '' as any,
      lng: '' as any,
      contactPerson: '',
      phone: '',
      estDurationMin: 10,
      avgPickupDurationMinutes: 10,
      status: 'pending'
    };
    setFormStops([...formStops, newStop]);
  };

  const handleUpdateStop = (index: number, updated: Partial<RouteStop>) => {
    const copy = [...formStops];
    copy[index] = { ...copy[index], ...updated };
    setFormStops(copy);
  };

  const handleRemoveStop = (index: number) => {
    if (formStops.length <= 1) return;
    const filtered = formStops.filter((_, i) => i !== index);
    setFormStops(
      filtered.map((s, idx) => ({
        ...s,
        stopIndex: idx + 1,
        order: idx + 1
      }))
    );
  };

  const handleMoveStop = (index: number, direction: 'up' | 'down') => {
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= formStops.length) return;
    const copy = [...formStops];
    const [moved] = copy.splice(index, 1);
    copy.splice(target, 0, moved);
    setFormStops(
      copy.map((s, idx) => ({
        ...s,
        stopIndex: idx + 1,
        order: idx + 1
      }))
    );
  };

  const handleAddTimeSlot = () => {
    if (!newSlotInput || timeSlots.includes(newSlotInput)) return;
    setTimeSlots([...timeSlots, newSlotInput].sort());
    setNewSlotInput('');
  };

  const handleRemoveTimeSlot = (slot: string) => {
    setTimeSlots(timeSlots.filter((s) => s !== slot));
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 1. Normalize destination coordinates
    const [dLat, dLng] = normalizeLatLng(
      destinationLat || client.lat,
      destinationLng || client.lng,
      19.1287852,
      72.8294183
    );

    // 2. Exact requested Route Save Payload Structure:
    // When "Save Route" is clicked, guarantee each stop in stops[] includes parsed numbers
    const processedStops: RouteStop[] = formStops.map((stop, index) => ({
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

    const finalRoute: Route = {
      id: `route_${Date.now()}`,
      clientId: client.id,
      name: name.trim(),
      description: description.trim(),
      destinationLab: {
        id: `dest_${Date.now()}`,
        name: destinationName.trim(),
        address: destinationAddress.trim(),
        lat: Number(dLat),
        lng: Number(dLng),
        contactPerson: destinationContact.trim(),
        phone: destinationPhone.trim()
      },
      stops: processedStops,
      timeSlots: timeSlots,
      active: true
    };

    await onSaveRoute(finalRoute);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-fadeIn">
      <div className="w-full max-w-3xl bg-white border border-slate-200 rounded-2xl shadow-2xl space-y-4 my-6 max-h-[92vh] overflow-y-auto p-5 sm:p-6">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="font-bold text-slate-900 text-base sm:text-lg flex items-center gap-2">
              <Compass className="w-5 h-5 text-sky-700" />
              <span>Add Collection Route for {client.name}</span>
            </h3>
            <p className="text-xs text-slate-500">
              Configure collection stops, explicit GPS coordinates, time slots, and final destination handover.
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
          {/* Route Basic Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                Route Name *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Western Suburbs Specimen Loop"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-semibold focus:bg-white focus:border-sky-700"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                Route Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Daily fixed-schedule cold-chain specimen intake"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 text-xs focus:bg-white focus:border-sky-700"
              />
            </div>
          </div>

          {/* Time Slots */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
            <label className="block text-[10px] font-bold text-slate-600 uppercase flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-sky-700" />
              <span>Fixed Daily Pickup Schedule Time Slots:</span>
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {timeSlots.map((slot) => (
                <span
                  key={slot}
                  className="bg-white border border-slate-300 text-slate-800 font-mono font-bold px-2.5 py-1 rounded-md flex items-center gap-1 shadow-2xs"
                >
                  <Clock className="w-3 h-3 text-sky-700" />
                  <span>{slot}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveTimeSlot(slot)}
                    className="text-slate-400 hover:text-rose-600 ml-1 cursor-pointer"
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
                className="px-2.5 py-1 bg-white border border-slate-300 rounded-md text-slate-900 font-mono text-xs"
              />
              <button
                type="button"
                onClick={handleAddTimeSlot}
                className="px-3 py-1 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded-md cursor-pointer"
              >
                + Add Time Slot
              </button>
            </div>
          </div>

          {/* Dynamic Stops Header & Add Button */}
          <div className="space-y-3">
            <div className="flex items-center justify-between pt-1">
              <div>
                <label className="block text-xs font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-sky-700" />
                  <span>HOSPITAL / LAB COLLECTION STOPS ({formStops.length})</span>
                </label>
                <p className="text-[11px] text-slate-500">
                  Each stop includes verified Latitude, Longitude, and estimated duration.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddStop}
                className="px-3 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-700 font-bold rounded-lg border border-sky-200 flex items-center gap-1.5 shadow-2xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Stop</span>
              </button>
            </div>

            {/* Dynamic Stop Cards */}
            <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
              {formStops.map((stop, idx) => (
                <RouteStopItem
                  key={stop.id || idx}
                  stop={stop}
                  index={idx}
                  totalStops={formStops.length}
                  onChange={(updated) => handleUpdateStop(idx, updated)}
                  onRemove={() => handleRemoveStop(idx)}
                  onMoveUp={() => handleMoveStop(idx, 'up')}
                  onMoveDown={() => handleMoveStop(idx, 'down')}
                  canRemove={formStops.length > 1}
                />
              ))}
            </div>
          </div>

          {/* Destination Lab Handover Point (Carries Client Lab Coordinates) */}
          <div className="p-3.5 bg-emerald-50/80 border border-emerald-200 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-emerald-900 uppercase flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-emerald-700" />
                <span>Destination Lab Handover Point</span>
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
                  <span>{isGeocodingDest ? 'Geocoding...' : 'Pin Coordinates from Lab Address'}</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[10px] font-bold text-emerald-800 uppercase mb-0.5">
                  Lab Name *
                </label>
                <input
                  type="text"
                  required
                  value={destinationName}
                  onChange={(e) => setDestinationName(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white border border-emerald-300 rounded-lg text-slate-900 font-semibold text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-emerald-800 uppercase mb-0.5">
                  Lab Address *
                </label>
                <input
                  type="text"
                  required
                  value={destinationAddress}
                  onChange={(e) => setDestinationAddress(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white border border-emerald-300 rounded-lg text-slate-900 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-2 bg-white rounded-lg border border-emerald-200">
              <div>
                <label className="block text-[10px] font-bold text-emerald-800 uppercase mb-0.5 flex items-center gap-1">
                  <Navigation className="w-3 h-3 text-emerald-700" />
                  <span>Destination Lab Latitude</span>
                </label>
                <input
                  type="number"
                  step="any"
                  placeholder="19.1287852"
                  value={destinationLat}
                  onChange={(e) => setDestinationLat(parseFloat(e.target.value) || 0)}
                  className="w-full px-2.5 py-1 bg-emerald-50/50 border border-emerald-300 rounded-md text-slate-900 font-mono text-xs font-bold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-emerald-800 uppercase mb-0.5 flex items-center gap-1">
                  <Navigation className="w-3 h-3 text-emerald-700" />
                  <span>Destination Lab Longitude</span>
                </label>
                <input
                  type="number"
                  step="any"
                  placeholder="72.8294183"
                  value={destinationLng}
                  onChange={(e) => setDestinationLng(parseFloat(e.target.value) || 0)}
                  className="w-full px-2.5 py-1 bg-emerald-50/50 border border-emerald-300 rounded-md text-slate-900 font-mono text-xs font-bold"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <input
                type="text"
                placeholder="Lab Intake In-Charge / Contact Person"
                value={destinationContact}
                onChange={(e) => setDestinationContact(e.target.value)}
                className="px-2.5 py-1.5 bg-white border border-emerald-300 rounded-lg text-slate-800 text-xs"
              />
              <input
                type="text"
                placeholder="Lab Phone Number"
                value={destinationPhone}
                onChange={(e) => setDestinationPhone(e.target.value)}
                className="px-2.5 py-1.5 bg-white border border-emerald-300 rounded-lg text-slate-800 font-mono text-xs"
              />
            </div>
          </div>

          {/* Modal Footer */}
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
              <span>Save Route</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
