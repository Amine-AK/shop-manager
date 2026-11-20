// Seller's credit changes wait for the owner (طلبات الموافقة). A seller's change
// about credit (new customer, credit sale, payment, instalment, edit, deletion)
// is not applied to the customers' tabs: it is kept as a request until the owner
// accepts it. Meanwhile the app shows it, marked ⏳, so what the seller told the
// customer (receipt, WhatsApp) already counts it, and the cash drawer counts the
// money taken; the sheet itself stays as it was.

import { touched } from "./approval-deps";
import { money } from "./format";
import { applyOp, CREDIT_OPS, type Approval, type Ledger, type LedgerOp } from "./ledger";
import type { Me } from "./roles";

/** Does this change wait for the owner? Sellers' credit changes do. */
export function needsApproval(me: Pick<Me, "role"> | null | undefined, op: LedgerOp, ledger: Pick<Ledger, "sales" | "approvals">): boolean {
  if (me?.role !== "seller" || !CREDIT_OPS.has(op.type)) return false;
  // Sales: only credit ones (a cash sale is not about a customer's account).
  if (op.type === "sale.add") return (op.lines ?? []).some((l) => l?.type === "كريدي");
  if (op.type === "sale.delete") {
    // Also a credit sale still waiting for the owner.
    const waiting = ledger.approvals.flatMap((a) => (a.op.type === "sale.add" ? a.op.lines ?? [] : []));
    return [...ledger.sales, ...waiting].find((s) => s?.id === op.id)?.type === "كريدي";
  }
  return true;
}

/** Same change, same request: the id comes from the change's own id. */
export const approvalIdFor = (opId: string) => `A-${opId.replace(/^[A-Z]-/, "")}`;

/** The change, kept aside as a request (same id and time, so the sync queue follows it). */
export function asRequest(op: LedgerOp): LedgerOp {
  return { type: "approval.add", id: approvalIdFor(op.opId), op, opId: op.opId, at: op.at, by: op.by, device: op.device };
}

export interface PendingView {
  /** The ledger with the waiting requests applied (what the screens show). */
  ledger: Ledger;
  /** Records made or changed by a waiting request: marked ⏳ on screen. */
  pendingIds: Set<string>;
  /** Waiting requests that can no longer be applied (the record changed or is gone), with why. */
  broken: Map<string, string>;
}

const byTime = (a: Approval, b: Approval) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

export const waitingOf = (ledger: Pick<Ledger, "approvals">) => ledger.approvals.filter((a) => a.status === "كتسنى").sort(byTime);

/** The sheet's ledger plus the waiting requests, oldest first. */
export function withPending(ledger: Ledger): PendingView {
  let l = ledger;
  const pendingIds = new Set<string>();
  const broken = new Map<string, string>();
  for (const a of waitingOf(ledger)) {
    const r = applyOp(l, a.op);
    if (r.result === "ok" || r.result === "already") {
      l = r.ledger;
      for (const id of touched(a.op)) pendingIds.add(id);
    } else broken.set(a.id, r.message ?? "تبدلات المعلومات من بعد");
  }
  return { ledger: l, pendingIds, broken };
}

export interface RequestInfo {
  icon: string;
  text: string;
  /** Money moved by the change, 0 = none. */
  amount: number;
  clientId: string;
  client: string;
}

/** The customer behind a change, from the ledger or from a waiting «new customer» request. */
function clientName(ledger: Pick<Ledger, "clients" | "approvals">, id: string): string {
  const c = ledger.clients.find((x) => x.id === id);
  if (c) return c.name;
  for (const a of ledger.approvals) if (a.op.type === "client.add" && a.op.client?.id === id) return a.op.client.name;
  return "";
}

/** «💰 دفعة 500 درهم · تلاجة»: what a request does, in a line. */
export function describe(op: LedgerOp, ledger: Pick<Ledger, "clients" | "purchases" | "payments" | "sales" | "approvals">): RequestInfo {
  const purchase = (id: string) => ledger.purchases.find((p) => p.id === id);
  const payment = (id: string) => ledger.payments.find((p) => p.id === id);
  const out = (icon: string, text: string, clientId: string, amount = 0): RequestInfo => ({ icon, text, amount, clientId, client: clientName(ledger, clientId) });
  switch (op.type) {
    case "client.add": {
      const c = op.client;
      const r = out("👤", `زبون جديد: ${c?.name ?? ""}${c?.installment ? ` · الطريطة ${money(c.installment)} (${c.period})` : ""}`, c?.id ?? "");
      return { ...r, client: c?.name ?? r.client };
    }
    case "client.update":
      return out("✏️", `تعديل معلومات الزبون (${Object.keys(op.patch ?? {}).length} حاجة)`, op.id);
    case "client.delete":
      return out("🗑️", op.withHistory ? "حذف الزبون مع كل الحساب ديالو" : "حذف الزبون", op.id);
    case "client.installment":
      return out("🔁", `الطريطة: ${money(op.change?.newAmount ?? 0)} (${op.change?.newPeriod ?? ""})${op.change?.reason ? ` · ${op.change.reason}` : ""}`, op.id);
    case "purchase.add":
      return out("🛒", `سلعة: ${op.purchase?.item ?? ""} · ${money(op.purchase?.price ?? 0)}`, op.purchase?.clientId ?? "", op.purchase?.price ?? 0);
    case "purchase.update": {
      const p = purchase(op.id);
      return out("✏️", `تعديل السلعة «${p?.item ?? ""}»${op.patch?.price !== undefined ? ` · ${money(op.patch.price)}` : ""}`, p?.clientId ?? "");
    }
    case "purchase.delete": {
      const p = purchase(op.id);
      return out("🗑️", `حذف السلعة «${p?.item ?? ""}»`, p?.clientId ?? "", p?.price ?? 0);
    }
    case "payment.add": {
      const p = op.payment;
      const on = p?.purchaseId ? purchase(p.purchaseId)?.item : "";
      return out("💰", `${p?.kind ?? "دفعة"} ${money(p?.amount ?? 0)}${on ? ` · ${on}` : ""}`, p?.clientId ?? "", p?.amount ?? 0);
    }
    case "payment.update": {
      const p = payment(op.id);
      return out("✏️", `تعديل دفعة ${money(p?.amount ?? 0)}${op.patch?.amount !== undefined ? ` ← ${money(op.patch.amount)}` : ""}`, p?.clientId ?? "", op.patch?.amount ?? 0);
    }
    case "payment.delete": {
      const p = payment(op.id);
      return out("🗑️", `حذف دفعة ${money(p?.amount ?? 0)}`, p?.clientId ?? "", p?.amount ?? 0);
    }
    case "sale.add": {
      const lines = op.lines ?? [];
      const total = lines.reduce((t, l) => t + (l?.sellPrice ?? 0), 0);
      return out("🛒", `بيع بالكريدي: ${lines.map((l) => l?.item).join("، ")} · ${money(total)}`, lines[0]?.clientId ?? "", total);
    }
    case "sale.delete": {
      const s = ledger.sales.find((x) => x.id === op.id);
      return out("↩️", `إلغاء البيع «${s?.item ?? ""}»`, s?.clientId ?? "", s?.sellPrice ?? 0);
    }
    default:
      return out("📝", op.type, "");
  }
}

/** Waiting requests per customer (owner's list in الكريدي). */
export function waitingByClient(ledger: Ledger): Map<string, Approval[]> {
  const map = new Map<string, Approval[]>();
  for (const a of waitingOf(ledger)) {
    const id = describe(a.op, ledger).clientId;
    map.set(id, [...(map.get(id) ?? []), a]);
  }
  return map;
}
