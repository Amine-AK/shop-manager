import { describe as group, expect, it } from "vitest";
import { approvalChain, refusalCascade } from "./approval-deps";
import { approvalIdFor, approvalRules, asRequest, describe, needsApproval, ruleOf, waitingByTarget, withPending } from "./approvals";
import { APPROVAL_RULES_KEY, applyOp, emptyLedger, type CaisseClose, type Ledger, type LedgerOp, type Sale, type StockItem } from "./ledger";
import { ledgerFor, opAllowed, stampOp } from "./permissions";
import type { Me } from "./roles";

const T0 = "2026-11-16T09:00:00.000Z";
let n = 0;
const op = (body: object, by = "Said"): LedgerOp => {
  n++;
  return { ...body, opId: `O-TEST${String(n).padStart(4, "0")}`, at: new Date(Date.parse(T0) + n * 1000).toISOString(), by, device: "📱 Android" } as LedgerOp;
};
const item = (id = "I-AAAA0001", over: Partial<StockItem> = {}): StockItem => ({
  id, item: "شارجور", category: "إكسسوارات", condition: "جديد", buyPrice: 40, sellPrice: 80, quantity: 10, serial: "", codes: [], notes: "", createdAt: T0, updatedAt: T0, ...over,
});
const sale: Sale = {
  id: "V-AAAA0001", ticket: "V-AAAA0001", date: "2026-11-16", time: "10:00", item: "شارجور", category: "إكسسوارات", stockId: "I-AAAA0001", quantity: 1,
  buyPrice: 40, listPrice: 80, sellPrice: 80, seller: "Said", notes: "", createdAt: T0, updatedAt: T0,
};
const close = (counted: number | null): CaisseClose => ({
  id: "K-AAAA0001", date: "2026-11-16", time: "20:00", clerk: "", cashSales: 80, expenses: 0, expensesNote: "", expected: 80, counted, notes: "", createdAt: T0,
});
const seller: Me = { id: "u", name: "Said", role: "seller", services: ["sell_cash", "cancel_sale", "stock", "caisse"], seeCost: false };
const owner: Me = { id: "o", name: "Mustapha", role: "owner", services: [], seeCost: true };

const base = (): Ledger => ({ ...emptyLedger(), stock: [item()], sales: [sale] });
const withRules = (l: Ledger, rules: object): Ledger => ({ ...l, settings: [{ key: APPROVAL_RULES_KEY, value: JSON.stringify(rules), updatedAt: T0 }] });
const move = (delta: number, id = "M-AAAA0001") => ({ type: "stock.adjust", move: { id, stockId: "I-AAAA0001", date: "2026-11-16", delta, reason: "ضايعة", seller: "", createdAt: T0 } });
/** A seller's change, as it reaches the sheet. */
const request = (l: Ledger, body: object) => {
  const o = op(body);
  expect(needsApproval(seller, o, l)).toBe(true);
  const r = applyOp(l, asRequest(o));
  expect(r.result).toBe("ok");
  return { ledger: r.ledger, id: approvalIdFor(o.opId) };
};
const decide = (l: Ledger, id: string, decision: "accept" | "refuse", reason = "") => applyOp(l, op({ type: "approval.decide", id, decision, reason }, "Mustapha"));

group("what waits for the owner", () => {
  it("a seller's sensitive changes, by default all five rules", () => {
    const l = base();
    expect(needsApproval(seller, op({ type: "sale.delete", id: sale.id }), l)).toBe(true);
    expect(needsApproval(seller, op({ type: "stock.update", id: "I-AAAA0001", base: T0, patch: { sellPrice: 90 } }), l)).toBe(true);
    expect(needsApproval(seller, op({ type: "stock.update", id: "I-AAAA0001", base: T0, patch: { buyPrice: 45 } }), l)).toBe(true);
    expect(needsApproval(seller, op(move(-1)), l)).toBe(true);
    expect(needsApproval(seller, op({ type: "stock.delete", id: "I-AAAA0001" }), l)).toBe(true);
    expect(needsApproval(seller, op({ type: "caisse.close", close: close(70) }), l)).toBe(true);
  });
  it("not the harmless ones, not the owner's", () => {
    const l = base();
    // Same price sent again, or only the name changed.
    expect(needsApproval(seller, op({ type: "stock.update", id: "I-AAAA0001", base: T0, patch: { sellPrice: 80, item: "شارجور سريع" } }), l)).toBe(false);
    expect(needsApproval(seller, op(move(5)), l)).toBe(false);
    expect(needsApproval(seller, op({ type: "caisse.close", close: close(80) }), l)).toBe(false);
    expect(needsApproval(seller, op({ type: "caisse.close", close: close(null) }), l)).toBe(false);
    expect(needsApproval(seller, op({ type: "sale.add", lines: [sale] }), l)).toBe(false);
    expect(needsApproval(owner, op({ type: "sale.delete", id: sale.id }), l)).toBe(false);
    expect(needsApproval({ ...seller, role: "stock" }, op(move(-1)), l)).toBe(false);
  });
  it("the owner turns rules off in the settings; a broken setting means all on", () => {
    const l = withRules(base(), { "sale-delete": false, "price-change": true });
    expect(needsApproval(seller, op({ type: "sale.delete", id: sale.id }), l)).toBe(false);
    expect(needsApproval(seller, op({ type: "stock.update", id: "I-AAAA0001", base: T0, patch: { sellPrice: 90 } }), l)).toBe(true);
    // Rules not in the setting stay on.
    expect(approvalRules(l)["stock-delete"]).toBe(true);
    const broken = { ...base(), settings: [{ key: APPROVAL_RULES_KEY, value: "{oops", updatedAt: T0 }] };
    expect(Object.values(approvalRules(broken)).every(Boolean)).toBe(true);
  });
  it("tells which rule a change falls under", () => {
    expect(ruleOf(op({ type: "stock.delete", id: "x" }), base())).toBe("stock-delete");
    expect(ruleOf(op({ type: "note.add" }), base())).toBe(null);
  });
});

group("a seller's price change", () => {
  it("leaves the sheet as it is, shows on screen (⏳), counts after acceptance", () => {
    const { ledger, id } = request(base(), { type: "stock.update", id: "I-AAAA0001", base: T0, patch: { sellPrice: 90 } });
    expect(ledger.stock[0].sellPrice).toBe(80);
    const view = withPending(ledger);
    expect(view.ledger.stock[0].sellPrice).toBe(90);
    expect(view.pendingIds.has("I-AAAA0001")).toBe(true);
    expect(describe(ledger.approvals[0].op, ledger)).toMatchObject({ icon: "🏷️", target: "شارجور", targetId: "I-AAAA0001" });
    expect(describe(ledger.approvals[0].op, ledger).text).toContain("ثمن البيع");
    const ok = decide(ledger, id, "accept");
    expect(ok.result).toBe("ok");
    expect(ok.ledger.stock[0].sellPrice).toBe(90);
    expect(ok.ledger.approvals[0]).toMatchObject({ status: "تقبل", decidedBy: "Mustapha" });
    expect(withPending(ok.ledger).pendingIds.size).toBe(0);
    // The same change sent twice is the same request.
    expect(applyOp(ledger, asRequest(ledger.approvals[0].op)).result).toBe("already");
  });
  it("refused: stays, with the reason, and is no longer shown", () => {
    const { ledger, id } = request(base(), { type: "stock.update", id: "I-AAAA0001", base: T0, patch: { sellPrice: 90 } });
    const r = decide(ledger, id, "refuse", "الثمن غلط");
    expect(r.ledger.approvals[0]).toMatchObject({ status: "ترفض", reason: "الثمن غلط" });
    expect(withPending(r.ledger).ledger.stock[0].sellPrice).toBe(80);
    expect(decide(r.ledger, id, "accept").result).toBe("invalid");
  });
  it("sales go on meanwhile: the waiting change still applies", () => {
    const { ledger, id } = request(base(), { type: "stock.update", id: "I-AAAA0001", base: T0, patch: { sellPrice: 90 } });
    const sold = applyOp(ledger, op({ type: "sale.add", lines: [{ ...sale, id: "V-BBBB0001", ticket: "V-BBBB0001" }] })).ledger;
    expect(withPending(sold).broken.size).toBe(0);
    expect(decide(sold, id, "accept").ledger.stock[0]).toMatchObject({ sellPrice: 90, quantity: 9 });
  });
});

group("other waiting changes", () => {
  it("a cancelled sale gives the product back only once accepted", () => {
    const { ledger, id } = request(base(), { type: "sale.delete", id: sale.id });
    expect(ledger.sales).toHaveLength(1);
    expect(withPending(ledger).ledger.sales).toHaveLength(0);
    const ok = decide(ledger, id, "accept");
    expect(ok.ledger.sales).toHaveLength(0);
    expect(ok.ledger.stock[0].quantity).toBe(11);
  });
  it("stock taken out and a drawer with a difference", () => {
    const m = request(base(), move(-2));
    expect(withPending(m.ledger).ledger.stock[0].quantity).toBe(8);
    expect(m.ledger.stock[0].quantity).toBe(10);
    const k = request(base(), { type: "caisse.close", close: close(70) });
    expect(k.ledger.closings).toHaveLength(0);
    expect(withPending(k.ledger).pendingIds.has("K-AAAA0001")).toBe(true);
    expect(describe(k.ledger.approvals[0].op, k.ledger)).toMatchObject({ icon: "🔒", amount: 10 });
  });
});

group("requests that depend on each other", () => {
  it("accepting a second edit of a product accepts the first; refusing the first refuses both, not the rest", () => {
    let l = base();
    const a = request(l, { type: "stock.update", id: "I-AAAA0001", base: T0, patch: { sellPrice: 90 } });
    l = a.ledger;
    const other = request(l, { type: "sale.delete", id: sale.id });
    l = other.ledger;
    const at = withPending(l).ledger.stock[0].updatedAt;
    const b = request(l, { type: "stock.update", id: "I-AAAA0001", base: at, patch: { buyPrice: 50 } });
    l = b.ledger;
    expect(withPending(l).ledger.stock[0]).toMatchObject({ sellPrice: 90, buyPrice: 50 });
    expect(waitingByTarget(l).get("I-AAAA0001")).toHaveLength(2);
    expect(approvalChain(l.approvals, l.approvals[2]).map((x) => x.id)).toEqual([a.id, b.id]);
    expect(refusalCascade(l.approvals, l.approvals[0]).map((x) => x.id)).toEqual([a.id, b.id]);
    const ok = decide(l, b.id, "accept");
    expect(ok.result).toBe("ok");
    expect(ok.ledger.stock[0]).toMatchObject({ sellPrice: 90, buyPrice: 50 });
    expect(ok.ledger.approvals.map((x) => x.status)).toEqual(["تقبل", "كتسنى", "تقبل"]);
    const no = decide(l, a.id, "refuse", "لا");
    expect(no.ledger.approvals.map((x) => x.status)).toEqual(["ترفض", "كتسنى", "ترفض"]);
  });
  it("a stock move doesn't tie later edits to it", () => {
    let l = base();
    const m = request(l, move(-1));
    l = m.ledger;
    const u = request(l, { type: "stock.update", id: "I-AAAA0001", base: T0, patch: { sellPrice: 90 } });
    l = u.ledger;
    expect(approvalChain(l.approvals, l.approvals[1]).map((x) => x.id)).toEqual([u.id]);
  });
  it("the owner changed the product meanwhile: the seller's edit no longer applies", () => {
    const u = request(base(), { type: "stock.update", id: "I-AAAA0001", base: T0, patch: { sellPrice: 90 } });
    const l = applyOp(u.ledger, op({ type: "stock.update", id: "I-AAAA0001", base: T0, patch: { notes: "owner" } }, "Mustapha")).ledger;
    expect(withPending(l).broken.has(u.id)).toBe(true);
    expect(decide(l, u.id, "accept").result).toBe("invalid");
  });
});

group("notes", () => {
  it("the seller writes a note on their waiting change; the owner writes one when accepting", () => {
    const { ledger, id } = request(base(), { type: "sale.delete", id: sale.id });
    const noted = applyOp(ledger, op({ type: "approval.note", id, note: "  الزبون رجعها " }));
    expect(noted.result).toBe("ok");
    expect(noted.ledger.approvals[0].note).toBe("الزبون رجعها");
    expect(applyOp(ledger, op({ type: "approval.note", id, note: "x" }, "Karim")).result).toBe("invalid");
    const ok = decide(noted.ledger, id, "accept", "مزيان");
    expect(ok.ledger.approvals[0]).toMatchObject({ status: "تقبل", note: "الزبون رجعها", reason: "مزيان" });
    expect(applyOp(ok.ledger, op({ type: "approval.note", id, note: "y" })).result).toBe("invalid");
    expect(opAllowed(seller, op({ type: "approval.note", id, note: "x" }))).toBe(true);
    expect(opAllowed(owner, op({ type: "approval.note", id, note: "x" }))).toBe(false);
  });
});

group("permissions", () => {
  it("the seller asks, only the owner decides; a request needs the right to make the change", () => {
    const del = op({ type: "sale.delete", id: sale.id });
    expect(opAllowed(seller, asRequest(del))).toBe(true);
    expect(opAllowed({ ...seller, services: [] }, asRequest(del))).toBe(false);
    expect(opAllowed(seller, op({ type: "approval.decide", id: "A-X", decision: "accept", reason: "" }))).toBe(false);
    expect(opAllowed(owner, op({ type: "approval.decide", id: "A-X", decision: "accept", reason: "" }))).toBe(true);
    // Only the approvable kinds of change can be wrapped.
    expect(opAllowed(seller, asRequest(op({ type: "sale.add", lines: [sale] })))).toBe(false);
    expect(applyOp(base(), asRequest(op({ type: "sale.add", lines: [sale] }))).result).toBe("invalid");
  });
  it("only the owner changes the rules", () => {
    const save = op({ type: "setting.save", key: APPROVAL_RULES_KEY, value: "{}" });
    expect(opAllowed(seller, save)).toBe(false);
    expect(opAllowed(owner, save)).toBe(true);
  });
  it("the server stamps the seller inside the request; costs stay hidden", () => {
    const upd = op({ type: "stock.update", id: "I-AAAA0001", base: T0, patch: { sellPrice: 90, buyPrice: 10 } });
    const stamped = stampOp(seller, asRequest(upd), base());
    expect(stamped.type === "approval.add" && stamped.op.by).toBe("Said");
    // A seller without costs can't change the cost, even through a request.
    expect(stamped.type === "approval.add" && stamped.op.type === "stock.update" && stamped.op.patch).toEqual({ sellPrice: 90 });
    const l = { ...base(), approvals: [{ id: "A-1", op: upd, status: "كتسنى" as const, note: "", reason: "", decidedBy: "", decidedAt: "", createdAt: T0, updatedAt: T0 }] };
    const seen = ledgerFor(seller, l).approvals[0].op;
    expect(seen.type === "stock.update" && seen.patch).toEqual({ sellPrice: 90 });
    expect(ledgerFor(owner, l).approvals[0].op).toEqual(upd);
    expect(ledgerFor({ ...seller, role: "stock" }, l).approvals).toHaveLength(0);
  });
});
