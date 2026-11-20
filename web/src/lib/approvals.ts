// Sellers' sensitive changes wait for the owner (طلبات الموافقة). Which ones is a
// shop setting the owner toggles (⚙️ «⏳ شنو كيتسنى موافقتي»): cancelling a sale, a new
// price or cost, stock taken out (loss, theft, correction), deleting a product, a
// cash drawer closed with a difference. Such a change is not applied to the
// sheet: it is kept as a request until the owner accepts it. Meanwhile the app
// shows it, marked ⏳; the sheet itself stays as it was.

import { touched } from "./approval-deps";
import { money } from "./format";
import { APPROVAL_RULES_KEY, applyOp, type Approval, type Ledger, type LedgerOp } from "./ledger";
import type { Me } from "./roles";

/** The kinds of change the owner can make wait for them, in the order of the settings screen. */
export const APPROVAL_RULES = [
  { key: "sale-delete", label: "↩️ إلغاء بيعة" },
  { key: "price-change", label: "🏷️ تبديل ثمن البيع ولا ثمن الشراء" },
  { key: "stock-out", label: "📉 نقص من المخزون (ضياع، سرقة، تصحيح)" },
  { key: "stock-delete", label: "🗑️ حذف سلعة" },
  { key: "caisse-diff", label: "🔒 سد الصندوق بفرق" },
] as const;

export type ApprovalRule = (typeof APPROVAL_RULES)[number]["key"];
export type ApprovalRules = Record<ApprovalRule, boolean>;

/** A new shop: everything waits for the owner. */
export const DEFAULT_APPROVAL_RULES: ApprovalRules = Object.fromEntries(APPROVAL_RULES.map((r) => [r.key, true])) as ApprovalRules;

/** The shop's rules (setting `approval-rules`); a missing or broken setting = the defaults. */
export function approvalRules(ledger: Pick<Ledger, "settings">): ApprovalRules {
  const raw = ledger.settings.find((s) => s.key === APPROVAL_RULES_KEY)?.value;
  if (!raw) return { ...DEFAULT_APPROVAL_RULES };
  try {
    const v = JSON.parse(raw) as Partial<Record<string, unknown>>;
    return Object.fromEntries(APPROVAL_RULES.map((r) => [r.key, typeof v[r.key] === "boolean" ? v[r.key] : true])) as ApprovalRules;
  } catch {
    return { ...DEFAULT_APPROVAL_RULES };
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Which rule a change falls under, if any (whoever makes it). */
export function ruleOf(op: LedgerOp, ledger: Pick<Ledger, "stock">): ApprovalRule | null {
  switch (op.type) {
    case "sale.delete":
      return "sale-delete";
    case "stock.update": {
      const item = ledger.stock.find((s) => s.id === op.id);
      const p = op.patch ?? {};
      const changes = (k: "sellPrice" | "buyPrice") => p[k] !== undefined && (!item || p[k] !== item[k]);
      return changes("sellPrice") || changes("buyPrice") ? "price-change" : null;
    }
    case "stock.adjust":
      return op.move && op.move.delta < 0 ? "stock-out" : null;
    case "stock.delete":
      return "stock-delete";
    case "caisse.close": {
      const k = op.close;
      return k && k.counted !== null && round2(k.counted - k.expected) !== 0 ? "caisse-diff" : null;
    }
    default:
      return null;
  }
}

/** Does this change wait for the owner? A seller's change under a rule the owner turned on. */
export function needsApproval(me: Pick<Me, "role"> | null | undefined, op: LedgerOp, ledger: Pick<Ledger, "stock" | "settings">): boolean {
  if (me?.role !== "seller") return false;
  const rule = ruleOf(op, ledger);
  return rule !== null && approvalRules(ledger)[rule];
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
  /** The record it is about (product, sale, drawer closing) and its name: requests are grouped by it. */
  targetId: string;
  target: string;
}

/** «🏷️ ثمن البيع 120 ← 150 درهم · شارجور»: what a request does, in a line. */
export function describe(op: LedgerOp, ledger: Pick<Ledger, "stock" | "sales">): RequestInfo {
  const product = (id: string) => ledger.stock.find((s) => s.id === id);
  const out = (icon: string, text: string, targetId: string, target: string, amount = 0): RequestInfo => ({ icon, text, amount, targetId, target });
  switch (op.type) {
    case "sale.delete": {
      const s = ledger.sales.find((x) => x.id === op.id);
      return out("↩️", `إلغاء البيعة «${s?.item ?? ""}»${s ? ` (${s.date})` : ""}`, op.id, s?.item ?? "", s?.sellPrice ?? 0);
    }
    case "stock.update": {
      const item = product(op.id);
      const p = op.patch ?? {};
      const parts: string[] = [];
      if (p.sellPrice !== undefined && p.sellPrice !== item?.sellPrice) parts.push(`ثمن البيع ${item ? `${money(item.sellPrice)} ← ` : ""}${money(p.sellPrice)}`);
      if (p.buyPrice !== undefined && p.buyPrice !== item?.buyPrice) parts.push(`ثمن الشراء ${item ? `${money(item.buyPrice)} ← ` : ""}${money(p.buyPrice)}`);
      const rest = Object.keys(p).filter((k) => k !== "sellPrice" && k !== "buyPrice").length;
      if (rest) parts.push(`${rest} معلومات أخرى`);
      return out("🏷️", `تعديل السلعة: ${parts.join(" · ") || "بلا تبديل"}`, op.id, item?.item ?? (p.item as string | undefined) ?? "");
    }
    case "stock.adjust": {
      const m = op.move;
      const item = product(m?.stockId ?? "");
      return out("📉", `نقص ${Math.abs(m?.delta ?? 0)} من المخزون${m?.reason ? ` · ${m.reason}` : ""}`, m?.stockId ?? "", item?.item ?? "");
    }
    case "stock.delete": {
      const item = product(op.id);
      return out("🗑️", `حذف السلعة (الكمية ${item?.quantity ?? 0})`, op.id, item?.item ?? "");
    }
    case "caisse.close": {
      const k = op.close;
      const diff = k && k.counted !== null ? round2(k.counted - k.expected) : 0;
      return out("🔒", `سد الصندوق ${k?.date ?? ""} · الفرق ${diff > 0 ? "+" : ""}${money(diff)}`, k?.id ?? "", `الصندوق ${k?.date ?? ""}`, Math.abs(diff));
    }
    default:
      return out("📝", op.type, "", "");
  }
}

/** Waiting requests per record (owner's list), oldest first. */
export function waitingByTarget(ledger: Ledger): Map<string, Approval[]> {
  const map = new Map<string, Approval[]>();
  for (const a of waitingOf(ledger)) {
    const id = describe(a.op, ledger).targetId;
    map.set(id, [...(map.get(id) ?? []), a]);
  }
  return map;
}
