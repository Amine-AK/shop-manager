import { describe, expect, it } from "vitest";
import { applyOp, emptyLedger, nowParts, type LedgerOp, type Note } from "./ledger";
import { addDays } from "./sheet-logic";
import { dayLabel, dueReminders, eventText, isDue, isOpenRequest, noteEvents, notePages, presetTime, remindLabel, searchNotes, upcomingReminders } from "./notes";
import { opAllowed } from "./permissions";
import type { Me } from "./roles";

const note = (over: Partial<Note> = {}): Note => ({
  id: "N-AAAA0001", date: "2026-11-16", time: "10:00", kind: "طلب زبون", text: "بغا شارجور Type-C", customer: "Amine", phone: "0661234567",
  done: false, doneBy: "", doneAt: "", createdAt: "2026-11-16T09:00:00.000Z", updatedAt: "2026-11-16T09:00:00.000Z", author: "Said", ...over,
});
let n = 0;
const op = (body: object, by = "Said") => ({ ...body, opId: `O-N${++n}`, at: `2026-11-16T1${n}:00:00.000Z`, by, device: "📱" }) as unknown as LedgerOp;
const me = (role: Me["role"]): Me => ({ id: "x", name: "x", role, services: [], seeCost: false });

describe("notebook", () => {
  it("writes, ticks off (who, when), unticks", () => {
    let l = applyOp(emptyLedger(), op({ type: "note.add", note: note() })).ledger;
    expect(l.notes[0]).toMatchObject({ author: "Said", done: false });
    const t = applyOp(l, op({ type: "note.update", id: "N-AAAA0001", base: l.notes[0].updatedAt, patch: { done: true } }, "Mustapha"));
    expect(t.ledger.notes[0]).toMatchObject({ done: true, doneBy: "Mustapha", author: "Said" });
    l = t.ledger;
    const u = applyOp(l, op({ type: "note.update", id: "N-AAAA0001", base: l.notes[0].updatedAt, patch: { done: false } }));
    expect(u.ledger.notes[0]).toMatchObject({ done: false, doneBy: "", doneAt: "" });
    expect(applyOp(emptyLedger(), op({ type: "note.add", note: note({ text: "  " }) })).result).toBe("invalid");
  });
  it("every account writes; only the owner deletes", () => {
    expect(opAllowed(me("seller"), op({ type: "note.add", note: note() }))).toBe(true);
    expect(opAllowed(me("stock"), op({ type: "note.update", id: "N-1", base: "", patch: {} }))).toBe(true);
    expect(opAllowed(me("seller"), op({ type: "note.delete", id: "N-1" }))).toBe(false);
    expect(opAllowed(me("owner"), op({ type: "note.delete", id: "N-1" }))).toBe(true);
  });
  it("searches, filters and makes pages per day", () => {
    const list = [
      note(),
      note({ id: "N-2", kind: "ملاحظة", text: "الضو ديال الفترينة طافي", customer: "", phone: "", date: "2026-11-15", time: "18:00" }),
      note({ id: "N-3", done: true, text: "تيليكوموند LG", date: "2026-11-16", time: "12:00" }),
    ];
    expect(searchNotes(list, "").map((x) => x.id)).toEqual(["N-3", "N-AAAA0001", "N-2"]);
    expect(searchNotes(list, "", "requests").map((x) => x.id)).toEqual(["N-AAAA0001"]);
    expect(searchNotes(list, "", "done").map((x) => x.id)).toEqual(["N-3"]);
    expect(searchNotes(list, "+212 661").length).toBe(2);
    expect(searchNotes(list, "type-c").map((x) => x.id)).toEqual(["N-AAAA0001"]);
    expect(notePages(searchNotes(list, "")).map((p) => [p.date, p.notes.length])).toEqual([["2026-11-16", 2], ["2026-11-15", 1]]);
    expect(dayLabel("2026-11-16", "2026-11-16")).toBe("اليوم");
    expect(dayLabel("2026-11-15", "2026-11-16")).toBe("البارح");
    expect(dayLabel("2026-11-01", "2026-11-16")).toBe("01/11/2026");
    expect(isOpenRequest(list[0])).toBe(true);
  });
  it("tells what others did since the last look, never one's own changes", () => {
    const since = "2026-11-16T10:00:00.000Z";
    const list = [
      note({ id: "N-1", author: "Said", createdAt: "2026-11-16T11:00:00.000Z", updatedAt: "2026-11-16T11:00:00.000Z" }),
      note({ id: "N-2", author: "Mustapha", createdAt: "2026-11-16T11:30:00.000Z", updatedAt: "2026-11-16T11:30:00.000Z" }),
      note({ id: "N-3", author: "Mustapha", done: true, doneBy: "Karim", doneAt: "2026-11-16T12:00:00.000Z", updatedAt: "2026-11-16T12:00:00.000Z", by: "Karim" }),
      note({ id: "N-4", author: "Mustapha", updatedAt: "2026-11-16T12:30:00.000Z", by: "Said", kind: "ملاحظة", text: "الضو طافي" }),
      note({ id: "N-5", author: "Said", updatedAt: "2026-11-16T09:00:00.000Z", by: "Said" }),
    ];
    const ev = noteEvents(list, since, "Mustapha");
    expect(ev.map((e) => [e.note.id, e.kind, e.by])).toEqual([["N-4", "edit", "Said"], ["N-3", "done", "Karim"], ["N-1", "new", "Said"]]);
    expect(eventText(ev[2])).toBe("🙋 Said كتب طلب زبون: بغا شارجور Type-C");
    expect(eventText(ev[0])).toBe("✏️ Said بدل: الضو طافي");
    // Seen later: nothing new.
    expect(noteEvents(list, "2026-11-16T13:00:00.000Z", "Mustapha")).toEqual([]);
  });
  it("reminders: due once their time (shop time) has come, until ticked off", () => {
    const now = new Date("2026-11-19T13:00:00Z");
    const at = (minutes: number) => {
      const p = nowParts(new Date(now.getTime() + minutes * 60_000));
      return { remindDate: p.date, remindTime: p.time };
    };
    const list = [
      note({ id: "N-1", ...at(-30) }),
      note({ id: "N-2", ...at(30) }),
      note({ id: "N-3", ...at(-2000), done: true }),
      note({ id: "N-4" }),
      note({ id: "N-5", ...at(-3000) }),
    ];
    expect(dueReminders(list, now).map((n) => n.id)).toEqual(["N-5", "N-1"]);
    expect(upcomingReminders(list, now).map((n) => n.id)).toEqual(["N-2"]);
    expect(isDue(list[3], now)).toBe(false);
    const today = nowParts(now).date;
    expect(remindLabel({ remindDate: today, remindTime: "13:30" }, now)).toBe("⏰ اليوم 13:30");
    expect(remindLabel({ remindDate: addDays(today, 1), remindTime: "10:00" }, now)).toBe("⏰ غدا 10:00");
    const later = addDays(today, 6);
    expect(remindLabel({ remindDate: later, remindTime: "10:00" }, now)).toBe(`⏰ ${later.slice(8, 10)}/${later.slice(5, 7)} 10:00`);
  });
  it("quick choices for the reminder time", () => {
    const now = new Date("2026-11-19T13:00:00Z");
    const p = nowParts(now);
    const in1h = nowParts(new Date(now.getTime() + 3_600_000));
    expect(presetTime("1h", now)).toEqual({ remindDate: in1h.date, remindTime: in1h.time });
    expect(presetTime("tomorrow", now)).toEqual({ remindDate: addDays(p.date, 1), remindTime: "10:00" });
    expect(presetTime("week", now)).toEqual({ remindDate: addDays(p.date, 7), remindTime: "10:00" });
    const tonight = presetTime("tonight", now);
    expect(tonight.remindTime).toBe("18:00");
    expect(tonight.remindDate).toBe(p.time < "18:00" ? p.date : addDays(p.date, 1));
  });
  it("keeps the reminder through the sheet and checks it", () => {
    let l = applyOp(emptyLedger(), op({ type: "note.add", note: note({ remindDate: "2026-11-20", remindTime: "10:00" }) })).ledger;
    expect(l.notes[0].remindTime).toBe("10:00");
    expect(applyOp(emptyLedger(), op({ type: "note.add", note: note({ id: "N-BBBB0001", remindDate: "2026-11-20", remindTime: "" }) })).result).toBe("invalid");
    l = applyOp(l, op({ type: "note.update", id: "N-AAAA0001", base: l.notes[0].updatedAt, patch: { remindDate: "", remindTime: "" } })).ledger;
    expect(l.notes[0].remindDate).toBe("");
  });
});
