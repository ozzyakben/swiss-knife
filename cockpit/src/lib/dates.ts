// Due dates are calendar days, not instants. The DB column is a DateTime, so
// the convention is: date-only input ("YYYY-MM-DD") is stored at UTC NOON of
// that day. UTC noon renders as the same calendar day in timezones from
// UTC-11 to UTC+12 (UTC+13/+14 — Kiribati, NZ summer — would still shift;
// dueDayString() reads the ISO date part so app surfaces stay correct there).
// Legacy rows (stored at UTC midnight by `new Date("YYYY-MM-DD")`) still
// resolve to their intended day through dueDayString(), which reads the ISO
// date part instead of converting the instant to a local timezone.

/** Parse user-supplied due-date input. Date-only → UTC noon; otherwise any
 * parseable date string passes through. Returns null for invalid input. */
export function parseDueDateInput(s: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T12:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The calendar day ("YYYY-MM-DD") a stored due date means — read from the ISO
 * string, never via local-timezone conversion (that's the off-by-one bug). */
export function dueDayString(d: Date | string): string {
  return (typeof d === "string" ? d : d.toISOString()).slice(0, 10);
}

/** Today (or `now`) as a local-timezone "YYYY-MM-DD" string. */
export function localDayString(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Human display for a due date: locale-formatted, but built from the stored
 * calendar day's parts so the shown day never shifts with the viewer's TZ. */
export function formatDueDay(d: Date | string): string {
  const [y, m, day] = dueDayString(d).split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString();
}

/** A Date at UTC noon of the given LOCAL calendar day — the storage convention
 * for due dates computed from relative phrases ("tomorrow"). */
export function utcNoonOfLocalDay(now: Date, addDays = 0): Date {
  const base = new Date(now);
  base.setDate(base.getDate() + addDays);
  return new Date(Date.UTC(base.getFullYear(), base.getMonth(), base.getDate(), 12));
}
