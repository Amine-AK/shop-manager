import { describe, expect, it } from "vitest";
import { summarizeClient, type Client, type Ledger } from "./ledger";
import { reminderMessage } from "./receipt";

const T = "2026-10-01T10:00:00.000Z";
const client: Client = { id: "C-AAAA0001", name: "Amine", phone: "0661234567", installment: 200, period: "شهر", nextDueDate: "2026-11-10", notes: "", createdAt: T, updatedAt: T };
const ledger = {
  clients: [client],
  purchases: [
    { id: "S-AAAA0001", clientId: client.id, date: "2026-10-01", item: "redmi 15C", price: 1500, notes: "", createdAt: T, updatedAt: T },
    { id: "S-AAAA0002", clientId: client.id, date: "2026-10-02", item: "شارجور", price: 100, notes: "", createdAt: T, updatedAt: T },
  ],
  payments: [{ id: "P-AAAA0001", clientId: client.id, purchaseId: "S-AAAA0002", date: "2026-10-05", time: "10:00", amount: 100, kind: "دفعة", notes: "", createdAt: T, updatedAt: T }],
  changes: [],
} as unknown as Ledger;

describe("reminder sent by hand on WhatsApp", () => {
  it("says when it was due, what is unpaid, what is left and the instalment", () => {
    const m = reminderMessage(summarizeClient(ledger, client, "2026-11-18"));
    expect(m).toContain("السلام عليكم Amine");
    expect(m).toContain("10/11/2026");
    expect(m).toContain("redmi 15C");
    expect(m).not.toContain("شارجور");
    expect(m).toContain("*1.500 درهم*");
    expect(m).toContain("200");
    expect(m).toContain("ELECTRO-LMESTOUR");
  });
});
