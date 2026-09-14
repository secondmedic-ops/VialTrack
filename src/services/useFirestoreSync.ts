import { useEffect, useState, useRef } from 'react';
import {
  collection,
  query,
  onSnapshot,
  getDocs,
  Query,
  CollectionReference,
  DocumentData,
  Unsubscribe
} from 'firebase/firestore';
import { db } from './firebase';

interface UseFirestoreSyncOptions {
  pollingIntervalMs?: number; // Default 15000 (15s)
  enabled?: boolean;
}

/**
 * Custom hook for resilient real-time Firestore synchronization with auto-fallback to 15s polling
 * when RESOURCE_EXHAUSTED / Quota exceeded listener errors occur.
 */
export function useFirestoreSync<T = DocumentData>(
  collectionOrQuery: CollectionReference | Query | string | null | undefined,
  options: UseFirestoreSyncOptions = {}
) {
  const [data, setData] = useState<T[]>([]);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const { pollingIntervalMs = 15000, enabled = true } = options;

  useEffect(() => {
    if (!enabled || !collectionOrQuery) {
      return;
    }

    let isMounted = true;
    let unsubSnapshot: Unsubscribe = () => {};

    const targetQuery: Query | CollectionReference =
      typeof collectionOrQuery === 'string'
        ? collection(db, collectionOrQuery)
        : collectionOrQuery;

    const fetchViaPolling = async () => {
      try {
        const snap = await getDocs(targetQuery);
        if (!isMounted) return;
        const list: T[] = snap.docs.map((d) => ({ id: d.id, ...d.data() } as unknown as T));
        setData(list);
      } catch (err: any) {
        console.warn('[useFirestoreSync] Polling fetch error:', err?.message || err);
      }
    };

    const startPollingFallback = (reason: string) => {
      console.warn(`[useFirestoreSync] Real-time listener paused, switching to interval sync (${pollingIntervalMs / 1000}s):`, reason);
      setIsPolling(true);

      // Perform immediate polling fetch
      fetchViaPolling();

      // Setup 15-second interval
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
      pollTimerRef.current = window.setInterval(fetchViaPolling, pollingIntervalMs);
    };

    try {
      unsubSnapshot = onSnapshot(
        targetQuery as any,
        {
          next: (snapshot: any) => {
            if (!isMounted) return;
            setIsPolling(false);
            setError(null);
            const list: T[] = snapshot.docs.map((docSnap: any) => ({
              id: docSnap.id,
              ...docSnap.data()
            } as unknown as T));
            setData(list);
          },
          error: (err: any) => {
            if (!isMounted) return;
            setError(err);
            const errMsg = err?.message || '';
            const errCode = err?.code || '';
            const isQuotaError =
              errCode === 'resource-exhausted' ||
              errMsg.toLowerCase().includes('quota') ||
              errMsg.toLowerCase().includes('resource_exhausted') ||
              errMsg.toLowerCase().includes('rate limit');

            if (isQuotaError) {
              startPollingFallback('Quota exceeded / Resource exhausted');
            } else {
              console.warn('[useFirestoreSync] Listener notice:', errMsg);
              startPollingFallback(errMsg);
            }
          }
        }
      );
    } catch (err: any) {
      startPollingFallback(err?.message || 'Listener setup failure');
    }

    return () => {
      isMounted = false;
      unsubSnapshot();
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [collectionOrQuery, enabled, pollingIntervalMs]);

  return { data, isPolling, error };
}

export function useTasks(options?: UseFirestoreSyncOptions) {
  return useFirestoreSync('tasks', options);
}

export function useClients(options?: UseFirestoreSyncOptions) {
  return useFirestoreSync('clients', options);
}

export function useRiders(options?: UseFirestoreSyncOptions) {
  return useFirestoreSync('riders', options);
}

export function useRoutes(options?: UseFirestoreSyncOptions) {
  return useFirestoreSync('routes', options);
}

export function useAttendance(options?: UseFirestoreSyncOptions) {
  return useFirestoreSync('attendance', options);
}

export default useFirestoreSync;
