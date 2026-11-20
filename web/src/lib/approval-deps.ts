// Which of a seller's waiting requests (طلبات الموافقة) depend on which: a
// payment needs the new customer or the credit sale it is for, an edit needs
// the earlier edit it was made on. Accepting a request first accepts what it
// needs; refusing one also refuses what was built on it. Only types are
// imported, so lib/ledger.ts can use this file.

import type { Approval, LedgerOp } from "./ledger";

const str = (v: unknown) => (typeof v === "string" && v ? [v] : []);

/** Records this change creates or modifies. */
export function touched(op: LedgerOp): string[] {
  switch (op.type) {
    case "client.add":
      return str(op.client?.id);
    case "client.installment":
      return [...str(op.id), ...str(op.change?.id)];
    case "purchase.add":
      return str(op.purchase?.id);
    case "payment.add":
      return str(op.payment?.id);
    case "sale.add":
      return [...(op.lines ?? []).flatMap((l) => str(l?.id)), ...(op.purchases ?? []).flatMap((p) => str(p?.id))];
    case "client.update":
    case "client.delete":
    case "purchase.update":
    case "purchase.delete":
    case "payment.update":
    case "payment.delete":
    case "sale.delete":
      return str(op.id);
    default:
      return [];
  }
}

/** Records this change needs to exist (or to be as it saw them). */
export function needs(op: LedgerOp): string[] {
  switch (op.type) {
    case "purchase.add":
      return str(op.purchase?.clientId);
    case "payment.add":
      return [...str(op.payment?.clientId), ...str(op.payment?.purchaseId)];
    case "payment.update":
      return [...str(op.id), ...str(op.patch?.clientId), ...str(op.patch?.purchaseId)];
    case "sale.add":
      return str(op.lines?.[0]?.clientId);
    case "client.update":
    case "client.delete":
    case "client.installment":
    case "purchase.update":
    case "purchase.delete":
    case "payment.delete":
    case "sale.delete":
      return str(op.id);
    default:
      return [];
  }
}

const meets = (needer: Approval, maker: Approval) => {
  const made = new Set(touched(maker.op));
  return needs(needer.op).some((id) => made.has(id));
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
