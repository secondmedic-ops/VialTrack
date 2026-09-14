import {
  Client,
  Route,
  PickupBoy,
  PickupTask,
  AttendanceRecord,
  LocationPing,
  NotificationLog,
  AlertsConfig,
  OfflineProofQueueItem,
  UserAuth,
  UserRole,
  AdminSession,
  ClientSession,
  RiderSession
} from '../types';
import { CloudSync } from './firebase';

// Storage keys for authentication sessions and pure local caches
const STORAGE_KEYS = {
  ADMIN_SESSION: 'vialtrack_admin_session',
  CLIENT_SESSION: 'vialtrack_client_session',
  RIDER_SESSION: 'vialtrack_rider_session',
  CLIENTS: 'smvt_clients',
  ROUTES: 'smvt_routes',
  RIDERS: 'smvt_riders',
  TASKS: 'smvt_tasks',
  ATTENDANCE: 'smvt_attendance',
  PINGS: 'smvt_pings',
  NOTIFICATIONS: 'smvt_notifications',
  ALERTS_CONFIG: 'smvt_alerts_config',
  OFFLINE_QUEUE: 'smvt_offline_queue',
  AUTH_USER: 'smvt_auth_user'
};

// Memory store fallback in case localStorage is disabled, restricted, or quota-exceeded
const memoryStore: Record<string, string> = {};

function safeGetItem(key: string): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const val = localStorage.getItem(key);
      if (val !== null) return val;
    }
  } catch (e) {
    console.warn(`localStorage read error for ${key}:`, e);
  }
  return memoryStore[key] || null;
}

function safeSetItem(key: string, value: string): boolean {
  memoryStore[key] = value;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(key, value);
      return true;
    }
    return false;
  } catch (e) {
    // Usually QuotaExceededError. This matters for the offline proof queue: two watermarked
    // base64 photos run close to a megabyte per stop and localStorage caps out around 5MB, so a
    // silent failure here means a rider's proof survives only until the app is closed.
    console.warn(`localStorage write error for ${key}:`, e);
    return false;
  }
}

function safeRemoveItem(key: string): void {
  delete memoryStore[key];
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(key);
    }
  } catch (e) {
    console.warn(`localStorage remove error for ${key}:`, e);
  }
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn('JSON parse error in StorageService:', err);
    return fallback;
  }
}

/**
 * Pure Firestore-driven StorageService.
 * No hardcoded mock datasets or fake seed objects. All collections initialize as empty arrays [].
 */
export const StorageService = {
  // Clients
  getClients(): Client[] {
    const raw = safeGetItem(STORAGE_KEYS.CLIENTS);
    const parsed = safeParse<Client[]>(raw, []);
    const seen = new Set<string>();
    const unique: Client[] = [];
    for (const c of parsed) {
      if (!c || !c.id) continue;
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      unique.push(c);
    }
    return unique;
  },
  saveClients(clients: Client[]): void {
    const seen = new Set<string>();
    const unique: Client[] = [];
    for (const c of clients) {
      if (!c || !c.id) continue;
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      unique.push(c);
    }
    safeSetItem(STORAGE_KEYS.CLIENTS, JSON.stringify(unique));
  },
  getClientById(id: string): Client | undefined {
    return this.getClients().find((c) => c.id === id);
  },
  addClient(client: Client): void {
    const clients = this.getClients().filter((c) => c.id !== client.id);
    clients.unshift(client);
    this.saveClients(clients);
    CloudSync.syncDocument('clients', client.id, client);
  },
  updateClient(client: Client): void {
    const clients = this.getClients().map((c) => (c.id === client.id ? client : c));
    this.saveClients(clients);
    CloudSync.syncDocument('clients', client.id, client);
  },
  deleteClient(id: string): void {
    const clients = this.getClients().filter((c) => c.id !== id);
    this.saveClients(clients);
    CloudSync.deleteDocument('clients', id);
  },

  // Routes
  getRoutes(): Route[] {
    const raw = safeGetItem(STORAGE_KEYS.ROUTES);
    const parsed = safeParse<Route[]>(raw, []);
    const seen = new Set<string>();
    const unique: Route[] = [];
    for (const r of parsed) {
      if (!r || !r.id) continue;
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      unique.push(r);
    }
    return unique;
  },
  saveRoutes(routes: Route[]): void {
    const seen = new Set<string>();
    const unique: Route[] = [];
    for (const r of routes) {
      if (!r || !r.id) continue;
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      unique.push(r);
    }
    safeSetItem(STORAGE_KEYS.ROUTES, JSON.stringify(unique));
  },
  getRoutesByClientId(clientId: string): Route[] {
    return this.getRoutes().filter((r) => r.clientId === clientId);
  },
  getRouteById(id: string): Route | undefined {
    return this.getRoutes().find((r) => r.id === id);
  },
  addRoute(route: Route): void {
    const routes = this.getRoutes().filter((r) => r.id !== route.id);
    routes.push(route);
    this.saveRoutes(routes);
    CloudSync.syncDocument('routes', route.id, route);
  },
  updateRoute(route: Route): void {
    const routes = this.getRoutes().map((r) => (r.id === route.id ? route : r));
    this.saveRoutes(routes);
    CloudSync.syncDocument('routes', route.id, route);
  },
  deleteRoute(id: string): void {
    const routes = this.getRoutes().filter((r) => r.id !== id);
    this.saveRoutes(routes);
    CloudSync.deleteDocument('routes', id);
  },

  // Riders
  getRiders(): PickupBoy[] {
    const raw = safeGetItem(STORAGE_KEYS.RIDERS);
    const parsed = safeParse<PickupBoy[]>(raw, []);
    const seenIds = new Set<string>();
    const seenPhones = new Set<string>();
    const seenEmails = new Set<string>();
    const unique: PickupBoy[] = [];

    for (const r of parsed) {
      if (!r || !r.id) continue;
      const cleanPhone = (r.phone || '').replace(/\D/g, '');
      const cleanEmail = (r.email || '').trim().toLowerCase();

      if (seenIds.has(r.id)) continue;
      if (cleanPhone && cleanPhone.length >= 8 && seenPhones.has(cleanPhone)) continue;
      if (cleanEmail && seenEmails.has(cleanEmail)) continue;

      seenIds.add(r.id);
      if (cleanPhone && cleanPhone.length >= 8) seenPhones.add(cleanPhone);
      if (cleanEmail) seenEmails.add(cleanEmail);
      unique.push(r);
    }
    return unique;
  },
  saveRiders(riders: PickupBoy[]): void {
    const seenIds = new Set<string>();
    const seenPhones = new Set<string>();
    const seenEmails = new Set<string>();
    const unique: PickupBoy[] = [];

    for (const r of riders) {
      if (!r || !r.id) continue;
      const cleanPhone = (r.phone || '').replace(/\D/g, '');
      const cleanEmail = (r.email || '').trim().toLowerCase();

      if (seenIds.has(r.id)) continue;
      if (cleanPhone && cleanPhone.length >= 8 && seenPhones.has(cleanPhone)) continue;
      if (cleanEmail && seenEmails.has(cleanEmail)) continue;

      seenIds.add(r.id);
      if (cleanPhone && cleanPhone.length >= 8) seenPhones.add(cleanPhone);
      if (cleanEmail) seenEmails.add(cleanEmail);
      unique.push(r);
    }
    safeSetItem(STORAGE_KEYS.RIDERS, JSON.stringify(unique));
  },
  getRiderById(id: string): PickupBoy | undefined {
    return this.getRiders().find((r) => r.id === id);
  },
  addRider(rider: PickupBoy): void {
    const cleanPhone = (rider.phone || '').replace(/\D/g, '');
    const cleanEmail = (rider.email || '').trim().toLowerCase();
    const riders = this.getRiders().filter((r) => {
      if (r.id === rider.id) return false;
      const rPhone = (r.phone || '').replace(/\D/g, '');
      if (cleanPhone && cleanPhone.length >= 8 && rPhone && cleanPhone === rPhone) return false;
      const rEmail = (r.email || '').trim().toLowerCase();
      if (cleanEmail && rEmail && cleanEmail === rEmail) return false;
      return true;
    });
    riders.unshift(rider);
    this.saveRiders(riders);
    CloudSync.syncDocument('riders', rider.id, rider);
  },
  updateRider(rider: PickupBoy): void {
    const riders = this.getRiders().map((r) => (r.id === rider.id ? rider : r));
    this.saveRiders(riders);
    CloudSync.syncDocument('riders', rider.id, rider);
  },
  updateRiderPassword(riderId: string, newPassword: string): void {
    const rider = this.getRiderById(riderId);
    if (rider) {
      const updated: PickupBoy = {
        ...rider,
        password: newPassword,
        mustChangePassword: false,
        failedAttempts: 0
      };
      this.updateRider(updated);
    }
  },
  recordRiderFailedAttempt(riderId: string): { attempts: number; isLocked: boolean; lockoutUntil?: string } {
    const rider = this.getRiderById(riderId);
    if (rider) {
      const attempts = (rider.failedAttempts || 0) + 1;
      const isLocked = attempts >= 5;
      const lockoutUntil = isLocked ? new Date(Date.now() + 3 * 60 * 1000).toISOString() : rider.lockoutUntil;
      const updated: PickupBoy = {
        ...rider,
        failedAttempts: attempts,
        lockoutUntil
      };
      this.updateRider(updated);
      return { attempts, isLocked, lockoutUntil };
    }
    return { attempts: 1, isLocked: false };
  },
  resetRiderFailedAttempts(riderId: string): void {
    const rider = this.getRiderById(riderId);
    if (rider && (rider.failedAttempts || rider.lockoutUntil)) {
      const updated: PickupBoy = {
        ...rider,
        failedAttempts: 0,
        lockoutUntil: undefined
      };
      this.updateRider(updated);
    }
  },
  updateClientPassword(clientId: string, newPassword: string): void {
    const client = this.getClientById(clientId);
    if (client) {
      const updated: Client = {
        ...client,
        password: newPassword,
        mustChangePassword: false,
        failedAttempts: 0,
        lockoutUntil: undefined
      };
      this.updateClient(updated);
    }
  },
  recordClientFailedAttempt(clientId: string): { attempts: number; isLocked: boolean; lockoutUntil?: string } {
    const client = this.getClientById(clientId);
    if (client) {
      const attempts = (client.failedAttempts || 0) + 1;
      const isLocked = attempts >= 5;
      const lockoutUntil = isLocked ? new Date(Date.now() + 3 * 60 * 1000).toISOString() : client.lockoutUntil;
      const updated: Client = {
        ...client,
        failedAttempts: attempts,
        lockoutUntil
      };
      this.updateClient(updated);
      return { attempts, isLocked, lockoutUntil };
    }
    return { attempts: 1, isLocked: false };
  },
  resetClientFailedAttempts(clientId: string): void {
    const client = this.getClientById(clientId);
    if (client && (client.failedAttempts || client.lockoutUntil)) {
      const updated: Client = {
        ...client,
        failedAttempts: 0,
        lockoutUntil: undefined
      };
      this.updateClient(updated);
    }
  },
  deleteRider(id: string): void {
    const riders = this.getRiders().filter((r) => r.id !== id);
    this.saveRiders(riders);
    CloudSync.deleteDocument('riders', id);
  },

  // Tasks
  getTasks(): PickupTask[] {
    const raw = safeGetItem(STORAGE_KEYS.TASKS);
    const parsed = safeParse<PickupTask[]>(raw, []);
    const seen = new Set<string>();
    const unique: PickupTask[] = [];
    for (const t of parsed) {
      if (!t || !t.id) continue;
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      unique.push(t);
    }
    return unique;
  },
  saveTasks(tasks: PickupTask[]): void {
    const seen = new Set<string>();
    const unique: PickupTask[] = [];
    for (const t of tasks) {
      if (!t || !t.id) continue;
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      unique.push(t);
    }
    safeSetItem(STORAGE_KEYS.TASKS, JSON.stringify(unique));
    CloudSync.syncCollection('tasks', unique);
  },
  getTaskById(id: string): PickupTask | undefined {
    return this.getTasks().find((t) => t.id === id);
  },
  getTasksByClientId(clientId: string): PickupTask[] {
    return this.getTasks().filter((t) => t.clientId === clientId);
  },
  getTasksByRiderId(riderId: string): PickupTask[] {
    return this.getTasks().filter((t) => t.riderId === riderId);
  },
  addTask(task: PickupTask): void {
    const tasks = this.getTasks();
    const existingIndex = tasks.findIndex(
      (t) =>
        t.id === task.id ||
        (t.routeId === task.routeId &&
          t.timeSlot === task.timeSlot &&
          (t.date || t.scheduledDate) === (task.date || task.scheduledDate) &&
          (t.riderId === task.riderId || !t.riderId || !task.riderId))
    );

    if (existingIndex >= 0) {
      const existing = tasks[existingIndex];
      const merged: PickupTask = {
        ...existing,
        ...task,
        id: existing.id,
        stopsProgress: (task.stopsProgress && task.stopsProgress.length > 0) ? task.stopsProgress : existing.stopsProgress,
        stops: (task.stops && task.stops.length > 0) ? task.stops : existing.stops,
        destination: {
          ...existing.destination,
          ...task.destination
        }
      };
      tasks[existingIndex] = merged;
      this.saveTasks(tasks);
      CloudSync.syncDocument('tasks', merged.id, merged);
      CloudSync.syncDocument('trips', merged.id, merged);
    } else {
      tasks.unshift(task);
      this.saveTasks(tasks);
      CloudSync.syncDocument('tasks', task.id, task);
      CloudSync.syncDocument('trips', task.id, task);
    }
  },
  updateTask(task: PickupTask): void {
    const tasks = this.getTasks();
    const existingIndex = tasks.findIndex(
      (t) =>
        t.id === task.id ||
        (t.routeId === task.routeId &&
          t.timeSlot === task.timeSlot &&
          (t.date || t.scheduledDate) === (task.date || task.scheduledDate) &&
          (t.riderId === task.riderId || !t.riderId || !task.riderId))
    );

    let updatedList: PickupTask[];
    if (existingIndex >= 0) {
      const existing = tasks[existingIndex];
      const merged: PickupTask = {
        ...existing,
        ...task,
        id: existing.id,
        stopsProgress: (task.stopsProgress && task.stopsProgress.length > 0) ? task.stopsProgress : existing.stopsProgress,
        stops: (task.stops && task.stops.length > 0) ? task.stops : existing.stops,
        destination: {
          ...existing.destination,
          ...task.destination
        }
      };
      updatedList = tasks.map((t, idx) => (idx === existingIndex ? merged : t));
    } else {
      updatedList = [task, ...tasks];
    }

    safeSetItem(STORAGE_KEYS.TASKS, JSON.stringify(updatedList));
    CloudSync.syncDocument('tasks', task.id, task);
    CloudSync.syncDocument('trips', task.id, task);
  },
  deleteTask(id: string): void {
    const tasks = this.getTasks().filter((t) => t.id !== id);
    safeSetItem(STORAGE_KEYS.TASKS, JSON.stringify(tasks));
    CloudSync.deleteDocument('tasks', id);
  },

  // Attendance
  getAttendance(): AttendanceRecord[] {
    const raw = safeGetItem(STORAGE_KEYS.ATTENDANCE);
    return safeParse<AttendanceRecord[]>(raw, []);
  },
  saveAttendance(attendance: AttendanceRecord[]): void {
    safeSetItem(STORAGE_KEYS.ATTENDANCE, JSON.stringify(attendance));
    CloudSync.syncCollection('attendance', attendance);
  },
  addAttendanceRecord(record: AttendanceRecord): void {
    const records = this.getAttendance();
    records.unshift(record);
    this.saveAttendance(records);
    CloudSync.syncDocument('attendance', record.id, record);
  },
  updateAttendanceRecord(record: AttendanceRecord): void {
    const records = this.getAttendance().map((a) => (a.id === record.id ? record : a));
    this.saveAttendance(records);
    CloudSync.syncDocument('attendance', record.id, record);
  },

  // Location Pings
  getPings(): LocationPing[] {
    const raw = safeGetItem(STORAGE_KEYS.PINGS);
    return safeParse<LocationPing[]>(raw, []);
  },
  savePings(pings: LocationPing[]): void {
    safeSetItem(STORAGE_KEYS.PINGS, JSON.stringify(pings));
  },
  addPing(ping: LocationPing): void {
    const pings = this.getPings();
    pings.push(ping);
    if (pings.length > 500) {
      pings.splice(0, pings.length - 500);
    }
    this.savePings(pings);
  },
  getPingsByRider(riderId: string): LocationPing[] {
    return this.getPings().filter((p) => p.riderId === riderId);
  },

  // Notifications
  getNotifications(): NotificationLog[] {
    const raw = safeGetItem(STORAGE_KEYS.NOTIFICATIONS);
    return safeParse<NotificationLog[]>(raw, []);
  },
  saveNotifications(notifs: NotificationLog[]): void {
    safeSetItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(notifs));
  },
  addNotification(notif: NotificationLog): void {
    const notifs = this.getNotifications();
    notifs.unshift(notif);
    this.saveNotifications(notifs);
  },
  markNotificationRead(id: string): void {
    const notifs = this.getNotifications().map((n) => (n.id === id ? { ...n, read: true } : n));
    this.saveNotifications(notifs);
  },
  markAllNotificationsRead(): void {
    const notifs = this.getNotifications().map((n) => ({ ...n, read: true }));
    this.saveNotifications(notifs);
  },

  // Alerts Config
  getAlertsConfig(): AlertsConfig {
    const raw = safeGetItem(STORAGE_KEYS.ALERTS_CONFIG);
    return safeParse<AlertsConfig>(raw, {
      gracePeriodMinutes: 15,
      tempThresholdMin: 2.0,
      tempThresholdMax: 8.0,
      autoNotifyAdmin: true,
      autoNotifyClient: true,
      whatsappAlertsEnabled: true,
      smsAlertsEnabled: true
    });
  },
  saveAlertsConfig(config: AlertsConfig): void {
    safeSetItem(STORAGE_KEYS.ALERTS_CONFIG, JSON.stringify(config));
  },

  // Offline Queue
  getOfflineQueue(): OfflineProofQueueItem[] {
    const raw = safeGetItem(STORAGE_KEYS.OFFLINE_QUEUE);
    return safeParse<OfflineProofQueueItem[]>(raw, []);
  },
  saveOfflineQueue(queue: OfflineProofQueueItem[]): boolean {
    const ok = safeSetItem(STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(queue));
    if (ok) return true;

    // Out of space. Drop anything already synced, then the oldest entries, until it fits -- a
    // partially retained queue is far better than losing the capture the rider just made.
    let trimmed = queue.filter((q) => q.status !== 'synced');
    while (trimmed.length > 0) {
      if (safeSetItem(STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(trimmed))) {
        console.warn('[Storage] Offline queue trimmed to fit local storage.');
        return true;
      }
      trimmed = trimmed.slice(1);
    }
    return false;
  },
  addToOfflineQueue(item: OfflineProofQueueItem): boolean {
    const queue = this.getOfflineQueue();
    queue.push(item);
    return this.saveOfflineQueue(queue);
  },
  removeFromOfflineQueue(id: string): void {
    const queue = this.getOfflineQueue().filter((item) => item.id !== id);
    this.saveOfflineQueue(queue);
  },

  // Role-Based Session Isolation
  /**
   * Sessions are stored in localStorage, which never expires on its own -- a rider's phone left
   * on a bus, or a shared clinic desktop, stayed logged in indefinitely. Any session older than
   * this window is treated as invalid and cleared on the next read.
   */
  isSessionExpired(session: { loginTimestamp?: string } | null): boolean {
    if (!session || !session.loginTimestamp) return false;
    const started = new Date(session.loginTimestamp).getTime();
    if (isNaN(started)) return false;
    const MAX_SESSION_MS = 12 * 60 * 60 * 1000; // 12 hours -- comfortably longer than one shift
    return Date.now() - started > MAX_SESSION_MS;
  },

  getAdminSession(): AdminSession | null {
    const raw = safeGetItem(STORAGE_KEYS.ADMIN_SESSION);
    const session = safeParse<AdminSession | null>(raw, null);
    if (session && session.role === 'admin' && !this.isSessionExpired(session)) {
      return session;
    }
    if (raw) {
      safeRemoveItem(STORAGE_KEYS.ADMIN_SESSION);
    }
    return null;
  },
  setAdminSession(session: AdminSession | null): void {
    if (session && session.role === 'admin') {
      safeSetItem(STORAGE_KEYS.ADMIN_SESSION, JSON.stringify(session));
      safeSetItem('vialtrack_role', 'admin');
    } else {
      safeRemoveItem(STORAGE_KEYS.ADMIN_SESSION);
      if (safeGetItem('vialtrack_role') === 'admin') {
        safeRemoveItem('vialtrack_role');
      }
    }
  },

  getClientSession(): ClientSession | null {
    const raw = safeGetItem(STORAGE_KEYS.CLIENT_SESSION);
    const session = safeParse<ClientSession | null>(raw, null);
    if (session && session.role === 'client' && session.clientId && !this.isSessionExpired(session)) {
      return session;
    }
    if (raw) {
      safeRemoveItem(STORAGE_KEYS.CLIENT_SESSION);
    }
    return null;
  },
  setClientSession(session: ClientSession | null): void {
    if (session && session.role === 'client' && session.clientId) {
      safeSetItem(STORAGE_KEYS.CLIENT_SESSION, JSON.stringify(session));
      safeSetItem('vialtrack_role', 'client');
    } else {
      safeRemoveItem(STORAGE_KEYS.CLIENT_SESSION);
      if (safeGetItem('vialtrack_role') === 'client') {
        safeRemoveItem('vialtrack_role');
      }
    }
  },

  getRiderSession(): RiderSession | null {
    let raw = safeGetItem(STORAGE_KEYS.RIDER_SESSION);
    if (!raw) {
      raw = safeGetItem('vialtrack_active_rider');
    }
    const session = safeParse<RiderSession | null>(raw, null);
    if (session && this.isSessionExpired(session)) {
      safeRemoveItem(STORAGE_KEYS.RIDER_SESSION);
      safeRemoveItem('vialtrack_active_rider');
      return null;
    }
    if (session && (session.role === 'rider' || session.riderId || (session as any).id)) {
      const normalized: RiderSession = {
        role: 'rider',
        riderId: session.riderId || (session as any).id,
        phone: session.phone,
        name: session.name,
        email: session.email,
        avatar: session.avatar || (session as any).photoUrl,
        vehicleNo: session.vehicleNo || session.vehicleNumber,
        vehicleNumber: session.vehicleNumber || session.vehicleNo,
        vehicleType: session.vehicleType,
        token: session.token || `rider_token_${Date.now()}`,
        mustChangePassword: session.mustChangePassword ?? false,
        loginTimestamp: session.loginTimestamp || new Date().toISOString()
      };
      return normalized;
    }
    if (raw) {
      safeRemoveItem(STORAGE_KEYS.RIDER_SESSION);
      safeRemoveItem('vialtrack_active_rider');
    }
    return null;
  },
  setRiderSession(session: RiderSession | null): void {
    if (session && (session.role === 'rider' || session.riderId)) {
      const jsonStr = JSON.stringify(session);
      safeSetItem(STORAGE_KEYS.RIDER_SESSION, jsonStr);
      safeSetItem('vialtrack_active_rider', jsonStr);
      safeSetItem('vialtrack_role', 'rider');
    } else {
      safeRemoveItem(STORAGE_KEYS.RIDER_SESSION);
      safeRemoveItem('vialtrack_active_rider');
      if (safeGetItem('vialtrack_role') === 'rider') {
        safeRemoveItem('vialtrack_role');
      }
    }
  },

  // Role Session Resolver to UserAuth
  getPortalSession(role: UserRole): UserAuth | null {
    if (role === 'admin') {
      const s = this.getAdminSession();
      if (!s) return null;
      return {
        id: s.id || 'admin-1',
        email: s.email || '',
        name: s.name && !s.name.toLowerCase().includes('vikas') ? s.name : 'Delvin Nadar',
        role: 'admin',
        phone: s.phone || ''
      };
    } else if (role === 'client') {
      const s = this.getClientSession();
      if (!s) return null;
      return {
        id: s.id || `user-${s.clientId}`,
        email: s.email || '',
        name: s.name || 'Client',
        role: 'client',
        clientId: s.clientId,
        phone: s.phone || '',
        mustChangePassword: s.mustChangePassword,
        isPreview: s.isPreview
      };
    } else if (role === 'rider') {
      const s = this.getRiderSession();
      if (!s) return null;
      return {
        id: s.id || `user-${s.riderId}`,
        email: s.email || '',
        name: s.name || 'Courier Partner',
        role: 'rider',
        riderId: s.riderId,
        phone: s.phone || '',
        avatar: s.avatar,
        mustChangePassword: s.mustChangePassword
      };
    }
    return null;
  },

  clearPortalSession(role: UserRole): void {
    if (role === 'admin') {
      this.setAdminSession(null);
    } else if (role === 'client') {
      this.setClientSession(null);
    } else if (role === 'rider') {
      this.setRiderSession(null);
    }
  },

  clearAllSessions(): void {
    this.setAdminSession(null);
    this.setClientSession(null);
    this.setRiderSession(null);
    safeRemoveItem(STORAGE_KEYS.AUTH_USER);
  },

  // Auth User Session (generic helper)
  getAuthUser(preferredRole?: UserRole): UserAuth | null {
    if (preferredRole) {
      const roleSession = this.getPortalSession(preferredRole);
      if (roleSession) return roleSession;
    }
    const admin = this.getPortalSession('admin');
    if (admin) return admin;
    const client = this.getPortalSession('client');
    if (client) return client;
    const rider = this.getPortalSession('rider');
    if (rider) return rider;

    const raw = safeGetItem(STORAGE_KEYS.AUTH_USER);
    return safeParse<UserAuth | null>(raw, null);
  },
  getCurrentUser(preferredRole?: UserRole): UserAuth | null {
    return this.getAuthUser(preferredRole);
  },
  setAuthUser(user: UserAuth | null): void {
    if (user) {
      safeSetItem(STORAGE_KEYS.AUTH_USER, JSON.stringify(user));
      if (user.role === 'admin') {
        this.setAdminSession({
          role: 'admin',
          email: user.email,
          id: user.id,
          name: user.name,
          phone: user.phone,
          token: `token_${Date.now()}`
        });
      } else if (user.role === 'client') {
        this.setClientSession({
          role: 'client',
          clientId: user.clientId || '',
          name: user.name,
          email: user.email,
          phone: user.phone,
          mustChangePassword: user.mustChangePassword,
          isPreview: user.isPreview,
          token: `token_${Date.now()}`
        });
      } else if (user.role === 'rider') {
        this.setRiderSession({
          role: 'rider',
          riderId: user.riderId || '',
          phone: user.phone || '',
          name: user.name,
          email: user.email,
          avatar: user.avatar,
          mustChangePassword: user.mustChangePassword,
          token: `token_${Date.now()}`
        });
      }
    } else {
      safeRemoveItem(STORAGE_KEYS.AUTH_USER);
    }
  },
  setCurrentUser(user: UserAuth | null): void {
    this.setAuthUser(user);
  }
};
