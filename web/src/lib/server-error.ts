// Turns errors that are not the app's own (Google sign-in, network) into a
// message the owner can act on, instead of the generic «وقع مشكل في السيرفر».
// Pure, so it is tested without a server.

export function explainServerError(e: unknown): string | null {
  const err = e as { message?: unknown; code?: unknown; cause?: { code?: unknown } } | null;
  const message = typeof err?.message === "string" ? err.message : "";
  const code = String(err?.code ?? err?.cause?.code ?? "");
  // The private key can't be read: still the example "...", cut, or pasted without its \n.
  if (code.startsWith("ERR_OSSL") || /DECODER routines|PEM|private key|asn1/i.test(message)) {
    return "GOOGLE_PRIVATE_KEY غالط: خاصو يكون «private_key» كامل من ملف JSON ديال حساب الخدمة، فسطر واحد بين \" \" ومعاه \\n. من بعد عاود شغل السيرفر (ولا Redeploy فـ Vercel).";
  }
  // Google refused the sign-in: the email and the key don't go together, or the key was deleted.
  if (/invalid_grant|invalid_client|account not found|Invalid JWT/i.test(message)) {
    return "Google رفض الدخول: GOOGLE_SERVICE_ACCOUNT_EMAIL و GOOGLE_PRIVATE_KEY ماشي من نفس ملف JSON، ولا المفتاح تحيد. خود جوج من نفس الملف.";
  }
  // Google can't be reached from the server.
  if (/^(ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR)/.test(code) || /fetch failed/i.test(message)) {
    return "السيرفر ما قدرش يوصل لـ Google. تأكد من الأنترنيت ديال السيرفر وعاود.";
  }
  return null;
}
