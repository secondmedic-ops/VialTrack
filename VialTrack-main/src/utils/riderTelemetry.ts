import { PickupBoy, Route, PickupTask, AttendanceRecord } from '../types';

/**
 * Parse time slot string (e.g. "10:00", "10:00 AM - 12:00 PM", "14:00", "02:00 PM")
 * into total minutes from midnight.
 */
export function parseSlotToMinutes(slot?: string): number {
  if (!slot) return 0;
  const match = slot.match(/(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
  if (!match) return 0;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

/**
 * Get the first scheduled slot for a rider today from their assigned routes or tasks.
 */
export function getRiderFirstRouteSlot(rider: PickupBoy, routes: Route[], tasks?: PickupTask[]): { slot: string; routeName: string; routeId: string } | null {
  const assignedRouteIds = Array.isArray(rider?.assignedRouteIds) ? rider.assignedRouteIds : [];
  const assignedRoutes = routes.filter((r) => assignedRouteIds.includes(r.id));
  
  // Also check tasks
  const riderTasks = (tasks || []).filter((t) => t.riderId === rider.id);

  const candidateSlots: Array<{ slot: string; minutes: number; routeName: string; routeId: string }> = [];

  assignedRoutes.forEach((r) => {
    const slots = Array.isArray(r.timeSlots) && r.timeSlots.length > 0 ? r.timeSlots : ['10:00 AM - 12:00 PM'];
    slots.forEach((s) => {
      candidateSlots.push({
        slot: s,
        minutes: parseSlotToMinutes(s),
        routeName: r.name,
        routeId: r.id
      });
    });
  });

  riderTasks.forEach((t) => {
    if (t.timeSlot) {
      candidateSlots.push({
        slot: t.timeSlot,
        minutes: parseSlotToMinutes(t.timeSlot),
        routeName: t.routeName || 'Pickup Route',
        routeId: t.routeId || ''
      });
    }
  });

  if (candidateSlots.length === 0) return null;

  candidateSlots.sort((a, b) => a.minutes - b.minutes);
  return candidateSlots[0];
}

export interface PunctualityReport {
  status: 'early' | 'on_time' | 'late' | 'pending_upcoming' | 'pending_overdue' | 'no_route';
  label: string;
  badgeClass: string;
  diffMinutes: number; // positive = early / remaining, negative = late / overdue
  firstSlot?: string;
  routeName?: string;
  checkInTimeFormatted?: string;
  isOverdue: boolean;
}

/**
 * Evaluate whether rider punched in before route time, on-time, late, or if punch-in is pending/overdue.
 */
export function evaluateRiderPunctuality(
  rider: PickupBoy,
  routes: Route[],
  attendanceList?: AttendanceRecord[],
  tasks?: PickupTask[],
  referenceDate: Date = new Date()
): PunctualityReport {
  const firstSlotInfo = getRiderFirstRouteSlot(rider, routes, tasks);

  if (!firstSlotInfo) {
    return {
      status: 'no_route',
      label: 'No Scheduled Route Today',
      badgeClass: 'bg-slate-100 text-slate-600 border-slate-200',
      diffMinutes: 0,
      isOverdue: false
    };
  }

  const { slot, routeName } = firstSlotInfo;
  const slotMinutes = parseSlotToMinutes(slot);
  const currentMinutes = referenceDate.getHours() * 60 + referenceDate.getMinutes();

  // Check if rider has a check-in record for today
  const todayStr = referenceDate.toISOString().split('T')[0];
  const todayAtt = (attendanceList || []).find((a) => a.riderId === rider.id && a.date === todayStr);

  const checkInTimestamp = rider.todayPunchInTime || (rider.isCheckedIn ? (todayAtt?.checkInTime || rider.lastLoginAt) : todayAtt?.checkInTime);

  if (checkInTimestamp) {
    const checkInDate = new Date(checkInTimestamp);
    const checkInMinutes = checkInDate.getHours() * 60 + checkInDate.getMinutes();
    const diff = slotMinutes - checkInMinutes; // e.g. 10:00 (600) - 09:40 (580) = +20 (early)

    const checkInTimeFormatted = checkInDate.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });

    if (diff >= 10) {
      return {
        status: 'early',
        label: `Punched in ${diff}m early (${checkInTimeFormatted} vs ${slot})`,
        badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300 font-bold',
        diffMinutes: diff,
        firstSlot: slot,
        routeName,
        checkInTimeFormatted,
        isOverdue: false
      };
    } else if (diff >= -5) {
      return {
        status: 'on_time',
        label: `Punched in on-time (${checkInTimeFormatted})`,
        badgeClass: 'bg-teal-100 text-teal-800 border-teal-300 font-bold',
        diffMinutes: diff,
        firstSlot: slot,
        routeName,
        checkInTimeFormatted,
        isOverdue: false
      };
    } else {
      const lateBy = Math.abs(diff);
      return {
        status: 'late',
        label: `Late punch-in by ${lateBy}m (${checkInTimeFormatted} for ${slot})`,
        badgeClass: 'bg-rose-100 text-rose-800 border-rose-300 font-bold',
        diffMinutes: diff,
        firstSlot: slot,
        routeName,
        checkInTimeFormatted,
        isOverdue: true
      };
    }
  }

  // Rider has NOT punched in yet
  const minutesRemaining = slotMinutes - currentMinutes;

  if (minutesRemaining > 0) {
    return {
      status: 'pending_upcoming',
      label: `Not Punched In (${minutesRemaining}m to ${slot} route)`,
      badgeClass: minutesRemaining <= 20
        ? 'bg-amber-100 text-amber-900 border-amber-300 font-bold animate-pulse'
        : 'bg-amber-50 text-amber-800 border-amber-200',
      diffMinutes: minutesRemaining,
      firstSlot: slot,
      routeName,
      isOverdue: false
    };
  } else {
    const overdueBy = Math.abs(minutesRemaining);
    return {
      status: 'pending_overdue',
      label: `🚨 OVERDUE: Not Punched In (${overdueBy}m past ${slot} route start)`,
      badgeClass: 'bg-red-100 text-red-900 border-red-300 font-bold animate-pulse',
      diffMinutes: minutesRemaining,
      firstSlot: slot,
      routeName,
      isOverdue: true
    };
  }
}

export interface AppHeartbeatStatus {
  state: 'active_now' | 'recent_background' | 'offline_closed' | 'never_opened';
  label: string;
  badgeClass: string;
  lastSeenText: string;
  secondsAgo: number;
}

/**
 * Determine whether rider has the app currently opened, running in background, or closed.
 */
export function getRiderAppStatus(rider: PickupBoy): AppHeartbeatStatus {
  const rawTimestamp =
    rider.lastHeartbeatTime ||
    rider.lastHeartbeat ||
    rider.currentLocation?.timestamp ||
    rider.lastPingTime ||
    rider.lastUpdated;

  if (!rawTimestamp) {
    return {
      state: 'never_opened',
      label: 'App Closed / Not Opened Today',
      badgeClass: 'bg-slate-100 text-slate-500 border-slate-200',
      lastSeenText: 'Never opened today',
      secondsAgo: 999999
    };
  }

  let timeMs = 0;
  if (typeof rawTimestamp === 'object' && typeof rawTimestamp.toMillis === 'function') {
    timeMs = rawTimestamp.toMillis();
  } else if (typeof rawTimestamp === 'object' && typeof rawTimestamp.seconds === 'number') {
    timeMs = rawTimestamp.seconds * 1000;
  } else if (typeof rawTimestamp === 'number') {
    timeMs = rawTimestamp;
  } else if (typeof rawTimestamp === 'string') {
    timeMs = new Date(rawTimestamp).getTime();
  }

  if (isNaN(timeMs) || timeMs <= 0) {
    return {
      state: 'never_opened',
      label: 'App Closed / Offline',
      badgeClass: 'bg-slate-100 text-slate-500 border-slate-200',
      lastSeenText: 'No recent ping',
      secondsAgo: 999999
    };
  }

  const secondsAgo = Math.floor((Date.now() - timeMs) / 1000);

  if (secondsAgo < 45) {
    return {
      state: 'active_now',
      label: '🟢 App Open & Active Now',
      badgeClass: 'bg-emerald-100 text-emerald-900 border-emerald-300 font-bold',
      lastSeenText: `${secondsAgo}s ago`,
      secondsAgo
    };
  } else if (secondsAgo < 300) {
    // Under 5 minutes
    const mins = Math.floor(secondsAgo / 60);
    return {
      state: 'recent_background',
      label: `🟡 App in Background (${mins}m ago)`,
      badgeClass: 'bg-amber-100 text-amber-900 border-amber-300 font-semibold',
      lastSeenText: `${mins}m ago`,
      secondsAgo
    };
  } else {
    const mins = Math.floor(secondsAgo / 60);
    const hrs = Math.floor(mins / 60);
    const text = hrs > 0 ? `${hrs}h ${mins % 60}m ago` : `${mins}m ago`;
    return {
      state: 'offline_closed',
      label: '⚪ App Closed / Offline',
      badgeClass: 'bg-slate-100 text-slate-600 border-slate-300',
      lastSeenText: text,
      secondsAgo
    };
  }
}

/**
 * Generate a ready-to-use WhatsApp alert URL with pre-filled corrective action message for the rider.
 */
export function generateRiderWhatsAppAlertUrl(rider: PickupBoy, messageType: 'punch_in_reminder' | 'overdue_alert' | 'route_start', routeName?: string, slot?: string): string {
  const cleanPhone = (rider.phone || '').replace(/\D/g, '');
  const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

  let text = '';
  if (messageType === 'punch_in_reminder') {
    text = `🚨 *SecondMedic Operations Alert*\n\nHi ${rider.name},\nYour scheduled route *${routeName || 'Daily Round'}* (${slot || 'Upcoming Slot'}) is starting soon.\n\nPlease open the VialTrack Rider App, confirm your vehicle, and *Punch In* now to begin GPS tracking.\n\nPortal: https://delvin-nadar.github.io/VialTrack/#/rider`;
  } else if (messageType === 'overdue_alert') {
    text = `⚠️ *URGENT - SECONDMEDIC OPS NOTICE*\n\nHi ${rider.name},\nYour route *${routeName || 'Daily Round'}* (${slot || 'Slot'}) is *OVERDUE FOR PUNCH-IN*.\n\nPlease open the app immediately or reply with your status.\n\nCall Ops Head: +91 93216 40508`;
  } else {
    text = `📦 *SecondMedic Dispatch Notice*\n\nHi ${rider.name},\nYour pickup task for *${routeName || 'Assigned Route'}* is ready. Please open the app and start navigation.`;
  }

  return `https://wa.me/${formattedPhone}?text=${encodeURIComponent(text)}`;
}
