"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { money } from "@/lib/format";
import { newLedgerId, nowParts, type Sale, type StockItem } from "@/lib/ledger";
import { currentSeller, findByCode, marginCheck, round2, searchStock } from "@/lib/shop";
import { fixAzertyDigits } from "@/lib/scanner-input";
import { BarcodeScanner } from "./BarcodeScanner";
import { CategoryIcon } from "./CategoryIcon";
import { SaleCategoryPage } from "./SaleCategoryPage";
import { cashOutcome, quickCash } from "@/lib/sale-browse";
import { useScannerInput } from "./useScannerInput";
import type { LedgerState } from "./useLedger";
import { parseAmount } from "./ui";

/** One line of the cart. Prices are per unit; the price stays text while being typed. */
interface Line {
  key: string;
  stockId: string;
  item: string;
  category: string;
  qty: number;
  /** Cost of one unit, null = unknown. */
  unitBuy: number | null;
  unitList: number;
  price: string;
  /** Units in stock when added, null = not from stock. */
  inStock: number | null;
}

export interface SaleDone {
  ticket: string;
}

let lineSeq = 0;

/**
 * Fast cash sale: the money goes in the drawer. Every line is logged in المبيعات;
 * products from stock go out of stock. Works offline like everything else.
 */
export function SaleForm({ data, onDone }: { data: LedgerState; onDone: (done: SaleDone) => void }) {
  const ledger = data.ledger!;
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  /** The category whose page is open over the screen ("" = none). */
  const [page, setPage] = useState("");
  const [error, setError] = useState("");
  const [given, setGiven] = useState("");
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchStock(ledger.stock, query, 12), [ledger.stock, query]);
  // Before anything is typed: what sells most.
  const browse = useMemo(() => {
    const sold = new Map<string, number>();
    for (const s of ledger.sales) if (s.stockId) sold.set(s.stockId, (sold.get(s.stockId) ?? 0) + s.quantity);
    return ledger.stock
      .filter((s) => s.quantity > 0)
      .sort((a, b) => (sold.get(b.id) ?? 0) - (sold.get(a.id) ?? 0) || a.item.localeCompare(b.item, "ar"))
      .slice(0, 8);
  }, [ledger.stock, ledger.sales]);
  const shown = query.trim() ? results : browse;
  const inStock = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of ledger.stock) if (s.quantity > 0) m.set(s.category, (m.get(s.category) ?? 0) + 1);
    return m;
  }, [ledger.stock]);
  const listOpen = open;
  // Units of each stock product in the sale (shown on the category page).
  const inCart = useMemo(() => new Map(lines.filter((l) => l.stockId).map((l) => [l.stockId, l.qty])), [lines]);
  const categories = ledger.categories;

  const lineTotal = (l: Line) => {
    const p = parseAmount(l.price || "0");
    return Number.isFinite(p) ? round2(p * l.qty) : NaN;
  };
  const total = round2(lines.reduce((s, l) => s + (lineTotal(l) || 0), 0));
  const listTotal = round2(lines.reduce((s, l) => s + l.unitList * l.qty, 0));
  const givenAmount = parseAmount(given || "0");
  const cash = cashOutcome(total, givenAmount);
  function addStock(s: StockItem) {
    setLines((ls) => {
      const same = ls.find((l) => l.stockId === s.id);
      if (same) return ls.map((l) => (l === same ? { ...l, qty: l.qty + 1 } : l));
      return [
        ...ls,
        { key: `L${++lineSeq}`, stockId: s.id, item: s.item, category: s.category, qty: 1, unitBuy: s.buyPrice > 0 ? s.buyPrice : null, unitList: s.sellPrice, price: String(s.sellPrice || ""), inStock: s.quantity },
      ];
    });
    setQuery("");
    setError("");
    setOpen(false);
  }

  /** A code from the camera or a USB scanner: the product goes in the sale. */
  function scanned(code: string) {
    const found = findByCode(ledger.stock, code);
    if (found) return addStock(found);
    setQuery(code);
    setError(`ما لقيناش الكود «${code}» فالمخزون. اختار السلعة ولا زيدها فالمخزون.`);
  }
  useScannerInput(scanned, formRef);

  function addFree(item: string, category = "", price = 0) {
    setLines((ls) => [...ls, { key: `L${++lineSeq}`, stockId: "", item, category, qty: 1, unitBuy: null, unitList: price, price: price ? String(price) : "", inStock: null }]);
    setQuery("");
    setError("");
    setOpen(false);
  }

  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  function validate(): string {
    if (!lines.length) return "زيد شي سلعة";
    for (const l of lines) {
      const p = parseAmount(l.price || "");
      if (!l.item.trim()) return "سمية السلعة ضرورية";
      if (!(p > 0)) return `حط الثمن ديال «${l.item}»`;
      if (l.unitBuy !== null && p < l.unitBuy) return `«${l.item}»: الثمن تحت ثمن الشراء (${money(l.unitBuy)})`;
    }
    return "";
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const err = validate();
    setError(err);
    if (err) return;
    const at = new Date().toISOString();
    const { date, time } = nowParts();
    const ticket = newLedgerId("V");
    const ops: Parameters<LedgerState["run"]>[1][] = [];

    const sales: Sale[] = [];
    lines.forEach((l, i) => {
      const unit = parseAmount(l.price);
      const sellPrice = round2(unit * l.qty);
      const id = i === 0 ? ticket : newLedgerId("V");
      sales.push({
        id,
        ticket,
        date,
        time,
        item: l.item.trim(),
        category: l.category,
        stockId: l.stockId,
        quantity: l.qty,
        buyPrice: l.unitBuy === null ? null : round2(l.unitBuy * l.qty),
        listPrice: round2((l.unitList || unit) * l.qty),
        sellPrice,
        seller: currentSeller(),
        notes: "",
        createdAt: at,
        updatedAt: at,
      });
    });
    ops.push({ type: "sale.add", lines: sales });
    const what = sales.length === 1 ? sales[0].item : `${sales.length} سلع`;
    data.run(`بيع · ${what} · ${money(total)}`, ...ops);
    setLines([]);
    setGiven("");
    onDone({ ticket });
  }

  return (
    <>
    <form ref={formRef} className="sale-form" onSubmit={submit} noValidate>
      {/* Stays at the top while the cart scrolls: search, scan, and the categories. */}
      <div className="sale-top">
      <div className="product-search">
        <label className="visually-hidden" htmlFor="sale-search">
          قلب على سلعة
        </label>
        <div className="code-row">
        <input
          ref={searchRef}
          id="sale-search"
          type="search"
          className="search"
          placeholder="🔍 قلب على سلعة: ip 11، شارجور، ثلاجة…"
          value={query}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls="sale-results"
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") return setOpen(false);
            if (e.key !== "Enter") return;
            e.preventDefault();
            // A USB / Bluetooth scanner types the code then Enter.
            const byCode = findByCode(ledger.stock, query) ?? findByCode(ledger.stock, fixAzertyDigits(query));
            if (byCode) addStock(byCode);
            else if (shown[0]) addStock(shown[0]);
            else if (query.trim()) addFree(query.trim());
          }}
        />
          <button type="button" className="btn scan-btn" onClick={() => setScanning(true)} aria-label="سكاني الكود بالكاميرا">
            📷
          </button>
        </div>
        {listOpen && (
          // Keep the focus in the input while tapping a result.
          <ul id="sale-results" className="product-results" role="listbox" aria-label="السلع" onPointerDown={(e) => e.preventDefault()}>
            {!query.trim() && <li className="pr-hint muted small">{browse.length ? "الأكثر مبيعا · ولا كتب باش تقلب" : "المخزون خاوي · كتب سمية السلعة"}</li>}
            {query.trim() && results.length === 0 && <li className="pr-hint muted small">ما كايناش فالمخزون</li>}
            {shown.map((s) => (
              <li key={s.id}>
                <button type="button" role="option" aria-selected="false" onClick={() => addStock(s)}>
                  <span className="pr-main">
                    <strong>{s.item}</strong>
                    <span className="muted small">
                      {s.category}
                      {s.condition === "مستعمل" ? " · مستعمل" : ""}
                      {s.serial ? ` · ${s.serial}` : ""}
                    </span>
                  </span>
                  <span className="pr-side">
                    <span className="amount">{money(s.sellPrice)}</span>
                    <span className={`stock-badge ${s.quantity > 0 ? "" : "out"}`}>{s.quantity > 0 ? `متوفر: ${s.quantity}` : "ما بقاش"}</span>
                  </span>
                </button>
              </li>
            ))}
            {query.trim() && (
              <li>
                <button type="button" className="pr-free" onClick={() => addFree(query.trim())}>
                  ＋ زيد «{query.trim()}» بلا مخزون
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
      </div>



      {/* The big family buttons (as before); each opens its own page. */}
      {categories.length > 0 && (
        <div className="cat-tiles" role="group" aria-label="الأصناف: كل صنف فصفحة ديالو">
          {categories.map((c) => (
            <button key={c.name} type="button" className="cat-tile" onClick={() => setPage(c.name)}>
              <CategoryIcon category={c} className="cat-icon" />
              <span className="cat-name">{c.name}</span>
              <span className="cat-count">{inStock.get(c.name) ?? 0} متوفر</span>
            </button>
          ))}
        </div>
      )}

      {lines.length === 0 ? (
        <p className="empty small">قلب على السلعة، سكاني الكود، ولا اختار صنف من الفوق.</p>
      ) : (
        <ul className="cart">
          {lines.map((l) => {
            const unit = parseAmount(l.price || "0");
            const check = marginCheck(unit, l.unitBuy, categories.find((x) => x.name === l.category));
            const profit = l.unitBuy !== null && unit > 0 ? round2((unit - l.unitBuy) * l.qty) : null;
            const discount = l.unitList > 0 && unit > 0 && unit < l.unitList ? round2((l.unitList - unit) * l.qty) : 0;
            return (
              <li key={l.key} className={`cart-line ${check}`}>
                <div className="cart-top">
                  {l.stockId ? (
                    <strong className="cart-item">{l.item}</strong>
                  ) : (
                    <input className="cart-name" aria-label="السلعة" value={l.item} onChange={(e) => update(l.key, { item: e.target.value })} />
                  )}
                  <button type="button" className="icon-btn" aria-label={`حيد ${l.item}`} onClick={() => remove(l.key)}>
                    ✕
                  </button>
                </div>
                <div className="cart-row">
                  <div className="qty" role="group" aria-label="الكمية">
                    <button type="button" aria-label="نقص" onClick={() => update(l.key, { qty: Math.max(1, l.qty - 1) })}>
                      −
                    </button>
                    <span dir="ltr">{l.qty}</span>
                    <button type="button" aria-label="زيد" onClick={() => update(l.key, { qty: l.qty + 1 })}>
                      ＋
                    </button>
                  </div>
                  <label className="cart-price">
                    <span className="visually-hidden">الثمن ديال الوحدة</span>
                    <input inputMode="decimal" dir="ltr" placeholder="الثمن" value={l.price} onChange={(e) => update(l.key, { price: e.target.value })} />
                    <span className="muted small">درهم</span>
                  </label>
                  {!l.stockId && (
                    <select aria-label="الفئة" value={l.category} onChange={(e) => update(l.key, { category: e.target.value })}>
                      <option value="">الفئة…</option>
                      {categories.map((x) => (
                        <option key={x.name} value={x.name}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {!l.stockId && (
                    <label className="cart-cost">
                      <span className="muted small">ثمن الشراء</span>
                      <input
                        inputMode="decimal"
                        dir="ltr"
                        placeholder="؟"
                        value={l.unitBuy ?? ""}
                        onChange={(e) => {
                          const v = parseAmount(e.target.value);
                          update(l.key, { unitBuy: e.target.value.trim() && v >= 0 ? v : null });
                        }}
                      />
                    </label>
                  )}
                </div>
                <p className="cart-meta small">
                  {l.inStock !== null && <span className={`stock-badge ${l.inStock - l.qty >= 0 ? "" : "out"}`}>{l.inStock - l.qty >= 0 ? `يبقى: ${l.inStock - l.qty}` : "ما كافيش فالمخزون"}</span>}
                  {l.unitBuy !== null && (
                    <span className="cost-badge">
                      ثمن الشراء: {money(l.unitBuy)}
                      {profit !== null && ` | الربح: ${profit >= 0 ? "+" : ""}${money(profit)}`}
                    </span>
                  )}
                  {discount > 0 && <span className="muted">· تخفيض {money(discount)}</span>}
                  {check === "loss" && <span className="danger-text">· تحت ثمن الشراء!</span>}
                  {check === "low" && <span className="warn-text">· الربح قليل</span>}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <div className="checkout">
        <div className="checkout-sum">
          <span className="muted small">المجموع{listTotal > total ? ` (عوض ${money(listTotal)})` : ""}</span>
          <strong className="checkout-total">{money(total)}</strong>
          <label className="given">
            <span className="muted small">عطاك</span>
            <input inputMode="decimal" dir="ltr" placeholder="—" value={given} onChange={(e) => setGiven(e.target.value)} />
          </label>
        </div>
        {total > 0 && (
          <div className="given-tools">
            <div className="chips given-chips" role="group" aria-label="شحال عطاك">
              {quickCash(total).map((x, i) => (
                <button key={x} type="button" className={`chip ${givenAmount === x ? "on" : ""}`} aria-pressed={givenAmount === x} onClick={() => setGiven(String(x))}>
                  {i === 0 ? "✓ المبلغ كامل" : <bdi dir="ltr">{x}</bdi>}
                </button>
              ))}
            </div>
            {cash.kind === "exact" && <p className="given-result ok-text">✓ خالص</p>}
            {cash.kind === "change" && (
              <p className="given-result ok-text">
                🔁 رد ليه <strong>{money(cash.change)}</strong>
              </p>
            )}
            {cash.kind === "short" && (
              <div className="given-result short">
                <p className="danger-text">
                  ناقص <strong>{money(cash.short)}</strong>
                </p>
                <span className="muted small">خاصو يكمل الخلاص.</span>
              </div>
            )}
          </div>
        )}
        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn primary block" disabled={!lines.length}>
          {`💵 سجل البيع · ${money(total)}`}
        </button>
      </div>
    </form>
    {page && (
      <SaleCategoryPage
        data={data}
        category={page}
        onCategory={setPage}
        inCart={inCart}
        cartCount={lines.reduce((t, l) => t + l.qty, 0)}
        cartTotal={total}
        onAdd={addStock}
        onFree={(c) => {
          addFree("", c);
          setPage("");
        }}
        onClose={() => setPage("")}
      />
    )}
    {scanning && (
      <BarcodeScanner
        title="📷 سكاني السلعة"
        continuous
        onClose={() => setScanning(false)}
        onResult={(code) => {
          // The camera stays open: each code adds its product (again = +1).
          const found = findByCode(ledger.stock, code);
          scanned(code);
          return found ? { ok: true, text: `${found.item} · ${money(found.sellPrice)}` } : { ok: false, text: "ما كايناش فالمخزون" };
        }}
      />
    )}
    </>
  );
}
