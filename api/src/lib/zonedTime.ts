/**
 * Interpret a wall-clock datetime in an IANA time zone (timezone-convert).
 *
 * `new Date("2026-11-02T12:00")` reads an offset-less string in the SERVER's
 * zone (UTC on Render), so "12:00 in New York" used to convert as 12:00 UTC.
 * A string with an explicit offset or `Z` is an absolute instant and is used
 * as-is; otherwise its wall-clock fields are resolved in `timeZone` using the
 * zone's real offset at that moment (DST-aware, two-pass for transitions).
 *
 * Pure module — no imports, no side effects (unit-tested directly).
 * Throws RangeError for an unknown time zone (Intl's own validation).
 */
const HAS_OFFSET = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;
const ISO_LOCAL = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/;

function zoneOffsetMs(timeZone: string, instantMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instantMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instantMs / 1000) * 1000; // formatToParts drops milliseconds
}

export function zonedToDate(datetime: string, timeZone: string): Date | null {
  new Intl.DateTimeFormat("en-US", { timeZone }); // validate the zone (RangeError if unknown)
  const input = String(datetime).trim();
  if (HAS_OFFSET.test(input)) {
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
  }
  let wall: number;
  const m = ISO_LOCAL.exec(input);
  if (m) {
    const [, y, mo, d, h = "0", mi = "0", s = "0", ms = "0"] = m;
    wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, +ms.padEnd(3, "0"));
  } else {
    // Non-ISO text ("Nov 2 2026 12:00"): take its wall-clock fields as written.
    const loose = new Date(input);
    if (isNaN(loose.getTime())) return null;
    wall = Date.UTC(loose.getFullYear(), loose.getMonth(), loose.getDate(), loose.getHours(), loose.getMinutes(), loose.getSeconds(), loose.getMilliseconds());
  }
  if (isNaN(wall)) return null;
  const first = wall - zoneOffsetMs(timeZone, wall);
  return new Date(wall - zoneOffsetMs(timeZone, first));
}
