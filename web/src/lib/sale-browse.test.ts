import { describe, expect, it } from "vitest";
import type { Claim, Client, Repair, StockItem } from "./ledger";
import { cashOutcome, categoryProducts, customerFollowUps, quickCash } from "./sale-browse";

const item = (id: string, name: string, over: Partial<StockItem> = {}): StockItem =>
  ({ id, item: name, category: "هواتف", condition: "جديد", buyPrice: 0, sellPrice: 100, quantity: 1, serial: "", codes: [], notes: "", createdAt: "", updatedAt: "", ...over }) as StockItem;

describe("a category's page", () => {
  const stock = [
    item("I-1", "Samsung A15"),
    item("I-2", "iPhone 11", { condition: "مستعمل" }),
    item("I-3", "Redmi 13C", { quantity: 0 }),
    item("I-4", "Oppo A18"),
    item("I-5", "شارجور", { category: "إكسسوارات" }),
  ];
  const sales = [{ stockId: "I-4", quantity: 5 }];
  it("only that category; in stock first, best sellers first", () => {
    expect(categoryProducts(stock, sales, "هواتف").map((s) => s.id)).toEqual(["I-4", "I-2", "I-1", "I-3"]);
  });
  it("search and filters stay in the category", () => {
    expect(categoryProducts(stock, sales, "هواتف", "redmi").map((s) => s.id)).toEqual(["I-3"]);
    expect(categoryProducts(stock, sales, "هواتف", "شارجور")).toEqual([]);
    expect(categoryProducts(stock, sales, "هواتف", "", "in").map((s) => s.id)).not.toContain("I-3");
    expect(categoryProducts(stock, sales, "هواتف", "", "used").map((s) => s.id)).toEqual(["I-2"]);
    expect(categoryProducts(stock, sales, "هواتف", "", "new")).toHaveLength(3);
  });
});

describe("عطاك (cash given)", () => {
  it("change, exact, short", () => {
    expect(cashOutcome(450, 500)).toEqual({ kind: "change", change: 50 });
    expect(cashOutcome(450, 450)).toEqual({ kind: "exact" });
    expect(cashOutcome(450, 300)).toEqual({ kind: "short", short: 150 });
    expect(cashOutcome(450, 0)).toEqual({ kind: "none" });
    expect(cashOutcome(0, 100)).toEqual({ kind: "none" });
  });
  it("suggests the total and the round notes above it", () => {
    expect(quickCash(430)).toEqual([430, 450, 500, 600]);
    expect(quickCash(500)).toEqual([500, 600, 1000]);
    expect(quickCash(0)).toEqual([]);
  });
});

describe("a customer's follow-ups", () => {
  const c = { id: "C-1", name: "Amine", phone: "0661234567", phones: ["0700000000"] } as Client;
  it("requests by account or number, repairs by number; open first", () => {
    const claims = [
      { id: "W-1", clientId: "C-1", phone: "", status: "تحل", createdAt: "2026-11-02" },
      { id: "W-2", clientId: "", phone: "+212 661 23 45 67", status: "تصيفط", createdAt: "2026-11-01" },
      { id: "W-3", clientId: "C-9", phone: "0611111111", status: "تصيفط", createdAt: "2026-11-03" },
    ] as Claim[];
    const repairs = [
      { id: "R-1", phone: "0700000000", status: "تسلم", createdAt: "2026-11-05" },
      { id: "R-2", phone: "0661234567", status: "فالإصلاح", createdAt: "2026-11-01" },
      { id: "R-3", phone: "", status: "مستلم", createdAt: "2026-11-06" },
    ] as Repair[];
    const f = customerFollowUps(c, { claims, repairs });
    expect(f.claims.map((x) => x.id)).toEqual(["W-2", "W-1"]);
    expect(f.repairs.map((x) => x.id)).toEqual(["R-2", "R-1"]);
  });
});
