/**
 * Shared helpers for pickup time slots.
 *
 * Time values are ALWAYS stored in 24-hour "HH:mm" form (e.g. "09:45", "18:00") so that they
 * sort correctly, compare correctly, and stay stable across Firestore / localStorage. The
 * 12-hour "09:45 AM" form is presentation only and is produced by formatTimeLabel().
 *
 * Legacy records may already contain display strings like "10:00 AM" or "10:00 AM - 12:00 PM";
 * normalizeTimeValue() folds those back to "HH:mm" so old routes keep working.
 */

export interface PresetSlot {
  value: string; // "HH:mm"
  label: string; // operational name of the round
}

/** The fixed operational rounds offered as quick picks in the dispatch modal. */
export const PRESET_TIME_SLOTS: PresetSlot[] = [
  { value: '08:00', label: 'Early Loop' },
  { value: '09:00', label: 'Morning STAT' },
  { value: '10:00', label: 'Morning Regular' },
  { value: '12:00', label: 'Noon Pickup' },
  { value: '14:00', label: 'Post-Lunch' },
  { value: '16:00', label: 'Evening Intake' },
  { value: '18:00', label: 'Evening Batch' },
  { value: '20:00', label: 'Night Clearance' }
];

/**
 * Coerce any stored/typed time into canonical 24h "HH:mm".
 * Accepts "9:5", "09:45", "9:45 AM", "07:35 PM", "10:00 AM - 12:00 PM" (takes the start time).
 * Returns '' when nothing usable is found.
 */
export function normalizeTimeValue(raw: string | undefined | null): string {
  if (!raw) return '';
  const first = String(raw).split(/\s*[-–—]\s*/)[0].trim();
  const match = first.match(/^(\d{1,2})\s*:\s*(\d{1,2})\s*(am|pm|AM|PM)?/);
  if (!match) return '';

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const meridiem = (match[3] || '').toLowerCase();

  if (isNaN(hours) || isNaN(minutes) || minutes > 59) return '';

  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  if (hours > 23) return '';

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** "18:30" -> "06:30 PM". Returns '' for unusable input. */
export function formatTimeLabel(raw: string | undefined | null): string {
  const value = normalizeTimeValue(raw);
  if (!value) return '';
  const [h, m] = value.split(':').map((n) => parseInt(n, 10));
  const meridiem = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(hour12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${meridiem}`;
}

/** Operational name for a slot, or 'Custom' for anything the presets don't cover. */
export function getSlotName(raw: string | undefined | null): string {
  const value = normalizeTimeValue(raw);
  const preset = PRESET_TIME_SLOTS.find((s) => s.value === value);
  return preset ? preset.label : 'Custom';
}

/** Full dropdown label, e.g. "10:00 AM (Morning Regular)" or "07:35 AM (Custom)". */
export function formatSlotLabel(raw: string | undefined | null): string {
  const value = normalizeTimeValue(raw);
  if (!value) return '';
  return `${formatTimeLabel(value)} (${getSlotName(value)})`;
}

/** Merge any number of slot sources into one de-duplicated, chronologically sorted list. */
export function mergeTimeSlots(...groups: Array<Array<string | undefined | null> | undefined | null>): string[] {
  const set = new Set<string>();
  groups.forEach((group) => {
    (group || []).forEach((raw) => {
      const value = normalizeTimeValue(raw);
      if (value) set.add(value);
    });
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/**
 * Today's date as YYYY-MM-DD in the LOCAL timezone.
 *
 * new Date().toISOString() is UTC. In IST (UTC+5:30) that means everything between 00:00 and
 * 05:30 local time reports the previous day, so a rider on an early shift was shown yesterday's
 * routes and today's looked missing.
 */
export function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
