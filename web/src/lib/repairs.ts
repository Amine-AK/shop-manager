// Repairs (الإصلاح): devices customers bring to be repaired. Pure rules,
// shared by the screen (components/RepairsView.tsx) and the tests.

import { newShopCode, usedCodes } from "./barcode";
import { money } from "./format";
import { clientPhones, type Ledger, type Repair, type RepairStatus } from "./ledger";
import { formatMoroccoPhone, isValidPhone } from "./sheet-logic";
import { displayDate, SHOP } from "./receipt";
import { normalizeText } from "./shop";

/** How each status looks: still in the shop, ready, given back. */
export const STATUS_INFO: Record<RepairStatus, { icon: string; tone: "wait" | "work" | "ready" | "done" | "bad" }> = {
  مستلم: { icon: "📥", tone: "wait" },
  فالإصلاح: { icon: "🔧", tone: "work" },
  واجد: { icon: "✅", tone: "ready" },
  تسلم: { icon: "🤝", tone: "done" },
  "ما تصلحش": { icon: "❌", tone: "bad" },
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** What is still to pay: price − advance − what was paid when collecting it. */
export const repairRemaining = (r: Pick<Repair, "price" | "advance" | "paid">) => Math.max(0, round2(r.price - r.advance - (r.paid ?? 0)));

/** All the money received for this repair. */
export const repairReceived = (r: Pick<Repair, "advance" | "paid">) => round2(r.advance + (r.paid ?? 0));

/** Received − what the repair cost the shop. */
export const repairProfit = (r: Pick<Repair, "advance" | "paid" | "cost">) => round2(repairReceived(r) - (r.cost ?? 0));

/** Still in the shop (not given back). */
export const inShop = (r: Repair) => r.status !== "تسلم";

/**
 * The repair's own barcode: an EAN-13 starting with 2 like the shop's
 * products, never one already used by a product or another repair.
 */
export function newRepairCode(id: string, ledger: Pick<Ledger, "stock" | "repairs">): string {
  const taken = usedCodes(ledger.stock);
  for (const r of ledger.repairs) taken.add(r.code.toLowerCase());
  return newShopCode(id, taken);
}

/**
 * Who has this phone number, from the data already on the device (no request):
 * a customer of الزبناء (any of their numbers), else the owner of an earlier
 * repair. Only a complete number, in any format («0661…», «+212 661…»).
 */
export function ownerForPhone(phone: string, ledger: Pick<Ledger, "clients" | "repairs">): { name: string; from: "client" | "repair" } | null {
  const intl = formatMoroccoPhone(phone);
  if (!isValidPhone(intl)) return null;
  const client = ledger.clients.find((c) => clientPhones(c).some((p) => formatMoroccoPhone(p) === intl));
  if (client?.name.trim()) return { name: client.name.trim(), from: "client" };
  const repair = [...ledger.repairs]
    .filter((r) => r.owner.trim() && formatMoroccoPhone(r.phone) === intl)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return repair ? { name: repair.owner.trim(), from: "repair" } : null;
}

/** The repair with this barcode (scanned on its sticker). */
export function repairByCode(repairs: Repair[], code: string): Repair | undefined {
  const c = code.trim();
  return c ? repairs.find((r) => r.code === c) : undefined;
}

const digitsOf = (s: string) => s.replace(/\D/g, "").replace(/^(00)?212/, "0");

/** Search by owner, phone (any format), device, problem or barcode; newest first. */
export function searchRepairs(repairs: Repair[], query: string): Repair[] {
  const q = normalizeText(query);
  const qd = digitsOf(query);
  const hit = (r: Repair) =>
    !q ||
    [r.owner, r.device, r.problem, r.notes].some((x) => normalizeText(x).includes(q)) ||
    (qd.length >= 3 && (digitsOf(r.phone).includes(qd) || r.code.includes(qd)));
  return repairs.filter(hit).sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`) || b.createdAt.localeCompare(a.createdAt));
}

/** WhatsApp message when the device is left at the shop: a receipt with its number. */
export function receivedMessage(r: Repair): string {
  const lines = [`السلام عليكم ${r.owner} 👋`, `📥 توصلنا بالجهاز ديالكم «${r.device}» نهار ${displayDate(r.date)} على ${r.time}.`];
  if (r.problem) lines.push(`🔧 المشكل: ${r.problem}`);
  if (r.price) lines.push(`💰 ثمن الإصلاح: ${money(r.price)}`);
  if (r.advance) lines.push(`💵 التسبيق: ${money(r.advance)}`);
  if (r.price) lines.push(`⏳ الباقي: *${money(repairRemaining(r))}*`);
  lines.push(`🧾 رقم الإصلاح: ${r.code}`, "", `🏪 ${SHOP.name}`, `📞 ${SHOP.phone}`);
  return lines.join("\n");
}

/** WhatsApp message when the owner collects the device: what was paid in all. */
export function deliveredMessage(r: Repair): string {
  const lines = [
    `السلام عليكم ${r.owner} 👋`,
    `🤝 خديتو الجهاز ديالكم «${r.device}» نهار ${displayDate(r.deliveredDate)}${r.deliveredTime ? ` على ${r.deliveredTime}` : ""}. شكراً.`,
  ];
  if (r.price) lines.push(`💰 ثمن الإصلاح: ${money(r.price)}`);
  if (r.advance) lines.push(`💵 التسبيق: ${money(r.advance)}`);
  if (r.paid) lines.push(`💵 خلصتو عند التسليم: ${money(r.paid)}`);
  const left = repairRemaining(r);
  lines.push(left > 0 ? `⏳ باقي: *${money(left)}*` : "✅ الإصلاح خالص.");
  lines.push(`🧾 رقم الإصلاح: ${r.code}`, "", `🏪 ${SHOP.name}`, `📞 ${SHOP.phone}`);
  return lines.join("\n");
}

/** WhatsApp message when the device is ready to be collected. */
export function readyMessage(r: Repair): string {
  const left = repairRemaining(r);
  const lines = [`السلام عليكم ${r.owner} 👋`, `✅ الجهاز ديالكم «${r.device}» واجد، تقدرو تجيو تاخدوه.`];
  if (left > 0) lines.push(`💰 الباقي للخلاص: *${money(left)}*`);
  else if (r.price) lines.push("💰 الإصلاح خالص.");
  lines.push(`🧾 رقم الإصلاح: ${r.code}`, "", `🏪 ${SHOP.name}`, `📞 ${SHOP.phone}`);
  return lines.join("\n");
}
