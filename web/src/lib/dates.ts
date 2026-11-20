// Shared rules: amounts read from cells, dates in shop time, phone numbers.

export const TIMEZONE = "Africa/Casablanca";

/** Every number in the text ("1 500,50" → [1500.5]). */
export function extractNumbers(value: unknown): number[] {
  const text = String(value ?? "")
    .replace(/[  ]/g, "")
    .replace(/,/g, ".");
  return (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** Sum of every number in a cell (a cell typed by hand may hold "500 + 300"). */
export function parseSum(value: unknown): number {
  return extractNumbers(value).reduce((a, b) => a + b, 0);
}

/** International form without '+', e.g. 212661234567. */
export function formatMoroccoPhone(phone: string): string {
  let d = String(phone ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("212")) return d;
  if (d.startsWith("0")) return "212" + d.slice(1);
  if (d.length === 9) return "212" + d;
  return d;
}

export function isValidPhone(intl: string): boolean {
  return /^\d{11,15}$/.test(intl);
}

// ---------------------------------------------------------------- dates

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function todayISO(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Read a date cell: yyyy-mm-dd, dd/mm/yyyy, dd-mm-yyyy or a Sheets serial number. */
export function parseSheetDate(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  let m = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  let iso = "";
  if (m) iso = `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  else if ((m = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/))) iso = `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  else if (/^\d{5}$/.test(text)) iso = addDays("1899-12-30", Number(text));
  return isISODate(iso) ? iso : "";
}
