import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  doc,
  setDoc,
  addDoc,
  getDoc,
  getDocs,
  deleteDoc,
  collection,
  query,
  where,
  onSnapshot,
  writeBatch,
  getDocFromServer,
  GeoPoint,
  Unsubscribe,
  serverTimestamp,
  updateDoc,
  arrayUnion,
  arrayRemove
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User,
  UserCredential
} from 'firebase/auth';
import { getStorage, ref as storageRef, uploadString, getDownloadURL } from 'firebase/storage';
import { UserRole, LocationPing, PickupBoy, PickupTask, Client, AttendanceRecord, Route } from '../types';
import firebaseConfig from '../../firebase-applet-config.json';

/**
 * Safely resolves an environment variable across Vite browser (import.meta.env)
 * and Node/runtime (process.env) contexts without throwing ReferenceErrors.
 */
function getEnv(keys: string[]): string | undefined {
  for (const key of keys) {
    try {
      const metaEnv = (import.meta as any)?.env;
      if (metaEnv && metaEnv[key]) {
        return metaEnv[key];
      }
    } catch {
      // Ignore reference errors
    }
    try {
      const procEnv = (globalThis as any)?.process?.env || (typeof process !== 'undefined' ? process.env : undefined);
      if (procEnv && procEnv[key]) {
        return procEnv[key];
      }
    } catch {
      // Ignore reference errors
    }
  }
  return undefined;
}

// Fallback configuration object from configuration file (if present)
const fallbackConfig = (firebaseConfig as Record<string, any>) || {};

/**
 * Resolved Firebase client configuration sourced dynamically from environment variables
 * (import.meta.env / process.env) with non-hardcoded fallbacks.
 */
export const resolvedFirebaseConfig = {
  apiKey:
    getEnv(['VITE_FIREBASE_API_KEY', 'FIREBASE_API_KEY', 'VITE_API_KEY', 'API_KEY']) ||
    fallbackConfig.apiKey ||
    '',
  authDomain:
    getEnv(['VITE_FIREBASE_AUTH_DOMAIN', 'FIREBASE_AUTH_DOMAIN', 'VITE_AUTH_DOMAIN', 'AUTH_DOMAIN']) ||
    fallbackConfig.authDomain ||
    '',
  projectId:
    getEnv(['VITE_FIREBASE_PROJECT_ID', 'FIREBASE_PROJECT_ID', 'VITE_PROJECT_ID', 'PROJECT_ID']) ||
    fallbackConfig.projectId ||
    'gen-lang-client-0401908863',
  storageBucket:
    getEnv(['VITE_FIREBASE_STORAGE_BUCKET', 'FIREBASE_STORAGE_BUCKET', 'VITE_STORAGE_BUCKET', 'STORAGE_BUCKET']) ||
    fallbackConfig.storageBucket ||
    '',
  messagingSenderId:
    getEnv(['VITE_FIREBASE_MESSAGING_SENDER_ID', 'FIREBASE_MESSAGING_SENDER_ID', 'VITE_MESSAGING_SENDER_ID', 'MESSAGING_SENDER_ID']) ||
    fallbackConfig.messagingSenderId ||
    '',
  appId:
    getEnv(['VITE_FIREBASE_APP_ID', 'FIREBASE_APP_ID', 'VITE_APP_ID', 'APP_ID']) ||
    fallbackConfig.appId ||
    '',
  measurementId:
    getEnv(['VITE_FIREBASE_MEASUREMENT_ID', 'FIREBASE_MEASUREMENT_ID', 'VITE_MEASUREMENT_ID']) ||
    fallbackConfig.measurementId ||
    '',
};

export const resolvedFirestoreDatabaseId: string =
  getEnv([
    'VITE_FIREBASE_DATABASE_ID',
    'FIREBASE_DATABASE_ID',
    'VITE_FIREBASE_FIRESTORE_DATABASE_ID',
    'FIREBASE_FIRESTORE_DATABASE_ID',
    'VITE_FIRESTORE_DATABASE_ID'
  ]) || fallbackConfig.firestoreDatabaseId || 'ai-studio-secondmedicvialt-672ab7fa-5c2a-4a7b-9439-899ee4ab7829';

// Initialize Firebase App
export const app = !getApps().length ? initializeApp(resolvedFirebaseConfig) : getApp();

// Connect to Firestore instance with resilient long-polling auto-detection for ad-blocker environments
export const db = (() => {
  try {
    return initializeFirestore(
      app,
      {
        experimentalAutoDetectLongPolling: true,
      },
      resolvedFirestoreDatabaseId && resolvedFirestoreDatabaseId !== '(default)'
        ? resolvedFirestoreDatabaseId
        : undefined
    );
  } catch {
    return resolvedFirestoreDatabaseId && resolvedFirestoreDatabaseId !== '(default)'
      ? getFirestore(app, resolvedFirestoreDatabaseId)
      : getFirestore(app);
  }
})();
export const auth = getAuth(app);
export const storage = getStorage(app);
// Cloud Functions live in the default region (us-central1); the callable below matches that.
export const functions = getFunctions(app);

export { GeoPoint };

/**
 * Push notifications (Android Rider app only)
 * -------------------------------------------
 * The Rider app registers an FCM (Firebase Cloud Messaging) device token via
 * src/services/pushNotifications.ts once a rider logs in on the native Android app.
 * That token is stored here, on the rider's own Firestore document, so the "sendRiderAlert"
 * Cloud Function (functions/index.js) knows which device(s) to push a notification to.
 *
 * A rider can have more than one device (e.g. a replacement phone), so tokens are kept as an
 * array and only ever added to (arrayUnion) or individually removed (arrayRemove) -- never
 * wholesale overwritten -- so logging in on a new phone never silently drops an old one until
 * that old token itself goes stale (FCM does this automatically after ~270 days unused).
 */
export async function registerRiderPushToken(riderId: string, token: string): Promise<void> {
  if (!riderId || !token) return;
  try {
    await setDoc(doc(db, 'riders', riderId), { pushTokens: arrayUnion(token) }, { merge: true });
  } catch (err) {
    console.warn('[CloudSync] Failed to save push token:', err);
  }
}

export async function unregisterRiderPushToken(riderId: string, token: string): Promise<void> {
  if (!riderId || !token) return;
  try {
    await setDoc(doc(db, 'riders', riderId), { pushTokens: arrayRemove(token) }, { merge: true });
  } catch (err) {
    console.warn('[CloudSync] Failed to remove push token:', err);
  }
}

/**
 * Admin-triggered manual push notification to one rider or all riders.
 * Calls the "sendRiderAlert" Cloud Function (functions/index.js), which looks up the
 * target rider(s)' stored FCM tokens and sends the actual push via firebase-admin.
 */
export async function sendRiderPushAlert(params: {
  riderId: string | 'all';
  title: string;
  message: string;
}): Promise<{ success: boolean; sentCount: number; message?: string }> {
  try {
    const callable = httpsCallable(functions, 'sendRiderAlert');
    const result = await callable(params);
    return result.data as { success: boolean; sentCount: number; message?: string };
  } catch (err: any) {
    console.error('[CloudSync] sendRiderPushAlert failed:', err);
    return { success: false, sentCount: 0, message: err?.message || 'Failed to send alert' };
  }
}

/**
 * Security overhaul: real Firebase Authentication for Rider/Client logins
 * -----------------------------------------------------------------------
 * Riders/clients historically logged in via a plaintext password compared directly against
 * their Firestore document (openly readable under the current rules) -- see RiderLogin.tsx /
 * ClientLogin.tsx history. They're moving to real Firebase Auth accounts instead. Firebase Auth
 * needs an email+password pair; riders sign in with phone+PIN, not email, so each rider gets a
 * synthetic, internal-only email address computed by riderAuthEmail() below -- never shown to
 * the rider, never a real inbox, just a stable identifier. Clients already have a real email on
 * file in most cases, so clientAuthEmail() uses that when present and only falls back to a
 * synthetic one otherwise.
 *
 * CRITICAL: these two functions must compute EXACTLY the same email as their counterparts in
 * functions/index.js (riderAuthEmail / clientAuthEmail there) -- that's what lets a migrated
 * rider/client's login find the Firebase Auth account the migration function created for them.
 * If you ever change the formula, it must change in both places at once.
 */
export function riderAuthEmail(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  return `rider-${digits}@riders.vialtrack.internal`;
}

export function clientAuthEmail(client: { id: string; email?: string }): string {
  const email = String(client.email || '').trim().toLowerCase();
  if (email.includes('@')) return email;
  return `client-${client.id}@clients.vialtrack.internal`;
}

/**
 * Admin-only: one-time (safe to re-run) migration that creates a real Firebase Auth account for
 * every rider/client that doesn't have one yet, and tags every account (admin included) with a
 * role custom claim. See functions/index.js's migrateAccountsToFirebaseAuth for the full details
 * and the deliberately-non-destructive guarantees (it never touches Firestore rules and never
 * deletes the old plaintext password field).
 */
export async function runAccountSecurityMigration(): Promise<{ success: boolean; results?: any; message?: string }> {
  try {
    const callable = httpsCallable(functions, 'migrateAccountsToFirebaseAuth');
    const result = await callable({});
    return result.data as { success: boolean; results?: any };
  } catch (err: any) {
    console.error('[CloudSync] runAccountSecurityMigration failed:', err);
    return { success: false, message: err?.message || 'Migration failed' };
  }
}

/**
 * Admin-only: creates (or password-resets) ONE rider's real Firebase Auth account, right when
 * they're added or edited in Manage Riders -- instead of only ever happening in the one-time
 * bulk migration above. Every new rider from here on gets a real, secure login immediately; an
 * existing rider whose password is changed in the admin panel gets that change applied to their
 * real account too. See functions/index.js's provisionAccount for the server-side half.
 */
export async function provisionRiderAccount(params: {
  riderId: string;
  phone: string;
  password: string;
  displayName?: string;
}): Promise<{ success: boolean; authUid?: string; message?: string }> {
  try {
    const callable = httpsCallable(functions, 'provisionAccount');
    const result = await callable({
      role: 'rider',
      id: params.riderId,
      phone: params.phone,
      password: params.password,
      displayName: params.displayName
    });
    return result.data as { success: boolean; authUid?: string; message?: string };
  } catch (err: any) {
    console.error('[CloudSync] provisionRiderAccount failed:', err);
    return { success: false, message: err?.message || 'Could not provision a secure login for this rider.' };
  }
}

/** Client-portal counterpart of provisionRiderAccount above. */
export async function provisionClientAccount(params: {
  clientId: string;
  email?: string;
  password: string;
  displayName?: string;
}): Promise<{ success: boolean; authUid?: string; message?: string }> {
  try {
    const callable = httpsCallable(functions, 'provisionAccount');
    const result = await callable({
      role: 'client',
      id: params.clientId,
      email: params.email,
      password: params.password,
      displayName: params.displayName
    });
    return result.data as { success: boolean; authUid?: string; message?: string };
  } catch (err: any) {
    console.error('[CloudSync] provisionClientAccount failed:', err);
    return { success: false, message: err?.message || 'Could not provision a secure login for this client.' };
  }
}

/**
 * Admin-only: sweeps every rider/client document and removes the legacy plaintext `password`
 * field from any that already has a confirmed, working real Firebase Auth account -- see
 * functions/index.js's stripAllLegacyPasswords for the safety guarantee (anything not actually
 * migrated is left untouched, every time, so this can never be what locks someone out).
 */
export async function removeLegacyPassword(params: { role: 'rider' | 'client'; id: string }): Promise<{ success: boolean; skipped?: boolean; reason?: string; message?: string }> {
  try {
    const callable = httpsCallable(functions, 'stripLegacyPassword');
    const result = await callable(params);
    return result.data as { success: boolean; skipped?: boolean; reason?: string };
  } catch (err: any) {
    console.error('[CloudSync] removeLegacyPassword failed:', err);
    return { success: false, message: err?.message || 'Failed to remove legacy password.' };
  }
}

export async function removeAllLegacyPasswords(): Promise<{ success: boolean; results?: any; message?: string }> {
  try {
    const callable = httpsCallable(functions, 'stripAllLegacyPasswords');
    const result = await callable({});
    return result.data as { success: boolean; results?: any };
  } catch (err: any) {
    console.error('[CloudSync] removeAllLegacyPasswords failed:', err);
    return { success: false, message: err?.message || 'Failed to remove legacy passwords.' };
  }
}

/**
 * Photo proofs (specimen vials, rider selfies, lab handover slips) were previously stored as
 * full base64 JPEG strings directly on the Firestore task/trip document. Firestore hard-caps a
 * single document at 1 MiB — once a round has a couple of stops, each carrying two ~200-400KB
 * base64 photos, the document write silently exceeds that cap and Firestore rejects it. Because
 * every write here is wrapped in try/catch that only console.warns, that failure was invisible:
 * the photo looked fine in the app right after capture (it was still sitting in local React
 * state) but was never actually persisted, so it vanished on reload / for other viewers.
 *
 * The fix: upload the photo bytes to Firebase Cloud Storage instead, and store only the short
 * https download URL string on the Firestore document. If the input is already an https URL
 * (e.g. re-confirming a stop that already has a saved photo) it's returned unchanged — nothing
 * to upload. Throws on failure so callers can surface the error instead of silently losing data.
 */
export async function uploadPhotoToStorage(dataUrl: string, path: string): Promise<string> {
  if (!dataUrl) return dataUrl;
  if (!dataUrl.startsWith('data:')) {
    // Already a hosted URL (previously uploaded) - nothing to do.
    return dataUrl;
  }
  const fileRef = storageRef(storage, path);
  await uploadString(fileRef, dataUrl, 'data_url');
  return await getDownloadURL(fileRef);
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map((provider) => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.warn('Firestore Error Context: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Initial connection test
export async function testConnection() {
  try {
    await getDoc(doc(db, 'test', 'connection'));
    console.log('[Firebase] Connection to Firestore verified successfully.');
  } catch (error: any) {
    if (error?.code === 'unavailable' || (error instanceof Error && error.message.includes('unavailable'))) {
      console.info('[Firebase] Firestore client is connected in offline-first mode.');
    } else if (error instanceof Error && error.message.includes('the client is offline')) {
      console.info('[Firebase] Firestore offline mode active.');
    }
  }
}
testConnection();

/**
 * Utility to extract latitude and longitude from various Firestore GeoPoint representations.
 */
export function parseFirestoreGeoPoint(point: any): { lat: number; lng: number } | null {
  if (!point) return null;
  // Standard Firestore GeoPoint instance has .latitude and .longitude
  if (typeof point.latitude === 'number' && typeof point.longitude === 'number') {
    return { lat: point.latitude, lng: point.longitude };
  }
  // Standard lat/lng object
  if (typeof point.lat === 'number' && typeof point.lng === 'number') {
    return { lat: point.lat, lng: point.lng };
  }
  // Firestore internal _lat, _long
  if (typeof point._lat === 'number' && typeof point._long === 'number') {
    return { lat: point._lat, lng: point._long };
  }
  // [lat, lng] array
  if (Array.isArray(point) && point.length >= 2 && typeof point[0] === 'number' && typeof point[1] === 'number') {
    return { lat: point[0], lng: point[1] };
  }
  return null;
}

/**
 * Converts lat/lng coordinates to a native Firestore GeoPoint instance.
 */
export function toFirestoreGeoPoint(lat: number, lng: number): GeoPoint {
  return new GeoPoint(lat, lng);
}

// Throttle cache for trip and rider cloud location writes
const locationWriteThrottleMap = new Map<string, { timestamp: number; lat: number; lng: number }>();

/**
 * Strict Production Mode:
 * No demo accounts or mock seeders. Database starts pure and empty.
 */
export async function cleanupFirestoreCollections(): Promise<{ success: boolean; deletedCount: number; message: string }> {
  const collectionsToClean = ['clients', 'locations', 'riders', 'routes', 'tasks', 'trips', 'attendance', 'pings'];
  let totalDeleted = 0;
  for (const colName of collectionsToClean) {
    try {
      const snap = await getDocs(collection(db, colName));
      if (!snap.empty) {
        const batch = writeBatch(db);
        snap.docs.forEach((d) => {
          batch.delete(d.ref);
          totalDeleted++;
        });
        await batch.commit();
      }
    } catch (e) {
      console.warn(`[FirestoreCleanup] Error clearing collection ${colName}:`, e);
    }
  }

  // Clear local storage cache
  try {
    const keysToPurge = [
      'smvt_clients', 'smvt_riders', 'smvt_routes', 'smvt_tasks',
      'smvt_attendance', 'smvt_pings', 'smvt_locations',
      'vialtrack_mock_fleet', 'vialtrack_demo_tasks', 'vialtrack_mock_riders',
      'vialtrack_mock_tasks', 'vialtrack_demo_rounds', 'vialtrack_initial_feed'
    ];
    keysToPurge.forEach((k) => localStorage.removeItem(k));
  } catch (err) {
    console.warn('Could not clear local storage during cleanup:', err);
  }

  return { success: true, deletedCount: totalDeleted, message: `Cleaned ${totalDeleted} documents across collections.` };
}

/**
 * Strict production mode: returns pure empty state
 */
export async function seedCoreCollectionsIfEmpty(): Promise<{ clientsSeeded: boolean; ridersSeeded: boolean }> {
  return { clientsSeeded: false, ridersSeeded: false };
}

/**
 * Mirrors functions/index.js's passwordForFirebaseAuth(). Firebase Auth requires at least 6
 * characters, so accounts provisioned from a shorter legacy PIN were created with the PIN padded
 * to 6 with zeroes. The login screens must apply the exact same padding when signing in, or a
 * rider with a 4-digit PIN could never authenticate against their own real Auth account and
 * would silently keep falling back to the legacy plaintext check forever.
 */
export function passwordForFirebaseAuth(rawPassword: string): string {
  const pwd = String(rawPassword || '');
  if (pwd.length >= 6) return pwd;
  return pwd.padEnd(6, '0');
}

/**
 * Resolves a phone number to the Firebase Auth email for that rider/client, without reading the
 * riders/clients collection from the browser. See lookupLoginEmail in functions/index.js for why
 * this indirection exists.
 */
export async function lookupLoginEmail(
  role: 'rider' | 'client',
  phone: string
): Promise<string | null> {
  try {
    const callable = httpsCallable(functions, 'lookupLoginEmail');
    const result = await callable({ role, phone });
    const data = result.data as { found: boolean; email: string | null };
    return data && data.found ? data.email : null;
  } catch (err) {
    console.warn('[CloudSync] lookupLoginEmail failed:', err);
    return null;
  }
}

export { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged };

// Helper to normalize and unify tasks and trips across Admin, Rider, and Client schemas
export function formatUnifiedTask(id: string, data: any): PickupTask {
  const clientLabId = data.clientLabId || data.clientId || '';
  const clientLabName = data.clientLabName || data.clientName || '';

  const clientLat = Array.isArray(data.clientCoords) && data.clientCoords.length === 2
    ? Number(data.clientCoords[0])
    : Number(data.clientLabLocation?.lat || data.destination?.lat || data.deliveryLocation?.lat || 19.1287852);

  const clientLng = Array.isArray(data.clientCoords) && data.clientCoords.length === 2
    ? Number(data.clientCoords[1])
    : Number(data.clientLabLocation?.lng || data.destination?.lng || data.deliveryLocation?.lng || 72.8294183);

  const clientLocation = { lat: clientLat, lng: clientLng };

  const rawStopsList = Array.isArray(data.stops) && data.stops.length > 0
    ? data.stops
    : (Array.isArray(data.stopsProgress) ? data.stopsProgress : []);

  const rawProgressList: any[] = Array.isArray(data.stopsProgress) ? data.stopsProgress : [];

  const unifiedStops = rawStopsList.map((s: any, idx: number) => {
    const sId = s.id || s.stopId || `stop-${idx + 1}`;
    const prog = rawProgressList.find((p: any) => (p.stopId && p.stopId === sId) || (p.id && p.id === sId)) || rawProgressList[idx] || {};

    const sLat = Array.isArray(s.coords) && s.coords.length === 2
      ? Number(s.coords[0])
      : Number(s.lat ?? prog.lat ?? 19.1287852);
    const sLng = Array.isArray(s.coords) && s.coords.length === 2
      ? Number(s.coords[1])
      : Number(s.lng ?? prog.lng ?? 72.8294183);

    const photoUrl = prog.photoUrl || prog.photo || s.photoUrl || s.photo || '';
    const photo2Url = prog.photo2Url || prog.handoverPhotoUrl || prog.selfieUrl || s.photo2Url || s.handoverPhotoUrl || s.selfieUrl || '';
    const handoverPhotoUrl = prog.handoverPhotoUrl || prog.photo2Url || prog.selfieUrl || s.handoverPhotoUrl || s.photo2Url || s.selfieUrl || '';
    const selfieUrl = prog.selfieUrl || prog.photo2Url || prog.handoverPhotoUrl || s.selfieUrl || s.photo2Url || s.handoverPhotoUrl || '';
    const isDeliveredOrDone = data.status === 'delivered' || data.status === 'completed' || data.isHandedOver === true || data.isCompleted === true;
    const sampleCount = Number(prog.sampleCount ?? prog.specimenCount ?? s.sampleCount ?? s.specimenCount ?? 0);
    const rawStatus = prog.status || s.status || (isDeliveredOrDone ? 'picked_up' : 'pending');
    const status = isDeliveredOrDone && rawStatus === 'pending' ? 'picked_up' : rawStatus;
    const coldBoxTemp = prog.coldBoxTemp !== undefined ? Number(prog.coldBoxTemp) : (s.coldBoxTemp !== undefined ? Number(s.coldBoxTemp) : (isDeliveredOrDone ? 4.2 : undefined));
    const arrivedAt = prog.arrivedAt || s.arrivedAt || '';
    const pickedUpAt = prog.pickedUpAt || s.pickedUpAt || '';
    const completedAt = prog.completedAt || s.completedAt || '';
    const notes = prog.notes || s.notes || '';
    const remark = prog.remark || s.remark || (prog.noSampleReason ? 'No Sample' : (notes.includes('No Sample') ? 'No Sample' : (sampleCount > 0 || isDeliveredOrDone ? 'Collected sample' : undefined)));
    const noSampleReason = prog.noSampleReason || s.noSampleReason || '';
    const photoTimestamp = prog.photoTimestamp || s.photoTimestamp || '';
    const photoLocation = prog.photoLocation || s.photoLocation;

    return {
      stopName: s.stopName || s.name || prog.stopName || prog.name || '',
      address: s.address || prog.address || '',
      lat: sLat,
      lng: sLng,
      specimenCount: sampleCount,
      sampleCount: sampleCount,
      status: status,
      id: sId,
      stopId: sId,
      contactPerson: s.contactPerson || prog.contactPerson || '',
      phone: s.phone || prog.phone || '',
      pickupTime: s.pickupTime || prog.pickupTime || '',
      photoUrl,
      photo2Url,
      handoverPhotoUrl,
      selfieUrl,
      coldBoxTemp,
      arrivedAt,
      pickedUpAt,
      completedAt,
      photoTimestamp,
      photoLocation,
      notes,
      remark,
      noSampleReason
    };
  });

  const isDeliveredOrDone = data.status === 'delivered' || data.status === 'completed' || data.isHandedOver === true || data.isCompleted === true;
  const taskLevelVials = Number(data.sampleCount ?? data.totalVials ?? data.destination?.totalVialsHandedOver ?? 0);

  const stopsProgress: any[] = unifiedStops.map((s: any, idx: number) => {
    let finalSampleCount = Number(s.sampleCount ?? s.specimenCount ?? 0);
    // If task is delivered and individual stops had 0 vials but task had vials, allocate
    if (finalSampleCount === 0 && isDeliveredOrDone && taskLevelVials > 0) {
      if (unifiedStops.length === 1) {
        finalSampleCount = taskLevelVials;
      } else {
        const perStop = Math.floor(taskLevelVials / unifiedStops.length);
        const remainder = taskLevelVials % unifiedStops.length;
        finalSampleCount = idx === 0 ? perStop + remainder : perStop;
      }
    }

    const finalStatus = isDeliveredOrDone && s.status !== 'no_sample'
      ? 'picked_up'
      : (s.status === 'picked_up' || s.status === 'completed' || s.status === 'arrived' || s.status === 'no_sample'
        ? (s.status === 'completed' ? 'picked_up' : s.status)
        : (s.status === 'in_progress' ? 'arrived' : 'pending'));

    const finalRemark = s.remark || (finalStatus === 'no_sample' ? 'No Sample' : (finalSampleCount > 0 || isDeliveredOrDone ? 'Collected sample' : undefined));

    return {
      stopId: s.id || s.stopId || `stop-${idx + 1}`,
      stopName: s.stopName || '',
      address: s.address || '',
      lat: s.lat,
      lng: s.lng,
      contactPerson: s.contactPerson || '',
      phone: s.phone || '',
      pickupTime: s.pickupTime || '',
      status: finalStatus,
      sampleCount: finalSampleCount,
      specimenCount: finalSampleCount,
      photoUrl: s.photoUrl || '',
      photo2Url: s.photo2Url || s.handoverPhotoUrl || s.selfieUrl || '',
      handoverPhotoUrl: s.handoverPhotoUrl || s.photo2Url || s.selfieUrl || '',
      selfieUrl: s.selfieUrl || s.photo2Url || s.handoverPhotoUrl || '',
      coldBoxTemp: s.coldBoxTemp,
      arrivedAt: s.arrivedAt || '',
      pickedUpAt: s.pickedUpAt || '',
      completedAt: s.completedAt || '',
      photoTimestamp: s.photoTimestamp || '',
      photoLocation: s.photoLocation,
      notes: s.notes || '',
      remark: finalRemark,
      noSampleReason: s.noSampleReason
    };
  });

  const scheduledDate = data.scheduledDate || data.date || new Date().toISOString().split('T')[0];

  const destinationDropPhoto =
    data.destination?.dropPhotoUrl ||
    data.destination?.handoverPhotoUrl ||
    data.finalDrop?.dropPhotoUrl ||
    data.finalDrop?.handoverPhotoUrl ||
    data.dropPhotoUrl ||
    data.handoverPhotoUrl ||
    '';

  const destinationObj = {
    name: data.destination?.name || data.deliveryLocation?.name || clientLabName || '',
    address: data.destination?.address || data.deliveryLocation?.address || data.clientAddress || '',
    lat: data.destination?.lat || data.deliveryLocation?.lat || clientLat,
    lng: data.destination?.lng || data.deliveryLocation?.lng || clientLng,
    status: data.destination?.status || (data.status === 'delivered' || data.status === 'completed' ? 'delivered' : 'pending'),
    arrivedAt: data.destination?.arrivedAt || data.finalDrop?.arrivedAt || '',
    deliveredAt: data.destination?.deliveredAt || data.destination?.completedAt || data.completedAt || data.deliveryTimestamp || data.finalDrop?.deliveredAt || '',
    receiverName: data.destination?.receiverName || data.receiverName || data.intakeReceiver || data.finalDrop?.receiverName || '',
    receiverDesignation: data.destination?.receiverDesignation || '',
    dropPhotoUrl: destinationDropPhoto,
    handoverPhotoUrl: destinationDropPhoto,
    coldBoxTempAtDrop: data.destination?.coldBoxTempAtDrop !== undefined ? data.destination.coldBoxTempAtDrop : (data.finalDrop?.coldBoxTemp !== undefined ? data.finalDrop.coldBoxTemp : (data.handoverTemperature !== undefined ? data.handoverTemperature : data.chillerTemp)),
    totalVialsHandedOver: data.destination?.totalVialsHandedOver !== undefined ? data.destination.totalVialsHandedOver : (data.finalDrop?.totalVials !== undefined ? data.finalDrop.totalVials : data.totalVials),
    notes: data.destination?.notes || data.finalDrop?.notes || data.taskNotes || ''
  };

  const isDeliveredOrCompleted =
    data.status === 'delivered' ||
    data.status === 'completed' ||
    destinationObj.status === 'delivered' ||
    data.isHandedOver === true ||
    data.isCompleted === true;

  const resolvedStatus = isDeliveredOrCompleted ? 'delivered' : (data.status || 'assigned');
  const nowIso = new Date().toISOString();

  return {
    id: id || data.id,
    clientLabId,
    clientLabName,
    clientLabLocation: clientLocation,
    riderId: data.riderId || data.assignedRiderId || '',
    riderName: data.riderName || data.assignedRiderName || '',
    riderPhone: data.riderPhone || data.assignedRiderPhone || '',
    stops: unifiedStops,
    scheduledDate,
    date: scheduledDate,
    timeSlot: data.timeSlot || '',
    routeId: data.routeId || '',
    routeName: data.routeName || '',
    clientId: clientLabId,
    clientName: clientLabName,
    riderVehicle: data.riderVehicle || data.vehicleNumber || '',
    status: resolvedStatus,
    activeRiderId: data.activeRiderId || data.riderId || '',
    activeRiderName: data.activeRiderName || data.riderName || '',
    currentDestinationStop: data.currentDestinationStop || (stopsProgress[0]?.stopName) || '',
    tripStartedAt: data.tripStartedAt,
    currentStopIndex: data.currentStopIndex || 0,
    stopsProgress,
    destination: destinationObj,
    isDelayed: Boolean(data.isDelayed),
    delayMinutes: data.delayMinutes || 0,
    issueFlags: data.issueFlags || [],
    createdAt: data.createdAt ? (typeof data.createdAt === 'object' ? nowIso : data.createdAt) : nowIso,
    startedAt: data.startedAt,
    completedAt: data.completedAt || (isDeliveredOrCompleted ? destinationObj.deliveredAt || nowIso : undefined),
    deliveryTimestamp: data.deliveryTimestamp || destinationObj.deliveredAt || data.completedAt,
    isHandedOver: Boolean(isDeliveredOrCompleted),
    isCompleted: Boolean(isDeliveredOrCompleted),
    receiverName: destinationObj.receiverName || data.receiverName || data.intakeReceiver || '',
    intakeReceiver: data.intakeReceiver || destinationObj.receiverName || data.receiverName || '',
    handoverPhotoUrl: destinationObj.handoverPhotoUrl || data.handoverPhotoUrl || '',
    handoverTemperature: destinationObj.coldBoxTempAtDrop !== undefined ? destinationObj.coldBoxTempAtDrop : data.handoverTemperature,
    photoUrl: data.photoUrl || (stopsProgress[0]?.photoUrl) || '',
    photo2Url: data.photo2Url || data.selfieUrl || (stopsProgress[0]?.photo2Url) || '',
    selfieUrl: data.selfieUrl || data.photo2Url || (stopsProgress[0]?.selfieUrl) || '',
    proofPhoto: data.proofPhoto || data.photoUrl || (stopsProgress[0]?.photoUrl) || '',
    totalVials: data.totalVials !== undefined ? data.totalVials : stopsProgress.reduce((sum: number, s: any) => sum + Number(s.sampleCount || 0), 0),
    sampleCount: data.sampleCount !== undefined ? data.sampleCount : stopsProgress.reduce((sum: number, s: any) => sum + Number(s.sampleCount || 0), 0),
    coldBoxTemp: data.coldBoxTemp !== undefined ? data.coldBoxTemp : (stopsProgress[0]?.coldBoxTemp ?? 4.0),
    temperature: data.temperature !== undefined ? data.temperature : (stopsProgress[0]?.coldBoxTemp ?? 4.0)
  };
}

// Rank how "complete" a stop's status is. Used by dispatchTrip below to recognize a stop that
// already has real rider-recorded progress (a photo, a completion) so a re-dispatch of the same
// route/slot/day (which reuses the exact same document id — see buildCanonicalTaskId) can never
// silently reset it back to a blank "pending" stop.
const DISPATCH_STOP_RANK: Record<string, number> = {
  pending: 0,
  in_progress: 1,
  arrived: 1,
  picked_up: 2,
  completed: 2,
  delivered: 2,
  no_sample: 2
};
const dispatchStopRank = (status?: string) => DISPATCH_STOP_RANK[status || 'pending'] ?? 0;

// Realtime Firestore synchronization helpers
export const CloudSync = {
  // Unified trip dispatch creating trip document in Firestore collection 'trips'
  async dispatchTrip(payload: {
    client: Client | { id: string; name: string; email?: string; lat?: number; lng?: number; address?: string };
    rider: PickupBoy | { id: string; name: string; phone: string; lat?: number; lng?: number; vehicleNumber?: string; currentLocation?: any };
    stops: Array<{ id?: string; stopId?: string; name?: string; stopName?: string; address?: string; lat?: number; lng?: number; specimenCount?: number; sampleCount?: number; status?: string; contactPerson?: string; phone?: string; pickupTime?: string; notes?: string }>;
    route?: Partial<Route>;
    timeSlot?: string;
    scheduledDate?: string;
    taskNotes?: string;
    customTripId?: string;
  }): Promise<any> {
    const timestamp = Date.now();
    const tripId = payload.customTripId || `trip_${timestamp}`;
    const todayStr = payload.scheduledDate || new Date().toISOString().split('T')[0];

    const clientLat = Number(payload.client.lat || (payload.client as any).location?.lat || 19.1287852);
    const clientLng = Number(payload.client.lng || (payload.client as any).location?.lng || 72.8294183);

    const riderLat = Number(
      payload.rider.lat ||
      (payload.rider as any).currentLocation?.lat ||
      19.1287
    );
    const riderLng = Number(
      payload.rider.lng ||
      (payload.rider as any).currentLocation?.lng ||
      72.8294
    );

    // 1. Format unified trip stops schema
    const tripStops = payload.stops.map((s: any, idx: number) => ({
      stopIndex: idx + 1,
      name: s.name || s.stopName || '',
      address: s.address || '',
      coords: [Number(s.lat || 19.1287852), Number(s.lng || 72.8294183)] as [number, number],
      specimenCount: Number(s.specimenCount ?? s.sampleCount ?? 0),
      status: 'pending' as 'pending' | 'in_progress' | 'completed',
      id: s.id || s.stopId || `stop-${idx + 1}`,
      stopId: s.stopId || s.id || `stop-${idx + 1}`,
      contactPerson: s.contactPerson || '',
      phone: s.phone || '',
      pickupTime: s.pickupTime || '',
      notes: s.notes || ''
    }));

    // Exact Unified Trip document model
    const tripDocPayload = {
      id: tripId,
      clientId: payload.client.id || '',
      clientName: payload.client.name || '',
      clientEmail: (payload.client as any).email || '',
      clientCoords: [clientLat, clientLng] as [number, number],
      riderId: payload.rider.id || '',
      riderName: payload.rider.name || '',
      riderPhone: payload.rider.phone || '',
      riderCoords: [riderLat, riderLng] as [number, number],
      stops: tripStops,
      currentStopIndex: 0,
      status: 'assigned' as 'assigned' | 'in_transit' | 'completed',
      chillerTemp: 4.2,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      // Additional metadata for compatibility
      routeId: payload.route?.id || '',
      routeName: payload.route?.name || '',
      timeSlot: payload.timeSlot || '',
      date: todayStr,
      riderVehicle: payload.rider.vehicleNumber || '',
      isDelayed: false,
      delayMinutes: 0,
      issueFlags: []
    };

    // Hoisted so the function can return whatever was actually written (which, on a redispatch,
    // carries forward the preserved stop progress computed inside the try block below) rather
    // than always returning the fresh/blank payload.
    let finalTripDocPayload: any = tripDocPayload;

    try {
      // Dispatching reuses a DETERMINISTIC document id (same route + time slot + day always maps
      // to the same 'trips'/'tasks' document — see buildCanonicalTaskId's own comment). That is
      // intentional so the rider's app and the admin's dispatch land on one shared document
      // instead of creating parallel duplicates. But it means calling dispatch a SECOND time for
      // a round that is already under way (correcting a stop's address, adding a stop, or simply
      // re-clicking "Dispatch") used to `setDoc(...)` the WHOLE document from scratch with every
      // stop reset to "pending" and no photos — permanently erasing any pickups the rider had
      // already completed and photographed for that round. We now read whatever is already on
      // the server first and carry forward any stop that already has real recorded progress.
      const tripRef = doc(db, 'trips', tripId);
      let finalStops: any[] = tripStops;
      let isRedispatch = false;
      let existingCurrentStopIndex = 0;
      let existingStatus: string | undefined;
      let existingCreatedAt: any;

      try {
        const existingSnap = await getDoc(tripRef);
        if (existingSnap.exists()) {
          const existingData = existingSnap.data() as any;
          const existingStopsArr: any[] = Array.isArray(existingData.stops) && existingData.stops.length > 0
            ? existingData.stops
            : (Array.isArray(existingData.stopsProgress) ? existingData.stopsProgress : []);

          if (existingStopsArr.length > 0) {
            isRedispatch = true;
            existingCurrentStopIndex = Number(existingData.currentStopIndex || 0);
            existingStatus = existingData.status;
            existingCreatedAt = existingData.createdAt;

            finalStops = tripStops.map((freshStop, idx) => {
              const matched = existingStopsArr.find(
                (es: any) => (es.id || es.stopId) === (freshStop.id || freshStop.stopId)
              ) || existingStopsArr[idx];

              if (matched && dispatchStopRank(matched.status) > 0) {
                // This stop already has rider-recorded progress (status beyond "pending",
                // typically with a photo attached) — keep it exactly as-is instead of
                // overwriting it with the fresh, blank copy from this re-dispatch.
                return { ...freshStop, ...matched, coords: freshStop.coords };
              }
              return freshStop;
            });
          }
        }
      } catch (fetchErr) {
        console.warn('[CloudSync] Could not check for an existing trip before dispatch; proceeding as a fresh dispatch:', fetchErr);
      }

      finalTripDocPayload = {
        ...tripDocPayload,
        stops: finalStops,
        currentStopIndex: isRedispatch
          ? Math.max(existingCurrentStopIndex, tripDocPayload.currentStopIndex)
          : tripDocPayload.currentStopIndex,
        status: isRedispatch && existingStatus && existingStatus !== 'assigned'
          ? existingStatus
          : tripDocPayload.status,
        createdAt: isRedispatch && existingCreatedAt ? existingCreatedAt : tripDocPayload.createdAt
      };

      // Write to 'trips' collection. `{ merge: true }` on a redispatch so any other field written
      // by the rider's app in the meantime (e.g. live GPS coords) isn't clobbered either.
      await setDoc(tripRef, finalTripDocPayload, { merge: true });
      console.log(`[CloudSync] Dispatched trip document ${tripId} to trips collection.`);

      // Also mirror to 'tasks' collection for backward compatibility
      const legacyTaskPayload = {
        ...finalTripDocPayload,
        clientLabId: payload.client.id,
        clientLabName: payload.client.name,
        clientLabLocation: { lat: clientLat, lng: clientLng },
        assignedRiderId: payload.rider.id,
        assignedRiderName: payload.rider.name,
        assignedRiderPhone: payload.rider.phone,
        stopsProgress: finalStops.map((s) => ({
          stopId: s.id || s.stopId,
          stopName: s.name || s.stopName,
          address: s.address,
          lat: s.coords ? s.coords[0] : s.lat,
          lng: s.coords ? s.coords[1] : s.lng,
          contactPerson: s.contactPerson,
          phone: s.phone,
          status: s.status || 'pending',
          pickupTime: s.pickupTime || '',
          sampleCount: s.specimenCount ?? s.sampleCount ?? 0,
          specimenCount: s.specimenCount ?? s.sampleCount ?? 0,
          photoUrl: s.photoUrl || '',
          photo2Url: s.photo2Url || s.handoverPhotoUrl || '',
          handoverPhotoUrl: s.handoverPhotoUrl || s.photo2Url || '',
          notes: s.notes
        })),
        destination: {
          name: payload.route?.destinationLab?.name || payload.client.name,
          address: payload.route?.destinationLab?.address || (payload.client as any).address || '',
          lat: clientLat,
          lng: clientLng,
          notes: payload.taskNotes || 'Specimen cold-chain transport'
        }
      };
      await setDoc(doc(db, 'tasks', tripId), legacyTaskPayload, { merge: true });

      // Update riders/${riderId} setting activeTripId = tripId and dutyStatus = "on_trip"
      const riderDocRef = doc(db, 'riders', payload.rider.id);
      await setDoc(
        riderDocRef,
        {
          id: payload.rider.id,
          activeTripId: tripId,
          dutyStatus: 'on_trip',
          currentTaskId: tripId,
          activeTaskId: tripId,
          activeRouteId: payload.route?.id || `route-${payload.client.id}`,
          lastDispatchedAt: serverTimestamp(),
          lastUpdated: serverTimestamp(),
          status: 'active',
          isOnline: true
        },
        { merge: true }
      );
      console.log(`[CloudSync] Updated riders/${payload.rider.id} activeTripId=${tripId}, dutyStatus="on_trip"`);
    } catch (err) {
      console.error("Firestore Write Error:", err);
    }

    return finalTripDocPayload;
  },

  // Standardized dispatchTask wrapper returning formatted PickupTask
  async dispatchTask(payload: {
    client: Client | { id: string; name: string; email?: string; lat?: number; lng?: number; address?: string };
    rider: PickupBoy | { id: string; name: string; phone: string; vehicleNumber?: string; lat?: number; lng?: number };
    stops: Array<{ id?: string; stopId?: string; name?: string; stopName?: string; address?: string; lat?: number; lng?: number; specimenCount?: number; sampleCount?: number; status?: string; assignedRiderId?: string; assignedRiderName?: string; contactPerson?: string; phone?: string; pickupTime?: string; notes?: string }>;
    route?: Partial<Route>;
    timeSlot?: string;
    scheduledDate?: string;
    taskNotes?: string;
    customTaskId?: string;
  }): Promise<PickupTask> {
    const tripPayload = await this.dispatchTrip({
      ...payload,
      customTripId: payload.customTaskId
    });

    return formatUnifiedTask(tripPayload.id, {
      ...tripPayload,
      createdAt: new Date().toISOString()
    });
  },

  // Real-time trip lifecycle updates
  async startTripRoute(tripId: string, riderId?: string) {
    try {
      const tripRef = doc(db, 'trips', tripId);
      const updateData: any = {
        status: 'in_transit',
        startedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      await setDoc(tripRef, updateData, { merge: true });

      // Also mirror to legacy tasks
      await setDoc(doc(db, 'tasks', tripId), {
        status: 'in_transit',
        startedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });

      if (riderId) {
        await setDoc(doc(db, 'riders', riderId), {
          dutyStatus: 'on_trip',
          activeTripId: tripId,
          status: 'active',
          lastUpdated: serverTimestamp()
        }, { merge: true });
      }
      console.log(`[CloudSync] Started trip route for ${tripId}`);
    } catch (err) {
      console.error("Firestore Write Error:", err);
    }
  },

  async updateTripRiderLocation(
    tripId: string,
    riderId: string,
    lat: number,
    lng: number,
    extra?: { heading?: number; speed?: number; battery?: number; riderName?: string; riderPhone?: string }
  ) {
    try {
      const numLat = Number(lat);
      const numLng = Number(lng);
      if (isNaN(numLat) || isNaN(numLng)) return;

      const throttleKey = `${riderId || 'rider'}_${tripId || 'notrip'}`;
      const now = Date.now();
      const lastWrite = locationWriteThrottleMap.get(throttleKey);

      if (lastWrite && now - lastWrite.timestamp < 12000) {
        // Less than 12s has elapsed, skip redundant cloud write to conserve quota
        return;
      }
      locationWriteThrottleMap.set(throttleKey, { timestamp: now, lat: numLat, lng: numLng });

      // These two writes are INDEPENDENT and must not share a try block.
      //
      // They used to. So when the trip write was rejected -- which happens whenever the trip
      // document's riderId does not match this rider's auth claim, or when no trips/{id} document
      // exists at all -- the exception aborted the function before the rider's own location was
      // written. The result was a permission error every few seconds AND no GPS position reaching
      // Firestore, so ops could not see the rider move.
      //
      // The trip write also used setDoc(merge), which CREATES the document when it is missing, and
      // creating a trip is admin-only. updateDoc fails cleanly instead of attempting a create.

      // 1. Update trip document riderCoords and updatedAt (best effort -- may legitimately be
      //    denied if this rider is not the one assigned to that trip).
      if (tripId) {
        try {
          await updateDoc(doc(db, 'trips', tripId), {
            riderCoords: [numLat, numLng],
            updatedAt: serverTimestamp()
          });
        } catch (tripErr: any) {
          if (tripErr?.code === 'permission-denied' || tripErr?.code === 'not-found') {
            console.warn(
              `[CloudSync] Skipping trip ${tripId} location update (not assigned to this rider, or no trip document).`
            );
          } else {
            console.warn('[CloudSync] Trip location update notice:', tripErr?.message || tripErr);
          }
        }
      }

      // 2. Update rider document location -- this is the one that actually matters for tracking,
      //    and it now runs regardless of what happened above.
      if (riderId) {
        try {
          await setDoc(doc(db, 'riders', riderId), {
            lat: numLat,
            lng: numLng,
            currentLocation: {
              lat: numLat,
              lng: numLng,
              timestamp: new Date().toISOString(),
              heading: extra?.heading || 0,
              speed: extra?.speed || 0
            },
            lastPingTime: new Date().toISOString(),
            lastUpdated: serverTimestamp(),
            isOnline: true
          }, { merge: true });
        } catch (riderErr: any) {
          if (riderErr?.code === 'resource-exhausted') {
            console.warn('[CloudSync] Firestore quota exceeded for rider location update.');
          } else {
            console.warn('[CloudSync] Rider location update notice:', riderErr?.message || riderErr);
          }
        }
      }
    } catch (err: any) {
      if (err?.code === 'resource-exhausted' || err?.message?.includes('Quota exceeded')) {
        console.warn('[CloudSync] Firestore rate limit or quota exceeded for location update.');
      } else {
        console.warn('[CloudSync] Location update notice:', err?.message || err);
      }
    }
  },

  async completeTripStop(tripId: string, stopIndex: number, currentStops: any[], extra?: any) {
    try {
      const nowStr = new Date().toISOString();

      // Defensive re-sync: `currentStops` comes from the caller's local React state, which can be
      // stale (e.g. resolved from an older cached task copy while confirming a LATER stop).
      // Firestore's `merge: true` does NOT deep-merge array fields — writing `stops`/`stopsProgress`
      // replaces the whole array. If we blindly write a stale `currentStops` array here, an earlier
      // stop's already-confirmed proof (photo, status) gets silently overwritten back to "pending".
      // To prevent that, we re-read the current server copy of the stops array and use IT as the
      // base for every stop except the one we are actively confirming, so a stale local snapshot
      // can never erase another stop's real progress.
      let baseStops = currentStops;
      try {
        let freshStopsArr: any[] | null = null;
        const freshTripSnap = await getDoc(doc(db, 'trips', tripId));
        if (freshTripSnap.exists()) {
          const freshData = freshTripSnap.data() as any;
          freshStopsArr = Array.isArray(freshData.stops) && freshData.stops.length > 0
            ? freshData.stops
            : (Array.isArray(freshData.stopsProgress) ? freshData.stopsProgress : null);
        }

        if (!freshStopsArr || freshStopsArr.length === 0) {
          // 'trips' didn't have a usable stops array — fall back to 'tasks', which every write
          // in this file mirrors alongside 'trips', before giving up and trusting the local copy.
          const freshTaskSnap = await getDoc(doc(db, 'tasks', tripId));
          if (freshTaskSnap.exists()) {
            const freshTaskData = freshTaskSnap.data() as any;
            freshStopsArr = Array.isArray(freshTaskData.stops) && freshTaskData.stops.length > 0
              ? freshTaskData.stops
              : (Array.isArray(freshTaskData.stopsProgress) ? freshTaskData.stopsProgress : null);
          }
        }

        if (freshStopsArr && freshStopsArr.length === currentStops.length) {
          baseStops = freshStopsArr;
        } else if (freshStopsArr && freshStopsArr.length > 0) {
          // Shapes don't match exactly (a stop was added/removed on the server since this rider
          // last loaded the task) — still protect any already-completed stop by matching on id
          // instead of giving up entirely and trusting the possibly-stale local copy for every stop.
          const knownFreshStops = freshStopsArr;
          baseStops = currentStops.map((localStop: any, idx: number) => {
            const serverStop = knownFreshStops.find(
              (fs: any) => (fs.id || fs.stopId) === (localStop.id || localStop.stopId)
            );
            if (serverStop && dispatchStopRank(serverStop.status) > dispatchStopRank(localStop.status)) {
              return serverStop;
            }
            return localStop;
          });
        }
      } catch (fetchErr) {
        console.warn('[CloudSync] Could not fetch fresh trip doc before completing stop, using local copy as fallback:', fetchErr);
      }

      const updatedStops = baseStops.map((s: any, idx: number) => {
        if (idx === stopIndex) {
          const sampleCount = extra?.sampleCount !== undefined ? Number(extra.sampleCount) : Number(s.sampleCount ?? s.specimenCount ?? 0);
          const photoUrl = extra?.photoUrl || s.photoUrl || '';
          const photo2Url = extra?.photo2Url || extra?.handoverPhotoUrl || s.photo2Url || s.handoverPhotoUrl || '';
          const handoverPhotoUrl = extra?.handoverPhotoUrl || extra?.photo2Url || s.handoverPhotoUrl || s.photo2Url || '';
          const coldBoxTemp = extra?.coldBoxTemp !== undefined ? Number(extra.coldBoxTemp) : (s.coldBoxTemp ?? 4.0);
          const remark = extra?.remark || s.remark || (extra?.noSampleReason ? 'No Sample' : (sampleCount > 0 ? 'Collected sample' : undefined));
          const noSampleReason = extra?.noSampleReason || s.noSampleReason || '';

          return {
            ...s,
            status: extra?.status || (remark === 'No Sample' ? 'no_sample' : 'completed'),
            completedAt: nowStr,
            pickedUpAt: s.pickedUpAt || nowStr,
            arrivedAt: s.arrivedAt || nowStr,
            specimenCount: sampleCount,
            sampleCount: sampleCount,
            photoUrl: photoUrl,
            photo2Url: photo2Url,
            handoverPhotoUrl: handoverPhotoUrl,
            photoTimestamp: extra?.photoTimestamp || nowStr,
            photoLocation: extra?.photoLocation || s.photoLocation || { lat: 19.2082, lng: 72.8398, accuracy: 5 },
            coldBoxTemp: coldBoxTemp,
            notes: extra?.notes || s.notes || '',
            remark,
            noSampleReason
          };
        }
        if (idx === stopIndex + 1 && s.status === 'pending') {
          return { ...s, status: 'in_progress' };
        }
        return s;
      });

      const nextStopIndex = stopIndex + 1 < currentStops.length ? stopIndex + 1 : currentStops.length;

      const tripRef = doc(db, 'trips', tripId);
      const stopsProgressArray = updatedStops.map((s: any) => ({
        stopId: s.id || s.stopId,
        id: s.id || s.stopId,
        stopName: s.name || s.stopName,
        name: s.name || s.stopName,
        address: s.address,
        lat: s.coords?.[0] || s.lat,
        lng: s.coords?.[1] || s.lng,
        status: s.status === 'completed' ? 'picked_up' : s.status,
        sampleCount: s.sampleCount ?? s.specimenCount ?? 0,
        specimenCount: s.sampleCount ?? s.specimenCount ?? 0,
        photoUrl: s.photoUrl || '',
        photo2Url: s.photo2Url || s.handoverPhotoUrl || s.selfieUrl || '',
        handoverPhotoUrl: s.handoverPhotoUrl || s.photo2Url || s.selfieUrl || '',
        selfieUrl: s.selfieUrl || s.photo2Url || s.handoverPhotoUrl || '',
        photoTimestamp: s.photoTimestamp || nowStr,
        photoLocation: s.photoLocation || { lat: 19.2082, lng: 72.8398, accuracy: 5 },
        coldBoxTemp: s.coldBoxTemp,
        pickedUpAt: s.pickedUpAt || nowStr,
        completedAt: s.completedAt || nowStr,
        arrivedAt: s.arrivedAt,
        notes: s.notes || '',
        remark: s.remark,
        noSampleReason: s.noSampleReason
      }));

      await setDoc(tripRef, {
        stops: updatedStops,
        stopsProgress: stopsProgressArray,
        currentStopIndex: nextStopIndex,
        updatedAt: serverTimestamp()
      }, { merge: true });

      // Mirror to tasks
      await setDoc(doc(db, 'tasks', tripId), {
        stops: updatedStops,
        currentStopIndex: nextStopIndex,
        stopsProgress: stopsProgressArray,
        updatedAt: serverTimestamp()
      }, { merge: true });

      console.log(`[CloudSync] Completed stop ${stopIndex + 1} for trip ${tripId} with photo verification.`);
    } catch (err) {
      console.error("Firestore Write Error in completeTripStop:", err);
      // MUST rethrow. This used to swallow the failure and return normally, so the caller's
      // .then() ran on a write that never happened: the offline queue deleted the proof as
      // "synced" and the rider was shown a green "Saved and synced to Ops" banner while the
      // capture existed nowhere but local state. A failed write has to look like a failure.
      throw err;
    }
  },

  async completeTripFinalHandover(tripId: string, riderId: string, dropData?: any) {
    try {
      const nowStr = new Date().toISOString();
      const dropObj = {
        name: dropData?.destinationName || '',
        address: dropData?.destinationAddress || '',
        status: 'delivered',
        completedAt: nowStr,
        deliveredAt: nowStr,
        receiverName: dropData?.receiverName || '',
        dropPhotoUrl: dropData?.dropPhotoUrl || '',
        handoverPhotoUrl: dropData?.dropPhotoUrl || '',
        coldBoxTempAtDrop: dropData?.coldBoxTemp ?? 4.0,
        totalVialsHandedOver: dropData?.totalVials ?? 0,
        notes: dropData?.notes || `Total ${dropData?.totalVials ?? 0} specimen vials handed over in certified cold chain (${dropData?.coldBoxTemp ?? 4.0}°C).`
      };

      const tripRef = doc(db, 'trips', tripId);
      await setDoc(tripRef, {
        status: 'completed',
        completedAt: serverTimestamp(),
        deliveryTimestamp: nowStr,
        isHandedOver: true,
        isCompleted: true,
        receiverName: dropData?.receiverName || '',
        intakeReceiver: dropData?.receiverName || '',
        handoverPhotoUrl: dropData?.dropPhotoUrl || '',
        handoverTemperature: dropData?.coldBoxTemp ?? 4.0,
        updatedAt: serverTimestamp(),
        finalDrop: dropData || null,
        destination: dropObj
      }, { merge: true });

      // Mirror to tasks
      await setDoc(doc(db, 'tasks', tripId), {
        status: 'delivered',
        completedAt: serverTimestamp(),
        deliveryTimestamp: nowStr,
        isHandedOver: true,
        isCompleted: true,
        receiverName: dropData?.receiverName || '',
        intakeReceiver: dropData?.receiverName || '',
        handoverPhotoUrl: dropData?.dropPhotoUrl || '',
        handoverTemperature: dropData?.coldBoxTemp ?? 4.0,
        updatedAt: serverTimestamp(),
        destination: dropObj
      }, { merge: true });

      if (riderId) {
        await setDoc(doc(db, 'riders', riderId), {
          dutyStatus: 'available',
          activeTripId: '',
          currentTaskId: '',
          activeTaskId: '',
          lastUpdated: serverTimestamp()
        }, { merge: true });
      }

      console.log(`[CloudSync] Successfully completed final delivery handover for trip ${tripId}`);
    } catch (err) {
      console.error("Firestore Write Error in completeTripFinalHandover:", err);
      // Rethrow for the same reason as completeTripStop: a swallowed failure makes the offline
      // queue believe the handover was recorded when it was not.
      throw err;
    }
  },

  // Fields on a rider/client document that only an admin or a Cloud Function may ever change.
  // Mirrors the deny-list in firestore.rules.
  PROTECTED_PROFILE_FIELDS: ['password', 'authMigrated', 'authUid', 'assignedRouteIds', 'role'] as const,

  // Sync a single document to Firestore
  async syncDocument(collectionName: string, docId: string, data: any) {
    try {
      if (!docId || !collectionName) return;
      const ref = doc(db, collectionName, String(docId));

      let payload = JSON.parse(JSON.stringify(data));

      // A task's date must never be rewritten by a routine sync. Full-document writes were
      // refreshing scheduledDate/date on old rounds, which made a 4 September round claim to be
      // today's and reappear in the live feed. The ID carries the real date, so these fields are
      // dropped from task/trip updates rather than allowed to drift.
      if (collectionName === 'tasks' || collectionName === 'trips') {
        const idDate = String(docId).match(/^task-(\d{4}-\d{2}-\d{2})-/);
        if (idDate) {
          if (payload.scheduledDate && payload.scheduledDate !== idDate[1]) delete payload.scheduledDate;
          if (payload.date && payload.date !== idDate[1]) delete payload.date;
        }
      }

      // A rider's own app syncs its whole local profile object back with merge:true. That object
      // still carries assignedRouteIds / role / authUid, and firestore.rules (correctly) rejects
      // any self-update touching those -- which failed the ENTIRE write, so genuine changes like
      // check-in state and GPS never landed. Strip those keys unless an admin is making the call.
      // NOTE: this deliberately does NOT pre-emptively strip protected fields based on a role
      // claim. Doing so silently discarded an admin's own edits whenever their browser token had
      // not yet picked up the admin claim -- an admin would assign a route, see "saved", and the
      // assignedRouteIds would never reach Firestore. Instead the full payload is attempted first,
      // and only if the rules reject it do we retry without the admin-only fields (the rider/client
      // self-sync case). Whoever is genuinely allowed to write those fields keeps writing them.

      // A rider mirrors every task update into BOTH tasks/ and trips/. When no trips/{id} document
      // exists, setDoc(merge) counts as a CREATE, and creating a trip is admin-only -- so this
      // threw a red permission error on every save even though the authoritative write to tasks/
      // had already succeeded. For non-admins, mirror writes update an existing document or do
      // nothing; they never attempt a create.
      const isMirrorCollection = collectionName === 'trips';
      let isAdminUser = false;
      try {
        const tokenResult = await auth.currentUser?.getIdTokenResult();
        isAdminUser = tokenResult?.claims?.role === 'admin';
      } catch {
        isAdminUser = false;
      }

      if (isMirrorCollection && !isAdminUser) {
        try {
          await updateDoc(ref, payload);
          console.log(`[CloudSync] Synced ${collectionName}/${docId} to Firestore.`);
        } catch (mirrorErr: any) {
          console.warn(
            `[CloudSync] Skipped ${collectionName}/${docId} mirror write (${mirrorErr?.code || 'no matching document'}).`
          );
        }
        return;
      }

      try {
        await setDoc(ref, payload, { merge: true });
      } catch (writeErr: any) {
        const isProfileDoc = collectionName === 'riders' || collectionName === 'clients';
        if (writeErr?.code === 'permission-denied' && isProfileDoc) {
          // Most likely a rider/client syncing their own profile, which may not change the
          // admin-only fields. Retry with those removed so the rest of the update still lands.
          const reduced = { ...payload };
          CloudSync.PROTECTED_PROFILE_FIELDS.forEach((field) => {
            delete (reduced as any)[field];
          });
          await setDoc(ref, reduced, { merge: true });
          console.log(`[CloudSync] Synced ${collectionName}/${docId} (without admin-only fields).`);
          return;
        }
        throw writeErr;
      }
      console.log(`[CloudSync] Synced ${collectionName}/${docId} to Firestore.`);

      // Document synced successfully
    } catch (err: any) {
      if (err?.code === 'resource-exhausted' || err?.message?.includes('Quota exceeded')) {
        console.warn(`[CloudSync] Firestore quota exceeded while syncing ${collectionName}/${docId}; cached locally.`);
      } else if (err?.code === 'permission-denied') {
        // Expected whenever a rider or client touches a document they do not own. The local copy
        // is still correct; this is not a failure worth a red error in the console.
        console.warn(
          `[CloudSync] Not permitted to write ${collectionName}/${docId} as this user; kept locally.`
        );
      } else {
        console.error("Firestore Write Error:", err);
      }
    }
  },

  // Delete a document from Firestore
  async deleteDocument(collectionName: string, docId: string) {
    try {
      if (!docId || !collectionName) return;
      const ref = doc(db, collectionName, String(docId));
      await deleteDoc(ref);
      console.log(`[CloudSync] Deleted ${collectionName}/${docId} from Firestore.`);
    } catch (err: any) {
      if (err?.code === 'resource-exhausted' || err?.message?.includes('Quota exceeded')) {
        console.warn(`[CloudSync] Firestore quota exceeded while deleting ${collectionName}/${docId}; handled locally.`);
      } else {
        console.error("Firestore Write Error:", err);
      }
    }
  },

  // Sync an entire collection of items to Firestore
  async syncCollection(collectionName: string, items: any[]) {
    try {
      if (!items || !items.length) return;
      const batch = writeBatch(db);
      for (const item of items) {
        if (item.id) {
          const ref = doc(db, collectionName, String(item.id));
          batch.set(ref, JSON.parse(JSON.stringify(item)), { merge: true });
        }
      }
      await batch.commit();
      console.log(`[CloudSync] Batch synced ${items.length} items to ${collectionName}.`);
    } catch (err: any) {
      if (err?.code === 'resource-exhausted' || err?.message?.includes('Quota exceeded')) {
        console.warn(`[CloudSync] Firestore quota exceeded for batch sync to ${collectionName}; cached locally.`);
      } else {
        console.error("Firestore Write Error:", err);
      }
    }
  },

  // Update rider document directly in Firestore 'riders' with GeoPoint, battery, heading, speed, and serverTimestamp
  async recordLocationPing(ping: LocationPing) {
    try {
      if (!ping.riderId) return;
      const geoPoint = toFirestoreGeoPoint(ping.lat, ping.lng);
      const riderDocRef = doc(db, 'riders', ping.riderId);
      
      await setDoc(riderDocRef, {
        id: ping.riderId,
        lat: ping.lat,
        lng: ping.lng,
        heading: ping.heading ?? 0,
        speed: ping.speed ?? 0,
        battery: ping.battery ?? 88,
        batteryLevel: ping.battery ?? 88,
        lastPing: serverTimestamp(),
        lastPingTime: ping.timestamp || new Date().toISOString(),
        lastUpdated: serverTimestamp(),
        isOnline: true,
        status: 'active',
        currentLocation: {
          lat: ping.lat,
          lng: ping.lng,
          location: geoPoint,
          timestamp: ping.timestamp || new Date().toISOString(),
          heading: ping.heading ?? 0,
          speed: ping.speed ?? 0,
          accuracy: 5
        }
      }, { merge: true });
    } catch (err: any) {
      console.warn('[CloudSync] Location ping sync notice:', err?.message || err);
    }
  },

  // Update rider GPS location with serverTimestamp and online flag
  async updateRiderGpsLocation(riderId: string, lat: number, lng: number, heading: number = 0, speed: number = 0, battery: number = 90, taskId?: string) {
    try {
      const geoPoint = toFirestoreGeoPoint(lat, lng);
      const nowIso = new Date().toISOString();

      // Update rider document directly
      const riderDocRef = doc(db, 'riders', riderId);
      await setDoc(riderDocRef, {
        id: riderId,
        lat,
        lng,
        heading: heading || 0,
        speed: speed || 0,
        battery,
        batteryLevel: battery,
        lastPing: serverTimestamp(),
        lastPingTime: nowIso,
        lastUpdated: serverTimestamp(),
        isOnline: true,
        currentLocation: {
          lat,
          lng,
          location: geoPoint,
          timestamp: nowIso,
          heading: heading || 0,
          speed: speed || 0,
          accuracy: 5
        }
      }, { merge: true });
    } catch (err: any) {
      console.warn('[CloudSync] updateRiderGpsLocation notice:', err?.message || err);
    }
  },

  // Subscribe to real-time updates for a collection with polling fallback on quota exhaustion
  /**
   * Subscribes to a collection through one or more SCOPED equality queries and merges the results.
   *
   * WHY: the rider/client subscriptions used to listen to collection(db, 'tasks') and
   * collection(db, 'trips') wholesale and filter in the browser. Firestore security rules reject
   * an unconstrained list query outright -- for a list, the query itself must prove that every
   * document it could return is readable, and "read everything, filter later" cannot prove that.
   * That is why a rider signed in successfully but saw zero rounds.
   *
   * Assignment is recorded on two different fields depending on how the task was written
   * (riderId vs assignedRiderId, clientId vs clientLabId), and Firestore has no OR across
   * fields in this form, so each field gets its own query and the results are merged by
   * document id.
   */
  subscribeMergedQueries(
    collectionName: string,
    constraints: Array<[string, any]>,
    onDocs: (docs: Array<{ id: string; data: any }>) => void,
    onError?: (err: any) => void
  ): Unsubscribe {
    const buckets: Array<Map<string, any>> = constraints.map(() => new Map());
    const unsubs: Unsubscribe[] = [];

    const emit = () => {
      const merged = new Map<string, any>();
      buckets.forEach((bucket) => bucket.forEach((value, key) => merged.set(key, value)));
      onDocs(Array.from(merged.entries()).map(([id, data]) => ({ id, data })));
    };

    constraints.forEach(([field, value], idx) => {
      if (value === undefined || value === null || value === '') return;
      try {
        const scoped = query(collection(db, collectionName), where(field, '==', value));
        unsubs.push(
          onSnapshot(scoped, {
            next: (snapshot) => {
              const bucket = new Map<string, any>();
              snapshot.forEach((docSnap) => bucket.set(docSnap.id, docSnap.data()));
              buckets[idx] = bucket;
              emit();
            },
            error: (err) => {
              if (onError) onError(err);
            }
          })
        );
      } catch (err) {
        if (onError) onError(err);
      }
    });

    return () => unsubs.forEach((u) => u());
  },

  subscribeToCollection<T>(collectionName: string, onUpdate: (items: T[]) => void): Unsubscribe {
    let isCancelled = false;
    let pollIntervalId: number | null = null;
    let unsubSnapshot: Unsubscribe = () => {};

    const fetchViaPolling = async () => {
      try {
        const colRef = collection(db, collectionName);
        const snapshot = await getDocs(colRef);
        if (isCancelled) return;
        if (snapshot.empty) {
          onUpdate([]);
        } else {
          const list: T[] = [];
          snapshot.forEach((docSnap) => {
            const rawData = (docSnap.data() as any) || {};
            const data: any = { id: docSnap.id, ...rawData };
            if (data.location instanceof GeoPoint) {
              data.lat = data.location.latitude;
              data.lng = data.location.longitude;
            } else if (data.currentLocation?.location instanceof GeoPoint) {
              data.currentLocation.lat = data.currentLocation.location.latitude;
              data.currentLocation.lng = data.currentLocation.location.longitude;
            }
            list.push(data as T);
          });
          onUpdate(list);
        }
      } catch (pollErr: any) {
        console.warn(`[CloudSync] Polling fallback error for ${collectionName}:`, pollErr?.message || pollErr);
      }
    };

    const activatePollingFallback = (reason: string) => {
      console.warn(`[CloudSync] Real-time listener for ${collectionName} paused, switching to interval sync (15s):`, reason);
      fetchViaPolling();
      if (!pollIntervalId) {
        pollIntervalId = window.setInterval(fetchViaPolling, 15000);
      }
    };

    try {
      const colRef = collection(db, collectionName);
      unsubSnapshot = onSnapshot(
        colRef,
        {
          next: (snapshot) => {
            if (isCancelled) return;
            if (pollIntervalId) {
              clearInterval(pollIntervalId);
              pollIntervalId = null;
            }
            if (snapshot.empty) {
              onUpdate([]);
            } else {
              const list: T[] = [];
              snapshot.forEach((docSnap) => {
                const rawData = (docSnap.data() as any) || {};
                const data: any = { id: docSnap.id, ...rawData };
                // Parse GeoPoint fields if present
                if (data.location instanceof GeoPoint) {
                  data.lat = data.location.latitude;
                  data.lng = data.location.longitude;
                } else if (data.currentLocation?.location instanceof GeoPoint) {
                  data.currentLocation.lat = data.currentLocation.location.latitude;
                  data.currentLocation.lng = data.currentLocation.location.longitude;
                }
                list.push(data as T);
              });
              onUpdate(list);
            }
          },
          error: (error: any) => {
            if (isCancelled) return;
            const errMsg = error?.message || '';
            const errCode = error?.code || '';
            if (
              errCode === 'resource-exhausted' ||
              errMsg.toLowerCase().includes('quota') ||
              errMsg.toLowerCase().includes('resource_exhausted')
            ) {
              activatePollingFallback('Quota exceeded / Resource exhausted');
            } else if (error?.code === 'permission-denied') {
              console.info(`[CloudSync] Real-time listener on ${collectionName}: ${errMsg}`);
            } else {
              console.warn(`[CloudSync] Real-time listener notice for ${collectionName}:`, errMsg);
              activatePollingFallback(errMsg);
            }
          }
        }
      );
    } catch (err: any) {
      activatePollingFallback(err?.message || 'Listener initialization failed');
    }

    return () => {
      isCancelled = true;
      unsubSnapshot();
      if (pollIntervalId) {
        clearInterval(pollIntervalId);
        pollIntervalId = null;
      }
    };
  },

  // Dedicated real-time snapshot subscription for 'locations' collection
  subscribeToLocations(onUpdate: (pings: LocationPing[]) => void): Unsubscribe {
    return this.subscribeToCollection('locations', (items: any[]) => {
      const formatted = items.map((item: any) => {
        const coords = parseFirestoreGeoPoint(item.location) || { lat: item.lat, lng: item.lng };
        return {
          ...item,
          lat: coords.lat,
          lng: coords.lng
        } as LocationPing;
      });
      onUpdate(formatted);
    });
  },

  // Dedicated real-time snapshot subscription for 'riders' collection
  subscribeToRiders(onUpdate: (riders: PickupBoy[]) => void): Unsubscribe {
    return this.subscribeToCollection('riders', (items: any[]) => {
      const formatted = items.map((r: any) => {
        if (r.currentLocation) {
          const coords = parseFirestoreGeoPoint(r.currentLocation.location) || {
            lat: r.currentLocation.lat,
            lng: r.currentLocation.lng
          };
          return {
            ...r,
            currentLocation: {
              ...r.currentLocation,
              lat: coords.lat,
              lng: coords.lng
            }
          };
        }
        return r;
      }) as PickupBoy[];
      onUpdate(formatted);
    });
  },

  // Dedicated real-time snapshot subscription for 'tasks' collection with unified formatting
  subscribeToTasks(onUpdate: (tasks: PickupTask[]) => void): Unsubscribe {
    return this.subscribeToCollection('tasks', (items: any[]) => {
      const formatted = (items || []).map((t: any) => formatUnifiedTask(t.id || t.customTaskId || t.tripId, t));
      onUpdate(formatted);
    });
  },

  // Dedicated real-time snapshot subscription for 'clients' collection
  subscribeToClients(onUpdate: (clients: Client[]) => void): Unsubscribe {
    return this.subscribeToCollection('clients', (items: any[]) => {
      const formatted = items.map((c: any) => {
        if (c.location) {
          const coords = parseFirestoreGeoPoint(c.location);
          if (coords) {
            c.lat = coords.lat;
            c.lng = coords.lng;
          }
        }
        return c;
      }) as Client[];
      onUpdate(formatted);
    });
  },

  // Dedicated real-time snapshot subscription for 'attendance' collection
  subscribeToAttendance(onUpdate: (records: AttendanceRecord[]) => void): Unsubscribe {
    return this.subscribeToCollection('attendance', (items: any[]) => {
      const formatted = items.map((a: any) => {
        if (a.checkInLocation?.location) {
          const coords = parseFirestoreGeoPoint(a.checkInLocation.location);
          if (coords) {
            a.checkInLocation.lat = coords.lat;
            a.checkInLocation.lng = coords.lng;
          }
        }
        return a;
      }) as AttendanceRecord[];
      onUpdate(formatted);
    });
  },

  // Dedicated real-time snapshot subscription for 'routes' collection
  subscribeToRoutes(onUpdate: (routes: Route[]) => void): Unsubscribe {
    return this.subscribeToCollection('routes', (items: any[]) => {
      const formatted = items.map((r: any) => {
        if (r.destinationLab) {
          const coords = parseFirestoreGeoPoint(r.destinationLab.location) || {
            lat: r.destinationLab.lat,
            lng: r.destinationLab.lng
          };
          r.destinationLab.lat = coords.lat;
          r.destinationLab.lng = coords.lng;
        }
        if (Array.isArray(r.stops)) {
          r.stops = r.stops.map((s: any) => {
            const coords = parseFirestoreGeoPoint(s.location) || { lat: s.lat, lng: s.lng };
            return {
              ...s,
              lat: coords.lat,
              lng: coords.lng
            };
          });
        }
        return r as Route;
      });
      onUpdate(formatted);
    });
  },

  // Scoped Firestore query subscription: Client Tasks (strictly filtered to session.clientId or clientName)
  subscribeToClientTasks(clientId: string, clientNameOrCb?: string | ((tasks: PickupTask[]) => void), maybeCb?: (tasks: PickupTask[]) => void): Unsubscribe {
    let clientName: string | undefined;
    let onUpdate: ((tasks: PickupTask[]) => void) | undefined;

    if (typeof clientNameOrCb === 'function') {
      onUpdate = clientNameOrCb;
      clientName = undefined;
    } else {
      clientName = clientNameOrCb;
      onUpdate = maybeCb;
    }

    if (!clientId && !clientName) return () => {};
    if (!onUpdate) return () => {};

    let isCancelled = false;
    let pollInterval: number | null = null;
    let unsubSnapshot: Unsubscribe = () => {};
    const cleanName = (clientName || '').trim().toLowerCase();

    const fetchTasksViaPolling = async () => {
      try {
        // Scoped queries only -- an unconstrained list of 'tasks' is denied by firestore.rules.
        const [byClientId, byClientLabId] = await Promise.all([
          getDocs(query(collection(db, 'tasks'), where('clientId', '==', clientId))),
          getDocs(query(collection(db, 'tasks'), where('clientLabId', '==', clientId)))
        ]);
        if (isCancelled) return;
        const mergedDocs = new Map<string, any>();
        byClientId.forEach((d) => mergedDocs.set(d.id, d.data()));
        byClientLabId.forEach((d) => mergedDocs.set(d.id, d.data()));
        const snap = { forEach: (cb: (v: any) => void) => mergedDocs.forEach((data, id) => cb({ id, data: () => data })) };
        const list: PickupTask[] = [];
        snap.forEach((docSnap: any) => {
          const data = docSnap.data() as any;
          const dataName = (data.clientLabName || data.clientName || '').trim().toLowerCase();
          const isMatchClient =
            (clientId && (data.clientLabId === clientId || data.clientId === clientId)) ||
            (cleanName && dataName === cleanName);

          const isMatchingStatus = ['assigned', 'in_transit', 'started', 'at_stop', 'picked_up', 'upcoming', 'pending', 'completed', 'delivered'].includes(data.status);

          if (isMatchClient && isMatchingStatus) {
            const formatted = formatUnifiedTask(docSnap.id, data);
            list.push(formatted);
          }
        });
        onUpdate!(list);
      } catch (err: any) {
        console.warn('[CloudSync] Polling fallback for client tasks notice:', err?.message || err);
      }
    };

    const activateFallback = (reason: string) => {
      console.warn(`[CloudSync] Client tasks listener paused for ${clientId || clientName}, falling back to interval polling (15s):`, reason);
      fetchTasksViaPolling();
      if (!pollInterval) {
        pollInterval = window.setInterval(fetchTasksViaPolling, 15000);
      }
    };

    try {
      unsubSnapshot = this.subscribeMergedQueries(
        'tasks',
        [['clientId', clientId], ['clientLabId', clientId]],
        (docs) => {
          {
            if (isCancelled) return;
            if (pollInterval) {
              clearInterval(pollInterval);
              pollInterval = null;
            }
            const list: PickupTask[] = [];
            docs.forEach((docSnap: any) => {
              const data = docSnap.data as any;
              const dataName = (data.clientLabName || data.clientName || '').trim().toLowerCase();
              const isMatchClient =
                (clientId && (data.clientLabId === clientId || data.clientId === clientId)) ||
                (cleanName && dataName === cleanName);

              const isMatchingStatus = ['assigned', 'in_transit', 'started', 'at_stop', 'picked_up', 'upcoming', 'pending', 'completed', 'delivered'].includes(data.status);

              if (isMatchClient && isMatchingStatus) {
                const formatted = formatUnifiedTask(docSnap.id, data);
                list.push(formatted);
              }
            });
            onUpdate!(list);
          }
        },
        (err: any) => {
          if (isCancelled) return;
          activateFallback(err?.message || 'Listener error');
        }
      );
    } catch (e: any) {
      activateFallback(e?.message || 'Init error');
    }

    return () => {
      isCancelled = true;
      unsubSnapshot();
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    };
  },

  // Scoped Firestore query subscription: Client Routes (strictly filtered to session.clientId)
  subscribeToClientRoutes(clientId: string, onUpdate: (routes: Route[]) => void): Unsubscribe {
    if (!clientId) return () => {};
    let isCancelled = false;
    let pollInterval: number | null = null;
    let unsubSnapshot: Unsubscribe = () => {};

    const fetchRoutesViaPolling = async () => {
      try {
        const q = query(collection(db, 'routes'), where('clientId', '==', clientId));
        const snapshot = await getDocs(q);
        if (isCancelled) return;
        const list: Route[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as any;
          if (data.destinationLab) {
            const coords = parseFirestoreGeoPoint(data.destinationLab.location) || {
              lat: data.destinationLab.lat,
              lng: data.destinationLab.lng
            };
            data.destinationLab.lat = coords.lat;
            data.destinationLab.lng = coords.lng;
          }
          if (Array.isArray(data.stops)) {
            data.stops = data.stops.map((s: any) => {
              const coords = parseFirestoreGeoPoint(s.location) || { lat: s.lat, lng: s.lng };
              return { ...s, lat: coords.lat, lng: coords.lng };
            });
          }
          if (data.clientId === clientId) {
            list.push(data as Route);
          }
        });
        onUpdate(list);
      } catch (err: any) {
        console.warn('[CloudSync] Polling fallback for client routes error:', err?.message || err);
      }
    };

    const activateFallback = (reason: string) => {
      console.warn(`[CloudSync] Client routes listener paused for ${clientId}, falling back to interval polling (15s):`, reason);
      fetchRoutesViaPolling();
      if (!pollInterval) {
        pollInterval = window.setInterval(fetchRoutesViaPolling, 15000);
      }
    };

    try {
      const q = query(collection(db, 'routes'), where('clientId', '==', clientId));
      unsubSnapshot = onSnapshot(
        q,
        {
          next: (snapshot) => {
            if (isCancelled) return;
            if (pollInterval) {
              clearInterval(pollInterval);
              pollInterval = null;
            }
            const list: Route[] = [];
            snapshot.forEach((docSnap) => {
              const data = docSnap.data() as any;
              if (data.destinationLab) {
                const coords = parseFirestoreGeoPoint(data.destinationLab.location) || {
                  lat: data.destinationLab.lat,
                  lng: data.destinationLab.lng
                };
                data.destinationLab.lat = coords.lat;
                data.destinationLab.lng = coords.lng;
              }
              if (Array.isArray(data.stops)) {
                data.stops = data.stops.map((s: any) => {
                  const coords = parseFirestoreGeoPoint(s.location) || { lat: s.lat, lng: s.lng };
                  return { ...s, lat: coords.lat, lng: coords.lng };
                });
              }
              if (data.clientId === clientId) {
                list.push(data as Route);
              }
            });
            onUpdate(list);
          },
          error: (err) => {
            if (isCancelled) return;
            activateFallback(err?.message || 'Listener error');
          }
        }
      );
    } catch (e: any) {
      activateFallback(e?.message || 'Init error');
    }

    return () => {
      isCancelled = true;
      unsubSnapshot();
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    };
  },

  // Scoped Firestore query subscription: Rider Tasks (strictly filtered to active rider identity)
  subscribeToRiderTasks(riderId: string, riderPhone?: string, onUpdate?: (tasks: PickupTask[]) => void): Unsubscribe {
    if (!riderId || !onUpdate) return () => {};
    let isCancelled = false;
    let pollInterval: number | null = null;
    let unsubSnapshot: Unsubscribe = () => {};
    const cleanPhone = (riderPhone || '').replace(/\D/g, '');

    const fetchRiderTasksViaPolling = async () => {
      try {
        // Scoped queries only -- an unconstrained list of 'tasks' is denied by firestore.rules.
        const [byRiderId, byAssignedRiderId] = await Promise.all([
          getDocs(query(collection(db, 'tasks'), where('riderId', '==', riderId))),
          getDocs(query(collection(db, 'tasks'), where('assignedRiderId', '==', riderId)))
        ]);
        if (isCancelled) return;
        const mergedDocs = new Map<string, any>();
        byRiderId.forEach((d) => mergedDocs.set(d.id, d.data()));
        byAssignedRiderId.forEach((d) => mergedDocs.set(d.id, d.data()));
        const snap = { forEach: (cb: (v: any) => void) => mergedDocs.forEach((data, id) => cb({ id, data: () => data })) };
        const list: PickupTask[] = [];
        snap.forEach((docSnap: any) => {
          const data = docSnap.data() as any;
          const tPhone = (data.riderPhone || data.assignedRiderPhone || '').replace(/\D/g, '');
          const isMatchRider =
            data.riderId === riderId ||
            data.assignedRiderId === riderId ||
            (cleanPhone && cleanPhone.length >= 8 && tPhone.includes(cleanPhone.slice(-8))) ||
            (riderPhone && data.riderPhone === riderPhone);

          const isMatchingStatus = ['assigned', 'in_transit', 'started', 'at_stop', 'picked_up', 'upcoming', 'pending', 'completed', 'delivered'].includes(data.status);

          if (isMatchRider && isMatchingStatus) {
            const formatted = formatUnifiedTask(docSnap.id, data);
            list.push(formatted);
          }
        });
        onUpdate(list);
      } catch (err: any) {
        console.warn('[CloudSync] Polling fallback for rider tasks error:', err?.message || err);
      }
    };

    const activateFallback = (reason: string) => {
      console.warn(`[CloudSync] Rider tasks listener paused for ${riderId}, falling back to interval polling (15s):`, reason);
      fetchRiderTasksViaPolling();
      if (!pollInterval) {
        pollInterval = window.setInterval(fetchRiderTasksViaPolling, 15000);
      }
    };

    try {
      unsubSnapshot = this.subscribeMergedQueries(
        'tasks',
        [['riderId', riderId], ['assignedRiderId', riderId]],
        (docs) => {
          {
            if (isCancelled) return;
            if (pollInterval) {
              clearInterval(pollInterval);
              pollInterval = null;
            }
            const list: PickupTask[] = [];
            docs.forEach((docSnap: any) => {
              const data = docSnap.data as any;
              const tPhone = (data.riderPhone || data.assignedRiderPhone || '').replace(/\D/g, '');
              const isMatchRider =
                data.riderId === riderId ||
                data.assignedRiderId === riderId ||
                (cleanPhone && cleanPhone.length >= 8 && tPhone.includes(cleanPhone.slice(-8))) ||
                (riderPhone && data.riderPhone === riderPhone);

              const isMatchingStatus = ['assigned', 'in_transit', 'started', 'at_stop', 'picked_up', 'upcoming', 'pending', 'completed', 'delivered'].includes(data.status);

              if (isMatchRider && isMatchingStatus) {
                const formatted = formatUnifiedTask(docSnap.id, data);
                list.push(formatted);
              }
            });
            onUpdate(list);
          }
        },
        (err: any) => {
          if (isCancelled) return;
          activateFallback(err?.message || 'Listener error');
        }
      );
    } catch (e: any) {
      activateFallback(e?.message || 'Init error');
    }

    return () => {
      isCancelled = true;
      unsubSnapshot();
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    };
  },

  // Scoped Firestore query subscription: Rider Assigned Routes
  subscribeToRiderRoutes(
    riderId: string,
    riderPhone?: string,
    onUpdate?: (routes: Route[]) => void,
    assignedRouteIds?: string[]
  ): Unsubscribe {
    if (!riderId || !onUpdate) return () => {};
    let isCancelled = false;
    let pollInterval: number | null = null;
    let unsubSnapshot: Unsubscribe = () => {};
    const cleanPhone = (riderPhone || '').replace(/\D/g, '');

    const formatRouteDoc = (docSnap: any): Route | null => {
      const data = docSnap.data() as any;
      const rPhone = (data.assignedRiderPhone || data.riderPhone || '').replace(/\D/g, '');
      // Routes can be linked to a rider from EITHER side: the admin's Edit Rider screen writes
      // rider.assignedRouteIds, while dispatch stamps assignedRiderId onto the route itself. This
      // only ever checked the route side, so a route assigned through the rider's profile never
      // appeared in that rider's app -- it showed "No Assigned Pickups" while the admin console
      // (reading its local cache) showed the loop as assigned.
      const isAssignedFromRider = Array.isArray(assignedRouteIds) && assignedRouteIds.includes(docSnap.id);

      const isMatch =
        isAssignedFromRider ||
        data.assignedRiderId === riderId ||
        data.riderId === riderId ||
        (cleanPhone && cleanPhone.length >= 8 && rPhone.includes(cleanPhone.slice(-8))) ||
        (riderPhone && (data.assignedRiderPhone === riderPhone || data.riderPhone === riderPhone));

      if (isMatch) {
        if (data.destinationLab) {
          const coords = parseFirestoreGeoPoint(data.destinationLab.location) || {
            lat: data.destinationLab.lat,
            lng: data.destinationLab.lng
          };
          data.destinationLab.lat = coords.lat;
          data.destinationLab.lng = coords.lng;
        }
        if (Array.isArray(data.stops)) {
          data.stops = data.stops.map((s: any) => {
            const coords = parseFirestoreGeoPoint(s.location) || { lat: s.lat, lng: s.lng };
            return { ...s, lat: coords.lat, lng: coords.lng };
          });
        }
        return { id: docSnap.id, ...data } as Route;
      }
      return null;
    };

    const fetchRiderRoutesViaPolling = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'routes'));
        if (isCancelled) return;
        const list: Route[] = [];
        snapshot.forEach((docSnap) => {
          const route = formatRouteDoc(docSnap);
          if (route) list.push(route);
        });
        onUpdate(list);
      } catch (err: any) {
        console.warn('[CloudSync] Polling fallback for rider routes error:', err?.message || err);
      }
    };

    const activateFallback = (reason: string) => {
      console.warn(`[CloudSync] Rider routes listener paused for ${riderId}, falling back to interval polling (15s):`, reason);
      fetchRiderRoutesViaPolling();
      if (!pollInterval) {
        pollInterval = window.setInterval(fetchRiderRoutesViaPolling, 15000);
      }
    };

    try {
      unsubSnapshot = onSnapshot(
        collection(db, 'routes'),
        {
          next: (snapshot) => {
            if (isCancelled) return;
            if (pollInterval) {
              clearInterval(pollInterval);
              pollInterval = null;
            }
            const list: Route[] = [];
            snapshot.forEach((docSnap) => {
              const route = formatRouteDoc(docSnap);
              if (route) list.push(route);
            });
            onUpdate(list);
          },
          error: (err) => {
            if (isCancelled) return;
            activateFallback(err?.message || 'Listener error');
          }
        }
      );
    } catch (e: any) {
      activateFallback(e?.message || 'Init error');
    }

    return () => {
      isCancelled = true;
      unsubSnapshot();
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    };
  },

  // Scoped Firestore document subscription: Active Rider Document
  subscribeToRiderDocument(riderId: string, onUpdate: (rider: PickupBoy | null) => void): Unsubscribe {
    if (!riderId) return () => {};
    let isCancelled = false;
    let pollInterval: number | null = null;
    let unsubSnapshot: Unsubscribe = () => {};

    const fetchRiderDocViaPolling = async () => {
      try {
        const ref = doc(db, 'riders', riderId);
        const docSnap = await getDoc(ref);
        if (isCancelled) return;
        if (docSnap.exists()) {
          const data = docSnap.data() as any;
          if (data.currentLocation) {
            const coords = parseFirestoreGeoPoint(data.currentLocation.location) || {
              lat: data.currentLocation.lat,
              lng: data.currentLocation.lng
            };
            data.currentLocation.lat = coords.lat;
            data.currentLocation.lng = coords.lng;
          }
          onUpdate(data as PickupBoy);
        } else {
          onUpdate(null);
        }
      } catch (err: any) {
        console.warn('[CloudSync] Polling fallback for rider doc error:', err?.message || err);
      }
    };

    const activateFallback = (reason: string) => {
      console.warn(`[CloudSync] Rider doc listener paused for ${riderId}, falling back to interval polling (15s):`, reason);
      fetchRiderDocViaPolling();
      if (!pollInterval) {
        pollInterval = window.setInterval(fetchRiderDocViaPolling, 15000);
      }
    };

    try {
      const ref = doc(db, 'riders', riderId);
      unsubSnapshot = onSnapshot(
        ref,
        {
          next: (docSnap) => {
            if (isCancelled) return;
            if (pollInterval) {
              clearInterval(pollInterval);
              pollInterval = null;
            }
            if (docSnap.exists()) {
              const data = docSnap.data() as any;
              if (data.currentLocation) {
                const coords = parseFirestoreGeoPoint(data.currentLocation.location) || {
                  lat: data.currentLocation.lat,
                  lng: data.currentLocation.lng
                };
                data.currentLocation.lat = coords.lat;
                data.currentLocation.lng = coords.lng;
              }
              onUpdate(data as PickupBoy);
            } else {
              onUpdate(null);
            }
          },
          error: (err) => {
            if (isCancelled) return;
            activateFallback(err?.message || 'Listener error');
          }
        }
      );
    } catch (e: any) {
      activateFallback(e?.message || 'Init error');
    }

    return () => {
      isCancelled = true;
      unsubSnapshot();
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    };
  },

  // Real-time snapshot subscription for ALL trips in 'trips' collection (for Admin)
  subscribeToTrips(onUpdate: (trips: any[]) => void): Unsubscribe {
    try {
      return onSnapshot(
        collection(db, 'trips'),
        (snapshot) => {
          const list: any[] = [];
          snapshot.forEach((docSnap) => {
            const data = docSnap.data() as any;
            list.push({
              id: docSnap.id,
              ...data
            });
          });
          onUpdate(list);
        },
        (err) => {
          console.warn('[CloudSync] Trips collection subscription notice:', err?.message || err);
        }
      );
    } catch (e) {
      console.warn('[CloudSync] subscribeToTrips init exception:', e);
      return () => {};
    }
  },

  // Scoped real-time subscription for Rider Trips ('trips' collection)
  subscribeToRiderTrips(riderId: string, riderPhone?: string, onUpdate?: (trips: any[]) => void): Unsubscribe {
    if (!riderId || !onUpdate) return () => {};
    try {
      const cleanPhone = (riderPhone || '').replace(/\D/g, '');
      return this.subscribeMergedQueries(
        'trips',
        [['riderId', riderId], ['assignedRiderId', riderId]],
        (docs) => {
          const list: any[] = [];
          docs.forEach((docSnap: any) => {
            const data = docSnap.data as any;
            const tPhone = (data.riderPhone || '').replace(/\D/g, '');
            const isMatchRider =
              data.riderId === riderId ||
              data.assignedRiderId === riderId ||
              (cleanPhone && tPhone === cleanPhone) ||
              (riderPhone && data.riderPhone === riderPhone);

            const isMatchingStatus = ['assigned', 'in_transit', 'started', 'at_stop', 'picked_up', 'upcoming', 'pending', 'completed', 'delivered'].includes(data.status);

            if (isMatchRider && isMatchingStatus) {
              list.push({
                id: docSnap.id,
                ...data
              });
            }
          });
          onUpdate(list);
        },
        (err: any) => {
          console.warn(`[CloudSync] Rider trips subscription notice for ${riderId}:`, err?.message || err);
        }
      );
    } catch (e) {
      console.warn('[CloudSync] subscribeToRiderTrips init exception:', e);
      return () => {};
    }
  },

  // Scoped real-time subscription for Client Trips ('trips' collection)
  subscribeToClientTrips(
    clientId: string,
    clientEmailOrCb?: string | ((trips: any[]) => void),
    maybeCb?: (trips: any[]) => void
  ): Unsubscribe {
    let clientEmail: string | undefined;
    let onUpdate: ((trips: any[]) => void) | undefined;

    if (typeof clientEmailOrCb === 'function') {
      onUpdate = clientEmailOrCb;
      clientEmail = undefined;
    } else {
      clientEmail = clientEmailOrCb;
      onUpdate = maybeCb;
    }

    if (!clientId && !clientEmail) return () => {};
    if (!onUpdate) return () => {};

    try {
      const cleanEmail = (clientEmail || '').trim().toLowerCase();
      return this.subscribeMergedQueries(
        'trips',
        [['clientId', clientId], ['clientLabId', clientId]],
        (docs) => {
          const list: any[] = [];
          docs.forEach((docSnap: any) => {
            const data = docSnap.data as any;
            const docEmail = (data.clientEmail || '').trim().toLowerCase();
            const isMatchClient =
              (clientId && (data.clientId === clientId || data.clientLabId === clientId)) ||
              (cleanEmail && docEmail === cleanEmail);

            const isMatchingStatus = ['assigned', 'in_transit', 'started', 'at_stop', 'picked_up', 'upcoming', 'pending', 'completed', 'delivered'].includes(data.status);

            if (isMatchClient && isMatchingStatus) {
              list.push({
                id: docSnap.id,
                ...data
              });
            }
          });
          onUpdate!(list);
        },
        (err: any) => {
          console.warn(`[CloudSync] Client trips subscription notice for ${clientId || clientEmail}:`, err?.message || err);
        }
      );
    } catch (e) {
      console.warn('[CloudSync] subscribeToClientTrips init exception:', e);
      return () => {};
    }
  }
};
