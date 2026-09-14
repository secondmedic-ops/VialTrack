import React, { useState } from 'react';
import { RouteStop } from '../../types';
import { geocodeAddress } from '../../utils/geocoding';
import { formatTimeLabel, normalizeTimeValue } from '../../utils/timeSlots';
import {
  MapPin,
  Clock,
  User,
  Phone,
  Trash2,
  ArrowUp,
  ArrowDown,
  Navigation,
  CheckCircle2,
  RefreshCw,
  Sparkles
} from 'lucide-react';

interface RouteStopItemProps {
  stop: RouteStop;
  index: number;
  totalStops: number;
  onChange: (updated: Partial<RouteStop>) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canRemove?: boolean;
}

export const RouteStopItem: React.FC<RouteStopItemProps> = ({
  stop,
  index,
  totalStops,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  canRemove = true
}) => {
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeMsg, setGeocodeMsg] = useState<string | null>(null);

  const handleAutoGeocode = async () => {
    const query = stop.address?.trim() || stop.name?.trim();
    if (!query) {
      setGeocodeMsg('Enter address first');
      setTimeout(() => setGeocodeMsg(null), 2500);
      return;
    }

    setIsGeocoding(true);
    setGeocodeMsg(null);

    try {
      const res = await geocodeAddress(query, index);
      onChange({
        lat: res.lat,
        lng: res.lng
      });
      setGeocodeMsg(`Pinned: ${res.lat.toFixed(4)}, ${res.lng.toFixed(4)}`);
      setTimeout(() => setGeocodeMsg(null), 3000);
    } catch (e) {
      setGeocodeMsg('Lookup failed');
      setTimeout(() => setGeocodeMsg(null), 2500);
    } finally {
      setIsGeocoding(false);
    }
  };

  const estDuration = stop.estDurationMin ?? stop.avgPickupDurationMinutes ?? 10;
  const pickupTime = normalizeTimeValue(stop.pickupTime);

  return (
    <div className="p-3.5 bg-slate-50 hover:bg-slate-50/80 rounded-xl border border-slate-200 transition-all space-y-3 shadow-2xs">
      {/* Card Header: Stop Badge + Action Buttons */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-sky-700 text-white font-extrabold text-xs flex items-center justify-center shadow-xs">
            {index + 1}
          </span>
          <span className="font-bold text-slate-800 text-xs">
            Collection Stop #{index + 1}
          </span>
          {geocodeMsg && (
            <span className="text-[10px] bg-emerald-100 text-emerald-800 font-semibold px-2 py-0.5 rounded-md flex items-center gap-1 animate-fadeIn">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              {geocodeMsg}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {onMoveUp && (
            <button
              type="button"
              disabled={index === 0}
              onClick={onMoveUp}
              className="p-1 text-slate-500 hover:text-sky-700 hover:bg-sky-50 rounded disabled:opacity-30 cursor-pointer"
              title="Move Stop Up"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
          )}
          {onMoveDown && (
            <button
              type="button"
              disabled={index === totalStops - 1}
              onClick={onMoveDown}
              className="p-1 text-slate-500 hover:text-sky-700 hover:bg-sky-50 rounded disabled:opacity-30 cursor-pointer"
              title="Move Stop Down"
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
          )}
          {canRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded cursor-pointer ml-1"
              title="Remove Stop"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Row 1: Hospital Name & Address */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div>
          <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
            Hospital / Clinic Stop Name *
          </label>
          <input
            type="text"
            required
            placeholder="e.g. Oscar Hospital (Kandivali West)"
            value={stop.name || ''}
            onChange={(e) => onChange({ name: e.target.value })}
            className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-900 font-semibold text-xs focus:ring-1 focus:ring-sky-600 focus:border-sky-600"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-[10px] font-bold text-slate-600 uppercase">
              Full Address *
            </label>
            <button
              type="button"
              onClick={handleAutoGeocode}
              disabled={isGeocoding}
              className="text-[10px] text-sky-700 hover:text-sky-900 font-bold flex items-center gap-1 cursor-pointer bg-sky-50 hover:bg-sky-100 px-2 py-0.5 rounded border border-sky-200"
              title="Auto-fetch and pin coordinates based on this address"
            >
              {isGeocoding ? (
                <RefreshCw className="w-2.5 h-2.5 animate-spin" />
              ) : (
                <Sparkles className="w-2.5 h-2.5" />
              )}
              <span>{isGeocoding ? 'Geocoding...' : 'Pin Coordinates from Address'}</span>
            </button>
          </div>
          <input
            type="text"
            required
            placeholder="e.g. Mathuradas Road, Kandivali West, Mumbai"
            value={stop.address || ''}
            onChange={(e) => onChange({ address: e.target.value })}
            className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-900 text-xs focus:ring-1 focus:ring-sky-600 focus:border-sky-600"
          />
        </div>
      </div>

      {/* Row 2: Latitude, Longitude, Pickup Time, and Est. Duration (min) */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 p-2 bg-white rounded-lg border border-slate-200">
        <div>
          <label className="block text-[10px] font-bold text-sky-800 uppercase mb-0.5 flex items-center gap-1">
            <Navigation className="w-3 h-3 text-sky-700" />
            <span>Latitude</span>
          </label>
          <input
            type="number"
            step="any"
            placeholder="e.g. 19.2082"
            value={stop.lat !== undefined && stop.lat !== null ? stop.lat : ''}
            onChange={(e) => onChange({ lat: parseFloat(e.target.value) || 0 })}
            className="w-full px-2.5 py-1 bg-slate-50 border border-slate-300 rounded-md text-slate-900 font-mono text-xs font-bold focus:bg-white focus:border-sky-600"
          />
        </div>

        <div>
          <label className="block text-[10px] font-bold text-sky-800 uppercase mb-0.5 flex items-center gap-1">
            <Navigation className="w-3 h-3 text-sky-700" />
            <span>Longitude</span>
          </label>
          <input
            type="number"
            step="any"
            placeholder="e.g. 72.8398"
            value={stop.lng !== undefined && stop.lng !== null ? stop.lng : ''}
            onChange={(e) => onChange({ lng: parseFloat(e.target.value) || 0 })}
            className="w-full px-2.5 py-1 bg-slate-50 border border-slate-300 rounded-md text-slate-900 font-mono text-xs font-bold focus:bg-white focus:border-sky-600"
          />
        </div>

        <div>
          <label className="block text-[10px] font-bold text-sky-800 uppercase mb-0.5 flex items-center gap-1">
            <Clock className="w-3 h-3 text-sky-700" />
            <span>Pickup Time</span>
          </label>
          <input
            type="time"
            value={pickupTime}
            onChange={(e) => onChange({ pickupTime: e.target.value })}
            title="Scheduled pickup time at this stop. Any custom time is allowed; leave blank to use the round's slot."
            className="w-full px-2.5 py-1 bg-slate-50 border border-slate-300 rounded-md text-slate-900 font-mono text-xs font-bold focus:bg-white focus:border-sky-600"
          />
          <span className="block text-[9px] text-slate-400 mt-0.5 font-semibold">
            {pickupTime ? formatTimeLabel(pickupTime) : 'Optional — defaults to round slot'}
          </span>
        </div>

        <div>
          <label className="block text-[10px] font-bold text-slate-700 uppercase mb-0.5 flex items-center gap-1">
            <Clock className="w-3 h-3 text-amber-600" />
            <span>Est. Duration (min)</span>
          </label>
          <input
            type="number"
            min="1"
            max="180"
            placeholder="10"
            value={estDuration}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10) || 10;
              onChange({
                estDurationMin: val,
                avgPickupDurationMinutes: val
              });
            }}
            className="w-full px-2.5 py-1 bg-slate-50 border border-slate-300 rounded-md text-slate-900 font-bold text-xs focus:bg-white focus:border-sky-600"
          />
        </div>
      </div>

      {/* Row 3: Contact Person & Phone */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div>
          <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5 flex items-center gap-1">
            <User className="w-3 h-3 text-slate-400" />
            <span>Contact Person</span>
          </label>
          <input
            type="text"
            placeholder="e.g. Sister In-charge OPD / Dr. Patil"
            value={stop.contactPerson || ''}
            onChange={(e) => onChange({ contactPerson: e.target.value })}
            className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-800 text-xs focus:ring-1 focus:ring-sky-600 focus:border-sky-600"
          />
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5 flex items-center gap-1">
            <Phone className="w-3 h-3 text-slate-400" />
            <span>Contact Phone</span>
          </label>
          <input
            type="text"
            placeholder="e.g. +91 98201 12345"
            value={stop.phone || ''}
            onChange={(e) => onChange({ phone: e.target.value })}
            className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-800 font-mono text-xs focus:ring-1 focus:ring-sky-600 focus:border-sky-600"
          />
        </div>
      </div>
    </div>
  );
};

