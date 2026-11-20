// خدمة الشركة: a product we sold has a fault that the brand's after-sales
// service must repair. The request is sent to the service on WhatsApp and
// followed here; after 48 hours without a solution it is late and the shop
// reminds them. Pure rules, shared by the screens and the tests.

import { clientPhones, SERVICE_CONTACTS_KEY, type Claim, type ClaimStatus, type Client, type Ledger, type Setting } from "./ledger";
import { formatMoroccoPhone, isValidPhone } from "./sheet-logic";
import { displayDate, displayDateTime, SHOP } from "./receipt";
import { normalizeText } from "./shop";

/** A brand's after-sales service (خدمة العملاء in the ⚙️ menu), kept in the shop settings. */
export interface ServiceContact {
  id: string;
  company: string;
  /** Its WhatsApp number. */
  phone: string;
  notes: string;
}

export { SERVICE_CONTACTS_KEY };

/** The services saved in the shop settings (a broken value gives none). */
export function parseContacts(setting: Pick<Setting, "value"> | undefined): ServiceContact[] {
  try {
    const list: unknown = JSON.parse(setting?.value || "[]");
    if (!Array.isArray(list)) return [];
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    return list
      .map((x) => ({ id: str(x?.id), company: str(x?.company), phone: str(x?.phone), notes: str(x?.notes) }))
      .filter((x) => x.id && x.company);
  } catch {
    return [];
  }
}

export const contactsValue = (list: ServiceContact[]) => JSON.stringify(list);

export const contactsOf = (ledger: Pick<Ledger, "settings">) => parseContacts(ledger.settings.find((s) => s.key === SERVICE_CONTACTS_KEY));

export const STATUS_INFO: Record<ClaimStatus, { icon: string; tone: "wait" | "work" | "done" }> = {
  تصيفط: { icon: "📨", tone: "wait" },
  كيتصلح: { icon: "🔧", tone: "work" },
  تحل: { icon: "✅", tone: "done" },
};

/** After this long without a solution the service gets a reminder. */
export const LATE_HOURS = 48;

export const isOpen = (c: Pick<Claim, "status">) => c.status !== "تحل";

const hoursBetween = (fromIso: string, now: Date) => (now.getTime() - Date.parse(fromIso)) / 3_600_000;

/**
 * Open, and 48 hours (Sundays and holidays included) have passed since the
 * last message sent to the service: the request, or the last reminder.
 */
export function isLate(c: Pick<Claim, "status" | "lastSentAt">, now = new Date()): boolean {
  return isOpen(c) && hoursBetween(c.lastSentAt, now) >= LATE_HOURS;
}

export const lateClaims = (claims: Claim[], now = new Date()) => claims.filter((c) => isLate(c, now));

/** «3 سوايع», «يومين», «5 أيام»: how long since an ISO time. */
export function sinceText(fromIso: string, now = new Date()): string {
  const h = Math.max(0, Math.floor(hoursBetween(fromIso, now)));
  if (h < 1) return "أقل من ساعة";
  if (h < 24) return h === 1 ? "ساعة" : h === 2 ? "ساعتين" : h <= 10 ? `${h} سوايع` : `${h} ساعة`;
  const d = Math.floor(h / 24);
  return d === 1 ? "يوم" : d === 2 ? "يومين" : d <= 10 ? `${d} أيام` : `${d} يوم`;
}

/** The open request for this purchase of a customer (the icon on their page). */
export function openClaimFor(claims: Claim[], purchaseId: string): Claim | undefined {
  return purchaseId ? claims.find((c) => c.purchaseId === purchaseId && isOpen(c)) : undefined;
}

/** Search by customer, product, brand, fault or phone; late first, then newest. */
export function searchClaims(claims: Claim[], query: string, now = new Date()): Claim[] {
  const q = normalizeText(query);
  const qd = query.replace(/\D/g, "");
  const hit = (c: Claim) =>
    !q ||
    [c.customer, c.item, c.company, c.problem, c.notes].some((x) => normalizeText(x).includes(q)) ||
    (qd.length >= 3 && c.phone.replace(/\D/g, "").includes(qd));
  const rank = (c: Claim) => (isLate(c, now) ? 0 : isOpen(c) ? 1 : 2);
  return claims.filter(hit).sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt));
}

/** A product that was sold, offered in the request form. */
export interface SoldItem {
  key: string;
  item: string;
  date: string;
  clientId: string;
  purchaseId: string;
  saleId: string;
  /** Credit sales: the customer, to fill the form. */
  customer: string;
  phone: string;
}

/**
 * What can be chosen in the form, newest first: a customer's purchases (their
 * page), or every sale, cash or credit, matching the search.
 */
export function soldItems(ledger: Pick<Ledger, "clients" | "purchases" | "sales">, opts: { clientId?: string; query?: string; limit?: number } = {}): SoldItem[] {
  const q = normalizeText(opts.query ?? "");
  const client = (id: string) => ledger.clients.find((c) => c.id === id);
  let list: SoldItem[];
  if (opts.clientId) {
    const c = client(opts.clientId);
    list = ledger.purchases
      .filter((p) => p.clientId === opts.clientId)
      .map((p) => ({
        key: p.id,
        item: p.item,
        date: p.date,
        clientId: p.clientId,
        purchaseId: p.id,
        saleId: ledger.sales.find((s) => s.purchaseId === p.id)?.id ?? "",
        customer: c?.name ?? "",
        phone: c?.phone ?? "",
      }));
  } else {
    list = ledger.sales.map((s) => {
      const c = s.clientId ? client(s.clientId) : undefined;
      return { key: s.id, item: s.item, date: s.date, clientId: s.clientId, purchaseId: s.purchaseId, saleId: s.id, customer: c?.name ?? "", phone: c?.phone ?? "" };
    });
  }
  return list
    .filter((x) => !q || normalizeText(`${x.item} ${x.customer}`).includes(q))
    .sort((a, b) => b.date.localeCompare(a.date) || b.key.localeCompare(a.key))
    .slice(0, opts.limit ?? 50);
}

type Told = Pick<Claim, "customer" | "phone" | "item" | "saleDate" | "problem">;

function facts(c: Told): string[] {
  const lines = [`📦 الجهاز: ${c.item}`];
  if (c.saleDate) lines.push(`📅 تاريخ البيع: ${displayDate(c.saleDate)}`);
  lines.push(`⚠️ العطب: ${c.problem}`, `👤 الزبون: ${c.customer}`);
  if (c.phone) lines.push(`📞 هاتف الزبون: ${c.phone}`);
  return lines;
}

/** WhatsApp message to the brand's service: the device, when it was sold, the fault, who to call. */
export function claimMessage(c: Told): string {
  return [
    "السلام عليكم 👋",
    `معاكم ${SHOP.name}. واحد الزبون ديالنا شرا من عندنا هاد الجهاز وفيه عطب، ومحتاج خدمة الصيانة ديالكم:`,
    "",
    ...facts(c),
    "",
    "المرجو تتصلو بالزبون فأقرب وقت. شكراً 🙏",
    `🏪 ${SHOP.name}`,
    `📞 ${SHOP.phone}`,
  ].join("\n");
}

/** Reminder to the service: the request is still open, call our customer. */
export function reminderMessage(c: Told & Pick<Claim, "date" | "time" | "createdAt">, now = new Date()): string {
  return [
    "السلام عليكم 👋",
    `تذكير من ${SHOP.name}: صيفطنا ليكم طلب صيانة نهار ${displayDateTime(c.date, c.time)}، دازت عليه ${sinceText(c.createdAt, now)} وباقي ما تحلش المشكل:`,
    "",
    ...facts(c),
    "",
    "المرجو تتصلو بالزبون ديالنا اليوم. شكراً 🙏",
    `🏪 ${SHOP.name}`,
    `📞 ${SHOP.phone}`,
  ].join("\n");
}

/**
 * Open after-sales requests per customer (by account, or by one of their
 * numbers for a request typed by hand), with how many are late: the badge on
 * the customer list in الكريدي.
 */
export function claimsByClient(
  clients: Pick<Client, "id" | "phone" | "phones">[],
  claims: Claim[],
  now = new Date(),
): Map<string, { open: number; late: number }> {
  const byPhone = new Map<string, string>();
  for (const c of clients) for (const p of clientPhones(c)) {
    const intl = formatMoroccoPhone(p);
    if (isValidPhone(intl) && !byPhone.has(intl)) byPhone.set(intl, c.id);
  }
  const known = new Set(clients.map((c) => c.id));
  const out = new Map<string, { open: number; late: number }>();
  for (const x of claims) {
    if (!isOpen(x)) continue;
    const id = known.has(x.clientId) ? x.clientId : byPhone.get(formatMoroccoPhone(x.phone));
    if (!id) continue;
    const v = out.get(id) ?? { open: 0, late: 0 };
    v.open++;
    if (isLate(x, now)) v.late++;
    out.set(id, v);
  }
  return out;
}
