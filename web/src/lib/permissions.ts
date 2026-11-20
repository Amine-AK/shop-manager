// Rules about who may do what, as pure functions (used by the server routes, and tested).

import { APPROVABLE_OPS, STICKER_LOOK_KEY, type Ledger, type LedgerOp } from "./ledger";
import { can, seesCost, type Me, type Permission } from "./roles";

/** May this user make this change (sent from a phone)? */
export function opAllowed(me: Me, op: LedgerOp): boolean {
  const any = (...perms: Permission[]) => perms.some((p) => can(me, p));
  switch (op.type) {
    case "stock.add":
    case "category.save":
      return any("stock_add");
    case "setting.save":
      // The default sticker look: whoever prints stickers (owner, stock manager).
      // Every other shop setting (approval rules, shop info…): the owner only.
      return op.key === STICKER_LOOK_KEY ? any("stock_add") : any("owner_only");
    case "stock.adjust":
      // The stock manager adds deliveries; taking stock out needs full stock rights.
      return op.move && op.move.delta < 0 ? any("stock") : any("stock_add");
    case "stock.update":
    case "stock.delete":
      return any("stock");
    case "sale.add":
      return any("sell_cash");
    case "sale.delete":
      return any("cancel_sale");
    case "caisse.close":
      return any("caisse");
    // A seller's change kept for the owner: allowed when the change itself is.
    case "approval.add":
      return Boolean(op.op && typeof op.op === "object" && APPROVABLE_OPS.has(op.op.type)) && opAllowed(me, op.op);
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
    case "approval.add":
      // The change inside is stamped like any other (who did it, what they may change).
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

/** The ledger as this user may see it. */
export function ledgerFor(me: Me, ledger: Ledger): Ledger {
  const cost = seesCost(me);
  const stock = cost ? ledger.stock : ledger.stock.map((s) => ({ ...s, buyPrice: 0 }));
  if (me.role === "stock") return { ...ledger, sales: [], closings: [], approvals: [], stock };
  if (cost) return { ...ledger, stock };
  // Waiting price changes carry the cost too.
  const approvals = ledger.approvals.map((a) => {
    if (a.op.type !== "stock.update" || !a.op.patch || !("buyPrice" in a.op.patch)) return a;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { buyPrice, ...patch } = a.op.patch;
    return { ...a, op: { ...a.op, patch } };
  });
  return { ...ledger, stock, approvals, sales: ledger.sales.map((s) => ({ ...s, buyPrice: null })) };
}
