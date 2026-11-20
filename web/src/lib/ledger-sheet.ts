// How the ledger is laid out in the Google Sheet: one tab per table, row ↔ record.

import {
  type CaisseClose,
  type Category,
  type Ledger,
  type Setting,
  type Approval,
  type ApprovalStatus,
  APPROVAL_STATUSES,
  nowParts,
  type Note,
  type NoteKind,
  NOTE_KINDS,
  type Sale,
  type StockItem,
  type StockMove,
  type LedgerOp,
} from "./ledger";
import { describe } from "./approvals";
import { parseSheetDate, parseSum } from "./dates";

export const TABS = {
  stock: "المخزون",
  categories: "الفئات",
  sales: "المبيعات",
  moves: "حركات المخزون",
  closings: "الصندوق اليومي",
  settings: "الإعدادات",
  approvals: "طلبات الموافقة",
  notes: "الكناش",
} as const;

/** Every tab: created on their own when missing (a tab added by a newer version of the app). */
export const SHOP_KEYS = ["stock", "categories", "sales", "moves", "closings", "settings", "approvals", "notes"] as const;

/** Product families of a new sheet (replaced by the shop type's starter families in phase 2). */
export const DEFAULT_CATEGORIES: Category[] = [
  { name: "هواتف وأجهزة", description: "هواتف جديدة ومستعملة، طابليط…", marginTarget: 10, icon: "📱" },
  { name: "إكسسوارات وكابلات", description: "شواحن، كابلات، تيليكوموند، كاسك…", marginTarget: 50, icon: "🔌" },
  { name: "أواني منزلية", description: "أجهزة وأواني الكوزينة…", marginTarget: 25, icon: "🍳" },
];

export type TableKey = keyof typeof TABS;

export const HEADERS: Record<TableKey, string[]> = {
  stock: ["رقم السلعة", "السلعة", "الفئة", "الحالة", "ثمن الشراء", "ثمن البيع", "الكمية", "الكود (QR / باركود / S/N)", "ملاحظات", "تاريخ الإضافة", "آخر تعديل", "أكواد أخرى (موردين آخرين)", "آخر تعديل من", "الجهاز"],
  categories: ["الفئة", "الوصف", "هامش الربح المستهدف %", "الأيقونة"],
  settings: ["المفتاح", "القيمة (JSON)", "آخر تعديل"],
  notes: [
    "رقم", "التاريخ", "الساعة", "النوع", "الملاحظة", "الزبون", "الهاتف", "تدارت", "دارها", "وقت الإنجاز",
    "كتبها", "تاريخ الإضافة", "آخر تعديل", "آخر تعديل من", "الجهاز", "تاريخ التذكير", "ساعة التذكير",
  ],
  approvals: [
    "رقم الطلب", "التاريخ", "الساعة", "البائع", "الجهاز", "رقم السجل", "السلعة / العملية", "التعديل", "المبلغ",
    "الحالة", "ملاحظة المالك / سبب الرفض", "قرر", "وقت القرار", "التعديل (JSON)", "تاريخ الإضافة", "آخر تعديل",
    "ملاحظة البائع",
  ],
  sales: [
    "رقم البيع", "رقم التيكي", "التاريخ", "الساعة", "السلعة", "الفئة", "رقم السلعة فالمخزون", "الكمية",
    "ثمن الشراء", "الثمن المقترح", "ثمن البيع", "الربح", "البائع", "ملاحظات", "تاريخ الإضافة", "آخر تعديل",
  ],
  moves: ["رقم", "رقم السلعة", "السلعة", "التاريخ", "التغيير", "السبب", "البائع", "تاريخ الإضافة", "أكواد جديدة"],
  closings: [
    "رقم", "التاريخ", "الساعة", "البائع", "مبيعات الكاش", "المصاريف",
    "تفاصيل المصاريف", "الصافي فالقجر (المتوقع)", "المبلغ المحسوب", "الفرق", "ملاحظات", "تاريخ الإضافة",
  ],
};

export type Cell = string | number;

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const n = (v: unknown) => (typeof v === "number" ? v : parseSum(s(v)));
/** Dates are stored as text yyyy-mm-dd; a date typed by hand in the sheet comes back as a serial number. */
const d = (v: unknown) => parseSheetDate(typeof v === "number" ? String(Math.floor(v)) : s(v));
const t = (v: unknown) => {
  if (typeof v === "number" && v < 1) {
    const minutes = Math.round(v * 24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  const m = s(v).match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "00:00";
};

// ---------------------------------------------------------------- rows → records

/** Codes, one per line in the cell. */
const lines = (v: unknown) => s(v).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

/** Whole number that can be negative (parseSum drops the sign). */
const int = (v: unknown) => Math.trunc(typeof v === "number" ? v : Number(s(v).replace(",", ".")) || 0);
/** Empty cell = unknown (null), anything else a number. */
const nn = (v: unknown) => (s(v) === "" ? null : n(v));

export function rowToStock(r: unknown[]): StockItem | null {
  const id = s(r[0]);
  if (!id) return null;
  return {
    id,
    item: s(r[1]),
    category: s(r[2]),
    condition: s(r[3]) === "مستعمل" ? "مستعمل" : "جديد",
    buyPrice: n(r[4]),
    sellPrice: n(r[5]),
    quantity: int(r[6]),
    serial: s(r[7]),
    notes: s(r[8]),
    createdAt: s(r[9]),
    updatedAt: s(r[10]),
    codes: lines(r[11]),
    by: s(r[12]),
    device: s(r[13]),
  };
}

export function rowToCategory(r: unknown[]): Category | null {
  const name = s(r[0]);
  return name ? { name, description: s(r[1]), marginTarget: n(r[2]), icon: s(r[3]) } : null;
}

export function rowToSetting(r: unknown[]): Setting | null {
  const key = s(r[0]);
  return key ? { key, value: s(r[1]), updatedAt: s(r[2]) } : null;
}

export function rowToNote(r: unknown[]): Note | null {
  const id = s(r[0]);
  if (!id) return null;
  const kind = s(r[3]) as NoteKind;
  return {
    id,
    date: d(r[1]),
    time: t(r[2]),
    kind: NOTE_KINDS.includes(kind) ? kind : "ملاحظة",
    text: s(r[4]),
    customer: s(r[5]),
    phone: s(r[6]),
    done: s(r[7]) === "✓" || s(r[7]).toUpperCase() === "TRUE",
    doneBy: s(r[8]),
    doneAt: s(r[9]),
    author: s(r[10]),
    createdAt: s(r[11]),
    updatedAt: s(r[12]),
    by: s(r[13]),
    origin: s(r[14]),
    // Older rows have no reminder.
    ...(d(r[15]) && s(r[16]) ? { remindDate: d(r[15]), remindTime: t(r[16]) } : {}),
  };
}

export function rowToApproval(r: unknown[]): Approval | null {
  const id = s(r[0]);
  if (!id) return null;
  let op: LedgerOp;
  try {
    op = JSON.parse(s(r[13]));
  } catch {
    return null;
  }
  if (!op || typeof op !== "object" || typeof op.type !== "string") return null;
  const status = s(r[9]) as ApprovalStatus;
  return {
    id,
    op,
    status: APPROVAL_STATUSES.includes(status) ? status : "كتسنى",
    note: s(r[16]),
    reason: s(r[10]),
    decidedBy: s(r[11]),
    decidedAt: s(r[12]),
    createdAt: s(r[14]),
    updatedAt: s(r[15]),
  };
}

export function rowToSale(r: unknown[]): Sale | null {
  const id = s(r[0]);
  if (!id) return null;
  return {
    id,
    ticket: s(r[1]) || id,
    date: d(r[2]),
    time: t(r[3]),
    item: s(r[4]),
    category: s(r[5]),
    stockId: s(r[6]),
    quantity: Math.max(1, Math.trunc(n(r[7])) || 1),
    buyPrice: nn(r[8]),
    listPrice: n(r[9]),
    sellPrice: n(r[10]),
    seller: s(r[12]),
    notes: s(r[13]),
    createdAt: s(r[14]),
    updatedAt: s(r[15]),
  };
}

export function rowToMove(r: unknown[]): StockMove | null {
  const id = s(r[0]);
  if (!id) return null;
  return { id, stockId: s(r[1]), date: d(r[3]), delta: int(r[4]), reason: s(r[5]), seller: s(r[6]), createdAt: s(r[7]), ...(lines(r[8]).length ? { codesIn: lines(r[8]) } : {}) };
}

export function rowToClosing(r: unknown[]): CaisseClose | null {
  const id = s(r[0]);
  if (!id) return null;
  return {
    id,
    date: d(r[1]),
    time: t(r[2]),
    clerk: s(r[3]),
    cashSales: n(r[4]),
    expenses: n(r[5]),
    expensesNote: s(r[6]),
    expected: n(r[7]),
    counted: nn(r[8]),
    notes: s(r[10]),
    createdAt: s(r[11]),
  };
}

export function rowsToLedger(tables: Partial<Record<TableKey, unknown[][]>>): Ledger {
  const keep = <T>(x: T | null): x is T => x !== null;
  const rows = (k: TableKey) => tables[k] ?? [];
  return {
    stock: rows("stock").map(rowToStock).filter(keep),
    categories: rows("categories").map(rowToCategory).filter(keep),
    sales: rows("sales").map(rowToSale).filter(keep),
    moves: rows("moves").map(rowToMove).filter(keep),
    closings: rows("closings").map(rowToClosing).filter(keep),
    settings: rows("settings").map(rowToSetting).filter(keep),
    approvals: rows("approvals").map(rowToApproval).filter(keep),
    notes: rows("notes").map(rowToNote).filter(keep),
  };
}

// ---------------------------------------------------------------- records → rows

const money = (v: number) => (v ? v : "");

/** Every row of the ledger as it should be in the sheet, keyed by id. */
export function ledgerToRows(ledger: Ledger): Record<TableKey, Map<string, Cell[]>> {
  const stockNames = new Map(ledger.stock.map((x) => [x.id, x.item]));
  const stock = new Map<string, Cell[]>(
    ledger.stock.map((x) => [
      x.id,
      [x.id, x.item, x.category, x.condition, x.buyPrice, x.sellPrice, x.quantity, x.serial, x.notes, x.createdAt, x.updatedAt, (x.codes ?? []).join("\n"), x.by ?? "", x.device ?? ""],
    ]),
  );
  const categories = new Map<string, Cell[]>(ledger.categories.map((c) => [c.name, [c.name, c.description, money(c.marginTarget), c.icon]]));
  const sales = new Map<string, Cell[]>(
    ledger.sales.map((x) => [
      x.id,
      [
        x.id, x.ticket, x.date, x.time, x.item, x.category, x.stockId, x.quantity,
        x.buyPrice ?? "", x.listPrice, x.sellPrice, x.buyPrice === null ? "" : round2(x.sellPrice - x.buyPrice),
        x.seller, x.notes, x.createdAt, x.updatedAt,
      ],
    ]),
  );
  const moves = new Map<string, Cell[]>(
    ledger.moves.map((m) => [m.id, [m.id, m.stockId, stockNames.get(m.stockId) ?? "", m.date, m.delta, m.reason, m.seller, m.createdAt, (m.codesIn ?? []).join("\n")]]),
  );
  const closings = new Map<string, Cell[]>(
    ledger.closings.map((k) => [
      k.id,
      [
        k.id, k.date, k.time, k.clerk, k.cashSales, k.expenses, k.expensesNote, k.expected,
        k.counted ?? "", k.counted === null ? "" : round2(k.counted - k.expected), k.notes, k.createdAt,
      ],
    ]),
  );
  const settings = new Map<string, Cell[]>(ledger.settings.map((x) => [x.key, [x.key, x.value, x.updatedAt]]));
  const approvals = new Map<string, Cell[]>(
    ledger.approvals.map((x) => {
      const info = describe(x.op, ledger);
      const when = Number.isNaN(Date.parse(x.createdAt)) ? { date: "", time: "" } : nowParts(new Date(x.createdAt));
      return [
        x.id,
        [
          x.id, when.date, when.time, x.op.by ?? "", x.op.device ?? "", info.targetId, info.target, `${info.icon} ${info.text}`, info.amount,
          x.status, x.reason, x.decidedBy, x.decidedAt, JSON.stringify(x.op), x.createdAt, x.updatedAt, x.note,
        ],
      ];
    }),
  );
  const notes = new Map<string, Cell[]>(
    ledger.notes.map((x) => [
      x.id,
      [
        x.id, x.date, x.time, x.kind, x.text, x.customer, x.phone, x.done ? "✓" : "", x.doneBy, x.doneAt,
        x.author, x.createdAt, x.updatedAt, x.by ?? "", x.origin ?? "", x.remindDate ?? "", x.remindTime ?? "",
      ],
    ]),
  );
  return { stock, categories, sales, moves, closings, settings, approvals, notes };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Same content? Numbers and their text form count as equal ("500" = 500). */
export function sameRow(a: unknown[], b: Cell[]): boolean {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? "";
    const y = b[i] ?? "";
    if (x === y) continue;
    if (String(x).trim() === String(y).trim()) continue;
    if (typeof y === "number" && Number(x) === y) continue;
    if (typeof x === "number" && Number(y) === x) continue;
    return false;
  }
  return true;
}
