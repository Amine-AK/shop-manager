"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client";
import { dueText, money, STATUS_LABEL } from "@/lib/format";
import { monthsToFinish, sortPayments, type ClientSummary, type Payment, type Purchase } from "@/lib/ledger";
import { displayDate, displayDateTime, installmentText } from "@/lib/receipt";
import { ClientInfoForm, InstallmentForm } from "./ClientForms";
import { Modal } from "./Modal";
import { PaymentForm, PurchaseForm } from "./MoneyForms";
import { SaleForm } from "./SaleForm";
import { ReceiptDialog } from "./ReceiptDialog";
import type { LedgerState } from "./useLedger";
import { can } from "@/lib/roles";
import { Confirm } from "./ui";
import { ClaimBadge, ClaimForm, ClaimPanel, useNow } from "./ClaimsView";
import { RepairForm, RepairPanel } from "./RepairsView";
import { customerFollowUps } from "@/lib/sale-browse";
import { isOpen as claimOpen, sinceText } from "@/lib/claims";
import { repairRemaining, STATUS_INFO as REPAIR_STATUS } from "@/lib/repairs";
import { isLate, openClaimFor } from "@/lib/claims";
import { waitingByClient } from "@/lib/approvals";
import { ApprovalsDialog, recentOwnerNotes, recentRefusals } from "./ApprovalsView";
import { describe as describeRequest } from "@/lib/approvals";

type Sub =
  | { kind: "info" }
  | { kind: "installment"; reason?: string }
  | { kind: "purchase"; purchase?: Purchase }
  | { kind: "sale" }
  | { kind: "payment"; payment?: Payment }
  | { kind: "receipt"; mode: "payment" | "statement"; paymentId?: string; notice?: string }
  | { kind: "delete-purchase"; purchase: Purchase }
  | { kind: "delete-payment"; payment: Payment }
  | { kind: "delete-client" }
  | { kind: "archive" }
  | { kind: "claim" }
  | { kind: "claim-open"; id: string }
  | { kind: "repair-new" }
  | { kind: "repair-open"; id: string; justAdded?: boolean }
  | { kind: "approvals" }
  | null;

export function ClientDetail({ data, clientId, onClose, onToast }: { data: LedgerState; clientId: string; onClose: () => void; onToast: (t: string) => void }) {
  const [sub, setSub] = useState<Sub>(null);
  const allow = (p: Parameters<typeof can>[1]) => can(data.me, p);
  const [busy, setBusy] = useState(false);
  const now = useNow();
  const s = data.summaries.find((x) => x.client.id === clientId);
  if (!s) {
    return (
      <Modal title="الزبون" onClose={onClose}>
        <p className="empty">هاد الزبون ما بقاش فاللائحة.</p>
      </Modal>
    );
  }
  const c = s.client;
  // Sellers' changes on this customer still waiting for the owner (shown ⏳, not in the sheet yet).
  const owner = data.me?.role === "owner";
  const waiting = data.ledger ? (waitingByClient(data.ledger).get(c.id) ?? []) : [];
  const refused = data.ledger ? recentRefusals(data.ledger.approvals).filter((a) => describeRequest(a.op, data.ledger!).clientId === c.id) : [];
  // Their after-sales requests and repairs, followed from here (no need to go to الإصلاح).
  const follow = data.ledger ? customerFollowUps(c, data.ledger) : { claims: [], repairs: [] };
  const seesClaims = allow("claims");
  const seesRepairs = allow("repairs");
  const followCount = (seesClaims ? follow.claims.length : 0) + (seesRepairs ? follow.repairs.length : 0);
  const ownerNotes = data.ledger ? recentOwnerNotes(data.ledger.approvals).filter((a) => describeRequest(a.op, data.ledger!).clientId === c.id) : [];
  const newWaiting = waiting.some((a) => a.op.type === "client.add");
  // The owner decides first: an edit of a record a seller changed would be refused by the sheet.
  const editable = (id: string) => !(owner && data.pendingIds.has(id));
  const ownerLocked = owner && (newWaiting || data.pendingIds.has(c.id));
  const months = monthsToFinish(s.remaining, c.installment, c.period);
  const payments = sortPayments(s.payments).reverse();
  const savedNote = data.online ? "" : " · محفوظ فالتيليفون";

  async function archiveNow() {
    setBusy(true);
    try {
      const { archived } = await apiFetch<{ archived: number }>("/api/archive", { method: "POST", body: { ids: [c.id] } });
      await data.refresh();
      onToast(archived ? `تأرشف ${c.name}` : "ما تأرشفش");
      onClose();
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <>
      <Modal title={c.name} onClose={onClose} busy={busy}>
        <div className="detail-head">
          <span className={`pill ${s.status}`}>{STATUS_LABEL[s.status]}</span>
          {c.type === 1 && <span className="pill special">⭐ زبون خاص</span>}
          <span className="muted small" dir="ltr">
            {c.id}
          </span>
          {c.phone && (
            <>
              <a className="phone" href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} dir="ltr">
                {c.phone}
              </a>
              <a className="call-mini" href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} aria-label={`اتصل بـ ${c.name}`} title="اتصل">
                📞 اتصل
              </a>
            </>
          )}
          {(c.phones ?? []).length > 0 && <MorePhones name={c.name} phones={c.phones!} />}
          {allow("client_delete") && !ownerLocked && (
          <button type="button" className="delete-mini" onClick={() => setSub({ kind: "delete-client" })} disabled={busy} aria-label={`حذف ${c.name}`} title="حذف الزبون">
            🗑️ حذف
          </button>
          )}
        </div>
        {c.notes && <p className="muted">{c.notes}</p>}
        {waiting.length > 0 && (
          <div className="alert warn pending-note">
            <p>
              ⏳ <strong>{waiting.length}</strong> تعديل ديال البائع كيتسنى {owner ? "الموافقة ديالك" : "موافقة المالك"}
              {newWaiting && " (زبون جديد)"}. ما تسجلو فالـ Google Sheet باقي؛ الأرقام هنا محسوبين بيهم.
              {ownerLocked && " وافق ولا رفض قبل ما تبدل فهاد الزبون."}
            </p>
            {waiting.filter((a) => a.note).map((a) => (
              <p key={a.id} className="approval-note">
                📝 {a.op.by || "البائع"}: {a.note}
              </p>
            ))}
            <button type="button" className="btn small-btn" onClick={() => setSub({ kind: "approvals" })}>
              {owner ? "شوف ووافق" : "شوف ولا زيد ملاحظة للمالك"}
            </button>
          </div>
        )}
        {ownerNotes.length > 0 && !owner && (
          <div className="alert info pending-note">
            {ownerNotes.map((a) => (
              <p key={a.id}>
                ✓ تقبل: {describeRequest(a.op, data.ledger!).text} · 📝 {a.decidedBy || "المالك"}: {a.reason}
              </p>
            ))}
          </div>
        )}
        {refused.length > 0 && !owner && (
          <div className="alert error pending-note">
            {refused.map((a) => (
              <p key={a.id}>
                ❌ ترفض: {describeRequest(a.op, data.ledger!).text}
                {a.reason && ` · السبب: ${a.reason}`}
              </p>
            ))}
          </div>
        )}

        <dl className="facts three">
          <div>
            <dt>المشتريات</dt>
            <dd>{money(s.total)}</dd>
          </div>
          <div>
            <dt>المدفوع</dt>
            <dd>{money(s.paid)}</dd>
          </div>
          <div>
            <dt>المتبقي</dt>
            <dd className={s.remaining > 0 ? "danger-text" : "ok-text"}>{s.remaining > 0 ? money(s.remaining) : "خالص ✓"}</dd>
          </div>
        </dl>

        {s.remaining > 0 && (
          <div className="installment-box">
            <div>
              <p>
                الطريطة: <strong>{installmentText(s) || "ما محددة"}</strong>
                {months ? <span className="muted"> · يخلص فـ {months} شهر تقريبا</span> : null}
              </p>
              <p className="muted small">
                الدفعة المقبلة: {c.nextDueDate ? `${displayDate(c.nextDueDate)} · ${dueText(c.nextDueDate, s.status, data.today)}` : "—"}
              </p>
            </div>
            {allow("client_edit") && !ownerLocked && (
            <button type="button" className="btn small-btn" onClick={() => setSub({ kind: "installment" })}>
              بدل الطريطة
            </button>
            )}
          </div>
        )}

        <div className="detail-actions">
          {allow("payment") && (
          <button type="button" className="btn primary" onClick={() => setSub({ kind: "payment" })} disabled={!s.purchases.length || (owner && newWaiting)}>
            دفعة
          </button>
          )}
          {allow("sell_credit") && (
          <button type="button" className="btn" onClick={() => setSub({ kind: "sale" })} disabled={owner && newWaiting}>
            شراء جديد
          </button>
          )}
          <button type="button" className="btn" onClick={() => setSub({ kind: "receipt", mode: "statement" })}>
            كشف الحساب
          </button>
          {allow("client_edit") && !ownerLocked && (
          <button type="button" className="btn" onClick={() => setSub({ kind: "info" })}>
            تعديل المعلومات
          </button>
          )}

        </div>

        <section className="detail-section" aria-label="المشتريات">
          <h3>المشتريات ({s.purchases.length})</h3>
          {s.items.length === 0 && <p className="muted small">ما شرا والو باقي.</p>}
          <ul className="rows">
            {s.items.map((it) => (
              <li key={it.purchase.id}>
                <div className="row-main">
                  <strong>{it.purchase.item}</strong>
                  <span className="muted small">
                    {displayDate(it.purchase.date)} · {money(it.purchase.price)}
                  </span>
                  {data.pendingIds.has(it.purchase.id) && <span className="pending-flag">⏳ كتسنى موافقة المالك</span>}
                  {(() => {
                    // A request is open at the brand's service for this product.
                    const claim = openClaimFor(data.ledger?.claims ?? [], it.purchase.id);
                    if (!claim) return null;
                    const late = isLate(claim, now);
                    return <span className={`claim-flag ${late ? "late" : ""}`}>{late ? "⏰" : "🏭"} عند {claim.company}{late ? " · معطل" : ""}</span>;
                  })()}
                </div>
                <span className={`row-amount ${it.remaining > 0 ? "" : "ok-text"}`}>{it.remaining > 0 ? `باقي ${money(it.remaining)}` : "خالصة ✓"}</span>
                <div className="row-actions">
                  {allow("client_edit") && editable(it.purchase.id) && (
                  <button type="button" className="link-btn" onClick={() => setSub({ kind: "purchase", purchase: it.purchase })}>
                    تعديل
                  </button>
                  )}
                  {allow("client_edit") && editable(it.purchase.id) && (
                  <button type="button" className="link-btn danger-text" onClick={() => setSub({ kind: "delete-purchase", purchase: it.purchase })}>
                    حذف
                  </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="detail-section" aria-label="الدفعات">
          <h3>الدفعات ({payments.length})</h3>
          {payments.length === 0 && <p className="muted small">ما كاين حتى دفعة.</p>}
          <ul className="rows">
            {payments.map((p) => (
              <li key={p.id}>
                <div className="row-main">
                  <strong>{money(p.amount)}</strong>
                  <span className="muted small">
                    {displayDateTime(p.date, p.time)}
                    {p.kind === "تسبيق" ? " · تسبيق" : ""}
                    {p.purchaseId ? ` · ${s.purchases.find((x) => x.id === p.purchaseId)?.item ?? ""}` : ""}
                  </span>
                  {data.pendingIds.has(p.id) && <span className="pending-flag">⏳ كتسنى موافقة المالك</span>}
                </div>
                <div className="row-actions">
                  <button type="button" className="link-btn" onClick={() => setSub({ kind: "receipt", mode: "payment", paymentId: p.id })}>
                    وصل
                  </button>
                  {allow("client_edit") && editable(p.id) && (
                  <button type="button" className="link-btn" onClick={() => setSub({ kind: "payment", payment: p })}>
                    تعديل / نقل
                  </button>
                  )}
                  {allow("client_edit") && editable(p.id) && (
                  <button type="button" className="link-btn danger-text" onClick={() => setSub({ kind: "delete-payment", payment: p })}>
                    حذف
                  </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

        {(seesClaims || seesRepairs) && (
          <section className="detail-section follow-section" aria-label="الإصلاح وخدمة الشركة">
            <div className="follow-head">
              <h3>🔧 الإصلاح وخدمة الشركة{followCount ? ` (${followCount})` : ""}</h3>
              <div className="follow-actions">
                {seesClaims && (
                  <button type="button" className="btn small-btn" onClick={() => setSub({ kind: "claim" })} title="سلعة فيها عطب: صيفط طلب لخدمة الصيانة ديال الشركة">
                    🏭 ريكلاماسيون
                  </button>
                )}
                {seesRepairs && (
                  <button type="button" className="btn small-btn" onClick={() => setSub({ kind: "repair-new" })}>
                    🔧 إصلاح جديد
                  </button>
                )}
              </div>
            </div>
            {followCount === 0 && <p className="muted small">ما عندو حتى إصلاح ولا طلب عند الشركة.</p>}
            <ul className="rows follow-rows">
              {seesClaims &&
                follow.claims.map((x) => (
                  <li key={x.id}>
                    <button type="button" className="follow-open" onClick={() => setSub({ kind: "claim-open", id: x.id })}>
                      <span className="row-main">
                        <strong>🏭 {x.item}</strong>
                        <span className="muted small">
                          {x.company} · {claimOpen(x) ? `هادي ${sinceText(x.createdAt, now)}` : <bdi dir="ltr">{displayDate(x.resolvedDate)}</bdi>}
                          {x.reminders > 0 && ` · 🔔 ${x.reminders}`}
                        </span>
                      </span>
                      <ClaimBadge claim={x} now={now} />
                    </button>
                  </li>
                ))}
              {seesRepairs &&
                follow.repairs.map((r) => (
                  <li key={r.id}>
                    <button type="button" className="follow-open" onClick={() => setSub({ kind: "repair-open", id: r.id })}>
                      <span className="row-main">
                        <strong>🔧 {r.device}</strong>
                        <span className="muted small">
                          <bdi dir="ltr">{displayDate(r.date)}</bdi>
                          {r.price > 0 && ` · ${repairRemaining(r) > 0 ? `باقي ${money(repairRemaining(r))}` : "خالص"}`}
                        </span>
                      </span>
                      <span className={`repair-status tone-${REPAIR_STATUS[r.status].tone}`}>
                        {REPAIR_STATUS[r.status].icon} {r.status}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        )}

        {data.ledger && data.ledger.changes.some((x) => x.clientId === c.id) && (
          <section className="detail-section" aria-label="تغييرات الطريطة">
            <h3>تغييرات الطريطة</h3>
            <ul className="rows">
              {data.ledger.changes
                .filter((x) => x.clientId === c.id)
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .map((x) => (
                  <li key={x.id}>
                    <div className="row-main">
                      <span>
                        {money(x.oldAmount)} ← <strong>{money(x.newAmount)}</strong> {x.newPeriod && `(${x.newPeriod})`}
                      </span>
                      <span className="muted small">
                        {displayDate(x.date)} · {x.reason}
                      </span>
                    </div>
                  </li>
                ))}
            </ul>
          </section>
        )}

        <div className="detail-footer">
          {s.remaining <= 0 && s.purchases.length > 0 && allow("client_delete") && (
            <button type="button" className="btn" disabled={!data.online || data.pendingCount > 0 || busy} onClick={() => setSub({ kind: "archive" })}>
              أرشفة
            </button>
          )}
        </div>
      </Modal>

      {sub?.kind === "info" && <ClientInfoForm data={data} summary={s} onClose={() => setSub(null)} />}
      {sub?.kind === "installment" && <InstallmentForm data={data} summary={s} reason={sub.reason} onClose={() => setSub(null)} />}
      {sub?.kind === "purchase" && (
        <PurchaseForm
          data={data}
          summary={s}
          purchase={sub.purchase}
          onClose={() => setSub((x) => (x?.kind === "purchase" ? null : x))}
          onDone={(paymentId) => {
            onToast(`تزاد الشراء${savedNote}`);
            if (paymentId) setSub({ kind: "receipt", mode: "payment", paymentId, notice: "تسجل التسبيق" });
          }}
        />
      )}
      {sub?.kind === "sale" && (
        <Modal title={`شراء جديد: ${s.client.name}`} onClose={() => setSub(null)}>
          <SaleForm
            data={data}
            lockedClientId={s.client.id}
            onDone={(done) => {
              onToast(`تزاد الشراء${savedNote}`);
              setSub(done.paymentId ? { kind: "receipt", mode: "payment", paymentId: done.paymentId, notice: "تسجل التسبيق" } : null);
            }}
          />
        </Modal>
      )}
      {sub?.kind === "payment" && (
        <PaymentForm
          data={data}
          summary={s}
          payment={sub.payment}
          onClose={() => setSub(null)}
          onDone={(paymentId) => setSub({ kind: "receipt", mode: "payment", paymentId, notice: `تسجلات الدفعة${savedNote}` })}
        />
      )}
      {sub?.kind === "receipt" && <ReceiptDialog summary={s} mode={sub.mode} paymentId={sub.paymentId} notice={sub.notice} onClose={() => setSub(null)} />}
      {sub?.kind === "delete-purchase" && (
        <Confirm
          title="حذف السلعة"
          confirmLabel="إيه، احذف"
          danger
          onClose={() => setSub(null)}
          onConfirm={() => {
            data.run(`حذف سلعة · ${c.name}`, { type: "purchase.delete", id: sub.purchase.id });
            setSub(null);
          }}
        >
          <p className="lead">
            واش متأكد بغيتي تحذف <strong>{sub.purchase.item}</strong> ({money(sub.purchase.price)}) من حساب {c.name}؟
          </p>
          <p className="muted small">الدفعات ديالها كتبقى فالحساب كدفعات عامة.</p>
        </Confirm>
      )}
      {sub?.kind === "delete-payment" && (
        <Confirm
          title="حذف الدفعة"
          confirmLabel="إيه، احذف"
          danger
          onClose={() => setSub(null)}
          onConfirm={() => {
            data.run(`حذف دفعة · ${c.name}`, { type: "payment.delete", id: sub.payment.id });
            setSub(null);
          }}
        >
          <p className="lead">
            واش متأكد بغيتي تحذف الدفعة ديال <strong>{money(sub.payment.amount)}</strong> ({displayDateTime(sub.payment.date, sub.payment.time)})؟
          </p>
          <p className="muted small">إلا تسجلات على زبون آخر بالغلط، استعمل «تعديل / نقل» باش تنقلها بلا ما تحذفها.</p>
        </Confirm>
      )}
      {sub?.kind === "delete-client" && (
        <DeleteClient
          summary={s}
          onClose={() => setSub(null)}
          onArchive={s.remaining <= 0 && s.purchases.length > 0 && data.online && data.pendingCount === 0 ? () => setSub({ kind: "archive" }) : undefined}
          onConfirm={() => {
            const withHistory = s.purchases.length > 0 || s.payments.length > 0;
            data.run(`حذف · ${c.name}`, { type: "client.delete", id: c.id, ...(withHistory ? { withHistory: true } : {}) });
            onToast(`تحذف ${c.name}`);
            onClose();
          }}
        />
      )}
      {sub?.kind === "approvals" && <ApprovalsDialog data={data} clientId={c.id} onClose={() => setSub(null)} onToast={onToast} />}
      {sub?.kind === "claim-open" && <ClaimPanel data={data} claimId={sub.id} onClose={() => setSub(null)} onToast={onToast} />}
      {sub?.kind === "repair-open" && <RepairPanel data={data} repairId={sub.id} justAdded={sub.justAdded} onClose={() => setSub(null)} onToast={onToast} />}
      {sub?.kind === "repair-new" && (
        <RepairForm
          data={data}
          initial={{ owner: c.name, phone: c.phone }}
          onClose={() => setSub(null)}
          onSaved={(id) => {
            onToast("تسجل الجهاز");
            setSub({ kind: "repair-open", id, justAdded: true });
          }}
        />
      )}
      {sub?.kind === "claim" && (
        <ClaimForm
          data={data}
          clientId={c.id}
          onClose={() => setSub(null)}
          onSaved={() => {
            onToast("تسجل الطلب. تبعو فـ الإصلاح ← خدمة الشركة");
            setSub(null);
          }}
        />
      )}
      {sub?.kind === "archive" && (
        <Confirm
          title="أرشفة الزبون"
          confirmLabel="أرشف"
          onClose={() => setSub(null)}
          onConfirm={() => {
            setSub(null);
            void archiveNow();
          }}
        >
          <p className="lead">
            <strong>{c.name}</strong> خالص. غادي يتنقل للأرشيف مع المشتريات والدفعات ديالو.
          </p>
          <p className="muted small">تقدر تلقاه من بعد فـ «الأرشيف» وترجعو للائحة.</p>
        </Confirm>
      )}
    </>
  );
}

/** Delete a customer. With purchases or payments, says exactly what goes and asks to tick a box first. */
function DeleteClient({ summary: s, onClose, onConfirm, onArchive }: { summary: ClientSummary; onClose: () => void; onConfirm: () => void; onArchive?: () => void }) {
  const [sure, setSure] = useState(false);
  const history = s.purchases.length > 0 || s.payments.length > 0;
  return (
    <Modal
      title="حذف الزبون"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            رجوع
          </button>
          <button type="button" className="btn danger" onClick={onConfirm} disabled={history && !sure}>
            🗑️ احذف نهائيا
          </button>
        </>
      }
    >
      <p className="lead">
        واش متأكد بغيتي تحذف <strong>{s.client.name}</strong>؟
      </p>
      {history ? (
        <>
          <div className="alert error">
            <span>
              غادي يتمسح كلشي ديالو من الـ Google Sheet: <strong>{s.purchases.length}</strong> شراء (<strong>{money(s.total)}</strong>) و{" "}
              <strong>{s.payments.length}</strong> دفعة (<strong>{money(s.paid)}</strong>)
              {s.remaining > 0 && (
                <>
                  ، والكريدي ديالو (<strong>{money(s.remaining)}</strong>) غادي يضيع
                </>
              )}
              . المبيعات ديالو كيتحيدو من التقارير، والسلع كترجع للمخزون. ما يمكنش ترجعو.
            </span>
          </div>
          {onArchive && (
            <p className="small">
              خلص كلشي؟ الأحسن{" "}
              <button type="button" className="link-btn" onClick={onArchive}>
                أرشفه
              </button>{" "}
              عوض ما تحذفو: كيبقى فالأرشيف وتقدر ترجعو.
            </p>
          )}
          <label className="check">
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
            فهمت، احذف {s.client.name} وكلشي ديالو
          </label>
        </>
      ) : (
        <p className="muted small">ما عندو حتى شراء ولا دفعة.</p>
      )}
    </Modal>
  );
}

/** The customer's other numbers, folded behind «+N ▾»; tapping outside closes the list. */
function MorePhones({ name, phones }: { name: string; phones: string[] }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  return (
    <details className="more-phones" ref={ref}>
      <summary aria-label={`أرقام أخرى ديال ${name}`}>
        <bdi dir="ltr">+{phones.length}</bdi> <span aria-hidden="true">▾</span>
      </summary>
      <ul>
        {phones.map((p, i) => (
          <li key={i}>
            <a href={`tel:${p.replace(/[^\d+]/g, "")}`} aria-label={`اتصل بـ ${name} فـ ${p}`}>
              <span dir="ltr">{p}</span>
              <span aria-hidden="true">📞</span>
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
