// الكناش: the shop's notebook. Anything to remember, or what a customer asked
// for («جيب ليا شارجور Type-C»), written by any account and ticked off when done.
// Pure rules, shared by the screen (components/NotesView.tsx) and the tests.

import { nowParts, type Note } from "./ledger";
import { displayDate } from "./receipt";
import { addDays } from "./sheet-logic";
import { normalizeText } from "./shop";

/** A customer's request still to do. */
export const isOpenRequest = (n: Pick<Note, "kind" | "done">) => n.kind === "طلب زبون" && !n.done;

export type NoteFilter = "all" | "requests" | "reminders" | "open" | "done";

const digits = (s: string) => s.replace(/\D/g, "").replace(/^(00)?212/, "0");

/** Search in the text, the customer and the phone (any format); then the filter. Newest first. */
export function searchNotes(notes: Note[], query: string, filter: NoteFilter = "all"): Note[] {
  const q = normalizeText(query);
  const qd = digits(query);
  return notes
    .filter((n) => {
      if (filter === "requests" && !isOpenRequest(n)) return false;
      if (filter === "reminders" && (n.done || !remindKey(n))) return false;
      if (filter === "open" && n.done) return false;
      if (filter === "done" && !n.done) return false;
      if (!q) return true;
      return [n.text, n.customer, n.author].some((x) => normalizeText(x).includes(q)) || (qd.length >= 3 && digits(n.phone).includes(qd));
    })
    .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`) || b.createdAt.localeCompare(a.createdAt));
}

/** «اليوم», «البارح», else the date. */
export function dayLabel(date: string, today: string): string {
  if (date === today) return "اليوم";
  if (date === addDays(today, -1)) return "البارح";
  return displayDate(date);
}

/** Notes in pages, one per day, in the order given. */
export function notePages(notes: Note[]): { date: string; notes: Note[] }[] {
  const pages: { date: string; notes: Note[] }[] = [];
  for (const n of notes) {
    const last = pages[pages.length - 1];
    if (last?.date === n.date) last.notes.push(n);
    else pages.push({ date: n.date, notes: [n] });
  }
  return pages;
}

/** Something another account did in the notebook (a notification). */
export interface NoteEvent {
  note: Note;
  kind: "new" | "done" | "edit";
  by: string;
  /** ISO time of the change. */
  at: string;
  /** Same change, same key: announced once. */
  key: string;
}

/**
 * What others did in the notebook after `since` (ISO), newest first: a new line,
 * a line ticked off, or a line changed. The account's own changes are not news.
 */
export function noteEvents(notes: Note[], since: string, me: string): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const n of notes) {
    const ev = (kind: NoteEvent["kind"], by: string, at: string) => out.push({ note: n, kind, by, at, key: `${n.id}@${n.updatedAt}` });
    if (n.createdAt > since && n.author && n.author !== me) ev("new", n.author, n.createdAt);
    else if (n.done && n.doneAt > since && n.doneBy && n.doneBy !== me) ev("done", n.doneBy, n.doneAt);
    else if (n.updatedAt > since && n.by && n.by !== me) ev("edit", n.by, n.updatedAt);
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** «✍️ Said كتب فالكناش: …» */
export function eventText(e: NoteEvent): string {
  const what = e.kind === "new" ? (e.note.kind === "طلب زبون" ? "كتب طلب زبون" : "كتب فالكناش") : e.kind === "done" ? "دار" : "بدل";
  const icon = e.kind === "new" ? (e.note.kind === "طلب زبون" ? "🙋" : "✍️") : e.kind === "done" ? "✓" : "✏️";
  const text = e.note.text.length > 80 ? `${e.note.text.slice(0, 80)}…` : e.note.text;
  return `${icon} ${e.by} ${what}: ${text}`;
}

// ---------------------------------------------------------------- reminders (⏰)
// A line can carry a reminder time (shop time). From then on, until it is ticked
// off, it is «due»: shown on top of the notebook, in a red bar over the app, and
// as a notification. Times are compared as shop-time text "yyyy-mm-dd HH:mm".

/** "yyyy-mm-dd HH:mm" of the reminder, "" when none. */
export const remindKey = (n: Pick<Note, "remindDate" | "remindTime">) => (n.remindDate && n.remindTime ? `${n.remindDate} ${n.remindTime}` : "");

/** Now in shop time, as "yyyy-mm-dd HH:mm". */
export function shopNow(now = new Date()): string {
  const p = nowParts(now);
  return `${p.date} ${p.time}`;
}

/** Its time has come and it isn't done yet. */
export const isDue = (n: Note, now = new Date()) => !n.done && remindKey(n) !== "" && remindKey(n) <= shopNow(now);

/** Reminders whose time has come, oldest first. */
export const dueReminders = (notes: Note[], now = new Date()) => notes.filter((n) => isDue(n, now)).sort((a, b) => remindKey(a).localeCompare(remindKey(b)));

/** Reminders still to come, soonest first. */
export const upcomingReminders = (notes: Note[], now = new Date()) => {
  const at = shopNow(now);
  return notes.filter((n) => !n.done && remindKey(n) > at).sort((a, b) => remindKey(a).localeCompare(remindKey(b)));
};

export type RemindPreset = "1h" | "3h" | "tonight" | "tomorrow" | "3days" | "week";

export const REMIND_PRESETS: { value: RemindPreset; label: string }[] = [
  { value: "1h", label: "بعد ساعة" },
  { value: "3h", label: "بعد 3 سوايع" },
  { value: "tonight", label: "العشية 18:00" },
  { value: "tomorrow", label: "غدا 10:00" },
  { value: "3days", label: "بعد 3 أيام" },
  { value: "week", label: "السيمانة الجاية" },
];

/** The reminder time of a quick choice, from now (shop time). */
export function presetTime(p: RemindPreset, now = new Date()): { remindDate: string; remindTime: string } {
  if (p === "1h" || p === "3h") {
    const t = nowParts(new Date(now.getTime() + (p === "1h" ? 1 : 3) * 3_600_000));
    return { remindDate: t.date, remindTime: t.time };
  }
  const today = nowParts(now);
  if (p === "tonight") {
    // Already past 18:00: tomorrow evening.
    return { remindDate: today.time < "18:00" ? today.date : addDays(today.date, 1), remindTime: "18:00" };
  }
  const days = p === "tomorrow" ? 1 : p === "3days" ? 3 : 7;
  return { remindDate: addDays(today.date, days), remindTime: "10:00" };
}

/** «⏰ اليوم 15:00», «⏰ غدا 10:00», «⏰ 25/11 10:00». */
export function remindLabel(n: Pick<Note, "remindDate" | "remindTime">, now = new Date()): string {
  if (!remindKey(n)) return "";
  const today = nowParts(now).date;
  const day = n.remindDate === today ? "اليوم" : n.remindDate === addDays(today, 1) ? "غدا" : n.remindDate === addDays(today, -1) ? "البارح" : `${n.remindDate!.slice(8, 10)}/${n.remindDate!.slice(5, 7)}`;
  return `⏰ ${day} ${n.remindTime}`;
}
