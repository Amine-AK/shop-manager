import { describe, expect, it } from "vitest";
import type { StockItem } from "./ledger";
import { cashOutcome, categoryProducts, quickCash } from "./sale-browse";

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
