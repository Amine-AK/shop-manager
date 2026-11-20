import { describe, expect, it } from "vitest";
import { asRequest } from "./approvals";
import { emptyLedger, type Client, type Ledger, type LedgerOp } from "./ledger";
import { rowToClient } from "./ledger-sheet";
import { ledgerFor, outOfScope, stampOp } from "./permissions";
import { newClientType, specialOnly, type Me } from "./roles";

const T = "2026-11-16T09:00:00.000Z";
const client = (id: string, type: number): Client => ({ id, name: id, phone: "", installment: 0, period: "شهر", nextDueDate: "", notes: "", type, createdAt: T, updatedAt: T });
const ledger = (): Ledger => ({
  ...emptyLedger(),
  clients: [client("C-NORMAL01", 0), client("C-SPECIAL1", 1)],
  purchases: [
    { id: "S-NORMAL01", clientId: "C-NORMAL01", date: "2026-11-01", item: "a", price: 100, notes: "", createdAt: T, updatedAt: T },
    { id: "S-SPECIAL1", clientId: "C-SPECIAL1", date: "2026-11-01", item: "b", price: 200, notes: "", createdAt: T, updatedAt: T },
  ],
  sales: [
    { id: "V-CASH0001", type: "كاش", clientId: "" },
    { id: "V-CRED0001", type: "كريدي", clientId: "C-NORMAL01" },
    { id: "V-CRED0002", type: "كريدي", clientId: "C-SPECIAL1" },
  ] as never,
});
const seller = (clientScope: Me["clientScope"]): Me => ({ id: "s", name: "Said", role: "seller", services: ["payment", "client_add", "client_edit"], seeCost: false, clientScope });
const owner: Me = { id: "o", name: "Mustapha", role: "owner", services: [], seeCost: true, clientScope: "special" };
const op = (body: object) => ({ ...body, opId: "O-TEST0001", at: T }) as LedgerOp;

describe("customer type (column «نوع الزبون»)", () => {
  it("reads 1 as special, anything else (older rows: empty) as normal", () => {
    const row = ["C-AAAA0001", "Amine", "0661", 0, "شهر", "", "", 0, 0, 0, "", T, T, ""];
    expect(rowToClient([...row, 1])?.type).toBe(1);
    expect(rowToClient([...row, "0"])?.type).toBeUndefined();
    expect(rowToClient(row)?.type).toBeUndefined();
  });
});

describe("accounts that follow only the special customers", () => {
  it("never the owner", () => {
    expect(specialOnly(owner)).toBe(false);
    expect(specialOnly(seller("special"))).toBe(true);
    expect(specialOnly(seller("all"))).toBe(false);
    expect(specialOnly(seller(undefined))).toBe(false);
  });
  it("see only the special customers and what is theirs; cash sales stay", () => {
    const l = ledgerFor(seller("special"), ledger());
    expect(l.clients.map((c) => c.id)).toEqual(["C-SPECIAL1"]);
    expect(l.purchases.map((p) => p.id)).toEqual(["S-SPECIAL1"]);
    expect(l.sales.map((s) => s.id)).toEqual(["V-CASH0001", "V-CRED0002"]);
    expect(ledgerFor(seller("all"), ledger()).clients).toHaveLength(2);
    expect(ledgerFor(owner, ledger()).clients).toHaveLength(2);
  });
  it("can't change another customer's account, even through a request for the owner", () => {
    const pay = (clientId: string) => op({ type: "payment.add", payment: { id: "P-1", clientId, purchaseId: "", amount: 10 } });
    expect(outOfScope(seller("special"), pay("C-NORMAL01"), ledger())).toBe(true);
    expect(outOfScope(seller("special"), asRequest(pay("C-NORMAL01")), ledger())).toBe(true);
    expect(outOfScope(seller("special"), pay("C-SPECIAL1"), ledger())).toBe(false);
    expect(outOfScope(seller("special"), op({ type: "purchase.delete", id: "S-NORMAL01" }), ledger())).toBe(true);
    // A new customer of theirs, still waiting for the owner.
    expect(outOfScope(seller("special"), pay("C-NEWONE01"), ledger())).toBe(false);
    expect(outOfScope(seller("all"), pay("C-NORMAL01"), ledger())).toBe(false);
    expect(outOfScope(seller("special"), op({ type: "note.add", note: {} }), ledger())).toBe(false);
  });
  it("only the owner sets the type; their new customers are special", () => {
    const add = (type: number) => op({ type: "client.add", client: client("C-NEW00001", type) });
    const typeOf = (me: Me, o: LedgerOp) => (stampOp(me, o, ledger()) as { client: Client }).client.type;
    expect(typeOf(owner, add(1))).toBe(1);
    expect(typeOf(owner, add(0))).toBe(0);
    expect(typeOf(seller("all"), add(1))).toBe(0);
    expect(typeOf(seller("special"), add(0))).toBe(1);
    const upd = op({ type: "client.update", id: "C-NORMAL01", base: T, patch: { type: 1, notes: "x" } });
    expect((stampOp(seller("all"), upd, ledger()) as { patch: object }).patch).toEqual({ notes: "x" });
    expect((stampOp(owner, upd, ledger()) as { patch: object }).patch).toEqual({ type: 1, notes: "x" });
    expect(newClientType(seller("special"))).toBe(1);
  });
});
