import { describe, expect, it } from "vitest";
import { claimsByClient, claimMessage, isLate, lateClaims, openClaimFor, parseContacts, reminderMessage, searchClaims, sinceText, soldItems } from "./claims";
import { applyOp, emptyLedger, type Claim, type LedgerOp } from "./ledger";
import { opAllowed, ledgerFor } from "./permissions";
import type { Me } from "./roles";

const claim = (over: Partial<Claim> = {}): Claim => ({
  id: "W-ABCD1234",
  date: "2026-11-10",
  time: "10:00",
  customer: "Amine jari",
  phone: "0661234567",
  item: "تلاجة Samsung",
  saleDate: "2026-10-01",
  company: "Samsung",
  servicePhone: "0522000000",
  problem: "ما كتبردش",
  status: "تصيفط",
  lastSentAt: "2026-11-10T10:00:00.000Z",
  reminders: 0,
  resolvedDate: "",
  resolvedTime: "",
  notes: "",
  clientId: "",
  purchaseId: "",
  saleId: "",
  createdAt: "2026-11-10T10:00:00.000Z",
  updatedAt: "2026-11-10T10:00:00.000Z",
  ...over,
});
const at = (iso: string) => new Date(iso);
const op = (body: object, time = "2026-11-10T10:00:01.000Z") => ({ ...body, opId: `O-${time}`, at: time }) as unknown as LedgerOp;
const seller = (services: Me["services"]): Me => ({ id: "u", name: "Said", role: "seller", services, seeCost: false });

describe("48 hours", () => {
  it("late from 48 h after the request, Sundays included", () => {
    expect(isLate(claim(), at("2026-11-12T09:59:00Z"))).toBe(false);
    expect(isLate(claim(), at("2026-11-12T10:00:00Z"))).toBe(true);
  });
  it("a reminder gives the service 48 h more; a solved request is never late", () => {
    const reminded = claim({ lastSentAt: "2026-11-12T11:00:00.000Z", reminders: 1 });
    expect(isLate(reminded, at("2026-11-13T11:00:00Z"))).toBe(false);
    expect(isLate(reminded, at("2026-11-14T11:00:00Z"))).toBe(true);
    expect(isLate(claim({ status: "تحل", resolvedDate: "2026-11-11" }), at("2026-12-01T00:00:00Z"))).toBe(false);
    expect(lateClaims([claim(), reminded], at("2026-11-13T00:00:00Z"))).toHaveLength(1);
  });
  it("says how long", () => {
    expect(sinceText("2026-11-10T10:00:00Z", at("2026-11-10T15:10:00Z"))).toBe("5 سوايع");
    expect(sinceText("2026-11-10T10:00:00Z", at("2026-11-12T11:00:00Z"))).toBe("يومين");
    expect(sinceText("2026-11-10T10:00:00Z", at("2026-11-15T11:00:00Z"))).toBe("5 أيام");
  });
});

describe("messages", () => {
  it("tells the service the device, the sale date, the fault and who to call", () => {
    const m = claimMessage(claim());
    for (const part of ["تلاجة Samsung", "01/10/2026", "ما كتبردش", "Amine jari", "0661234567"]) expect(m).toContain(part);
  });
  it("the reminder says when it was sent and how long ago", () => {
    const m = reminderMessage(claim(), at("2026-11-13T12:00:00Z"));
    expect(m).toContain("10/11/2026");
    expect(m).toContain("3 أيام");
    expect(m).toContain("Amine jari");
  });
});

describe("lists", () => {
  it("late requests first, solved last", () => {
    const list = [
      claim({ id: "W-1", status: "تحل", resolvedDate: "2026-11-11", createdAt: "2026-11-09T00:00:00Z" }),
      claim({ id: "W-2", lastSentAt: "2026-11-12T12:00:00Z", createdAt: "2026-11-12T12:00:00Z" }),
      claim({ id: "W-3" }),
    ];
    expect(searchClaims(list, "", at("2026-11-13T00:00:00Z")).map((c) => c.id)).toEqual(["W-3", "W-2", "W-1"]);
    expect(searchClaims(list, "0661", at("2026-11-13T00:00:00Z"))).toHaveLength(3);
    expect(searchClaims(list, "LG")).toHaveLength(0);
  });
  it("the open request of a purchase", () => {
    const list = [claim({ purchaseId: "S-1", status: "تحل", resolvedDate: "2026-11-11" }), claim({ id: "W-2", purchaseId: "S-2" })];
    expect(openClaimFor(list, "S-1")).toBeUndefined();
    expect(openClaimFor(list, "S-2")?.id).toBe("W-2");
    expect(openClaimFor(list, "")).toBeUndefined();
  });
  it("offers a customer's purchases, or every sale (cash too)", () => {
    const ledger = {
      clients: [{ id: "C-1", name: "Amine", phone: "0661234567" }],
      purchases: [{ id: "S-1", clientId: "C-1", item: "تلاجة", date: "2026-10-01" }],
      sales: [
        { id: "V-1", item: "تلاجة", date: "2026-10-01", clientId: "C-1", purchaseId: "S-1" },
        { id: "V-2", item: "غسالة LG", date: "2026-10-05", clientId: "", purchaseId: "" },
      ],
    } as never;
    expect(soldItems(ledger, { clientId: "C-1" })).toMatchObject([{ item: "تلاجة", purchaseId: "S-1", saleId: "V-1", customer: "Amine" }]);
    expect(soldItems(ledger).map((x) => x.saleId)).toEqual(["V-2", "V-1"]);
    expect(soldItems(ledger, { query: "lg" })).toMatchObject([{ item: "غسالة LG", customer: "" }]);
  });
  it("reads the saved services, ignoring a broken value", () => {
    expect(parseContacts({ value: '[{"id":"a","company":"Samsung","phone":"0522"},{"company":""}]' })).toEqual([{ id: "a", company: "Samsung", phone: "0522", notes: "" }]);
    expect(parseContacts({ value: "{oops" })).toEqual([]);
    expect(parseContacts(undefined)).toEqual([]);
  });
});

describe("ops and permissions", () => {
  it("adds, reminds, solves, deletes", () => {
    let l = applyOp(emptyLedger(), op({ type: "claim.add", claim: claim() }, "2026-11-10T10:00:00.000Z")).ledger;
    expect(l.claims).toHaveLength(1);
    const r = applyOp(l, op({ type: "claim.update", id: claim().id, base: l.claims[0].updatedAt, patch: { reminders: 1, lastSentAt: "2026-11-12T11:00:00.000Z" } }, "2026-11-12T11:00:00.000Z"));
    expect(r.result).toBe("ok");
    l = r.ledger;
    // Solved needs its date; an edit from an old copy is refused.
    expect(applyOp(l, op({ type: "claim.update", id: claim().id, base: l.claims[0].updatedAt, patch: { status: "تحل" } }, "2026-11-13T00:00:00.000Z")).result).toBe("invalid");
    expect(applyOp(l, op({ type: "claim.update", id: claim().id, base: "old", patch: { notes: "x" } }, "2026-11-13T00:00:00.000Z")).result).toBe("conflict");
    expect(applyOp(l, op({ type: "claim.delete", id: claim().id })).ledger.claims).toHaveLength(0);
    expect(applyOp(emptyLedger(), op({ type: "claim.add", claim: claim({ problem: "" }) })).result).toBe("invalid");
  });
  it("only accounts with the service see and change requests and the brands' numbers", () => {
    const add = op({ type: "claim.add", claim: claim() });
    const contacts = op({ type: "setting.save", key: "service-contacts", value: "[]" });
    const look = op({ type: "setting.save", key: "sticker-look", value: "{}" });
    expect(opAllowed(seller(["claims"]), add)).toBe(true);
    expect(opAllowed(seller(["repairs"]), add)).toBe(false);
    expect(opAllowed(seller(["claims"]), contacts)).toBe(true);
    expect(opAllowed(seller(["stock"]), contacts)).toBe(false);
    expect(opAllowed(seller(["claims"]), look)).toBe(false);
    const ledger = { ...emptyLedger(), claims: [claim()] };
    expect(ledgerFor(seller(["repairs"]), ledger).claims).toHaveLength(0);
    expect(ledgerFor(seller(["claims"]), ledger).claims).toHaveLength(1);
  });
});

describe("requests per customer (badge in الكريدي)", () => {
  it("counts open and late requests by account or by number", () => {
    const clients = [{ id: "C-1", phone: "0661234567" }, { id: "C-2", phone: "0700000000", phones: ["0611111111"] }];
    const list = [
      claim({ id: "W-1", clientId: "C-1" }),
      claim({ id: "W-2", clientId: "", phone: "+212 611 11 11 11", lastSentAt: "2026-11-12T09:00:00.000Z" }),
      claim({ id: "W-3", clientId: "C-1", status: "تحل", resolvedDate: "2026-11-11" }),
      claim({ id: "W-4", clientId: "", phone: "0699999999" }),
    ];
    const m = claimsByClient(clients, list, at("2026-11-13T10:00:00Z"));
    expect(m.get("C-1")).toEqual({ open: 1, late: 1 });
    expect(m.get("C-2")).toEqual({ open: 1, late: 0 });
    expect(m.size).toBe(2);
  });
});
