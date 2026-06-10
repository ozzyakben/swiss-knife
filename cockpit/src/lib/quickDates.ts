// A tiny deterministic date-phrase reader for quick-add. The model classifies
// the note; this parses the due date, so "remind me to X tomorrow" actually
// lands with a due date instead of a verbatim title that merely mentions one.
// Deliberately small: relative words and weekday names, nothing fuzzy.

import { utcNoonOfLocalDay } from "@/lib/dates";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Extract a due date from a quick note. Returns the parsed date (UTC noon of
 * the target local day) and the phrase that matched, or nulls. `now` is
 * injectable for tests. */
export function extractDueDate(
  text: string,
  now: Date = new Date()
): { dueDate: Date | null; matched: string | null } {
  const t = text.toLowerCase();

  const relative: [RegExp, number][] = [
    [/\bday after tomorrow\b/, 2],
    [/\btomorrow\b/, 1],
    [/\btonight\b/, 0],
    [/\btoday\b/, 0],
    [/\bnext week\b/, 7],
  ];
  for (const [re, days] of relative) {
    const m = t.match(re);
    if (m) return { dueDate: utcNoonOfLocalDay(now, days), matched: m[0] };
  }

  const inDays = t.match(/\bin (\d{1,2}) days?\b/);
  if (inDays) return { dueDate: utcNoonOfLocalDay(now, Number(inDays[1])), matched: inDays[0] };

  for (let i = 0; i < WEEKDAYS.length; i++) {
    const re = new RegExp(`\\b(?:on |by |next )?${WEEKDAYS[i]}\\b`);
    const m = t.match(re);
    if (m) {
      // Next occurrence of that weekday; "friday" said on a Friday means a week out.
      let ahead = (i - now.getDay() + 7) % 7;
      if (ahead === 0) ahead = 7;
      // "next friday" said mid-week skips this week's friday.
      if (m[0].startsWith("next ") && ahead < 7) ahead += 7;
      return { dueDate: utcNoonOfLocalDay(now, ahead), matched: m[0] };
    }
  }

  return { dueDate: null, matched: null };
}
