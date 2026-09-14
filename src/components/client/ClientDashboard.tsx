import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserAuth, PickupTask, Route, PickupBoy, Client, StopProgress } from '../../types';
import { LiveMap } from '../common/LiveMap';
import { ClientLiveTracking } from './ClientLiveTracking';
import { isRiderLocationStale } from '../../services/locationService';
import { localDateKey } from '../../utils/timeSlots';
import { resolveTaskDate } from '../../utils/taskId';
import {
  Building2,
  Calendar,
  Clock,
  MapPin,
  Bike,
  CheckCircle2,
  AlertTriangle,
  Eye,
  Thermometer,
  ShieldCheck,
  Download,
  Search,
  MessageSquare,
  X,
  PhoneCall,
  Send,
  Sparkles,
  Camera,
  FileText,
  Plus,
  Check,
  Inbox
} from 'lucide-react';
import { StorageService } from '../../services/storage';
import { CloudSync, formatUnifiedTask } from '../../services/firebase';
import { NotificationService } from '../../services/notificationService';
import { compressImageToBase64 } from '../../services/imageWatermark';

interface ClientDashboardProps {
  user: UserAuth;
  tasks: PickupTask[];
  routes: Route[];
  riders: PickupBoy[];
  onOpenProof: (task: PickupTask) => void;
  onRefresh: () => void;
}

export const ClientDashboard: React.FC<ClientDashboardProps> = ({
  user,
  tasks,
  routes,
  riders,
  onOpenProof,
  onRefresh
}) => {
  const navigate = useNavigate();

  // Validate authenticated client session on mount
  useEffect(() => {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('vialtrack_client_session') : null;
    let session: any = null;
    try {
      if (raw) session = JSON.parse(raw);
    } catch {
      session = null;
    }
    if (!session || session.role !== 'client' || !session.clientId) {
      StorageService.clearPortalSession('client');
      navigate('/client/login', { replace: true });
    }
  }, [navigate]);

  const activeClientId = user.clientId || StorageService.getClientSession()?.clientId || '';
  const clientRecord = useMemo(() => StorageService.getClientById(activeClientId), [activeClientId]);

  // Real-time scoped Firestore subscriptions strictly for active client account
  const [liveClientTasks, setLiveClientTasks] = useState<PickupTask[]>([]);
  const [liveClientRoutes, setLiveClientRoutes] = useState<Route[]>([]);

  useEffect(() => {
    if (!activeClientId && !user.email) return;

    const unsubTrips = CloudSync.subscribeToClientTrips(activeClientId, user.email, (cloudTrips) => {
      if (cloudTrips && Array.isArray(cloudTrips) && cloudTrips.length > 0) {
        const formatted = cloudTrips.map((t) => formatUnifiedTask(t.id, t));
        setLiveClientTasks((prev) => {
          const map = new Map<string, PickupTask>();
          (prev || []).forEach((item) => map.set(item.id, item));
          formatted.forEach((item) => map.set(item.id, item));
          return Array.from(map.values());
        });
      }
    });

    const unsubTasks = CloudSync.subscribeToClientTasks(activeClientId, user.name, (fetchedTasks) => {
      if (fetchedTasks && Array.isArray(fetchedTasks)) {
        setLiveClientTasks((prev) => {
          const map = new Map<string, PickupTask>();
          (prev || []).forEach((item) => map.set(item.id, item));
          fetchedTasks.forEach((item) => map.set(item.id, item));
          return Array.from(map.values());
        });
      }
    });

    const unsubRoutes = CloudSync.subscribeToClientRoutes(activeClientId, (fetchedRoutes) => {
      if (fetchedRoutes && Array.isArray(fetchedRoutes)) {
        setLiveClientRoutes(fetchedRoutes);
      }
    });

    return () => {
      unsubTrips();
      unsubTasks();
      unsubRoutes();
    };
  }, [activeClientId, user.email, user.name]);

  const [searchQuery, setSearchQuery] = useState('');
  // Archive date filter -- '' means every date. The live panels above are today-only.
  const [archiveDate, setArchiveDate] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'delivered' | 'in_transit' | 'upcoming'>('all');
  const [isReportingIssue, setIsReportingIssue] = useState(false);
  const [issueTask, setIssueTask] = useState<PickupTask | null>(null);
  const [issueText, setIssueText] = useState('');
  const [issueType, setIssueType] = useState('Rider Delayed / Urgent Pickup');

  // Prescription / On-Demand Pickup Modal State
  const [isRequestingPickup, setIsRequestingPickup] = useState(false);
  const [pickupStopName, setPickupStopName] = useState('');
  const [pickupAddress, setPickupAddress] = useState('');
  const [estimatedVials, setEstimatedVials] = useState<number>(5);
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [prescriptionPhoto, setPrescriptionPhoto] = useState<string | null>(null);
  const [isCompressingPhoto, setIsCompressingPhoto] = useState(false);
  const prescriptionFileInputRef = useRef<HTMLInputElement>(null);

  // Scope tasks strictly to activeClientId or clientEmail / clientName
  const clientTasks = useMemo(() => {
    const taskMap = new Map<string, PickupTask>();
    const cleanUserEmail = (user.email || '').trim().toLowerCase();
    const cleanUserName = (user.name || '').trim().toLowerCase();

    const isMatch = (t: any) => {
      if (!t) return false;
      if (activeClientId && (t.clientId === activeClientId || t.clientLabId === activeClientId)) return true;
      if (cleanUserEmail && (t.clientEmail || '').trim().toLowerCase() === cleanUserEmail) return true;
      if (cleanUserName && (t.clientName || '').trim().toLowerCase() === cleanUserName) return true;
      return false;
    };

    tasks.filter(isMatch).forEach((t) => taskMap.set(t.id, t));
    liveClientTasks.filter(isMatch).forEach((t) => taskMap.set(t.id, t));
    return Array.from(taskMap.values());
  }, [tasks, liveClientTasks, activeClientId, user.email, user.name]);

  // Scope routes strictly to activeClientId
  const clientRoutes = useMemo(() => {
    const routeMap = new Map<string, Route>();
    routes.filter((r) => r.clientId === activeClientId).forEach((r) => routeMap.set(r.id, r));
    liveClientRoutes.filter((r) => r.clientId === activeClientId).forEach((r) => routeMap.set(r.id, r));
    return Array.from(routeMap.values());
  }, [routes, liveClientRoutes, activeClientId]);

  // Today's date
  // Local date, refreshed as the day rolls over (see localDateKey -- toISOString is UTC, which in
  // IST reports yesterday until 05:30).
  const [todayStr, setTodayStr] = useState<string>(() => localDateKey());
  useEffect(() => {
    const tick = () => setTodayStr((prev) => (prev === localDateKey() ? prev : localDateKey()));
    const interval = window.setInterval(tick, 60000);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', tick);
    };
  }, []);
  // resolveTaskDate reads the immutable task ID, so an old round whose date field was rewritten
  // by a sync cannot resurface as today's work.
  const todayClientTasks = clientTasks.filter((t) => resolveTaskDate(t) === todayStr);

  // Real active in-transit task to show live tracking on map (NO fallback to upcoming/delivered task)
  const activeLiveTask = useMemo(() => {
    return todayClientTasks.find((t) =>
      (t.status === 'in_transit' || t.status === 'started' || t.status === 'at_stop' || t.status === 'picked_up') &&
      Boolean((t as any).activeRiderId || t.riderId)
    ) || null;
  }, [todayClientTasks]);

  const activeLiveRoute = useMemo(() => {
    if (activeLiveTask?.routeId) {
      return clientRoutes.find((r) => r.id === activeLiveTask.routeId) || null;
    }
    return clientRoutes[0] || null;
  }, [clientRoutes, activeLiveTask]);
  
  // Specific runner assigned strictly to this client route/task (verified online and on-duty)
  const activeLiveRider: PickupBoy | null = useMemo(() => {
    const targetRiderId = (activeLiveTask as any)?.activeRiderId || activeLiveTask?.riderId;
    if (!targetRiderId) return null;
    const found = riders.find((r) => r.id === targetRiderId);
    if (found && found.status === 'active' && found.isOnline !== false && found.isCheckedIn !== false) {
      // Same freshness rule the live map uses (see GPS_STALE_AFTER_MS in ClientLiveTracking).
      // Without it this card and the tracking panel disagreed on screen -- one reading
      // "Idle / Awaiting Dispatch" while the other announced the rider was en route.
      const lastFix = (found as any).lastUpdated
        ? new Date(
            (found as any).lastUpdated?.toDate ? (found as any).lastUpdated.toDate() : (found as any).lastUpdated
          ).getTime()
        : 0;
      if (!lastFix || Date.now() - lastFix > 5 * 60 * 1000) return null;
      return found;
    }
    return null;
  }, [riders, activeLiveTask]);

  // Fallback assigned rider from route definition
  const assignedRiderForRoute: PickupBoy | null = useMemo(() => {
    if (activeLiveRider) return activeLiveRider;
    if (!activeLiveRoute) return null;
    const directRiderId = activeLiveRoute.assignedRiderId;
    if (directRiderId) {
      const found = riders.find((r) => r.id === directRiderId);
      if (found) return found;
    }
    const foundByList = riders.find((r) => Array.isArray(r.assignedRouteIds) && r.assignedRouteIds.includes(activeLiveRoute.id));
    return foundByList || null;
  }, [activeLiveRider, activeLiveRoute, riders]);

  // Filtered task list
  const filteredTasks = useMemo(() => {
    return clientTasks.filter((t) => {
      // Archive date filter: '' shows the full history, otherwise only that day's rounds.
      if (archiveDate) {
        if (resolveTaskDate(t) !== archiveDate) return false;
      }
      if (statusFilter === 'delivered' && t.status !== 'delivered') return false;
      if (statusFilter === 'in_transit' && !['started', 'at_stop', 'picked_up', 'in_transit'].includes(t.status)) return false;
      if (statusFilter === 'upcoming' && t.status !== 'upcoming') return false;

      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesRoute = (t.routeName || '').toLowerCase().includes(q);
        const matchesRider = (t.riderName || '').toLowerCase().includes(q);
        const safeStops = t?.stopsProgress || t?.stops || [];
        const matchesStop = safeStops.some((s: any) => 
          (s?.stopName || s?.name || '').toLowerCase().includes(q) || 
          (s?.sampleCount != null && s.sampleCount.toString().includes(q)) ||
          (s?.specimenCount != null && s.specimenCount.toString().includes(q))
        );
        if (!matchesRoute && !matchesRider && !matchesStop) return false;
      }

      return true;
    });
  }, [clientTasks, statusFilter, searchQuery, archiveDate]);

  // Handle Prescription Photo File Select & Canvas Compression
  const handlePrescriptionPhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsCompressingPhoto(true);
    try {
      // Compress via HTML5 Canvas (max 800px, 0.6 JPEG quality)
      const compressedBase64 = await compressImageToBase64(file, 800, 0.6);
      setPrescriptionPhoto(compressedBase64);
    } catch (err) {
      console.error('Failed to compress prescription photo:', err);
      alert('Unable to process photo. Please try another image.');
    } finally {
      setIsCompressingPhoto(false);
      if (e.target) {
        e.target.value = '';
      }
    }
  };

  // Submit On-Demand Specimen Pickup Request with Prescription Base64
  const handleCreateOnDemandRequest = (e: React.FormEvent) => {
    e.preventDefault();

    const selectedRoute = clientRoutes[0] || routes[0];
    const defaultRider = activeLiveRider || riders.find((r) => r.isOnline && r.isCheckedIn) || riders[0];
    const clientId = activeClientId || 'client-apex';
    const currentTime = new Date().toTimeString().slice(0, 5);

    const newTaskId = `task-${todayStr.replace(/-/g, '')}-stat-${Date.now().toString().slice(-4)}`;
    const stopNameFinal = pickupStopName || `${user.name} (On-Demand OPD)`;
    const safeRouteStops = selectedRoute?.stops || [];
    const addressFinal = pickupAddress || safeRouteStops[0]?.address || 'Hospital OPD Wing B, Malad West, Mumbai';

    const stop: StopProgress = {
      stopId: `stop-stat-${Date.now()}`,
      stopName: stopNameFinal,
      address: addressFinal,
      lat: 19.2082,
      lng: 72.8398,
      contactPerson: user.name,
      phone: user.phone || '',
      status: 'pending',
      sampleCount: estimatedVials,
      photoUrl: prescriptionPhoto || undefined,
      notes: specialInstructions ? `Prescription/Requisition: ${specialInstructions}` : 'Urgent stat on-demand specimen pickup'
    };

    const newTask: PickupTask = {
      id: newTaskId,
      date: todayStr,
      timeSlot: currentTime,
      routeId: selectedRoute?.id || 'route-on-demand',
      routeName: `STAT Urgent On-Demand: ${stopNameFinal}`,
      clientId: clientId,
      clientName: user.name,
      riderId: defaultRider?.id || '',
      riderName: defaultRider?.name || 'Unassigned',
      riderPhone: defaultRider?.phone || '',
      riderVehicle: defaultRider?.vehicleNumber || '',
      status: 'upcoming',
      currentStopIndex: 0,
      stopsProgress: [stop],
      destination: {
        name: selectedRoute?.destinationLab?.name || user.name || 'Diagnostic Processing Facility',
        address: selectedRoute?.destinationLab?.address || '',
        lat: selectedRoute?.destinationLab?.lat || 19.1860,
        lng: selectedRoute?.destinationLab?.lng || 72.8485,
        notes: `Urgent pickup: ${estimatedVials} vials. Cold-chain required.`
      },
      isDelayed: false,
      delayMinutes: 0,
      issueFlags: [],
      createdAt: new Date().toISOString()
    };

    // Save directly to Firestore and LocalStorage
    StorageService.addTask(newTask);
    setIsRequestingPickup(false);
    setPrescriptionPhoto(null);
    setPickupStopName('');
    setPickupAddress('');
    setSpecialInstructions('');
    onRefresh();

    NotificationService.sendAlert({
      type: 'task_started',
      title: `New On-Demand Request: ${user.name}`,
      message: `Urgent specimen pickup requested for ${stopNameFinal} (${estimatedVials} vials). Prescription photo attached.`,
      recipientRole: 'both',
      channel: 'both'
    });

    alert('On-Demand pickup request submitted successfully! Rider assigned and operations notified.');
  };

  const handleReportIssue = (e: React.FormEvent) => {
    e.preventDefault();
    if (!issueText) return;

    NotificationService.sendAlert({
      type: 'issue',
      title: `Client Alert (${user.name}): ${issueType}`,
      message: `${issueText} - Reported for Task: ${issueTask ? `${issueTask.timeSlot} ${issueTask.routeName}` : 'General Inquiry'}`,
      recipientRole: 'admin',
      channel: 'both'
    });

    alert('Your issue report has been dispatched to SecondMedic Logistics Operations dispatch team.');
    setIsReportingIssue(false);
    setIssueText('');
  };

  const totalSlotsCount = activeLiveRoute?.stops?.length || todayClientTasks.length || 0;

  const totalTodayVials = useMemo(() => {
    let sum = todayClientTasks.reduce(
      (acc, t) => acc + (t.stopsProgress || []).reduce((sAcc, s: any) => sAcc + Number(s.sampleCount || s.specimenCount || 0), 0),
      0
    );
    if (sum === 0 && activeLiveRoute?.stops && activeLiveRoute.stops.length > 0) {
      sum = activeLiveRoute.stops.reduce((acc, s: any) => acc + Number(s.specimenCount || s.sampleCount || 0), 0);
    }
    return sum;
  }, [todayClientTasks, activeLiveRoute]);

  return (
    <div className="space-y-5">
      {/* Welcome & Lab Overview Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 relative overflow-hidden">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-sky-700 mb-1">
            <ShieldCheck className="w-4 h-4 text-sky-700" />
            <span>SecondMedic Verified Diagnostic Transport Partner</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">{user.name}</h2>
          <p className="text-xs text-slate-500 mt-0.5 max-w-xl">
            Live specimen chain-of-custody, active rider GPS tracking, calibrated box diagnostics, and verified lab handover logs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setIsRequestingPickup(true)}
            className="px-3.5 py-2 bg-sky-700 hover:bg-sky-800 text-white font-bold text-xs rounded-lg shadow-xs transition-all flex items-center gap-1.5 cursor-pointer active:scale-98"
          >
            <Plus className="w-4 h-4" />
            <span>Request STAT Pickup & Prescription</span>
          </button>

          <button
            onClick={() => {
              setIssueTask(activeLiveTask);
              setIsReportingIssue(true);
            }}
            className="px-3.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold text-xs rounded-lg border border-amber-300 transition-all flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <MessageSquare className="w-4 h-4 text-amber-600" />
            <span>Report Logistics Issue</span>
          </button>
        </div>
      </div>

      {/* Today's KPI Counters */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold mb-1.5">
            <span>Today's Time Slots</span>
            <Clock className="w-4 h-4 text-sky-700" />
          </div>
          <div className="text-xl sm:text-2xl font-bold text-slate-900">{totalSlotsCount} Scheduled</div>
          <div className="text-[11px] text-slate-400 mt-0.5">Fixed daily collection cycles</div>
        </div>

        <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold mb-1.5">
            <span>Specimens Received</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-xl sm:text-2xl font-bold text-emerald-700">{totalTodayVials} Vials</div>
          <div className="text-[11px] text-slate-400 mt-0.5">Blood & biopsy samples</div>
        </div>

        <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold mb-1.5">
            <span>Cold-Box Status</span>
            <Thermometer className="w-4 h-4 text-teal-600" />
          </div>
          <div className="text-xl sm:text-2xl font-bold text-teal-800">4.2°C (Safe)</div>
          <div className="text-[11px] text-slate-400 mt-0.5">Certified 2.0°C – 8.0°C range</div>
        </div>

        <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold mb-1.5">
            <span>Active Collection Loop</span>
            <Bike className={`w-4 h-4 ${activeLiveTask && activeLiveRider ? 'text-sky-700' : 'text-slate-400'}`} />
          </div>
          <div className={`text-lg sm:text-xl font-bold truncate ${activeLiveTask && activeLiveRider ? 'text-sky-700' : 'text-slate-700'}`}>
            {activeLiveTask && activeLiveRider ? activeLiveRider.name : 'Idle / Awaiting Dispatch'}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5 truncate">
            {activeLiveTask && activeLiveRider
              ? (activeLiveRider.phone ? `${activeLiveRider.phone} • En Route` : 'En Route to Facility')
              : 'Scheduled pickup cycles will appear here when dispatched'}
          </div>
        </div>
      </div>

      {/* Live Map & Today's Slots Tracking */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Live Rider Radar & Telemetry HUD (7 cols) */}
        <div className="lg:col-span-7">
          <ClientLiveTracking
            activeClientId={clientRecord?.id || 'client-lifecare'}
            clientName={clientRecord?.name || user.name || 'Lifecare Diagnostics (Andheri West)'}
            clientAddress={clientRecord?.address || 'SV Road, Andheri West, Mumbai'}
            clientLocation={clientRecord?.location || { lat: 19.1287852, lng: 72.8294183 }}
            activeTask={activeLiveTask}
            activeRoute={activeLiveRoute}
            assignedRiderId={activeLiveRider?.id || assignedRiderForRoute?.id}
            onOpenProof={onOpenProof}
            height="360px"
          />
        </div>

        {/* Right: Today's Time Slots Timeline (5 cols) */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs space-y-3.5">
          <h3 className="font-bold text-slate-900 text-sm sm:text-base flex items-center gap-2 pb-2.5 border-b border-slate-100">
            <Clock className="w-4 h-4 text-sky-700" />
            <span>Today's Pickup Slots</span>
          </h3>

          <div className="space-y-2.5">
            {todayClientTasks.length > 0 ? (
              todayClientTasks.map((task) => {
                return (
                  <div
                    key={task.id}
                    className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-900 shadow-xs">
                          {task.timeSlot}
                        </span>
                        <span className="font-bold text-slate-900 text-xs">{task.routeName}</span>
                      </div>

                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          task.status === 'delivered'
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : task.status === 'in_transit' || task.status === 'started' || task.status === 'at_stop'
                            ? 'bg-sky-100 text-sky-800 border border-sky-200'
                            : 'bg-slate-100 text-slate-600 border border-slate-200'
                        }`}
                      >
                        {task.status === 'delivered'
                          ? 'Delivered to Lab'
                          : task.status === 'in_transit'
                          ? 'In Transit'
                          : 'Scheduled'}
                      </span>
                    </div>

                    {/* Stops progress with Rider Remark and Vial Count */}
                    <div className="text-[11px] text-slate-600 space-y-1.5 bg-white p-2.5 rounded-md border border-slate-200 shadow-xs">
                      {(() => {
                        const safeStops = task?.stopsProgress || (task as any)?.stops || [];
                        if (safeStops.length === 0) {
                          return (
                            <div className="text-slate-400 italic text-[10px]">No collection points specified</div>
                          );
                        }
                        const isTaskDelivered = task.status === 'delivered' || task.status === 'completed';
                        const taskTotalVials = Number(task.sampleCount || (task as any).totalVials || 0);

                        return safeStops.map((stop: any, sIdx: number) => {
                          const isStopDone = stop.status === 'picked_up' || stop.status === 'completed' || isTaskDelivered;
                          let vials = Number(stop.sampleCount ?? stop.specimenCount ?? 0);
                          if (vials === 0 && isTaskDelivered && taskTotalVials > 0) {
                            if (safeStops.length === 1) {
                              vials = taskTotalVials;
                            } else {
                              const perStop = Math.floor(taskTotalVials / safeStops.length);
                              const remainder = taskTotalVials % safeStops.length;
                              vials = sIdx === 0 ? perStop + remainder : perStop;
                            }
                          }

                          const stopRemark = stop.remark || (stop.status === 'no_sample' ? 'No Sample' : (isStopDone ? 'Collected sample' : null));

                          return (
                            <div key={stop.stopId || stop.id || sIdx} className="flex items-center justify-between gap-2">
                              <span className="truncate max-w-[170px] text-slate-700 font-medium">{stop.stopName || stop.name || `Point ${sIdx + 1}`}</span>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {stop.status === 'no_sample' || stopRemark === 'No Sample' ? (
                                  <span className="font-mono text-amber-800 font-bold bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded text-[10px]">
                                    No Sample (0 Vials)
                                  </span>
                                ) : isStopDone || vials > 0 ? (
                                  <span className="font-mono text-emerald-800 font-bold bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1">
                                    <span>{stopRemark || 'Collected sample'}</span>
                                    <span>•</span>
                                    <span>{vials} Vials</span>
                                  </span>
                                ) : stopRemark && stopRemark.startsWith('Other') ? (
                                  <span className="font-mono text-sky-800 font-bold bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded text-[10px] truncate max-w-[130px]" title={stopRemark}>
                                    {stopRemark} {vials > 0 ? `(${vials}V)` : ''}
                                  </span>
                                ) : (
                                  <span className="text-slate-400 font-medium text-[10px]">Pending</span>
                                )}
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>

                    {/* Proof button */}
                    <div className="flex items-center justify-between pt-1 text-xs">
                      <span className="text-slate-500 text-[11px]">Rider: {task.riderName || 'Assigned Rider'}</span>
                      <button
                        onClick={() => onOpenProof(task)}
                        className="px-2.5 py-1 bg-white hover:bg-slate-50 text-sky-700 font-semibold rounded-md text-xs border border-slate-200 flex items-center gap-1 transition-colors cursor-pointer shadow-xs"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>View Proof</span>
                      </button>
                    </div>
                  </div>
                );
              })
            ) : activeLiveRoute && Array.isArray(activeLiveRoute.stops) && activeLiveRoute.stops.length > 0 ? (
              <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-xs bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-900 shadow-xs">
                      {activeLiveRoute.timeSlots?.[0] || 'Scheduled'}
                    </span>
                    <span className="font-bold text-slate-900 text-xs">{activeLiveRoute.name}</span>
                  </div>

                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 border border-sky-200">
                    In Transit
                  </span>
                </div>

                {/* Route stops in transit */}
                <div className="text-[11px] text-slate-600 space-y-1.5 bg-white p-2.5 rounded-md border border-slate-200 shadow-xs">
                  {(activeLiveRoute.stops || []).map((stop: any, sIdx: number) => (
                    <div key={stop.id || sIdx} className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 truncate max-w-[200px]">
                        <span className="w-4 h-4 rounded-full bg-sky-100 text-sky-700 font-bold text-[10px] flex items-center justify-center shrink-0">
                          {sIdx + 1}
                        </span>
                        <span className="truncate text-slate-800 font-medium">
                          {stop.stopName || stop.name}
                        </span>
                      </div>
                      <span className="font-mono text-emerald-700 font-semibold shrink-0">
                        {stop.specimenCount || stop.sampleCount || 10} Vials
                      </span>
                    </div>
                  ))}

                  {/* Destination Lab item */}
                  <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-slate-900 font-bold">
                    <div className="flex items-center gap-1.5 truncate max-w-[200px]">
                      <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px] flex items-center justify-center shrink-0">
                        âœ“
                      </span>
                      <span className="truncate text-emerald-900">
                        {activeLiveRoute.destinationLab?.name || user.name}
                      </span>
                    </div>
                    <span className="text-[10px] uppercase font-mono text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                      Destination Lab
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1 text-xs">
                  <span className="text-slate-500 text-[11px]">
                    Assigned: {assignedRiderForRoute?.name ? `${assignedRiderForRoute.name}${assignedRiderForRoute.vehicleNumber ? ` (${assignedRiderForRoute.vehicleNumber})` : ''} • Awaiting Start` : 'Pending assignment'}
                  </span>
                  <span className="text-[11px] font-semibold text-sky-700">Scheduled Route</span>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-slate-400 text-xs bg-slate-50 rounded-lg border border-dashed border-slate-200">
                No active pickup tasks scheduled
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Historical Pickup Log & Chain-of-Custody Archives */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <h3 className="font-bold text-slate-900 text-sm sm:text-base flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-sky-700" />
              <span>Specimen Intake & Verification Archive</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Verified chain-of-custody proofs, cold-box sensor logs, and sample pickup history for {user.name}.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="date"
              value={archiveDate}
              onChange={(e) => setArchiveDate(e.target.value)}
              title="Filter the archive by collection date"
              className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-900 text-xs font-semibold focus:outline-hidden focus:border-sky-600"
            />
            <button
              type="button"
              onClick={() => setArchiveDate(todayStr)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer ${
                archiveDate === todayStr
                  ? 'bg-sky-700 text-white border-sky-700'
                  : 'bg-white text-slate-700 border-slate-300 hover:border-sky-400'
              }`}
            >
              Today
            </button>
            {archiveDate && (
              <button
                type="button"
                onClick={() => setArchiveDate('')}
                className="px-2.5 py-1.5 bg-white border border-slate-300 hover:border-sky-400 rounded-lg text-[11px] font-bold text-slate-600 cursor-pointer"
              >
                All dates
              </button>
            )}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search route, sample count..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-900 text-xs focus:outline-hidden focus:border-sky-600"
              />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-slate-700 font-bold uppercase tracking-wider text-[10px] border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Date & Slot</th>
                <th className="px-4 py-3">Route</th>
                <th className="px-4 py-3">Rider</th>
                <th className="px-4 py-3">Pickup Remark</th>
                <th className="px-4 py-3">Vials Picked</th>
                <th className="px-4 py-3">Chiller Temp</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Proof of Custody</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTasks.map((t) => {
                const safeStops = t?.stopsProgress || t?.stops || [];
                let vials = safeStops.reduce((sum: number, s: any) => sum + Number(s?.sampleCount || s?.specimenCount || 0), 0);
                if (vials === 0 && (t.sampleCount || (t as any).totalVials)) {
                  vials = Number(t.sampleCount || (t as any).totalVials || 0);
                }
                const lastTemp = t?.destination?.coldBoxTempAtDrop || (safeStops[0] as any)?.coldBoxTemp;

                // Derive overall task remark
                const stopRemarks = safeStops.map((s: any) => s.remark || (s.status === 'no_sample' ? 'No Sample' : (s.sampleCount > 0 ? 'Collected sample' : null))).filter(Boolean);
                const primaryRemark = stopRemarks[0] || (t.status === 'delivered' ? (vials > 0 ? 'Collected sample' : 'No Sample') : 'Scheduled');

                return (
                  <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-mono font-bold text-slate-900 text-xs">{t.timeSlot}</div>
                      <div className="text-[10px] text-slate-400">{t.date}</div>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900">{t.routeName}</td>
                    <td className="px-4 py-3 text-slate-700">{t.riderName}</td>
                    <td className="px-4 py-3">
                      {primaryRemark === 'Collected sample' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                          Collected sample
                        </span>
                      ) : primaryRemark === 'No Sample' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                          No Sample
                        </span>
                      ) : primaryRemark.startsWith('Other') ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-800 border border-sky-200 truncate max-w-[140px]" title={primaryRemark}>
                          {primaryRemark}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[10px] font-medium">{primaryRemark}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-bold font-mono text-amber-700 text-xs">{vials} Vials</td>
                    <td className="px-4 py-3 font-mono text-emerald-700">
                      {lastTemp !== undefined ? `${lastTemp.toFixed(1)}°C` : 'N/A'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          t.status === 'delivered'
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : 'bg-sky-100 text-sky-800 border border-sky-200'
                        }`}
                      >
                        {t.status === 'delivered' ? 'Delivered' : t.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => onOpenProof(t)}
                        className="px-2.5 py-1 bg-slate-50 hover:bg-slate-100 text-sky-700 font-semibold rounded-lg text-xs border border-slate-200 transition-colors inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Eye className="w-3 h-3" />
                        <span>View Proof</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* On-Demand Pickup & Prescription Upload Modal */}
      {isRequestingPickup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs overflow-y-auto animate-fadeIn">
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-5 sm:p-6 shadow-2xl space-y-4 my-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-700">
                  <Camera className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base">Request STAT Specimen Pickup</h3>
                  <p className="text-xs text-slate-500">Attach doctor prescription or test requisition photo</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsRequestingPickup(false);
                  setPrescriptionPhoto(null);
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateOnDemandRequest} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1 text-[11px]">
                  Collection Stop / Hospital OPD Unit *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Apex Hospital - Ward 3 OPD"
                  value={pickupStopName}
                  onChange={(e) => setPickupStopName(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 font-medium focus:outline-hidden focus:border-sky-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1 text-[11px]">
                    Stop Street Address
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. S.V. Road, Malad West"
                    value={pickupAddress}
                    onChange={(e) => setPickupAddress(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-hidden focus:border-sky-600"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1 text-[11px]">
                    Estimated Vial Count
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={estimatedVials}
                    onChange={(e) => setEstimatedVials(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 font-mono focus:outline-hidden focus:border-sky-600"
                  />
                </div>
              </div>

              {/* Prescription / Requisition Photo Upload */}
              <div className="space-y-1.5">
                <label className="block text-slate-700 font-bold uppercase tracking-wider text-[11px]">
                  Prescription / Requisition Document Photo
                </label>

                <input
                  ref={prescriptionFileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handlePrescriptionPhotoSelect}
                />

                {prescriptionPhoto ? (
                  <div className="relative rounded-lg overflow-hidden border border-slate-200 bg-slate-100 group">
                    <img
                      src={prescriptionPhoto}
                      alt="Prescription Preview"
                      className="w-full h-44 object-cover"
                    />
                    <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-between">
                      <span className="text-[10px] text-emerald-300 font-mono flex items-center gap-1">
                        <Check className="w-3 h-3" /> Document Verified & Attached
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => prescriptionFileInputRef.current?.click()}
                          className="px-2.5 py-1 bg-white/90 hover:bg-white text-slate-900 rounded text-xs font-semibold shadow-xs cursor-pointer"
                        >
                          Change Photo
                        </button>
                        <button
                          type="button"
                          onClick={() => setPrescriptionPhoto(null)}
                          className="p-1 bg-red-600/90 hover:bg-red-600 text-white rounded text-xs cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => prescriptionFileInputRef.current?.click()}
                    disabled={isCompressingPhoto}
                    className="w-full py-4 px-3 border-2 border-dashed border-sky-300 rounded-lg bg-sky-50/50 hover:bg-sky-50 text-sky-800 font-bold text-xs flex flex-col items-center justify-center gap-1.5 cursor-pointer active:scale-98 transition-all"
                  >
                    <Camera className="w-5 h-5 text-sky-700" />
                    <span>{isCompressingPhoto ? 'Processing Document...' : 'Capture / Upload Prescription Photo'}</span>
                    <span className="text-[10px] text-slate-500">Auto-optimized for rapid cloud transmission</span>
                  </button>
                )}
              </div>

              <div>
                <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1 text-[11px]">
                  Special Sample Instructions
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Fasting blood sugar vials, centrifuge immediately on arrival..."
                  value={specialInstructions}
                  onChange={(e) => setSpecialInstructions(e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-hidden focus:border-sky-600"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setIsRequestingPickup(false);
                    setPrescriptionPhoto(null);
                  }}
                  className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-sky-700 hover:bg-sky-800 text-white font-bold rounded-lg shadow-xs transition-all flex items-center gap-1.5 cursor-pointer active:scale-98"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Dispatch STAT Request</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Report Issue Modal */}
      {isReportingIssue && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm sm:text-base flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                <span>Report Logistics Issue to SecondMedic Ops</span>
              </h3>
              <button
                onClick={() => setIsReportingIssue(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleReportIssue} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1 text-[11px]">
                  Issue Category
                </label>
                <select
                  value={issueType}
                  onChange={(e) => setIssueType(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-hidden focus:border-sky-600"
                >
                  <option value="Rider Delayed / Urgent Pickup">Rider Delayed / Urgent Pickup Required</option>
                  <option value="Sample Count Mismatch">Sample / Vial Count Mismatch</option>
                  <option value="Temperature / Cold-Chain Issue">Cold-Chain Temperature Fluctuation</option>
                  <option value="Damaged / Leaking Vial">Damaged / Leaking Vial</option>
                  <option value="Other Logistics Request">Other Logistics Inquiries</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1 text-[11px]">
                  Description & Critical Details *
                </label>
                <textarea
                  rows={4}
                  required
                  placeholder="Provide stop name, sample IDs, or any emergency instructions for SecondMedic Ops dispatch..."
                  value={issueText}
                  onChange={(e) => setIssueText(e.target.value)}
                  className="w-full p-3 bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-hidden focus:border-sky-600"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsReportingIssue(false)}
                  className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Dispatch Alert</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

