import { describe, expect, it } from "vitest";
import { applyOp, applyOps, EMPTY_LEDGER, isLedgerId, newLedgerId, type CaisseClose, type Ledger, type LedgerOp, type Sale, type StockItem } from "./ledger";
import { HEADERS, ledgerToRows, rowsToLedger, sameRow, TABS, type TableKey } from "./ledger-sheet";
import { whatsappLink } from "./receipt";

const T0 = "2026-01-10T10:00:00.000Z";
let n = 0;
const op = <T extends object>(body: T, at = `2026-01-10T10:00:${String(++n).padStart(2, "0")}.000Z`) =>
  ({ ...body, opId: `O-TEST${n}`, at }) as unknown as LedgerOp;

const charger: StockItem = {
  id: "I-CHARGE01", item: "شارجور Type-C", category: "إكسسوارات", condition: "جديد", buyPrice: 40, sellPrice: 80, quantity: 10,
  serial: "6111111111111", codes: [], notes: "", createdAt: T0, updatedAt: T0,
};
const line = (id: string, over: Partial<Sale> = {}): Sale => ({
  id, ticket: "V-TICKET01", date: "2026-01-10", time: "10:00", item: charger.item, category: charger.category, stockId: charger.id, quantity: 2,
  buyPrice: 80, listPrice: 160, sellPrice: 150, seller: "", notes: "", createdAt: T0, updatedAt: T0, ...over,
});

function shop(): Ledger {
  return applyOps(EMPTY_LEDGER, [op({ type: "stock.add", item: charger })]);
}

describe("sales take products out of stock", () => {
  it("a sale of 2 takes 2 out; cancelling it puts them back", () => {
    const sold = applyOp(shop(), op({ type: "sale.add", lines: [line("V-TICKET01")] }));
    expect(sold.result).toBe("ok");
    expect(sold.ledger.stock[0].quantity).toBe(8);
    expect(sold.ledger.sales).toHaveLength(1);
    const back = applyOp(sold.ledger, op({ type: "sale.delete", id: "V-TICKET01" }));
    expect(back.ledger.stock[0].quantity).toBe(10);
    expect(back.ledger.sales).toHaveLength(0);
  });

  it("a quantity change keeps the product's version (an edit made meanwhile is not a conflict)", () => {
    const l = shop();
    const base = l.stock[0].updatedAt;
    const sold = applyOp(l, op({ type: "sale.add", lines: [line("V-TICKET01")] })).ledger;
    const moved = applyOp(sold, op({ type: "stock.adjust", move: { id: "M-MOVE0001", stockId: charger.id, date: "2026-01-10", delta: -1, reason: "ضايعة", seller: "", createdAt: T0 } })).ledger;
    expect(moved.stock[0].updatedAt).toBe(base);
    expect(applyOp(moved, op({ type: "stock.update", id: charger.id, base, patch: { sellPrice: 90 } })).result).toBe("ok");
  });

  it("refuses a line without a price or with a bad id, and a sale with no line", () => {
    expect(applyOp(shop(), op({ type: "sale.add", lines: [] })).result).toBe("invalid");
    expect(applyOp(shop(), op({ type: "sale.add", lines: [line("X-1")] })).result).toBe("invalid");
    expect(applyOp(shop(), op({ type: "sale.add", lines: [line("V-TICKET01", { sellPrice: -1 })] })).result).toBe("invalid");
  });
});

describe("operations are safe to repeat and to delay", () => {
  it("skips an operation sent twice", () => {
    const add = op({ type: "sale.add", lines: [line("V-TICKET01")] });
    const once = applyOp(shop(), add);
    const twice = applyOp(once.ledger, add);
    expect([once.result, twice.result]).toEqual(["ok", "already"]);
    expect(twice.ledger.stock[0].quantity).toBe(8);
  });

  it("refuses an edit made on an old version, but accepts its own retry", () => {
    const l = shop();
    const base = l.stock[0].updatedAt;
    const edit = op({ type: "stock.update", id: charger.id, base, patch: { sellPrice: 90 } });
    const r1 = applyOp(l, edit);
    expect(applyOp(r1.ledger, edit).result).toBe("already");
    const stale = op({ type: "stock.update", id: charger.id, base, patch: { item: "آخر" } });
    expect(applyOp(r1.ledger, stale).result).toBe("conflict");
  });

  it("a code leads to one product only", () => {
    const other: StockItem = { ...charger, id: "I-OTHER001", item: "كابل", serial: "6111111111111" };
    expect(applyOp(shop(), op({ type: "stock.add", item: other })).result).toBe("invalid");
  });

  it("makes readable unique ids", () => {
    const id = newLedgerId("V");
    expect(isLedgerId(id)).toBe(true);
    expect(id).toMatch(/^V-[A-Z2-9]{8}$/);
    expect(isLedgerId("C-AAAA1111")).toBe(false);
  });
});

describe("cash drawer closing", () => {
  const close: CaisseClose = {
    id: "K-CLOSE001", date: "2026-01-10", time: "20:00", clerk: "", cashSales: 150, expenses: 20, expensesNote: "قهوة",
    expected: 130, counted: 125, notes: "", createdAt: T0,
  };
  it("is saved once, with its numbers checked", () => {
    const r = applyOp(EMPTY_LEDGER, op({ type: "caisse.close", close }));
    expect(r.result).toBe("ok");
    expect(applyOp(r.ledger, op({ type: "caisse.close", close })).result).toBe("already");
    expect(applyOp(EMPTY_LEDGER, op({ type: "caisse.close", close: { ...close, id: "K-CLOSE002", expenses: -1 } })).result).toBe("invalid");
  });
});

describe("sheet layout", () => {
  it("writes and reads back the same ledger", () => {
    const close: CaisseClose = { id: "K-CLOSE001", date: "2026-01-10", time: "20:00", clerk: "Said", cashSales: 150, expenses: 0, expensesNote: "", expected: 150, counted: null, notes: "", createdAt: T0 };
    const l = applyOps(shop(), [
      op({ type: "sale.add", lines: [line("V-TICKET01", { seller: "Said" })] }),
      op({ type: "caisse.close", close }),
      op({ type: "setting.save", key: "sticker-look", value: "{}" }),
    ]);
    const rows = ledgerToRows(l);
    const tables = Object.fromEntries(Object.entries(rows).map(([k, m]) => [k, [...m.values()]])) as Record<TableKey, unknown[][]>;
    expect(rowsToLedger(tables)).toEqual(l);
    // Profit is written next to the price; each row has as many cells as titles.
    expect(rows.sales.get("V-TICKET01")![11]).toBe(70);
    for (const k of Object.keys(TABS) as TableKey[]) for (const r of rows[k].values()) expect(r.length).toBe(HEADERS[k].length);
    expect(sameRow(["V-1", "500"], ["V-1", 500])).toBe(true);
    expect(TABS.sales).toBe("المبيعات");
  });

  it("reads dates and times typed by hand in the sheet", () => {
    const s = rowsToLedger({ sales: [["V-X1234", "", 46323, 0.5, "شارجور", "", "", 1, "", 80, 80]] }).sales[0];
    expect(s).toMatchObject({ date: "2026-10-28", time: "12:00", sellPrice: 80, buyPrice: null, ticket: "V-X1234" });
  });
});

describe("WhatsApp links", () => {
  it("opens the chat with the message typed, only for a usable number", () => {
    expect(whatsappLink("0661234567", "سلام 👋")).toBe(`https://api.whatsapp.com/send?phone=212661234567&text=${encodeURIComponent("سلام 👋")}`);
    expect(whatsappLink("123", "x")).toBeNull();
  });
});

describe("shop settings (the default sticker look)", () => {
  it("saves a setting, replaces it, and keeps it through the sheet", () => {
    let l = applyOp(EMPTY_LEDGER, op({ type: "setting.save", key: "sticker-look", value: '{"priceSize":20}' })).ledger;
    expect(l.settings).toHaveLength(1);
    expect(l.settings[0]).toMatchObject({ key: "sticker-look", value: '{"priceSize":20}' });
    l = applyOp(l, op({ type: "setting.save", key: "sticker-look", value: '{"priceSize":18}' })).ledger;
    expect(l.settings.map((x) => x.value)).toEqual(['{"priceSize":18}']);
    const rows = ledgerToRows(l);
    expect(rowsToLedger({ settings: [...rows.settings.values()] }).settings).toEqual(l.settings);
  });
  it("refuses a bad key or a value too big", () => {
    expect(applyOp(EMPTY_LEDGER, op({ type: "setting.save", key: "Bad Key!", value: "{}" })).result).toBe("invalid");
    expect(applyOp(EMPTY_LEDGER, op({ type: "setting.save", key: "sticker-look", value: "x".repeat(20_001) })).result).toBe("invalid");
  });
});
