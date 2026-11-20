// The sale screen's helpers: a category's products for its page, what the
// cash given means (change, short → rest on credit), and a customer's
// follow-ups (after-sales requests, repairs) for their page in الكريدي.
// Pure, shared by the screens and the tests.

import { clientPhones, type Claim, type Client, type Ledger, type Repair, type Sale, type StockItem } from "./ledger";
import { formatMoroccoPhone, isValidPhone } from "./sheet-logic";
import { round2, searchStock } from "./shop";

export type StockFilter = "all" | "in" | "new" | "used";

/**
 * A category's products for its page: the search (scoped to the category) and
 * the filter; in stock first, then what sells most, then by name.
 */
export function categoryProducts(stock: StockItem[], sales: Pick<Sale, "stockId" | "quantity">[], category: string, query = "", filter: StockFilter = "all"): StockItem[] {
  const own = stock.filter((s) => s.category === category);
  const pass = (s: StockItem) =>
    filter === "in" ? s.quantity > 0 : filter === "new" ? s.condition !== "مستعمل" : filter === "used" ? s.condition === "مستعمل" : true;
  if (query.trim()) return searchStock(own, query, own.length).filter(pass);
  const sold = new Map<string, number>();
  for (const s of sales) if (s.stockId) sold.set(s.stockId, (sold.get(s.stockId) ?? 0) + s.quantity);
  return own
    .filter(pass)
    .sort((a, b) => Number(b.quantity > 0) - Number(a.quantity > 0) || (sold.get(b.id) ?? 0) - (sold.get(a.id) ?? 0) || a.item.localeCompare(b.item, "ar"));
}

export type CashOutcome = { kind: "none" } | { kind: "exact" } | { kind: "change"; change: number } | { kind: "short"; short: number };

/** What the customer handed over means: nothing typed, exact, change to give back, or short. */
export function cashOutcome(total: number, given: number): CashOutcome {
  if (!(total > 0) || !(given > 0)) return { kind: "none" };
  const d = round2(given - total);
  if (d === 0) return { kind: "exact" };
  return d > 0 ? { kind: "change", change: d } : { kind: "short", short: -d };
}

/** Amounts a customer likely hands over: the exact total, then round notes above it (4 at most). */
export function quickCash(total: number): number[] {
  if (!(total > 0)) return [];
  const up = (step: number) => Math.ceil(total / step) * step;
  const out = [round2(total), up(50), up(100), up(200), up(500), up(1000)];
  return [...new Set(out)].filter((x) => x >= total).sort((a, b) => a - b).slice(0, 4);
}

/** A customer's after-sales requests and repairs (by account or by any of their numbers): open ones first, newest first. */
export function customerFollowUps(c: Client, ledger: Pick<Ledger, "claims" | "repairs">): { claims: Claim[]; repairs: Repair[] } {
  const phones = new Set(clientPhones(c).map(formatMoroccoPhone).filter(isValidPhone));
  const same = (p: string) => Boolean(p) && phones.has(formatMoroccoPhone(p));
  const claims = ledger.claims
    .filter((x) => x.clientId === c.id || same(x.phone))
    .sort((a, b) => Number(a.status === "تحل") - Number(b.status === "تحل") || b.createdAt.localeCompare(a.createdAt));
  const repairs = ledger.repairs
    .filter((r) => same(r.phone))
    .sort((a, b) => Number(a.status === "تسلم") - Number(b.status === "تسلم") || b.createdAt.localeCompare(a.createdAt));
  return { claims, repairs };
}
