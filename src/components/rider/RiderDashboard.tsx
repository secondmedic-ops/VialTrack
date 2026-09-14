import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserAuth, PickupTask, Route, PickupBoy, StopProgress, TaskStatus, RiderSession, StopStatus } from '../../types';
import {
  Bike,
  MapPin,
  Clock,
  PhoneCall,
  Navigation,
  Camera,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Radio,
  Thermometer,
  ShieldCheck,
  Package,
  Plus,
  Minus,
  ArrowRight,
  ArrowLeft,
  UploadCloud,
  Check,
  X,
  Battery,
  Wifi,
  WifiOff,
  UserCheck,
  ChevronRight,
  ChevronDown,
  Eye,
  Sparkles,
  RefreshCw,
  Image as ImageIcon,
  FileText,
  Inbox,
  LogOut,
  Edit2,
  Lock,
  Upload,
  Loader2
} from 'lucide-react';
import { addWatermarkToImage, compressImageToBase64 } from '../../services/imageWatermark';
import { StorageService } from '../../services/storage';
import { LocationService, GpsStatusEvent } from '../../services/locationService';
import { NotificationService } from '../../services/notificationService';
import { LiveMap } from '../common/LiveMap';
import { CloudSync, db, formatUnifiedTask, uploadPhotoToStorage } from '../../services/firebase';
import { doc, setDoc, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { DailyRoundsSchedule, ScheduleStopItem } from './DailyRoundsSchedule';
import {
  evaluateRiderPunctuality,
  getRiderFirstRouteSlot,
  parseSlotToMinutes,
  PunctualityReport
} from '../../utils/riderTelemetry';
import { getLiveBatteryInfo, subscribeToBatteryChanges } from '../../utils/deviceBattery';
import { buildCanonicalTaskId, resolveTaskDate } from '../../utils/taskId';
import { formatTimeLabel, localDateKey } from '../../utils/timeSlots';

// Rank how "complete" a stop's status is, so a race between the two live Firestore listeners
// below (one on 'trips', one on 'tasks' — both mirror the same document) can never regress an
// already-confirmed stop back to an earlier state just because a slower/stale snapshot arrived
// after a faster one.
const STOP_COMPLETION_RANK: Record<string, number> = {
  pending: 0,
  in_progress: 1,
  arrived: 1,
  picked_up: 2,
  completed: 2,
  no_sample: 2
};

const stopRank = (status?: string) => STOP_COMPLETION_RANK[status || 'pending'] ?? 0;

// Merge an incoming task snapshot with whatever we already have locally, keeping the more
// "complete" version of each individual stop rather than blindly replacing the whole array.
// This protects against the two independent 'trips'/'tasks' listeners overwriting each other
// with out-of-order snapshots for the same logical task.
const mergeTaskPreservingProgress = (prevTask: PickupTask | undefined, incomingTask: PickupTask): PickupTask => {
  if (!prevTask) return incomingTask;

  const prevStops = prevTask.stopsProgress || prevTask.stops || [];
  const incomingStops = incomingTask.stopsProgress || incomingTask.stops || [];

  if (!prevStops.length || !incomingStops.length || prevStops.length !== incomingStops.length) {
    // Shape mismatch (e.g. task was just created) — trust the incoming snapshot as-is.
    return incomingTask;
  }

  // Whether a stop has real recorded proof — used below to break "tied" ranks (e.g. two
  // snapshots both showing "completed") in favor of whichever one actually has the photo,
  // instead of always trusting the most recently-arrived snapshot.
  const hasPhotoProof = (stop: any) => Boolean(stop?.photoUrl || stop?.photo2Url || stop?.handoverPhotoUrl || stop?.selfieUrl);

  let anyStopKeptFromPrev = false;
  const mergedStops = incomingStops.map((incomingStop: any, idx: number) => {
    const prevStop: any = prevStops[idx];
    if (!prevStop) return incomingStop;

    const prevRank = stopRank(prevStop.status);
    const incomingRank = stopRank(incomingStop.status);

    if (prevRank > incomingRank) {
      anyStopKeptFromPrev = true;
      return prevStop;
    }
    if (prevRank === incomingRank && hasPhotoProof(prevStop) && !hasPhotoProof(incomingStop)) {
      // Same completion rank, but the incoming snapshot is missing proof the previous one had —
      // a stale/partial write racing in. Never let it erase a photo we already know about.
      anyStopKeptFromPrev = true;
      return prevStop;
    }
    return incomingStop;
  });

  if (!anyStopKeptFromPrev) return incomingTask;

  return {
    ...incomingTask,
    stopsProgress: mergedStops,
    stops: mergedStops
  };
};

interface RiderDashboardProps {
  user: UserAuth;
  tasks: PickupTask[];
  routes: Route[];
  rider?: PickupBoy;
  onRefresh: () => void;
  onOpenProof: (task: PickupTask) => void;
}

export const RiderDashboard: React.FC<RiderDashboardProps> = ({
  user,
  tasks,
  routes,
  rider,
  onRefresh,
  onOpenProof
}) => {
  const navigate = useNavigate();

  // Validate active authenticated rider session from localStorage ('vialtrack_rider_session')
  const getRiderSession = (): RiderSession | null => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('vialtrack_rider_session') : null;
      if (raw) return JSON.parse(raw);
    } catch (err) {
      console.warn('Error reading vialtrack_rider_session:', err);
    }
    return null;
  };

  const session = getRiderSession();

  // Route guard: if session data is invalid or missing, clear storage and redirect to /rider/login
  useEffect(() => {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('vialtrack_rider_session') : null;
    let sess: RiderSession | null = null;
    try {
      if (raw) sess = JSON.parse(raw);
    } catch {
      sess = null;
    }
    if (!sess || sess.role !== 'rider' || !sess.riderId) {
      StorageService.clearPortalSession('rider');
      navigate('/rider/login', { replace: true });
    }
  }, [navigate]);

  const activeRider: PickupBoy = rider || {
    id: session?.riderId || user?.riderId || '',
    name: session?.name || user?.name || 'Courier Partner',
    email: session?.email || user?.email || '',
    phone: session?.phone || user?.phone || '',
    photoUrl: user?.avatar || '',
    vehicleNumber: '',
    vehicleType: 'Motorcycle / Bike',
    assignedRouteIds: [],
    status: 'active',
    joiningDate: new Date().toISOString().split('T')[0],
    isOnline: true,
    isCheckedIn: true
  };

  // Active identity keys strictly for this rider
  const sessionRiderId = session?.riderId || user?.riderId || activeRider.id;
  const sessionPhone = session?.phone || user?.phone || activeRider.phone || '';
  // Routes the admin linked from the rider's own profile (Edit Rider > Assigned Routes).
  const localAssignedRouteIds = Array.isArray((activeRider as any)?.assignedRouteIds)
    ? ((activeRider as any).assignedRouteIds as string[])
    : [];
  const sessionName = session?.name || user?.name || activeRider.name || '';

  const normalizePhone = (p?: string) => (p || '').replace(/\D/g, '');
  const normalizedSessionPhone = normalizePhone(sessionPhone);

  // Local synced state for real-time Firestore listeners
  const [liveTasks, setLiveTasks] = useState<PickupTask[]>([]);
  const [liveRoutes, setLiveRoutes] = useState<Route[]>([]);
  // Assignments read from the rider's own Firestore document. The local session object is NOT a
  // reliable source for this -- on a freshly installed PWA it has no assignedRouteIds at all, so
  // a route linked from the admin's Edit Rider screen stayed invisible on the phone while showing
  // correctly on a desktop that still had it cached.
  const [cloudAssignedRouteIds, setCloudAssignedRouteIds] = useState<string[]>([]);
  // Explicit save feedback. A rider needs to know whether they can walk away from a stop, so the
  // difference between "it reached Ops" and "it is on this phone only" is stated, not implied.
  const [syncBanner, setSyncBanner] = useState<{ state: 'saving' | 'synced' | 'queued'; message: string } | null>(null);
  const [pendingProofCount, setPendingProofCount] = useState<number>(0);
  // Set to a closer function while any modal is open; read by the popstate handler, which is
  // registered once and would otherwise capture stale state.
  const openModalRef = useRef<null | (() => void)>(null);
  // Mid-round, a rider standing outside a hospital needs one thing: which stop, and the capture
  // button. The stats grid and the full day schedule are useful before and after a round, not
  // during one, so they collapse by default once a round is active and can be opened on demand.
  const [showStats, setShowStats] = useState<boolean>(false);
  const [showFullSchedule, setShowFullSchedule] = useState<boolean>(false);
  // Rider-facing archive: their own completed rounds, by date. Riders get asked "did you collect
  // from X last Tuesday?" and had no way to check their own record without calling Ops.
  const [isArchiveOpen, setIsArchiveOpen] = useState<boolean>(false);
  const [archiveDate, setArchiveDate] = useState<string>('');

  // Union of both sources, so an assignment shows up whether it was cached locally or only exists
  // in Firestore.
  const effectiveAssignedRouteIds = Array.from(new Set([...localAssignedRouteIds, ...cloudAssignedRouteIds]));
  const effectiveAssignedRouteKey = effectiveAssignedRouteIds.join(',');


  // Real-time Firestore snapshot listeners strictly scoped to active rider identity
  useEffect(() => {
    if (!sessionRiderId) return;

    const unsubTrips = CloudSync.subscribeToRiderTrips(sessionRiderId, sessionPhone, (cloudTrips) => {
      if (cloudTrips && cloudTrips.length > 0) {
        const formatted = cloudTrips.map((t) => formatUnifiedTask(t.id, t));
        setLiveTasks((prev) => {
          const map = new Map<string, PickupTask>();
          prev.forEach((item) => map.set(item.id, item));
          formatted.forEach((item) => map.set(item.id, mergeTaskPreservingProgress(map.get(item.id), item)));
          return Array.from(map.values());
        });
      }
    });

    const unsubTasks = CloudSync.subscribeToRiderTasks(sessionRiderId, sessionPhone, (cloudTasks) => {
      if (cloudTasks) {
        setLiveTasks((prev) => {
          const map = new Map<string, PickupTask>();
          prev.forEach((item) => map.set(item.id, item));
          cloudTasks.forEach((item) => map.set(item.id, mergeTaskPreservingProgress(map.get(item.id), item)));
          return Array.from(map.values());
        });
      }
    });

    const unsubRoutes = CloudSync.subscribeToRiderRoutes(
      sessionRiderId,
      sessionPhone,
      (cloudRoutes) => {
        if (cloudRoutes) {
          setLiveRoutes(cloudRoutes);
        }
      },
      effectiveAssignedRouteIds
    );

    const unsubRiderDoc = CloudSync.subscribeToRiderDocument(sessionRiderId, (cloudRider) => {
      if (cloudRider && cloudRider.isCheckedIn !== undefined) {
        setIsCheckedIn(cloudRider.isCheckedIn);
      }
      if (cloudRider && Array.isArray((cloudRider as any).assignedRouteIds)) {
        const ids = (cloudRider as any).assignedRouteIds as string[];
        setCloudAssignedRouteIds((prev) => (prev.join(',') === ids.join(',') ? prev : ids));
      }
    });

    const unsubSettings = onSnapshot(doc(db, 'settings', 'organization'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.opsHotline) {
          setOpsHotline(data.opsHotline);
        }
      }
    });

    return () => {
      unsubTrips();
      unsubTasks();
      unsubRoutes();
      unsubRiderDoc();
      unsubSettings();
    };
    // sessionAssignedRouteKey is in the deps so the subscription re-runs when an admin changes
    // which routes are assigned to this rider, instead of holding a stale list until reload.
  }, [sessionRiderId, sessionPhone, effectiveAssignedRouteKey]);

  const [opsHotline, setOpsHotline] = useState<string>('+91 93216 40508');
  const [isCheckedIn, setIsCheckedIn] = useState<boolean>(activeRider.isCheckedIn ?? true);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [currentStopIndex, setCurrentStopIndex] = useState<number>(0);
  const [isProcessingStop, setIsProcessingStop] = useState<boolean>(false);
  const [isProcessingDrop, setIsProcessingDrop] = useState<boolean>(false);

  // Stop collection 2-Photo proof state
  const [vialCount, setVialCount] = useState<number>(1);
  const [coldBoxTemp, setColdBoxTemp] = useState<number>(4.0);
  const [pickupRemarkType, setPickupRemarkType] = useState<'Collected sample' | 'No Sample' | 'Other'>('Collected sample');
  const [pickupCustomRemark, setPickupCustomRemark] = useState<string>('');
  const [stopPhoto, setStopPhoto] = useState<string | null>(null); // Photo 1: Specimen Vials
  const [stopPhoto2, setStopPhoto2] = useState<string | null>(null); // Photo 2: Rider Location Selfie
  const [pickupFormError, setPickupFormError] = useState<string | null>(null);
  const [dropFormError, setDropFormError] = useState<string | null>(null);
  const [receiverName, setReceiverName] = useState<string>('');
  const [delayReason, setDelayReason] = useState<string>('Heavy Traffic / Rain');
  const [showDelayModal, setShowDelayModal] = useState<boolean>(false);
  const [watermarking, setWatermarking] = useState<boolean>(false);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [showLiveMap, setShowLiveMap] = useState<boolean>(true);

  // Vehicle Type & Number state with persistence to Firestore
  const [selectedVehicleType, setSelectedVehicleType] = useState<string>(
    (session as any)?.vehicleType || activeRider.vehicleType || 'Motorcycle / Bike'
  );
  const [selectedVehicleNumber, setSelectedVehicleNumber] = useState<string>(
    (session as any)?.vehicleNo || (session as any)?.vehicleNumber || activeRider.vehicleNumber || ''
  );
  const [showVehicleDutyModal, setShowVehicleDutyModal] = useState<boolean>(false);
  const [showExitConfirmModal, setShowExitConfirmModal] = useState<boolean>(false);

  const fileInputRef1 = useRef<HTMLInputElement>(null);
  const fileGalleryRef1 = useRef<HTMLInputElement>(null);
  const fileInputRef2 = useRef<HTMLInputElement>(null);
  const fileGalleryRef2 = useRef<HTMLInputElement>(null);
  const dropFileInputRef = useRef<HTMLInputElement>(null);
  const dropGalleryRef = useRef<HTMLInputElement>(null);

  // Restrict Browser Back Navigation on Rider App
  useEffect(() => {
    window.history.pushState(null, '', window.location.href);
    const handleBackButton = () => {
      window.history.pushState(null, '', window.location.href);
      // The phone's back button should dismiss whatever is open on top first -- a rider pressing
      // back mid-capture expects to return to their stop list, not to be asked whether they want
      // to leave the app entirely. Only when nothing is open does back mean "exit".
      if (openModalRef.current) {
        openModalRef.current();
        return;
      }
      setShowExitConfirmModal(true);
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isCheckedIn) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };

    window.addEventListener('popstate', handleBackButton);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('popstate', handleBackButton);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isCheckedIn]);

  // Online / Offline monitor
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Heartbeat & Live App Open Telemetry Sync to Firestore
  useEffect(() => {
    if (!sessionRiderId) return;

    const pulseHeartbeat = async (overrideBattery?: number) => {
      try {
        let batteryPct = overrideBattery;
        if (typeof batteryPct !== 'number') {
          const battInfo = await getLiveBatteryInfo();
          batteryPct = battInfo.level;
        }

        await setDoc(
          doc(db, 'riders', sessionRiderId),
          {
            id: sessionRiderId,
            name: activeRider.name,
            phone: activeRider.phone,
            isAppOpen: true,
            appOpenTime: (activeRider as any).appOpenTime || new Date().toISOString(),
            lastHeartbeatTime: new Date().toISOString(),
            lastHeartbeat: serverTimestamp(),
            lastUpdated: serverTimestamp(),
            battery: batteryPct,
            batteryLevel: batteryPct,
            isOnline: true
          },
          { merge: true }
        );
      } catch (err) {
        // Ignore silent network/quota notice
      }
    };

    pulseHeartbeat();
    const interval = setInterval(() => pulseHeartbeat(), 20000);

    // Also trigger immediate sync whenever device battery changes (e.g. plugged in or dropped)
    const unsubBattery = subscribeToBatteryChanges((info) => {
      pulseHeartbeat(info.level);
    });

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        pulseHeartbeat();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      unsubBattery();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [sessionRiderId, activeRider.name, activeRider.phone, (activeRider as any).appOpenTime]);

  // Today ISO Date string
  // Ticking date, NOT a one-shot useMemo([]).
  //
  // This was memoised with an empty dependency array, so it was captured once at mount and never
  // recalculated. An installed PWA that a rider never force-closes stayed on the date it was first
  // opened -- so the morning after, the app still filtered for yesterday and today's rounds simply
  // never appeared. It now re-checks every minute and updates when the day rolls over.
  const [todayStr, setTodayStr] = useState<string>(() => localDateKey());
  useEffect(() => {
    const tick = () => {
      const current = localDateKey();
      setTodayStr((prev) => (prev === current ? prev : current));
    };
    const interval = window.setInterval(tick, 60000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  // Data Matching: check if a task is strictly assigned to this rider
  const isTaskAssignedToRider = (t: PickupTask) => {
    if (!t) return false;
    if (t.riderId && (t.riderId === sessionRiderId || t.riderId === activeRider.id)) return true;
    if (t.assignedRiderId && (t.assignedRiderId === sessionRiderId || t.assignedRiderId === activeRider.id)) return true;
    if (normalizedSessionPhone && t.riderPhone && normalizePhone(t.riderPhone) === normalizedSessionPhone) return true;
    if (sessionName && t.riderName && t.riderName.trim().toLowerCase() === sessionName.trim().toLowerCase()) return true;
    return false;
  };

  // Data Matching: check if a route is strictly assigned to this rider
  const isRouteAssignedToRider = (r: Route) => {
    if (!r) return false;
    if (r.assignedRiderId && (r.assignedRiderId === sessionRiderId || r.assignedRiderId === activeRider.id)) return true;
    if (normalizedSessionPhone && (r as any).assignedRiderPhone && normalizePhone((r as any).assignedRiderPhone) === normalizedSessionPhone) return true;
    if (sessionName && (r as any).assignedRiderName && (r as any).assignedRiderName.trim().toLowerCase() === sessionName.trim().toLowerCase()) return true;
    // Use the MERGED assignment list (local session + the rider's Firestore document), not just
    // activeRider.assignedRouteIds. activeRider is built from the local session, which on a freshly
    // installed PWA carries no assignments at all -- so a route assigned from the admin's Edit
    // Rider screen was fetched correctly and then discarded right here, and the rider saw
    // "No Assigned Pickups" while the same account showed the route on a cached desktop.
    if (effectiveAssignedRouteIds.includes(r.id)) return true;
    if (liveTasks.some((t) => isTaskAssignedToRider(t) && t.routeId === r.id)) return true;
    return false;
  };

  // Assigned routes list (STRICT: never fallback to other riders' routes)
  const assignedRoutes: Route[] = useMemo(() => {
    const combinedRoutes = new Map<string, Route>();
    routes.filter(isRouteAssignedToRider).forEach((r) => combinedRoutes.set(r.id, r));
    liveRoutes.filter(isRouteAssignedToRider).forEach((r) => combinedRoutes.set(r.id, r));
    return Array.from(combinedRoutes.values());
  }, [routes, liveRoutes, sessionRiderId, activeRider.id, normalizedSessionPhone, sessionName, liveTasks, effectiveAssignedRouteKey]);

  // Filter active / today's tasks strictly for this rider (handles today, scheduledDate, or active ongoing status)
  const todayRiderTasks: PickupTask[] = useMemo(() => {
    const combinedTasks = new Map<string, PickupTask>();
    
    const filterTask = (t: PickupTask) => {
      if (!isTaskAssignedToRider(t)) return false;
      // Same immutable-ID source as the admin feed (see resolveTaskDate), so a stale round cannot
      // reappear in today's list just because a sync rewrote its date field.
      const tDate = resolveTaskDate(t);
      const isActiveStatus = ['assigned', 'started', 'at_stop', 'picked_up', 'in_transit', 'in_progress', 'pending'].includes(t.status);
      // Show task if it's scheduled for today, or if it's an active incomplete task assigned to this rider
      return tDate === todayStr || (!tDate && isActiveStatus) || isActiveStatus;
    };

    tasks.filter(filterTask).forEach((t) => combinedTasks.set(t.id, t));
    liveTasks.filter(filterTask).forEach((t) => combinedTasks.set(t.id, t));
    
    const parseSlotMinutes = (slot?: string): number => {
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

    const taskList = Array.from(combinedTasks.values());
    taskList.sort((a, b) => parseSlotMinutes(a.timeSlot) - parseSlotMinutes(b.timeSlot));
    return taskList;
  }, [tasks, liveTasks, todayStr, sessionRiderId, activeRider.id, normalizedSessionPhone, sessionName]);

  // Build sequential scheduled stops for "My Daily Rounds Schedule"
  // Handles BOTH predefined route loops AND direct/ad-hoc pickup tasks (e.g. laptop pickups, hospital pickups)
  const scheduleStops: ScheduleStopItem[] = useMemo(() => {
    const items: ScheduleStopItem[] = [];
    const processedTaskIds = new Set<string>();

    // 1. Process assigned route loops
    assignedRoutes.forEach((route) => {
      // Prefer the route's configured slots. If a route has none, fall back to the times actually
      // dispatched for it today, then to the per-stop pickup times, before giving up and showing a
      // generic label -- a rider reading "Scheduled Slot" has no idea when they are due anywhere.
      let timeSlots: string[] = route.timeSlots && route.timeSlots.length > 0 ? route.timeSlots : [];

      if (timeSlots.length === 0) {
        const dispatched = todayRiderTasks
          .filter((t) => t.routeId === route.id || t.routeName === route.name)
          .map((t) => t.timeSlot)
          .filter(Boolean) as string[];
        timeSlots = Array.from(new Set(dispatched));
      }

      if (timeSlots.length === 0) {
        const stopTimes = (route.stops || [])
          .map((st: any) => st?.pickupTime)
          .filter(Boolean) as string[];
        timeSlots = Array.from(new Set(stopTimes)).sort();
      }

      if (timeSlots.length === 0) {
        timeSlots = ['Unscheduled'];
      }
      const client = StorageService.getClientById(route.clientId) || { 
        name: (route as any).clientName || route.destinationLab?.name || route.name 
      };

      timeSlots.forEach((slot) => {
        // Find all tasks matching this route and slot today
        const matchingTasks = todayRiderTasks.filter(
          (t) => (t.routeId === route.id || t.routeName === route.name) && (t.timeSlot === slot || !t.timeSlot)
        );

        // Mark all matching tasks as processed to prevent duplicate fallback rendering
        matchingTasks.forEach((t) => processedTaskIds.add(t.id));

        // Pick the active / most updated task for this slot
        const matchedTask = matchingTasks.length > 0 ? matchingTasks[0] : undefined;

        if (matchedTask && matchedTask.stopsProgress && matchedTask.stopsProgress.length > 0) {
          matchedTask.stopsProgress.forEach((sp, spIdx) => {
            const isCollected = sp.status === 'picked_up' || sp.status === 'completed';
            const isInTransit =
              (matchedTask.status === 'started' || matchedTask.status === 'at_stop' || matchedTask.status === 'in_transit') &&
              !isCollected;
            const status: 'pending' | 'in_transit' | 'collected' = isCollected
              ? 'collected'
              : isInTransit
              ? 'in_transit'
              : 'pending';

            items.push({
              id: `${matchedTask.id}-stop-${spIdx}`,
              uniqueKey: `${matchedTask.id}-stop-${spIdx}-${slot}`,
              stopNumber: spIdx + 1,
              stopName: sp.stopName,
              address: sp.address,
              lat: sp.lat || 19.1287852,
              lng: sp.lng || 72.8294183,
              timeSlot: matchedTask.timeSlot || slot,
              pickupTime: (sp as any).pickupTime || '',
              contactPerson: sp.contactPerson || 'Point of Contact',
              phone: sp.phone || '',
              status,
              vialCount: sp.sampleCount,
              coldBoxTemp: sp.coldBoxTemp,
              photoUrl: sp.photoUrl,
              photo2Url: (sp as any).handoverPhotoUrl || (sp as any).photo2Url,
              selfieUrl: (sp as any).selfieUrl,
              taskId: matchedTask.id,
              task: matchedTask,
              routeId: route.id,
              routeName: route.name,
              clientId: route.clientId,
              clientName: matchedTask.clientName || client.name,
              stopIndex: spIdx,
              order: spIdx + 1
            });
          });
        } else {
          // Resolve stops directly from assigned route definition
          const routeStops = route.stops || [];
          routeStops.forEach((rs, rsIdx) => {
            items.push({
              id: `route-${route.id}-slot-${slot.replace(':', '')}-stop-${rsIdx}`,
              uniqueKey: `route-${route.id}-slot-${slot.replace(':', '')}-stop-${rsIdx}`,
              stopNumber: rs.order || rsIdx + 1,
              stopName: rs.name,
              address: rs.address,
              lat: rs.lat || 19.1287852,
              lng: rs.lng || 72.8294183,
              timeSlot: slot,
              pickupTime: (rs as any).pickupTime || '',
              contactPerson: rs.contactPerson || 'Point of Contact',
              phone: rs.phone || '',
              status: 'pending',
              routeId: route.id,
              routeName: route.name,
              clientId: route.clientId,
              clientName: client.name,
              stopIndex: rsIdx,
              order: rs.order || rsIdx + 1
            });
          });
        }
      });
    });

    // 2. Include standalone / ad-hoc tasks directly assigned to this rider (e.g. laptop pickups, on-demand dispatch)
    todayRiderTasks.forEach((task) => {
      if (processedTaskIds.has(task.id)) return;
      processedTaskIds.add(task.id);

      const client = StorageService.getClientById(task.clientId || task.clientLabId) || {
        name: task.clientName || task.clientLabName || 'Pickup Location'
      };

      const taskStops = (task.stopsProgress && task.stopsProgress.length > 0)
        ? task.stopsProgress
        : (task.stops && task.stops.length > 0 ? task.stops : []);

      if (taskStops.length > 0) {
        taskStops.forEach((sp: any, spIdx: number) => {
          const isCollected = sp.status === 'picked_up' || sp.status === 'completed';
          const isInTransit =
            (task.status === 'started' || task.status === 'at_stop' || task.status === 'in_transit') &&
            !isCollected;
          const status: 'pending' | 'in_transit' | 'collected' = isCollected
            ? 'collected'
            : isInTransit
            ? 'in_transit'
            : 'pending';

          items.push({
            id: `${task.id}-stop-${spIdx}`,
            uniqueKey: `${task.id}-stop-${spIdx}`,
            stopNumber: spIdx + 1,
            stopName: sp.stopName || sp.name || task.clientName || 'Assigned Pickup Point',
            address: sp.address || (task as any).clientAddress || task.destination?.address || 'Pickup Address',
            lat: sp.lat || 19.1287852,
            lng: sp.lng || 72.8294183,
            timeSlot: task.timeSlot || 'Immediate Dispatch',
            contactPerson: sp.contactPerson || 'Point of Contact',
            phone: sp.phone || '',
            status,
            vialCount: sp.sampleCount ?? sp.specimenCount ?? 0,
            coldBoxTemp: sp.coldBoxTemp,
            photoUrl: sp.photoUrl,
            photo2Url: (sp as any).handoverPhotoUrl || (sp as any).photo2Url,
            taskId: task.id,
            task: task,
            routeId: task.routeId || `adhoc-${task.id}`,
            routeName: task.routeName || 'Direct Dispatch Pickup',
            clientId: task.clientId || task.clientLabId || '',
            clientName: task.clientName || client.name,
            stopIndex: spIdx,
            order: spIdx + 1
          });
        });
      } else {
        // Single stop task
        const isCollected = task.status === 'picked_up' || task.status === 'delivered' || task.status === 'completed';
        const isInTransit = (task.status === 'started' || task.status === 'at_stop' || task.status === 'in_transit') && !isCollected;
        const status: 'pending' | 'in_transit' | 'collected' = isCollected ? 'collected' : isInTransit ? 'in_transit' : 'pending';

        items.push({
          id: `${task.id}-stop-0`,
          uniqueKey: `${task.id}-stop-0`,
          stopNumber: 1,
          stopName: task.clientName || task.clientLabName || 'Assigned Pickup Point',
          address: (task as any).clientAddress || task.destination?.address || 'Pickup Address',
          lat: task.clientLabLocation?.lat || 19.1287852,
          lng: task.clientLabLocation?.lng || 72.8294183,
          timeSlot: task.timeSlot || 'Immediate Dispatch',
          contactPerson: 'Point of Contact',
          phone: '',
          status,
          vialCount: 0,
          taskId: task.id,
          task: task,
          routeId: task.routeId || `adhoc-${task.id}`,
          routeName: task.routeName || 'Direct Dispatch Pickup',
          clientId: task.clientId || task.clientLabId || '',
          clientName: task.clientName || client.name,
          stopIndex: 0,
          order: 1
        });
      }
    });

    return items;
  }, [assignedRoutes, todayRiderTasks]);

  // Find currently active task strictly from this rider's tasks
  const activeTask = useMemo(() => {
    // 1. Explicitly selected task if not delivered
    const allKnownTasks = [...liveTasks, ...todayRiderTasks, ...tasks, ...StorageService.getTasks()];
    if (activeTaskId) {
      const explicit = allKnownTasks.find((t) => t.id === activeTaskId);
      if (explicit && explicit.status !== 'delivered' && (explicit.destination as any)?.status !== 'delivered') {
        return explicit;
      }
      if (explicit) return explicit;
    }
    // 2. Any active in-progress task (started, at_stop, picked_up, in_transit)
    const inProgress = todayRiderTasks.find((t) =>
      ['started', 'at_stop', 'picked_up', 'in_transit'].includes(t.status)
    );
    if (inProgress) return inProgress;

    // 3. First non-delivered pending task chronologically
    const nextPending = todayRiderTasks.find(
      (t) => t.status !== 'delivered' && t.status !== 'completed' && (t.destination as any)?.status !== 'delivered'
    );
    if (nextPending) return nextPending;

    // 4. Fallback to first task if all are delivered
    return todayRiderTasks[0] || null;
  }, [todayRiderTasks, activeTaskId, liveTasks, tasks]);

  const activeRoute = useMemo(() => {
    if (!activeTask) return assignedRoutes[0] || null;
    return assignedRoutes.find((r) => r.id === activeTask.routeId) || assignedRoutes[0] || null;
  }, [assignedRoutes, activeTask]);

  const [gpsStatus, setGpsStatus] = useState<GpsStatusEvent>(LocationService.getStatus());

  // Listen to GPS status events (permissions, errors, mode)
  useEffect(() => {
    const unsub = LocationService.subscribeStatus((status) => {
      setGpsStatus(status);
    });
    return () => unsub();
  }, []);

  // Start real GPS broadcasting strictly for active rider ID using LocationService with smart throttling
  useEffect(() => {
    if (isCheckedIn && sessionRiderId) {
      LocationService.startRealGeolocation(sessionRiderId, activeRider.name, activeTask?.id);
    } else {
      LocationService.stop();
    }
    return () => {
      LocationService.stop();
    };
  }, [isCheckedIn, sessionRiderId, activeRider.name, activeTask?.id]);

  // Handle Attendance Toggle & Confirmation
  const handleToggleAttendance = () => {
    if (!isCheckedIn) {
      // Opening duty: open vehicle selection & punch-in setup modal
      setShowVehicleDutyModal(true);
    } else {
      // Currently On Duty: confirm before exiting / ending shift
      setShowExitConfirmModal(true);
    }
  };

  const handleConfirmExit = async () => {
    setShowExitConfirmModal(false);
    setIsCheckedIn(false);
    LocationService.stop();

    try {
      await setDoc(
        doc(db, 'riders', sessionRiderId),
        {
          id: sessionRiderId,
          isCheckedIn: false,
          status: 'off_duty',
          isOnline: false,
          lastUpdated: serverTimestamp()
        },
        { merge: true }
      );
    } catch (e) {
      console.warn('Firestore update off_duty error:', e);
    }

    StorageService.clearPortalSession('rider');
    StorageService.updateRider({
      ...activeRider,
      isCheckedIn: false
    });

    onRefresh();
    navigate('/rider/login', { replace: true });
  };

  const handleSaveVehicleAndDuty = async (newType: string, newPlate: string, startShift: boolean) => {
    const cleanPlate = (newPlate || selectedVehicleNumber || '').toUpperCase().trim();
    const cleanType = newType || selectedVehicleType || 'Motorcycle / Bike';

    setSelectedVehicleType(cleanType);
    setSelectedVehicleNumber(cleanPlate);

    const nextChecked = startShift ? true : isCheckedIn;
    setIsCheckedIn(nextChecked);

    const updatedRider: PickupBoy = {
      ...activeRider,
      vehicleType: cleanType,
      vehicleNumber: cleanPlate,
      plateNumber: cleanPlate,
      isCheckedIn: nextChecked
    };

    StorageService.updateRider(updatedRider);

    try {
      await setDoc(
        doc(db, 'riders', sessionRiderId),
        {
          id: sessionRiderId,
          name: activeRider.name,
          phone: activeRider.phone,
          vehicleNo: cleanPlate,
          vehicleNumber: cleanPlate,
          vehicleType: cleanType,
          isCheckedIn: nextChecked,
          status: nextChecked ? 'active' : 'off_duty',
          isOnline: nextChecked,
          lastUpdated: serverTimestamp()
        },
        { merge: true }
      );
    } catch (err) {
      console.warn('[RiderDashboard] Firestore sync vehicle error:', err);
    }

    if (startShift) {
      const nowIso = new Date().toISOString();
      const firstSlotInfo = getRiderFirstRouteSlot(activeRider, assignedRoutes, todayRiderTasks);
      const slotStr = firstSlotInfo?.slot || '10:00 AM - 12:00 PM';
      const slotMinutes = parseSlotToMinutes(slotStr);
      const punchInDate = new Date(nowIso);
      const punchInMinutes = punchInDate.getHours() * 60 + punchInDate.getMinutes();
      const diffMinutes = slotMinutes - punchInMinutes;

      let punctuality: 'early' | 'on_time' | 'late' = 'on_time';
      if (diffMinutes >= 10) punctuality = 'early';
      else if (diffMinutes < -5) punctuality = 'late';

      try {
        await setDoc(
          doc(db, 'riders', sessionRiderId),
          {
            todayPunchInTime: nowIso,
            firstScheduledRouteTime: slotStr,
            punchInPunctuality: punctuality,
            punchInDiffMinutes: diffMinutes,
            isCheckedIn: true,
            status: 'active',
            isOnline: true,
            lastUpdated: serverTimestamp()
          },
          { merge: true }
        );
      } catch (e) {
        console.warn('Error updating rider punctuality:', e);
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          StorageService.addAttendanceRecord({
            id: `att-${Date.now()}`,
            riderId: activeRider.id,
            riderName: activeRider.name,
            date: todayStr,
            checkInTime: nowIso,
            checkInLocation: {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              address: 'Kandivali Dispatch Hub, Mumbai'
            },
            status: 'on_duty',
            firstRouteSlot: slotStr,
            punchInPunctuality: punctuality,
            punchInDiffMinutes: diffMinutes
          });
          onRefresh();
        },
        () => {
          StorageService.addAttendanceRecord({
            id: `att-${Date.now()}`,
            riderId: activeRider.id,
            riderName: activeRider.name,
            date: todayStr,
            checkInTime: nowIso,
            checkInLocation: {
              lat: 19.2082,
              lng: 72.8398,
              address: 'Kandivali Dispatch Hub, Mumbai'
            },
            status: 'on_duty',
            firstRouteSlot: slotStr,
            punchInPunctuality: punctuality,
            punchInDiffMinutes: diffMinutes
          });
          onRefresh();
        }
      );
    }

    setShowVehicleDutyModal(false);
    onRefresh();
  };

  // Start Route
  const handleStartRoute = (task: PickupTask) => {
    const updated: PickupTask = {
      ...task,
      status: 'started',
      startedAt: new Date().toISOString()
    };
    StorageService.updateTask(updated);
    setActiveTaskId(task.id);
    CloudSync.startTripRoute(task.id, sessionRiderId);
    onRefresh();

    NotificationService.sendAlert({
      type: 'pickup',
      title: `Rider En Route: ${task.timeSlot} Loop`,
      message: `${activeRider.name} has started collection round for ${task.clientName}.`,
      recipientRole: 'both',
      channel: 'both'
    });
  };

  // Handle Photo Upload with 2-Photo Proof & Watermarking
  // Process uploaded/captured photo file with watermark & fallbacks
  const processSelectedFile = async (file: File, photoType: 'photo1' | 'photo2' | 'drop') => {
    if (!file) return;
    setWatermarking(true);

    const safeStops = activeTask?.stopsProgress || (activeTask as any)?.stops || [];
    const currentStop = safeStops[currentStopIndex] || safeStops[0];
    const stopLat = currentStop?.lat || (currentStop as any)?.latitude || 19.2082;
    const stopLng = currentStop?.lng || (currentStop as any)?.longitude || 72.8398;
    const stopAddr =
      photoType === 'drop'
        ? activeTask?.destination?.name || activeTask?.destination?.address || 'Processing Facility'
        : currentStop?.stopName || currentStop?.address || 'Collection Stop';

    // Hard ceiling on the whole capture step. addWatermarkToImage has its own internal timeout,
    // but it can still leave the promise unsettled on some devices (a FileReader that never fires
    // onload), which left "Processing & Geotagging..." spinning forever with no way forward. This
    // guarantees the overlay clears and the rider gets a usable photo either way.
    const withHardTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
      Promise.race([
        promise,
        new Promise<T>((_, rej) => setTimeout(() => rej(new Error('Photo processing timed out')), ms))
      ]);

    try {
      // High-definition watermark with dynamic sizing & zero overlap
      const watermarked = await withHardTimeout(addWatermarkToImage(file, {
        timestamp: new Date().toISOString(),
        lat: stopLat,
        lng: stopLng,
        address: stopAddr,
        riderName: activeRider.name,
        clientName: activeTask?.clientName || (activeTask as any)?.destination?.name || '',
        vialCount: vialCount,
        temperature: coldBoxTemp,
        isDrop: photoType === 'drop',
        isSelfie: photoType === 'photo2',
        receiverName: photoType === 'drop' ? receiverName : undefined
      }), 8000);

      if (photoType === 'photo1') setStopPhoto(watermarked);
      else if (photoType === 'photo2') setStopPhoto2(watermarked);
      else setStopPhoto(watermarked);
    } catch (err) {
      console.warn('Watermark generation warning, using compressed fallback:', err);
      try {
        const fallbackBase64 = await withHardTimeout(compressImageToBase64(file, 1080, 0.80), 6000);
        if (photoType === 'photo1') setStopPhoto(fallbackBase64);
        else if (photoType === 'photo2') setStopPhoto2(fallbackBase64);
        else setStopPhoto(fallbackBase64);
      } catch (fallbackErr) {
        console.error('Photo compression fallback error, using FileReader direct:', fallbackErr);
        await new Promise<void>((resolve) => {
          const reader = new FileReader();
          const done = () => resolve();
          reader.onload = (re) => {
            const directBase64 = re.target?.result as string;
            if (directBase64) {
              if (photoType === 'photo1') setStopPhoto(directBase64);
              else if (photoType === 'photo2') setStopPhoto2(directBase64);
              else setStopPhoto(directBase64);
            }
            done();
          };
          reader.onerror = done;
          // Never leave the rider staring at a spinner if even this fails.
          setTimeout(done, 6000);
          reader.readAsDataURL(file);
        });
      }
    } finally {
      setWatermarking(false);
    }
  };

  // Handle Photo Upload with 2-Photo Proof & Watermarking from input change
  const handlePhotoCapture = async (
    e: React.ChangeEvent<HTMLInputElement>,
    photoType: 'photo1' | 'photo2' | 'drop'
  ) => {
    const file = e.target.files?.[0];
    if (e.target) {
      e.target.value = '';
    }
    if (!file) return;
    await processSelectedFile(file, photoType);
  };

  // Start collection / upload 2-photo proof directly from schedule stop card
  const handleStartStopCollectionFromSchedule = (stopItem: ScheduleStopItem) => {
    const findExistingTask = () => {
      if (stopItem.task) return stopItem.task;
      const allKnown = [...todayRiderTasks, ...liveTasks, ...tasks, ...StorageService.getTasks()];
      return allKnown.find(
        (t) =>
          t &&
          (t.routeId === stopItem.routeId || t.routeName === stopItem.routeName) &&
          (t.timeSlot === stopItem.timeSlot || !t.timeSlot) &&
          (t.date === todayStr || t.scheduledDate === todayStr || ['started', 'at_stop', 'picked_up', 'in_transit', 'assigned'].includes(t.status))
      );
    };

    let targetTask = findExistingTask();

    if (!targetTask) {
      // Find or build task for this assigned route and timing slot
      const matchingRoute = liveRoutes.find((r) => r.id === stopItem.routeId || r.name === stopItem.routeName) ||
        routes.find((r) => r.id === stopItem.routeId || r.name === stopItem.routeName) ||
        liveRoutes[0] ||
        routes[0];

      const canonicalTaskId = buildCanonicalTaskId(matchingRoute?.id || stopItem.routeId, stopItem.timeSlot, todayStr);

      const rawRouteStops = (matchingRoute?.stops && matchingRoute.stops.length > 0)
        ? matchingRoute.stops
        : [];

      const stopsProgress: StopProgress[] = rawRouteStops.map((s: any, idx: number) => ({
        stopId: s.id || `stop-${idx + 1}`,
        id: s.id || `stop-${idx + 1}`,
        stopName: s.name || s.stopName || '',
        name: s.name || s.stopName || '',
        address: s.address || '',
        lat: s.lat || 19.1287852,
        lng: s.lng || 72.8294183,
        contactPerson: s.contactPerson || '',
        phone: s.phone || '',
        pickupTime: s.pickupTime || '',
        status: 'pending',
        sampleCount: 0,
        specimenCount: 0
      }));

      const client = StorageService.getClientById(matchingRoute?.clientId || '') || {
        id: matchingRoute?.clientId || '',
        name: matchingRoute?.destinationLab?.name || (matchingRoute as any)?.clientName || '',
        address: matchingRoute?.destinationLab?.address || ''
      };

      targetTask = {
        id: canonicalTaskId,
        date: todayStr,
        scheduledDate: todayStr,
        timeSlot: stopItem.timeSlot || '',
        routeId: matchingRoute?.id || stopItem.routeId || '',
        routeName: matchingRoute?.name || stopItem.routeName || '',
        clientId: client.id,
        clientName: client.name,
        riderId: activeRider.id,
        riderName: activeRider.name,
        riderPhone: activeRider.phone,
        riderVehicle: activeRider.vehicleNumber,
        status: 'started',
        currentStopIndex: stopItem.stopIndex || 0,
        pickupLocation: {
          name: rawRouteStops[0]?.name || client.name || '',
          address: rawRouteStops[0]?.address || client.address || '',
          lat: rawRouteStops[0]?.lat || 19.1363,
          lng: rawRouteStops[0]?.lng || 72.8277,
          area: ''
        },
        deliveryLocation: {
          name: matchingRoute?.destinationLab?.name || client.name || '',
          address: matchingRoute?.destinationLab?.address || client.address || '',
          lat: matchingRoute?.destinationLab?.lat || 19.1860,
          lng: matchingRoute?.destinationLab?.lng || 72.8485,
          area: ''
        },
        stopsProgress,
        stops: stopsProgress.map((sp: any) => ({
          id: sp.id || sp.stopId,
          stopId: sp.stopId || sp.id,
          name: sp.stopName,
          stopName: sp.stopName,
          address: sp.address,
          lat: sp.lat,
          lng: sp.lng,
          status: sp.status,
          sampleCount: sp.sampleCount || 0,
          specimenCount: sp.sampleCount || 0,
          pickupTime: sp.pickupTime || '',
          contactPerson: sp.contactPerson || '',
          phone: sp.phone || ''
        })),
        destination: {
          name: matchingRoute?.destinationLab?.name || client.name || '',
          address: matchingRoute?.destinationLab?.address || client.address || '',
          lat: matchingRoute?.destinationLab?.lat || 19.1860,
          lng: matchingRoute?.destinationLab?.lng || 72.8485,
          receiverName: matchingRoute?.destinationLab?.contactPerson || '',
          notes: ''
        },
        isDelayed: false,
        delayMinutes: 0,
        issueFlags: [],
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString()
      };

      StorageService.addTask(targetTask);
    } else if (targetTask.status === 'upcoming' || targetTask.status === 'pending') {
      targetTask = {
        ...targetTask,
        status: 'started',
        startedAt: targetTask.startedAt || new Date().toISOString()
      };
      StorageService.updateTask(targetTask);
    }

    setActiveTaskId(targetTask.id);
    const stopIdx = stopItem.stopIndex !== undefined ? stopItem.stopIndex : 0;
    setCurrentStopIndex(stopIdx);

    setLiveTasks((prev) => {
      const exists = prev.some((t) => t.id === targetTask!.id);
      if (exists) {
        return prev.map((t) => (t.id === targetTask!.id ? targetTask! : t));
      }
      return [targetTask!, ...prev];
    });

    const safeStops = targetTask.stopsProgress || targetTask.stops || [];
    const targetStop = safeStops[stopIdx] || safeStops[0];
    const rawVials = (targetStop as any)?.sampleCount ?? (targetStop as any)?.specimenCount ?? 0;
    const existingRemark = (targetStop as any)?.remark || ((targetStop as any)?.status === 'no_sample' || (targetStop as any)?.noSampleReason ? 'No Sample' : (rawVials > 0 ? 'Collected sample' : 'Collected sample'));

    if (existingRemark === 'No Sample' || (targetStop as any)?.status === 'no_sample') {
      setPickupRemarkType('No Sample');
      setPickupCustomRemark('');
      setVialCount(0);
    } else if (typeof existingRemark === 'string' && existingRemark.startsWith('Other')) {
      setPickupRemarkType('Other');
      setPickupCustomRemark(existingRemark.replace(/^Other:?\s*/i, ''));
      setVialCount(rawVials);
    } else {
      setPickupRemarkType('Collected sample');
      setPickupCustomRemark('');
      setVialCount(rawVials > 0 ? rawVials : 1);
    }

    setColdBoxTemp((targetStop as any)?.coldBoxTemp ?? 4.0);
    setStopPhoto((targetStop as any)?.photoUrl || null);
    setStopPhoto2((targetStop as any)?.handoverPhotoUrl || (targetStop as any)?.photo2Url || (targetStop as any)?.selfieUrl || null);
    setPickupFormError(null);
    setIsProcessingStop(true);
    onRefresh();
  };

  // Start Lab Drop / Handover from Daily Rounds Schedule
  const handleStartDropFromSchedule = (task: PickupTask | undefined, route: Route, slot: string) => {
    const findExistingTask = () => {
      if (task) return task;
      const allKnown = [...todayRiderTasks, ...liveTasks, ...tasks, ...StorageService.getTasks()];
      return allKnown.find(
        (t) =>
          t &&
          (t.routeId === route?.id || t.routeName === route?.name) &&
          (t.timeSlot === slot || !t.timeSlot) &&
          (t.date === todayStr || t.scheduledDate === todayStr || ['started', 'at_stop', 'picked_up', 'in_transit', 'assigned', 'delivered', 'completed'].includes(t.status))
      );
    };

    let targetTask = findExistingTask();

    if (!targetTask) {
      const canonicalTaskId = buildCanonicalTaskId(route?.id, slot, todayStr);

      const client = StorageService.getClientById(route?.clientId || '') || {
        id: route?.clientId || '',
        name: route?.destinationLab?.name || (route as any)?.clientName || '',
        address: route?.destinationLab?.address || ''
      };

      const rawRouteStops = (route?.stops && route.stops.length > 0)
        ? route.stops
        : [];

      const stopsProgress: StopProgress[] = rawRouteStops.map((s: any, idx: number) => ({
        stopId: s.id || `stop-${idx + 1}`,
        id: s.id || `stop-${idx + 1}`,
        stopName: s.name || s.stopName || '',
        name: s.name || s.stopName || '',
        address: s.address || '',
        lat: s.lat || 19.1287852,
        lng: s.lng || 72.8294183,
        contactPerson: s.contactPerson || '',
        phone: s.phone || '',
        pickupTime: s.pickupTime || '',
        status: 'picked_up',
        sampleCount: s.sampleCount || 0,
        specimenCount: s.sampleCount || 0
      }));

      targetTask = {
        id: canonicalTaskId,
        date: todayStr,
        scheduledDate: todayStr,
        timeSlot: slot,
        routeId: route?.id || '',
        routeName: route?.name || '',
        clientId: client.id,
        clientName: client.name,
        riderId: activeRider.id,
        riderName: activeRider.name,
        riderPhone: activeRider.phone,
        riderVehicle: activeRider.vehicleNumber,
        status: 'in_transit',
        currentStopIndex: stopsProgress.length,
        pickupLocation: {
          name: rawRouteStops[0]?.name || client.name || '',
          address: rawRouteStops[0]?.address || client.address || '',
          lat: rawRouteStops[0]?.lat || 19.1363,
          lng: rawRouteStops[0]?.lng || 72.8277,
          area: ''
        },
        deliveryLocation: {
          name: route?.destinationLab?.name || client.name || '',
          address: route?.destinationLab?.address || client.address || '',
          lat: route?.destinationLab?.lat || 19.1860,
          lng: route?.destinationLab?.lng || 72.8485,
          area: ''
        },
        stopsProgress,
        stops: stopsProgress.map((sp: any) => ({
          id: sp.id || sp.stopId,
          stopId: sp.stopId || sp.id,
          name: sp.stopName,
          stopName: sp.stopName,
          address: sp.address,
          lat: sp.lat,
          lng: sp.lng,
          status: sp.status,
          sampleCount: sp.sampleCount || 0,
          specimenCount: sp.sampleCount || 0,
          pickupTime: sp.pickupTime || '',
          contactPerson: sp.contactPerson,
          phone: sp.phone
        })),
        destination: {
          name: route?.destinationLab?.name || client.name,
          address: route?.destinationLab?.address || client.address,
          lat: route?.destinationLab?.lat || 19.1860,
          lng: route?.destinationLab?.lng || 72.8485,
          receiverName: route?.destinationLab?.contactPerson || 'Jayesh joshi',
          notes: 'Specimen cold-chain transport'
        },
        isDelayed: false,
        delayMinutes: 0,
        issueFlags: [],
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString()
      };

      StorageService.addTask(targetTask);
    }

    setActiveTaskId(targetTask.id);
    setReceiverName(
      route?.destinationLab?.contactPerson ||
      (targetTask.destination as any)?.receiverName ||
      targetTask.receiverName ||
      'Jayesh joshi'
    );
    setColdBoxTemp(targetTask.destination?.coldBoxTempAtDrop ?? 4.0);
    setStopPhoto(targetTask.destination?.dropPhotoUrl || (targetTask as any).handoverPhotoUrl || null);
    setStopPhoto2(null);
    setDropFormError(null);
    setIsProcessingDrop(true);
    onRefresh();
  };

  // Confirm Stop Pickup with 2-Photo Proof (Specimens & Selfie) & Remark
  const handleConfirmStopPickup = async () => {
    const allKnownTasks = [...liveTasks, ...todayRiderTasks, ...tasks, ...StorageService.getTasks()];
    const currentTask = (activeTaskId ? allKnownTasks.find((t) => t.id === activeTaskId) : null) || activeTask;

    if (!currentTask) {
      console.warn("No active task to update in handleConfirmStopPickup");
      return;
    }

    // Determine final remark and vial count based on rider selection
    const finalRemark =
      pickupRemarkType === 'Collected sample'
        ? 'Collected sample'
        : pickupRemarkType === 'No Sample'
        ? 'No Sample'
        : pickupCustomRemark.trim()
        ? `Other: ${pickupCustomRemark.trim()}`
        : 'Other';

    const finalVialCount = pickupRemarkType === 'No Sample' ? 0 : Math.max(0, vialCount);

    // Proof Validations based on selected remark
    if (pickupRemarkType === 'Collected sample') {
      if (finalVialCount <= 0) {
        setPickupFormError('Please enter at least 1 vial for "Collected sample", or choose "No Sample" if zero specimens were available.');
        return;
      }
      if (!stopPhoto && !stopPhoto2) {
        setPickupFormError('Mandatory Proofs Required: Please capture/upload both "Specimen Vials in Chiller Rack" AND "Rider Location Selfie" before confirming.');
        return;
      }
      if (!stopPhoto) {
        setPickupFormError('Mandatory Photo 1 Missing: Please capture/upload photo of "Specimen Vials in Chiller Rack".');
        return;
      }
      if (!stopPhoto2) {
        setPickupFormError('Mandatory Photo 2 Missing: Please capture/upload "Rider Location Selfie" to verify on-site presence.');
        return;
      }
    } else if (pickupRemarkType === 'No Sample') {
      if (!stopPhoto2 && !stopPhoto) {
        setPickupFormError('Mandatory Arrival Proof: Please capture/upload "Rider Location Selfie" to verify on-site presence for No Sample.');
        return;
      }
    } else {
      // Other
      if (!stopPhoto2 && !stopPhoto) {
        setPickupFormError('Mandatory Proof Required: Please capture/upload "Rider Location Selfie" or verification photo.');
        return;
      }
    }

    setPickupFormError(null);

    const rawStops = (currentTask.stopsProgress && currentTask.stopsProgress.length > 0)
      ? currentTask.stopsProgress
      : (currentTask.stops && currentTask.stops.length > 0 ? currentTask.stops : []);

    const safeStops: any[] = rawStops.length > 0 ? [...rawStops] : [{
      id: 'stop-1',
      stopId: 'stop-1',
      stopName: currentTask.clientName || 'Assigned Pickup Point',
      name: currentTask.clientName || 'Assigned Pickup Point',
      address: currentTask.pickupLocation?.address || currentTask.destination?.address || 'Mumbai Pickup Point',
      lat: currentTask.pickupLocation?.lat || 19.1287852,
      lng: currentTask.pickupLocation?.lng || 72.8294183,
      status: 'pending',
      sampleCount: finalVialCount
    }];

    const targetIdx = Math.max(0, Math.min(currentStopIndex, safeStops.length - 1));
    const stopToUpdate = safeStops[targetIdx] || safeStops[0] || { stopName: 'Collection Point' };
    const stopName = stopToUpdate.stopName || stopToUpdate.name || 'Collection Stop';

    // Upload captured photos to Cloud Storage instead of embedding raw base64 in the Firestore
    // document. Base64 photos are ~200-400KB each; a couple of stops' worth easily blows past
    // Firestore's 1MiB per-document limit, and that write failure was previously silent (the photo
    // looked fine locally but never actually persisted). We upload first and only proceed once we
    // have real, short download URLs — if the upload fails, we stop here and tell the rider,
    // instead of quietly losing the photo.
    setWatermarking(true);
    let uploadedSamplePhoto: string | undefined;
    let uploadedSelfiePhoto: string | undefined;
    let photosPendingUpload = false;
    try {
      const uploadTimestamp = Date.now();
      if (stopPhoto) {
        uploadedSamplePhoto = await uploadPhotoToStorage(
          stopPhoto,
          `proofs/${currentTask.id}/stop-${targetIdx}-specimen-${uploadTimestamp}.jpg`
        );
      }
      if (stopPhoto2) {
        uploadedSelfiePhoto = await uploadPhotoToStorage(
          stopPhoto2,
          `proofs/${currentTask.id}/stop-${targetIdx}-selfie-${uploadTimestamp}.jpg`
        );
      }
    } catch (uploadErr) {
      // OFFLINE PATH. This used to bail out with an error and `return`, which made the offline
      // queue unreachable: a rider with no signal could never record a pickup at all, and nothing
      // was ever queued because the function exited before reaching the queue. Now the capture is
      // kept locally, with the full-resolution base64 photos, and the upload is retried later.
      console.warn('[RiderDashboard] Photo upload deferred (offline or upload failed):', uploadErr);
      photosPendingUpload = true;
    }
    setWatermarking(false);

    const finalSamplePhoto = uploadedSamplePhoto || stopToUpdate.photoUrl || (stopToUpdate as any).photo;
    const finalSelfiePhoto = uploadedSelfiePhoto || (stopToUpdate as any).handoverPhotoUrl || (stopToUpdate as any).photo2Url || (stopToUpdate as any).selfieUrl || finalSamplePhoto;

    const stopStatus: StopStatus = pickupRemarkType === 'No Sample' ? 'no_sample' : 'picked_up';

    const stopNotes =
      pickupRemarkType === 'No Sample'
        ? 'No Sample - Verified at collection point (0 samples ready).'
        : pickupRemarkType === 'Collected sample'
        ? `${finalVialCount} specimen vials collected and sealed in chiller rack.`
        : `Other: ${pickupCustomRemark.trim() || 'Special condition noted'} (${finalVialCount} vials)`;

    const updatedStops: StopProgress[] = safeStops.map((s, idx) => {
      if (idx === targetIdx) {
        return {
          ...s,
          status: stopStatus,
          pickedUpAt: s.pickedUpAt || new Date().toISOString(),
          arrivedAt: s.arrivedAt || new Date().toISOString(),
          sampleCount: finalVialCount,
          specimenCount: finalVialCount,
          coldBoxTemp: coldBoxTemp,
          photoUrl: finalSamplePhoto || s.photoUrl || undefined,
          handoverPhotoUrl: finalSelfiePhoto || (s as any).handoverPhotoUrl || undefined,
          photo2Url: finalSelfiePhoto || (s as any).photo2Url || undefined,
          selfieUrl: finalSelfiePhoto || (s as any).selfieUrl || undefined,
          photoTimestamp: new Date().toISOString(),
          photoLocation: { lat: s.lat || 19.2082, lng: s.lng || 72.8398, accuracy: 5 },
          notes: stopNotes,
          remark: finalRemark,
          noSampleReason: pickupRemarkType === 'No Sample' ? 'No Sample ready at collection point' : undefined
        };
      }
      return s;
    });

    const isStopComplete = (st: any) =>
      st.status === 'picked_up' ||
      st.status === 'completed' ||
      st.status === 'no_sample' ||
      (st.sampleCount !== undefined && st.sampleCount > 0 && !!st.pickedUpAt) ||
      (!!st.photoUrl && st.status !== 'pending');

    const isAllStopsPicked = updatedStops.every((s) => isStopComplete(s));

    const updatedTask: PickupTask = {
      ...currentTask,
      status: isAllStopsPicked ? 'in_transit' : 'at_stop',
      stopsProgress: updatedStops,
      stops: updatedStops.map((sp: any) => ({
        id: sp.id || sp.stopId,
        stopId: sp.stopId || sp.id,
        name: sp.stopName || sp.name,
        stopName: sp.stopName || sp.name,
        address: sp.address,
        lat: sp.lat,
        lng: sp.lng,
        status: sp.status,
        sampleCount: sp.sampleCount ?? sp.specimenCount ?? 0,
        specimenCount: sp.sampleCount ?? sp.specimenCount ?? 0,
        pickupTime: sp.pickupTime || '',
        photoUrl: sp.photoUrl || '',
        photo2Url: sp.photo2Url || sp.handoverPhotoUrl || sp.selfieUrl || '',
        handoverPhotoUrl: sp.handoverPhotoUrl || sp.photo2Url || sp.selfieUrl || '',
        selfieUrl: sp.selfieUrl || sp.photo2Url || sp.handoverPhotoUrl || '',
        coldBoxTemp: sp.coldBoxTemp,
        arrivedAt: sp.arrivedAt,
        pickedUpAt: sp.pickedUpAt,
        completedAt: sp.completedAt,
        photoTimestamp: sp.photoTimestamp,
        photoLocation: sp.photoLocation,
        notes: sp.notes || '',
        remark: sp.remark,
        noSampleReason: sp.noSampleReason
      })),
      photoUrl: finalSamplePhoto || currentTask.photoUrl,
      photo2Url: finalSelfiePhoto || currentTask.photo2Url,
      selfieUrl: finalSelfiePhoto || currentTask.selfieUrl,
      // NOT the stop selfie. `handoverPhotoUrl` at TASK level means the final lab-drop proof, and
      // is written only by the handover flow below. Writing a collection-stop selfie here made the
      // last pickup selfie appear as the "Lab Intake Watermarked Proof" in the chain-of-custody
      // record before any drop had happened.
      handoverPhotoUrl: currentTask.handoverPhotoUrl,
      coldBoxTemp: coldBoxTemp,
      sampleCount: updatedStops.reduce((sum, st) => sum + (st.sampleCount || 0), 0)
    };

    setLiveTasks((prev) => {
      const exists = prev.some((t) => t.id === updatedTask.id);
      if (exists) {
        return prev.map((t) => (t.id === updatedTask.id ? updatedTask : t));
      }
      return [updatedTask, ...prev];
    });
    StorageService.updateTask(updatedTask);
    // OFFLINE-SAFE SAVE.
    //
    // The proof IS the product here, and riders work in hospital basements, lifts and car parks.
    // Previously this fired a Firestore write and moved on; if that write failed the capture was
    // only ever in local task state, with nothing to retry it. StorageService already had an
    // offline queue (addToOfflineQueue / getOfflineQueue / removeFromOfflineQueue) written for
    // exactly this, and nothing in the app had ever called it.
    const proofPayload = {
      sampleCount: finalVialCount,
      coldBoxTemp: coldBoxTemp,
      photoUrl: finalSamplePhoto || '',
      handoverPhotoUrl: finalSelfiePhoto || '',
      photo2Url: finalSelfiePhoto || '',
      selfieUrl: finalSelfiePhoto || '',
      notes: stopNotes,
      remark: finalRemark,
      status: stopStatus,
      noSampleReason: pickupRemarkType === 'No Sample' ? 'No Sample ready at collection point' : undefined
    };

    const queueId = `q-${currentTask.id}-${targetIdx}-${Date.now()}`;
    const queuedOk = StorageService.addToOfflineQueue({
      id: queueId,
      taskId: currentTask.id,
      stopId: String(targetIdx),
      isDrop: false,
      photoBlobOrDataUrl: finalSamplePhoto || '',
      location: {
        lat: Number((activeRider as any)?.lat || (activeRider as any)?.currentLocation?.lat || 0),
        lng: Number((activeRider as any)?.lng || (activeRider as any)?.currentLocation?.lng || 0)
      },
      timestamp: new Date().toISOString(),
      sampleCount: finalVialCount,
      coldBoxTemp: coldBoxTemp,
      notes: stopNotes,
      queuedAt: new Date().toISOString(),
      status: 'pending',
      photosPendingUpload,
      rawPhoto1: photosPendingUpload ? stopPhoto || '' : '',
      rawPhoto2: photosPendingUpload ? stopPhoto2 || '' : '',
      // Store the EXACT arguments the write needs, not just photo 1.
      //
      // The retry used to rebuild its payload from whatever task state existed at flush time,
      // which meant the selfie, remark and status were lost, and a Firestore snapshot arriving in
      // between could replace the stops array with a server copy that has no photos in it at all.
      // Replaying the original payload verbatim is the only version that survives that.
      stopsSnapshot: updatedStops,
      extraPayload: proofPayload
    } as any);

    setSyncBanner({ state: 'saving', message: 'Saving proof...' });

    if (photosPendingUpload) {
      // Writing base64 photos into Firestore would exceed the 1MiB document limit, so the write
      // waits until the photos have a storage URL. The capture itself is safe on the device.
      setSyncBanner({
        state: 'queued',
        message: 'Saved on this phone. Photos will upload automatically when you have signal.'
      });
    }

    if (!queuedOk) {
      // The photos could not be stored on the device at all (storage full). Say so rather than
      // implying the capture is safe.
      setSyncBanner({
        state: 'queued',
        message: 'Phone storage is full - this proof could not be saved offline. Stay online until it uploads.'
      });
    }

    if (!photosPendingUpload)
    CloudSync.completeTripStop(currentTask.id, targetIdx, updatedStops, proofPayload)
      .then(() => {
        StorageService.removeFromOfflineQueue(queueId);
        setSyncBanner({ state: 'synced', message: 'Saved and synced to Ops.' });
      })
      .catch(() => {
        setSyncBanner({
          state: 'queued',
          message: 'Saved on this phone. It will upload automatically when you have signal.'
        });
      });
    setIsProcessingStop(false);
    setStopPhoto(null);
    setStopPhoto2(null);
    setVialCount(1);
    setPickupRemarkType('Collected sample');
    setPickupCustomRemark('');

    // Advance to next pending stop index automatically
    const nextPendingIndex = updatedStops.findIndex((st) => !isStopComplete(st));
    if (nextPendingIndex !== -1) {
      setCurrentStopIndex(nextPendingIndex);
    }
    onRefresh();

    const notifTitle =
      pickupRemarkType === 'No Sample'
        ? `No Sample Recorded at ${stopName}`
        : pickupRemarkType === 'Collected sample'
        ? `Sample Picked: ${finalVialCount} Vials`
        : `Stop Remark Logged: ${finalRemark}`;

    NotificationService.sendAlert({
      type: 'pickup',
      title: notifTitle,
      message: `${activeRider.name} updated ${stopName}: [${finalRemark}] ${finalVialCount > 0 ? `${finalVialCount} vials collected.` : ''} Cold box: ${coldBoxTemp}°C.`,
      recipientRole: 'both',
      channel: 'both'
    });
  };

  // Complete Destination Lab Delivery
  const handleConfirmLabDelivery = async () => {
    if (!activeTask) return;

    if (!stopPhoto) {
      setDropFormError('Mandatory Proof Missing: Please capture/upload or generate the Lab Handover Proof photo before completing delivery.');
      return;
    }
    if (!receiverName || !receiverName.trim()) {
      setDropFormError('Mandatory Field Missing: Please enter the Receiver Name / Pathologist in Lab.');
      return;
    }

    setDropFormError(null);

    // Upload to Cloud Storage rather than embedding base64 directly on the task document —
    // see the matching note in handleConfirmStopPickup for why.
    let finalLabPhoto: string;
    let dropPhotoPending = false;
    setWatermarking(true);
    try {
      finalLabPhoto = await uploadPhotoToStorage(stopPhoto, `proofs/${activeTask.id}/lab-drop-${Date.now()}.jpg`);
    } catch (uploadErr) {
      // Same offline handling as the pickup flow: defer the upload rather than refusing the
      // handover outright. A rider standing in a lab with no signal must still be able to record
      // the delivery; the photo travels with the queued item and uploads on reconnect.
      console.warn('[RiderDashboard] Lab handover photo upload deferred (offline):', uploadErr);
      finalLabPhoto = stopPhoto;
      dropPhotoPending = true;
    }
    setWatermarking(false);

    const safeStops = activeTask.stopsProgress || activeTask.stops || [];
    const totalVials = safeStops.reduce((sum: number, s: any) => sum + Number(s?.sampleCount || s?.specimenCount || 0), 0);

    const nowStr = new Date().toISOString();
    const updatedTask: PickupTask = {
      ...activeTask,
      status: 'delivered',
      completedAt: nowStr,
      deliveryTimestamp: nowStr,
      isHandedOver: true,
      isCompleted: true,
      receiverName: receiverName,
      intakeReceiver: receiverName,
      handoverPhotoUrl: finalLabPhoto,
      handoverTemperature: coldBoxTemp,
      destination: {
        ...activeTask.destination,
        name: activeTask.destination?.name || 'Central Diagnostic Processing Lab',
        address: activeTask.destination?.address || 'Lab Facility',
        status: 'delivered',
        deliveredAt: nowStr,
        receiverName: receiverName,
        dropPhotoUrl: finalLabPhoto,
        handoverPhotoUrl: finalLabPhoto,
        coldBoxTempAtDrop: coldBoxTemp,
        totalVialsHandedOver: totalVials,
        notes: `Total ${totalVials} specimen vials handed over in certified cold chain (${coldBoxTemp}°C).`
      }
    };

    setLiveTasks((prev) => (prev || []).map((t) => (t.id === updatedTask.id ? updatedTask : t)));
    StorageService.updateTask(updatedTask);

    if (dropPhotoPending) {
      // Photo is still local; queue the handover and let the flusher upload then write it.
      StorageService.addToOfflineQueue({
        id: `q-drop-${activeTask.id}-${Date.now()}`,
        taskId: activeTask.id,
        isDrop: true,
        photoBlobOrDataUrl: stopPhoto || '',
        location: {
          lat: Number((activeRider as any)?.lat || 0),
          lng: Number((activeRider as any)?.lng || 0)
        },
        timestamp: new Date().toISOString(),
        coldBoxTemp,
        receiverName,
        queuedAt: new Date().toISOString(),
        status: 'pending',
        photosPendingUpload: true,
        rawPhoto1: stopPhoto || '',
        dropMeta: {
          destinationName: activeTask.destination?.name || 'Central Diagnostic Processing Lab',
          destinationAddress: activeTask.destination?.address || 'Lab Facility',
          receiverName,
          totalVials,
          coldBoxTemp
        }
      } as any);
      setSyncBanner({
        state: 'queued',
        message: 'Handover saved on this phone. The photo will upload when you have signal.'
      });
    } else {
      CloudSync.completeTripFinalHandover(activeTask.id, sessionRiderId, {
        destinationName: activeTask.destination?.name || 'Central Diagnostic Processing Lab',
        destinationAddress: activeTask.destination?.address || 'Lab Facility',
        receiverName,
        totalVials,
        coldBoxTemp,
        dropPhotoUrl: finalLabPhoto
      });
    }
    setIsProcessingDrop(false);
    setStopPhoto(null);
    setStopPhoto2(null);
    onRefresh();

    NotificationService.sendAlert({
      type: 'delivery',
      title: `Lab Delivery Completed (${totalVials} Vials)`,
      message: `${activeRider.name} delivered ${totalVials} vials to ${activeTask.destination?.name || 'Central Lab'}. Received by ${receiverName}.`,
      recipientRole: 'both',
      channel: 'both'
    });
  };

  // Report Delay
  const handleReportDelay = () => {
    if (!activeTask) return;
    const newFlag: any = {
      id: `issue-${Date.now()}`,
      type: 'delay',
      reason: delayReason,
      description: `Rider reported delay: ${delayReason}`,
      reportedAt: new Date().toISOString(),
      reportedByRiderId: activeRider.id,
      reportedByRiderName: activeRider.name,
      resolved: false
    };
    const updated: PickupTask = {
      ...activeTask,
      isDelayed: true,
      delayMinutes: (activeTask.delayMinutes || 0) + 20,
      issueFlags: [...(activeTask.issueFlags || []), newFlag]
    };
    StorageService.updateTask(updated);
    setShowDelayModal(false);
    onRefresh();

    NotificationService.sendAlert({
      type: 'delay',
      title: `Rider Delay Alert: +20 Mins`,
      message: `${activeRider.name} reported delay: ${delayReason} on ${activeTask.timeSlot} loop.`,
      recipientRole: 'both',
      channel: 'both'
    });
  };

  // Trigger: Start Route / En Route to Next Stop with real-time Firestore sync
  const handleStartRouteOrEnRoute = async (targetStopIdx?: number) => {
    if (!activeTask) return;

    const stopIdx = targetStopIdx !== undefined ? targetStopIdx : currentStopIndex;
    const targetStop = activeTask.stopsProgress[stopIdx] || activeTask.stopsProgress[0];
    const destinationStopName = targetStop?.stopName || activeTask.destination.name;
    const riderId = sessionRiderId || activeRider.id || 'rider';
    const riderName = sessionName || activeRider.name || 'Assigned Phlebotomist';

    // 1. Update local task state and storage
    const updatedTask: PickupTask = {
      ...activeTask,
      status: 'in_transit',
      riderId: riderId,
      riderName: riderName,
      activeRiderId: riderId,
      activeRiderName: riderName,
      currentDestinationStop: destinationStopName,
      tripStartedAt: new Date().toISOString(),
      startedAt: activeTask.startedAt || new Date().toISOString(),
      currentStopIndex: stopIdx
    } as any;

    StorageService.updateTask(updatedTask);
    setCurrentStopIndex(stopIdx);

    // 2. Update task in Firestore with in_transit status, rider info, destination stop & timestamp
    try {
      await setDoc(
        doc(db, 'tasks', activeTask.id),
        {
          status: 'in_transit',
          activeRiderId: riderId,
          activeRiderName: riderName,
          riderId: riderId,
          riderName: riderName,
          currentDestinationStop: destinationStopName,
          tripStartedAt: serverTimestamp(),
          startedAt: activeTask.startedAt || new Date().toISOString(),
          lastUpdated: serverTimestamp()
        },
        { merge: true }
      );
    } catch (err) {
      console.warn('Error updating Firestore task status to in_transit:', err);
    }

    // 3. Update rider document in Firestore with current active task and destination
    try {
      await setDoc(
        doc(db, 'riders', riderId),
        {
          id: riderId,
          name: riderName,
          currentTaskId: activeTask.id,
          currentDestinationStop: destinationStopName,
          tripStartedAt: serverTimestamp(),
          status: 'active',
          isOnline: true,
          lastUpdated: serverTimestamp()
        },
        { merge: true }
      );
    } catch (err) {
      console.warn('Error updating Firestore rider current destination:', err);
    }

    // 4. Send operational notification alert
    NotificationService.sendAlert({
      type: 'task_started',
      title: `Rider En Route: ${riderName}`,
      message: `${riderName} has started trip and is en route to ${destinationStopName}. Client tracking is live.`,
      recipientRole: 'both',
      channel: 'both'
    });

    onRefresh();
  };

  // Calculate live summary counters
  const totalCollectedVials = useMemo(() => {
    return (todayRiderTasks || []).reduce((sum: number, t: any) => {
      const stops = t?.stopsProgress || t?.stops || [];
      const taskVials = stops.reduce((sub: number, s: any) => sub + Number(s?.sampleCount || s?.specimenCount || 0), 0);
      return sum + taskVials;
    }, 0);
  }, [todayRiderTasks]);

  const completedStopsCount = useMemo(() => {
    return (scheduleStops || []).filter((s) => s?.status === 'collected').length;
  }, [scheduleStops]);

  // Evaluate current punctuality & route countdown
  // Retries anything sitting in the offline proof queue: on mount, whenever the browser regains
  // connectivity, and every 30s as a backstop for flaky mobile signal that never fires 'online'.
  useEffect(() => {
    let cancelled = false;

    const flushQueue = async () => {
      const queue = StorageService.getOfflineQueue().filter((q) => q.status !== 'synced');
      if (!cancelled) setPendingProofCount(queue.length);
      if (queue.length === 0 || !navigator.onLine) return;

      for (const item of queue) {
        try {
          let savedStops = (item as any).stopsSnapshot;
          let savedExtra = (item as any).extraPayload;

          // Photos captured offline are still base64 on this device. Upload them to Storage
          // FIRST, then substitute the resulting URLs everywhere before the Firestore write --
          // base64 in a document would exceed Firestore's 1MiB limit and fail again.
          if ((item as any).photosPendingUpload) {
            const ts = Date.now();
            const idx = Number(item.stopId || 0);
            let url1 = '';
            let url2 = '';

            if ((item as any).rawPhoto1) {
              url1 = await uploadPhotoToStorage(
                (item as any).rawPhoto1,
                `proofs/${item.taskId}/stop-${idx}-specimen-${ts}.jpg`
              );
            }
            if ((item as any).rawPhoto2) {
              url2 = await uploadPhotoToStorage(
                (item as any).rawPhoto2,
                `proofs/${item.taskId}/stop-${idx}-selfie-${ts}.jpg`
              );
            }

            savedExtra = {
              ...(savedExtra || {}),
              photoUrl: url1 || savedExtra?.photoUrl || '',
              handoverPhotoUrl: url2 || savedExtra?.handoverPhotoUrl || '',
              photo2Url: url2 || savedExtra?.photo2Url || '',
              selfieUrl: url2 || savedExtra?.selfieUrl || ''
            };

            if (Array.isArray(savedStops)) {
              savedStops = savedStops.map((st: any, i: number) =>
                i === idx
                  ? {
                      ...st,
                      photoUrl: url1 || st.photoUrl || '',
                      handoverPhotoUrl: url2 || st.handoverPhotoUrl || '',
                      photo2Url: url2 || st.photo2Url || '',
                      selfieUrl: url2 || st.selfieUrl || ''
                    }
                  : st
              );
            }
          }

          // Prefer the snapshot captured at save time; only fall back to live state for items
          // queued by an older build that did not store one.
          let stops = Array.isArray(savedStops) ? savedStops : null;
          if (!stops) {
            const task = liveTasks.find((t) => t.id === item.taskId) || tasks.find((t) => t.id === item.taskId);
            if (!task) {
              StorageService.removeFromOfflineQueue(item.id);
              continue;
            }
            stops = task.stopsProgress || (task as any).stops || [];
          }

          if (item.isDrop) {
            const meta = (item as any).dropMeta || {};
            let dropUrl = (item as any).rawPhoto1 || item.photoBlobOrDataUrl || '';
            if ((item as any).photosPendingUpload && dropUrl) {
              dropUrl = await uploadPhotoToStorage(
                dropUrl,
                `proofs/${item.taskId}/lab-drop-${Date.now()}.jpg`
              );
            }
            await CloudSync.completeTripFinalHandover(item.taskId, sessionRiderId, {
              destinationName: meta.destinationName || 'Central Diagnostic Processing Lab',
              destinationAddress: meta.destinationAddress || 'Lab Facility',
              receiverName: meta.receiverName || item.receiverName || '',
              totalVials: meta.totalVials || 0,
              coldBoxTemp: meta.coldBoxTemp ?? item.coldBoxTemp ?? 4,
              dropPhotoUrl: dropUrl
            });
            StorageService.removeFromOfflineQueue(item.id);
            continue;
          }

          await CloudSync.completeTripStop(
            item.taskId,
            Number(item.stopId || 0),
            stops,
            savedExtra || {
              sampleCount: item.sampleCount,
              coldBoxTemp: item.coldBoxTemp,
              photoUrl: item.photoBlobOrDataUrl,
              notes: item.notes,
              status: 'picked_up'
            }
          );
          StorageService.removeFromOfflineQueue(item.id);
        } catch {
          // Still no connection, or the write is still refused -- leave it queued and try later.
          break;
        }
      }

      const remaining = StorageService.getOfflineQueue().filter((q) => q.status !== 'synced');
      if (!cancelled) {
        setPendingProofCount(remaining.length);
        if (remaining.length === 0 && queue.length > 0) {
          setSyncBanner({ state: 'synced', message: 'All saved proofs have now uploaded to Ops.' });
        }
      }
    };

    flushQueue();
    window.addEventListener('online', flushQueue);
    const interval = window.setInterval(flushQueue, 30000);

    return () => {
      cancelled = true;
      window.removeEventListener('online', flushQueue);
      clearInterval(interval);
    };
  }, [liveTasks, tasks]);

  // Clear a success banner after a few seconds; leave "queued" up until it actually uploads.
  useEffect(() => {
    if (syncBanner?.state !== 'synced') return;
    const t = window.setTimeout(() => setSyncBanner(null), 4000);
    return () => clearTimeout(t);
  }, [syncBanner]);

  useEffect(() => {
    if (isProcessingStop) {
      openModalRef.current = () => setIsProcessingStop(false);
    } else if (isProcessingDrop) {
      openModalRef.current = () => setIsProcessingDrop(false);
    } else {
      openModalRef.current = null;
    }
  }, [isProcessingStop, isProcessingDrop]);

  // Every round this rider has, newest first, optionally narrowed to one date.
  const riderArchiveRounds = useMemo(() => {
    const all = new Map<string, PickupTask>();
    [...(liveTasks || []), ...(tasks || []), ...StorageService.getTasks()].forEach((t) => {
      if (t && isTaskAssignedToRider(t)) all.set(t.id, t);
    });

    const dateOf = (t: any) => resolveTaskDate(t);

    return Array.from(all.values())
      .filter((t) => (archiveDate ? dateOf(t) === archiveDate : true))
      .sort((a: any, b: any) => {
        const d = String(dateOf(b)).localeCompare(String(dateOf(a)));
        if (d !== 0) return d;
        return String(a.timeSlot || '').localeCompare(String(b.timeSlot || ''));
      });
  }, [liveTasks, tasks, archiveDate, isTaskAssignedToRider]);

  const punctualityReport = useMemo(() => {
    return evaluateRiderPunctuality(activeRider, assignedRoutes, undefined, todayRiderTasks);
  }, [activeRider, assignedRoutes, todayRiderTasks]);

  // The punch-in prompt banner carries its own full-width CTA; the profile card below suppresses
  // its duplicate button whenever this is on screen.
  const showPunchInPrompt = !isCheckedIn && punctualityReport.status !== 'no_route';

  return (
    <div className="space-y-4 w-full min-w-0 max-w-5xl mx-auto pb-16 overflow-x-hidden">
      {/* Save / sync confirmation. States the difference between "Ops has it" and "this phone has
          it", so a rider knows whether they can leave the collection point. */}
      {(syncBanner || pendingProofCount > 0) && (
        <div
          className={`sticky top-14 z-30 p-3 rounded-xl border shadow-xs flex items-center gap-2.5 text-xs font-semibold ${
            syncBanner?.state === 'synced'
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
              : syncBanner?.state === 'saving'
              ? 'bg-sky-50 border-sky-300 text-sky-900'
              : 'bg-amber-50 border-amber-300 text-amber-900'
          }`}
        >
          {syncBanner?.state === 'synced' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          ) : syncBanner?.state === 'saving' ? (
            <RefreshCw className="w-4 h-4 text-sky-700 animate-spin shrink-0" />
          ) : (
            <WifiOff className="w-4 h-4 text-amber-700 shrink-0" />
          )}
          <span className="min-w-0">
            {syncBanner?.message ||
              `${pendingProofCount} proof${pendingProofCount === 1 ? '' : 's'} saved on this phone, waiting for signal.`}
          </span>
        </div>
      )}

      {/* Punch In Duty & Route Time Alert Banner (When Not Checked In) */}
      {showPunchInPrompt && (
        <div
          className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs ${
            punctualityReport.isOverdue
              ? 'bg-red-50 border-red-300 text-red-900'
              : 'bg-amber-50 border-amber-300 text-amber-900'
          }`}
        >
          <div className="flex items-start gap-3">
            <div
              className={`p-2 rounded-lg shrink-0 mt-0.5 ${
                punctualityReport.isOverdue ? 'bg-red-200 text-red-800' : 'bg-amber-200 text-amber-800'
              }`}
            >
              <Clock className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-sm">
                  {punctualityReport.isOverdue ? '🚨 URGENT: Punch-In Overdue!' : '⏰ Punch-In Required Before Route Starts'}
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${punctualityReport.badgeClass}`}>
                  {punctualityReport.label}
                </span>
              </div>
              <p className="text-xs mt-1 opacity-90">
                Route: <span className="font-semibold">{punctualityReport.routeName}</span> • Slot:{' '}
                <span className="font-semibold">{punctualityReport.firstSlot}</span>.
                You must punch in with vehicle details and live GPS broadcast before initiating stop collections.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowVehicleDutyModal(true)}
            className={`px-4 py-2.5 rounded-lg font-bold text-xs text-white shadow-xs shrink-0 cursor-pointer transition-transform active:scale-95 flex items-center justify-center gap-2 ${
              punctualityReport.isOverdue ? 'bg-red-700 hover:bg-red-800' : 'bg-amber-700 hover:bg-amber-800'
            }`}
          >
            <UserCheck className="w-4 h-4" />
            <span>PUNCH IN & START DUTY</span>
          </button>
        </div>
      )}

      {/* GPS Status Banner */}
      {gpsStatus.errorMessage && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between text-xs text-red-800 shadow-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <div>
              <span className="font-bold">GPS Access Warning:</span> {gpsStatus.errorMessage}
            </div>
          </div>
          <button
            onClick={() => LocationService.startRealGeolocation(activeRider.id, activeRider.name, activeTask?.id)}
            className="px-2.5 py-1 bg-red-700 hover:bg-red-800 text-white rounded-md font-bold text-xs shrink-0 cursor-pointer"
          >
            Grant Location
          </button>
        </div>
      )}

      {/* Rider Header Bar & Live Duty Status */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <img
              src={activeRider.photoUrl}
              alt={activeRider.name}
              className="w-12 h-12 rounded-full object-cover border-2 border-sky-600 shadow-xs"
            />
            <span
              className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-white ${
                isCheckedIn ? 'bg-emerald-500' : 'bg-slate-400'
              }`}
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-slate-900 text-base sm:text-lg">{activeRider.name}</h2>
              <span className="text-[11px] font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200">
                {selectedVehicleNumber}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <button
                type="button"
                onClick={() => setShowVehicleDutyModal(true)}
                className="text-xs text-slate-700 hover:text-sky-800 flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 border border-slate-200 cursor-pointer transition-colors"
                title="Change Vehicle Type / Number"
              >
                <Bike className="w-3.5 h-3.5 text-sky-700" />
                <span className="font-semibold">{selectedVehicleType}</span>
                <Edit2 className="w-3 h-3 text-slate-400" />
              </button>
              <span className="text-slate-300">•</span>
              <span className="text-xs font-medium text-slate-600">{activeRider.shiftTimings || '08:00 AM - 04:00 PM'}</span>
            </div>
          </div>
        </div>

        {/* Action / Attendance Toggle */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700">
            {isOnline ? <Wifi className="w-3.5 h-3.5 text-emerald-600" /> : <WifiOff className="w-3.5 h-3.5 text-red-600" />}
            <span>{isOnline ? 'Cloud Synced' : 'Offline Mode'}</span>
          </div>

          {/* The punch-in prompt above already carries a full-width CTA for this exact action, so
              repeating it here just doubles the button on a phone screen. Once on duty this button
              is the only way to punch out, so it stays visible then. */}
          {isCheckedIn ? (
            <button
              type="button"
              onClick={handleToggleAttendance}
              className="px-4 py-2.5 rounded-lg font-bold text-xs sm:text-sm flex items-center gap-2 shadow-xs transition-all cursor-pointer active:scale-95 bg-emerald-700 hover:bg-emerald-800 text-white"
            >
              <UserCheck className="w-4 h-4" />
              <span>ON DUTY (LIVE GPS)</span>
            </button>
          ) : (
            !showPunchInPrompt && (
              <button
                type="button"
                onClick={handleToggleAttendance}
                className="px-4 py-2.5 rounded-lg font-bold text-xs sm:text-sm flex items-center gap-2 shadow-xs transition-all cursor-pointer active:scale-95 bg-slate-800 hover:bg-slate-900 text-white"
              >
                <UserCheck className="w-4 h-4" />
                <span>PUNCH IN (START SHIFT)</span>
              </button>
            )
          )}
        </div>
      </div>

      {/* KPI Stats Quick Bar -- collapsed during an active round to cut scrolling. */}
      <button
        type="button"
        onClick={() => setShowStats((v) => !v)}
        className="sm:hidden w-full flex items-center justify-between px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl shadow-xs text-xs font-bold text-slate-700 cursor-pointer"
      >
        <span>Shift stats</span>
        <span className="flex items-center gap-2 text-slate-500 font-semibold">
          <span>
            {completedStopsCount}/{scheduleStops.length} stops • {totalCollectedVials} vials
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showStats ? 'rotate-180' : ''}`} />
        </span>
      </button>

      <div className={`${showStats ? 'grid' : 'hidden'} sm:grid grid-cols-2 sm:grid-cols-4 gap-3`}>
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Assigned Loops / Pickups</span>
          <span className="text-xl font-bold font-mono text-slate-900 mt-1 block">
            {assignedRoutes.length + (todayRiderTasks.filter(t => !assignedRoutes.some(r => r.id === t.routeId)).length)}
          </span>
          <span className="text-[10px] text-slate-500 truncate block mt-0.5">
            {[
              ...assignedRoutes.map((r) => r.name),
              ...todayRiderTasks.filter(t => !assignedRoutes.some(r => r.id === t.routeId)).map(t => t.routeName || t.clientName)
            ].filter(Boolean).join(', ') || 'No Assigned Pickups'}
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Stops Progress</span>
          <span className="text-xl font-bold font-mono text-sky-800 mt-1 block">
            {completedStopsCount} / {scheduleStops.length}
          </span>
          <span className="text-[10px] text-sky-700 font-semibold block mt-0.5">
            {scheduleStops.length > 0 ? `${Math.round((completedStopsCount / scheduleStops.length) * 100)}% Completed` : '0%'}
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Collected Vials</span>
          <span className="text-xl font-bold font-mono text-emerald-800 mt-1 block">{totalCollectedVials}</span>
          <span className="text-[10px] text-emerald-700 font-semibold block mt-0.5">2°C – 8°C Cold Chain Certified</span>
        </div>

        {/* GPS status reflects the ACTUAL tracker state. This card used to be hardcoded to
            "Active / High Precision Live GPS", so it reassured a rider their location was
            broadcasting even when they were off shift, had denied the permission, or the watch had
            failed -- and ops would be chasing a rider the map could not see. */}
        {(() => {
          const gpsDenied = gpsStatus.isPermissionDenied || Boolean(gpsStatus.errorMessage);
          const gpsLive = gpsStatus.isActive && isCheckedIn && !gpsDenied;

          const label = gpsDenied ? 'Blocked' : gpsLive ? 'Active' : isCheckedIn ? 'Starting…' : 'Off Duty';
          const detail = gpsDenied
            ? 'Location permission needed'
            : gpsLive
            ? 'High Precision Live GPS'
            : isCheckedIn
            ? 'Acquiring signal'
            : 'Punch in to broadcast';
          const tone = gpsDenied
            ? 'text-red-700'
            : gpsLive
            ? 'text-emerald-700'
            : 'text-slate-500';

          return (
            <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">GPS Status</span>
              <span className={`text-xl font-bold font-mono mt-1 block flex items-center gap-1.5 ${tone}`}>
                <Radio className={`w-4 h-4 ${gpsLive ? 'text-emerald-600 animate-pulse' : gpsDenied ? 'text-red-600' : 'text-slate-400'}`} />
                <span>{label}</span>
              </span>
              <span className="text-[10px] text-slate-500 font-mono block mt-0.5">{detail}</span>
            </div>
          );
        })()}
      </div>

      {/* No Assigned Routes or Tasks Empty State */}
      {assignedRoutes.length === 0 && todayRiderTasks.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-3 shadow-xs">
          <div className="w-12 h-12 rounded-full bg-sky-50 text-sky-700 flex items-center justify-center mx-auto border border-sky-200">
            <Inbox className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-900">No Collection Loops or Pickups Assigned</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            You currently have no diagnostic routes or pickup tasks assigned to your shift. Please contact SecondMedic Ops Dispatch to assign your schedule.
          </p>
          <a
            href={`tel:${opsHotline.replace(/\D/g, '')}`}
            className="inline-flex items-center gap-2 px-4 py-2 bg-sky-700 hover:bg-sky-800 text-white rounded-lg text-xs font-bold transition-all shadow-xs"
          >
            <PhoneCall className="w-3.5 h-3.5" />
            <span>Call Ops Dispatch Desk ({opsHotline})</span>
          </a>
        </div>
      )}

      {/* Active Loop Command Hero Card */}
      {activeTask && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-md font-mono font-bold text-xs bg-sky-700 text-white">
                {activeTask.timeSlot} LOOP
              </span>
              <div>
                <h3 className="font-bold text-slate-900 text-sm sm:text-base">{activeTask.routeName}</h3>
                <p className="text-xs text-slate-500">{activeTask.clientName}</p>
              </div>
            </div>

            {/* On a phone these three sat side by side in a narrow flex row, so every label wrapped
                onto two lines ("Start / Route"). The primary action now spans the full width and
                the two secondary ones share the row beneath it. */}
            <div className="grid grid-cols-2 sm:flex sm:items-center gap-2">
              <button
                type="button"
                onClick={() => handleStartRouteOrEnRoute()}
                className="col-span-2 sm:col-auto px-3.5 py-3 sm:py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm sm:text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm transition-transform active:scale-95 cursor-pointer whitespace-nowrap"
              >
                <Bike className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />
                <span>{activeTask.status === 'in_transit' ? 'En Route (Live)' : 'Start Route'}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowDelayModal(true)}
                className="px-3 py-2.5 sm:py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer whitespace-nowrap"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>Report Delay</span>
              </button>

              <button
                type="button"
                onClick={() => setShowLiveMap(!showLiveMap)}
                className="px-3 py-2.5 sm:py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs whitespace-nowrap"
              >
                <Navigation className="w-3.5 h-3.5 text-sky-700 shrink-0" />
                <span>{showLiveMap ? 'Hide Map' : 'Show Map'}</span>
              </button>
            </div>
          </div>

          {/* Optional Live Route Map */}
          {showLiveMap && (
            <div className="rounded-xl overflow-hidden border border-slate-200 shadow-2xs">
              <LiveMap
                tasks={activeTask ? [activeTask] : []}
                riders={[activeRider]}
                rider={activeRider}
                stops={activeRoute?.stops || activeTask?.stopsProgress || []}
                destination={activeRoute?.destinationLab || activeTask?.destination}
                height="340px"
                activeTaskId={activeTask.id}
                enableFirestoreSync={true}
              />
            </div>
          )}

          {/* Active Loop Stops Stepper with Sequential Stop Revelation */}
          <div className="space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-0.5">
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                Active Round Stops Checklist
              </span>
              <span className="text-[10px] sm:text-[11px] font-medium text-slate-400 sm:text-slate-500">
                Sequential Verification Protocol
              </span>
            </div>
            <div className="space-y-2">
              {(() => {
                const safeStops = activeTask.stopsProgress || activeTask.stops || [];
                const isStopComplete = (st: any) =>
                  st && (
                    st.status === 'picked_up' ||
                    st.status === 'completed' ||
                    st.status === 'no_sample' ||
                    (st.sampleCount !== undefined && st.sampleCount > 0 && !!st.pickedUpAt) ||
                    (!!st.photoUrl && st.status !== 'pending')
                  );
                const firstPendingIdx = safeStops.findIndex((s) => !isStopComplete(s));

                return safeStops.map((stop, idx) => {
                  const isPicked = isStopComplete(stop);
                  const isLocked = !isPicked && firstPendingIdx !== -1 && idx > firstPendingIdx;
                  const isUnlockedActive = !isPicked && (idx === firstPendingIdx || (firstPendingIdx === -1 && idx === 0));
                  const isCurrent = (currentStopIndex === idx || isUnlockedActive) && !isPicked && !isLocked;
                  const cleanPhone = (stop.phone || '').replace(/\D/g, '');

                  return (
                    <div
                      key={stop.stopId || `stop-key-${idx}`}
                      className={`p-3 sm:p-4 rounded-xl border transition-all ${
                        isPicked
                          ? 'bg-emerald-50/50 border-emerald-200'
                          : isUnlockedActive
                          ? 'bg-sky-50/60 border-sky-300 ring-2 ring-sky-400/40 shadow-xs'
                          : isLocked
                          ? 'bg-slate-50/70 border-slate-200 opacity-80'
                          : 'bg-white border-slate-200'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <div
                            className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 ${
                              isPicked
                                ? 'bg-emerald-700 text-white'
                                : isUnlockedActive
                                ? 'bg-sky-700 text-white animate-pulse'
                                : isLocked
                                ? 'bg-slate-200 text-slate-500'
                                : 'bg-slate-200 text-slate-700'
                            }`}
                          >
                            {isPicked ? (
                              <Check className="w-4 h-4" />
                            ) : isLocked ? (
                              <Lock className="w-3.5 h-3.5" />
                            ) : (
                              idx + 1
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className={`font-bold text-xs sm:text-sm ${isLocked ? 'text-slate-600' : 'text-slate-900'}`}>
                                {stop.stopName || stop.name}
                              </h4>
                              {(stop as any).pickupTime && (
                                <span className="px-1.5 py-0.2 bg-sky-50 text-sky-800 text-[10px] font-bold rounded border border-sky-200 font-mono shrink-0">
                                  {formatTimeLabel((stop as any).pickupTime)}
                                </span>
                              )}
                              {isUnlockedActive && (
                                <span className="px-2 py-0.2 bg-sky-100 text-sky-800 text-[10px] font-bold rounded-full border border-sky-300 animate-pulse">
                                  ACTIVE STOP
                                </span>
                              )}
                              {isLocked && (
                                <span className="px-1.5 py-0.2 bg-slate-100 text-slate-500 text-[9px] font-bold rounded border border-slate-200 flex items-center gap-0.5">
                                  <Lock className="w-2.5 h-2.5" /> Locked
                                </span>
                              )}
                            </div>

                            {isLocked ? (
                              <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                                <span>🔒 Details locked until Stop {firstPendingIdx + 1} ({activeTask.stopsProgress?.[firstPendingIdx]?.stopName || activeTask.stops?.[firstPendingIdx]?.stopName || 'Previous Stop'}) is completed</span>
                              </p>
                            ) : (
                              <>
                                <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                                  <MapPin className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
                                  <span className="min-w-0 break-words">{stop.address}</span>
                                </p>
                                <p className="text-[11px] text-slate-500 mt-1">
                                  Contact: <span className="font-medium text-slate-800">{stop.contactPerson || 'Coordinator'}</span> ({stop.phone || 'No phone'})
                                </p>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Action buttons.
                            Four buttons in one flex row do not fit a phone: "En Route" and
                            "Capture 2-Photo Proof" both wrapped onto three lines. The secondary
                            actions now wrap freely and the capture CTA takes its own full-width
                            row beneath them. */}
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          {isLocked ? (
                            <span className="px-3 py-1.5 bg-slate-100 text-slate-400 rounded-lg text-xs font-semibold flex items-center gap-1.5 border border-slate-200">
                              <Lock className="w-3.5 h-3.5" />
                              <span>Locked</span>
                            </span>
                          ) : (
                            <>
                              {stop.phone && (
                                <a
                                  href={`tel:${cleanPhone}`}
                                  className="p-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-xs font-bold flex items-center gap-1 shadow-2xs"
                                  title="Call contact"
                                >
                                  <PhoneCall className="w-3.5 h-3.5" />
                                  <span>Call</span>
                                </a>
                              )}

                              <a
                                href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stop.address)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-3 py-2.5 bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-2xs"
                                title="Navigate via Maps"
                              >
                                <Navigation className="w-3.5 h-3.5" />
                                <span>Navigate</span>
                              </a>

                              {!isPicked && (
                                <button
                                  type="button"
                                  onClick={() => handleStartRouteOrEnRoute(idx)}
                                  className="px-3 py-2.5 bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-2xs cursor-pointer"
                                  title="Mark En Route to this stop"
                                >
                                  <Bike className="w-3.5 h-3.5 text-sky-700" />
                                  <span>En Route</span>
                                </button>
                              )}

                              {!isPicked ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (activeTask?.id) setActiveTaskId(activeTask.id);
                                    setCurrentStopIndex(idx);
                                    const existingVials = stop.sampleCount ?? (stop as any).specimenCount ?? 0;
                                    const existingRemark = (stop as any).remark || (stop.status === 'no_sample' ? 'No Sample' : (existingVials > 0 ? 'Collected sample' : 'Collected sample'));

                                    if (existingRemark === 'No Sample' || stop.status === 'no_sample') {
                                      setPickupRemarkType('No Sample');
                                      setPickupCustomRemark('');
                                      setVialCount(0);
                                    } else if (typeof existingRemark === 'string' && existingRemark.startsWith('Other')) {
                                      setPickupRemarkType('Other');
                                      setPickupCustomRemark(existingRemark.replace(/^Other:?\s*/i, ''));
                                      setVialCount(existingVials);
                                    } else {
                                      setPickupRemarkType('Collected sample');
                                      setPickupCustomRemark('');
                                      setVialCount(existingVials > 0 ? existingVials : 1);
                                    }

                                    setColdBoxTemp(stop.coldBoxTemp ?? 4.0);
                                    setStopPhoto(stop.photoUrl || (stop as any).photo || null);
                                    setStopPhoto2((stop as any).handoverPhotoUrl || (stop as any).photo2Url || (stop as any).selfieUrl || null);
                                    setPickupFormError(null);
                                    setIsProcessingStop(true);
                                  }}
                                  className="w-full sm:w-auto order-last sm:order-none px-3.5 py-3 sm:py-2 bg-sky-700 hover:bg-sky-800 text-white font-bold text-sm sm:text-xs rounded-lg shadow-xs flex items-center justify-center gap-1.5 cursor-pointer active:scale-98 whitespace-nowrap"
                                >
                                  <Camera className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />
                                  <span>Capture 2-Photo Proof</span>
                                </button>
                              ) : (
                                <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 font-bold text-xs rounded-md border border-emerald-200 flex items-center gap-1">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                                  <span>{stop.sampleCount ?? (stop as any).specimenCount ?? 0} Vials Collected</span>
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>

          {/* Destination Central Lab Handover Section */}
          <div className="p-3.5 sm:p-4 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/40 space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div>
                <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block">
                  Final Processing Destination
                </span>
                <h4 className="font-bold text-slate-900 text-sm">{activeTask.destination.name}</h4>
                <p className="text-xs text-slate-600 mt-0.5">{activeTask.destination.address}</p>
              </div>

              {activeTask.destination.status !== 'delivered' ? (
                (() => {
                  // A handover must come AFTER the collections. This button used to be always
                  // enabled, so a round could be marked delivered with zero pickups recorded --
                  // producing a "completed" chain-of-custody record containing no proof at all.
                  const roundStops = activeTask.stopsProgress || (activeTask as any).stops || [];
                  const outstanding = roundStops.filter(
                    (st: any) => st?.status !== 'picked_up' && st?.status !== 'completed' && st?.status !== 'no_sample'
                  );
                  const canHandover = roundStops.length > 0 && outstanding.length === 0;

                  return (
                    <div className="flex flex-col items-stretch sm:items-end gap-1">
                      <button
                        type="button"
                        disabled={!canHandover}
                        onClick={() => canHandover && setIsProcessingDrop(true)}
                        className={`px-4 py-3 sm:py-2 font-bold text-sm rounded-lg shadow-xs flex items-center justify-center gap-2 active:scale-98 ${
                          canHandover
                            ? 'bg-emerald-700 hover:bg-emerald-800 text-white cursor-pointer'
                            : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        <ShieldCheck className="w-4 h-4" />
                        <span>Handover to Lab</span>
                      </button>
                      {!canHandover && (
                        <span className="text-[10px] text-slate-500 font-semibold text-center sm:text-right">
                          {roundStops.length === 0
                            ? 'No collection stops on this round'
                            : `Collect ${outstanding.length} more stop${outstanding.length === 1 ? '' : 's'} first`}
                        </span>
                      )}
                    </div>
                  );
                })()
              ) : (
                <span className="px-3 py-1.5 bg-emerald-100 text-emerald-900 border border-emerald-300 font-bold text-xs rounded-lg flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                  <span>Handover Verified ({activeTask.destination.receiverName})</span>
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Full day schedule. During an active round this repeats the stops already shown above, so
          it stays collapsed until the rider asks for it. */}
      {activeTask && (
        <button
          type="button"
          onClick={() => setShowFullSchedule((v) => !v)}
          className="w-full flex items-center justify-between px-3.5 py-3 bg-white border border-slate-200 rounded-xl shadow-xs text-xs font-bold text-slate-700 cursor-pointer"
        >
          <span>My full day schedule</span>
          <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${showFullSchedule ? 'rotate-180' : ''}`} />
        </button>
      )}

      <button
        type="button"
        onClick={() => {
          setArchiveDate('');
          setIsArchiveOpen(true);
        }}
        className="w-full flex items-center justify-between px-3.5 py-3 bg-white border border-slate-200 rounded-xl shadow-xs text-xs font-bold text-slate-700 cursor-pointer"
      >
        <span className="flex items-center gap-2">
          <Package className="w-4 h-4 text-sky-700" />
          <span>My Collection History</span>
        </span>
        <ChevronRight className="w-4 h-4 text-slate-400" />
      </button>

      {(!activeTask || showFullSchedule) && (
      <DailyRoundsSchedule
        scheduleStops={scheduleStops}
        assignedRoutes={assignedRoutes}
        activeTaskId={activeTask?.id}
        onStartCollection={handleStartStopCollectionFromSchedule}
        onOpenProofModal={onOpenProof}
        onSelectTask={(taskId) => setActiveTaskId(taskId)}
        onStartDrop={handleStartDropFromSchedule}
      />
      )}

      {/* Rider's own Specimen Intake & Verification Archive */}
      {isArchiveOpen && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs overflow-y-auto overscroll-contain animate-fadeIn">
          <div
            className="w-full max-w-lg bg-white border border-slate-200 rounded-xl shadow-2xl my-3 sm:my-6 max-h-[94dvh] flex flex-col overflow-hidden"
            style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
          >
            <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-200">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 bg-sky-700 rounded-xl shrink-0">
                  <Package className="w-4 h-4 text-white" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-900 text-sm">Specimen Intake &amp; Verification Archive</h3>
                  <p className="text-[11px] text-slate-500">Your own collection record, by date.</p>
                </div>
              </div>
              <button
                onClick={() => setIsArchiveOpen(false)}
                className="p-1.5 hover:bg-slate-100 rounded-lg cursor-pointer shrink-0"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            <div className="p-3 border-b border-slate-100 bg-slate-50/70 flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={archiveDate}
                onChange={(e) => setArchiveDate(e.target.value)}
                className="px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold focus:border-sky-600 focus:outline-hidden"
              />
              <button
                type="button"
                onClick={() => setArchiveDate(todayStr)}
                className={`px-2.5 py-2 rounded-lg text-[11px] font-bold border cursor-pointer ${
                  archiveDate === todayStr
                    ? 'bg-sky-700 text-white border-sky-700'
                    : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                Today
              </button>
              {archiveDate && (
                <button
                  type="button"
                  onClick={() => setArchiveDate('')}
                  className="px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-[11px] font-bold text-slate-600 cursor-pointer"
                >
                  All dates
                </button>
              )}
              <span className="text-[11px] text-slate-500 font-semibold ml-auto">
                {riderArchiveRounds.length} round{riderArchiveRounds.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {riderArchiveRounds.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs">
                  <Package className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="font-semibold text-slate-600">No rounds on this date.</p>
                </div>
              ) : (
                riderArchiveRounds.map((task: any) => {
                  const stopsList = task.stopsProgress || task.stops || [];
                  const vials = stopsList.reduce(
                    (sum: number, st: any) => sum + Number(st?.sampleCount || st?.specimenCount || 0),
                    0
                  );
                  const delivered =
                    task.status === 'delivered' || task.status === 'completed' || task.destination?.status === 'delivered';
                  const dateLabel =
                    task.scheduledDate || task.date || (task.createdAt ? String(task.createdAt).split('T')[0] : '');

                  return (
                    <div key={task.id} className="border border-slate-200 rounded-xl p-3">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-slate-900 text-xs truncate">
                              {task.clientLabName || task.clientName || 'Client Lab'}
                            </span>
                            {task.timeSlot && (
                              <span className="text-[10px] font-mono font-bold text-slate-700 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
                                {task.timeSlot}
                              </span>
                            )}
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                delivered
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : 'bg-amber-50 text-amber-800 border-amber-200'
                              }`}
                            >
                              {delivered ? 'Delivered' : task.status || 'pending'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                            {dateLabel} • {task.routeName || 'Direct dispatch'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-right">
                            <div className="text-sm font-bold text-slate-900">{vials}</div>
                            <div className="text-[10px] text-slate-400 font-semibold">vials</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setIsArchiveOpen(false);
                              onOpenProof(task);
                            }}
                            className="px-2 py-1.5 bg-slate-100 hover:bg-sky-50 text-slate-600 font-semibold rounded text-[10px] border border-slate-200 flex items-center gap-1 cursor-pointer"
                          >
                            <Eye className="w-3 h-3 text-slate-500" />
                            <span>Proof</span>
                          </button>
                        </div>
                      </div>

                      {stopsList.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-100 space-y-1">
                          {stopsList.map((st: any, i: number) => (
                            <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                              <span className="text-slate-600 truncate">
                                {st.stopName || st.name || `Stop ${i + 1}`}
                              </span>
                              <span className="text-slate-400 font-mono shrink-0">
                                {Number(st.sampleCount || st.specimenCount || 0)} vials
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Process Stop Pickup (2-Photo Proof: Specimen Vials + Signed Slip) */}
      {isProcessingStop && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs overflow-y-auto overscroll-contain animate-fadeIn">
          {/* items-start on the backdrop + a self-scrolling panel. With items-center, any modal
              taller than the viewport had its top AND bottom clipped off-screen with no way to
              reach them -- on a phone that hid the camera buttons and the confirm button. */}
          <div
            className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-2xl space-y-4 my-3 sm:my-6 max-h-[94dvh] overflow-y-auto"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
          >
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-slate-900 text-sm sm:text-base flex items-center gap-2">
                  <Camera className="w-4 h-4 text-sky-700" />
                  <span>Upload 2-Photo Proof & Confirm Pickup</span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {activeTask?.stopsProgress?.[currentStopIndex]?.stopName || activeTask?.stops?.[currentStopIndex]?.stopName || (activeTask?.stops?.[currentStopIndex] as any)?.name || 'Collection Stop'}
                </p>
              </div>
              <button
                onClick={() => {
                  setIsProcessingStop(false);
                  setPickupFormError(null);
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Error Notification Alert */}
            {pickupFormError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs font-semibold flex items-center gap-2 animate-fadeIn">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{pickupFormError}</span>
              </div>
            )}

            {/* Rider Remark Selector */}
            <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                  Pickup Status Remark (Visible to Client)
                </label>
                <span className="text-[10px] text-sky-700 font-bold bg-sky-50 px-2 py-0.5 rounded border border-sky-200">
                  {pickupRemarkType}
                </span>
              </div>

              {/* 3 Main Remark Options */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPickupRemarkType('Collected sample');
                    if (vialCount === 0) setVialCount(1);
                  }}
                  className={`p-2.5 rounded-lg border text-center transition-all cursor-pointer flex flex-col items-center gap-1 ${
                    pickupRemarkType === 'Collected sample'
                      ? 'bg-emerald-50 border-emerald-400 text-emerald-900 ring-2 ring-emerald-200 shadow-xs'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <CheckCircle2 className={`w-4 h-4 ${pickupRemarkType === 'Collected sample' ? 'text-emerald-700' : 'text-slate-400'}`} />
                  <span className="text-xs font-bold leading-tight">Collected sample</span>
                  <span className="text-[9px] text-slate-500 font-medium">Vials collected</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPickupRemarkType('No Sample');
                    setVialCount(0);
                  }}
                  className={`p-2.5 rounded-lg border text-center transition-all cursor-pointer flex flex-col items-center gap-1 ${
                    pickupRemarkType === 'No Sample'
                      ? 'bg-amber-50 border-amber-400 text-amber-900 ring-2 ring-amber-200 shadow-xs'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <AlertCircle className={`w-4 h-4 ${pickupRemarkType === 'No Sample' ? 'text-amber-700' : 'text-slate-400'}`} />
                  <span className="text-xs font-bold leading-tight">No Sample</span>
                  <span className="text-[9px] text-slate-500 font-medium">Zero samples</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPickupRemarkType('Other');
                  }}
                  className={`p-2.5 rounded-lg border text-center transition-all cursor-pointer flex flex-col items-center gap-1 ${
                    pickupRemarkType === 'Other'
                      ? 'bg-sky-50 border-sky-400 text-sky-900 ring-2 ring-sky-200 shadow-xs'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <FileText className={`w-4 h-4 ${pickupRemarkType === 'Other' ? 'text-sky-700' : 'text-slate-400'}`} />
                  <span className="text-xs font-bold leading-tight">Other</span>
                  <span className="text-[9px] text-slate-500 font-medium">Custom status</span>
                </button>
              </div>

              {/* Sub-details for 'Other' option */}
              {pickupRemarkType === 'Other' && (
                <div className="pt-2 border-t border-slate-200 space-y-2 animate-fadeIn">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold text-slate-700">Specify Remark / Reason:</span>
                    <span className="text-slate-400 text-[10px]">Client will see this</span>
                  </div>
                  <input
                    type="text"
                    placeholder="e.g. Clinic closed, Doctor unavailable, Sample postponed..."
                    value={pickupCustomRemark}
                    onChange={(e) => setPickupCustomRemark(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 text-xs focus:ring-1 focus:ring-sky-600 focus:border-sky-600 font-medium"
                  />
                  {/* Quick Pill presets */}
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {['Center Closed', 'Doctor Unavailable', 'Postponed to Next Round', 'Compromised Specimen'].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setPickupCustomRemark(preset)}
                        className={`text-[10px] px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                          pickupCustomRemark === preset
                            ? 'bg-sky-700 text-white border-sky-700'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Informative notification for No Sample */}
              {pickupRemarkType === 'No Sample' && (
                <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-[11px] flex items-center gap-2 animate-fadeIn">
                  <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>
                    <strong>"No Sample"</strong> remark will be reported to the client. Zero vials will be recorded, and rider location selfie will verify your on-site visit.
                  </span>
                </div>
              )}
            </div>

            {/* Quick 1-Handed Manual Vial Counter Stepper (Active for Collected sample and Other) */}
            {pickupRemarkType !== 'No Sample' ? (
              <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 text-center space-y-2.5">
                <div className="flex items-center justify-between gap-2 text-left">
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider min-w-0">
                    Vial Count
                  </label>
                  <span className="text-[11px] text-emerald-800 font-bold shrink-0 whitespace-nowrap">
                    Vials: {vialCount}
                  </span>
                </div>

                <div className="flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setVialCount(Math.max(1, vialCount - 1))}
                    className="w-11 h-11 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 font-bold text-2xl flex items-center justify-center active:scale-90 shadow-xs cursor-pointer"
                    title="Decrease count"
                  >
                    <Minus className="w-5 h-5" />
                  </button>

                  <div className="relative">
                    <input
                      type="number"
                      min="1"
                      max="999"
                      value={vialCount}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setVialCount(isNaN(val) || val < 0 ? 0 : val);
                      }}
                      className="w-24 h-11 text-center font-mono font-bold text-2xl text-emerald-800 bg-white border-2 border-emerald-300 rounded-lg focus:outline-hidden focus:border-emerald-600 shadow-inner"
                    />
                    <span className="block text-[9px] text-slate-400 uppercase font-semibold mt-0.5">Vials Picked</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setVialCount(vialCount + 1)}
                    className="w-11 h-11 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-2xl flex items-center justify-center active:scale-90 shadow-xs cursor-pointer"
                    title="Increase count"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>

                {/* Quick Preset Selector Chips */}
                <div className="flex items-center justify-center gap-1.5 pt-1 flex-wrap">
                  <span className="text-[10px] text-slate-400 font-semibold mr-1">Quick:</span>
                  {[1, 2, 5, 10, 15, 20].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setVialCount(preset)}
                      className={`px-2.5 py-1 text-xs font-mono font-semibold rounded-md border transition-all cursor-pointer ${
                        vialCount === preset
                          ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-center flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700">Specimens Count:</span>
                <span className="font-mono font-bold text-xs bg-amber-100 text-amber-900 px-3 py-1 rounded-md border border-amber-300">
                  0 Vials (No Sample)
                </span>
              </div>
            )}

            {/* Chiller Box Temperature reading */}
            <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-700 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <Thermometer className="w-3.5 h-3.5 text-sky-700" /> Cold-Box Temp (°C)
                </span>
                <span className="font-mono font-bold text-emerald-800 text-xs">{coldBoxTemp}°C</span>
              </div>
              <input
                type="range"
                min="0"
                max="12"
                step="0.5"
                value={coldBoxTemp}
                onChange={(e) => setColdBoxTemp(Number(e.target.value))}
                className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-sky-700"
              />
              <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                <span>0°C</span>
                <span className="text-emerald-700 font-bold">2°C – 8°C (Certified Safe Range)</span>
                <span>12°C</span>
              </div>
            </div>

            {/* 2-Photo Proof Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                  Mandatory 2-Photo Proof (Specimens & Selfie) <span className="text-rose-600 font-bold">*</span>
                </label>
              </div>

              {/* Watermarking Progress Alert */}
              {watermarking && (
                <div className="bg-sky-50 border border-sky-200 rounded-lg p-2.5 flex items-center gap-2 text-sky-900 text-xs font-medium animate-pulse">
                  <Loader2 className="w-4 h-4 text-sky-600 animate-spin shrink-0" />
                  <span>Processing & Geotagging ISO-15189 Watermarked Chain of Custody Proof...</span>
                </div>
              )}

              {/* Photo 1: Specimen Vials in Rack */}
              <div 
                className={`border rounded-lg p-3 space-y-2 transition-all ${
                  !stopPhoto && pickupFormError && pickupRemarkType === 'Collected sample'
                    ? 'border-rose-400 bg-rose-50/50 ring-2 ring-rose-300'
                    : 'border-slate-200 bg-slate-50/50'
                }`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const droppedFile = e.dataTransfer.files?.[0];
                  if (droppedFile) processSelectedFile(droppedFile, 'photo1');
                }}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-800 flex items-center gap-1.5">
                    <Package className="w-3.5 h-3.5 text-sky-700" />
                    <span>Photo 1: Specimen Vials in Chiller Rack</span>
                    <span className="text-rose-600 font-bold">*</span>
                  </span>
                  {stopPhoto ? (
                    <span className="text-[10px] text-emerald-700 font-bold flex items-center gap-1">
                      <Check className="w-3 h-3" /> Geotagged
                    </span>
                  ) : (
                    <span className="text-[10px] text-rose-700 font-bold bg-rose-100/90 px-1.5 py-0.5 rounded border border-rose-200">
                      * Required Photo
                    </span>
                  )}
                </div>

                <input
                  ref={fileInputRef1}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => handlePhotoCapture(e, 'photo1')}
                />
                <input
                  ref={fileGalleryRef1}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handlePhotoCapture(e, 'photo1')}
                />

                {stopPhoto ? (
                  <div className="relative rounded-lg overflow-hidden border border-slate-200 group">
                    <img src={stopPhoto} alt="Specimen Vials Proof" className="w-full h-32 object-cover" />
                    <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/70 to-transparent flex items-center justify-between">
                      <span className="text-[10px] text-white font-mono truncate max-w-[200px]">
                        Vials Geotagged
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => fileInputRef1.current?.click()}
                          className="px-2 py-0.5 bg-white/90 hover:bg-white text-slate-900 rounded text-[11px] font-semibold cursor-pointer"
                        >
                          Retake
                        </button>
                        <button
                          type="button"
                          onClick={() => setStopPhoto(null)}
                          className="p-1 bg-red-600/90 hover:bg-red-600 text-white rounded text-[11px] cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef1.current?.click()}
                      disabled={watermarking}
                      className="py-3 px-1.5 border-2 border-dashed border-sky-400 rounded-lg bg-sky-50/70 hover:bg-sky-100 text-sky-900 font-bold text-xs flex flex-col items-center justify-center gap-1 cursor-pointer active:scale-98 transition-all"
                      title="Open Live Camera"
                    >
                      <Camera className="w-4 h-4 text-sky-700" />
                      <span className="text-[11px]">{watermarking ? '...' : 'Camera'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => fileGalleryRef1.current?.click()}
                      disabled={watermarking}
                      className="py-3 px-1.5 border border-slate-300 rounded-lg bg-white hover:bg-slate-100 text-slate-800 font-bold text-xs flex flex-col items-center justify-center gap-1 cursor-pointer active:scale-98 transition-all"
                      title="Select from Photo Library / Files or Drag & Drop"
                    >
                      <Upload className="w-4 h-4 text-slate-600" />
                      <span className="text-[11px]">Upload</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Photo 2: Rider Location Selfie */}
              <div 
                className={`border rounded-lg p-3 space-y-2 transition-all ${
                  !stopPhoto2 && pickupFormError
                    ? 'border-rose-400 bg-rose-50/50 ring-2 ring-rose-300'
                    : 'border-slate-200 bg-slate-50/50'
                }`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const droppedFile = e.dataTransfer.files?.[0];
                  if (droppedFile) processSelectedFile(droppedFile, 'photo2');
                }}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-800 flex items-center gap-1.5">
                    <UserCheck className="w-3.5 h-3.5 text-sky-700" />
                    <span>Photo 2: Rider Location Selfie</span>
                    <span className="text-rose-600 font-bold">*</span>
                  </span>
                  {stopPhoto2 ? (
                    <span className="text-[10px] text-emerald-700 font-bold flex items-center gap-1">
                      <Check className="w-3 h-3" /> Geotagged
                    </span>
                  ) : (
                    <span className="text-[10px] text-rose-700 font-bold bg-rose-100/90 px-1.5 py-0.5 rounded border border-rose-200">
                      * Required Selfie
                    </span>
                  )}
                </div>

                <input
                  ref={fileInputRef2}
                  type="file"
                  accept="image/*"
                  capture="user"
                  className="hidden"
                  onChange={(e) => handlePhotoCapture(e, 'photo2')}
                />
                <input
                  ref={fileGalleryRef2}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handlePhotoCapture(e, 'photo2')}
                />

                {stopPhoto2 ? (
                  <div className="relative rounded-lg overflow-hidden border border-slate-200 group">
                    <img src={stopPhoto2} alt="Rider Location Selfie Proof" className="w-full h-32 object-cover" />
                    <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/70 to-transparent flex items-center justify-between">
                      <span className="text-[10px] text-white font-mono truncate max-w-[200px]">
                        Selfie Geotagged
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => fileInputRef2.current?.click()}
                          className="px-2 py-0.5 bg-white/90 hover:bg-white text-slate-900 rounded text-[11px] font-semibold cursor-pointer"
                        >
                          Retake
                        </button>
                        <button
                          type="button"
                          onClick={() => setStopPhoto2(null)}
                          className="p-1 bg-red-600/90 hover:bg-red-600 text-white rounded text-[11px] cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef2.current?.click()}
                      disabled={watermarking}
                      className="py-3 px-1.5 border-2 border-dashed border-sky-400 rounded-lg bg-sky-50/70 hover:bg-sky-100 text-sky-900 font-bold text-xs flex flex-col items-center justify-center gap-1 cursor-pointer active:scale-98 transition-all"
                      title="Open Front Camera Selfie"
                    >
                      <Camera className="w-4 h-4 text-sky-700" />
                      <span className="text-[11px]">{watermarking ? '...' : 'Selfie'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => fileGalleryRef2.current?.click()}
                      disabled={watermarking}
                      className="py-3 px-1.5 border border-slate-300 rounded-lg bg-white hover:bg-slate-100 text-slate-800 font-bold text-xs flex flex-col items-center justify-center gap-1 cursor-pointer active:scale-98 transition-all"
                      title="Select Selfie from Photo Library / Files or Drag & Drop"
                    >
                      <Upload className="w-4 h-4 text-slate-600" />
                      <span className="text-[11px]">Upload</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="pt-1">
              <button
                type="button"
                onClick={handleConfirmStopPickup}
                disabled={watermarking}
                className="w-full py-2.5 bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white font-bold text-xs sm:text-sm rounded-lg shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-98"
              >
                <Check className="w-4 h-4" />
                <span>CONFIRM 2-PHOTO PICKUP ({vialCount} VIALS & SELFIE)</span>
              </button>

              {/* A way out that does not require scrolling back to the X in the header. */}
              <button
                type="button"
                onClick={() => setIsProcessingStop(false)}
                className="w-full mt-2 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-xs sm:text-sm rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Cancel &amp; Go Back</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Process Final Lab Delivery Handover */}
      {isProcessingDrop && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs overflow-y-auto overscroll-contain animate-fadeIn">
          <div
            className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-2xl space-y-4 my-3 sm:my-6 max-h-[94dvh] overflow-y-auto"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
          >
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm sm:text-base flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-700" />
                <span>Diagnostic Lab Handover Confirmation</span>
              </h3>
              <button
                onClick={() => {
                  setIsProcessingDrop(false);
                  setDropFormError(null);
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Error Notification Alert */}
            {dropFormError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs font-semibold flex items-center gap-2 animate-fadeIn">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{dropFormError}</span>
              </div>
            )}

            {/* Watermarking Progress Alert */}
            {watermarking && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 flex items-center gap-2 text-emerald-900 text-xs font-medium animate-pulse">
                <Loader2 className="w-4 h-4 text-emerald-600 animate-spin shrink-0" />
                <span>Processing & Geotagging Diagnostic Lab Handover Proof...</span>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                Receiver Name / Pathologist in Lab
              </label>
              <input
                type="text"
                required
                value={receiverName}
                onChange={(e) => setReceiverName(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 font-medium text-xs focus:outline-hidden focus:border-sky-600"
              />
            </div>

            <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-700 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <Thermometer className="w-3.5 h-3.5 text-emerald-700" /> Handover Temperature (°C)
                </span>
                <span className="font-mono font-bold text-emerald-800 text-xs">{coldBoxTemp}°C</span>
              </div>
              <input
                type="range"
                min="0"
                max="12"
                step="0.5"
                value={coldBoxTemp}
                onChange={(e) => setColdBoxTemp(Number(e.target.value))}
                className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-700"
              />
            </div>

            {/* Handover Photo */}
            <div 
              className={`space-y-2 p-3 rounded-lg border transition-all ${
                !stopPhoto && dropFormError
                  ? 'border-rose-400 bg-rose-50/50 ring-2 ring-rose-300'
                  : 'border-slate-200 bg-slate-50/30'
              }`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const droppedFile = e.dataTransfer.files?.[0];
                if (droppedFile) processSelectedFile(droppedFile, 'drop');
              }}
            >
              <div className="flex items-center justify-between">
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1">
                  <span>Lab Handover Photo / Signed Slip</span>
                  <span className="text-rose-600 font-bold">*</span>
                </label>
                {stopPhoto ? (
                  <span className="text-[10px] text-emerald-700 font-bold flex items-center gap-1">
                    <Check className="w-3 h-3" /> Geotagged
                  </span>
                ) : (
                  <span className="text-[10px] text-rose-700 font-bold bg-rose-100/90 px-1.5 py-0.5 rounded border border-rose-200">
                    * Required Photo
                  </span>
                )}
              </div>

              <input
                ref={dropFileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => handlePhotoCapture(e, 'drop')}
              />
              <input
                ref={dropGalleryRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handlePhotoCapture(e, 'drop')}
              />

              {stopPhoto ? (
                <div className="relative rounded-lg overflow-hidden border border-slate-200 group">
                  <img src={stopPhoto} alt="Lab Handover Proof" className="w-full h-44 object-cover" />
                  <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/70 to-transparent flex items-center justify-between">
                    <span className="text-[10px] text-white font-mono truncate max-w-[200px]">
                      GPS & Lab Handover Tagged
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => dropFileInputRef.current?.click()}
                        className="px-2.5 py-1 bg-white/90 hover:bg-white text-slate-900 rounded text-xs font-semibold shadow-xs cursor-pointer"
                      >
                        Retake
                      </button>
                      <button
                        type="button"
                        onClick={() => setStopPhoto(null)}
                        className="p-1 bg-red-600/90 hover:bg-red-600 text-white rounded text-xs cursor-pointer"
                        title="Remove photo"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => dropFileInputRef.current?.click()}
                    disabled={watermarking}
                    className="py-3 px-2 border-2 border-dashed border-emerald-400 rounded-lg bg-emerald-50/70 hover:bg-emerald-100 text-emerald-900 font-bold text-xs flex flex-col items-center justify-center gap-1 cursor-pointer active:scale-98 transition-all"
                    title="Take photo with camera"
                  >
                    <Camera className="w-4 h-4 text-emerald-700" />
                    <span className="text-[11px]">{watermarking ? '...' : 'Camera'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => dropGalleryRef.current?.click()}
                    disabled={watermarking}
                    className="py-3 px-2 border border-slate-300 rounded-lg bg-white hover:bg-slate-100 text-slate-800 font-bold text-xs flex flex-col items-center justify-center gap-1 cursor-pointer active:scale-98 transition-all"
                    title="Choose from photo library / signed slip file or drag & drop"
                  >
                    <Upload className="w-4 h-4 text-slate-600" />
                    <span className="text-[11px]">Upload Slip</span>
                  </button>
                </div>
              )}
            </div>

            <div className="pt-1">
              <button
                type="button"
                onClick={handleConfirmLabDelivery}
                disabled={watermarking}
                className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold text-xs sm:text-sm rounded-lg shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-98"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {!stopPhoto
                    ? 'COMPLETE LAB DELIVERY (Photo Required)'
                    : 'COMPLETE LAB DELIVERY'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setIsProcessingDrop(false)}
                className="w-full mt-2 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-xs sm:text-sm rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Cancel &amp; Go Back</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delay Report Modal */}
      {showDelayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm sm:text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span>Report Delay to Ops & Client</span>
              </h3>
              <button onClick={() => setShowDelayModal(false)} className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Select Delay Reason (1-Tap)
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  'Heavy Traffic / Rain',
                  'Bike Breakdown',
                  'Hospital Lab Busy / Packaging',
                  'Chiller Ice Pack Replacement',
                  'Route Diverted'
                ].map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => setDelayReason(reason)}
                    className={`p-2 rounded-lg text-xs font-semibold text-left transition-colors border shadow-xs cursor-pointer ${
                      delayReason === reason
                        ? 'bg-amber-50 text-amber-900 border-amber-400'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {reason}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-1">
              <button
                type="button"
                onClick={handleReportDelay}
                className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs sm:text-sm rounded-lg shadow-xs transition-all active:scale-95 cursor-pointer"
              >
                DISPATCH DELAY ALERT (+20 MINS)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vehicle Type Selection & Duty Start Modal */}
      {showVehicleDutyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-sky-50 text-sky-700 rounded-lg">
                  <Bike className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">
                    {isCheckedIn ? 'Update Vehicle Profile' : 'Start Shift & Select Vehicle'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {isCheckedIn ? 'Change your assigned 2-wheeler' : 'Select vehicle type to begin live tracking'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowVehicleDutyModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Vehicle Type Selection */}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-2">
                Select Vehicle Type *
              </label>
              <div className="grid grid-cols-1 gap-2">
                {[
                  { type: 'Motorcycle / Bike', desc: 'Hero Splendor, Bajaj Pulsar, Honda Shine (Cold-Box Mounted)' },
                  { type: 'Scooter / Scooty', desc: 'Honda Activa, Suzuki Access, TVS Jupiter (Front/Rear Carrier)' },
                  { type: 'Electric EV 2-Wheeler', desc: 'Ola S1, Ather 450, TVS iQube, Bajaj Chetak (Zero Emission)' }
                ].map((item) => {
                  const isSelected = selectedVehicleType === item.type;
                  return (
                    <button
                      key={item.type}
                      type="button"
                      onClick={() => setSelectedVehicleType(item.type)}
                      className={`p-3 rounded-lg border text-left flex items-center justify-between transition-all cursor-pointer ${
                        isSelected
                          ? 'border-sky-600 bg-sky-50/70 ring-1 ring-sky-600 shadow-xs'
                          : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${isSelected ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                          <Bike className="w-4 h-4" />
                        </div>
                        <div>
                          <span className={`text-xs font-bold block ${isSelected ? 'text-sky-950' : 'text-slate-800'}`}>
                            {item.type}
                          </span>
                          <span className="text-[10px] text-slate-500 mt-0.5 block">{item.desc}</span>
                        </div>
                      </div>
                      {isSelected ? (
                        <CheckCircle2 className="w-5 h-5 text-sky-700 shrink-0" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border border-slate-300 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Vehicle Registration Plate */}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Vehicle Plate Number
              </label>
              <input
                type="text"
                value={selectedVehicleNumber}
                onChange={(e) => setSelectedVehicleNumber(e.target.value.toUpperCase())}
                placeholder="e.g. MH-02-AB-1234"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-mono font-bold text-sm tracking-wider uppercase focus:outline-hidden focus:border-sky-600 focus:bg-white"
              />
            </div>

            <div className="pt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowVehicleDutyModal(false)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleSaveVehicleAndDuty(selectedVehicleType, selectedVehicleNumber, !isCheckedIn)}
                className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs sm:text-sm rounded-lg shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-98"
              >
                <UserCheck className="w-4 h-4" />
                <span>{isCheckedIn ? 'SAVE VEHICLE' : 'CONFIRM & PUNCH IN'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Back Button / Exit Shift Confirmation Modal */}
      {showExitConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
              <div className="p-2.5 bg-amber-50 text-amber-700 rounded-full shrink-0">
                <AlertTriangle className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-base">You are currently On Duty</h3>
                <p className="text-xs text-slate-500">Live GPS tracking and collection rounds are active</p>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Are you sure you want to end your shift and exit the rider portal? Your live GPS beacon will be paused and your status will be set to Off Duty.
            </p>

            <div className="pt-2 flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setShowExitConfirmModal(false)}
                className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs sm:text-sm rounded-lg shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>STAY ON DUTY</span>
              </button>
              <button
                type="button"
                onClick={handleConfirmExit}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-red-50 text-slate-700 hover:text-red-700 border border-slate-200 hover:border-red-200 font-bold text-xs sm:text-sm rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>END SHIFT & EXIT</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
