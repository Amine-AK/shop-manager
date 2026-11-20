import "server-only";
import { ConfigError } from "./config-error";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new ConfigError(name, `Missing environment variable ${name} (see .env.example)`);
  return v;
}

export const env = {
  appPassword: () => required("APP_PASSWORD"),
  sessionSecret: () => {
    const v = required("SESSION_SECRET");
    if (v.length < 32) throw new ConfigError("SESSION_SECRET", "SESSION_SECRET must be at least 32 characters");
    return v;
  },

  sheetId: () => required("GOOGLE_SHEET_ID"),
  serviceAccountEmail: () => required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
  // Vercel and .env files store the key on one line with literal "\n".
  privateKey: () => required("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
  sheetsApiBase: () => process.env.GOOGLE_SHEETS_API_BASE || "https://sheets.googleapis.com",
  // Only for local testing against a fake Sheets server.
  staticAccessToken: () => process.env.GOOGLE_ACCESS_TOKEN || "",

  // DEV ONLY: the «مسح جميع المعلومات» button works only when this is "true". Remove before going live.
  allowDataReset: () => process.env.ALLOW_DATA_RESET === "true",
};
