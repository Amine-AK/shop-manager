import { handleError, jsonError, readJson } from "@/lib/api";
import { requireUser } from "@/lib/access";
import { needsSetup, setup } from "@/lib/store";

export const maxDuration = 60;

/** Create the tabs of an empty sheet. */
export async function POST(request: Request) {
  const me = await requireUser("owner_only");
  if (me instanceof Response) return me;
  const body = await readJson<{ confirm?: boolean }>(request);
  if (body instanceof Response) return body;
  if (body.confirm !== true) return jsonError("confirm is required", 400);
  try {
    if (!(await needsSetup())) return jsonError("الأوراق الجديدة كاينة من قبل", 409);
    await setup();
    return Response.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
