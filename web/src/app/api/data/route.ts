import { handleError } from "@/lib/api";
import { ledgerFor, requireUser } from "@/lib/access";
import { env } from "@/lib/env";
import { loadLedger, needsSetup } from "@/lib/store";
import { todayISO } from "@/lib/dates";
import { APP_VERSION } from "@/lib/app-version";

export const dynamic = "force-dynamic";

/** The whole ledger, as this account may see it. */
export async function GET() {
  const me = await requireUser();
  if (me instanceof Response) return me;
  try {
    if (await needsSetup()) return Response.json({ needsSetup: true, today: todayISO(), me });
    // devReset: DEV ONLY, shows the «مسح جميع المعلومات» button.
    return Response.json({
      ledger: ledgerFor(me, await loadLedger()),
      today: todayISO(),
      me,
      devReset: env.allowDataReset() && me.role === "owner",
      version: APP_VERSION,
    });
  } catch (e) {
    return handleError(e);
  }
}
