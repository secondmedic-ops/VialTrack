/**
 * Canonical task-ID builder.
 *
 * The admin ("Dispatch"), client ("stat" pickup), and rider (fallback auto-create when starting
 * a stop before dispatch exists) flows each used to mint their own task IDs independently:
 *   - Admin's DispatchModal:      `task_${Date.now()}`               (random, per-click)
 *   - Rider's fallback creation:  `task-${date}-${routeId}-${slot}`  (deterministic)
 *
 * Because those two schemes never produce the same value for the same route+slot+day, dispatching
 * a round from the admin panel and then having a rider work that round created TWO separate
 * Firestore documents for what is really one logical job: the admin's dispatch doc sat untouched
 * at "pending", while all the rider's real progress (photos, vial counts, status) landed on a
 * second, parallel doc the admin/client dashboards never subscribed to — so completed pickups
 * never appeared to be reflected there.
 *
 * The fix: every caller that creates/looks up a task for a scheduled route round uses THIS same
 * deterministic formula, so whichever side (admin dispatching, or a rider starting a stop before
 * dispatch exists) touches a given route+slot+day first, they always resolve to one shared doc.
 */
export function buildCanonicalTaskId(routeId: string | undefined | null, timeSlot: string | undefined | null, dateStr: string): string {
  const cleanRouteId = (routeId || 'route').replace(/[^a-zA-Z0-9_-]/g, '');
  const cleanSlot = (timeSlot || '0900').replace(/[^a-zA-Z0-9]/g, '');
  return `task-${dateStr}-${cleanRouteId}-${cleanSlot}`;
}

/**
 * The date a task actually belongs to.
 *
 * WHY NOT JUST READ task.date: those fields are mutable and get rewritten by any full-document
 * sync. A round from 2026-09-04 was observed carrying date = 2026-09-12 and reappearing in
 * "today's" feed, because some write had refreshed the field. The ID, by contrast, is built once
 * by buildCanonicalTaskId and never changes, so `task-2026-09-04-...` is proof of the real date.
 *
 * The ID therefore wins whenever it carries one; the mutable fields are only a fallback for
 * documents created before this scheme (and for `scheduled-` pipeline placeholders, which have no
 * date in their ID and legitimately represent today).
 */
export function resolveTaskDate(task: any): string {
  const id = String(task?.id || '');
  const fromId = id.match(/^task-(\d{4}-\d{2}-\d{2})-/);
  if (fromId) return fromId[1];

  return (
    task?.scheduledDate ||
    task?.date ||
    (task?.createdAt ? String(task.createdAt).split('T')[0] : '')
  );
}
