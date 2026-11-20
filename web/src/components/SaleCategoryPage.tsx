"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { money } from "@/lib/format";
import type { StockItem } from "@/lib/ledger";
import { categoryProducts, type StockFilter } from "@/lib/sale-browse";
import { categoryIcon } from "@/lib/shop";
import { Modal } from "./Modal";
import type { LedgerState } from "./useLedger";

const FILTERS: { value: StockFilter; label: string }[] = [
  { value: "all", label: "الكل" },
  { value: "in", label: "✅ متوفر" },
  { value: "new", label: "جديد" },
  { value: "used", label: "مستعمل" },
];

/** Cards drawn at a time; more come as the list is scrolled (a shop's category stays light this way). */
const STEP = 48;

/**
 * A category's own page, over the whole screen (no app header): a menu at the
 * top to switch category, a search that stays in it, filters, and the products
 * as a grid. Tapping a product puts it in the sale and the page stays open for
 * the next one; the bar at the bottom shows the cart and goes back to the sale.
 */
export function SaleCategoryPage({
  data,
  category,
  onCategory,
  inCart,
  cartCount,
  cartTotal,
  onAdd,
  onFree,
  onClose,
}: {
  data: LedgerState;
  category: string;
  onCategory: (name: string) => void;
  /** Units of each stock product already in the sale. */
  inCart: Map<string, number>;
  cartCount: number;
  cartTotal: number;
  onAdd: (s: StockItem) => void;
  onFree: (category: string) => void;
  onClose: () => void;
}) {
  const ledger = data.ledger!;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StockFilter>("all");
  const [limit, setLimit] = useState(STEP);
  const [flash, setFlash] = useState("");
  const more = useRef<HTMLLIElement>(null);

  const list = useMemo(() => categoryProducts(ledger.stock, ledger.sales, category, query, filter), [ledger.stock, ledger.sales, category, query, filter]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of ledger.stock) if (s.quantity > 0) m.set(s.category, (m.get(s.category) ?? 0) + 1);
    return m;
  }, [ledger.stock]);

  // A new category, search or filter starts from the top.
  useEffect(() => setLimit(STEP), [category, query, filter]);

  // Draw the next cards when the end of the grid comes into view.
  useEffect(() => {
    const el = more.current;
    if (!el || limit >= list.length) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setLimit((x) => x + STEP);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [limit, list.length]);

  function add(s: StockItem) {
    onAdd(s);
    setFlash(s.id);
    setTimeout(() => setFlash((x) => (x === s.id ? "" : x)), 600);
  }

  const emoji = (name: string) => {
    const icon = ledger.categories.find((c) => c.name === name)?.icon ?? "";
    return icon && !icon.startsWith("data:") ? icon : categoryIcon(name);
  };

  return (
    <Modal
      title={category}
      className="page cat-page"
      onClose={onClose}
      head={
        <div className="cat-switch-wrap">
          <label className="visually-hidden" htmlFor="cat-switch">
            الصنف
          </label>
          <select id="cat-switch" className="cat-switch" value={category} onChange={(e) => onCategory(e.target.value)}>
            {ledger.categories.map((c) => (
              <option key={c.name} value={c.name}>
                {emoji(c.name)} {c.name} ({counts.get(c.name) ?? 0})
              </option>
            ))}
          </select>
        </div>
      }
      footer={
        <button type="button" className="btn primary cat-page-done" onClick={onClose}>
          {cartCount ? (
            <>
              🛒 <bdi dir="ltr">{cartCount}</bdi> · {money(cartTotal)} · رجع للبيع ←
            </>
          ) : (
            "رجع للبيع ←"
          )}
        </button>
      }
    >
      <div className="cat-page-tools">
        <label className="visually-hidden" htmlFor="cat-search">
          قلب فـ {category}
        </label>
        <input id="cat-search" type="search" className="search" placeholder={`🔍 قلب فـ ${category}…`} value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
        <div className="chips" role="group" aria-label="فلتر">
          {FILTERS.map((f) => (
            <button key={f.value} type="button" className={`chip ${filter === f.value ? "on" : ""}`} aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
              {f.label}
            </button>
          ))}
          <span className="muted small cat-page-count">
            <bdi dir="ltr">{list.length}</bdi> سلعة
          </span>
        </div>
      </div>

      <ul className="cat-grid" aria-label={`السلع ديال ${category}`}>
        {list.slice(0, limit).map((s) => {
          const n = inCart.get(s.id) ?? 0;
          return (
            <li key={s.id}>
              <button type="button" className={`cat-card ${s.quantity > 0 ? "" : "out"} ${flash === s.id ? "flash" : ""}`} onClick={() => add(s)} aria-label={`زيد ${s.item}`}>
                {n > 0 && (
                  <span className="cat-card-cart" aria-label={`فالبيع: ${n}`}>
                    🛒 <bdi dir="ltr">{n}</bdi>
                  </span>
                )}
                <strong className="cat-card-name">{s.item}</strong>
                {(s.condition === "مستعمل" || s.serial) && (
                  <span className="muted small cat-card-sub">
                    {s.condition === "مستعمل" ? "مستعمل" : ""}
                    {s.condition === "مستعمل" && s.serial ? " · " : ""}
                    {s.serial && <bdi dir="ltr">{s.serial}</bdi>}
                  </span>
                )}
                <span className="cat-card-price">{money(s.sellPrice)}</span>
                <span className={`stock-badge ${s.quantity > 0 ? "" : "out"}`}>{s.quantity > 0 ? `متوفر: ${s.quantity}` : "ما بقاش"}</span>
              </button>
            </li>
          );
        })}
        {limit < list.length && (
          <li ref={more} className="cat-more muted small">
            كنجيبو الباقي…
          </li>
        )}
        <li>
          <button type="button" className="cat-card free" onClick={() => onFree(category)}>
            <strong>＋ حاجة أخرى</strong>
            <span className="muted small">بلا مخزون، كتكتب السمية والثمن</span>
          </button>
        </li>
      </ul>
      {list.length === 0 && <p className="empty small">{query.trim() ? `ما لقينا «${query.trim()}» فـ ${category}.` : "ما كاين حتى سلعة هنا."}</p>}
    </Modal>
  );
}
