# CLAUDE.md: project map for ELECTRO-LMESTOUR

Read this first. It says where things are, so you can open the right file
directly instead of exploring. Keep it up to date when files move or features
are added (one line per file is enough).

## What the project is

A shop app for **ELECTRO-LMESTOUR** (electronics / household goods, Morocco):
customer credit (الكريدي), cash and credit sales, stock with the shop's own
barcodes and sticker printing, the daily cash drawer, reports, and WhatsApp
reminders. Installable PWA, used on phones and the shop PC, works offline.

- GitHub repository: `Amine-AK/kridiBaseManager` (renamed from `whatsappMustapha`;
  the old name still redirects, the session's tools may still use it).
- **The live app is `web/`** (Next.js 16 App Router, React 19, TypeScript, no
  UI framework, plain CSS). Deployed on **Vercel** from `main` (root dir `web`).
- **Database = one Google Sheet** (Sheets REST API, service account), one tab
  per table. No SQL database (`db/` is an unused design).
- `reminder/`, `tests/`, `requirements.txt`, root `README.md`: the **old**
  Python + Playwright WhatsApp tool. Not used by the app; leave alone.
- Detailed user-facing docs: `web/README.md` (long; search it, don't read it all).

## Conventions (follow them)

- **UI language: Moroccan Darija in Arabic script, RTL.** All labels, hints,
  errors and messages the user sees are Darija (e.g. «سلعة جديدة», «باقي»).
  Code, comments, commit messages and PR text are in **English**.
  The user writes in English, French-ish English or Arabic; answer in their language.
- Money: `money()` in `src/lib/format.ts` → «4.050 درهم». Amounts typed by
  users: `parseAmount()` in `src/components/ui.tsx`.
- Dates: ISO `yyyy-mm-dd` in data; `displayDate()` in `src/lib/receipt.ts` for
  dd/mm/yyyy; shop time zone Africa/Casablanca (`src/lib/sheet-logic.ts`).
- IDs: `newLedgerId(prefix)` in `src/lib/ledger.ts`, prefixes: C client,
  S purchase, P payment, T instalment change, O op, I stock item, V sale,
  M stock move, K cash-drawer close, R repair, W after-sales request, N notebook line, A approval request (= "A-" + the change's opId).
- Comments explain *why*, short, in plain English. Keep files' existing style.
- Every user-visible number on phones: `<bdi dir="ltr">` around codes / digits.
- Per-device settings go in `localStorage` (try/catch every access). Keys in use:
  `theme`, `label-setup`, `label-size`, `label-price`, `receipt-paper`,
  `scanner-camera`, `backup-last`, `backup-snooze`, `device-id`,
  `notes-seen` (account → ISO time الكناش was last looked at), `reminder-contacted`
  (customer → day + how they were reminded by hand today), `reminder-template` / `reminder-audio`
  (text and voice message chosen last in the reminders). IndexedDB also keeps `reminder-audios`
  (voice messages recorded on the device, Blobs: too big for the sheet),
  `label-print-test` (old, migrated). The ledger snapshot and the queue of
  unsent ops are in IndexedDB (`ledger-snapshot`, `ledger-queue`).
  Per tab (`sessionStorage`): `view` (main tab), `budget-tab` (الصندوق / التقارير),
  `repair-tab` (الإصلاح / خدمة الشركة).

## Data flow (credit + shop ledger)

```
phone/PC                                   server (Next route)        Google Sheet
useLedger.ts ── snapshot + queue of ops ──► /api/sync ─► store.sync() ─► tabs
  (IndexedDB via lib/idb.ts, offline)       /api/data ◄─ store.loadLedger()
UI calls data.run(label, ...ops)  →  op queued, applied locally (optimistic), sent when online
```

- Sync loop (`useLedger.ts`): accepted ops are applied to the local snapshot as
  they leave the queue (the screen must never fall back to the old copy while
  `/api/data` reloads, or edits made then get a stale `base` → «conflict»);
  ops added while a sync runs are sent right after it (`again` flag). While the app is open it
  also refreshes every 60 s (`REFRESH_EVERY_MS`), so others' changes (notebook notifications) arrive.
  Each `/api/data` also brings the server's build `version`: `updateReady` = this page is an
  older build → the «🔄 كاينة نسخة جديدة» bar in `Dashboard.tsx` (`lib/app-version.ts`).
- Change origin (`src/lib/change-origin.ts`): each op carries `device` (label made
  on the device: system · browser · `#id` from localStorage `device-id`) and `by`
  (account name, **stamped by the server** in `/api/sync`). Products keep the last
  ones (`by`, `device`; sheet columns «آخر تعديل من», «الجهاز»). A refused edit
  (`result: "conflict"`) shows `conflictDetails()` in `SyncBar.tsx`; refused
  changes are filtered by `visibleFailures()` (= `opAllowed`) for the logged-in account.

- **All changes are ops** (`LedgerOp` in `src/lib/ledger.ts`, applied by
  `applyOp`). Op types: `client.add/update/delete/installment`,
  `purchase.add/update/delete`, `payment.add/update/delete`,
  `stock.add/update/adjust/delete`, `sale.add/delete`, `category.save`,
  `caisse.close`, `setting.save` (shop-wide settings, key → JSON text),
  `repair.add/update/delete`, `claim.add/update/delete`, `approval.add/decide/note`, `note.add/update/delete`. Edits carry `base` (= record's `updatedAt`) → conflicts.
- Server checks permissions per op: `src/app/api/sync/route.ts` +
  `src/lib/permissions.ts` (pure, tested) + `src/lib/access.ts`.
- Sheet layout (tab names, columns, row ↔ object): `src/lib/ledger-sheet.ts`
  (`TABS`: الزبناء, المشتريات, الدفعات, تغييرات الطريطة, المخزون, الفئات,
  المبيعات, حركات المخزون, الصندوق اليومي, الإعدادات, الإصلاح, خدمة الشركة, طلبات الموافقة, الكناش). New tabs go in `SHOP_KEYS`:
  existing sheets get them created on first use (`ensureShopTabs` in `store.ts`).
  **New columns always go at the end of a tab** (old rows keep their positions;
  the header check in `ensureShopTabs` adds the new titles); reading a missing
  cell gives "" / 0, so older rows still load. Users tab: «المستخدمين» (`src/lib/users.ts`).
  Archive tabs: `src/lib/store.ts`.
- **Sellers' credit changes wait for the owner** (`lib/approvals.ts`, `lib/approval-deps.ts`):
  for role `seller`, every credit op (`CREDIT_OPS`: client.*, purchase.*, payment.*, credit
  sale.add / sale.delete; `needsApproval`) is wrapped by `data.run` (and by `/api/sync` for old
  clients) into `approval.add` and stored in tab «طلبات الموافقة» (JSON of the op), NOT applied.
  `useLedger` exposes `ledger` = sheet + queue + waiting requests (`withPending`), so screens,
  receipts, WhatsApp and the cash drawer already count them; `pendingIds` marks them ⏳,
  `brokenApprovals` = those that no longer apply. Owner (`approval.decide`, owner only): accept
  applies the op plus the waiting requests it needs (`approvalChain`), refuse keeps it «ترفض»
  with the reason and refuses what was built on it (`refusalCascade`). The owner can't edit a
  record a seller changed until deciding. Notes: the seller who made a waiting change writes one
  for the owner (`approval.note` → `Approval.note`, column «ملاحظة البائع»); the owner's note when
  accepting or refusing is `reason` (column «ملاحظة المالك / سبب الرفض», only on the request decided).
- **Customer type** (`Client.type`, last column of الزبناء «نوع الزبون (0 عادي، 1 خاص)», empty = 0):
  0 normal, 1 special ⭐. Only the owner sets it (form checkbox; `stampOp` forces it otherwise).
  A seller account has `clientScope` (users tab, last column «الزبناء لي كيتبع»: الكل / غير الخاصين):
  `specialOnly(me)` → `ledgerFor` keeps only type-1 customers and their records (`specialView`),
  `/api/sync` refuses their changes on others (`outOfScope`), their new customers are type 1
  (`newClientType`); also applied to reminders, archive search / archive / restore.
- Credit math (remaining per customer and per product, payment split, due
  status): `summarizeClient`, `itemStatuses`, `paymentSplit` in `src/lib/ledger.ts`.
  A payment bigger than what is left on its product spills to the oldest unpaid products.
  Receipts and the full-account WhatsApp message (`statement` in `lib/receipt.ts`)
  list, payment by payment, what each one really paid on each product
  («*280 درهم* (من 500 درهم)», «الباقي من دفعة «…»», «دفعة عامة»).

## Where to change what

| Task / feature | File(s) |
|---|---|
| App shell, main tabs (الكريدي / البيع / المخزون / الإصلاح / الكناش (every account, stock role too; badge = open customer requests) = sub-tabs الإصلاح + خدمة الشركة, `REPAIR_TABS`, with the count of late requests / الميزانية = sub-tabs الصندوق + التقارير, `BUDGET_TABS`), approvals bar in الكريدي, ⏳ on customers with waiting changes, after-sales in الكريدي for accounts with `claims` (summary card `.claim-stat` red when late + red bar `.claims-late-bar` → `ClaimsView` in a full-screen `Modal` with `initialFilter`; `ClaimFlag` ⏰ / 🏭 per customer from `claimsByClient`; summary classes `four` / `trio`), customer list (phone: `ClientRow` lines, PC: `ClientCard` cards, switch `useIsPhone` < 640 px), search | `components/Dashboard.tsx` (`VIEWS`) |
| Customer page (purchases, payments, delete; section «🔧 الإصلاح وخدمة الشركة»: their after-sales requests and repairs (`customerFollowUps`: by account or any of their numbers), opened in place (`ClaimPanel`, `RepairPanel`), «🏭 ريكلاماسيون» and «🔧 إصلاح جديد» (prefilled `RepairForm initial`); the open-request flag on purchases; banner of sellers' waiting changes / notes / refusals, ⏳ rows, owner can't edit them until deciding) | `components/ClientDetail.tsx` |
| Add / edit customer, instalment (الطريطة) | `components/ClientForms.tsx` |
| Add purchase, record / edit payment (split hint, next due date) | `components/MoneyForms.tsx` |
| Payment receipt, statement (كشف), WhatsApp message texts | `lib/receipt.ts` (texts) + `components/ReceiptDialog.tsx` (screen / print) |
| Reminders of late customers: one by one from the device data, no API, also offline (📞 `tel:`, 💬 `whatsappLink` with the chosen text filled by `fillTemplate`, 🎤 voice message handed over by `shareAudio`: share menu on phones, download on PCs; marked done per device), plus bulk sending through WATI only when it's set up on the server. Texts: ⚙️ «💬 رسائل التذكير» (`ReminderSettingsDialog`), shop setting `reminder-templates` (JSON list, `[variable]` names in `TEMPLATE_VARIABLES`; a line whose variables are all empty is dropped; `DEFAULT_TEMPLATE` = the built-in message), saved by accounts with `reminders`; voice messages recorded / picked per device | `components/RemindersDialog.tsx`, `components/ReminderSettings.tsx`, `lib/reminder-templates.ts` (pure, tested), `lib/reminder-audio.ts`, `lib/receipt.ts` (`reminderMessage`), `app/api/reminders/*`, `lib/wati.ts`, `lib/reminders.ts` |
| Sale (cart, cash / credit, scan into sale). Sticky `.sale-top` (search + 📷), then the big family tiles `.cat-tiles` (as in the first version); a tile opens the category's full-screen page (`SaleCategoryPage`: `Modal` with `head` = category menu, class `page`; scoped search, filters الكل / متوفر / جديد / مستعمل, product grid drawn 48 at a time, 🛒 count on cards, cart bar). «عطاك»: `quickCash` chips, `cashOutcome` (change / exact / short → «📒 الباقي كريدي» = credit with the cash as advance); credit advance ≥ total → «💵 سجلها بيع كاش» | `components/SaleForm.tsx`, `components/SaleCategoryPage.tsx`, `lib/sale-browse.ts` (pure, tested); cash ticket `components/SaleTicket.tsx` |
| Stock list, product form (codes, barcode popup), quantity ±, unknown scanned code, category chips | `components/StockView.tsx` (StockForm, AdjustForm, UnknownCode inside) |
| Product families (categories) | `components/CategoryForm.tsx`, `components/CategoryIcon.tsx`, `lib/image.ts` |
| Stock search, cash drawer math, reports math | `lib/shop.ts` |
| Cash drawer screen, in الميزانية (cash sales + credit advances + instalments + repairs: advance on the day brought, `paid` on the day collected; closing saves `CaisseClose.repairs`, column «تسبيقات الإصلاح»). Shop costs of a repair are NOT taken out of the drawer (entered as expenses at closing) | `components/CaisseView.tsx`, `cashDay` in `lib/shop.ts` |
| Repairs (الإصلاح): devices brought to repair (photo, owner, problem, price, advance, status, own barcode, sticker / image, WhatsApp received / ready / delivered; 🤝 تسلم opens `DeliverDialog`: delivered date / time, final price, `paid` then, shop `cost`; profit for `seesCost`; the form's phone fills the owner's name from الزبناء or past repairs on the device, `ownerForPhone`, no request); service `repairs` (server hides repairs from accounts without it, `ledgerFor`; an account with «الصندوق» but not «الإصلاح» gets the repairs with money only, no owner / phone / problem / photo). On a repair `device` = the repaired device, the recording device is `origin` | `components/RepairsView.tsx`, `lib/repairs.ts` (pure, tested), `Repair` in `lib/ledger.ts`, photo `photoForCell` in `lib/image.ts` |
| After-sales requests (خدمة الشركة, sub-tab of الإصلاح, `REPAIR_TABS` in `Dashboard.tsx`): a sold product has a fault the brand's service must repair. «🏭 ريكلاماسيون» on the customer page (their purchases) or «＋ طلب جديد» (any sale, cash too, or typed by hand) → choose the brand's service → saved (`Claim`) and WhatsApp opens on the service's number. Late = open and 48 h since `lastSentAt` (request or last reminder, Sundays included): red, counted on the tabs, «🔔 ذكّر الشركة» (reminder message, `reminders` + 1). Brands' numbers: setting `service-contacts` (⚙️ menu «خدمة العملاء»). Service `claims` (server hides requests without it; `setting.save` of `service-contacts` needs it) | `components/ClaimsView.tsx` (`ClaimsView`, `ClaimForm`, `ServiceContactsDialog`, `useNow`), `lib/claims.ts` (pure, tested), `Claim` in `lib/ledger.ts`, flag on purchases in `components/ClientDetail.tsx` |
| Approvals of sellers' credit changes: bar in الكريدي (`ApprovalsBar`), list grouped by customer with ✓ قبول / ✕ رفض / ✓ قبل الكل / 📝 قبول بملاحظة, seller's «📝 زيد ملاحظة للمالك» (`ApprovalsDialog`, also from the customer page banner), ⏳ on customers and rows | `components/ApprovalsView.tsx`, `lib/approvals.ts` (pure, tested), `components/ClientDetail.tsx`, `Dashboard.tsx` |
| Notebook (الكناش, main tab): ruled-paper page, write a line at once (📝 ملاحظة / 🙋 طلب زبون, optional customer: name fills from the phone via `ownerForPhone`, on-device data), pages per day, ✓ tick (who / when), search + filters, edit; every account writes and ticks, only the owner deletes. Paper colours `--paper`, `--paper-line`, `--paper-margin`. As notifications: what other accounts wrote / ticked / changed since this account last opened it (`noteEvents`, `notes-seen`) → blue unread count on the tab, popup elsewhere in the app, «🔔 جديد من آخر مرة» box + highlighted lines, phone notification when the app is in the background once allowed (service worker `showNotification`; tap → `notificationclick` opens الكناش via `open-view` message or `/?view=notes`). Reminders ⏰: `Note.remindDate` / `remindTime` (shop time, last columns «تاريخ التذكير» «ساعة التذكير»), set with `RemindPicker` (one «⏰ ذكّرني» chip with an invisible `datetime-local` over it, so a tap opens the system picker; no preset times, no default — the owner asked for that; `presetTime` is only used by the due box's «⏰ +ساعة / غدا»); due = not done and time passed (`dueReminders`, compared as shop-time text) → red box «⏰ وقت التذكير» on top of الكناش (✓ تدار, ⏰ +ساعة / غدا, 📞, 💬), red bar `.remind-due-bar` on every other tab, red count on the tab, popup + phone notification when one becomes due (`useNoteReminders`), filter «⏰ بالتذكير» | `components/NotesView.tsx`, `components/useNoteAlerts.ts`, `public/sw.js`, `lib/notes.ts` (pure, tested), `Note` in `lib/ledger.ts`, `.notebook*` / `.note-*` in `globals.css` |
| Reports screen (all figures come from المبيعات, `report()` in `lib/shop.ts`; «السلع لي تباعو» groups by the sale's `item`, NOT the purchase's: a name fixed by hand in المشتريات must be fixed in المبيعات too (column E «السلعة»); an edit made in the app (`purchase.update`) updates both) | `components/ReportsView.tsx`, `report` in `lib/shop.ts` |
| Shop barcodes (EAN-13 starting with 2, new number) | `lib/barcode.ts` |
| Sticker printing window (sizes, list, 🔄 / ⬇️, print pages) | `components/LabelPrint.tsx` |
| Printer setup panel (gap, margins, shift, lines, sizes, rotation, Paysage, driver page) | `components/LabelSetup.tsx` (UI + `useLabelSetup(shared)`) |
| Shop default sticker look («💾 حفظ كإعداد عادي», setting `sticker-look`): look shared via the sheet, printer fields (`PRINTER_FIELDS`: gap, pageW, dx, dy, mode, landscape, driverPage) per device | `lib/label-layout.ts` (`lookOf`, `withLook`, `sameLook`), `useLabelSetup` in `components/LabelSetup.tsx`, bar in `components/LabelPrint.tsx` |
| Sticker layout math (pitch, pages, @page CSS, moves, resize) | `lib/label-layout.ts` (pure, tested) |
| Canva-like sticker editor (1 finger move, 2 fingers resize) | `components/StickerEditor.tsx` |
| Barcode / sticker PNG download | `lib/barcode-image.ts` |
| Camera scanner UI (modal, history list, torch, hint, messages) | `components/BarcodeScanner.tsx` (public API: props `title, onResult, onClose, continuous, paused`; exports `cleanCode`, `ScanFeedback`, `SCAN_HINT`, `NOT_BARCODE`) |
| Scanner engine (formats + check digits, 2-read confirm, decode region, worker, camera tuning) | `src/scanner/*` (see below) |
| USB / Bluetooth scanner (keyboard input, AZERTY fix) | `components/useScannerInput.ts`, `lib/scanner-input.ts` |
| Beep sound | `lib/beep.ts` |
| Login, session cookie, users / roles / services (`SELLER_SERVICES`: … `repairs`, `claims`, `reports`, `backup`; role `seller` = credit changes wait for the owner; seller's «الزبناء لي كيتبع» = `clientScope`) | `app/login/page.tsx`, `app/api/login`, `lib/auth.ts`, `lib/users.ts`, `lib/roles.ts`, `components/UsersDialog.tsx` |
| Who may do what (UI hides, server enforces) | `lib/roles.ts` (`can`, `seesCost`), `lib/permissions.ts` |
| Route protection (what needs login) | `src/proxy.ts` (matcher: login, PWA files, `/scanner/` are public) |
| Offline / PWA (pages: network if it answers within 4 s, else the saved copy; an open app never reloads itself, so each build has `NEXT_PUBLIC_APP_VERSION` (next.config.ts, Vercel commit) sent as `version` by `/api/data`; an older page shows «🔄 كاينة نسخة جديدة» → `reloadNewest` clears the saved pages and reloads, only on a tap) | `lib/app-version.ts`, `public/sw.js` (cache version `VERSION`), `components/RegisterServiceWorker.tsx`, `components/InstallButton.tsx`, `app/manifest.ts`, `lib/idb.ts` |
| Sync state bar, refused changes (who / device / what differs, filtered by permissions) | `components/SyncBar.tsx`, `lib/change-origin.ts` |
| Header menu (users, «💬 رسائل التذكير» for accounts with `reminders`, «🏭 خدمة العملاء» brands' numbers for accounts with `claims`, backup, theme, logout) | `components/TopMenu.tsx`; theme `lib/theme.ts` |
| Excel backup (every tab except users; each cell kept under Excel's 32 767 chars by `fitCell`, so pictures stay ≤ 32 000: `MAX_PHOTO_LENGTH`) | `lib/xlsx.ts`, `lib/backup.ts`, `components/BackupDialog.tsx`, `app/api/export` |
| Archive (old customers) | `components/ArchiveView.tsx`, `app/api/archive/*`, `lib/store.ts` |
| Sheets API client / env vars | `lib/sheets.ts`, `lib/env.ts` |
| Modals (full screen on phones, back button; optional `head` replaces the title, `className="page"` = full screen on PC too) | `components/Modal.tsx`; shared bits `components/ui.tsx` (`Field`, `Confirm`, `parseAmount`) |
| All styles | `src/app/globals.css` (one file, sections by feature; search the class name) |
| DEV ONLY reset | `lib/dev-reset.ts`, `components/DevReset.tsx`, `app/api/dev/reset` |

### Scanner engine (`web/src/scanner/`)

- `formats.ts`: `PRODUCT_FORMATS` (EAN/UPC), `QR_FORMATS`, `SN_FORMATS`, `codeKind()`, `isValidRead()` (check digits).
- `confirm.ts`: accept after 2 identical reads; same code ignored while in view / 1.5 s; `resume()`.
- `roi.ts`: guide rectangle (80% × 35%) → video pixels (object-fit cover); `recoveryRoiInVideo` = centred square (upright barcodes).
- `effort.ts`: progressive decoding. "fast" frames = ZXing with `tryHarder/tryRotate/tryInvert/tryDownscale` off, 1 symbol, on the strip (measured 3–5× faster per frame than ZXing's all-on defaults); after `RECOVER_AFTER_MS` (700) without a read, one frame in `HARD_EVERY` (3) is "hard": all passes on, square region. `textMode: "Plain"` keeps the text the old ponyfill gave (UPC-A as 13-digit EAN), so stock codes still match. Tested against the real wasm (`effort.test.ts`: an upright EAN-13 is missed fast, read hard).
- `detector.ts`: native `BarcodeDetector` (Android Chrome; only the region changes with the effort) or **zxing-wasm called directly** (`readBarcodes` on pixels, options from `effort.ts`; the `barcode-detector` ponyfill was dropped: it forced ZXing's slow options on every frame); `.wasm` from `/scanner/zxing_reader.wasm`.
- `decoder.worker.ts` + `decoder.ts`: decode in a Web Worker (ImageBitmap crop → pixels on an OffscreenCanvas for ZXing), main-thread fallback; each frame carries its effort.
- `camera.ts`: secure-context / errors, best rear lens (saved), focus / zoom / exposure / torch.
- `session.ts`: frame loop (`requestVideoFrameCallback`, drop frames while busy), pause, hint, cleanup.
- The `.wasm` is copied by `web/scripts/copy-zxing-wasm.mjs` (postinstall / predev / prebuild) from the
  direct dependency `zxing-wasm` (exact version; its package.json isn't exported, so a fixed path) into
  `web/public/scanner/` (git-ignored).

## Planned, not now

- Not under approval (on purpose): archiving customers (`/api/archive`, moves paid-off
  customers, debts unchanged). Ask the owner before adding it.
- **Operating costs (تكاليف التشغيل)** will go in a future «معلومات المحل»
  (shop info) section and feed the budget / reports. The owner asked to wait:
  don't add them until asked.

## Environment variables (server)

`APP_PASSWORD`, `SESSION_SECRET` (≥ 32 chars), `GOOGLE_SHEET_ID`,
`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, optional
`GOOGLE_SHEET_NAME`, `GOOGLE_SHEETS_API_BASE`, `GOOGLE_ACCESS_TOKEN`,
`ALLOW_DATA_RESET`, `WATI_API_ENDPOINT`, `WATI_ACCESS_TOKEN`,
`WATI_TEMPLATE_NAME`, `WATI_BROADCAST_NAME`, `WATI_CHANNEL_NUMBER`
(see `web/src/lib/env.ts`). None are available in the cloud sandbox.

## Commands (run in `web/`)

- `npm ci` (also copies the scanner `.wasm`)
- `npx tsc --noEmit`: type check (the "lint" script)
- `npx vitest run` / `npx vitest run src/lib/ledger.test.ts`: tests
- `npm run build`: production build (works without env vars)
- Known: **2 tests in `src/lib/sheet-logic.test.ts` (Casablanca time) fail in
  the sandbox** (timezone data) and on `main` too. Not caused by your change.
- Known: `npm run build` and `next dev` may **stop once** with a Next.js security
  notice (`SecurityFatalError`, advisory GHSA-mfr8-8qww-v76h on next 16.4.3, about
  `use cache` + `unstable_cache`, which the app doesn't use). Run the same command
  again: it then works. Upgrading Next.js is a separate change the owner hasn't asked for.

Tests live next to the code: `src/lib/*.test.ts`, `src/scanner/scanner.test.ts`.
Put new logic in pure functions in `lib/` (or `scanner/`) and test it there.

## Checking UI changes in the sandbox (no Google Sheet, no login)

The proxy lets any path starting with `login` through, so a **temporary** page
can render a component with fake data:

1. Create `web/src/app/login-xtest/page.tsx` that renders e.g.
   `<StockView data={{ ledger: {...}, me: { role: "owner" }, run: () => {} } as never} onToast={() => {}} />`
   (`LabelPrint`, `BarcodeScanner`, `StockView` all work this way).
2. `npx next dev -p 3123` in the background, then Playwright
   (`require('playwright')`, Chromium pre-installed) for screenshots / PDF.
   Camera: `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`
   and `--use-file-for-fake-video-capture=<file>.y4m` (make the y4m from PNGs
   with ffmpeg; all PNGs must be the same mode, e.g. RGB 640×480).
3. **Delete the test page, `.next/` and `web/AGENTS.md`** (created by next dev)
   before committing.

To test `<Dashboard />` itself, render it on such a page and answer the app's
calls in Playwright: `ctx.route('**/api/**', …)` returning `{ ledger, today, me }`
for `/api/data`; set `localStorage['backup-last'] = Date.now()` first, or the daily
backup window covers the screen.

Notes: launch Chromium with `LANG=C.UTF-8` or Arabic download file names come
out as "download". Two-finger touch can't be sent through CDP; dispatch
`PointerEvent`s in the page instead. On phone width, `.search-row` uses
negative margins that need the app's page padding (overflows in bare test pages).

## Git / PR workflow used here

- Work on the session's `claude/...` branch; when its PR was merged, continue
  from `origin/main` (fast-forward) on the same branch name.
- The owner tests only on the deployed app, so after a change they usually say
  **"pull request and merge"**: open the PR (English, What / Checks sections,
  footer from the session) and merge it with `merge_method: merge`.
- Temporary / experimental work is marked `[TEST]` in the PR title.
- **"I don't see the change"** after a merge: check the PR's Vercel status
  (`pull_request_read` → `get_status`: «Deployment has completed»). If it's deployed,
  the owner's open app is on an older build: the blue «🔄 كاينة نسخة جديدة» bar
  (from PR 50 on) or Ctrl+Shift+R / closing and reopening the app loads it.
- No force-push (blocked); use merges instead of rebases.
