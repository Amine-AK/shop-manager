# Shop app: sales, stock and cash drawer (Next.js PWA)

A web app for a small shop, stored in a Google Sheet. It opens in the browser on
a PC or laptop and installs on an Android phone like a normal app. It works
offline and syncs when the connection comes back.

What it does:

- **Sales (cash):** cart, family buttons, search as you type, camera or USB /
  Bluetooth barcode scanner, discounts with a guard against selling under cost,
  «عطاك» (cash given → change), and a ticket for the thermal printer.
- **Stock:** products with cost, price, quantity, new / used, several codes per
  product (one per supplier), the shop's own EAN-13 barcodes and sticker printing,
  and a log of every quantity change.
- **Cash drawer and reports:** what came in today, closing with expenses and
  the count, revenue and profit per day, family and product.
- **Employees:** owner, sellers and a stock manager, with permissions; some
  sellers' changes wait for the owner's approval.
- **Notebook (الكناش):** notes and customers' requests, with reminders.
- **Excel backup** of the whole sheet.

## The Google Sheet

The app works in these tabs (it creates them on an empty sheet the first time
the owner opens it, and adds any tab a newer version needs):

| Tab | One row per |
|---|---|
| `المخزون` | product: name, family, new/used, cost, price, quantity, codes, last change by / from |
| `الفئات` | product family, its target margin and its icon |
| `المبيعات` | line sold: ticket, cost, price, profit, seller |
| `حركات المخزون` | quantity changed by hand (delivery, count, loss…) and why |
| `الصندوق اليومي` | drawer closing: sales, expenses, expected, counted, difference |
| `الإعدادات` | shop setting (key → JSON): default sticker look, approval rules |
| `طلبات الموافقة` | seller's change waiting for the owner, and the decision |
| `الكناش` | notebook line |
| `المستخدمين` | employee account (password hashed; never in the Excel backup) |

Records are linked by their numbers (`I-…`, `V-…`, `M-…`), so moving or sorting
rows by hand doesn't break anything. You can read and fix things in the sheet
directly, but **don't change the numbers in the first columns**.

### Excel backup

In the **⚙️ menu** (top of the page): **«⬇️ تحميل Excel»** downloads
`electro-lmestour-backup-YYYY-MM-DD.xlsx`: a copy of every tab of the Google
Sheet (stock, sales, cash drawer, notebook…), one Excel sheet per tab. Phones stay text (leading 0 kept), amounts
stay numbers. It needs internet; changes made offline are in it only once
they have synced. The file opens in Excel or LibreOffice, or can be imported
back into Google Sheets (File > Import).

**Daily backup on WhatsApp.** Every 24 hours the app asks to send the file
to WhatsApp **0662275062** (`BACKUP_PHONE` in `src/lib/backup.ts`); «من بعد»
asks again 3 hours later. It is also in the menu: «📤 صيفط Excel فواتساب».
WhatsApp links can't attach a file, so sending takes a tap or two:

- **Phone:** the share menu opens with the file attached; choose WhatsApp,
  then the chat with 0662275062.
- **PC:** the file is downloaded and WhatsApp Web opens the chat with
  0662275062; drop the file in it (📎).

The 24 hours are counted per device (phone and PC each remember their last
backup).

## The shop: sales, stock, cash drawer, reports

Four sections (bottom bar on the phone, tabs on a PC): **البيع**, **المخزون**,
**الميزانية** (cash drawer + reports) and **الكناش**. Everything works offline
and syncs later.

- **البيع (sale):** cash only. Big buttons for the product families (📱 🔌 🍳…):
  tap one to list its products in stock (and «حاجة أخرى» for something not in
  stock, like a repair), or search as you type (`ip 11` finds `iPhone 11 64GB`). The price can be changed (discount); the
  cost and profit are shown, and a price under cost is refused.
  A sale prints a «وصل البيع» ticket.
- **Several codes per product (one per supplier):** the same product bought
  from different suppliers comes with different QR codes / barcodes / S/N. All
  of them go in the product's «الأكواد» box (one per line) and all lead to the
  same product; sales don't use codes up. Scanning a code that leads to no
  product asks «سلعة جديدة» or an existing product from a new supplier: the code
  is then added to it with the delivery (logged in حركات المخزون). A code can
  belong to one product only. Sheet: «الكود» (first code) and «أكواد أخرى
  (موردين آخرين)» (one per line) in المخزون, «أكواد جديدة» in حركات المخزون.
- **📷 Scanning (barcode):** «📷 سكاني» in المخزون opens the camera. A
  code already in stock asks how many arrived (+1); a new code opens «سلعة
  جديدة» with it filled in. 📷 in the البيع search bar puts the scanned product
  in the sale. The codes are kept in the «الكود» / «أكواد أخرى» columns. The
  camera reads product barcodes (**EAN-13, EAN-8, UPC-A, UPC-E**), and also
  **QR codes** (QR, Data Matrix) and **serial numbers** (Code 128, Code 39,
  Code 93, ITF, Codabar). For a QR or S/N it says «⚠️ هادا ماشي باركود (QR / S/N)»
  over the camera and tags it «ماشي باركود» in the list; the code is still used.
  The code can also be typed. A QR code must fit inside the guide rectangle.
- **Scanner engine (`src/scanner/`):**
  - Reader: the browser's own `BarcodeDetector` when it reads all product
    barcode formats (Chrome on Android), else ZXing-C++ in WebAssembly called directly
    (`zxing-wasm`: iPhone, PCs). The `.wasm` (~0.9 MB) is served by the app from
    `/scanner/zxing_reader.wasm` (copied from `node_modules` by
    `scripts/copy-zxing-wasm.mjs` on install / dev / build, not committed), kept
    by the service worker for offline use, and reachable before login.
  - Only the guide rectangle (80% × 35% of the camera box) is decoded, in a Web
    Worker (main-thread fallback), one frame at a time (frames are dropped while
    one is decoded), driven by `requestVideoFrameCallback`.
  - Camera: rear, 1280×720 (at most 1920×1080). On phones with several rear
    lenses the main one (continuous focus, not ultra-wide) is chosen and saved
    on the device. Then, when the camera has them: continuous focus, 2× zoom
    (hold the phone farther, in focus), focus / exposure on the centre, exposure
    −⅓ EV against lamp glare, and a 🔦 torch button.
  - **Progressive decoding** (`effort.ts`): normal frames are read fast (ZXing's
    extra passes off: measured 3–5× faster per frame than the old all-on reading).
    After 0.7 s without a read, one frame in three tries hard on a centred square:
    rotations (a barcode held **upright** now reads), inverted colours, downscaled
    copies. Fast frames continue in between.
  - A code counts after 2 identical reads; EAN / UPC check digits are verified.
    After 3 s without a read a hint shows (`SCAN_HINT` in `BarcodeScanner.tsx`).
  - Clear messages for: no HTTPS, permission refused, no camera, camera busy.
- **Camera scanning, one after the other:** the camera opens once and keeps
  reading until **✓ ساليت (N)**. Each read beeps: high = good, low double =
  not good (unknown in a sale, already in the list, used by another product),
  and the phone vibrates. The last codes read are listed under the camera.
  - البيع: each code adds its product (same code again = +1).
  - Product form 📷: each code goes on its own line.
  - المخزون 📷: the camera waits behind the window a code opens (quantity /
    new product) and reads again when it is closed.
  - A code held in front of the camera is read once; the same code is read
    again after it has been out of view for 1.5 s (e.g. the next unit).
- **USB / Bluetooth barcode scanner:** no need to click anything first. In
  البيع a scan puts the product in the sale (scan twice = quantity 2); in
  المخزون it asks «شحال وصلات منها؟» for a known product or opens «سلعة جديدة»
  with the code. Works on AZERTY (French) PCs too: the app reads the physical
  keys, and repairs codes scanned into a field («é&ç…» → «219…»). A scan is
  ignored while a window (receipt, form) is open, and its Enter never presses
  a button. Scanners must end each code with Enter (the factory default).
- **Families (🗂️ الفئات in المخزون):** add or change a family, with an emoji or
  a picture (photo or file). Pictures are cropped and shrunk to 96×96 and saved
  as text in the «الأيقونة» column (about 1–5 KB, well under a cell's limit), so
  they need no other storage. «＋ فئة جديدة…» in the product form opens the same
  window. Sheets made before this column get its title added on their own.
- **المخزون (stock):** a sale takes the product out of stock; cancelling it
  (in التقارير) puts it back. Quantity changes by hand are differences
  (+3 delivered, −1 lost), so counts from two phones add up, and each one is
  logged with its reason.
- **الصندوق (cash drawer):** money in for the day = the day's sales. «إغلاق الصندوق» records the expenses and the cash actually
  counted; the sheet keeps the expected amount and the difference, so the owner
  can check every evening. Sales typed in that day with an earlier date are
  listed apart.
- **التقارير (reports):** today / week / month / year / custom, by family or
  product name: revenue, net profit (price − cost; lines without a known cost
  are counted apart), average ticket, units sold per product, chart per day or
  month.

No name to type: the server writes the logged-in account as the seller.

## 1. Google Sheets access (once)

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a
   project.
2. **APIs & Services > Library**, search **Google Sheets API** and click **Enable**.
3. **IAM & Admin > Service Accounts > Create service account**. Give it a name and
   no role.
4. Open it, go to **Keys > Add key > Create new key > JSON**. A file downloads.
5. **Share the Google Sheet** with the `client_email` from that file, as
   **Editor** (the app writes to the sheet).
6. Put `client_email` in `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `private_key` in
   `GOOGLE_PRIVATE_KEY`. Keep this key secret: it can edit the sheet.

## 2. Run on your computer

You need Node.js 20 or newer.

```bash
cd web
npm install
cp .env.example .env.local   # then fill it in
npm run dev                  # http://localhost:3000
```

## 3. Put it online (needed to install it on the phone)

Installing a PWA needs HTTPS, so host it. [Vercel](https://vercel.com) is free
for this:

1. Push the repository to GitHub (already done).
2. On Vercel: **Add New > Project**, pick this repository, and set **Root
   Directory** to `web`.
3. Add every variable from `.env.example` under **Environment Variables**.
4. Deploy. You get an address like `https://electro-lmestour.vercel.app`.

## 4. Install the app

- **Android (Chrome):** open the address, log in, then **⋮ menu > Install app**
  (or "Add to Home screen"). It gets its own icon and opens full screen.
- **PC / laptop (Chrome or Edge):** open the address and click the install icon
  at the right of the address bar. Or just keep using it in the browser.

## Printing tickets (thermal printer)

After a sale, the ticket (**وصل البيع**) opens by itself with a **🖨️ طبع**
button; «وصل» next to any sale in التقارير prints it again. It works offline too.

Choose **58 mm** or **80 mm** paper in the ticket window; the app remembers it on
that device.

- **PC / laptop (USB printer):** install the printer's driver (Xprinter, Epson
  TM, Rongta…), then in the print window choose the printer, **Margins: None**,
  **Scale: 100**, and the paper size of your roll (e.g. 80 × 297 mm or "Roll").
  Turn off *Headers and footers*.
- **Android phone (Bluetooth or USB printer):** Android needs a print service for
  the printer. Install the printer maker's print plugin, or a general one such as
  **RawBT**, enable it in *Settings > Connected devices > Printing*, then press
  **طبع** and choose the printer.

Do a test print once to check the width; if the right side is cut, choose 58 mm.

## Shop barcode stickers (باركود المحل)

Each product can get the shop's own barcode, so the same item bought from
different suppliers carries one label with one name and one price.

- **Make and print:** in **المخزون**, press **🏷️ باركود**. Tick the products (or
  **ختار هادو كاملين**: one sticker per unit in stock), change the number of
  stickers if needed, and press **🖨️ طبع**. From a product's edit window,
  **🏷️ طبع باركود المحل** opens it with that product already chosen.
- **The code:** an EAN-13 that starts with **2**. Codes starting with 2 are
  reserved for in-store use, so they never match a factory barcode. It is saved
  with the product's other codes (column «أكواد أخرى (موردين آخرين)») the first time you print,
  and stays the same at every reprint. Scanning it in **البيع** or **المخزون**
  finds the product like a supplier's code.
- **Sticker:** on a roll, the lines chosen in **ضبط الطابعة** (by default:
  small product name, bold price, barcode without digits). On A4: shop name,
  product name, price (untick **نطبعو الثمن** to leave it out), barcode and digits.
- **Paper:** a roll of stickers (**50 × 40**, **40 × 30**, **50 × 30** in one tap,
  or any size typed in the setup) or an **A4** sheet of 24 stickers (3 × 8,
  70 × 37 mm). The barcode is drawn with each bar a whole number of dots of a
  203 dpi printer, so it prints evenly on small stickers.
- After changing a price, print new stickers for the units on the shelf.

### New product, new number, barcode image

- **New product without any code:** pressing **زيد** asks «🏷️ ما زدتيش باركود»:
  **صاوب باركود** (saves it with a shop barcode), **🖨️ صاوب باركود وطبع
  الملصقات دابا** (same, then opens the sticker window with it ticked), or
  **لا، بلا باركود**.
- **In the product form**, under the codes: **🏷️ صاوب باركود ديال المحل** puts
  a shop barcode in the codes; once there, **🔄 رقم جديد للباركود** swaps it for
  another random number (as many times as you like, saved with **حفظ**), and
  **⬇️ تحميل الباركود (صورة)** downloads it as a PNG (the sticker, see below);
  a product with only a supplier's EAN-13 barcode can be downloaded too.
- **Next to the sticker preview** (sticker window): **🔄** changes the shown
  product's barcode to a new number, **⬇️** downloads it as a PNG (the new
  code is saved first, so the image always scans as the product).
- **In the sticker window**, each product has **🔄** (new number, saved when
  printing) and **⬇️** (PNG image). A new number on a product that already had
  a shop barcode replaces it: its old stickers no longer scan, print new ones.
- **The image is the sticker** as set in **ضبط الطابعة**: its size, margins,
  rotation, the ticked lines and their sizes, bold price, space between lines,
  bar height and digits (not the printer shift / gap). Drawn at 16 px per mm.
  The file is named after the product: `<product name>.png`.

### ⚙️ ضبط الطابعة (printer setup)

Under the preview, saved on each device (each PC has its own printer). The
preview draws the sticker's edge (red dashes) and the space inside the margins.

- **شنو هي الطابعة؟**
  - **طابعة التيكي 80mm** (a normal receipt printer): it cannot see the gaps
    between stickers, so the app places each sticker itself every
    *height + gap* mm, all on one long page (cut in pages of at most 100 stickers).
  - **طابعة الملصقات** (HPRT N41…): one page per sticker, the printer finds the gaps; gap 0.
- **قد الملصق:** width, height, **الفراغ** (gap between two stickers, 0.1 mm
  steps) and **عرض الورقة** (paper width sent to the printer; 0 = sticker width,
  try 72 or 80 if the driver shrinks or cuts the sticker).
- **حجم الورقة:** **قد الملصق** (default: the app sends the exact page size) or
  **من الطابعة (driver)**: no page size is sent, the stickers start at the top
  of the paper chosen in the printer's settings. For printers that don't take
  the page size from the app. Paysage is hidden in this mode.
- **اتجاه الورقة للطابعة:** **Portrait** (default) or **Paysage**: the page is
  sent in landscape (width and height swapped, stickers drawn turned 90°), for
  drivers that print the sticker sideways or shrunk. If it comes out upside
  down, set **الدوران** to 180°.
- **الهوامش:** empty space inside the sticker: top (header), bottom (footer), right, left.
- **التحريك:** moves the whole sticker right/left and down/up.
- **شنو نطبعو:** tick each line to print, top to bottom: shop name (off by
  default), product name (7 pt, small), price (14 pt, **bold** on/off), the
  barcode (bar height in mm, digits under it off by default), and the space
  between lines (mm). On an A4 sheet the price is ticked in the window itself.
- **الدوران:** turn the content 0°/90°/180°/270° (e.g. a 40 × 50 roll fed sideways).
- **طبع 5 ديال التجربة بالإطار:** prints 5 stickers with their edges drawn,
  saves no barcode. Then:
  1. Each frame lower than the one before → lower **الفراغ** by 0.1; higher → raise it.
  2. All frames off by the same amount → use **التحريك**.
  3. Print window: **Margins: None**, **Scale: 100**, **Headers and footers** off.
  4. Receipt printer driver (*Printing preferences*): turn off the automatic
     cut and the paper feed after printing.

### 💼 الميزانية

The cash drawer (💰 الصندوق) and the reports (📊 التقارير) are one tab,
«💼 الميزانية», with a switch at the top (only the parts the account may open).

### 📝 الكناش (the shop's notebook)

A main tab that looks like the paper notebook next to the till, for every account
(owner, sellers, stock manager).

- Write a line at once at the top of the page: «📝 ملاحظة» (anything to remember)
  or «🙋 طلب زبون» (what a customer asked for). Add the customer if it's about one:
  name and phone, typed as free text (not linked to any customer list). Date,
  time and who wrote it are kept.
- Pages per day («اليوم», «البارح», then the date), newest first. Tick ✓ when it's
  done (who and when are kept). Search by word, customer or phone; filters
  «🙋 طلبات باقية», «ما تداروش», «✓ تدارو». 📞 calls the customer.
- Tap a line to change it. Only the owner can delete a line.
- The number of customer requests not done yet shows on the tab.
- Sheet tab «الكناش» (created on first use).
- **⏰ Reminders** (so a promise to a customer isn't forgotten under pressure):
  when writing a line, tap «⏰ ذكّرني»: the phone's date-and-time picker opens,
  choose when to be reminded. No time is set by itself; «✕ بلا تذكير» removes it.
  The time shows on the button and on the line («⏰ 25/11 16:30»). When it comes and the line isn't ticked off:
  - a red bar on top of every tab «⏰ N تذكير فالكناش: «…»» (tap → الكناش), and a
    red number on the الكناش tab;
  - a popup in the app, and a phone notification if the app is in the background
    (notifications turned on, see below);
  - a red box «⏰ وقت التذكير» on top of the notebook: «✓ تدار», «⏰ +ساعة», «⏰ غدا»
    (postpone), 📞 and 💬 to reach the customer.
  It's shown on every account's device; the filter «⏰ بالتذكير» lists the lines
  with a reminder. Kept in the last columns of «الكناش» («تاريخ التذكير», «ساعة التذكير»).
- **Like notifications**: what another account writes, ticks off or changes in the
  notebook is news for you until you open الكناش on that device. The tab shows the
  number in blue; elsewhere in the app a popup says it («🙋 Said كتب طلب زبون: …»);
  in the notebook a box «🔔 جديد من آخر مرة» lists it and the lines are highlighted.
  Your own changes are never news. The app checks for news every minute while open.
- **Phone notifications**: press «🔔 فعّل الإشعارات ديال الكناش فهاد الجهاز» once on each
  phone / PC. While the app is open in the background, the news comes as a phone
  notification; tapping it opens الكناش. When the app is fully closed nothing
  arrives (that needs a push server, not set up); on iPhone only the installed app
  can show notifications.

### 🛒 Faster sale screen

- The search and 📷 stay at the top while the page scrolls; the big category
  buttons are under them, as before.
- A category opens its own full-screen page (no app header): a menu at the top to
  switch category, a search that stays in the category, filters «✅ متوفر», «جديد»,
  «مستعمل», and the products as cards (in stock and best sellers first). Tapping a
  card adds it to the sale (🛒 shows how many), and the page stays open for the
  next one; the bottom bar shows the cart and goes back. Long categories load as
  you scroll. The phone's back button closes the page.
- «عطاك» (cash given): quick amounts («✓ المبلغ كامل» and round notes), then the
  change to give back («🔁 رد ليه …») or «✓ خالص». If it's short, it says how much
  is missing.

### 🔄 New version of the app

An app window left open (or opened on a slow network, from the copy saved on
the device) keeps the version it started with. When a newer version is online,
a blue bar «🔄 كاينة نسخة جديدة ديال التطبيق» appears with «حدّث دابا», which loads
it. It never reloads by itself, so a half-filled sale or form isn't lost.

### ⏳ Sellers' changes wait for the owner (طلبات الموافقة)

Some changes a **seller** account makes are not written to the sheet at once:
they are kept in the tab «طلبات الموافقة» until the owner decides. Which ones is
a shop setting, in ⚙️ → «⏳ شنو كيتسنى موافقتي» (owner only; all on for a new shop):

- ↩️ cancelling a sale,
- 🏷️ a product's new selling price or cost,
- 📉 stock taken out (loss, theft, correction),
- 🗑️ deleting a product,
- 🔒 closing the cash drawer with a difference (counted ≠ expected).

How it works:

- Meanwhile the app shows the change, marked ⏳ (product list, drawer closings);
  the sheet itself does not change. Sales go on normally.
- **Owner**: in البيع and المخزون the bar «⏳ N تعديل ديال البائعين كيتسنى الموافقة ديالك»
  opens the list, grouped by product (or sale, or drawer): «✓ قبول», «✕ رفض»
  (with a reason), «✓ قبل الكل». Accepting a second edit of a product also
  accepts the first one it was made on; refusing the first refuses what was built
  on it. The owner can't edit a product a seller changed until deciding.
- **Seller**: sees what still waits, and the changes refused in the last 7 days with the reason.
- **Notes**: on a waiting change of their own the seller can write «📝 ملاحظة للمالك»,
  shown to the owner in the list. The owner can accept with a note too
  («📝 قبول بملاحظة»); the seller sees it for 7 days. Both are kept in the tab
  «طلبات الموافقة» («ملاحظة البائع», «ملاحظة المالك / سبب الرفض»).

### Who changed a product, and refused changes

Every change says which account made it (stamped by the server) and from which
device («📱 Android · Chrome · #K3F9»: system, browser, a short id kept on the
device). Products keep the last ones in the المخزون columns «آخر تعديل من» and
«الجهاز». When an edit is refused because the product changed meanwhile, the
red box in the sync bar says who changed it, from which device and when, and
for each field what you wanted and what the sheet has now; then **طبقو**
(apply on the current version) or **تجاهل**. A seller only sees refused changes
for the services their account has (and no buy prices without cost rights),
even if another account used the same device.

### 💾 The shop's default sticker look

Under the sticker preview a line says whether this is the shop's default look.
**💾 حفظ كإعداد عادي** saves the current look (size, margins, rotation, lines,
sizes, bold price, bar height / width, digits, spacing, finger moves) in the
sheet tab «الإعدادات»: every device then uses it, for printing and for every
barcode image download (sticker window and product form). Changing the
sticker afterwards is a draft on that device («✏️ تبديلات ما تسجلاتش»), until
saved again or undone with **↺ رجع للعادي**. A default saved on another device
replaces the draft. The printer settings (gap, paper width, shift, printer
type, Paysage, driver page) stay each device's own. Owner and stock manager
can save the default.

### ✋ Editing the sticker with the fingers (like Canva)

The sticker preview in the sticker window is an editor, zoomed to the screen width:

- **One finger** (or the mouse) on a line (shop name, product name, price,
  barcode): selects it (dashed frame) and **moves** it anywhere on the sticker.
- **Two fingers** spread / pinched: the selected line gets **bigger / smaller**
  (text: its size in pt; barcode: its width and bar height together).
  On a PC: the **mouse wheel**. The **− / +** buttons do the same.
- **↺ رجع البلايص** puts every line back in its place.
- Saved on the device with the other sticker settings; printing and the
  downloaded image use the same positions and sizes. Nothing shows outside
  the margins.

### HPRT N41 (label printer, 203 dpi), once on the PC

1. Install the HPRT driver for the N41 from the HPRT website, and connect it by USB.
2. Load **direct thermal** 50 × 40 mm labels (no ribbon needed), then calibrate
   so it finds the gaps (see the printer's manual; usually hold the feed button).
3. *Printers > HPRT N41 > Printing preferences*: paper **50 × 40 mm**, media
   **labels with gaps**, orientation **portrait**. Start with darkness around
   the middle and a slower speed, and raise the darkness if the bars are grey.
4. In the app choose **طابعة الملصقات**; in the print window choose the N41,
   **Margins: None**, **Scale: 100**, no headers and footers. Print 2–3 stickers
   and scan them with the phone or USB scanner before printing a big batch.

## Working without internet

After the app has been opened once with internet on a device, it also works
**offline** on that device:

- It opens and shows the stock and sales as they were at the last sync (the bar at
  the top says when).
- You can **sell, add and edit products, count stock, write in the notebook**. Each change is saved on the
  device right away and marked **ما تزامنش** (not synced yet).
- When the connection comes back, the changes are sent to the Google Sheet **by
  themselves, in the order you made them**. This happens as soon as the phone is
  back online, when you open the app, and every 30 seconds while changes wait.
  The app must be open for this; a closed app syncs the next time it's opened.

What makes syncing safe:

- **Nothing is applied twice.** Every change has its own number; if the phone
  sends it again (the connection dropped before the answer), the server sees it
  is already there.
- **Rows can move.** Everything is found by its number (I-…, V-…, M-…), not by
  its row.
- **Other people's changes are never overwritten.** If a product or a notebook
  line was changed on another device while you edited it offline, your change
  is refused and listed under ⚠️ at the top: **طبقو** (apply it anyway, on the
  current version) or **تجاهل** (drop it).
- **Few requests:** a whole batch of changes is saved with about 5 Google
  requests, so a long offline day syncs in one go.
- The changes waiting on a device live in that browser's storage. Clearing the
  browser data, or uninstalling the app, before they're synced loses them.

## Employee accounts and permissions

- **Owner (المالك):** logs in with the name `owner` and `APP_PASSWORD` (sessions
  from before accounts count as the owner's). Sees and does everything, and
  manages accounts in ⚙️ → «👥 المستخدمين والصلاحيات». Other owner accounts can
  be created there too.
- **Seller (البائع):** what the owner ticks: sale, cancel sales, stock
  management, cash drawer, reports, Excel backup. Discounts are free. Some of
  their changes wait for the owner (see «⏳ Sellers' changes wait for the owner»).
- **Stock manager (مسؤول المخزون):** only المخزون: add products, add deliveries
  (+), scan and search. No sales, quantities out, edits or deletions.
- **Buy prices and profit:** visible to an employee only if the owner ticks
  «يشوف ثمن الشراء والربح». Otherwise the server never sends them (an employee
  can still enter the cost of a new product). «قيمة المخزون» is for the owner only.
- Accounts live in the sheet tab «المستخدمين»: name, login, role, services, cost
  visibility, active, and the password **hashed** (scrypt, at least 8
  characters). This tab is never in the Excel backup.
- **The server enforces it:** each route checks the permission, each change
  synced from a phone is refused if not allowed, and the server writes who made
  each sale, stock change and drawer closing (and fills in the cost of a sale
  made by an employee who can't see it). Disabling an account or changing its
  password signs it out at once; 5 wrong passwords in 10 minutes block the
  login for a while.
- On a shared phone or PC: logging out waits for unsent changes, then removes
  that user's copy of the data; when another person logs in, the previous
  person's offline data is cleared.

## DEV ONLY: «مسح جميع المعلومات» (empty the sheet while testing)

With `ALLOW_DATA_RESET=true` in Vercel (then Redeploy), the ⚙️ menu shows
«🧪 مسح جميع المعلومات (تطوير)». It downloads an Excel backup (ticked by
default), asks to type «مسح», then empties every app tab of the Google Sheet
(titles stay, the default families come back) and
forgets this device's unsent changes. Without the variable the button is hidden
and `/api/dev/reset` answers 403. Other phones should reload the app after a
reset, or their unsent changes could come back.

**Before going live:** delete `ALLOW_DATA_RESET` in Vercel. To remove the code:
`src/lib/dev-reset.ts`, `src/app/api/dev/`, `src/components/DevReset.tsx`, and
the lines marked `DEV ONLY` (env.ts, api/data, useLedger.ts, TopMenu.tsx,
Dashboard.tsx).

## Security

- One shop password (`APP_PASSWORD`). After 30 days you need to log in again.
- Every page and API call requires login. Requests from other websites are refused.
- Google keys stay on the server and are never sent to the phone.
- Use a long password. Anyone with it can see and change the shop's data.

## Development

```bash
npm test          # ledger rules, approvals, permissions, cash drawer, reports, dates, scanner
npm run lint      # TypeScript check
npm run build
```

Code map: see `CLAUDE.md` at the root of the repository.
