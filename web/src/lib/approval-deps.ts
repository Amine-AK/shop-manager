// Which of a seller's waiting requests (طلبات الموافقة) depend on which: an edit
// of a product needs the earlier waiting edit it was made on, deleting it needs
// them too. Accepting a request first accepts what it needs; refusing one also
// refuses what was built on it. Only types are imported, so lib/ledger.ts can use
// this file.

import type { Approval, LedgerOp } from "./ledger";

const str = (v: unknown) => (typeof v === "string" && v ? [v] : []);

/** Records this change creates or modifies (marked ⏳ on screen). */
export function touched(op: LedgerOp): string[] {
  switch (op.type) {
    case "stock.adjust":
      return [...str(op.move?.stockId), ...str(op.move?.id)];
    case "caisse.close":
      return str(op.close?.id);
    case "stock.update":
    case "stock.delete":
    case "sale.delete":
      return str(op.id);
    default:
      return [];
  }
}

/** Records this change needs to exist (or to be as it saw them). */
export function needs(op: LedgerOp): string[] {
  switch (op.type) {
    case "stock.update":
    case "stock.delete":
      return str(op.id);
    default:
      return [];
  }
}

/**
 * What a later edit can depend on: a stock move changes the quantity only (a
 * difference, `updatedAt` kept), so an edit of the product doesn't need it.
 */
const made = (op: LedgerOp) => (op.type === "stock.adjust" ? str(op.move?.id) : touched(op));

const meets = (needer: Approval, maker: Approval) => {
  const madeIds = new Set(made(maker.op));
  return needs(needer.op).some((id) => madeIds.has(id));
};

const byTime = (a: Approval, b: Approval) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/** To accept `target`: the waiting requests it needs (and what they need), then itself, oldest first. */
export function approvalChain(waiting: Approval[], target: Approval): Approval[] {
  const list = [...waiting].sort(byTime);
  const take = new Set<string>([target.id]);
  // Walk back from the newest: a request is taken when something taken after it needs it.
  for (let i = list.length - 1; i >= 0; i--) {
    const a = list[i];
    if (take.has(a.id)) continue;
    if (list.slice(i + 1).some((b) => take.has(b.id) && meets(b, a))) take.add(a.id);
  }
  return list.filter((a) => take.has(a.id) && byTime(a, target) <= 0);
}

/** Refusing `target` also refuses the later waiting requests built on it. */
export function refusalCascade(waiting: Approval[], target: Approval): Approval[] {
  const list = [...waiting].sort(byTime);
  const out: Approval[] = [target];
  for (const a of list) {
    if (a.id === target.id || byTime(a, target) < 0) continue;
    if (out.some((b) => meets(a, b))) out.push(a);
  }
  return out;
}
