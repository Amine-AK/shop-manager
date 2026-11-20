// Shared bits of what the shop prints or sends: its name on tickets, dates as
// people read them, and WhatsApp links (the cash ticket itself is
// components/SaleTicket.tsx).

import { formatMoroccoPhone, isValidPhone } from "./dates";

export const SHOP = {
  name: "ELECTRO-LMESTOUR",
  phone: "0662275062",
  thanks: "شكراً على ثقتكم",
};

/** "30/10/2026 - 14:32" */
export function displayDateTime(date: string, time?: string): string {
  const [y, m, d] = date.split("-");
  if (!y || !m || !d) return date;
  return `${d}/${m}/${y}${time && time !== "00:00" ? ` - ${time}` : ""}`;
}

export function displayDate(date: string): string {
  return displayDateTime(date);
}

/**
 * Link that opens a chat with the message already typed; nothing is sent
 * until the user presses send. Null when the phone number isn't usable.
 * - "app": api.whatsapp.com, opens the WhatsApp app (phones).
 * - "web": web.whatsapp.com in the browser (PCs). Handing the text to the
 *   WhatsApp Desktop app on Windows can turn emojis into "�"; the browser keeps them.
 */
export function whatsappLink(phone: string, message: string, target: "app" | "web" = "app"): string | null {
  const intl = formatMoroccoPhone(phone);
  if (!isValidPhone(intl)) return null;
  const host = target === "web" ? "https://web.whatsapp.com/send" : "https://api.whatsapp.com/send";
  return `${host}?phone=${intl}&text=${encodeURIComponent(message)}`;
}
