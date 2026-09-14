import React, { useState, useMemo, useEffect } from 'react';
import { PickupTask, PickupBoy, Route, Client, NotificationLog } from '../../types';
import { LiveMap } from '../common/LiveMap';
import { DispatchModal } from './DispatchModal';
import { RiderTelemetryRadar } from './RiderTelemetryRadar';
import { isRiderLocationStale } from '../../services/locationService';
import {
  Calendar,
  Clock,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  Bike,
  Package,
  Search,
  Eye,
  PhoneCall,
  Plus,
  Trash2,
  X,
  UserCheck,
  RefreshCw,
  Navigation,
  MessageCircle,
  Play,
  Send
} from 'lucide-react';
import { StorageService } from '../../services/storage';
import { db, formatUnifiedTask, CloudSync } from '../../services/firebase';
import { collection, onSnapshot, doc, updateDoc, deleteDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { localDateKey } from '../../utils/timeSlots';
import { buildCanonicalTaskId, resolveTaskDate } from '../../utils/taskId';

interface AdminDashboardProps {
  tasks: PickupTask[];
  riders: PickupBoy[];
  routes: Route[];
  clients: Client[];
  notifications: NotificationLog[];
  onOpenProof: (task: PickupTask) => void;
  onRefresh: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  tasks: initialTasks,
  riders,
  routes,
  clients,
  notifications,
  onOpenProof,
  onRefresh
}) => {
  const [firestoreTasks, setFirestoreTasks] = useState<PickupTask[]>([]);
  const [hasLoadedFirestoreTasks, setHasLoadedFirestoreTasks] = useState<boolean>(false);
  const [activeRoundsCount, setActiveRoundsCount] = useState<number>(0);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'alerts'>('all');
  // Archive: the Priority Feed shows TODAY only; everything older lives behind the Total Rounds card.
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [archiveDate, setArchiveDate] = useState<string>(() => localDateKey());
  const [archiveQuery, setArchiveQuery] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [dispatchNotice, setDispatchNotice] = useState<string | null>(null);

  const [isDispatchModalOpen, setIsDispatchModalOpen] = useState(false);
  const [reassignTask, setReassignTask] = useState<PickupTask | null>(null);
  const [selectedNewRiderId, setSelectedNewRiderId] = useState<string>('');
  const [isReassigning, setIsReassigning] = useState(false);

  useEffect(() => {
    try {
      const q = collection(db, 'tasks');
      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const taskList: PickupTask[] = snapshot.docs.map((docSnap) => {
            const data = docSnap.data();
            return formatUnifiedTask(docSnap.id, { id: docSnap.id, ...data });
          });

          taskList.sort((a, b) => {
            const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return timeB - timeA;
          });

          setFirestoreTasks(taskList);
          setHasLoadedFirestoreTasks(true);

          const active = taskList.filter((t) => t.status === 'assigned' || t.status === 'in_transit');
          setActiveRoundsCount(active.length);
        },
        (err: any) => {
          if (err?.code === 'permission-denied' || err?.message?.includes('permissions')) {
            console.info('[AdminDashboard] Firestore security rules require permission for /tasks collection in project secondmedic-vialtrack. Falling back to local data.');
          } else {
            console.warn('[AdminDashboard] Live tasks listener notice:', err?.message || err);
          }
          setHasLoadedFirestoreTasks(true);
        }
      );

      return () => unsubscribe();
    } catch (e) {
      console.warn('[AdminDashboard] Setup tasks listener failed:', e);
      setHasLoadedFirestoreTasks(true);
    }
  }, []);

  const allTasks = useMemo(() => {
    const rawList = firestoreTasks.length > 0 ? firestoreTasks : (initialTasks || []);
    const mergedMap = new Map<string, PickupTask>();

    rawList.forEach((t) => {
      if (!t || !t.id) return;
      const tDate = t.scheduledDate || t.date || (t.createdAt ? t.createdAt.split('T')[0] : '');
      const groupKey = `${t.routeId || t.routeName || 'direct'}_${t.timeSlot || 'slot'}_${tDate}_${t.riderId || 'rider'}`;

      if (!mergedMap.has(groupKey)) {
        mergedMap.set(groupKey, { ...t });
      } else {
        const existing = mergedMap.get(groupKey)!;
        const existingStops = existing.stopsProgress || existing.stops || [];
        const incomingStops = t.stopsProgress || t.stops || [];

        const existingVials = existingStops.reduce((sum: number, s: any) => sum + Number(s?.sampleCount || s?.specimenCount || 0), 0);
        const incomingVials = incomingStops.reduce((sum: number, s: any) => sum + Number(s?.sampleCount || s?.specimenCount || 0), 0);

        const isExistingDelivered = existing.status === 'delivered' || existing.status === 'completed';
        const isIncomingDelivered = t.status === 'delivered' || t.status === 'completed';

        // Choose best stops array that contains collected photos or vials
        const bestStops = incomingStops.some((s: any) => s.photoUrl || s.status === 'picked_up')
          ? incomingStops
          : existingStops;

        const bestStatus = isIncomingDelivered || isExistingDelivered
          ? 'delivered'
          : (t.status === 'in_transit' || existing.status === 'in_transit' ? 'in_transit' : (t.status || existing.status));

        mergedMap.set(groupKey, {
          ...existing,
          ...t,
          id: existing.id,
          status: bestStatus,
          stopsProgress: bestStops as any,
          stops: bestStops as any,
          destination: {
            ...existing.destination,
            ...t.destination,
            dropPhotoUrl: t.destination?.dropPhotoUrl || existing.destination?.dropPhotoUrl || (t as any).handoverPhotoUrl || (existing as any).handoverPhotoUrl,
            receiverName: t.destination?.receiverName || existing.destination?.receiverName || t.receiverName || existing.receiverName,
            deliveredAt: t.destination?.deliveredAt || existing.destination?.deliveredAt || t.deliveryTimestamp || existing.deliveryTimestamp,
            coldBoxTempAtDrop: t.destination?.coldBoxTempAtDrop ?? existing.destination?.coldBoxTempAtDrop,
            totalVialsHandedOver: Math.max(
              t.destination?.totalVialsHandedOver || 0,
              existing.destination?.totalVialsHandedOver || 0,
              incomingVials,
              existingVials
            )
          }
        });
      }
    });

    const result = Array.from(mergedMap.values());
    result.sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeB - timeA;
    });
    return result;
  }, [firestoreTasks, initialTasks]);

  useEffect(() => {
    if (allTasks.length > 0) {
      if (!selectedTaskId || !allTasks.some((t) => t.id === selectedTaskId)) {
        setSelectedTaskId(allTasks[0].id);
      }
    } else {
      setSelectedTaskId(null);
    }
  }, [allTasks, selectedTaskId]);

  const handleTaskDispatched = (newTask: PickupTask) => {
    setSelectedTaskId(newTask.id);
    onRefresh();
    setDispatchNotice(`Dispatched new pickup round #${newTask.id.slice(-6)} to ${newTask.riderName}!`);
    setTimeout(() => setDispatchNotice(null), 4500);
  };

  const handleForceDispatchScheduled = async (task: PickupTask, e: React.MouseEvent) => {
    e.stopPropagation();

    // Dispatching with no rider resolved produced a round nobody was accountable for and a notice
    // reading "Dispatched round to undefined". Send the operator to Reassign instead.
    if (!task.riderId && !(task as any).assignedRiderId) {
      setReassignTask(task);
      setSelectedNewRiderId(riders[0]?.id || '');
      return;
    }

    try {
      // `task-${Date.now()}` carries no date segment, so resolveTaskDate's
      // /^task-(\d{4}-\d{2}-\d{2})-/ never matched it and the round fell back to the mutable
      // date field -- losing exactly the ID-based protection that stops an old round reappearing
      // as today's. Use the same canonical builder every other creator uses.
      const taskId = task.id.startsWith('scheduled-')
        ? buildCanonicalTaskId(task.routeId, task.timeSlot, todayStr)
        : task.id;
      const cleanTask: PickupTask = {
        ...task,
        id: taskId,
        status: 'assigned',
        createdAt: new Date().toISOString()
      };

      await setDoc(doc(db, 'tasks', taskId), cleanTask);
      await setDoc(doc(db, 'trips', taskId), cleanTask);
      StorageService.updateTask(cleanTask);

      setSelectedTaskId(taskId);
      setDispatchNotice(`Dispatched scheduled round #${taskId.slice(-6)} to ${task.riderName}! Live alert sent to rider.`);
      setTimeout(() => setDispatchNotice(null), 4500);
      onRefresh();
    } catch (err) {
      console.warn('Dispatch error:', err);
    }
  };

  const handleDeleteTask = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Are you sure you want to cancel and delete this pickup round?')) {
      try {
        await deleteDoc(doc(db, 'tasks', taskId));
        await deleteDoc(doc(db, 'trips', taskId));
        await deleteDoc(doc(db, 'smvt_tasks', taskId));
      } catch (err) {
        console.warn('Firestore task delete error:', err);
      }
      StorageService.deleteTask(taskId);
      if (selectedTaskId === taskId) {
        setSelectedTaskId(null);
      }
      onRefresh();
      setDispatchNotice(`Task #${taskId.slice(-6)} was cancelled.`);
      setTimeout(() => setDispatchNotice(null), 3500);
    }
  };

  const handleOpenReassign = (task: PickupTask, e: React.MouseEvent) => {
    e.stopPropagation();
    setReassignTask(task);
    setSelectedNewRiderId(task.riderId || riders[0]?.id || '');
  };

  const handleSaveReassign = async () => {
    if (!reassignTask || !selectedNewRiderId) return;
    const targetRider = riders.find((r) => r.id === selectedNewRiderId);
    if (!targetRider) return;

    setIsReassigning(true);
    try {
      // A not-yet-dispatched round has NO tasks/ document -- its id is synthesised from the route
      // (`scheduled-<routeId>-<slot>-<date>`). updateDoc on tasks/scheduled-... throws "No document
      // to update", so reassigning an undispatched round failed silently behind a generic alert,
      // and even on success the next render rebuilt the card from the route and reverted it.
      // For pipeline rounds the assignment belongs on the ROUTE, which is where the builder reads it.
      const isPipeline = reassignTask.id.startsWith('scheduled-');

      if (isPipeline) {
        if (!reassignTask.routeId) throw new Error('Pipeline round carries no routeId to assign against');
        await updateDoc(doc(db, 'routes', reassignTask.routeId), {
          assignedRiderId: targetRider.id,
          assignedRiderName: targetRider.name,
          updatedAt: new Date().toISOString()
        });
      } else {
        const updatedFields = {
          riderId: targetRider.id,
          riderName: targetRider.name,
          riderPhone: targetRider.phone,
          // Written on both aliases so every reader agrees, whichever field it looks at.
          assignedRiderId: targetRider.id,
          assignedRiderName: targetRider.name,
          status: reassignTask.status === 'pending' ? 'assigned' : reassignTask.status,
          updatedAt: new Date().toISOString()
        };

        await updateDoc(doc(db, 'tasks', reassignTask.id), updatedFields);
        StorageService.updateTask({
          ...reassignTask,
          ...updatedFields
        });
      }

      setDispatchNotice(
        `Reassigned ${isPipeline ? 'route' : `task #${reassignTask.id.slice(-6)}`} to ${targetRider.name}!`
      );
      setTimeout(() => setDispatchNotice(null), 4000);
      setReassignTask(null);
      onRefresh();
    } catch (err) {
      console.error('Reassign error:', err);
      alert(`Failed to reassign rider: ${(err as any)?.message || 'unknown error'}`);
    } finally {
      setIsReassigning(false);
    }
  };

  // A round's operational date: whatever it was scheduled for, falling back to when it was created.
  // Resolved from the task ID first -- see resolveTaskDate. The date fields on the document are
  // rewritten by full-document syncs, which is how a 4 September round started claiming to be
  // today's and reappeared in the live feed.
  const taskDateOf = (task: any): string => resolveTaskDate(task);

  // Local date (toISOString is UTC and reports yesterday until 05:30 IST), refreshed on the hour
  // boundary so an admin console left open overnight rolls onto the new day.
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

  // Rounds scheduled for today -- this is what the live dispatch feed shows. Anything older is
  // history and belongs in the archive, not in the operator's working view.
  //
  // This includes the PIPELINE: every route/time-slot combination due today that has not been
  // dispatched yet. Previously the feed listed only rounds already sent to a rider, so an operator
  // had no view of what was still owed today -- a 14:00 loop simply did not exist on screen until
  // someone remembered to dispatch it. Pipeline entries carry a `scheduled-` id, which the
  // existing "Force Dispatch" handler already understands.
  const todaysTasks = useMemo(() => {
    const dispatched = (allTasks || []).filter((t) => t && taskDateOf(t) === todayStr);

    const isSameRound = (routeId: string, slot: string) =>
      dispatched.some(
        (t: any) =>
          (t.routeId === routeId || t.routeName === (routes || []).find((r) => r.id === routeId)?.name) &&
          String(t.timeSlot || '') === String(slot)
      );

    const pipeline: PickupTask[] = [];
    (routes || []).forEach((route: any) => {
      const slots: string[] = Array.isArray(route?.timeSlots) ? route.timeSlots : [];
      slots.forEach((slot) => {
        if (!slot || isSameRound(route.id, slot)) return;

        const client = (clients || []).find((c) => c.id === route.clientId);
        // Assignment can live on EITHER side: dispatch stamps assignedRiderId onto the route,
        // while Admin > Pickup Boys > Edit Rider writes rider.assignedRouteIds. Checking only the
        // route side made every pipeline round read "Unassigned Rider" even when a rider was
        // clearly assigned to that loop.
        const rider =
          (riders || []).find((r) => r.id === route.assignedRiderId) ||
          (riders || []).find(
            (r) => Array.isArray((r as any).assignedRouteIds) && (r as any).assignedRouteIds.includes(route.id)
          );

        pipeline.push({
          id: `scheduled-${route.id}-${slot}-${todayStr}`,
          routeId: route.id,
          routeName: route.name,
          clientId: route.clientId,
          clientName: client?.name || route.clientName || 'Client Lab',
          clientLabName: client?.name || route.clientName || 'Client Lab',
          riderId: rider?.id || route.assignedRiderId || '',
          riderName: rider?.name || route.assignedRiderName || '',
          riderPhone: (rider as any)?.phone || '',
          riderVehicle: rider?.vehicleNumber || '',
          timeSlot: slot,
          scheduledDate: todayStr,
          date: todayStr,
          status: 'upcoming',
          stopsProgress: (route.stops || []).map((st: any, i: number) => ({
            stopIndex: i,
            stopId: st.id || `stop-${i}`,
            stopName: st.stopName || st.name || `Stop ${i + 1}`,
            address: st.address || '',
            lat: st.lat,
            lng: st.lng,
            pickupTime: st.pickupTime || '',
            status: 'pending',
            sampleCount: 0,
            specimenCount: 0
          })),
          destination: route.destinationLab || undefined,
          createdAt: `${todayStr}T${String(slot).padStart(5, '0')}:00`
        } as any);
      });
    });

    return [...dispatched, ...pipeline];
  }, [allTasks, todayStr, routes, clients, riders]);

  // Rounds shown in the archive. An empty archiveDate means "all dates".
  const archiveTasks = useMemo(() => {
    const q = archiveQuery.trim().toLowerCase();
    return (allTasks || [])
      .filter((t: any) => {
        if (!t) return false;
        if (archiveDate && taskDateOf(t) !== archiveDate) return false;
        if (!q) return true;
        const stops = t.stopsProgress || t.stops || [];
        return (
          String(t.clientLabName || t.clientName || '').toLowerCase().includes(q) ||
          String(t.routeName || '').toLowerCase().includes(q) ||
          String(t.riderName || '').toLowerCase().includes(q) ||
          String(t.timeSlot || '').toLowerCase().includes(q) ||
          stops.some((st: any) => String(st?.stopName || st?.name || '').toLowerCase().includes(q))
        );
      })
      // Newest first, then by slot, so "all dates" reads as a reverse-chronological log.
      .sort((a: any, b: any) => {
        const d = taskDateOf(b).localeCompare(taskDateOf(a));
        if (d !== 0) return d;
        return String(a.timeSlot || '').localeCompare(String(b.timeSlot || ''));
      });
  }, [allTasks, archiveDate, archiveQuery]);

  // Vials across everything currently listed in the archive.
  const archiveVialTotal = useMemo(
    () =>
      archiveTasks.reduce((sum: number, t: any) => {
        const stops = t.stopsProgress || t.stops || [];
        return sum + stops.reduce((n: number, st: any) => n + Number(st?.sampleCount || st?.specimenCount || 0), 0);
      }, 0),
    [archiveTasks]
  );

  // Rounds from previous days that were never delivered sit in the data forever: they keep
  // appearing in feeds, they count towards "active in field", and on the rider side a sequential
  // lock can leave them looking like unfinished business ahead of today's work. This closes them
  // out in one action -- it does NOT touch anything dated today, and it does not delete the
  // records, so the archive and any captured proofs stay intact.
  // Documents whose stored date field disagrees with their ID. These are the ones that resurface
  // in "today" -- the ID says 2026-09-04, some sync rewrote date to 2026-09-12. Repairing the
  // field makes every other view agree, not just the ones using resolveTaskDate.
  const misdatedRounds = useMemo(
    () =>
      (allTasks || []).filter((t: any) => {
        const idDate = String(t?.id || '').match(/^task-(\d{4}-\d{2}-\d{2})-/);
        if (!idDate) return false;
        return (t.date && t.date !== idDate[1]) || (t.scheduledDate && t.scheduledDate !== idDate[1]);
      }),
    [allTasks]
  );

  const staleRounds = useMemo(
    () =>
      (allTasks || []).filter((t: any) => {
        const d = taskDateOf(t);
        if (!d || d >= todayStr) return false;
        return (
          t.status !== 'delivered' &&
          t.status !== 'completed' &&
          t.status !== 'missed' &&
          (t.destination as any)?.status !== 'delivered'
        );
      }),
    [allTasks, todayStr]
  );

  const [isClosingStale, setIsClosingStale] = useState(false);

  const handleCloseOutStaleRounds = async () => {
    if (staleRounds.length === 0 && misdatedRounds.length === 0) return;
    if (
      !window.confirm(
        `Repair ${misdatedRounds.length} misdated round(s) and close out ${staleRounds.length} unfinished round(s) from previous days?\n\n` +
          `They will be marked "missed" and will stop appearing as active work. Today's rounds are not affected, and nothing is deleted.`
      )
    )
      return;

    setIsClosingStale(true);
    let done = 0;

    // First, repair any document whose date field contradicts its ID, so it stops appearing as
    // today's work in every view -- including ones that read the raw field.
    for (const task of misdatedRounds) {
      const idDate = String(task.id).match(/^task-(\d{4}-\d{2}-\d{2})-/);
      if (!idDate) continue;
      try {
        await updateDoc(doc(db, 'tasks', task.id), {
          date: idDate[1],
          scheduledDate: idDate[1],
          dateRepairedAt: serverTimestamp()
        });
        StorageService.updateTask({ ...(task as any), date: idDate[1], scheduledDate: idDate[1] });
      } catch (err) {
        console.warn('[AdminDashboard] Could not repair date on', task.id, err);
      }
    }

    for (const task of staleRounds) {
      try {
        await updateDoc(doc(db, 'tasks', task.id), {
          status: 'missed',
          closedOutAt: serverTimestamp(),
          closedOutReason: 'Auto-closed: not completed on its scheduled date'
        });
        try {
          await updateDoc(doc(db, 'trips', task.id), { status: 'missed' });
        } catch {
          // No mirror trip document for this round -- nothing to close there.
        }
        StorageService.updateTask({ ...(task as any), status: 'missed' });
        done += 1;
      } catch (err) {
        console.warn('[AdminDashboard] Could not close out round', task.id, err);
      }
    }
    setIsClosingStale(false);
    window.alert(`Closed out ${done} of ${staleRounds.length} old round(s).`);
    onRefresh();
  };

  const filteredTasks = useMemo(() => {
    return (todaysTasks || []).filter((task) => {
      if (!task) return false;
      const isTaskDelayed =
        task.isDelayed === true ||
        (task as any).tempAlert === true ||
        task.status === 'delayed' ||
        (Array.isArray(task.issueFlags) && task.issueFlags.some((i) => !i.resolved));

      if (statusFilter === 'alerts') {
        return isTaskDelayed;
      }

      if (statusFilter === 'active') {
        return (
          ['assigned', 'in_transit', 'scheduled', 'in_progress', 'started', 'at_stop', 'picked_up'].includes(
            task.status || ''
          ) && !isTaskDelayed
        );
      }

      return true;
    });
  }, [todaysTasks, statusFilter]);

  const activeRiders = (riders || []).filter((r) => r && r.status === 'active' && r.isCheckedIn);
  const totalScheduled = (allTasks || []).length;
  const delayedTasks = (allTasks || []).filter(
    (t) =>
      t &&
      (t.isDelayed === true ||
        (t as any).tempAlert === true ||
        t.status === 'delayed' ||
        (Array.isArray(t.issueFlags) && t.issueFlags.some((i) => !i.resolved)))
  );
  const delayedCount = delayedTasks.length;
  const activeRounds = (allTasks || []).filter((t) =>
    t && t.status && ['assigned', 'in_transit', 'scheduled', 'in_progress', 'started', 'at_stop', 'picked_up'].includes(t.status)
  ).length;

  const totalVialsMoved = (allTasks || []).reduce((sum, t) => {
    const stops = t?.stopsProgress || t?.stops || [];
    return sum + stops.reduce((sSum: number, s: any) => sSum + Number(s?.sampleCount || s?.specimenCount || 0), 0);
  }, 0);

  const activeTask = selectedTaskId ? (allTasks || []).find((t) => t && t.id === selectedTaskId) : (allTasks || [])[0];
  const activeRoute = activeTask
    ? (routes || []).find((r) => r && r.id === activeTask.routeId) || {
        id: activeTask.id,
        clientId: activeTask.clientLabId || activeTask.clientId,
        name: activeTask.routeName || 'Pickup Loop',
        // Stops with no recorded coordinates are omitted, not pinned to a default. The old
        // `s?.lat || 19.1287` put every coordinate-less stop on the same spot in Kandivali, so
        // the map showed collection points at an address nobody had ever entered.
        stops: (activeTask.stopsProgress || activeTask.stops || [])
          .filter((s: any) => Number.isFinite(Number(s?.lat)) && Number.isFinite(Number(s?.lng)))
          .map((s: any, idx: number) => ({
          id: s?.stopId || s?.id || `s-${idx}`,
          name: s?.stopName || s?.name || `Stop ${idx + 1}`,
          address: s?.address || '',
          lat: Number(s.lat),
          lng: Number(s.lng),
          contactPerson: s?.contactPerson || 'Collection Point',
          contactPhone: s?.phone || '',
          expectedTime: '--'
        })),
        destinationLab: {
          name: activeTask.clientName || 'Processing Lab',
          address: '',
          lat: (activeTask as any).clientLocation?.lat || activeTask.clientLabLocation?.lat || 19.1300,
          lng: (activeTask as any).clientLocation?.lng || activeTask.clientLabLocation?.lng || 72.8350,
          contactPerson: '',
          contactPhone: ''
        },
        frequency: 'Daily',
        timeSlots: activeTask.timeSlot ? [activeTask.timeSlot] : [],
        bufferTimeMinutes: 15
      }
    : undefined;

  // Only a REAL rider document counts. The previous fallback synthesised a rider object with
  // `isOnline: true, isCheckedIn: true` hardcoded whenever the fleet list had no match -- so the
  // console asserted a rider was online and on duty on the strength of nothing but a riderId
  // string on the task, and LiveMap then drew a marker for them.
  const assignedRiderId =
    activeTask?.riderId || (activeTask as any)?.assignedRiderId || (activeTask as any)?.activeRiderId;
  const assignedRider: PickupBoy | undefined = assignedRiderId
    ? (riders || []).find((r) => r && r.id === assignedRiderId)
    : undefined;

  // Is the rider actually working this round right now? Same gate the client portal applies
  // (ClientLiveTracking.isTripActive): an assignment on paper is not a live position. Without
  // this the admin map showed a confident marker, route line and ETA for a rider whose app was
  // closed -- which is how a fix from Belapur was drawn against a Kandivali/Goregaon round.
  const isRiderOnRoute = useMemo(() => {
    if (!activeTask || !assignedRider) return false;
    const s = activeTask.status;
    if (!['in_transit', 'started', 'at_stop', 'picked_up'].includes(String(s))) return false;
    if (assignedRider.isOnline === false) return false;
    if (assignedRider.isCheckedIn === false) return false;
    if ((assignedRider as any).dutyStatus === 'offline' || (assignedRider as any).dutyStatus === 'off_duty') return false;
    if (['off_duty', 'inactive', 'on_leave'].includes(String(assignedRider.status))) return false;
    return !isRiderLocationStale(assignedRider, 5);
  }, [activeTask, assignedRider]);

  return (
    <div className="space-y-5">
      {delayedCount > 0 ? (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3.5 sm:p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center shrink-0 border border-rose-300">
              <AlertTriangle className="w-4 h-4 animate-pulse" />
            </div>
            <div>
              <h3 className="font-bold text-rose-900 text-xs sm:text-sm">
                Operational Alert: {delayedCount} Pickup Round(s) Requiring Priority Attention
              </h3>
              <p className="text-[11px] text-rose-700 mt-0.5">
                Specimen transit warning or temperature SLA variance detected.
              </p>
            </div>
          </div>

          <button
            onClick={() => setStatusFilter('alerts')}
            className="w-full sm:w-auto px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-lg transition-all shadow-xs cursor-pointer"
          >
            Filter Alerts ({delayedCount})
          </button>
        </div>
      ) : totalScheduled > 0 ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 flex items-center justify-between text-xs text-emerald-800 shadow-xs">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="font-semibold text-emerald-900">
              All {totalScheduled} Dispatched Diagnostic Rounds Operating Within Cold-Chain SLA
            </span>
          </div>
          <span className="hidden sm:inline text-emerald-700 font-mono text-[11px]">
            Target Custody: 2.0°C – 8.0°C Verified Safe
          </span>
        </div>
      ) : (
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 flex items-center justify-between text-xs text-slate-600 shadow-xs">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-sky-500"></span>
            <span className="font-medium text-slate-700">Live Logistics Engine Active • Dispatched Feed Ready</span>
          </div>
          <span className="hidden sm:inline text-slate-500 font-mono text-[11px]">Click "+ Dispatch Task" to Launch</span>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        <button
          type="button"
          onClick={() => {
            setArchiveDate(new Date().toISOString().split('T')[0]);
            setIsArchiveOpen(true);
          }}
          title="Open the Specimen Intake & Verification Archive"
          className="bg-white p-4 rounded-xl shadow-xs border border-slate-200 text-left hover:border-sky-400 hover:shadow-md transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold mb-1">
            <span>Total Rounds</span>
            <Calendar className="w-4 h-4 text-sky-700" />
          </div>
          <div className="text-2xl font-bold text-slate-800">{todaysTasks.length}</div>
          <div className="mt-2 h-1 w-full bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-sky-600 w-[80%]"></div>
          </div>
          {/* The archive lists DISPATCHED rounds only, so a card counting scheduled-but-not-yet-
              dispatched pipeline entries alongside them made the two screens disagree (card said 4,
              archive said 0). Both numbers are now shown and labelled. */}
          <div className="text-[10px] text-slate-400 mt-1.5 font-medium">
            {(() => {
              const dispatchedToday = todaysTasks.filter((t: any) => !String(t.id).startsWith('scheduled-')).length;
              const pendingToday = todaysTasks.length - dispatchedToday;
              return `${dispatchedToday} dispatched${pendingToday > 0 ? ` • ${pendingToday} not yet dispatched` : ''}`;
            })()}
          </div>
          <div className="text-[10px] text-sky-700 font-bold mt-0.5">View full archive →</div>
        </button>

        <div className="bg-white p-4 rounded-xl shadow-xs border border-slate-200">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold mb-1">
            <span>Active Runners</span>
            <Bike className="w-4 h-4 text-teal-600" />
          </div>
          <div className="text-2xl font-bold text-slate-800">
            {activeRiders.length} / {riders.length}
          </div>
          <div className="mt-2 h-1 w-full bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-teal-500 w-[85%]"></div>
          </div>
          <div className="text-[10px] text-slate-400 mt-1.5 font-medium">GPS active and broadcasting</div>
        </div>

        <div className="bg-white p-4 rounded-xl shadow-xs border border-slate-200">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold mb-1">
            <span>On-Time SLA</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-emerald-600">
            {totalScheduled > 0 ? (((totalScheduled - delayedCount) / totalScheduled) * 100).toFixed(1) : '100'}%
          </div>
          <div className="mt-2 h-1 w-full bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 w-[95%]"></div>
          </div>
          <div className="text-[10px] text-emerald-600 mt-1.5 font-bold">Standard SLA &lt; 45m</div>
        </div>

        <div className="bg-white p-4 rounded-xl shadow-xs border border-slate-200">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold mb-1">
            <span>Alerts / Delayed</span>
            <AlertTriangle className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-bold text-rose-500">
            {delayedCount < 10 ? `0${delayedCount}` : delayedCount}
          </div>
          <div className="mt-2 h-1 w-full bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-rose-500" style={{ width: `${Math.min(delayedCount * 30, 100)}%` }}></div>
          </div>
          <div className="text-[10px] text-slate-400 mt-1.5 font-medium">
            {delayedCount === 0 ? 'Zero active bottlenecks' : 'Grace period exceeded'}
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl shadow-xs border border-slate-200 col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold mb-1">
            <span>Vials in Custody</span>
            <Package className="w-4 h-4 text-sky-600" />
          </div>
          <div className="text-2xl font-bold text-slate-800">{totalVialsMoved}</div>
          <div className="mt-2 h-1 w-full bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-sky-500 w-[70%]"></div>
          </div>
          <div className="text-[10px] text-slate-400 mt-1.5 font-medium">Verified biological samples</div>
        </div>
      </div>

      {/* Fleet Readiness, App Heartbeat & Punctuality Radar */}
      <RiderTelemetryRadar
        riders={riders}
        routes={routes}
        tasks={allTasks}
        onSelectRiderForMap={(r) => {
          // Find any active task for this rider and select it to focus map
          const riderTask = (allTasks || []).find((t) => t.riderId === r.id || t.assignedRiderId === r.id);
          if (riderTask) {
            setSelectedTaskId(riderTask.id);
          }
        }}
      />

      {/* Live Map + Priority Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl shadow-xs p-4 sm:p-5 flex flex-col overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3.5 pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-slate-900 text-sm sm:text-base flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-sky-700" />
                  <span>Live Operations Map & Fleet Radar</span>
                </h3>
                <p className="text-[11px] text-slate-500">
                  Tracking round:{' '}
                  <span className="font-semibold text-slate-800">
                    {activeTask ? `${activeTask.clientName || ''} (#${activeTask.id.slice(-6)})` : 'All Fleet Runners'}
                  </span>
                </p>
              </div>

              {/* Claim live tracking only when a fix has actually arrived recently. The map used
                  to say "Real-Time GPS Tracking" and draw a route regardless, so an admin watching
                  a rider whose app was closed saw a confident position that could be hours old. */}
              {(() => {
                const stale = isRiderLocationStale(assignedRider, 10);
                return (
                  <div
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold ${
                      stale
                        ? 'bg-amber-50 border-amber-300 text-amber-900'
                        : 'bg-slate-50 border-slate-200 text-slate-700'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${stale ? 'bg-amber-500' : 'bg-emerald-500 animate-pulse'}`}
                    ></span>
                    <span>{stale ? 'Last Known Position (GPS stale)' : 'Real-Time GPS Tracking'}</span>
                  </div>
                );
              })()}
            </div>

            {dispatchNotice && (
              <div className="mb-3 p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-semibold flex items-center gap-2 animate-in fade-in">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{dispatchNotice}</span>
              </div>
            )}

            <div
              style={{ height: '400px', width: '100%', borderRadius: '12px' }}
              className="h-[400px] w-full rounded-xl overflow-hidden my-2 relative z-0"
            >
              <LiveMap
                stops={activeRoute?.stops || []}
                destination={activeRoute?.destinationLab}
                rider={isRiderOnRoute ? assignedRider : undefined}
                riders={riders}
                tasks={allTasks}
                activeTaskId={selectedTaskId}
                height="400px"
                autoFit={false}
                enableFirestoreSync={true}
              />
            </div>

            {assignedRider ? (
              <div className="mt-3.5 p-3 bg-slate-50 rounded-lg border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-sky-100 border border-sky-200 text-sky-800 flex items-center justify-center font-bold">
                    <Bike className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-bold text-slate-900 flex items-center gap-2 text-xs">
                      <span>{assignedRider.name}</span>
                      <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.2 rounded-full border border-emerald-200">
                        {isRiderLocationStale(assignedRider, 10) ? 'GPS Stale' : 'GPS Active'}
                      </span>
                    </div>
                    <div className="text-slate-500 text-[11px]">
                      {assignedRider.vehicleNumber ? `${assignedRider.vehicleNumber} • ` : ''}{assignedRider.phone || 'No phone registered'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-slate-700">
                  <div>
                    <span className="text-[10px] text-slate-400 block font-semibold">Cold Box Temp</span>
                    {/* Was a hardcoded "4.0°C (Safe)" regardless of any actual reading. */}
                    <span className="font-bold font-mono text-slate-500 text-xs">
                      {(() => {
                        const t = (activeTask as any)?.coldBoxTemp ?? (activeTask as any)?.handoverTemperature;
                        return t !== undefined && t !== null ? `${Number(t).toFixed(1)}°C` : 'Not recorded';
                      })()}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block font-semibold">Phone Battery</span>
                    <span className="font-bold font-mono text-slate-800 text-xs">
                      {/* Was a hardcoded '100%' fallback -- a full battery reported for a phone
                          that never sent a reading. */}
                      {(assignedRider as any)?.batteryLevel
                        ? `${(assignedRider as any).batteryLevel}%`
                        : <span className="text-slate-400">Not reported</span>}
                    </span>
                  </div>
                  {assignedRider.phone && (
                    <a
                      href={`tel:${assignedRider.phone}`}
                      className="p-1.5 bg-white hover:bg-slate-100 text-sky-700 rounded-md transition-colors border border-slate-200"
                      title="Call Rider"
                    >
                      <PhoneCall className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Priority Feed */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl shadow-xs p-4 sm:p-5 flex flex-col h-full overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-sky-700" />
                <h3 className="font-bold text-slate-900 text-sm sm:text-base">Priority Feed & Rounds</h3>
                <span className="text-[10px] font-bold text-sky-800 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                  Today
                </span>
                {(staleRounds.length > 0 || misdatedRounds.length > 0) && (
                  <button
                    type="button"
                    onClick={handleCloseOutStaleRounds}
                    disabled={isClosingStale}
                    title="Mark unfinished rounds from previous days as missed"
                    className="text-[10px] font-bold text-amber-900 bg-amber-50 border border-amber-300 hover:bg-amber-100 px-2 py-0.5 rounded-full whitespace-nowrap cursor-pointer disabled:opacity-50"
                  >
                    {isClosingStale
                      ? 'Fixing…'
                      : `Fix ${Math.max(staleRounds.length, misdatedRounds.length)} old round${
                          Math.max(staleRounds.length, misdatedRounds.length) === 1 ? '' : 's'
                        }`}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                <button
                  onClick={() => setIsDispatchModalOpen(true)}
                  className="px-2.5 py-1 bg-sky-700 hover:bg-sky-800 text-white font-bold text-xs rounded-lg transition-colors flex items-center gap-1 shadow-xs cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Dispatch Task</span>
                </button>
                <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-[11px]">
                  <button
                    onClick={() => setStatusFilter('all')}
                    className={`px-2.5 py-0.5 rounded font-semibold transition-all cursor-pointer ${
                      statusFilter === 'all'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    All ({todaysTasks.length})
                  </button>
                  <button
                    onClick={() => setStatusFilter('active')}
                    className={`px-2.5 py-0.5 rounded font-semibold transition-all cursor-pointer ${
                      statusFilter === 'active'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Active
                  </button>
                  <button
                    onClick={() => setStatusFilter('alerts')}
                    className={`px-2.5 py-0.5 rounded font-semibold transition-all cursor-pointer ${
                      statusFilter === 'alerts'
                        ? 'bg-rose-600 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Alerts {delayedCount > 0 ? `(${delayedCount})` : ''}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-3.5 space-y-3 flex-1 overflow-y-auto max-h-[540px] pr-1">
              {filteredTasks.length === 0 ? (
                <div className="py-16 text-center text-slate-400 text-xs">
                  <Package className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="font-semibold text-slate-600">
                    {todaysTasks.length === 0
                      ? 'No collection rounds scheduled for today.'
                      : 'No pickup rounds match the selected filter.'}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {totalScheduled > 0
                      ? 'Earlier rounds are in the Specimen Intake & Verification Archive (tap "Total Rounds").'
                      : 'Click "+ Dispatch Task" above to schedule a collection round.'}
                  </p>
                </div>
              ) : (
                filteredTasks.map((task) => {
                  const isSelected = selectedTaskId === task.id;
                  const stopsList = task.stopsProgress || (task as any).stops || [];
                  const pickedVials = stopsList.reduce(
                    (sum, s) => sum + (s.sampleCount || (s as any).specimenCount || 0),
                    0
                  );
                  const isTaskDelayed =
                    task.isDelayed === true ||
                    (task as any).tempAlert === true ||
                    task.status === 'delayed';

                  // Assignment lands on EITHER side (same split the pipeline builder above already
                  // handles): dispatch stamps riderId on the task, route-level assignment stamps
                  // assignedRiderId. Resolving on task.riderId alone made assigned rounds read
                  // "Unassigned Rider" on the feed card while the map tracked the rider fine.
                  const taskRiderId =
                    task.riderId || (task as any).assignedRiderId || (task as any).activeRiderId;
                  const taskRiderName =
                    task.riderName || (task as any).assignedRiderName || (task as any).activeRiderName;
                  const taskRider = riders.find((r) => r.id === taskRiderId);
                  const riderDisplayTag = taskRider
                    ? `${taskRider.name}${taskRider.vehicleNumber ? ` - ${taskRider.vehicleNumber}` : ''}`
                    : taskRiderName
                    ? `${taskRiderName}${task.riderVehicle ? ` - ${task.riderVehicle}` : ''}`
                    : 'Unassigned Rider';

                  const isScheduledOnly = task.id.startsWith('scheduled-');
                  const isRiderCheckedIn = taskRider?.isCheckedIn || false;

                  const getStatusBadge = () => {
                    if (isScheduledOnly) {
                      return (
                        <span className="bg-slate-100 text-slate-700 border border-slate-300 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-500" /> Not dispatched
                        </span>
                      );
                    }
                    if (isTaskDelayed) {
                      return (
                        <span className="bg-rose-100 text-rose-700 border border-rose-200 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-rose-600" /> Delayed
                        </span>
                      );
                    }
                    switch (task.status as string) {
                      case 'delivered':
                      case 'completed':
                        return (
                          <span className="bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Completed ({pickedVials} Vials)
                          </span>
                        );
                      case 'in_transit':
                      case 'at_stop':
                      case 'started':
                      case 'picked_up':
                        return (
                          <span className="bg-sky-100 text-sky-800 border border-sky-200 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
                            <Bike className="w-3 h-3 text-sky-600" /> In Transit
                          </span>
                        );
                      case 'assigned':
                      case 'scheduled':
                      default:
                        if (isRiderCheckedIn) {
                          return (
                            <span className="bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                              <Clock className="w-3 h-3 text-amber-600" /> Rider On-Duty (Pending Start)
                            </span>
                          );
                        }
                        return (
                          <span className="bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-500" /> Scheduled (Offline)
                          </span>
                        );
                    }
                  };

                  const riderPhoneClean = (taskRider?.phone || task.riderPhone || '').replace(/\D/g, '');
                  const whatsappMessage = encodeURIComponent(
                    `Hello ${taskRider?.name || task.riderName || 'Rider'}, your diagnostic collection round for ${
                      task.routeName || task.clientName || 'assigned route'
                    } is scheduled. Please start your trip in the SecondMedic app.`
                  );

                  return (
                    <div
                      key={task.id}
                      onClick={() => setSelectedTaskId(task.id)}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-sky-50/80 border-sky-600 shadow-xs ring-1 ring-sky-600/30'
                          : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-800'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 text-xs sm:text-sm">
                              {task.clientName || task.clientLabName || ''}
                            </span>
                            {task.timeSlot && (
                              <span className="font-mono text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded border border-slate-200">
                                {task.timeSlot}
                              </span>
                            )}
                          </div>
                          {/* Show the round's date alongside the route. Every card looked like
                              "Lifecare lab • 10:00 • Western Route" with no date, so there was no
                              way to tell today's round from an older one on screen. */}
                          <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                            {(() => {
                              const d = taskDateOf(task);
                              if (!d) return null;
                              const isToday = d === todayStr;
                              return (
                                <span
                                  className={`font-mono font-bold px-1.5 py-0.2 rounded border ${
                                    isToday
                                      ? 'bg-sky-50 text-sky-800 border-sky-200'
                                      : 'bg-amber-50 text-amber-900 border-amber-300'
                                  }`}
                                >
                                  {/* Always print the actual date, not just "Today". An operator
                                      reading a card, exporting it, or screenshotting it for a
                                      client should never have to infer which day it refers to. */}
                                  {(() => {
                                    const [y, m, day] = d.split('-');
                                    const pretty = `${day}-${m}-${y}`;
                                    return isToday ? `Today • ${pretty}` : pretty;
                                  })()}
                                </span>
                              );
                            })()}
                            {task.routeName && <span>{task.routeName}</span>}
                            {/* The canonical task ID is the only unambiguous handle on a round: it
                                carries the real date and resolves to exactly one Firestore doc.
                                Pipeline rounds have a synthetic `scheduled-` id with no document
                                behind them yet, so showing it would be misleading. */}
                            {!isScheduledOnly && (
                              <span
                                className="font-mono text-[9px] text-slate-400 select-all cursor-text"
                                title={task.id}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {task.id}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {getStatusBadge()}
                        </div>
                      </div>

                      <div className="my-1.5 flex items-center justify-between gap-1.5 text-xs text-slate-700 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Bike className="w-3.5 h-3.5 text-sky-700 shrink-0" />
                          <span className="font-semibold text-slate-800 text-[11px] truncate">
                            {riderDisplayTag}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {riderPhoneClean && (
                            <>
                              <a
                                href={`https://wa.me/91${riderPhoneClean}?text=${whatsappMessage}`}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                title="Ping Rider on WhatsApp"
                                className="p-1 text-emerald-700 hover:bg-emerald-100 rounded transition-colors"
                              >
                                <MessageCircle className="w-3.5 h-3.5" />
                              </a>
                              <a
                                href={`tel:${riderPhoneClean}`}
                                onClick={(e) => e.stopPropagation()}
                                title="Call Rider"
                                className="p-1 text-sky-700 hover:bg-sky-100 rounded transition-colors"
                              >
                                <PhoneCall className="w-3.5 h-3.5" />
                              </a>
                            </>
                          )}
                        </div>
                      </div>

                      {stopsList.length > 0 && (
                        <div className="my-2 bg-slate-50/90 p-2.5 rounded-lg border border-slate-200 text-[11px] space-y-1.5">
                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            Collection Stops ({stopsList.length})
                          </div>
                          <div className="space-y-1">
                            {stopsList.slice(0, 3).map((stop, idx) => (
                              <div key={stop.stopId || idx} className="flex items-center justify-between text-xs">
                                <span className="flex items-center gap-1.5 text-slate-700 truncate max-w-[210px] text-[11px]">
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                      stop.status === 'picked_up' || stop.status === 'collected'
                                        ? 'bg-emerald-500'
                                        : stop.status === 'arrived'
                                        ? 'bg-sky-500 animate-ping'
                                        : 'bg-slate-300'
                                    }`}
                                  />
                                  <span className="truncate">{stop.stopName || stop.name || ''}</span>
                                </span>
                                <span className="font-mono text-[10px] text-slate-500 shrink-0">
                                  {stop.sampleCount || (stop as any).specimenCount || 0} Vials
                                </span>
                              </div>
                            ))}
                            {stopsList.length > 3 && (
                              <div className="text-[10px] text-slate-400 font-medium">
                                + {stopsList.length - 3} more collection stop(s)
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between gap-1 text-xs">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {/* Pipeline rounds are due today but not yet sent to a rider, so the one
                              action that matters on them is dispatching. */}
                          {isScheduledOnly && (
                            <button
                              type="button"
                              onClick={(e) => handleForceDispatchScheduled(task, e)}
                              className="px-2 py-1 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded text-[10px] flex items-center gap-1 cursor-pointer"
                            >
                              <Send className="w-3 h-3" />
                              <span>Dispatch Now</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTaskId(task.id);
                            }}
                            className={`px-2 py-1 rounded text-[10px] font-bold flex items-center gap-1 transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-sky-700 text-white'
                                : 'bg-slate-100 hover:bg-sky-50 text-sky-800 border border-slate-200'
                            }`}
                          >
                            <Navigation className="w-3 h-3" />
                            <span>View on Map</span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => handleOpenReassign(task, e)}
                            className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 rounded text-[10px] font-bold border border-slate-200 flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <UserCheck className="w-3 h-3 text-slate-600" />
                            <span>Reassign</span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenProof(task);
                            }}
                            className="px-2 py-1 bg-slate-100 hover:bg-sky-50 text-slate-600 hover:text-sky-900 font-semibold rounded text-[10px] border border-slate-200 flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <Eye className="w-3 h-3 text-slate-500" />
                            <span>Proof</span>
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => handleDeleteTask(task.id, e)}
                          title="Cancel / Delete Task"
                          className="p-1 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      <DispatchModal
        isOpen={isDispatchModalOpen}
        onClose={() => setIsDispatchModalOpen(false)}
        clients={clients}
        routes={routes}
        riders={riders}
        onDispatched={handleTaskDispatched}
      />

      {reassignTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-sky-700" />
                <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                  Reassign Task #{reassignTask.id.slice(-6)}
                </h3>
              </div>
              <button
                onClick={() => setReassignTask(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-xs text-slate-500">
                  Client Lab:{' '}
                  <strong className="text-slate-800">
                    {reassignTask.clientName || reassignTask.clientLabName}
                  </strong>
                </p>
                <p className="text-xs text-slate-500">
                  Currently Assigned:{' '}
                  <strong className="text-slate-800">{reassignTask.riderName || 'None'}</strong>
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Bike className="w-3.5 h-3.5 text-sky-700" />
                  <span>Select New Fleet Runner</span>
                </label>
                <select
                  value={selectedNewRiderId}
                  onChange={(e) => setSelectedNewRiderId(e.target.value)}
                  className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
                >
                  {riders.map((r) => {
                    const isOnline = r.isOnline !== false;
                    return (
                      <option key={r.id} value={r.id}>
                        {r.name} {r.vehicleNumber ? `(${r.vehicleNumber})` : ''} {isOnline ? '• Online' : '• Offline'}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setReassignTask(null)}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isReassigning}
                onClick={handleSaveReassign}
                className="px-4 py-2 bg-sky-700 hover:bg-sky-800 disabled:bg-sky-400 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
              >
                {isReassigning ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Reassigning...</span>
                  </>
                ) : (
                  <>
                    <UserCheck className="w-3.5 h-3.5" />
                    <span>Confirm Reassignment</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------------------------
          Specimen Intake & Verification Archive.
          The Priority Feed deliberately shows only today's rounds so operators are not scrolling
          past last week's work to find the round in front of them. Every round, on any date,
          remains reachable here via the date picker.
      ------------------------------------------------------------------------------------- */}
      {isArchiveOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-6">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden">
            <div className="flex items-start justify-between gap-3 p-4 sm:p-5 border-b border-slate-200">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-sky-700 rounded-xl">
                  <Package className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                    Specimen Intake &amp; Verification Archive
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Every <strong>dispatched</strong> round, searchable by date. {totalScheduled} rounds on record.
                    Rounds scheduled but not yet dispatched are not listed here.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsArchiveOpen(false)}
                className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            <div className="p-4 sm:p-5 border-b border-slate-100 bg-slate-50/70 flex flex-wrap items-center gap-2">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-sky-700" />
                <span>Date</span>
              </label>
              <input
                type="date"
                value={archiveDate}
                onChange={(e) => setArchiveDate(e.target.value)}
                className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:border-sky-600 focus:outline-hidden"
              />
              <button
                type="button"
                onClick={() => setArchiveDate(new Date().toISOString().split('T')[0])}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer ${
                  archiveDate === new Date().toISOString().split('T')[0]
                    ? 'bg-sky-700 text-white border-sky-700'
                    : 'bg-white text-slate-700 border-slate-300 hover:border-sky-400'
                }`}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => setArchiveDate('')}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer ${
                  archiveDate === ''
                    ? 'bg-sky-700 text-white border-sky-700'
                    : 'bg-white text-slate-700 border-slate-300 hover:border-sky-400'
                }`}
              >
                All dates
              </button>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={archiveQuery}
                  onChange={(e) => setArchiveQuery(e.target.value)}
                  placeholder="Search lab, route, rider, stop..."
                  className="pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 focus:border-sky-600 focus:outline-hidden w-52"
                />
              </div>

              <span className="text-[11px] text-slate-500 font-semibold ml-auto whitespace-nowrap">
                {archiveTasks.length} round{archiveTasks.length === 1 ? '' : 's'} • {archiveVialTotal} vials
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-2.5">
              {archiveTasks.length === 0 ? (
                <div className="py-14 text-center text-slate-400 text-xs">
                  <Package className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="font-semibold text-slate-600">
                    {archiveQuery
                      ? 'No rounds match that search.'
                      : archiveDate
                      ? 'No rounds dispatched on this date.'
                      : 'No rounds on record yet.'}
                    {archiveDate === todayStr && (
                      <span className="block text-[11px] text-slate-400 font-normal mt-1">
                        Today's scheduled rounds appear in the Priority Feed until they are dispatched.
                      </span>
                    )}
                  </p>
                </div>
              ) : (
                archiveTasks.map((task: any) => {
                  const stopsList = task.stopsProgress || task.stops || [];
                  const vials = stopsList.reduce(
                    (sum: number, st: any) => sum + Number(st?.sampleCount || st?.specimenCount || 0),
                    0
                  );
                  const isDone = task.status === 'delivered' || task.status === 'completed';
                  return (
                    <div
                      key={task.id}
                      className="border border-slate-200 rounded-xl p-3 hover:border-sky-300 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-slate-900 text-xs sm:text-sm truncate">
                              {task.clientLabName || task.clientName || 'Client Lab'}
                            </span>
                            {task.timeSlot && (
                              <span className="text-[10px] font-mono font-bold text-slate-700 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
                                {task.timeSlot}
                              </span>
                            )}
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                isDone
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : 'bg-amber-50 text-amber-800 border-amber-200'
                              }`}
                            >
                              {isDone ? 'Completed' : task.status || 'pending'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                            {taskDateOf(task) || 'No date'} • {task.routeName || 'Direct dispatch'} •{' '}
                            {task.riderName || (task as any).assignedRiderName || 'Unassigned rider'}
                          </p>
                          {/* The canonical ID is what an operator needs when reconciling a round
                              against a proof record, a Firestore doc, or a client's own register. */}
                          <p
                            className="text-[9px] text-slate-400 font-mono mt-0.5 select-all cursor-text truncate"
                            title={task.id}
                          >
                            {task.id}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-right">
                            <div className="text-sm font-bold text-slate-900">{vials}</div>
                            <div className="text-[10px] text-slate-400 font-semibold">vials</div>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsArchiveOpen(false);
                              onOpenProof(task);
                            }}
                            title="View chain-of-custody proof for this round"
                            className="px-2 py-1 bg-slate-100 hover:bg-sky-50 text-slate-600 hover:text-sky-900 font-semibold rounded text-[10px] border border-slate-200 flex items-center gap-1 transition-colors cursor-pointer"
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
    </div>
  );
};
