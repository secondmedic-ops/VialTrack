import React, { useState, useMemo } from 'react';
import { PickupTask, Route } from '../../types';
import {
  Clock,
  MapPin,
  PhoneCall,
  Navigation,
  Camera,
  CheckCircle2,
  AlertCircle,
  Building2,
  ChevronRight,
  ShieldCheck,
  Thermometer,
  Package,
  Layers,
  Sparkles,
  Search,
  Filter,
  Check,
  Send,
  Building,
  Lock,
  ArrowRight,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { formatTimeLabel } from '../../utils/timeSlots';

export interface ScheduleStopItem {
  id: string;
  uniqueKey: string;
  stopNumber: number;
  stopName: string;
  address: string;
  lat: number;
  lng: number;
  timeSlot: string;
  /** Scheduled pickup time for this specific stop ("HH:mm"); falls back to the round slot. */
  pickupTime?: string;
  contactPerson: string;
  phone: string;
  status: 'pending' | 'in_transit' | 'collected';
  vialCount?: number;
  coldBoxTemp?: number;
  photoUrl?: string;
  photo2Url?: string;
  selfieUrl?: string;
  taskId?: string;
  task?: PickupTask;
  routeId: string;
  routeName: string;
  clientId: string;
  clientName: string;
  stopIndex: number;
  order: number;
}

interface DailyRoundsScheduleProps {
  scheduleStops: ScheduleStopItem[];
  assignedRoutes: Route[];
  activeTaskId?: string | null;
  onStartCollection: (stop: ScheduleStopItem) => void;
  onOpenProofModal: (task: PickupTask) => void;
  onSelectTask?: (taskId: string) => void;
  onStartDrop?: (task: PickupTask | undefined, route: Route, slot: string) => void;
}

// Parse slot string (e.g. "10:00", "14:00", "10:00 AM - 12:00 PM") to total minutes from midnight
const parseSlotToMinutes = (slot: string): number => {
  if (!slot) return 0;
  const match = slot.match(/(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
  if (!match) return 0;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
};

export const DailyRoundsSchedule: React.FC<DailyRoundsScheduleProps> = ({
  scheduleStops,
  assignedRoutes,
  activeTaskId,
  onStartCollection,
  onOpenProofModal,
  onSelectTask,
  onStartDrop
}) => {
  const [selectedRouteFilter, setSelectedRouteFilter] = useState<string>('all');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<'all' | 'pending' | 'in_transit' | 'collected'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showCompletedAccordion, setShowCompletedAccordion] = useState<boolean>(true);

  // Extract unique routes present in assigned stops
  const uniqueRouteNames = useMemo(() => {
    const names = new Set<string>();
    (scheduleStops || []).forEach((s) => {
      if (s?.routeName) names.add(s.routeName);
    });
    return Array.from(names);
  }, [scheduleStops]);

  // Counts for status tabs
  const counts = useMemo(() => {
    const safe = scheduleStops || [];
    return {
      all: safe.length,
      pending: safe.filter((s) => s?.status === 'pending').length,
      in_transit: safe.filter((s) => s?.status === 'in_transit').length,
      collected: safe.filter((s) => s?.status === 'collected').length
    };
  }, [scheduleStops]);

  // Filtered stops
  const filteredStops = useMemo(() => {
    return (scheduleStops || []).filter((stop) => {
      if (!stop) return false;
      // Route filter
      if (selectedRouteFilter !== 'all' && stop.routeName !== selectedRouteFilter && stop.routeId !== selectedRouteFilter) {
        return false;
      }
      // Status filter
      if (selectedStatusFilter !== 'all' && stop.status !== selectedStatusFilter) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = (stop.stopName || '').toLowerCase().includes(q);
        const matchAddr = (stop.address || '').toLowerCase().includes(q);
        const matchContact = (stop.contactPerson || '').toLowerCase().includes(q);
        const matchRoute = (stop.routeName || '').toLowerCase().includes(q);
        const matchClient = (stop.clientName || '').toLowerCase().includes(q);
        if (!matchName && !matchAddr && !matchContact && !matchRoute && !matchClient) {
          return false;
        }
      }
      return true;
    });
  }, [scheduleStops, selectedRouteFilter, selectedStatusFilter, searchQuery]);

  // Group stops by (Route + Time Slot) and sort chronologically
  const slotGroups = useMemo(() => {
    const groupsMap = new Map<string, {
      key: string;
      routeId: string;
      routeName: string;
      timeSlot: string;
      clientName: string;
      route?: Route;
      stops: ScheduleStopItem[];
      matchedTask?: PickupTask;
    }>();

    filteredStops.forEach((stop) => {
      const groupKey = `${stop.routeId || stop.routeName}-${stop.timeSlot}`;
      if (!groupsMap.has(groupKey)) {
        const routeObj = (assignedRoutes || []).find((r) => r.id === stop.routeId || r.name === stop.routeName);
        groupsMap.set(groupKey, {
          key: groupKey,
          routeId: stop.routeId,
          routeName: stop.routeName,
          timeSlot: stop.timeSlot,
          clientName: stop.clientName,
          route: routeObj,
          stops: [],
          matchedTask: stop.task
        });
      }
      const group = groupsMap.get(groupKey)!;
      group.stops.push(stop);
      if (stop.task && !group.matchedTask) {
        group.matchedTask = stop.task;
      }
    });

    const list = Array.from(groupsMap.values());
    // Sort chronologically by timeSlot
    list.sort((a, b) => parseSlotToMinutes(a.timeSlot) - parseSlotToMinutes(b.timeSlot));
    return list;
  }, [filteredStops, assignedRoutes]);

  // Identify the ONE active round, plus completed and queued rounds.
  //
  // This used to be computed per route: each route independently marked its own first
  // non-delivered slot as "active", so a rider assigned to two routes saw two rounds active at
  // once and could start both — which is impossible on one bike and corrupts the sequence. A
  // rider can only ever be working a single round, so exactly one group is active GLOBALLY,
  // across every route and slot, and everything else that isn't delivered is queued behind it.
  const annotatedGroups = useMemo(() => {
    const isGroupDelivered = (g: (typeof slotGroups)[number]) =>
      g.matchedTask?.status === 'delivered' ||
      g.matchedTask?.status === 'completed' ||
      g.matchedTask?.destination?.status === 'delivered';

    // A round the rider has already begun (picked up / in transit) always wins the "active" slot,
    // even if an earlier slot in the day was never delivered — otherwise we would lock the rider
    // out of the round they are physically in the middle of.
    const IN_PROGRESS_STATUSES = ['started', 'at_stop', 'in_transit', 'picked_up', 'in_progress', 'delayed'];
    const isGroupInProgress = (g: (typeof slotGroups)[number]) =>
      !isGroupDelivered(g) &&
      (IN_PROGRESS_STATUSES.includes(String(g.matchedTask?.status || '')) ||
        g.stops.some((s) => s.status === 'in_transit' || s.status === 'collected'));

    // slotGroups is already sorted chronologically across all routes.
    const openGroups = slotGroups.filter((g) => !isGroupDelivered(g));
    const activeGroup = openGroups.find((g) => isGroupInProgress(g)) || openGroups[0];
    const activeKey = activeGroup?.key;

    // Kept for the per-route position labels shown on each round card.
    const routeToGroups = new Map<string, typeof slotGroups>();
    slotGroups.forEach((g) => {
      const rId = g.routeId || g.routeName;
      if (!routeToGroups.has(rId)) routeToGroups.set(rId, []);
      routeToGroups.get(rId)!.push(g);
    });

    return slotGroups.map((group) => {
      const rId = group.routeId || group.routeName;
      const groupsForRoute = routeToGroups.get(rId) || [group];
      const groupIndexInRoute = groupsForRoute.findIndex((g) => g.key === group.key);

      let roundState: 'completed' | 'active' | 'queued' = 'queued';
      let prevSlotName = '';

      if (isGroupDelivered(group)) {
        roundState = 'completed';
      } else if (group.key === activeKey) {
        roundState = 'active';
      } else {
        roundState = 'queued';
        // Whatever is blocking this round is the single active round, whichever route it belongs to.
        prevSlotName = activeGroup
          ? `${activeGroup.timeSlot}${
              activeGroup.routeName && activeGroup.routeName !== group.routeName
                ? ` (${activeGroup.routeName})`
                : ''
            }`
          : groupsForRoute[groupIndexInRoute - 1]?.timeSlot || '';
      }

      return {
        ...group,
        roundState,
        groupIndexInRoute,
        totalInRoute: groupsForRoute.length,
        prevSlotName
      };
    });
  }, [slotGroups]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-700 shrink-0 shadow-2xs">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-sm sm:text-base flex items-center gap-2">
              <span>My Daily Rounds Schedule</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 border border-sky-200 font-mono">
                {annotatedGroups.length} Scheduled Rounds
              </span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Sequential dispatch: Complete pickup stops & drop at client lab to unlock the next scheduled round
            </p>
          </div>
        </div>

        {/* Status Counts Pill Summary.
            A wrapping flex row left these four chips at four different widths across two ragged
            lines on a phone. A 2x2 grid keeps them even and gives each a full tap target. */}
        <div className="grid grid-cols-2 sm:flex sm:items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedStatusFilter('all')}
            className={`px-2.5 py-2 sm:py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer justify-center sm:justify-start flex items-center ${
              selectedStatusFilter === 'all'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All Stops ({counts.all})
          </button>
          <button
            type="button"
            onClick={() => setSelectedStatusFilter('pending')}
            className={`px-2.5 py-2 sm:py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center justify-center sm:justify-start gap-1 ${
              selectedStatusFilter === 'pending'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
            }`}
          >
            <span>Pending</span>
            <span className="font-mono text-[11px]">({counts.pending})</span>
          </button>
          <button
            type="button"
            onClick={() => setSelectedStatusFilter('in_transit')}
            className={`px-2.5 py-2 sm:py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center justify-center sm:justify-start gap-1 ${
              selectedStatusFilter === 'in_transit'
                ? 'bg-sky-700 text-white shadow-xs'
                : 'bg-sky-50 text-sky-800 hover:bg-sky-100 border border-sky-200'
            }`}
          >
            <span>In-Transit</span>
            <span className="font-mono text-[11px]">({counts.in_transit})</span>
          </button>
          <button
            type="button"
            onClick={() => setSelectedStatusFilter('collected')}
            className={`px-2.5 py-2 sm:py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center justify-center sm:justify-start gap-1 ${
              selectedStatusFilter === 'collected'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200'
            }`}
          >
            <span>Collected</span>
            <span className="font-mono text-[11px]">({counts.collected})</span>
          </button>
        </div>
      </div>

      {/* Sequential Round Progression Timeline Bar */}
      {annotatedGroups.length > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 sm:p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-slate-700 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-sky-600" />
              <span>Today's Round Timeline & Progression</span>
            </span>
            <span className="text-slate-500 font-medium text-[11px]">
              {annotatedGroups.filter(g => g.roundState === 'completed').length} / {annotatedGroups.length} Handover Cycles Finished
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
            {annotatedGroups.map((g, idx) => {
              const isCompleted = g.roundState === 'completed';
              const isActive = g.roundState === 'active';
              const isQueued = g.roundState === 'queued';

              return (
                <div
                  key={g.key}
                  className={`p-2.5 rounded-lg border text-xs transition-all ${
                    isActive
                      ? 'bg-sky-50 border-sky-300 ring-2 ring-sky-400 shadow-xs'
                      : isCompleted
                      ? 'bg-emerald-50/80 border-emerald-300'
                      : 'bg-white border-slate-200 text-slate-400 opacity-80'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono font-bold text-slate-900 text-[11px]">
                      {g.timeSlot}
                    </span>
                    {isCompleted && (
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.2 rounded flex items-center gap-0.5">
                        <Check className="w-2.5 h-2.5" /> Done
                      </span>
                    )}
                    {isActive && (
                      <span className="text-[10px] font-bold text-sky-800 bg-sky-200 px-1.5 py-0.2 rounded animate-pulse">
                        Active
                      </span>
                    )}
                    {isQueued && (
                      <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded flex items-center gap-0.5">
                        <Lock className="w-2.5 h-2.5 text-slate-400" /> Queued
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 truncate mt-1">
                    {g.routeName}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filter / Search Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
        {/* Search Input */}
        <div className="sm:col-span-6 relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search stop name, hospital, address, or contact..."
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:border-sky-600 focus:bg-white transition-all"
          />
        </div>

        {/* Route Filter Dropdown */}
        <div className="sm:col-span-6 flex items-center gap-2">
          <div className="relative flex-1">
            <Layers className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select
              value={selectedRouteFilter}
              onChange={(e) => setSelectedRouteFilter(e.target.value)}
              className="w-full pl-9 pr-8 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-medium focus:outline-hidden focus:border-sky-600 focus:bg-white transition-all appearance-none cursor-pointer"
            >
              <option value="all">All Assigned Loops & Routes ({uniqueRouteNames.length})</option>
              {uniqueRouteNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Empty State */}
      {annotatedGroups.length === 0 && (
        <div className="py-12 px-4 text-center border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50 space-y-3">
          <div className="w-12 h-12 mx-auto rounded-full bg-slate-100 text-slate-400 flex items-center justify-center">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <h4 className="font-bold text-slate-800 text-sm">No Assigned Stops Found</h4>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              {searchQuery || selectedRouteFilter !== 'all' || selectedStatusFilter !== 'all'
                ? 'No stops match the selected filter criteria. Try resetting filters.'
                : 'No active collection stops are currently assigned to your rider profile. Check with Central Dispatch.'}
            </p>
          </div>
          {(searchQuery || selectedRouteFilter !== 'all' || selectedStatusFilter !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSelectedRouteFilter('all');
                setSelectedStatusFilter('all');
              }}
              className="px-3 py-1.5 bg-white hover:bg-slate-100 text-sky-700 border border-slate-200 rounded-lg font-bold text-xs shadow-2xs cursor-pointer"
            >
              Reset Filters
            </button>
          )}
        </div>
      )}

      {/* Structured Rounds List Grouped by Route Run & Time Slot */}
      <div className="space-y-6">
        {annotatedGroups.map((group) => {
          const routeObj = group.route;
          const destLab = routeObj?.destinationLab || {
            id: 'dest-lab',
            name: group.clientName || 'Lifecare lab',
            address: 'Central Diagnostic Processing Facility, Mumbai',
            lat: 19.1287,
            lng: 72.8294,
            contactPerson: 'Jayesh joshi',
            phone: '9096970015'
          };

          const matchedTask = group.matchedTask;
          const isDelivered = group.roundState === 'completed';
          const isActive = group.roundState === 'active';
          const isQueued = group.roundState === 'queued';
          const allStopsCollected = group.stops.every((s) => s.status === 'collected');
          const totalVialsInRun = group.stops.reduce((sum, s) => sum + Number(s.vialCount || 0), 0);
          const cleanDestPhone = (destLab.phone || '').replace(/\D/g, '');

          // If this round is queued (future route), render the clean locked card
          if (isQueued) {
            return (
              <div
                key={group.key}
                className="border-2 border-dashed border-slate-300 rounded-xl bg-slate-50/60 p-4 space-y-3 opacity-90 transition-all"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-md font-mono font-bold text-xs bg-slate-200 text-slate-700 border border-slate-300 flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-slate-500" />
                      <span>Slot: {group.timeSlot}</span>
                    </span>
                    <h4 className="font-bold text-slate-700 text-xs sm:text-sm flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-slate-400" />
                      <span>{group.routeName}</span>
                    </h4>
                  </div>

                  <span className="text-[11px] font-bold text-slate-600 bg-slate-200 px-2.5 py-1 rounded-full flex items-center gap-1.5 self-start sm:self-auto">
                    <Lock className="w-3 h-3 text-slate-500" />
                    <span>Unlocks after {group.prevSlotName || 'previous'} handover to {destLab.name} is complete</span>
                  </span>
                </div>

                <div className="p-3 bg-white border border-slate-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-600">
                  <div className="space-y-1">
                    <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                      <Package className="w-3.5 h-3.5 text-slate-500" />
                      <span>{group.stops.length} Collection Stops Queued for {group.timeSlot}:</span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {group.stops.map((s, idx) => `Stop ${idx + 1}: ${s.stopName}`).join(' → ')} → Drop Destination: <strong>{destLab.name}</strong>
                    </p>
                  </div>

                  <div className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-md flex items-center gap-1.5 shrink-0">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>Pending current round completion</span>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div
              key={group.key}
              className={`border rounded-xl p-3 sm:p-4.5 space-y-3.5 shadow-2xs transition-all ${
                isActive
                  ? 'border-sky-300 bg-white ring-2 ring-sky-200/60 shadow-sm'
                  : 'border-slate-200 bg-slate-50/50'
              }`}
            >
              {/* Slot Run Header */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-200">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2.5 py-1 rounded-md font-mono font-bold text-xs flex items-center gap-1.5 shadow-2xs ${
                      isActive
                        ? 'bg-sky-600 text-white'
                        : isDelivered
                        ? 'bg-emerald-700 text-white'
                        : 'bg-slate-800 text-white'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>Slot: {group.timeSlot}</span>
                  </span>
                  <h4 className="font-bold text-slate-900 text-xs sm:text-sm flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-slate-500" />
                    <span>{group.routeName}</span>
                  </h4>
                  {isActive && (
                    <span className="text-[10px] font-bold text-sky-800 bg-sky-100 border border-sky-300 px-2 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
                      ● Active Round
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-500 font-medium">
                    {group.stops.filter((s) => s.status === 'collected').length} / {group.stops.length} Pickups Done
                  </span>
                  {isDelivered && (
                    <span className="bg-emerald-100 text-emerald-900 border border-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Round Delivered
                    </span>
                  )}
                </div>
              </div>

              {/* Sequential Ordered Stops for this Slot */}
              <div className="space-y-3">
                {group.stops.map((stop, stopIdx) => {
                  const isCollected = stop.status === 'collected';
                  const isInTransit = stop.status === 'in_transit';
                  const isPending = stop.status === 'pending';

                  // SEQUENTIAL STOPS. Every stop in a round used to offer "Start Pickup" at once,
                  // so a rider could capture stop 3 while standing at stop 1 -- the collection
                  // order in the chain-of-custody record would then not match the actual route.
                  // A stop unlocks only when every stop before it is dealt with.
                  const earlierOutstanding = group.stops
                    .slice(0, stopIdx)
                    .filter((s) => s.status !== 'collected' && String(s.status) !== 'no_sample');
                  const isStopLocked = !isCollected && earlierOutstanding.length > 0;
                  const cleanPhone = (stop.phone || '').replace(/\D/g, '');

                  return (
                    <div
                      key={stop.uniqueKey}
                      data-locked={isStopLocked ? 'true' : 'false'}
                      className={`rounded-xl border transition-all shadow-xs overflow-hidden ${
                        isCollected
                          ? 'bg-emerald-50/30 border-emerald-200'
                          : isInTransit
                          ? 'bg-sky-50/40 border-sky-300 ring-1 ring-sky-300/40'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {/* Card Header */}
                      <div className="p-3 sm:p-3.5 pb-2 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded-md font-bold text-xs flex items-center gap-1 shadow-2xs ${
                              isCollected
                                ? 'bg-emerald-700 text-white'
                                : isInTransit
                                ? 'bg-sky-700 text-white'
                                : 'bg-slate-800 text-white'
                            }`}
                          >
                            {isCollected ? <CheckCircle2 className="w-3.5 h-3.5" /> : null}
                            <span>Stop {stop.stopNumber}</span>
                          </span>

                          <span className="font-bold text-slate-900 text-xs sm:text-sm truncate">
                            {stop.stopName}
                          </span>

                          {stop.pickupTime && (
                            <span className="px-1.5 py-0.5 text-[10px] font-bold font-mono rounded border bg-sky-50 text-sky-800 border-sky-200 flex items-center gap-1 shrink-0">
                              <Clock className="w-2.5 h-2.5 text-sky-700" />
                              {formatTimeLabel(stop.pickupTime)}
                            </span>
                          )}
                        </div>

                        <div>
                          {isCollected && (
                            <span className="px-2 py-0.5 text-[11px] font-bold rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-700" />
                              <span>Collected</span>
                            </span>
                          )}
                          {isInTransit && (
                            <span className="px-2 py-0.5 text-[11px] font-bold rounded-full bg-sky-100 text-sky-900 border border-sky-300 flex items-center gap-1">
                              <Navigation className="w-3 h-3 text-sky-600 animate-pulse" />
                              <span>In-Transit</span>
                            </span>
                          )}
                          {isPending && (
                            <span className="px-2 py-0.5 text-[11px] font-bold rounded-full bg-amber-50 text-amber-900 border border-amber-300 flex items-center gap-1">
                              <Clock className="w-3 h-3 text-amber-600" />
                              <span>Pending Pickup</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Card Body */}
                      <div className="p-3 sm:p-3.5 space-y-2.5">
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5">
                          <div className="space-y-0.5">
                            <p className="text-xs text-slate-600 flex items-start gap-1.5 leading-relaxed">
                              <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                              <span>{stop.address}</span>
                            </p>
                            <p className="text-[11px] text-slate-500">
                              Contact: <span className="font-semibold text-slate-700">{stop.contactPerson || 'Lab Desk'}</span> • {stop.phone || 'No phone'}
                            </p>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            {stop.phone && (
                              <a
                                href={`tel:${cleanPhone}`}
                                className="py-1 px-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-md border border-emerald-200 font-bold text-xs flex items-center gap-1"
                              >
                                <PhoneCall className="w-3 h-3 text-emerald-700" />
                                <span>Call</span>
                              </a>
                            )}
                            <a
                              href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stop.address)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="py-1 px-2.5 bg-sky-50 hover:bg-sky-100 text-sky-800 rounded-md border border-sky-200 font-bold text-xs flex items-center gap-1"
                            >
                              <Navigation className="w-3 h-3 text-sky-700" />
                              <span>Navigate</span>
                            </a>
                          </div>
                        </div>

                        {/* Bottom Row */}
                        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                          <div className="text-xs">
                            {isCollected ? (
                              <div className="flex items-center gap-2 text-emerald-800 font-medium">
                                <span className="font-bold flex items-center gap-1">
                                  <Package className="w-3.5 h-3.5 text-emerald-600" />
                                  <span>{stop.vialCount ?? 0} Vials</span>
                                </span>
                                {stop.coldBoxTemp !== undefined && (
                                  <span className="font-mono text-[11px] text-slate-600 flex items-center gap-1">
                                    <Thermometer className="w-3 h-3 text-sky-600" />
                                    <span>{stop.coldBoxTemp}°C</span>
                                  </span>
                                )}
                                <span className="text-[11px] text-emerald-700 font-bold">✓ 2-Photo Proof</span>
                              </div>
                            ) : (
                              <span className="text-slate-500 text-xs flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5 text-amber-600" />
                                <span>Awaiting Specimen Pickup</span>
                              </span>
                            )}
                          </div>

                          <div>
                            {!isCollected ? (
                              isStopLocked ? (
                                <span className="px-3 py-1.5 bg-slate-100 text-slate-500 font-bold text-xs rounded-lg border border-slate-200 flex items-center gap-1.5">
                                  <Lock className="w-3.5 h-3.5 text-slate-400" />
                                  <span>Complete Stop {stopIdx} first</span>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => onStartCollection(stop)}
                                  className="px-3 py-1.5 bg-sky-700 hover:bg-sky-800 text-white font-bold text-xs rounded-lg shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                                >
                                  <Camera className="w-3.5 h-3.5" />
                                  <span>Start Pickup / 2-Photo Proof</span>
                                </button>
                              )
                            ) : (
                              <div className="flex items-center gap-1.5">
                                {stop.task && (
                                  <button
                                    type="button"
                                    onClick={() => onOpenProofModal(stop.task!)}
                                    className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold text-xs rounded-lg flex items-center gap-1.5 shadow-2xs cursor-pointer transition-all active:scale-98"
                                  >
                                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
                                    <span>View Proof</span>
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* MANDATORY STEP 3: Final Client Lab Handover & Delivery */}
              <div
                className={`rounded-xl border-2 p-3.5 sm:p-4 space-y-3 transition-all ${
                  isDelivered
                    ? 'bg-emerald-50/60 border-emerald-300'
                    : allStopsCollected
                    ? 'bg-emerald-50/40 border-emerald-400 ring-2 ring-emerald-300/50 animate-pulse-subtle'
                    : 'bg-white border-dashed border-slate-300'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md font-bold text-xs bg-emerald-800 text-white flex items-center gap-1 shadow-2xs">
                        <Building className="w-3.5 h-3.5" />
                        <span>FINAL STEP: Client Lab Delivery</span>
                      </span>
                      {isDelivered && (
                        <span className="px-2 py-0.5 bg-emerald-200 text-emerald-950 font-bold text-[10px] rounded-full border border-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-800" />
                          <span>Delivered to Client</span>
                        </span>
                      )}
                    </div>

                    <h4 className="font-bold text-slate-900 text-sm sm:text-base mt-1 flex items-center gap-1.5">
                      <span>{destLab.name}</span>
                      <span className="text-xs font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-200">
                        Drop Destination
                      </span>
                    </h4>

                    <p className="text-xs text-slate-600 flex items-start gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                      <span>{destLab.address}</span>
                    </p>

                    <div className="text-xs text-slate-700 pt-0.5">
                      Client Contact / Receiver: <span className="font-bold text-slate-900">{destLab.contactPerson || 'Jayesh joshi'}</span>
                      {destLab.phone && <span className="font-mono text-slate-600"> ({destLab.phone})</span>}
                    </div>
                  </div>

                  {/* Contact & Map Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {destLab.phone && (
                      <a
                        href={`tel:${cleanDestPhone}`}
                        className="py-1.5 px-2.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-900 rounded-md border border-emerald-300 font-bold text-xs flex items-center gap-1 shadow-2xs"
                        title="Call Client Lab Receiver"
                      >
                        <PhoneCall className="w-3.5 h-3.5 text-emerald-800" />
                        <span>Call {destLab.contactPerson?.split(' ')[0] || 'Lab'}</span>
                      </a>
                    )}
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destLab.address || destLab.name)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="py-1.5 px-2.5 bg-sky-50 hover:bg-sky-100 text-sky-800 rounded-md border border-sky-200 font-bold text-xs flex items-center gap-1 shadow-2xs"
                      title="Navigate to Final Client Lab"
                    >
                      <Navigation className="w-3.5 h-3.5 text-sky-700" />
                      <span>Navigate</span>
                    </a>
                  </div>
                </div>

                {/* Handover Action / Status Bar */}
                <div className="pt-2.5 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="text-xs">
                    {isDelivered ? (
                      <div className="text-emerald-900 font-medium flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                        <span>
                          <strong>{totalVialsInRun} Vials</strong> handed over & signed by{' '}
                          <strong>{matchedTask?.destination?.receiverName || matchedTask?.receiverName || destLab.contactPerson || 'Receiver'}</strong>
                        </span>
                      </div>
                    ) : allStopsCollected ? (
                      <div className="text-emerald-800 font-bold flex items-center gap-1.5">
                        <Package className="w-4 h-4 text-emerald-600" />
                        <span>All {group.stops.length} stops collected ({totalVialsInRun} total vials). Ready to drop at {destLab.name}!</span>
                      </div>
                    ) : (
                      <div className="text-slate-500 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        {/* Was hardcoded to "Stop 1 & Stop 2" regardless of how many stops the round
                            actually has, so a single-stop round told the rider to complete a stop
                            that does not exist. */}
                        <span>
                          {group.stops.length === 1
                            ? `Complete the ${group.stops[0]?.stopName || 'collection'} pickup first, then deliver here.`
                            : `Complete all ${group.stops.length} pickups first, then deliver all collected samples here.`}
                        </span>
                      </div>
                    )}
                  </div>

                  <div>
                    {!isDelivered ? (
                      /* allStopsCollected previously only changed this button's COLOUR -- the drop
                         could still be completed with nothing collected, producing a delivered
                         round whose chain-of-custody record holds no pickup proof. */
                      <button
                        type="button"
                        disabled={!allStopsCollected}
                        onClick={() => {
                          if (!allStopsCollected) return;
                          if (onStartDrop && routeObj) {
                            onStartDrop(matchedTask, routeObj, group.timeSlot);
                          }
                        }}
                        className={`w-full sm:w-auto px-4 py-3 sm:py-2 font-bold text-sm rounded-lg shadow-xs flex items-center justify-center gap-2 transition-all active:scale-98 ${
                          allStopsCollected
                            ? 'bg-emerald-700 hover:bg-emerald-800 text-white ring-2 ring-emerald-400 cursor-pointer'
                            : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        <ShieldCheck className="w-4 h-4 shrink-0" />
                        <span>Deliver Samples to {destLab.name}</span>
                      </button>
                    ) : (
                      matchedTask && (
                        <button
                          type="button"
                          onClick={() => onOpenProofModal(matchedTask)}
                          className="px-3 py-1.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-900 border border-emerald-300 font-bold text-xs rounded-lg flex items-center gap-1.5 shadow-2xs cursor-pointer"
                        >
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
                          <span>View Lab Handover Proof</span>
                        </button>
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
