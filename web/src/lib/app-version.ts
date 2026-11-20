// Which build of the app this is (set in next.config.ts). The server sends its own
// with /api/data; a page left open on an older build then offers to reload.

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "";

/** The server runs another build than this page (both known). */
export const isOutdated = (server: string | undefined, mine = APP_VERSION): boolean => Boolean(server && mine && server !== mine);

/** Load the newest build: forget the saved page (the service worker could serve it on a slow network), then reload. */
export async function reloadNewest(): Promise<void> {
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("pages-")).map((k) => caches.delete(k)));
  } catch {}
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch {}
  window.location.reload();
}
