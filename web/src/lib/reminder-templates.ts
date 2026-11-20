// The WhatsApp reminders' texts, written by the shop in ⚙️ «💬 رسائل التذكير»
// (shop setting `reminder-templates`, shared by every device). A text uses
// variables in brackets, e.g. «السلام عليكم [الاسم]، باقي عليك [الباقي]»; each
// is replaced by the customer's own value when the message is opened.

import { money } from "./format";
import { REMINDER_TEMPLATES_KEY, unpaidItems, type ClientSummary, type Setting } from "./ledger";
import { displayDate, installmentText, SHOP } from "./receipt";

export { REMINDER_TEMPLATES_KEY };

export interface ReminderTemplate {
  id: string;
  name: string;
  text: string;
}

/** The variables a text can use, with what they become. */
export const TEMPLATE_VARIABLES: { name: string; hint: string; value: (s: ClientSummary, today: string) => string }[] = [
  { name: "الاسم", hint: "سمية الزبون", value: (s) => s.client.name },
  { name: "الباقي", hint: "شحال باقي عليه", value: (s) => money(s.remaining) },
  { name: "تاريخ الدفعة", hint: "نهار الدفعة لي فاتت", value: (s) => (s.client.nextDueDate ? displayDate(s.client.nextDueDate) : "") },
  { name: "شحال فات", hint: "عدد الأيام من نهار الدفعة", value: (s, today) => lateText(s.client.nextDueDate, today) },
  { name: "السلعة", hint: "السلع لي باقي ما تخلصاتش", value: (s) => unpaidItems(s).join(" + ") },
  { name: "الطريطة", hint: "الطريطة المتفق عليها", value: (s) => installmentText(s) },
  { name: "المجموع", hint: "مجموع المشتريات", value: (s) => money(s.total) },
  { name: "المدفوع", hint: "شحال خلص فالمجموع", value: (s) => money(s.paid) },
  { name: "المحل", hint: "سمية المحل", value: () => SHOP.name },
  { name: "هاتف المحل", hint: "تيليفون المحل", value: () => SHOP.phone },
];

function lateText(due: string, today: string): string {
  if (!due || due >= today) return "";
  const days = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${due}T12:00:00Z`)) / 86_400_000);
  return days === 1 ? "يوم" : days === 2 ? "يومين" : days <= 10 ? `${days} أيام` : `${days} يوم`;
}

/** The text used until the shop writes its own (the same as the app's built-in reminder). */
export const DEFAULT_TEMPLATE: ReminderTemplate = {
  id: "default",
  name: "التذكير العادي",
  text: [
    "السلام عليكم [الاسم] 👋",
    "تذكير من [المحل]:",
    "📅 الدفعة ديالكم كانت نهار [تاريخ الدفعة].",
    "🛒 السلعة: [السلعة]",
    "💰 الباقي: *[الباقي]*",
    "🔁 الطريطة: [الطريطة]",
    "",
    "المرجو تخلصو فأقرب وقت. شكراً 🙏",
    "🏪 [المحل]",
    "📞 [هاتف المحل]",
  ].join("\n"),
};

/** The shop's texts (the default one when none was saved or the value is broken). */
export function parseTemplates(setting: Pick<Setting, "value"> | undefined): ReminderTemplate[] {
  try {
    const list: unknown = JSON.parse(setting?.value || "[]");
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const out = Array.isArray(list)
      ? list.map((x) => ({ id: str(x?.id).trim(), name: str(x?.name).trim(), text: str(x?.text) })).filter((x) => x.id && x.name && x.text.trim())
      : [];
    return out.length ? out : [DEFAULT_TEMPLATE];
  } catch {
    return [DEFAULT_TEMPLATE];
  }
}

export const templatesValue = (list: ReminderTemplate[]) => JSON.stringify(list.map(({ id, name, text }) => ({ id, name, text })));

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The message for this customer: each [variable] replaced by its value. A line
 * whose variables are all empty (no instalment, no due date…) is dropped, so the
 * message never says «الطريطة: » with nothing after it. Unknown [words] stay as typed.
 */
export function fillTemplate(text: string, s: ClientSummary, today: string): string {
  const values = new Map(TEMPLATE_VARIABLES.map((v) => [norm(v.name), v.value(s, today)]));
  const out: string[] = [];
  for (const line of text.split("\n")) {
    let used = 0;
    let empty = 0;
    const filled = line.replace(/\[([^\]\n]{1,30})\]/g, (whole, name: string) => {
      const v = values.get(norm(name));
      if (v === undefined) return whole;
      used++;
      if (!v) empty++;
      return v;
    });
    if (used > 0 && empty === used) continue;
    out.push(filled);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Variables typed in the text that the app doesn't know (shown under the editor). */
export function unknownVariables(text: string): string[] {
  const known = new Set(TEMPLATE_VARIABLES.map((v) => norm(v.name)));
  const found = [...text.matchAll(/\[([^\]\n]{1,30})\]/g)].map((m) => norm(m[1]));
  return [...new Set(found.filter((x) => !known.has(x)))];
}
