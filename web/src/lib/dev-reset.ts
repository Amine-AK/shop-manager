import "server-only";
// DEV ONLY: empties the Google Sheet while the app is being built and tested.
// Remove this file, src/app/api/dev/reset/ and src/components/DevReset.tsx (and the
// lines marked "DEV ONLY") before going live — or simply unset ALLOW_DATA_RESET.

import { emptyLedger } from "./ledger";
import { DEFAULT_CATEGORIES, ledgerToRows, TABS } from "./ledger-sheet";
import { appendRows, clearRows, listTabs } from "./sheets";

/** Every row of every app tab goes (titles stay); the default families come back. */
export async function resetAllData(): Promise<{ tabs: string[] }> {
  const have = new Set((await listTabs(true)).map((t) => t.title));
  const tabs = Object.values(TABS).filter((t) => have.has(t));
  await clearRows(tabs);
  if (have.has(TABS.categories)) {
    const rows = ledgerToRows({ ...emptyLedger(), categories: DEFAULT_CATEGORIES }).categories;
    await appendRows(TABS.categories, [...rows.values()]);
  }
  return { tabs };
}
