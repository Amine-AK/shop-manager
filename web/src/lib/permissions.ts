// Rules about who may do what, as pure functions (used by the server routes, and tested).

import { CREDIT_OPS, REMINDER_TEMPLATES_KEY, SERVICE_CONTACTS_KEY, type Ledger, type LedgerOp } from "./ledger";
import { describe } from "./approvals";
import { can, newClientType, seesCost, specialOnly, type ClientType, type Me, type Permission } from "./roles";

/** May this user make this change (sent from a phone)? */
export function opAllowed(me: Me, op: LedgerOp): boolean {
  const any = (...perms: Permission[]) => perms.some((p) => can(me, p));
  switch (op.type) {
    case "client.add":
      return any("client_add", "sell_credit");
    case "client.update":
      return any("client_edit");
    case "client.delete":
      return any("client_delete");
    case "client.installment":
      return any("client_edit", "sell_credit");
    case "purchase.add":
      return any("sell_credit");
    case "purchase.update":
    case "purchase.delete":
    case "payment.update":
    case "payment.delete":
      return any("client_edit");
    case "payment.add":
      return any("payment", "sell_credit");
    case "stock.add":
    case "category.save":
      return any("stock_add");
    case "setting.save":
      // The brands' after-sales numbers: whoever follows the requests. The default
      // sticker look: whoever prints stickers (owner, stock manager).
      // The reminders' texts: whoever sends reminders.
      if (op.key === REMINDER_TEMPLATES_KEY) return any("reminders");
      return op.key === SERVICE_CONTACTS_KEY ? any("claims") : any("stock_add");
    case "stock.adjust":
      // The stock manager adds deliveries; taking stock out needs full stock rights.
      return op.move && op.move.delta < 0 ? any("stock") : any("stock_add");
    case "stock.update":
    case "stock.delete":
      return any("stock");
    case "sale.add": {
      const lines = Array.isArray(op.lines) ? op.lines : [];
      return lines.every((l) => (l?.type === "كريدي" ? any("sell_credit") : any("sell_cash")));
    }
    case "sale.delete":
      return any("cancel_sale");
    case "caisse.close":
      return any("caisse");
    case "repair.add":
    case "repair.update":
    case "repair.delete":
      return any("repairs");
    case "claim.add":
    case "claim.update":
    case "claim.delete":
      return any("claims");
    // A seller's credit change kept for the owner: allowed when the change itself is.
    case "approval.add":
      return Boolean(op.op && typeof op.op === "object" && CREDIT_OPS.has(op.op.type)) && opAllowed(me, op.op);
    // The notebook: every account writes and ticks off; only the owner tears out a page.
    case "note.add":
    case "note.update":
      return true;
    case "note.delete":
      return any("owner_only");
    // A seller's note on their own waiting change (applyOp checks it is theirs).
    case "approval.note":
      return me.role === "seller";
    // Only the owner accepts or refuses.
    case "approval.decide":
      return any("owner_only");
    default:
      return false;
  }
}

/**
 * What the server records about who did it, whatever the phone sent, and
 * what a user who can't see costs isn't allowed to change.
 */
export function stampOp(me: Me, op: LedgerOp, ledger: Ledger): LedgerOp {
  switch (op.type) {
    case "sale.add":
      return {
        ...op,
        lines: (Array.isArray(op.lines) ? op.lines : []).map((l) => {
          const item = l?.stockId ? ledger.stock.find((s) => s.id === l.stockId) : undefined;
          // A seller who doesn't see costs sends none: take it from the stock card.
          const buyPrice = l.buyPrice === null && item && item.buyPrice > 0 ? Math.round(item.buyPrice * l.quantity * 100) / 100 : l.buyPrice;
          return { ...l, seller: me.name, buyPrice };
        }),
      };
    case "stock.adjust":
      return op.move ? { ...op, move: { ...op.move, seller: me.name } } : op;
    case "caisse.close":
      return op.close ? { ...op, close: { ...op.close, clerk: me.name } } : op;
    case "client.add":
      // Only the owner chooses the type; an account following only special customers makes special ones.
      return op.client && typeof op.client === "object" ? { ...op, client: { ...op.client, type: newClientType(me, (op.client.type === 1 ? 1 : 0) as ClientType) } } : op;
    case "client.update": {
      if (me.role === "owner" || !op.patch || !("type" in op.patch)) return op;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { type, ...patch } = op.patch;
      return { ...op, patch };
    }
    case "approval.add":
      // The change inside is stamped like any other (who sold, the cost of a credit sale).
      return op.op && typeof op.op === "object" ? { ...op, op: { ...stampOp(me, op.op, ledger), by: me.name, device: op.device } } : op;
    case "stock.update": {
      if (seesCost(me) || !op.patch) return op;
      // Can't see the cost, so can't change it (the form had none to show).
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { buyPrice, ...patch } = op.patch;
      return { ...op, patch };
    }
    default:
      return op;
  }
}

/**
 * An account that follows only the special customers can't change another
 * customer's account (its screens don't show them; this guards the server).
 */
export function outOfScope(me: Me, op: LedgerOp, ledger: Ledger): boolean {
  if (!specialOnly(me)) return false;
  const inner = op.type === "approval.add" && op.op && typeof op.op === "object" ? op.op : op;
  if (!CREDIT_OPS.has(inner.type) && inner.type !== "claim.add") return false;
  const id = inner.type === "claim.add" ? inner.claim?.clientId ?? "" : describe(inner, ledger).clientId;
  const client = id ? ledger.clients.find((c) => c.id === id) : undefined;
  // Unknown (a new customer still waiting for the owner) = theirs.
  return Boolean(client && client.type !== 1);
}

/** Keep only what concerns the special customers (type 1). */
function specialView(ledger: Ledger): Ledger {
  const ids = new Set(ledger.clients.filter((c) => c.type === 1).map((c) => c.id));
  const known = new Set(ledger.clients.map((c) => c.id));
  // A customer still waiting for the owner (not in the sheet yet) was made by them: kept.
  const mine = (id: string) => !id || ids.has(id) || !known.has(id);
  return {
    ...ledger,
    clients: ledger.clients.filter((c) => ids.has(c.id)),
    purchases: ledger.purchases.filter((p) => ids.has(p.clientId)),
    payments: ledger.payments.filter((p) => ids.has(p.clientId)),
    changes: ledger.changes.filter((x) => ids.has(x.clientId)),
    sales: ledger.sales.filter((s) => s.type !== "كريدي" || ids.has(s.clientId)),
    approvals: ledger.approvals.filter((a) => mine(describe(a.op, ledger).clientId)),
    claims: ledger.claims.filter((c) => !c.clientId || ids.has(c.clientId)),
  };
}

/** The ledger as this user may see it. */
export function ledgerFor(me: Me, ledger: Ledger): Ledger {
  if (specialOnly(me)) ledger = specialView(ledger);
  // Repairs hold customers' names and phones: only for accounts that do repairs. Whoever
  // closes the cash drawer still gets their advances (amount, time, device), nothing personal.
  if (!can(me, "repairs")) {
    const forDrawer = can(me, "caisse") ? ledger.repairs.filter((r) => r.advance > 0 || r.paid > 0) : [];
    ledger = { ...ledger, repairs: forDrawer.map((r) => ({ ...r, owner: "", phone: "", problem: "", notes: "", photo: "" })) };
  }
  // Requests to the brands' services hold customers' names and phones too.
  if (!can(me, "claims")) ledger = { ...ledger, claims: [] };
  const cost = seesCost(me);
  const stock = cost ? ledger.stock : ledger.stock.map((s) => ({ ...s, buyPrice: 0 }));
  if (me.role === "stock") return { ...ledger, clients: [], purchases: [], payments: [], changes: [], sales: [], closings: [], approvals: [], stock };
  if (cost) return { ...ledger, stock };
  // Credit sales waiting for the owner carry their cost too.
  const approvals = ledger.approvals.map((a) =>
    a.op.type === "sale.add" ? { ...a, op: { ...a.op, lines: (a.op.lines ?? []).map((l) => ({ ...l, buyPrice: null })) } } : a,
  );
  return { ...ledger, stock, approvals, sales: ledger.sales.map((s) => ({ ...s, buyPrice: null })) };
}
