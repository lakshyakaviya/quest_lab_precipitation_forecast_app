/**
 * Formatting helpers.
 *
 * Forecast times are shown in **India Standard Time** because that is the timezone the
 * forecast is about, with UTC available alongside since the model run is named in UTC.
 */

export const IST_ZONE = "Asia/Kolkata";

const istDateTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const istDay = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});

const istTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const utcDateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export const formatIst = (d: Date) => istDateTime.format(d);
export const formatIstDay = (d: Date) => istDay.format(d);
export const formatIstTime = (d: Date) => istTime.format(d);
export const formatUtc = (d: Date) => `${utcDateTime.format(d)}Z`;

/** Millimetres, with precision that matches how much the number can be trusted. */
export function mm(value: number): string {
  if (value <= 0) return "0";
  if (value < 0.1) return "<0.1";
  if (value < 10) return value.toFixed(1);
  return Math.round(value).toLocaleString("en-IN");
}

/** Rain rate in mm/h. */
export function rate(value: number): string {
  if (value <= 0) return "0";
  if (value < 0.1) return "<0.1";
  return value < 10 ? value.toFixed(1) : Math.round(value).toString();
}

export function coords(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}°${ns}, ${Math.abs(lon).toFixed(2)}°${ew}`;
}

/** "T+36h" style lead-time label. */
export const leadTime = (hours: number) => `T+${hours}h`;

/**
 * A human gap between now and an instant, e.g. "in 18 h", "in 2 days", "3 h ago".
 *
 * This must be measured from the present, not from the forecast run. The run can be
 * many hours old by the time the page is opened, and anchoring to it produced
 * statements like "rain starts in 12 h" pointing at a time earlier the same morning.
 */
export function relativeTo(target: Date, now: Date = new Date()): string {
  const minutes = Math.round((target.getTime() - now.getTime()) / 60_000);
  if (minutes <= -60 * 24) return `${Math.round(-minutes / (60 * 24))} days ago`;
  if (minutes <= -60) return `${Math.round(-minutes / 60)} h ago`;
  if (minutes < 0) return "just now";
  if (minutes < 60) return "within the hour";
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours} h`;
  return `in ${Math.round(hours / 24)} days`;
}

/** How stale the data is, for the attribution bar. */
export function dataAge(generatedAt: Date, now = new Date()): string {
  const minutes = Math.max(
    0,
    Math.round((now.getTime() - generatedAt.getTime()) / 60_000),
  );
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
