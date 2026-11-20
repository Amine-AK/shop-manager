import { describe as group, expect, it } from "vitest";
import { approvalChain, refusalCascade } from "./approval-deps";
import { approvalIdFor, asRequest, describe, needsApproval, waitingByClient, withPending } from "./approvals";
import { applyOp, emptyLedger, summarize, type Client, type Ledger, type LedgerOp, type Payment, type Purchase } from "./ledger";
import { ledgerFor, opAllowed, stampOp } from "./permissions";
import type { Me } from "./roles";

const T0 = "2026-11-16T09:00:00.000Z";
let n = 0;
const op = (body: object, by = "Said"): LedgerOp => {
  n++;
  return { ...body, opId: `O-TEST${String(n).padStart(4, "0")}`, at: new Date(Date.parse(T0) + n * 1000).toISOString(), by, device: "📱 Android" } as LedgerOp;
};
const client = (id = "C-AAAA0001", over: Partial<Client> = {}): Client => ({
  id, name: "Amine", phone: "0661234567", installment: 200, period: "شهر", nextDueDate: "", notes: "", createdAt: T0, updatedAt: T0, ...over,
});
const purchase = (id = "S-AAAA0001", clientId = "C-AAAA0001", price = 1000): Purchase => ({ id, clientId, date: "2026-11-01", item: "تلاجة", price, notes: "", createdAt: T0, updatedAt: T0 });
const payment = (id = "P-AAAA0001", amount = 300, clientId = "C-AAAA0001"): Payment => ({
  id, clientId, purchaseId: "", date: "2026-11-16", time: "10:00", amount, kind: "دفعة", notes: "", createdAt: T0, updatedAt: T0,
});
const seller: Me = { id: "u", name: "Said", role: "seller", services: ["payment", "sell_credit", "client_add", "client_edit"], seeCost: false };
const owner: Me = { id: "o", name: "Mustapha", role: "owner", services: [], seeCost: true };

const base = (): Ledger => ({ ...emptyLedger(), clients: [client()], purchases: [purchase()] });
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
  it("every credit change of a seller, not the owner's, not cash sales", () => {
    const l = base();
    expect(needsApproval(seller, op({ type: "payment.add", payment: payment() }), l)).toBe(true);
    expect(needsApproval(seller, op({ type: "client.installment", id: "C-AAAA0001" }), l)).toBe(true);
    expect(needsApproval(owner, op({ type: "payment.add", payment: payment() }), l)).toBe(false);
    expect(needsApproval(seller, op({ type: "sale.add", lines: [{ type: "كاش" }], purchases: [] }), l)).toBe(false);
    expect(needsApproval(seller, op({ type: "sale.add", lines: [{ type: "كريدي" }], purchases: [] }), l)).toBe(true);
    expect(needsApproval(seller, op({ type: "repair.add" }), l)).toBe(false);
  });
});

group("a seller's payment", () => {
  it("leaves the sheet as it is, shows on screen (⏳), counts after acceptance", () => {
    const { ledger, id } = request(base(), { type: "payment.add", payment: payment() });
    expect(ledger.payments).toHaveLength(0);
    const view = withPending(ledger);
    expect(view.ledger.payments).toHaveLength(1);
    expect(view.pendingIds.has("P-AAAA0001")).toBe(true);
    expect(summarize(view.ledger, "2026-11-16")[0].remaining).toBe(700);
    expect(summarize(ledger, "2026-11-16")[0].remaining).toBe(1000);
    const ok = decide(ledger, id, "accept");
    expect(ok.result).toBe("ok");
    expect(ok.ledger.payments).toHaveLength(1);
    expect(ok.ledger.approvals[0]).toMatchObject({ status: "تقبل", decidedBy: "Mustapha" });
    expect(withPending(ok.ledger).pendingIds.size).toBe(0);
    // The same change sent twice is the same request.
    expect(applyOp(ledger, asRequest(ledger.approvals[0].op)).result).toBe("already");
  });
  it("refused: stays, with the reason, and is no longer shown", () => {
    const { ledger, id } = request(base(), { type: "payment.add", payment: payment() });
    const r = decide(ledger, id, "refuse", "الزبون ما خلصش");
    expect(r.ledger.approvals[0]).toMatchObject({ status: "ترفض", reason: "الزبون ما خلصش" });
    expect(r.ledger.payments).toHaveLength(0);
    expect(withPending(r.ledger).ledger.payments).toHaveLength(0);
    expect(decide(r.ledger, id, "accept").result).toBe("invalid");
  });
});

group("requests that depend on each other", () => {
  it("accepting a payment of a new customer accepts the customer and the sale first", () => {
    let l: Ledger = emptyLedger();
    const c = request(l, { type: "client.add", client: client("C-NEW00001") });
    l = c.ledger;
    const s = request(l, { type: "purchase.add", purchase: purchase("S-NEW00001", "C-NEW00001", 2000) });
    l = s.ledger;
    const p = request(l, { type: "payment.add", payment: { ...payment("P-NEW00001", 500, "C-NEW00001"), purchaseId: "S-NEW00001" } });
    l = p.ledger;
    expect(withPending(l).ledger.clients).toHaveLength(1);
    expect(waitingByClient(l).get("C-NEW00001")).toHaveLength(3);
    expect(describe(l.approvals[2].op, l)).toMatchObject({ client: "Amine", amount: 500 });
    const ok = decide(l, p.id, "accept");
    expect(ok.result).toBe("ok");
    expect(ok.ledger.clients).toHaveLength(1);
    expect(ok.ledger.purchases).toHaveLength(1);
    expect(ok.ledger.payments[0].purchaseId).toBe("S-NEW00001");
    expect(ok.ledger.approvals.every((a) => a.status === "تقبل")).toBe(true);
  });
  it("refusing the new customer refuses what was built on it, not the rest", () => {
    let l = base();
    const c = request(l, { type: "client.add", client: client("C-NEW00001") });
    l = c.ledger;
    const other = request(l, { type: "payment.add", payment: payment() });
    l = other.ledger;
    const p = request(l, { type: "payment.add", payment: payment("P-NEW00001", 500, "C-NEW00001") });
    l = p.ledger;
    const r = decide(l, c.id, "refuse", "غلط");
    expect(r.ledger.approvals.map((a) => a.status)).toEqual(["ترفض", "كتسنى", "ترفض"]);
    expect(refusalCascade(l.approvals, l.approvals[0]).map((a) => a.id)).toEqual([c.id, p.id]);
    expect(approvalChain(l.approvals, l.approvals[2]).map((a) => a.id)).toEqual([c.id, p.id]);
  });
  it("an edit of a waiting payment goes with it; a stale one is refused on acceptance", () => {
    let l = base();
    const p = request(l, { type: "payment.add", payment: payment() });
    l = p.ledger;
    const at = withPending(l).ledger.payments[0].updatedAt;
    const e = request(l, { type: "payment.update", id: "P-AAAA0001", base: at, patch: { amount: 400 } });
    l = e.ledger;
    expect(withPending(l).ledger.payments[0].amount).toBe(400);
    const ok = decide(l, e.id, "accept");
    expect(ok.result).toBe("ok");
    expect(ok.ledger.payments[0].amount).toBe(400);
    // The owner changed the customer meanwhile: the seller's edit no longer applies.
    let l2 = base();
    const u = request(l2, { type: "client.update", id: "C-AAAA0001", base: T0, patch: { notes: "x" } });
    l2 = applyOp(u.ledger, op({ type: "client.update", id: "C-AAAA0001", base: T0, patch: { notes: "owner" } }, "Mustapha")).ledger;
    expect(withPending(l2).broken.has(u.id)).toBe(true);
    expect(decide(l2, u.id, "accept").result).toBe("invalid");
  });
});

group("notes", () => {
  it("the seller writes a note on their waiting change; the owner writes one when accepting", () => {
    const { ledger, id } = request(base(), { type: "payment.add", payment: payment() });
    const noted = applyOp(ledger, op({ type: "approval.note", id, note: "  خلص نص والباقي السبت " }));
    expect(noted.result).toBe("ok");
    expect(noted.ledger.approvals[0].note).toBe("خلص نص والباقي السبت");
    // Not another seller's, not once decided.
    expect(applyOp(ledger, op({ type: "approval.note", id, note: "x" }, "Karim")).result).toBe("invalid");
    const ok = decide(noted.ledger, id, "accept", "مزيان، عيط عليه السبت");
    expect(ok.ledger.approvals[0]).toMatchObject({ status: "تقبل", note: "خلص نص والباقي السبت", reason: "مزيان، عيط عليه السبت" });
    expect(applyOp(ok.ledger, op({ type: "approval.note", id, note: "y" })).result).toBe("invalid");
    expect(opAllowed(seller, op({ type: "approval.note", id, note: "x" }))).toBe(true);
    expect(opAllowed(owner, op({ type: "approval.note", id, note: "x" }))).toBe(false);
  });
  it("the owner's note stays on the request decided, not on those accepted with it", () => {
    let l: Ledger = emptyLedger();
    const c = request(l, { type: "client.add", client: client("C-NEW00001") });
    l = c.ledger;
    const p = request(l, { type: "payment.add", payment: payment("P-NEW00001", 500, "C-NEW00001") });
    const ok = decide(p.ledger, p.id, "accept", "واخا");
    expect(ok.ledger.approvals.map((a) => a.reason)).toEqual(["", "واخا"]);
  });
});

group("permissions", () => {
  it("the seller asks, only the owner decides", () => {
    const pay = op({ type: "payment.add", payment: payment() });
    expect(opAllowed(seller, asRequest(pay))).toBe(true);
    expect(opAllowed({ ...seller, services: [] }, asRequest(pay))).toBe(false);
    expect(opAllowed(seller, op({ type: "approval.decide", id: "A-X", decision: "accept", reason: "" }))).toBe(false);
    expect(opAllowed(owner, op({ type: "approval.decide", id: "A-X", decision: "accept", reason: "" }))).toBe(true);
    expect(opAllowed(seller, asRequest(op({ type: "repair.add" })))).toBe(false);
  });
  it("the server stamps the seller inside the request; costs stay hidden", () => {
    const sale = op({ type: "sale.add", lines: [{ id: "V-1", type: "كريدي", buyPrice: 500, seller: "x" }], purchases: [] });
    const stamped = stampOp(seller, asRequest(sale), base());
    expect(stamped.type === "approval.add" && stamped.op.type === "sale.add" && stamped.op.lines[0].seller).toBe("Said");
    const l = { ...base(), approvals: [{ id: "A-1", op: sale, status: "كتسنى" as const, note: "", reason: "", decidedBy: "", decidedAt: "", createdAt: T0, updatedAt: T0 }] };
    const seen = ledgerFor(seller, l).approvals[0].op;
    expect(seen.type === "sale.add" && seen.lines[0].buyPrice).toBe(null);
    expect(ledgerFor({ ...seller, role: "stock" }, l).approvals).toHaveLength(0);
  });
});
