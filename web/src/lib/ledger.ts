// The shop's credit ledger: customers, their purchases, their payments and the
// history of their instalment (الطريطة). One debt per customer = everything they
// bought minus everything they paid.
//
// Every change is an operation with its own id. The same `applyOp` runs on the
// phone (to show the change at once, even offline) and on the server (to save
// it in the Google Sheet), so both always agree. Operations are safe to send
// twice: a second copy is recognised and skipped.

import { approvalChain, refusalCascade } from "./approval-deps";
import { addDays, addMonths, addPeriods, dueStatus, isISODate, isManualPeriod, nextDateForPeriod, type DueStatus } from "./sheet-logic";

export interface Client {
  id: string;
  name: string;
  /** Main number: the one used for WhatsApp. */
  phone: string;
  /** More numbers (wife, work, other SIM…), to call or find the customer. */
  phones?: string[];
  /** Agreed instalment in dirhams, 0 = not set. */
  installment: number;
  /** سيمانة / 15 يوم / شهر / تحديد يدوي */
  period: string;
  /** yyyy-mm-dd or "" */
  nextDueDate: string;
  notes: string;
  /** 0 = normal (default), 1 = special: accounts set to «special only» follow just these. */
  type?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Purchase {
  id: string;
  clientId: string;
  /** yyyy-mm-dd */
  date: string;
  item: string;
  price: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export const PAYMENT_KINDS = ["تسبيق", "دفعة"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export interface Payment {
  id: string;
  clientId: string;
  /** The purchase this payment is for, "" = general. */
  purchaseId: string;
  /** yyyy-mm-dd */
  date: string;
  /** HH:mm */
  time: string;
  amount: number;
  kind: PaymentKind;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface InstallmentChange {
  id: string;
  clientId: string;
  date: string;
  oldAmount: number;
  newAmount: number;
  oldPeriod: string;
  newPeriod: string;
  reason: string;
  createdAt: string;
}

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

export const SALE_TYPES = ["كاش", "كريدي"] as const;
export type SaleType = (typeof SALE_TYPES)[number];

/** One line of a sale (المبيعات): every sale, cash or credit, is logged here. */
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
  type: SaleType;
  /** Credit only. */
  clientId: string;
  /** Credit only: the purchase on the customer's account. */
  purchaseId: string;
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
  advances: number;
  installments: number;
  /** Advances paid on repairs brought that day (0 in closings made before repairs counted). */
  repairs?: number;
  expenses: number;
  expensesNote: string;
  /** What should be in the drawer. */
  expected: number;
  /** What was counted, null = not counted. */
  counted: number | null;
  notes: string;
  createdAt: string;
}

/** Where a device brought for repair is (الإصلاح). */
export const REPAIR_STATUSES = ["مستلم", "فالإصلاح", "واجد", "تسلم", "ما تصلحش"] as const;
export type RepairStatus = (typeof REPAIR_STATUSES)[number];

/** A device brought by a customer to be repaired (tab الإصلاح). */
export interface Repair {
  id: string;
  /** Its own barcode (EAN-13 starting with 2, like the shop's products), on the sticker stuck on the device. */
  code: string;
  /** When it was brought: yyyy-mm-dd, HH:mm. */
  date: string;
  time: string;
  owner: string;
  phone: string;
  /** The device: «Samsung A15», «Machine à laver Candy»… */
  device: string;
  problem: string;
  /** Price of the repair (first estimate; corrected when the device is given back), and the advance paid when it was brought. */
  price: number;
  advance: number;
  /** When the owner collected it ("" while still in the shop) and what they paid then. */
  deliveredDate: string;
  deliveredTime: string;
  paid: number;
  /** What the repair cost the shop (parts, extra work not charged to the customer). */
  cost: number;
  status: RepairStatus;
  notes: string;
  /** Photo of the device as a small data: URL (fits one sheet cell), "" = none. */
  photo: string;
  createdAt: string;
  updatedAt: string;
  /** Account and device that made the last change (see lib/change-origin.ts). */
  by?: string;
  origin?: string;
}

/** Where a request sent to a brand's after-sales service is (خدمة الشركة). */
export const CLAIM_STATUSES = ["تصيفط", "كيتصلح", "تحل"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/**
 * A product we sold has a fault the brand's after-sales service must repair:
 * the request sent to them on WhatsApp, followed until it is solved.
 */
export interface Claim {
  id: string;
  /** When the request was sent: yyyy-mm-dd, HH:mm. */
  date: string;
  time: string;
  /** The customer the service must call (typed in the form, not tied to الزبناء). */
  customer: string;
  phone: string;
  item: string;
  /** When we sold it ("" = not known). */
  saleDate: string;
  /** The after-sales service: brand name and its WhatsApp number, as they were when sent. */
  company: string;
  servicePhone: string;
  problem: string;
  status: ClaimStatus;
  /** ISO time of the last message sent to the service (the request, then each reminder): the 48 h run from it. */
  lastSentAt: string;
  reminders: number;
  /** When it was solved ("" while open). */
  resolvedDate: string;
  resolvedTime: string;
  notes: string;
  /** Where the product comes from, "" when typed by hand: credit customer, their purchase, the sale line. */
  clientId: string;
  purchaseId: string;
  saleId: string;
  createdAt: string;
  updatedAt: string;
  /** Account and device that made the last change (see lib/change-origin.ts). */
  by?: string;
  origin?: string;
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
  /** The customer it is about ("" = none): typed, or filled from الزبناء by the phone. */
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

/** Where a seller's credit change is (طلبات الموافقة). */
export const APPROVAL_STATUSES = ["كتسنى", "تقبل", "ترفض"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/**
 * A credit change made by a seller (new customer, credit sale, payment,
 * instalment, edit, deletion): kept aside until the owner accepts it. Only
 * then is `op` applied to the customers' tabs; refused ones stay, with why.
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

/** Changes a seller makes that need the owner's approval: everything about credit. */
export const CREDIT_OPS = new Set<string>([
  "client.add", "client.update", "client.delete", "client.installment",
  "purchase.add", "purchase.update", "purchase.delete",
  "payment.add", "payment.update", "payment.delete",
  "sale.add", "sale.delete",
]);

/** A shop-wide setting shared by every device (e.g. the default sticker look), as JSON text. */
export interface Setting {
  key: string;
  value: string;
  updatedAt: string;
}

/** Setting keys in use. */
export const STICKER_LOOK_KEY = "sticker-look";
/** After-sales services of the brands (خدمة العملاء): JSON list, see lib/claims.ts. */
export const SERVICE_CONTACTS_KEY = "service-contacts";
/** The WhatsApp reminders' texts with [variables] (see lib/reminder-templates.ts). */
export const REMINDER_TEMPLATES_KEY = "reminder-templates";

export interface Ledger {
  clients: Client[];
  purchases: Purchase[];
  payments: Payment[];
  changes: InstallmentChange[];
  stock: StockItem[];
  categories: Category[];
  sales: Sale[];
  moves: StockMove[];
  closings: CaisseClose[];
  settings: Setting[];
  repairs: Repair[];
  claims: Claim[];
  approvals: Approval[];
  notes: Note[];
}

export function emptyLedger(): Ledger {
  return { clients: [], purchases: [], payments: [], changes: [], stock: [], categories: [], sales: [], moves: [], closings: [], settings: [], repairs: [], claims: [], approvals: [], notes: [] };
}

export const EMPTY_LEDGER: Ledger = emptyLedger();

/** A ledger saved by an older version of the app (before the shop tabs) gets the missing lists. */
export function normalizeLedger(l: Partial<Ledger> | null | undefined): Ledger {
  const full = { ...emptyLedger(), ...(l ?? {}) } as Ledger;
  return { ...full, stock: full.stock.map((s) => (Array.isArray(s.codes) ? s : { ...s, codes: [] })) };
}

/** Every number of a customer: the main one first, then the others. */
export function clientPhones(c: Pick<Client, "phone" | "phones">): string[] {
  return [c.phone, ...(c.phones ?? [])].map((x) => x.trim()).filter(Boolean);
}

/** Every code of a product: the main one and the other suppliers'. */
export function productCodes(s: Pick<StockItem, "serial" | "codes">): string[] {
  return [s.serial, ...(s.codes ?? [])].map((x) => x.trim()).filter(Boolean);
}

// ---------------------------------------------------------------- ids

const ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I: easy to read on a receipt

/**
 * "C-7K2QXM9A": prefix C (client), S (purchase), P (payment), T (instalment change), O (operation),
 * I (stock item), V (sale), M (stock move), K (cash drawer closing).
 */
export type IdPrefix = "C" | "S" | "P" | "T" | "O" | "I" | "V" | "M" | "K" | "R" | "W" | "A" | "N";
export function newLedgerId(prefix: IdPrefix): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return `${prefix}-${Array.from(bytes, (b) => ID_CHARS[b % ID_CHARS.length]).join("")}`;
}

const ID_RE = /^[CSPTOIVMKRWAN]-[A-Z0-9]{4,16}$/;
export const isLedgerId = (s: unknown): s is string => typeof s === "string" && ID_RE.test(s);

// ---------------------------------------------------------------- operations

type OpBody =
  | { type: "client.add"; client: Client }
  | { type: "client.update"; id: string; base: string; patch: Partial<Pick<Client, "name" | "phone" | "phones" | "notes" | "nextDueDate" | "type">> }
  /** withHistory: also delete their purchases, payments and instalment changes (their sales are cancelled). */
  | { type: "client.delete"; id: string; withHistory?: boolean }
  | { type: "client.installment"; id: string; base: string; change: InstallmentChange; nextDueDate?: string }
  | { type: "purchase.add"; purchase: Purchase }
  | { type: "purchase.update"; id: string; base: string; patch: Partial<Pick<Purchase, "date" | "item" | "price" | "notes">> }
  | { type: "purchase.delete"; id: string }
  | { type: "payment.add"; payment: Payment; nextDueDate?: string }
  | {
      type: "payment.update";
      id: string;
      base: string;
      patch: Partial<Pick<Payment, "clientId" | "purchaseId" | "date" | "time" | "amount" | "kind" | "notes">>;
    }
  | { type: "payment.delete"; id: string }
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
  | { type: "repair.add"; repair: Repair }
  | { type: "repair.update"; id: string; base: string; patch: Partial<Omit<Repair, "id" | "createdAt" | "updatedAt" | "by" | "origin">> }
  | { type: "repair.delete"; id: string }
  | { type: "claim.add"; claim: Claim }
  | { type: "claim.update"; id: string; base: string; patch: Partial<Omit<Claim, "id" | "createdAt" | "updatedAt" | "by" | "origin">> }
  | { type: "claim.delete"; id: string }
  /** A seller's credit change, kept aside for the owner (see Approval). */
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
  /** Lines sold together; a credit sale also brings the purchases for the customer's account. */
  | { type: "sale.add"; lines: Sale[]; purchases: Purchase[] }
  /** Cancel one line: the product goes back to stock, its purchase leaves the customer's account. */
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

function checkClient(c: Client): string | null {
  if (!isLedgerId(c.id) || !c.id.startsWith("C-")) return "رقم الزبون غير صحيح";
  if (!text(c.name, 200) || !c.name.trim()) return "الاسم ضروري";
  if (!text(c.phone, 40) || !text(c.period, 40) || !text(c.notes, 1000)) return "معلومات الزبون غير صحيحة";
  const more = c.phones ?? [];
  if (!Array.isArray(more) || more.length > 10 || !more.every((x) => typeof x === "string" && x.trim() !== "" && x.length <= 40 && !/[\n\r]/.test(x))) {
    return "أرقام الهاتف الأخرى غير صحيحة";
  }
  if (!money(c.installment)) return "مبلغ الطريطة غير صحيح";
  if (c.type !== undefined && c.type !== 0 && c.type !== 1) return "نوع الزبون غير صحيح";
  if (!date(c.nextDueDate) || !text(c.createdAt, 40)) return "التاريخ غير صحيح";
  return null;
}

function checkPurchase(p: Purchase): string | null {
  if (!isLedgerId(p.id) || !p.id.startsWith("S-") || !isLedgerId(p.clientId)) return "رقم العملية غير صحيح";
  if (!text(p.item, 300) || !p.item.trim()) return "السلعة ضرورية";
  if (!money(p.price) || p.price <= 0) return "ثمن البيع غير صحيح";
  if (!date(p.date) || !p.date || !text(p.createdAt, 40)) return "التاريخ غير صحيح";
  if (!text(p.notes, 1000)) return "الملاحظة طويلة بزاف";
  return null;
}

function checkPayment(p: Payment): string | null {
  if (!isLedgerId(p.id) || !p.id.startsWith("P-") || !isLedgerId(p.clientId)) return "رقم الوصل غير صحيح";
  if (p.purchaseId && !isLedgerId(p.purchaseId)) return "السلعة غير صحيحة";
  if (!money(p.amount) || p.amount <= 0) return "المبلغ غير صحيح";
  if (!date(p.date) || !p.date || !time(p.time) || !text(p.createdAt, 40)) return "التاريخ غير صحيح";
  if (!PAYMENT_KINDS.includes(p.kind)) return "نوع الدفعة غير صحيح";
  if (!text(p.notes, 1000)) return "الملاحظة طويلة بزاف";
  return null;
}

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

/** Photo of a repaired device: a small data: URL that fits one sheet cell, and one Excel cell (backup). */
export const MAX_PHOTO_LENGTH = 32_000;

function checkRepair(r: Repair, ledger: Ledger): string | null {
  if (!isLedgerId(r.id) || !r.id.startsWith("R-")) return "رقم الإصلاح غير صحيح";
  if (!/^2\d{12}$/.test(r.code)) return "الباركود ديال الإصلاح غير صحيح";
  if (!date(r.date) || !r.date || !time(r.time)) return "التاريخ ولا الساعة غير صحيحين";
  if (!text(r.owner, 200) || !r.owner.trim()) return "سمية مول الجهاز ضرورية";
  if (!text(r.phone, 40) || !text(r.device, 200) || !r.device.trim() || !text(r.problem, 1000) || !text(r.notes, 1000)) return "معلومات الإصلاح غير صحيحة";
  if (!money(r.price) || !money(r.advance) || !money(r.paid) || !money(r.cost)) return "الثمن، التسبيق، الخلاص ولا التكاليف غير صحيح";
  if (!date(r.deliveredDate) || (r.deliveredTime !== "" && !time(r.deliveredTime))) return "تاريخ التسليم غير صحيح";
  if (r.status === "تسلم" && !r.deliveredDate) return "تاريخ التسليم ضروري";
  if (!REPAIR_STATUSES.includes(r.status)) return "الحالة غير صحيحة";
  if (typeof r.photo !== "string" || r.photo.length > MAX_PHOTO_LENGTH || (r.photo && !/^data:image\/(jpeg|webp|png);base64,/.test(r.photo))) return "الصورة غير صحيحة ولا كبيرة بزاف";
  // A repair's barcode never matches a product or another repair.
  const taken = codeTaken(ledger, [r.code], "") ?? ledger.repairs.find((x) => x.id !== r.id && x.code === r.code)?.device;
  if (taken) return `الباركود «${r.code}» مستعمل ديجا`;
  return null;
}

function checkClaim(c: Claim): string | null {
  if (!isLedgerId(c.id) || !c.id.startsWith("W-")) return "رقم الطلب غير صحيح";
  if (!date(c.date) || !c.date || !time(c.time)) return "التاريخ ولا الساعة غير صحيحين";
  if (!text(c.customer, 200) || !c.customer.trim()) return "سمية الزبون ضرورية";
  if (!text(c.item, 300) || !c.item.trim()) return "السلعة ضرورية";
  if (!text(c.company, 200) || !c.company.trim() || !text(c.servicePhone, 40) || !c.servicePhone.trim()) return "خدمة الصيانة ديال الشركة ضرورية";
  if (!text(c.phone, 40) || !text(c.problem, 1000) || !c.problem.trim() || !text(c.notes, 1000)) return "معلومات الطلب غير صحيحة";
  if (!date(c.saleDate) || !date(c.resolvedDate) || (c.resolvedTime !== "" && !time(c.resolvedTime))) return "التاريخ غير صحيح";
  if (!CLAIM_STATUSES.includes(c.status)) return "الحالة غير صحيحة";
  if (c.status === "تحل" && !c.resolvedDate) return "تاريخ الحل ضروري";
  if (typeof c.lastSentAt !== "string" || Number.isNaN(Date.parse(c.lastSentAt))) return "وقت آخر رسالة غير صحيح";
  if (!Number.isInteger(c.reminders) || c.reminders < 0 || c.reminders > 10_000) return "عدد التذكيرات غير صحيح";
  if (![c.clientId, c.purchaseId, c.saleId].every((x) => text(x, 60))) return "معلومات الطلب غير صحيحة";
  return null;
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
  if (!SALE_TYPES.includes(s.type)) return "نوع البيع غير صحيح";
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
  const findClient = (id: string) => ledger.clients.find((c) => c.id === id);
  switch (op.type) {
    case "client.add": {
      if (findClient(op.client.id)) return { ledger, result: "already" };
      const err = checkClient(op.client);
      if (err) return invalid(ledger, err);
      return { ledger: { ...ledger, clients: [...ledger.clients, { ...op.client, updatedAt: op.at }] }, result: "ok" };
    }
    case "client.update": {
      const c = findClient(op.id);
      if (!c) return invalid(ledger, "الزبون ما بقاش");
      if (c.updatedAt === op.at) return { ledger, result: "already" };
      if (c.updatedAt !== op.base) return { ledger, result: "conflict", message: CONFLICT };
      const next = { ...c, ...pick<Client>(op.patch, ["name", "phone", "phones", "notes", "nextDueDate", "type"]), updatedAt: op.at };
      const err = checkClient(next);
      if (err) return invalid(ledger, err);
      return { ledger: { ...ledger, clients: replace(ledger.clients, c.id, next) }, result: "ok" };
    }
    case "client.delete": {
      if (!findClient(op.id)) return { ledger, result: "already" };
      const hasHistory = ledger.purchases.some((p) => p.clientId === op.id) || ledger.payments.some((p) => p.clientId === op.id);
      if (hasHistory && op.withHistory !== true) {
        return invalid(ledger, "هاد الزبون عندو مشتريات ولا دفعات. ما يمكنش يتمسح، أرشفه ملي يخلص.");
      }
      // Everything of this customer goes; their credit sales are cancelled and the products go back to stock.
      const purchaseIds = new Set(ledger.purchases.filter((p) => p.clientId === op.id).map((p) => p.id));
      const cancelled = ledger.sales.filter((s) => s.clientId === op.id || purchaseIds.has(s.purchaseId));
      const cancelledIds = new Set(cancelled.map((s) => s.id));
      return {
        ledger: {
          ...restock(ledger, cancelled, op),
          clients: ledger.clients.filter((c) => c.id !== op.id),
          purchases: ledger.purchases.filter((p) => p.clientId !== op.id),
          payments: ledger.payments.filter((p) => p.clientId !== op.id),
          changes: ledger.changes.filter((x) => x.clientId !== op.id),
          sales: ledger.sales.filter((s) => !cancelledIds.has(s.id)),
        },
        result: "ok",
      };
    }
    case "client.installment": {
      const c = findClient(op.id);
      if (!c) return invalid(ledger, "الزبون ما بقاش");
      if (ledger.changes.some((x) => x.id === op.change.id)) return { ledger, result: "already" };
      if (c.updatedAt !== op.base) return { ledger, result: "conflict", message: CONFLICT };
      const ch = op.change;
      if (!isLedgerId(ch.id) || ch.clientId !== c.id || !money(ch.newAmount) || !text(ch.newPeriod, 40) || !text(ch.reason, 300) || !date(ch.date)) {
        return invalid(ledger, "تغيير الطريطة غير صحيح");
      }
      if (op.nextDueDate !== undefined && !date(op.nextDueDate)) return invalid(ledger, "التاريخ غير صحيح");
      const next: Client = {
        ...c,
        installment: ch.newAmount,
        period: ch.newPeriod,
        nextDueDate: op.nextDueDate ?? c.nextDueDate,
        updatedAt: op.at,
      };
      const change: InstallmentChange = { ...ch, oldAmount: c.installment, oldPeriod: c.period };
      return {
        ledger: { ...ledger, clients: replace(ledger.clients, c.id, next), changes: [...ledger.changes, change] },
        result: "ok",
      };
    }
    case "purchase.add": {
      if (ledger.purchases.some((p) => p.id === op.purchase.id)) return { ledger, result: "already" };
      if (!findClient(op.purchase.clientId)) return invalid(ledger, "الزبون ما بقاش");
      const err = checkPurchase(op.purchase);
      if (err) return invalid(ledger, err);
      return { ledger: { ...ledger, purchases: [...ledger.purchases, { ...op.purchase, updatedAt: op.at }] }, result: "ok" };
    }
    case "purchase.update": {
      const p = ledger.purchases.find((x) => x.id === op.id);
      if (!p) return invalid(ledger, "هاد السلعة ما بقاتش");
      if (p.updatedAt === op.at) return { ledger, result: "already" };
      if (p.updatedAt !== op.base) return { ledger, result: "conflict", message: CONFLICT };
      const next = { ...p, ...pick<Purchase>(op.patch, ["date", "item", "price", "notes"]), updatedAt: op.at };
      const err = checkPurchase(next);
      if (err) return invalid(ledger, err);
      // The sale behind this purchase follows the new price, date and name.
      const sales = ledger.sales.map((s) =>
        s.purchaseId === p.id ? { ...s, item: next.item, date: next.date, sellPrice: next.price, updatedAt: op.at } : s,
      );
      return { ledger: { ...ledger, purchases: replace(ledger.purchases, p.id, next), sales }, result: "ok" };
    }
    case "purchase.delete": {
      if (!ledger.purchases.some((p) => p.id === op.id)) return { ledger, result: "already" };
      // The sale behind it is cancelled too, and its product goes back to stock.
      const cancelled = ledger.sales.filter((s) => s.purchaseId === op.id);
      return {
        ledger: {
          ...restock(ledger, cancelled, op),
          purchases: ledger.purchases.filter((p) => p.id !== op.id),
          sales: ledger.sales.filter((s) => s.purchaseId !== op.id),
          // Payments for that item stay, as general payments.
          payments: ledger.payments.map((p) => (p.purchaseId === op.id ? { ...p, purchaseId: "" } : p)),
        },
        result: "ok",
      };
    }
    case "payment.add": {
      if (ledger.payments.some((p) => p.id === op.payment.id)) return { ledger, result: "already" };
      const c = findClient(op.payment.clientId);
      if (!c) return invalid(ledger, "الزبون ما بقاش");
      const err = checkPayment(op.payment);
      if (err) return invalid(ledger, err);
      if (op.nextDueDate !== undefined && !date(op.nextDueDate)) return invalid(ledger, "التاريخ غير صحيح");
      const payment = { ...op.payment, purchaseId: purchaseOf(ledger, op.payment.purchaseId, c.id), updatedAt: op.at };
      const clients = op.nextDueDate !== undefined ? replace(ledger.clients, c.id, { ...c, nextDueDate: op.nextDueDate }) : ledger.clients;
      return { ledger: { ...ledger, clients, payments: [...ledger.payments, payment] }, result: "ok" };
    }
    case "payment.update": {
      const p = ledger.payments.find((x) => x.id === op.id);
      if (!p) return invalid(ledger, "هاد الدفعة ما بقاتش");
      if (p.updatedAt === op.at) return { ledger, result: "already" };
      if (p.updatedAt !== op.base) return { ledger, result: "conflict", message: CONFLICT };
      const next = { ...p, ...pick<Payment>(op.patch, ["clientId", "purchaseId", "date", "time", "amount", "kind", "notes"]), updatedAt: op.at };
      if (!findClient(next.clientId)) return invalid(ledger, "الزبون ما بقاش");
      next.purchaseId = purchaseOf(ledger, next.purchaseId, next.clientId);
      const err = checkPayment(next);
      if (err) return invalid(ledger, err);
      return { ledger: { ...ledger, payments: replace(ledger.payments, p.id, next) }, result: "ok" };
    }
    case "payment.delete": {
      if (!ledger.payments.some((p) => p.id === op.id)) return { ledger, result: "already" };
      return { ledger: { ...ledger, payments: ledger.payments.filter((p) => p.id !== op.id) }, result: "ok" };
    }
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
      const next = { ...s, quantity: s.quantity + m.delta, codes: [...s.codes, ...added], updatedAt: op.at, ...origin(op) };
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
    case "repair.add": {
      const r = op.repair;
      if (!r || typeof r !== "object") return invalid(ledger, "الإصلاح غير صحيح");
      if (ledger.repairs.some((x) => x.id === r.id)) return { ledger, result: "already" };
      const next: Repair = {
        ...r,
        notes: r.notes ?? "",
        photo: r.photo ?? "",
        deliveredDate: r.deliveredDate ?? "",
        deliveredTime: r.deliveredTime ?? "",
        paid: r.paid ?? 0,
        cost: r.cost ?? 0,
        updatedAt: op.at,
        by: op.by ?? "",
        origin: op.device ?? "",
      };
      const err = checkRepair(next, ledger);
      if (err) return invalid(ledger, err);
      return { ledger: { ...ledger, repairs: [...ledger.repairs, next] }, result: "ok" };
    }
    case "repair.update": {
      const r = ledger.repairs.find((x) => x.id === op.id);
      if (!r) return invalid(ledger, "هاد الإصلاح ما بقاش");
      if (r.updatedAt === op.at) return { ledger, result: "already" };
      if (r.updatedAt !== op.base) return { ledger, result: "conflict", message: CONFLICT };
      const fields: (keyof Repair)[] = ["date", "time", "owner", "phone", "device", "problem", "price", "advance", "status", "notes", "photo", "deliveredDate", "deliveredTime", "paid", "cost"];
      const next: Repair = { ...r, ...pick<Repair>(op.patch, fields), updatedAt: op.at, by: op.by ?? "", origin: op.device ?? "" };
      const err = checkRepair(next, ledger);
      if (err) return invalid(ledger, err);
      return { ledger: { ...ledger, repairs: replace(ledger.repairs, r.id, next) }, result: "ok" };
    }
    case "repair.delete": {
      if (!ledger.repairs.some((x) => x.id === op.id)) return { ledger, result: "already" };
      return { ledger: { ...ledger, repairs: ledger.repairs.filter((x) => x.id !== op.id) }, result: "ok" };
    }
    case "claim.add": {
      const c = op.claim;
      if (!c || typeof c !== "object") return invalid(ledger, "الطلب غير صحيح");
      if (ledger.claims.some((x) => x.id === c.id)) return { ledger, result: "already" };
      const next: Claim = { ...c, updatedAt: op.at, by: op.by ?? "", origin: op.device ?? "" };
      const err = checkClaim(next);
      if (err) return invalid(ledger, err);
      return { ledger: { ...ledger, claims: [...ledger.claims, next] }, result: "ok" };
    }
    case "claim.update": {
      const c = ledger.claims.find((x) => x.id === op.id);
      if (!c) return invalid(ledger, "هاد الطلب ما بقاش");
      if (c.updatedAt === op.at) return { ledger, result: "already" };
      if (c.updatedAt !== op.base) return { ledger, result: "conflict", message: CONFLICT };
      const fields: (keyof Claim)[] = [
        "date", "time", "customer", "phone", "item", "saleDate", "company", "servicePhone", "problem", "status",
        "lastSentAt", "reminders", "resolvedDate", "resolvedTime", "notes",
      ];
      const next: Claim = { ...c, ...pick<Claim>(op.patch, fields), updatedAt: op.at, by: op.by ?? "", origin: op.device ?? "" };
      const err = checkClaim(next);
      if (err) return invalid(ledger, err);
      return { ledger: { ...ledger, claims: replace(ledger.claims, c.id, next) }, result: "ok" };
    }
    case "claim.delete": {
      if (!ledger.claims.some((x) => x.id === op.id)) return { ledger, result: "already" };
      return { ledger: { ...ledger, claims: ledger.claims.filter((x) => x.id !== op.id) }, result: "ok" };
    }
    case "approval.add": {
      const inner = op.op;
      if (!inner || typeof inner !== "object" || !CREDIT_OPS.has(inner.type) || typeof inner.opId !== "string" || typeof inner.at !== "string" || Number.isNaN(Date.parse(inner.at))) {
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
      // What this change needs (a new customer, the sale a payment is for…) is accepted with it.
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
      const purchases = Array.isArray(op.purchases) ? op.purchases : [];
      if (!lines.length || lines.length > 50) return invalid(ledger, "البيع خاوي");
      if (lines.every((l) => ledger.sales.some((s) => s.id === l.id))) return { ledger, result: "already" };
      if (lines.some((l) => !l || typeof l !== "object") || purchases.some((p) => !p || typeof p !== "object")) return invalid(ledger, "البيع غير صحيح");
      for (const l of lines) {
        const err = checkSale(l);
        if (err) return invalid(ledger, err);
        if (ledger.sales.some((s) => s.id === l.id)) return invalid(ledger, "رقم البيع مكرر");
        if (l.ticket !== lines[0].ticket) return invalid(ledger, "رقم التيكي غير صحيح");
      }
      if (lines[0].type === "كريدي") {
        const c = findClient(lines[0].clientId);
        if (!c) return invalid(ledger, "الزبون ما بقاش");
        if (purchases.length !== lines.length) return invalid(ledger, "البيع بالكريدي خاصو السلع");
        for (const [i, l] of lines.entries()) {
          const p = purchases[i];
          if (l.type !== "كريدي" || l.clientId !== c.id || l.purchaseId !== p.id || p.clientId !== c.id) return invalid(ledger, "البيع بالكريدي غير صحيح");
          if (p.price !== l.sellPrice || ledger.purchases.some((x) => x.id === p.id)) return invalid(ledger, "البيع بالكريدي غير صحيح");
          const err = checkPurchase(p);
          if (err) return invalid(ledger, err);
        }
      } else if (purchases.length || lines.some((l) => l.type !== "كاش" || l.clientId || l.purchaseId)) {
        return invalid(ledger, "البيع كاش ما فيهش زبون");
      }
      // Products from stock go out (unknown ones are simply not tracked).
      const out = new Map<string, number>();
      for (const l of lines) if (l.stockId && ledger.stock.some((s) => s.id === l.stockId)) out.set(l.stockId, (out.get(l.stockId) ?? 0) + l.quantity);
      const stock = ledger.stock.map((s) => (out.has(s.id) ? { ...s, quantity: s.quantity - out.get(s.id)!, updatedAt: op.at, ...origin(op) } : s));
      return {
        ledger: {
          ...ledger,
          stock,
          sales: [...ledger.sales, ...lines.map((l) => ({ ...l, stockId: out.has(l.stockId) ? l.stockId : "", updatedAt: op.at }))],
          purchases: [...ledger.purchases, ...purchases.map((p) => ({ ...p, updatedAt: op.at }))],
        },
        result: "ok",
      };
    }
    case "sale.delete": {
      const s = ledger.sales.find((x) => x.id === op.id);
      if (!s) return { ledger, result: "already" };
      const after = restock(ledger, [s], op);
      return {
        ledger: {
          ...after,
          sales: ledger.sales.filter((x) => x.id !== s.id),
          purchases: s.purchaseId ? ledger.purchases.filter((p) => p.id !== s.purchaseId) : ledger.purchases,
          payments: s.purchaseId ? ledger.payments.map((p) => (p.purchaseId === s.purchaseId ? { ...p, purchaseId: "" } : p)) : ledger.payments,
        },
        result: "ok",
      };
    }
    case "caisse.close": {
      const k = op.close;
      if (!k || typeof k !== "object") return invalid(ledger, "معلومات الصندوق غير صحيحة");
      if (ledger.closings.some((x) => x.id === k.id)) return { ledger, result: "already" };
      if (!isLedgerId(k.id) || !k.id.startsWith("K-") || !date(k.date) || !k.date || !time(k.time)) return invalid(ledger, "معلومات الصندوق غير صحيحة");
      if (!text(k.clerk, 100) || !text(k.expensesNote, 500) || !text(k.notes, 1000)) return invalid(ledger, "معلومات الصندوق غير صحيحة");
      if (![k.cashSales, k.advances, k.installments, k.repairs ?? 0, k.expected].every(amount) || !money(k.expenses) || (k.counted !== null && !money(k.counted))) {
        return invalid(ledger, "المبالغ غير صحيحة");
      }
      return { ledger: { ...ledger, closings: [...ledger.closings, k] }, result: "ok" };
    }
  }
}

/** Cancelled sales give their products back to stock. */
function restock(ledger: Ledger, sales: Sale[], op: LedgerOp): Ledger {
  const at = op.at;
  const back = new Map<string, number>();
  for (const s of sales) if (s.stockId) back.set(s.stockId, (back.get(s.stockId) ?? 0) + s.quantity);
  if (!back.size) return ledger;
  return { ...ledger, stock: ledger.stock.map((x) => (back.has(x.id) ? { ...x, quantity: x.quantity + back.get(x.id)!, updatedAt: at, ...origin(op) } : x)) };
}

/** A payment can only point to a purchase of the same customer. */
function purchaseOf(ledger: Ledger, purchaseId: string, clientId: string): string {
  return purchaseId && ledger.purchases.some((p) => p.id === purchaseId && p.clientId === clientId) ? purchaseId : "";
}

export function applyOps(ledger: Ledger, ops: LedgerOp[]): Ledger {
  return ops.reduce((l, op) => applyOp(l, op).ledger, ledger);
}

// ---------------------------------------------------------------- summaries

export interface ItemStatus {
  purchase: Purchase;
  paid: number;
  remaining: number;
}

export interface ClientSummary {
  client: Client;
  purchases: Purchase[];
  payments: Payment[];
  total: number;
  paid: number;
  remaining: number;
  lastPaymentDate: string;
  /** Last purchase or payment. */
  lastActivity: string;
  status: DueStatus;
  items: ItemStatus[];
  /** Fully paid more than 3 months ago: can go to the archive. */
  archivable: boolean;
}

const byDate = <T extends { date: string; createdAt: string }>(a: T, b: T) =>
  a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt);

export function sortPayments(list: Payment[]): Payment[] {
  return [...list].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.createdAt.localeCompare(b.createdAt));
}

/**
 * How much of each purchase is paid: payments chosen for an item go to it,
 * general payments fill the oldest unpaid items first.
 */
export function itemStatuses(purchases: Purchase[], payments: Payment[]): ItemStatus[] {
  const items = [...purchases].sort(byDate).map((p) => ({
    purchase: p,
    paid: payments.filter((x) => x.purchaseId === p.id).reduce((s, x) => s + x.amount, 0),
    remaining: 0,
  }));
  let pool = payments.filter((x) => !x.purchaseId || !purchases.some((p) => p.id === x.purchaseId)).reduce((s, x) => s + x.amount, 0);
  // Paid more than a product's price (e.g. 500 on 50 left): the rest goes to the oldest products still unpaid.
  for (const it of items) {
    if (it.paid > it.purchase.price) {
      pool += it.paid - it.purchase.price;
      it.paid = it.purchase.price;
    }
  }
  for (const it of items) {
    const room = Math.max(0, it.purchase.price - it.paid);
    const take = Math.min(room, pool);
    it.paid += take;
    pool -= take;
  }
  for (const it of items) it.remaining = Math.max(0, round(it.purchase.price - it.paid));
  return items;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * How a payment is spread over the products: first what is left on its own
 * product, the rest on the oldest products still unpaid. `before` are the
 * customer's earlier payments.
 */
export function paymentSplit(purchases: Purchase[], before: Payment[], payment: Payment): { purchase: Purchase; amount: number }[] {
  const pre = itemStatuses(purchases, before);
  return itemStatuses(purchases, [...before, payment])
    .map((it, i) => ({ purchase: it.purchase, amount: round(it.paid - pre[i].paid) }))
    .filter((x) => x.amount > 0);
}

export function summarizeClient(ledger: Ledger, clientOrId: Client, today: string): ClientSummary {
  // Always the latest version of the customer in this ledger.
  const client = ledger.clients.find((c) => c.id === clientOrId.id) ?? clientOrId;
  const purchases = ledger.purchases.filter((p) => p.clientId === client.id).sort(byDate);
  const payments = sortPayments(ledger.payments.filter((p) => p.clientId === client.id));
  const total = round(purchases.reduce((s, p) => s + p.price, 0));
  const paid = round(payments.reduce((s, p) => s + p.amount, 0));
  const remaining = round(total - paid);
  const lastPaymentDate = payments.length ? payments[payments.length - 1].date : "";
  const lastPurchaseDate = purchases.length ? purchases[purchases.length - 1].date : "";
  // Last purchase or payment; the date the customer was added only counts when there is neither
  // (customers moved from the old sheet were all "added" on the day of the move).
  const lastActivity = [lastPaymentDate, lastPurchaseDate].sort().pop() || client.createdAt.slice(0, 10);
  return {
    client,
    purchases,
    payments,
    total,
    paid,
    remaining,
    lastPaymentDate,
    lastActivity,
    status: dueStatus(client.nextDueDate, remaining, today),
    items: itemStatuses(purchases, payments),
    archivable: purchases.length > 0 && remaining <= 0 && !!lastActivity && addMonths(lastActivity, 3) < today,
  };
}

export function summarize(ledger: Ledger, today: string): ClientSummary[] {
  return ledger.clients.map((c) => summarizeClient(ledger, c, today));
}

/** The purchase a new payment goes to by default: the oldest one not fully paid. */
export function defaultPurchaseFor(s: ClientSummary): string {
  return s.items.find((i) => i.remaining > 0)?.purchase.id ?? "";
}

/** Names of the items still being paid, for reminders. */
export function unpaidItems(s: ClientSummary): string[] {
  return s.items.filter((i) => i.remaining > 0).map((i) => i.purchase.item);
}

/** Months left at the current instalment. */
export function monthsToFinish(remaining: number, installment: number, period: string): number | null {
  if (remaining <= 0) return 0;
  if (installment <= 0) return null;
  const perMonth = period.includes("سيمانة") ? installment * 4.33 : period.includes("15") ? installment * 2 : installment;
  return Math.ceil(remaining / perMonth);
}

/**
 * The latest next due date allowed after a payment made on `paidDate`: one
 * agreed period after the payment (e.g. paid 10/11, monthly → 10/12).
 * "" when the period is set by hand (no limit).
 */
export function latestNextDue(client: Client, paidDate: string): string {
  if (!client.period || isManualPeriod(client.period)) return "";
  return nextDateForPeriod(client.period, paidDate);
}

/**
 * Next due date after a payment made on `paidDate`: the next date on the
 * customer's schedule (the due date that was set + one period, two…) that
 * comes after the payment day. A late customer isn't given extra time (due
 * 31/10, monthly, paid 10/11 → 30/11, not 10/12), the date is never before
 * the payment day (due 31/08, paid 10/11 → 30/11), and never later than one
 * period after the payment (see latestNextDue).
 */
export function suggestNextDue(client: Client, paidDate: string): string {
  const latest = latestNextDue(client, paidDate);
  if (!latest) return client.nextDueDate;
  if (!client.nextDueDate) return latest;
  for (let k = 1; k <= 1000; k++) {
    const d = addPeriods(client.period, client.nextDueDate, k);
    if (d > paidDate) return d < latest ? d : latest;
  }
  return latest;
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
