// The shop's ledger: stock, cash sales, stock moves, the daily cash drawer,
// shop settings, the notebook and the sellers' changes waiting for the owner.
//
// Every change is an operation with its own id. The same `applyOp` runs on the
// phone (to show the change at once, even offline) and on the server (to save
// it in the Google Sheet), so both always agree. Operations are safe to send
// twice: a second copy is recognised and skipped.

import { approvalChain, refusalCascade } from "./approval-deps";
import { addDays, isISODate } from "./dates";

// ---------------------------------------------------------------- shop: stock, sales, cash drawer

export const CONDITIONS = ["جديد", "مستعمل"] as const;
export type Condition = (typeof CONDITIONS)[number];

/** A product in stock (المخزون). */
export interface StockItem {
  id: string;
  item: string;
  category: string;
  condition: Condition;
  /** Cost of one unit. */
  buyPrice: number;
  /** Suggested selling price of one unit. */
  sellPrice: number;
  /** Can go below 0 when sold before being counted in: shown as a warning. */
  quantity: number;
  /** Main code of the product (QR / barcode / S/N), optional. */
  serial: string;
  /** More codes for the same product: each supplier's QR / barcode / S/N. */
  codes: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
  /** Account and device of the last change (see lib/change-origin.ts). "" for older rows. */
  by?: string;
  device?: string;
}

/** Product family (الفئات), used to group sales in the reports. */
export interface Category {
  name: string;
  description: string;
  /** Target margin in %, 0 = none. */
  marginTarget: number;
  /** An emoji, or a small picture as a data: URL (96×96, fits in one sheet cell). "" = automatic icon. */
  icon: string;
}

/** Longest icon kept: a sheet cell holds 50,000 characters. */
export const MAX_ICON_LENGTH = 45_000;

export function validIcon(icon: unknown): icon is string {
  if (typeof icon !== "string") return false;
  if (icon === "") return true;
  if (icon.startsWith("data:")) return icon.length <= MAX_ICON_LENGTH && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(icon);
  return icon.length <= 16 && !/[<>"'`\s]/.test(icon);
}

/** One line of a sale (المبيعات): every sale is cash and is logged here. */
export interface Sale {
  id: string;
  /** Lines sold together share the ticket (the id of the first line). */
  ticket: string;
  date: string;
  time: string;
  item: string;
  category: string;
  /** Product taken from stock, "" = typed by hand. */
  stockId: string;
  quantity: number;
  /** Total cost of the line, null = unknown (typed by hand without a cost). */
  buyPrice: number | null;
  /** Total suggested price, before any discount. */
  listPrice: number;
  /** Total price paid by the customer. */
  sellPrice: number;
  seller: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** Stock counted in or out by hand (حركات المخزون); sales move stock on their own. */
export interface StockMove {
  id: string;
  stockId: string;
  date: string;
  delta: number;
  /** Codes of a new supplier, added to the product with this delivery. */
  codesIn?: string[];
  reason: string;
  seller: string;
  createdAt: string;
}

/** End of day count of the cash drawer (الصندوق اليومي). */
export interface CaisseClose {
  id: string;
  date: string;
  time: string;
  clerk: string;
  cashSales: number;
  expenses: number;
  expensesNote: string;
  /** What should be in the drawer. */
  expected: number;
  /** What was counted, null = not counted. */
  counted: number | null;
  notes: string;
  createdAt: string;
}

/** A line of the shop's notebook (الكناش): something to remember, or what a customer asked for. */
export const NOTE_KINDS = ["ملاحظة", "طلب زبون"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export interface Note {
  id: string;
  /** When it was written: yyyy-mm-dd, HH:mm. */
  date: string;
  time: string;
  kind: NoteKind;
  text: string;
  /** The customer it is about ("" = none): free text, name and phone. */
  customer: string;
  phone: string;
  /** Ticked off: by whom and when (ISO), "" while open. */
  done: boolean;
  doneBy: string;
  doneAt: string;
  /** When to remind the shop (shop time: yyyy-mm-dd, HH:mm); none = no reminder. */
  remindDate?: string;
  remindTime?: string;
  createdAt: string;
  updatedAt: string;
  /** Who wrote it first, and the account / device of the last change. */
  author: string;
  by?: string;
  origin?: string;
}

/** Where a seller's change waiting for the owner is (طلبات الموافقة). */
export const APPROVAL_STATUSES = ["كتسنى", "تقبل", "ترفض"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/**
 * A sensitive change made by a seller (cancelled sale, new price or cost, stock
 * taken out, product deleted, cash drawer that doesn't match; see lib/approvals.ts):
 * kept aside until the owner accepts it. Only then is `op` applied to the
 * sheet's tabs; refused ones stay, with why.
 */
export interface Approval {
  /** "A-" + the change's own id (the same change sent twice is the same request). */
  id: string;
  /** The change as the seller made it (with who, from which device, when). */
  op: LedgerOp;
  status: ApprovalStatus;
  /** The seller's note to the owner ("" = none). */
  note: string;
  /** The owner's note when deciding: why it was refused, or a word on acceptance. */
  reason: string;
  decidedBy: string;
  decidedAt: string;
  /** = op.at */
  createdAt: string;
  updatedAt: string;
}

/** Changes that can wait for the owner (which ones do is a shop setting, see lib/approvals.ts). */
export const APPROVABLE_OPS = new Set<string>(["sale.delete", "stock.update", "stock.adjust", "stock.delete", "caisse.close"]);

/** A shop-wide setting shared by every device (e.g. the default sticker look), as JSON text. */
export interface Setting {
  key: string;
  value: string;
  updatedAt: string;
}

/** Setting keys in use. */
export const STICKER_LOOK_KEY = "sticker-look";
/** Which sellers' changes wait for the owner: JSON, see lib/approvals.ts. */
export const APPROVAL_RULES_KEY = "approval-rules";

export interface Ledger {
  stock: StockItem[];
  categories: Category[];
  sales: Sale[];
  moves: StockMove[];
  closings: CaisseClose[];
  settings: Setting[];
  approvals: Approval[];
  notes: Note[];
}

export function emptyLedger(): Ledger {
  return { stock: [], categories: [], sales: [], moves: [], closings: [], settings: [], approvals: [], notes: [] };
}

export const EMPTY_LEDGER: Ledger = emptyLedger();

/** A ledger saved by an older version of the app (before the shop tabs) gets the missing lists. */
export function normalizeLedger(l: Partial<Ledger> | null | undefined): Ledger {
  const full = { ...emptyLedger(), ...(l ?? {}) } as Ledger;
  return { ...full, stock: full.stock.map((s) => (Array.isArray(s.codes) ? s : { ...s, codes: [] })) };
}

/** Every code of a product: the main one and the other suppliers'. */
export function productCodes(s: Pick<StockItem, "serial" | "codes">): string[] {
  return [s.serial, ...(s.codes ?? [])].map((x) => x.trim()).filter(Boolean);
}

// ---------------------------------------------------------------- ids

const ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I: easy to read on a receipt

/**
 * "V-7K2QXM9A": prefix O (operation), I (stock item), V (sale), M (stock move),
 * K (cash drawer closing), A (approval request), N (notebook line).
 */
export type IdPrefix = "O" | "I" | "V" | "M" | "K" | "A" | "N";
export function newLedgerId(prefix: IdPrefix): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return `${prefix}-${Array.from(bytes, (b) => ID_CHARS[b % ID_CHARS.length]).join("")}`;
}

const ID_RE = /^[OIVMKAN]-[A-Z0-9]{4,16}$/;
export const isLedgerId = (s: unknown): s is string => typeof s === "string" && ID_RE.test(s);

// ---------------------------------------------------------------- operations

type OpBody =
  | { type: "stock.add"; item: StockItem }
  | {
      type: "stock.update";
      id: string;
      base: string;
      patch: Partial<Pick<StockItem, "item" | "category" | "condition" | "buyPrice" | "sellPrice" | "serial" | "codes" | "notes">>;
    }
  | { type: "stock.adjust"; move: StockMove }
  | { type: "stock.delete"; id: string }
  | { type: "category.save"; category: Category }
  /** A seller's change kept aside for the owner (see Approval). */
  | { type: "approval.add"; id: string; op: LedgerOp }
  /** The owner accepts (the change and what it needs are applied) or refuses (with what was built on it). */
  | { type: "approval.decide"; id: string; decision: "accept" | "refuse"; reason: string }
  /** The notebook (الكناش). */
  | { type: "note.add"; note: Note }
  | { type: "note.update"; id: string; base: string; patch: Partial<Pick<Note, "date" | "time" | "kind" | "text" | "customer" | "phone" | "done" | "remindDate" | "remindTime">> }
  | { type: "note.delete"; id: string }
  /** The seller who made a waiting change writes (or changes) a note to the owner. */
  | { type: "approval.note"; id: string; note: string }
  /** A shop-wide setting (key → JSON text), e.g. the default sticker look. */
  | { type: "setting.save"; key: string; value: string }
  /** Lines sold together (one ticket). */
  | { type: "sale.add"; lines: Sale[] }
  /** Cancel one line: the product goes back to stock. */
  | { type: "sale.delete"; id: string }
  | { type: "caisse.close"; close: CaisseClose };

export type LedgerOp = OpBody & {
  /** Unique id of this change. */
  opId: string;
  /** When it was made (ISO). Becomes the record's updatedAt. */
  at: string;
  /** Account that made it (stamped by the server) and the device it came from (see lib/change-origin.ts). */
  by?: string;
  device?: string;
};

/** Who and where a change came from, kept on the product it changes. */
const origin = (op: LedgerOp) => ({ by: op.by ?? "", device: op.device ?? "" });

export type OpResult = "ok" | "already" | "conflict" | "invalid";

export interface Applied {
  ledger: Ledger;
  result: OpResult;
  message?: string;
}

const CONFLICT = "تبدلات هاد المعلومات من جهاز آخر قبل ما توصل هاد التعديلات.";

function invalid(ledger: Ledger, message: string): Applied {
  return { ledger, result: "invalid", message };
}

const text = (v: unknown, max = 500) => typeof v === "string" && v.length <= max;
const money = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100_000_000;
const date = (v: unknown) => typeof v === "string" && (v === "" || isISODate(v));
const time = (v: unknown) => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

const amount = (v: unknown) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 100_000_000;

/** A list of product codes: short, one line each, no repeats. */
function codeList(v: unknown): v is string[] {
  if (!Array.isArray(v) || v.length > 200) return false;
  if (!v.every((x) => typeof x === "string" && x.trim() !== "" && x.length <= 100 && !/[\n\r]/.test(x))) return false;
  return new Set(v.map((x) => x.trim().toLowerCase())).size === v.length;
}

/** A code already used by another product, if any (a code must lead to one product only). */
function codeTaken(ledger: Ledger, codes: string[], exceptId: string): string | undefined {
  const mine = codes.map((x) => x.trim().toLowerCase()).filter(Boolean);
  for (const s of ledger.stock) {
    if (s.id === exceptId) continue;
    const theirs = productCodes(s).map((x) => x.toLowerCase());
    const hit = mine.find((x) => theirs.includes(x));
    if (hit) return `«${hit}» مستعمل ديجا فـ «${s.item}»`;
  }
  return undefined;
}

function checkNote(n: Note): string | null {
  if (!isLedgerId(n.id) || !n.id.startsWith("N-")) return "رقم الملاحظة غير صحيح";
  if (!date(n.date) || !n.date || !time(n.time)) return "التاريخ ولا الساعة غير صحيحين";
  if (!NOTE_KINDS.includes(n.kind)) return "النوع غير صحيح";
  if (!text(n.text, 2000) || !n.text.trim()) return "كتب شي حاجة";
  if (!text(n.customer, 200) || !text(n.phone, 40)) return "معلومات الزبون غير صحيحة";
  if (typeof n.done !== "boolean" || !text(n.doneBy, 100) || !text(n.doneAt, 40)) return "الحالة غير صحيحة";
  const rd = n.remindDate ?? "";
  const rt = n.remindTime ?? "";
  if (!date(rd) || (rt !== "" && !time(rt)) || (rd === "") !== (rt === "")) return "وقت التذكير غير صحيح";
  return null;
}

function checkStock(s: StockItem): string | null {
  if (!isLedgerId(s.id) || !s.id.startsWith("I-")) return "رقم السلعة غير صحيح";
  if (!text(s.item, 300) || !s.item.trim()) return "اسم السلعة ضروري";
  if (!text(s.category, 100) || !text(s.serial, 100) || !text(s.notes, 1000)) return "معلومات السلعة غير صحيحة";
  if (!CONDITIONS.includes(s.condition)) return "الحالة غير صحيحة";
  if (!money(s.buyPrice) || !money(s.sellPrice)) return "الثمن غير صحيح";
  if (!amount(s.quantity) || !Number.isInteger(s.quantity)) return "الكمية غير صحيحة";
  if (!codeList(s.codes ?? []) || new Set(productCodes(s).map((x) => x.toLowerCase())).size !== productCodes(s).length) return "الأكواد غير صحيحة ولا مكررة";
  return null;
}

function checkSale(s: Sale): string | null {
  if (!isLedgerId(s.id) || !s.id.startsWith("V-") || !isLedgerId(s.ticket)) return "رقم البيع غير صحيح";
  if (!text(s.item, 300) || !s.item.trim() || !text(s.category, 100)) return "السلعة ضرورية";
  if (!Number.isInteger(s.quantity) || s.quantity < 1 || s.quantity > 10_000) return "الكمية غير صحيحة";
  if (!money(s.sellPrice) || !money(s.listPrice) || (s.buyPrice !== null && !money(s.buyPrice))) return "الثمن غير صحيح";
  if (!date(s.date) || !s.date || !time(s.time) || !text(s.createdAt, 40)) return "التاريخ غير صحيح";
  if (!text(s.seller, 100) || !text(s.notes, 1000)) return "معلومات البيع غير صحيحة";
  if (s.stockId && !isLedgerId(s.stockId)) return "السلعة غير صحيحة";
  return null;
}

/** Keep only the fields an edit is allowed to change (data from the network is not trusted). */
function pick<T extends object>(patch: unknown, keys: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  if (patch && typeof patch === "object") {
    for (const k of keys) if (k in patch) out[k] = (patch as T)[k];
  }
  return out;
}

function replace<T extends { id: string }>(list: T[], id: string, next: T): T[] {
  return list.map((x) => (x.id === id ? next : x));
}

/**
 * Apply one change. Never mutates `ledger`.
 * - "already": this exact change is already there (sent twice) → nothing to do.
 * - "conflict": the record was changed elsewhere since this change was made.
 * - "invalid": refused (bad values, unknown customer…).
 */
export function applyOp(ledger: Ledger, op: LedgerOp): Applied {
  switch (op.type) {
    case "stock.add": {
      if (!op.item || typeof op.item !== "object") return invalid(ledger, "السلعة غير صحيحة");
      if (ledger.stock.some((s) => s.id === op.item.id)) return { ledger, result: "already" };
      const item = { ...op.item, codes: op.item.codes ?? [] };
      const err = checkStock(item) ?? codeTaken(ledger, productCodes(item), item.id);
      if (err) return invalid(ledger, err);
      return { ledger: { ...ledger, stock: [...ledger.stock, { ...item, updatedAt: op.at, ...origin(op) }] }, result: "ok" };
    }
    case "stock.update": {
      const s = ledger.stock.find((x) => x.id === op.id);
      if (!s) return invalid(ledger, "هاد السلعة ما بقاتش فالمخزون");
      if (s.updatedAt === op.at) return { ledger, result: "already" };
      if (s.updatedAt !== op.base) return { ledger, result: "conflict", message: CONFLICT };
      const next = { ...s, ...pick<StockItem>(op.patch, ["item", "category", "condition", "buyPrice", "sellPrice", "serial", "codes", "notes"]), updatedAt: op.at, ...origin(op) };
      const err = checkStock(next) ?? codeTaken(ledger, productCodes(next), next.id);
      if (err) return invalid(ledger, err);
      return { ledger: { ...ledger, stock: replace(ledger.stock, s.id, next) }, result: "ok" };
    }
    case "stock.adjust": {
      const m = op.move;
      if (!m || typeof m !== "object") return invalid(ledger, "الكمية غير صحيحة");
      if (ledger.moves.some((x) => x.id === m.id)) return { ledger, result: "already" };
      const s = ledger.stock.find((x) => x.id === m.stockId);
      if (!s) return invalid(ledger, "هاد السلعة ما بقاتش فالمخزون");
      if (!isLedgerId(m.id) || !m.id.startsWith("M-") || !Number.isInteger(m.delta) || (!m.delta && !m.codesIn?.length) || !amount(m.delta)) {
        return invalid(ledger, "الكمية غير صحيحة");
      }
      if (!date(m.date) || !text(m.reason, 300) || !text(m.seller, 100)) return invalid(ledger, "معلومات غير صحيحة");
      const codesIn = m.codesIn ?? [];
      if (!codeList(codesIn)) return invalid(ledger, "الأكواد غير صحيحة");
      const taken = codeTaken(ledger, codesIn, s.id);
      if (taken) return invalid(ledger, taken);
      const have = productCodes(s).map((x) => x.toLowerCase());
      const added = codesIn.map((x) => x.trim()).filter((x) => !have.includes(x.toLowerCase()));
      // A difference, not a new total: counts from two phones add up instead of overwriting each other.
      // `updatedAt` only moves when new codes come in (a field edit), as for sales.
      const next = { ...s, quantity: s.quantity + m.delta, codes: [...s.codes, ...added], ...(added.length ? { updatedAt: op.at } : {}), ...origin(op) };
      return { ledger: { ...ledger, stock: replace(ledger.stock, s.id, next), moves: [...ledger.moves, m] }, result: "ok" };
    }
    case "stock.delete": {
      if (!ledger.stock.some((s) => s.id === op.id)) return { ledger, result: "already" };
      return { ledger: { ...ledger, stock: ledger.stock.filter((s) => s.id !== op.id) }, result: "ok" };
    }
    case "category.save": {
      const c = op.category;
      if (!c || !text(c.name, 100) || !c.name.trim() || !text(c.description, 300) || !money(c.marginTarget) || c.marginTarget > 1000) {
        return invalid(ledger, "الفئة غير صحيحة");
      }
      const icon = c.icon ?? "";
      if (!validIcon(icon)) return invalid(ledger, "الأيقونة غير صحيحة ولا كبيرة بزاف");
      const clean = { name: c.name.trim(), description: c.description.trim(), marginTarget: c.marginTarget, icon };
      const old = ledger.categories.find((x) => x.name === clean.name);
      if (old && old.description === clean.description && old.marginTarget === clean.marginTarget && old.icon === clean.icon) return { ledger, result: "already" };
      const categories = old ? ledger.categories.map((x) => (x.name === clean.name ? clean : x)) : [...ledger.categories, clean];
      return { ledger: { ...ledger, categories }, result: "ok" };
    }
    case "approval.add": {
      const inner = op.op;
      if (!inner || typeof inner !== "object" || !APPROVABLE_OPS.has(inner.type) || typeof inner.opId !== "string" || typeof inner.at !== "string" || Number.isNaN(Date.parse(inner.at))) {
        return invalid(ledger, "الطلب غير صحيح");
      }
      if (!isLedgerId(op.id) || !op.id.startsWith("A-") || JSON.stringify(inner).length > 40_000) return invalid(ledger, "الطلب غير صحيح");
      if (ledger.approvals.some((a) => a.id === op.id)) return { ledger, result: "already" };
      const a: Approval = { id: op.id, op: { ...inner, by: op.by ?? inner.by ?? "", device: op.device ?? inner.device ?? "" }, status: "كتسنى", note: "", reason: "", decidedBy: "", decidedAt: "", createdAt: inner.at, updatedAt: op.at };
      return { ledger: { ...ledger, approvals: [...ledger.approvals, a] }, result: "ok" };
    }
    case "approval.decide": {
      const a = ledger.approvals.find((x) => x.id === op.id);
      if (!a) return invalid(ledger, "هاد الطلب ما بقاش");
      if (a.status !== "كتسنى") return a.decidedAt === op.at ? { ledger, result: "already" } : invalid(ledger, "هاد الطلب تقرر ديجا");
      if (!text(op.reason ?? "", 300)) return invalid(ledger, "السبب طويل بزاف");
      const waiting = ledger.approvals.filter((x) => x.status === "كتسنى");
      const done = (ids: Set<string>, status: ApprovalStatus) => (l: Ledger): Ledger => ({
        ...l,
        approvals: l.approvals.map((x) =>
          // The owner's note goes on the request decided; the ones taken with it get none.
          ids.has(x.id) ? { ...x, status, reason: x.id === a.id ? (op.reason ?? "").trim() : "", decidedBy: op.by ?? "", decidedAt: op.at, updatedAt: op.at } : x,
        ),
      });
      if (op.decision === "refuse") {
        const ids = new Set(refusalCascade(waiting, a).map((x) => x.id));
        return { ledger: done(ids, "ترفض")(ledger), result: "ok" };
      }
      if (op.decision !== "accept") return invalid(ledger, "القرار غير صحيح");
      // What this change needs (an earlier waiting edit of the same product…) is accepted with it.
      const chain = approvalChain(waiting, a);
      let l = ledger;
      for (const x of chain) {
        const r = applyOp(l, x.op);
        if (r.result === "invalid" || r.result === "conflict") {
          return invalid(ledger, `ما يمكنش يتقبل: ${r.message ?? CONFLICT}`);
        }
        l = r.ledger;
      }
      return { ledger: done(new Set(chain.map((x) => x.id)), "تقبل")(l), result: "ok" };
    }
    case "note.add": {
      const n = op.note;
      if (!n || typeof n !== "object") return invalid(ledger, "الملاحظة غير صحيحة");
      if (ledger.notes.some((x) => x.id === n.id)) return { ledger, result: "already" };
      const next: Note = { ...n, done: false, doneBy: "", doneAt: "", updatedAt: op.at, author: op.by ?? "", by: op.by ?? "", origin: op.device ?? "" };
      const err = checkNote(next);
      if (err) return invalid(ledger, err);
      return { ledger: { ...ledger, notes: [...ledger.notes, next] }, result: "ok" };
    }
    case "note.update": {
      const n = ledger.notes.find((x) => x.id === op.id);
      if (!n) return invalid(ledger, "هاد الملاحظة ما بقاتش");
      if (n.updatedAt === op.at) return { ledger, result: "already" };
      if (n.updatedAt !== op.base) return { ledger, result: "conflict", message: CONFLICT };
      const patch = pick<Note>(op.patch, ["date", "time", "kind", "text", "customer", "phone", "done", "remindDate", "remindTime"]);
      // Ticking it off records who and when; unticking clears it.
      const tick = patch.done === undefined || patch.done === n.done ? {} : patch.done ? { doneBy: op.by ?? "", doneAt: op.at } : { doneBy: "", doneAt: "" };
      const next: Note = { ...n, ...patch, ...tick, updatedAt: op.at, by: op.by ?? "", origin: op.device ?? "" };
      const err = checkNote(next);
      if (err) return invalid(ledger, err);
      return { ledger: { ...ledger, notes: replace(ledger.notes, n.id, next) }, result: "ok" };
    }
    case "note.delete": {
      if (!ledger.notes.some((x) => x.id === op.id)) return { ledger, result: "already" };
      return { ledger: { ...ledger, notes: ledger.notes.filter((x) => x.id !== op.id) }, result: "ok" };
    }
    case "approval.note": {
      const a = ledger.approvals.find((x) => x.id === op.id);
      if (!a) return invalid(ledger, "هاد الطلب ما بقاش");
      if (a.updatedAt === op.at) return { ledger, result: "already" };
      if (a.status !== "كتسنى") return invalid(ledger, "هاد الطلب تقرر ديجا");
      // Only the seller who made the change (the server stamps who sends it).
      if (!op.by || op.by !== a.op.by) return invalid(ledger, "غير البائع لي دار هاد التعديل يقدر يكتب الملاحظة");
      if (typeof op.note !== "string" || !text(op.note, 300)) return invalid(ledger, "الملاحظة طويلة بزاف");
      return { ledger: { ...ledger, approvals: ledger.approvals.map((x) => (x.id === a.id ? { ...x, note: op.note.trim(), updatedAt: op.at } : x)) }, result: "ok" };
    }
    case "setting.save": {
      if (typeof op.key !== "string" || !/^[a-z0-9-]{1,40}$/.test(op.key) || typeof op.value !== "string" || op.value.length > 20_000) {
        return invalid(ledger, "الإعداد غير صحيح");
      }
      const old = ledger.settings.find((x) => x.key === op.key);
      if (old?.updatedAt === op.at) return { ledger, result: "already" };
      const next = { key: op.key, value: op.value, updatedAt: op.at };
      const settings = old ? ledger.settings.map((x) => (x.key === op.key ? next : x)) : [...ledger.settings, next];
      return { ledger: { ...ledger, settings }, result: "ok" };
    }
    case "sale.add": {
      const lines = Array.isArray(op.lines) ? op.lines : [];
      if (!lines.length || lines.length > 50) return invalid(ledger, "البيع خاوي");
      if (lines.every((l) => ledger.sales.some((s) => s.id === l.id))) return { ledger, result: "already" };
      if (lines.some((l) => !l || typeof l !== "object")) return invalid(ledger, "البيع غير صحيح");
      for (const l of lines) {
        const err = checkSale(l);
        if (err) return invalid(ledger, err);
        if (ledger.sales.some((s) => s.id === l.id)) return invalid(ledger, "رقم البيع مكرر");
        if (l.ticket !== lines[0].ticket) return invalid(ledger, "رقم التيكي غير صحيح");
      }
      // Products from stock go out (unknown ones are simply not tracked).
      const out = new Map<string, number>();
      for (const l of lines) if (l.stockId && ledger.stock.some((s) => s.id === l.stockId)) out.set(l.stockId, (out.get(l.stockId) ?? 0) + l.quantity);
      // Only the quantity moves (a difference): `updatedAt` stays, so an edit of the product made
      // meanwhile (or waiting for the owner) is not refused as a conflict.
      const stock = ledger.stock.map((s) => (out.has(s.id) ? { ...s, quantity: s.quantity - out.get(s.id)!, ...origin(op) } : s));
      return {
        ledger: {
          ...ledger,
          stock,
          sales: [...ledger.sales, ...lines.map((l) => ({ ...l, stockId: out.has(l.stockId) ? l.stockId : "", updatedAt: op.at }))],
        },
        result: "ok",
      };
    }
    case "sale.delete": {
      const s = ledger.sales.find((x) => x.id === op.id);
      if (!s) return { ledger, result: "already" };
      return { ledger: { ...restock(ledger, [s], op), sales: ledger.sales.filter((x) => x.id !== s.id) }, result: "ok" };
    }
    case "caisse.close": {
      const k = op.close;
      if (!k || typeof k !== "object") return invalid(ledger, "معلومات الصندوق غير صحيحة");
      if (ledger.closings.some((x) => x.id === k.id)) return { ledger, result: "already" };
      if (!isLedgerId(k.id) || !k.id.startsWith("K-") || !date(k.date) || !k.date || !time(k.time)) return invalid(ledger, "معلومات الصندوق غير صحيحة");
      if (!text(k.clerk, 100) || !text(k.expensesNote, 500) || !text(k.notes, 1000)) return invalid(ledger, "معلومات الصندوق غير صحيحة");
      if (![k.cashSales, k.expected].every(amount) || !money(k.expenses) || (k.counted !== null && !money(k.counted))) {
        return invalid(ledger, "المبالغ غير صحيحة");
      }
      return { ledger: { ...ledger, closings: [...ledger.closings, k] }, result: "ok" };
    }
  }
}

/** Cancelled sales give their products back to stock (a quantity change only, like a sale). */
function restock(ledger: Ledger, sales: Sale[], op: LedgerOp): Ledger {
  const back = new Map<string, number>();
  for (const s of sales) if (s.stockId) back.set(s.stockId, (back.get(s.stockId) ?? 0) + s.quantity);
  if (!back.size) return ledger;
  return { ...ledger, stock: ledger.stock.map((x) => (back.has(x.id) ? { ...x, quantity: x.quantity + back.get(x.id)!, ...origin(op) } : x)) };
}

export function applyOps(ledger: Ledger, ops: LedgerOp[]): Ledger {
  return ops.reduce((l, op) => applyOp(l, op).ledger, ledger);
}

export function nowParts(now = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Casablanca",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

export { addDays };
