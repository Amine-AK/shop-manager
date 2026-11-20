import "server-only";
import { applyOp, emptyLedger, type Ledger, type LedgerOp, type OpResult } from "./ledger";
import { DEFAULT_CATEGORIES, HEADERS, ledgerToRows, rowsToLedger, sameRow, SHOP_KEYS, TABS, type TableKey } from "./ledger-sheet";
import { appendRows, deleteRows, ensureTabs, findTab, listTabs, readHeaders, readIds, readTables, updateRows, type Cell } from "./sheets";

const KEYS = Object.keys(TABS) as TableKey[];

/** An empty sheet (no stock tab yet) must be set up first. */
export async function needsSetup(): Promise<boolean> {
  return !(await findTab(TABS.stock, true));
}

/**
 * Tabs added by a newer version of the app are created on first use (the
 * product families with the default ones).
 */
let headersChecked = false;

async function ensureShopTabs(): Promise<void> {
  const have = new Set((await listTabs()).map((t) => t.title));
  const missing = SHOP_KEYS.filter((k) => !have.has(TABS[k]));
  if (!headersChecked) {
    // Tabs made by an older version: add the column titles that came later
    // (e.g. «الأيقونة» in الفئات). Once per server start.
    const tabs = SHOP_KEYS.map((k) => ({ title: TABS[k] as string, header: HEADERS[k] })).filter((t) => have.has(t.title));
    const rows = await readHeaders(tabs.map((t) => t.title));
    const fixes = tabs
      .filter((t) => t.header.some((h, i) => rows[t.title]?.[i] !== h))
      .map((t) => ({ title: t.title, row: 1, values: t.header as Cell[] }));
    await updateRows(fixes);
    headersChecked = true;
  }
  if (!missing.length) return;
  await ensureTabs(missing.map((k) => ({ title: TABS[k], header: HEADERS[k] })));
  if (missing.includes("categories")) {
    const rows = ledgerToRows({ ...emptyLedger(), categories: DEFAULT_CATEGORIES }).categories;
    await appendRows(TABS.categories, [...rows.values()]);
  }
}

/** The whole active ledger, in one request. */
export async function loadLedger(): Promise<Ledger> {
  await ensureShopTabs();
  const tables = await readTables(KEYS.map((k) => TABS[k]));
  return rowsToLedger(Object.fromEntries(KEYS.map((k) => [k, tables[TABS[k]]])) as Record<TableKey, unknown[][]>);
}

/**
 * Write the difference between two versions of the ledger: changed rows are
 * overwritten, new rows appended, removed rows deleted. About 5 requests,
 * whatever the number of changes.
 */
export async function commit(before: Ledger, after: Ledger): Promise<void> {
  const old = ledgerToRows(before);
  const next = ledgerToRows(after);

  // Row numbers can move (another device deleted a row): read the ids right before writing.
  const needIds = KEYS.filter((k) => [...old[k].keys()].some((id) => !next[k].has(id) || !sameRow(old[k].get(id)!, next[k].get(id)!)));
  const ids = await readIds(needIds.map((k) => TABS[k]));

  const updates: { title: string; row: number; values: Cell[] }[] = [];
  const deletes: { title: string; rows: number[] }[] = [];
  for (const k of needIds) {
    const title = TABS[k];
    const rowOf = new Map<string, number>();
    ids[title].forEach((id, i) => id && !rowOf.has(id) && rowOf.set(id, i + 2));
    const rows: number[] = [];
    for (const [id, values] of old[k]) {
      const row = rowOf.get(id);
      if (!row) continue;
      const now = next[k].get(id);
      if (!now) rows.push(row);
      else if (!sameRow(values, now)) updates.push({ title, row, values: now });
    }
    if (rows.length) deletes.push({ title, rows });
  }
  await updateRows(updates);
  await deleteRows(deletes);
  for (const k of KEYS) {
    const added = [...next[k]].filter(([id]) => !old[k].has(id)).map(([, v]) => v);
    await appendRows(TABS[k], added);
  }
}

export interface SyncResult {
  opId: string;
  result: OpResult;
  message?: string;
}

/**
 * Apply a batch of changes from a device, in order, and save them. `guard`
 * refuses a change (a message) or returns it as it should be saved.
 */
export async function sync(ops: LedgerOp[], guard?: (op: LedgerOp, ledger: Ledger) => LedgerOp | string): Promise<SyncResult[]> {
  const before = await loadLedger();
  let ledger = before;
  const results: SyncResult[] = [];
  for (const raw of ops) {
    const op = guard ? guard(raw, ledger) : raw;
    if (typeof op === "string") {
      results.push({ opId: raw.opId, result: "invalid", message: op });
      continue;
    }
    const r = applyOp(ledger, op);
    ledger = r.ledger;
    results.push({ opId: op.opId, result: r.result, message: r.message });
  }
  if (results.some((r) => r.result === "ok")) await commit(before, ledger);
  return results;
}

// ---------------------------------------------------------------- setup

/** Create the tabs of an empty sheet, with the default product families. */
export async function setup(): Promise<void> {
  if (!(await needsSetup())) throw new Error("already set up");
  await ensureTabs(KEYS.map((k) => ({ title: TABS[k], header: HEADERS[k] })));
  const rows = ledgerToRows({ ...emptyLedger(), categories: DEFAULT_CATEGORIES });
  for (const k of KEYS) await appendRows(TABS[k], [...rows[k].values()]);
}
