import { describe, expect, it } from "vitest";
import { isShopCode, newShopCode } from "./barcode";
import { applyOp, EMPTY_LEDGER, type LedgerOp, type Repair, type StockItem } from "./ledger";
import { ledgerToRows, rowsToLedger } from "./ledger-sheet";
import { ledgerFor, opAllowed } from "./permissions";
import { cashDay } from "./shop";
import { ownerForPhone, deliveredMessage, repairProfit, repairReceived, newRepairCode, readyMessage, receivedMessage, repairByCode, repairRemaining, searchRepairs } from "./repairs";
import type { Me } from "./roles";

const T0 = "2026-11-15T09:00:00.000Z";
let n = 0;
const op = (body: object) => ({ ...body, opId: `O-REP${String(++n).padStart(5, "0")}`, at: `2026-11-15T10:${String(n).padStart(2, "0")}:00.000Z`, by: "المالك", device: "PC" }) as LedgerOp;
const repair = (over: Partial<Repair> = {}): Repair => ({
  id: "R-PHONE001", code: newShopCode("R-PHONE001", new Set()), date: "2026-11-15", time: "10:30", owner: "Amine jari", phone: "0661234567",
  device: "Samsung A15", problem: "الشاشة مهرسة", price: 600, advance: 200, status: "مستلم", notes: "", photo: "",
  deliveredDate: "", deliveredTime: "", paid: 0, cost: 0, createdAt: T0, updatedAt: T0, ...over,
});

describe("repairs", () => {
  it("records a repair, changes its status, deletes it, and keeps it through the sheet", () => {
    let l = applyOp(EMPTY_LEDGER, op({ type: "repair.add", repair: repair() })).ledger;
    expect(l.repairs[0]).toMatchObject({ owner: "Amine jari", by: "المالك", origin: "PC" });
    const base = l.repairs[0].updatedAt;
    l = applyOp(l, op({ type: "repair.update", id: "R-PHONE001", base, patch: { status: "واجد" } })).ledger;
    expect(l.repairs[0].status).toBe("واجد");
    expect(applyOp(l, op({ type: "repair.update", id: "R-PHONE001", base, patch: { status: "تسلم" } })).result).toBe("conflict");
    const rows = ledgerToRows(l);
    expect(rows.repairs.get("R-PHONE001")![10]).toBe(400); // «الباقي» column
    expect(rowsToLedger({ repairs: [...rows.repairs.values()] }).repairs).toEqual(l.repairs);
    expect(applyOp(l, op({ type: "repair.delete", id: "R-PHONE001" })).ledger.repairs).toEqual([]);
  });

  it("refuses a repair without owner or device, a bad price, a too big photo, or a barcode already used", () => {
    expect(applyOp(EMPTY_LEDGER, op({ type: "repair.add", repair: repair({ owner: " " }) })).result).toBe("invalid");
    expect(applyOp(EMPTY_LEDGER, op({ type: "repair.add", repair: repair({ device: "" }) })).result).toBe("invalid");
    expect(applyOp(EMPTY_LEDGER, op({ type: "repair.add", repair: repair({ advance: -5 }) })).result).toBe("invalid");
    expect(applyOp(EMPTY_LEDGER, op({ type: "repair.add", repair: repair({ photo: "data:image/jpeg;base64," + "A".repeat(33_000) }) })).result).toBe("invalid");
    const product = { id: "I-PROD0001", item: "x", category: "", condition: "جديد", buyPrice: 0, sellPrice: 1, quantity: 1, serial: repair().code, codes: [], notes: "", createdAt: T0, updatedAt: T0 } as StockItem;
    const withProduct = applyOp(EMPTY_LEDGER, op({ type: "stock.add", item: product })).ledger;
    expect(applyOp(withProduct, op({ type: "repair.add", repair: repair() })).result).toBe("invalid");
  });

  it("gives each repair a barcode no product or other repair has", () => {
    const l = applyOp(EMPTY_LEDGER, op({ type: "repair.add", repair: repair() })).ledger;
    const code = newRepairCode("R-PHONE001", l);
    expect(isShopCode(code)).toBe(true);
    expect(code).not.toBe(l.repairs[0].code);
    expect(repairByCode(l.repairs, ` ${l.repairs[0].code} `)?.id).toBe("R-PHONE001");
  });

  it("finds repairs by owner, phone in any format, device or barcode, newest first", () => {
    const a = repair();
    const b = repair({ id: "R-WASH0001", code: "2000000000022", owner: "مريم", phone: "+212 662 345 678", device: "Machine à laver Candy", date: "2026-11-16" });
    expect(searchRepairs([a, b], "").map((r) => r.id)).toEqual(["R-WASH0001", "R-PHONE001"]);
    expect(searchRepairs([a, b], "0662345678").map((r) => r.id)).toEqual(["R-WASH0001"]);
    expect(searchRepairs([a, b], "samsung").map((r) => r.id)).toEqual(["R-PHONE001"]);
    expect(searchRepairs([a, b], "مريم").map((r) => r.id)).toEqual(["R-WASH0001"]);
    expect(searchRepairs([a, b], "2000000000022").map((r) => r.id)).toEqual(["R-WASH0001"]);
  });

  it("writes the WhatsApp messages with what is left to pay", () => {
    expect(repairRemaining(repair())).toBe(400);
    const got = receivedMessage(repair());
    expect(got).toContain("📥 توصلنا بالجهاز ديالكم «Samsung A15» نهار 15/11/2026 على 10:30.");
    expect(got).toContain("💵 التسبيق: 200 درهم");
    expect(got).toContain("⏳ الباقي: *400 درهم*");
    expect(readyMessage(repair({ status: "واجد" }))).toContain("💰 الباقي للخلاص: *400 درهم*");
    expect(readyMessage(repair({ advance: 600 }))).toContain("💰 الإصلاح خالص.");
  });

  it("is a separate service: only accounts with «الإصلاح» see and change repairs", () => {
    const owner: Me = { id: "U1", name: "المالك", role: "owner", services: [], seeCost: true };
    const tech: Me = { id: "U2", name: "Yassine", role: "seller", services: ["repairs"], seeCost: false };
    const cashier: Me = { id: "U3", name: "Karim", role: "seller", services: ["sell_cash"], seeCost: false };
    const stockman: Me = { id: "U4", name: "Said", role: "stock", services: [], seeCost: false };
    const add = op({ type: "repair.add", repair: repair() });
    expect([owner, tech, cashier, stockman].map((m) => opAllowed(m, add))).toEqual([true, true, false, false]);
    const l = applyOp(EMPTY_LEDGER, add).ledger;
    expect([owner, tech, cashier, stockman].map((m) => ledgerFor(m, l).repairs.length)).toEqual([1, 1, 0, 0]);
  });

  it("puts repair advances in the day's cash drawer", () => {
    const l = applyOp(EMPTY_LEDGER, op({ type: "repair.add", repair: repair() })).ledger;
    const day = cashDay(l, "2026-11-15");
    expect(day.repairs.map((r) => [r.repairId, r.kind, r.amount])).toEqual([["R-PHONE001", "advance", 200]]);
    expect(day.totals).toMatchObject({ repairs: 200, incoming: 200 });
    expect(cashDay(l, "2026-11-16").totals.repairs).toBe(0);
    // Recorded today, but dated 2 days earlier: listed as backdated, not counted today.
    const late = applyOp(EMPTY_LEDGER, op({ type: "repair.add", repair: repair({ date: "2026-11-13", createdAt: "2026-11-15T09:00:00.000Z" }) })).ledger;
    expect(cashDay(late, "2026-11-15").backdated.map((b) => [b.kind, b.amount])).toEqual([["repair", 200]]);
  });

  it("gives whoever closes the drawer the repair advances, without the customer's details", () => {
    const cashier: Me = { id: "U5", name: "Hind", role: "seller", services: ["caisse"], seeCost: false };
    const l = applyOp(EMPTY_LEDGER, op({ type: "repair.add", repair: repair({ photo: "data:image/jpeg;base64,AAAA" }) })).ledger;
    const seen = ledgerFor(cashier, l).repairs;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ advance: 200, device: "Samsung A15", owner: "", phone: "", problem: "", photo: "" });
  });

  it("records when the device was collected, the final price, what was paid then and the shop's costs", () => {
    let l = applyOp(EMPTY_LEDGER, op({ type: "repair.add", repair: repair() })).ledger;
    // Collected without a date: refused.
    const base = l.repairs[0].updatedAt;
    expect(applyOp(l, op({ type: "repair.update", id: "R-PHONE001", base, patch: { status: "تسلم" } })).result).toBe("invalid");
    // The estimate (600) was wrong: 700 in the end, 500 paid when collecting, 150 of parts paid by the shop.
    const deliver = { status: "تسلم", deliveredDate: "2026-11-18", deliveredTime: "17:20", price: 700, paid: 500, cost: 150 };
    l = applyOp(l, op({ type: "repair.update", id: "R-PHONE001", base, patch: deliver })).ledger;
    const r = l.repairs[0];
    expect([repairRemaining(r), repairReceived(r), repairProfit(r)]).toEqual([0, 700, 550]);
    // The 500 count in the drawer on the day it was collected, the advance on the day it was brought.
    expect(cashDay(l, "2026-11-18").repairs.map((x) => [x.kind, x.amount, x.time])).toEqual([["paid", 500, "17:20"]]);
    expect(cashDay(l, "2026-11-15").totals.repairs).toBe(200);
    expect(deliveredMessage(r)).toContain("🤝 خديتو الجهاز ديالكم «Samsung A15» نهار 18/11/2026 على 17:20. شكراً.");
    expect(deliveredMessage(r)).toContain("💵 خلصتو عند التسليم: 500 درهم");
    expect(deliveredMessage(r)).toContain("✅ الإصلاح خالص.");
    const rows = ledgerToRows(l);
    expect(rowsToLedger({ repairs: [...rows.repairs.values()] }).repairs).toEqual(l.repairs);
  });

  it("finds the owner's name from the phone number, in any format", () => {
    const T = "2026-11-01T00:00:00.000Z";
    const client = { id: "C-AMINE001", name: "Amine jari", phone: "0661234567", phones: ["0700112233"], installment: 0, period: "", nextDueDate: "", notes: "", createdAt: T, updatedAt: T };
    const ledger = { clients: [client], repairs: [repair({ owner: "مريم", phone: "+212 662 345 678", createdAt: T })] } as never;
    expect(ownerForPhone("0661234567", ledger)).toEqual({ name: "Amine jari", from: "client" });
    expect(ownerForPhone("+212 661-23-45-67", ledger)).toEqual({ name: "Amine jari", from: "client" });
    expect(ownerForPhone("00212700112233", ledger)).toEqual({ name: "Amine jari", from: "client" }); // their other number
    expect(ownerForPhone("0662345678", ledger)).toEqual({ name: "مريم", from: "repair" }); // not a customer, came for a repair
    expect(ownerForPhone("06612", ledger)).toBeNull(); // not complete yet
    expect(ownerForPhone("0699999999", ledger)).toBeNull();
  });
});
