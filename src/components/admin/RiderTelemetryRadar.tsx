import React, { useState } from 'react';
import { PickupBoy, Route, PickupTask, AttendanceRecord } from '../../types';
import {
  Bike,
  Clock,
  MapPin,
  Phone,
  MessageSquare,
  AlertTriangle,
  CheckCircle2,
  Radio,
  Battery,
  Navigation,
  Smartphone,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  ExternalLink,
  ShieldAlert,
  ArrowRight
} from 'lucide-react';
import {
  evaluateRiderPunctuality,
  getRiderAppStatus,
  generateRiderWhatsAppAlertUrl,
  parseSlotToMinutes
} from '../../utils/riderTelemetry';
import { isRiderLocationStale } from '../../services/locationService';

interface RiderTelemetryRadarProps {
  riders: PickupBoy[];
  routes: Route[];
  tasks: PickupTask[];
  attendance?: AttendanceRecord[];
  onSelectRiderForMap?: (rider: PickupBoy) => void;
  onReassignTask?: (task: PickupTask) => void;
  onRefresh?: () => void;
}

export const RiderTelemetryRadar: React.FC<RiderTelemetryRadarProps> = ({
  riders,
  routes,
  tasks,
  attendance,
  onSelectRiderForMap,
  onReassignTask,
  onRefresh
}) => {
  const [filterMode, setFilterMode] = useState<'all' | 'needs_action' | 'online' | 'overdue'>('all');
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  // Group and evaluate all riders
  const evaluatedRiders = riders.map((rider) => {
    const punctuality = evaluateRiderPunctuality(rider, routes, attendance, tasks);
    const appStatus = getRiderAppStatus(rider);
    const isGpsStale = isRiderLocationStale(rider, 8);

    const lat = rider.currentLocation?.lat || rider.lat;
    const lng = rider.currentLocation?.lng || rider.lng;
    const speed = rider.currentLocation?.speed || rider.speed || 0;
    const accuracy = rider.currentLocation?.accuracy || rider.gpsAccuracy || 5;
    const battery = rider.batteryLevel || 88;

    // Determine if corrective action is needed
    const needsAction =
      punctuality.isOverdue ||
      punctuality.status === 'pending_upcoming' ||
      (punctuality.status !== 'no_route' && appStatus.state === 'never_opened') ||
      isGpsStale;

    return {
      rider,
      punctuality,
      appStatus,
      isGpsStale,
      hasGpsCoords: typeof lat === 'number' && typeof lng === 'number' && lat !== 0,
      lat,
      lng,
      speed,
      accuracy,
      battery,
      needsAction
    };
  });

  const overdueCount = evaluatedRiders.filter((r) => r.punctuality.isOverdue).length;
  const actionRequiredCount = evaluatedRiders.filter((r) => r.needsAction).length;
  const activeNowCount = evaluatedRiders.filter((r) => r.appStatus.state === 'active_now').length;

  const filteredRiders = evaluatedRiders.filter((item) => {
    if (filterMode === 'needs_action') return item.needsAction;
    if (filterMode === 'overdue') return item.punctuality.isOverdue;
    if (filterMode === 'online') return item.appStatus.state === 'active_now';
    return true;
  });

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden transition-all">
      {/* Header Bar */}
      <div className="p-4 sm:p-4.5 bg-slate-900 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center border border-sky-400/30 shrink-0">
            <Radio className="w-5 h-5 animate-pulse text-sky-400" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-sm sm:text-base text-white">
                Rider Telemetry, App Heartbeat & Punctuality Radar
              </h3>
              {overdueCount > 0 && (
                <span className="bg-rose-500 text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full animate-pulse">
                  {overdueCount} Overdue Punch-In
                </span>
              )}
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              Live app open heartbeat, punch-in vs route slot audit, and one-click corrective actions.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg border border-slate-700 transition-colors cursor-pointer"
              title="Refresh Telemetry"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <span>{isExpanded ? 'Hide Details' : 'View Fleet Telemetry'}</span>
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="p-4 sm:p-5 space-y-4">
          {/* Quick Filter Chips */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
            <button
              onClick={() => setFilterMode('all')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer whitespace-nowrap ${
                filterMode === 'all'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All Riders ({riders.length})
            </button>
            <button
              onClick={() => setFilterMode('needs_action')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                filterMode === 'needs_action'
                  ? 'bg-rose-700 text-white shadow-xs'
                  : 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Needs Action / Attention ({actionRequiredCount})</span>
            </button>
            <button
              onClick={() => setFilterMode('online')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                filterMode === 'online'
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>App Active Now ({activeNowCount})</span>
            </button>
            {overdueCount > 0 && (
              <button
                onClick={() => setFilterMode('overdue')}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                  filterMode === 'overdue'
                    ? 'bg-red-800 text-white shadow-xs'
                    : 'bg-red-50 text-red-800 hover:bg-red-100 border border-red-200'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Overdue Punch-Ins ({overdueCount})</span>
              </button>
            )}
          </div>

          {/* Riders Telemetry Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {filteredRiders.map(
              ({
                rider,
                punctuality,
                appStatus,
                isGpsStale,
                hasGpsCoords,
                lat,
                lng,
                speed,
                accuracy,
                battery,
                needsAction
              }) => {
                const whatsappUrl = generateRiderWhatsAppAlertUrl(
                  rider,
                  punctuality.isOverdue ? 'overdue_alert' : 'punch_in_reminder',
                  punctuality.routeName,
                  punctuality.firstSlot
                );

                return (
                  <div
                    key={rider.id}
                    className={`rounded-xl p-4 border transition-all flex flex-col justify-between space-y-3.5 shadow-xs ${
                      punctuality.isOverdue
                        ? 'bg-red-50/70 border-red-300 ring-1 ring-red-300'
                        : needsAction
                        ? 'bg-amber-50/50 border-amber-200'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div>
                      {/* Top Rider Info & Badges */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          {rider.photoUrl ? (
                            <img
                              src={rider.photoUrl}
                              alt={rider.name}
                              className="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-lg bg-sky-100 text-sky-800 font-bold flex items-center justify-center text-xs shrink-0 border border-sky-200">
                              {rider.name.charAt(0)}
                            </div>
                          )}
                          <div>
                            <h4 className="font-bold text-slate-900 text-xs sm:text-sm flex items-center gap-1.5">
                              <span>{rider.name}</span>
                            </h4>
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono">
                              <span>{rider.vehicleNumber || 'No Plate'}</span>
                              <span>•</span>
                              <span>{rider.phone}</span>
                            </div>
                          </div>
                        </div>

                        {/* App Open State Badge */}
                        <div className="flex flex-col items-end gap-1">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${appStatus.badgeClass}`}>
                            {appStatus.label}
                          </span>
                        </div>
                      </div>

                      {/* 1. Punch-in vs Route Slot Status */}
                      <div className="mt-3 p-2.5 rounded-lg bg-white/90 border border-slate-200 space-y-1.5 text-xs">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-500 font-semibold flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-sky-700" />
                            <span>1st Route Slot:</span>
                          </span>
                          <span className="font-bold text-slate-800 font-mono">
                            {punctuality.firstSlot || 'No scheduled slot'}
                          </span>
                        </div>

                        <div className="pt-1 border-t border-slate-100 flex items-center justify-between">
                          <span className="text-[11px] text-slate-500 font-semibold">Punctuality:</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-md border ${punctuality.badgeClass}`}>
                            {punctuality.label}
                          </span>
                        </div>
                      </div>

                      {/* 2. Real GPS Telemetry & Freshness */}
                      <div className="mt-2.5 p-2.5 rounded-lg bg-white/90 border border-slate-200 space-y-1 text-xs">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-500 font-semibold flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                            <span>GPS Telemetry:</span>
                          </span>
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${
                              isGpsStale
                                ? 'bg-amber-100 text-amber-900 border-amber-300'
                                : 'bg-emerald-100 text-emerald-900 border-emerald-300 flex items-center gap-1'
                            }`}
                          >
                            {!isGpsStale && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>}
                            {isGpsStale ? 'GPS Stale / Signal Weak' : 'Live GPS (3s ago)'}
                          </span>
                        </div>

                        {hasGpsCoords ? (
                          <div className="text-[11px] font-mono text-slate-700 flex items-center justify-between pt-0.5">
                            <span>
                              {Number(lat).toFixed(4)}, {Number(lng).toFixed(4)}
                            </span>
                            <span className="text-slate-500 text-[10px]">
                              {speed} km/h • <Battery className="w-3 h-3 inline text-slate-600" /> {battery}%
                            </span>
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-400 italic">No GPS coordinates broadcasted yet</div>
                        )}
                      </div>
                    </div>

                    {/* 3. Immediate Corrective Actions Buttons */}
                    <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between gap-1.5 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        {/* Call Rider */}
                        <a
                          href={`tel:${rider.phone}`}
                          className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-bold flex items-center gap-1 border border-slate-300 transition-colors"
                          title="Call Rider Directly"
                        >
                          <Phone className="w-3.5 h-3.5 text-sky-700" />
                          <span>Call</span>
                        </a>

                        {/* WhatsApp Alert */}
                        <a
                          href={whatsappUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-xs transition-colors"
                          title="Send Urgent WhatsApp Notice"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          <span>WhatsApp</span>
                        </a>
                      </div>

                      {/* Track on Map / Focus */}
                      {onSelectRiderForMap && (
                        <button
                          type="button"
                          onClick={() => onSelectRiderForMap(rider)}
                          className="px-2.5 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-800 rounded-lg text-xs font-bold flex items-center gap-1 border border-sky-200 transition-colors cursor-pointer"
                        >
                          <Navigation className="w-3.5 h-3.5 text-sky-700" />
                          <span>Map</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              }
            )}
          </div>
        </div>
      )}
    </div>
  );
};
