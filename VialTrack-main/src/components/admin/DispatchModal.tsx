import React, { useState, useEffect, useRef } from 'react';
import { Client, Route, PickupBoy, PickupTask } from '../../types';
import { CloudSync, formatUnifiedTask } from '../../services/firebase';
import { db } from '../../firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { StorageService } from '../../services/storage';
import { buildCanonicalTaskId } from '../../utils/taskId';
import { localDateKey } from '../../utils/timeSlots';
import { formatTimeLabel, normalizeTimeValue } from '../../utils/timeSlots';
import {
  X,
  Send,
  Building2,
  Bike,
  Route as RouteIcon,
  Clock,
  Calendar,
  Plus,
  Trash2,
  FileText,
  AlertCircle
} from 'lucide-react';

interface DispatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  clients: Client[];
  routes: Route[];
  riders: PickupBoy[];
  onDispatched: (task: PickupTask) => void;
}

export const DispatchModal: React.FC<DispatchModalProps> = ({
  isOpen,
  onClose,
  clients,
  routes,
  riders,
  onDispatched
}) => {
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [selectedRouteId, setSelectedRouteId] = useState<string>('');
  const [selectedRiderId, setSelectedRiderId] = useState<string>('');
  const [taskDate, setTaskDate] = useState<string>(() => localDateKey());
  const [taskTimeSlot, setTaskTimeSlot] = useState<string>('09:00');
  const [taskNotes, setTaskNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);


  // Editable stops for fine-tuning before dispatch
  const [customStops, setCustomStops] = useState<
    Array<{
      id: string;
      name: string;
      address: string;
      lat: number;
      lng: number;
      specimenCount: number;
      contactPerson?: string;
      phone?: string;
      pickupTime?: string;
    }>
  >([]);

  // Array of selected stop IDs for dispatch batch assignment
  const [selectedStopIds, setSelectedStopIds] = useState<string[]>([]);

  // Track previous isOpen state to only initialize when the modal transitions from closed to open
  const prevIsOpenRef = useRef(false);

  // Initialize selections ONLY when modal opens (not on background telemetry refetches)
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      const initialClient = clients[0];
      const initialClientId = initialClient?.id || '';
      setSelectedClientId(initialClientId);

      const matchingRoutes = routes.filter((r) => r.clientId === initialClientId);
      const initialRoute = matchingRoutes[0] || routes[0];
      setSelectedRouteId(initialRoute?.id || '');

      const activeRiders = riders.filter((r) => r.status === 'active' && r.isOnline !== false);
      const initialRider = activeRiders[0] || riders[0];
      setSelectedRiderId(initialRider?.id || '');

      setTaskDate(localDateKey());
      setTaskTimeSlot(normalizeTimeValue(initialRoute?.timeSlots?.[0]) || '09:00');
      setTaskNotes('');

      if (initialRoute?.stops) {
        const formattedStops = initialRoute.stops.map((s, idx) => ({
          id: s.id || `stop-${idx + 1}`,
          name: s.name || '',
          address: s.address || '',
          lat: Number(s.lat || 0),
          lng: Number(s.lng || 0),
          specimenCount: Number((s as any).specimenCount || (s as any).sampleCount || 0),
          contactPerson: s.contactPerson || '',
          phone: s.phone || '',
          pickupTime: normalizeTimeValue((s as any).pickupTime)
        }));
        setCustomStops(formattedStops);
        // Automatically select/check ALL available pickup stops in the current collection route by default
        setSelectedStopIds(formattedStops.map((s) => s.id));
      }
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen]);

  // When Rider is selected: retain existing stop counts and ensure they are assigned
  const handleRiderChange = (rId: string) => {
    setSelectedRiderId(rId);
  };

  // Update route and stops when client changes
  const handleClientChange = (cId: string) => {
    setSelectedClientId(cId);
    const matchingRoutes = routes.filter((r) => r.clientId === cId);
    const targetRoute = matchingRoutes[0] || routes[0];
    if (targetRoute) {
      setSelectedRouteId(targetRoute.id);
      if (targetRoute.stops) {
        const formattedStops = targetRoute.stops.map((s, idx) => ({
          id: s.id || `stop-${idx + 1}`,
          name: s.name || '',
          address: s.address || '',
          lat: Number(s.lat || 0),
          lng: Number(s.lng || 0),
          specimenCount: Number((s as any).specimenCount || (s as any).sampleCount || 0),
          contactPerson: s.contactPerson || '',
          phone: s.phone || '',
          pickupTime: normalizeTimeValue((s as any).pickupTime)
        }));
        setCustomStops(formattedStops);
        setSelectedStopIds(formattedStops.map((s) => s.id));
      }
    }
  };

  // Update stops when route selection changes
  const handleRouteChange = (rId: string) => {
    setSelectedRouteId(rId);
    const targetRoute = routes.find((r) => r.id === rId);
    if (targetRoute?.stops) {
      const formattedStops = targetRoute.stops.map((s, idx) => ({
        id: s.id || `stop-${idx + 1}`,
        name: s.name || '',
        address: s.address || '',
        lat: Number(s.lat || 0),
        lng: Number(s.lng || 0),
        specimenCount: Number((s as any).specimenCount || (s as any).sampleCount || 0),
        contactPerson: s.contactPerson || '',
        phone: s.phone || '',
        pickupTime: normalizeTimeValue((s as any).pickupTime)
      }));
      setCustomStops(formattedStops);
      setSelectedStopIds(formattedStops.map((s) => s.id));
      if (targetRoute.timeSlots && targetRoute.timeSlots.length > 0) {
        setTaskTimeSlot(normalizeTimeValue(targetRoute.timeSlots[0]) || targetRoute.timeSlots[0]);
      }
    }
  };

  // Per-stop scheduled pickup time (overrides the round slot for that one stop)
  const handleStopTimeChange = (stopId: string, value: string) => {
    setCustomStops((prev) =>
      prev.map((s) => (s.id === stopId ? { ...s, pickupTime: normalizeTimeValue(value) } : s))
    );
  };

  const handleStopFieldChange = (stopId: string, field: 'name' | 'address', value: string) => {
    setCustomStops((prev) => prev.map((s) => (s.id === stopId ? { ...s, [field]: value } : s)));
  };

  // Toggle individual stop selection
  const handleToggleStop = (stopId: string) => {
    setSelectedStopIds((prev) =>
      prev.includes(stopId) ? prev.filter((id) => id !== stopId) : [...prev, stopId]
    );
  };

  // Master Select All / Deselect All toggle
  const isAllSelected = customStops.length > 0 && selectedStopIds.length === customStops.length;
  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedStopIds([]);
    } else {
      setSelectedStopIds(customStops.map((s) => s.id));
    }
  };

  const handleAddStop = () => {
    const newIdx = customStops.length + 1;
    const newStopId = `stop-custom-${Date.now()}`;
    const newStop = {
      id: newStopId,
      name: '',
      address: '',
      lat: 0,
      lng: 0,
      specimenCount: 0,
      contactPerson: '',
      phone: '',
      pickupTime: ''
    };
    setCustomStops([...customStops, newStop]);
    // Automatically select the new stop by default
    setSelectedStopIds((prev) => [...prev, newStopId]);
  };

  const handleRemoveStop = (index: number) => {
    const targetStop = customStops[index];
    if (targetStop) {
      setCustomStops(customStops.filter((_, idx) => idx !== index));
      setSelectedStopIds((prev) => prev.filter((id) => id !== targetStop.id));
    }
  };

  // Metrics for selected stops
  const selectedStopsList = customStops.filter((s) => selectedStopIds.includes(s.id));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const client = clients.find((c) => c.id === selectedClientId) || clients[0];
    const route = routes.find((r) => r.id === selectedRouteId) || routes[0];
    const rider = riders.find((r) => r.id === selectedRiderId) || riders[0];

    if (!client || !rider) {
      alert('Please select both a Client Diagnostic Lab and an Assigned Rider.');
      return;
    }

    if (customStops.length === 0) {
      alert('Please configure at least one collection stop for this round.');
      return;
    }

    if (selectedStopIds.length === 0) {
      alert('Please select at least one pickup stop to assign to the rider.');
      return;
    }

    // Block dispatch when a selected stop has no coordinates, rather than silently substituting a
    // hardcoded Mumbai point (see the lat/lng mapping below).
    const unmappedStops = selectedStopsList.filter((s: any) => !Number(s.lat) || !Number(s.lng));
    if (unmappedStops.length > 0) {
      alert(
        `${unmappedStops.length} selected stop(s) have no map coordinates:\n\n` +
          unmappedStops.map((s: any) => `• ${s.name || 'Unnamed stop'}`).join('\n') +
          `\n\nOpen the route and use "Pin Coordinates from Address" for these stops before dispatching.`
      );
      return;
    }

    setIsSubmitting(true);
    // Deterministic ID (route + slot + date), NOT a random timestamp — see buildCanonicalTaskId's
    // comment. This ensures dispatching a round here lands on the exact same Firestore document a
    // rider's app would create/update for that same route+slot+day, instead of a parallel orphan.
    const taskId = buildCanonicalTaskId(route?.id, taskTimeSlot, taskDate);
    const stopsPayload = selectedStopsList.map((stop, idx) => ({
      id: stop.id,
      stopId: stop.id || `stop_${idx + 1}`,
      name: stop.name,
      stopName: stop.name,
      address: stop.address || '',
      // No hardcoded Mumbai fallback. A stop with no coordinates used to be placed silently in
      // Andheri West, so riders navigated to the wrong side of the city and the client's map
      // showed an arrival somewhere the hospital is not. Dispatch is blocked above instead.
      lat: Number(stop.lat),
      lng: Number(stop.lng),
      specimenCount: Number(stop.specimenCount || 0),
      sampleCount: Number(stop.specimenCount || 0),
      status: idx === 0 ? ('in_progress' as const) : ('pending' as const),
      assignedRiderId: rider.id,
      assignedRiderName: rider.name,
      // Never invent a contact. These defaulted to "Lab Coordinator" and a phone number belonging
      // to nobody, which a rider would then try to call from outside the hospital.
      contactPerson: stop.contactPerson || '',
      phone: stop.phone || '',
      pickupTime: normalizeTimeValue(stop.pickupTime) || taskTimeSlot,
      notes: ''
    }));

    const localTask: PickupTask = formatUnifiedTask(taskId, {
      id: taskId,
      clientId: client.id,
      clientName: client.name,
      clientEmail: client.email || '',
      clientLabId: client.id,
      clientLabName: client.name,
      clientAddress: client.address || '',
      clientCoords: [Number(client.lat || 19.1287852), Number(client.lng || 72.8294183)],
      riderId: rider.id,
      riderName: rider.name,
      riderPhone: rider.phone || '',
      riderVehicle: rider.vehicleNumber || '',
      status: 'assigned',
      currentStopIndex: 0,
      routeId: route?.id || 'route_1',
      routeName: route?.name || `${client.name} Specimen Pickup Loop`,
      scheduledDate: taskDate,
      timeSlot: taskTimeSlot,
      createdAt: new Date().toISOString(),
      stops: stopsPayload,
      stopsProgress: stopsPayload,
      taskNotes
    });

    try {
      // Dispatch unified task via CloudSync using the unique taskId
      const newTask = await CloudSync.dispatchTask({
        client: {
          id: client.id,
          name: client.name,
          lat: Number(client.lat || (client as any).location?.lat || 19.1287852),
          lng: Number(client.lng || (client as any).location?.lng || 72.8294183),
          address: client.address
        },
        rider: {
          id: rider.id,
          name: rider.name,
          phone: rider.phone,
          vehicleNumber: rider.vehicleNumber
        },
        stops: stopsPayload,
        route,
        timeSlot: taskTimeSlot,
        scheduledDate: taskDate,
        taskNotes,
        customTaskId: taskId
      });

      // Update local storage record for offline durability
      StorageService.addTask(newTask || localTask);

      onDispatched(newTask || localTask);
      onClose();
    } catch (err: any) {
      if (err?.code === 'resource-exhausted' || err?.message?.includes('Quota exceeded')) {
        console.warn('Firestore quota exceeded; dispatched task locally.');
        StorageService.addTask(localTask);
        onDispatched(localTask);
        onClose();
      } else {
        console.error("Firestore Write Error:", err);
        alert('Failed to dispatch task. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-sky-700 text-white flex items-center justify-center shadow-xs">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base sm:text-lg">
                Dispatch Real-time Collection Round
              </h3>
              <p className="text-xs text-slate-500">
                Real-time synchronization across Admin, Courier Fleet, and Client Labs
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">
          {/* Client & Rider Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Client Selection */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-sky-700" />
                <span>Client Diagnostic Center / Lab</span>
              </label>
              <select
                value={selectedClientId}
                onChange={(e) => handleClientChange(e.target.value)}
                className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-sky-500 focus:outline-hidden transition-all"
                required
              >
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.area || 'Mumbai'})
                  </option>
                ))}
              </select>
            </div>

            {/* Rider Selection */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Bike className="w-3.5 h-3.5 text-sky-700" />
                <span>Assigned Fleet Runner</span>
              </label>
              <select
                value={selectedRiderId}
                onChange={(e) => handleRiderChange(e.target.value)}
                className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-sky-500 focus:outline-hidden transition-all"
                required
              >
                {riders.map((r) => {
                  const isOnline = r.isOnline !== false;
                  return (
                    <option key={r.id} value={r.id}>
                      {r.name} • {r.phone} {isOnline ? '(Online)' : '(Offline)'}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* Route Template & Time Slot Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <RouteIcon className="w-3.5 h-3.5 text-sky-700" />
                <span>Loop Template</span>
              </label>
              <select
                value={selectedRouteId}
                onChange={(e) => handleRouteChange(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-sky-500 focus:outline-hidden transition-all"
              >
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-sky-700" />
                <span>Scheduled Date</span>
              </label>
              <input
                type="date"
                value={taskDate}
                onChange={(e) => setTaskDate(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-sky-500 focus:outline-hidden transition-all"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-sky-700" />
                <span>Time Slot</span>
              </label>

              <input
                type="time"
                value={taskTimeSlot}
                onChange={(e) => setTaskTimeSlot(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-mono font-bold text-slate-800 focus:ring-2 focus:ring-sky-500 focus:outline-hidden transition-all"
                required
              />
              <p className="text-[10px] text-slate-500">
                {taskTimeSlot
                  ? `Round scheduled for ${formatTimeLabel(taskTimeSlot)}`
                  : 'Set the time for this collection round.'}
              </p>
            </div>
          </div>

          {/* Stops List & Specimen Allocation with Assign All Stops Checkbox Header */}
          <div className="space-y-2.5 bg-slate-50/80 p-3.5 sm:p-4 rounded-xl border border-slate-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-200/80">
              <div className="flex items-center gap-3">
                {/* Visible Master Toggle / Checkbox Header */}
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    ref={(input) => {
                      if (input) {
                        input.indeterminate =
                          selectedStopIds.length > 0 && selectedStopIds.length < customStops.length;
                      }
                    }}
                    onChange={handleToggleSelectAll}
                    className="w-4 h-4 text-sky-700 bg-white border-slate-300 rounded focus:ring-2 focus:ring-sky-500 cursor-pointer"
                  />
                  <span className="text-xs font-bold text-slate-900">
                    Assign All Stops (Selected: {selectedStopIds.length}/{customStops.length})
                  </span>
                </label>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-auto">
                <span className="text-[11px] text-slate-500">
                  Selected Stops:{' '}
                  <strong className="text-sky-800 font-bold">
                    {selectedStopIds.length} of {customStops.length}
                  </strong>
                </span>
                <button
                  type="button"
                  onClick={handleAddStop}
                  className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 font-bold text-xs rounded-lg transition-all flex items-center gap-1 shadow-2xs cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-sky-700" />
                  <span>Add Stop</span>
                </button>
              </div>
            </div>

            {/* List of stops with individual checkboxes */}
            <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
              {customStops.map((stop, idx) => {
                const isChecked = selectedStopIds.includes(stop.id);
                return (
                  <div
                    key={stop.id || idx}
                    className={`p-2.5 rounded-xl border transition-all flex items-center justify-between gap-3 shadow-2xs ${
                      isChecked
                        ? 'bg-white border-sky-300 ring-1 ring-sky-200'
                        : 'bg-slate-100/70 border-slate-200 opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {/* Individual Stop Selection Checkbox */}
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleStop(stop.id)}
                        className="w-4 h-4 text-sky-700 bg-white border-slate-300 rounded focus:ring-2 focus:ring-sky-500 cursor-pointer shrink-0"
                      />
                      <span
                        className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${
                          isChecked ? 'bg-sky-100 text-sky-800' : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {idx + 1}
                      </span>
                      <div className="truncate">
                        <div className="flex items-center gap-1.5 truncate">
                          {stop.name ? (
                            <p className="text-xs font-bold text-slate-900 truncate">{stop.name}</p>
                          ) : (
                            <input
                              type="text"
                              value={stop.name}
                              onChange={(e) => handleStopFieldChange(stop.id, 'name', e.target.value)}
                              placeholder="New stop name"
                              className="text-xs font-bold text-slate-900 bg-white border border-slate-300 rounded px-1.5 py-0.5 focus:border-sky-600 focus:outline-hidden"
                            />
                          )}
                          {isChecked ? (
                            <span className="px-1.5 py-0.2 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-[9px] font-semibold">
                              Assigned
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.2 bg-slate-100 text-slate-500 border border-slate-200 rounded text-[9px] font-semibold">
                              Excluded
                            </span>
                          )}
                        </div>
                        {stop.address ? (
                          <p className="text-[10px] text-slate-500 truncate">{stop.address}</p>
                        ) : (
                          <input
                            type="text"
                            value={stop.address}
                            onChange={(e) => handleStopFieldChange(stop.id, 'address', e.target.value)}
                            placeholder="Address"
                            className="mt-0.5 w-full text-[10px] text-slate-600 bg-white border border-slate-200 rounded px-1.5 py-0.5 focus:border-sky-600 focus:outline-hidden"
                          />
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {/* Per-stop pickup time — overrides the round slot for this stop only */}
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-sky-700 shrink-0" />
                        <input
                          type="time"
                          value={stop.pickupTime || ''}
                          onChange={(e) => handleStopTimeChange(stop.id, e.target.value)}
                          disabled={!isChecked}
                          title="Pickup time for this stop. Leave blank to use the round's time slot."
                          className="w-[92px] px-1.5 py-1 bg-white border border-slate-300 rounded-md text-[10px] font-mono font-bold text-slate-800 focus:border-sky-600 focus:outline-hidden disabled:bg-slate-100 disabled:text-slate-400"
                        />
                        <span className="text-[9px] text-slate-400 font-semibold hidden lg:inline-block w-14">
                          {stop.pickupTime ? formatTimeLabel(stop.pickupTime) : `≈ ${formatTimeLabel(taskTimeSlot)}`}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-500 bg-slate-50 border border-slate-200 px-2 py-1 rounded-md font-medium hidden sm:inline-block">
                        Vials filled by rider
                      </span>
                      {customStops.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveStop(idx)}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors cursor-pointer"
                          title="Remove stop"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {selectedStopIds.length === 0 && (
              <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-amber-800 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
                <span>No stops selected. Please check at least one stop to dispatch.</span>
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-slate-400" />
              <span>Special Handling Notes / Requisition Instructions</span>
            </label>
            <input
              type="text"
              value={taskNotes}
              onChange={(e) => setTaskNotes(e.target.value)}
              placeholder="e.g., EDTA lavender vials on ice, STAT blood culture transport"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-sky-500 focus:outline-hidden transition-all"
            />
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || selectedStopIds.length === 0}
              className="px-5 py-2.5 bg-sky-700 hover:bg-sky-800 disabled:bg-sky-400 text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center gap-2 cursor-pointer active:scale-98"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Dispatching to Fleet...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Dispatch {selectedStopIds.length} Assigned Stops</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
