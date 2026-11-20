"use client";

import { useState } from "react";
import { approvalChain } from "@/lib/approval-deps";
import { describe, waitingOf } from "@/lib/approvals";
import { nowParts, type Approval, type ApprovalStatus } from "@/lib/ledger";
import { displayDateTime } from "@/lib/receipt";
import { Modal } from "./Modal";
import type { LedgerState } from "./useLedger";

const TABS: { value: ApprovalStatus; label: string }[] = [
  { value: "كتسنى", label: "⏳ كتسنى" },
  { value: "ترفض", label: "❌ ترفضو" },
  { value: "تقبل", label: "✓ تقبلو" },
];

/** Refusals a seller should still see (the last 7 days). */
const RECENT_MS = 7 * 24 * 3600_000;
export const recentRefusals = (approvals: Approval[], now = Date.now()) =>
  approvals.filter((a) => a.status === "ترفض" && now - Date.parse(a.decidedAt) < RECENT_MS);
/** Changes the owner accepted with a note, in the last 7 days. */
export const recentOwnerNotes = (approvals: Approval[], now = Date.now()) =>
  approvals.filter((a) => a.status === "تقبل" && a.reason && now - Date.parse(a.decidedAt) < RECENT_MS);

/** What the note window is for. */
type Writing = { kind: "refuse" | "accept" | "note"; items: Approval[]; label: string };

const when = (iso: string) => {
  if (Number.isNaN(Date.parse(iso))) return "";
  const p = nowParts(new Date(iso));
  return displayDateTime(p.date, p.time);
};

/**
 * In الكريدي: what the sellers changed and waits for the owner. The owner accepts
 * (the change goes into the sheet) or refuses with a reason; a seller only sees
 * where their changes are. `clientId`: only this customer's.
 */
export function ApprovalsDialog({ data, clientId, onClose, onToast }: { data: LedgerState; clientId?: string; onClose: () => void; onToast: (msg: string) => void }) {
  const ledger = data.ledger!;
  const owner = data.me?.role === "owner";
  const [tab, setTab] = useState<ApprovalStatus>("كتسنى");
  const [writing, setWriting] = useState<Writing | null>(null);
  const [reason, setReason] = useState("");
  const myName = data.me?.name ?? "";

  const info = (a: Approval) => describe(a.op, ledger);
  const list = ledger.approvals
    .filter((a) => a.status === tab && (!clientId || info(a).clientId === clientId))
    .sort((a, b) => (tab === "كتسنى" ? a.createdAt.localeCompare(b.createdAt) : b.decidedAt.localeCompare(a.decidedAt)))
    .slice(0, tab === "كتسنى" ? undefined : 100);
  const groups = new Map<string, Approval[]>();
  for (const a of list) groups.set(info(a).clientId, [...(groups.get(info(a).clientId) ?? []), a]);
  const counts = Object.fromEntries(TABS.map((t) => [t.value, ledger.approvals.filter((a) => a.status === t.value && (!clientId || info(a).clientId === clientId)).length]));

  /** Accept these (oldest first); one already taken with an earlier one's needs is not sent twice. */
  function accept(items: Approval[], note = "") {
    const waiting = waitingOf(ledger);
    const taken = new Set<string>();
    let n = 0;
    for (const a of [...items].sort((x, y) => x.createdAt.localeCompare(y.createdAt))) {
      if (taken.has(a.id)) continue;
      for (const x of approvalChain(waiting, a)) taken.add(x.id);
      data.run(`✓ موافقة · ${info(a).client} · ${info(a).text}`, { type: "approval.decide", id: a.id, decision: "accept", reason: note });
      n++;
    }
    if (n) onToast(taken.size > 1 ? `✓ تقبلو ${taken.size} تعديلات` : "✓ تقبل");
  }

  function open(w: Writing) {
    setReason(w.kind === "note" ? w.items[0].note : "");
    setWriting(w);
  }

  function save() {
    if (!writing) return;
    const text = reason.trim();
    if (writing.kind === "refuse") {
      for (const a of writing.items) data.run(`❌ رفض · ${writing.label}`, { type: "approval.decide", id: a.id, decision: "refuse", reason: text });
      onToast("❌ ترفض");
    } else if (writing.kind === "accept") {
      accept(writing.items, text);
    } else {
      data.run(`📝 ملاحظة للمالك · ${writing.label}`, { type: "approval.note", id: writing.items[0].id, note: text });
      onToast(text ? "📝 تسجلات الملاحظة" : "تحيدات الملاحظة");
    }
    setWriting(null);
    setReason("");
  }

  return (
    <Modal title={owner ? "⏳ تعديلات البائعين: الموافقة" : "⏳ التعديلات ديالي عند المالك"} onClose={onClose}>
      <p className="muted small">
        {owner
          ? "هادو تعديلات الكريدي لي دارو البائعين. ما كيدخلو للـ Google Sheet حتى توافق. الزبون كيشوف المبلغ منقوص فالوصل، والفلوس كتحسب فالصندوق."
          : "تعديلات الكريدي ديالك كيتسناو موافقة المالك قبل ما يتسجلو فالـ Google Sheet."}
      </p>
      <div className="chips" role="group" aria-label="الحالة">
        {TABS.map((t) => (
          <button key={t.value} type="button" className={`chip ${tab === t.value ? "on" : ""}`} aria-pressed={tab === t.value} onClick={() => setTab(t.value)}>
            {t.label} <bdi dir="ltr">({counts[t.value]})</bdi>
          </button>
        ))}
      </div>
      {list.length === 0 && <p className="empty">{tab === "كتسنى" ? "ما كاين حتى تعديل كيتسنى ✓" : "ما كاين والو هنا."}</p>}
      {[...groups.entries()].map(([cid, items]) => (
        <section key={cid || "none"} className="approval-group" aria-label={info(items[0]).client || "زبون"}>
          <div className="approval-head">
            <h3>👤 {info(items[0]).client || "زبون"}</h3>
            {owner && tab === "كتسنى" && items.length > 1 && (
              <button type="button" className="btn primary small-btn" onClick={() => accept(items)} disabled={items.some((a) => data.brokenApprovals.has(a.id))}>
                ✓ قبل الكل ({items.length})
              </button>
            )}
          </div>
          <ul className="approval-list">
            {items.map((a) => {
              const i = info(a);
              const broken = data.brokenApprovals.get(a.id);
              return (
                <li key={a.id} className={`approval-item status-${a.status === "كتسنى" ? "wait" : a.status === "تقبل" ? "ok" : "no"}`}>
                  <div className="approval-main">
                    <strong>
                      {i.icon} {i.text}
                    </strong>
                    <span className="muted small">
                      {a.op.by || "—"} · <bdi dir="ltr">{when(a.createdAt)}</bdi>
                      {a.op.device && ` · ${a.op.device}`}
                    </span>
                    {a.status !== "كتسنى" && (
                      <span className="muted small">
                        {a.status === "تقبل" ? "✓ قبلو" : "❌ رفضو"} {a.decidedBy} · <bdi dir="ltr">{when(a.decidedAt)}</bdi>
                      </span>
                    )}
                    {a.note && <span className="approval-note">📝 {a.op.by || "البائع"}: {a.note}</span>}
                    {a.reason &&
                      (a.status === "ترفض" ? (
                        <span className="danger-text small">السبب: {a.reason}</span>
                      ) : (
                        <span className="approval-note owner">📝 {a.decidedBy || "المالك"}: {a.reason}</span>
                      ))}
                    {broken && <span className="warn-text small">⚠️ ما بقاش كيتطبق: {broken}</span>}
                  </div>
                  {owner && a.status === "كتسنى" && (
                    <div className="approval-actions">
                      <button type="button" className="btn primary small-btn" onClick={() => accept([a])} disabled={Boolean(broken)}>
                        ✓ قبول
                      </button>
                      <button type="button" className="btn danger-ghost small-btn" onClick={() => open({ kind: "refuse", items: [a], label: `${i.client} · ${i.text}` })}>
                        ✕ رفض
                      </button>
                      <button type="button" className="link-btn" onClick={() => open({ kind: "accept", items: [a], label: `${i.client} · ${i.text}` })} disabled={Boolean(broken)}>
                        📝 قبول بملاحظة
                      </button>
                    </div>
                  )}
                  {!owner && a.status === "كتسنى" && a.op.by === myName && (
                    <button type="button" className="link-btn approval-note-btn" onClick={() => open({ kind: "note", items: [a], label: `${i.client} · ${i.text}` })}>
                      {a.note ? "✏️ بدل الملاحظة" : "📝 زيد ملاحظة للمالك"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {writing && (
        <Modal
          title={writing.kind === "refuse" ? "❌ رفض التعديل" : writing.kind === "accept" ? "✓ قبول بملاحظة" : "📝 ملاحظة للمالك"}
          onClose={() => setWriting(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setWriting(null)}>
                رجوع
              </button>
              <button type="button" className={`btn ${writing.kind === "refuse" ? "danger" : "primary"}`} onClick={save}>
                {writing.kind === "refuse" ? "رفض" : writing.kind === "accept" ? "✓ قبول" : "حفظ"}
              </button>
            </>
          }
        >
          <p className="lead">{writing.label}</p>
          {writing.kind === "refuse" && <p className="muted small">التعديلات لي مبنية على هادا (مثلا دفعة ديال زبون جديد) كيترفضو معاه.</p>}
          <div className="field">
            <label htmlFor="approval-note">
              {writing.kind === "refuse" ? "السبب (كيشوفو البائع)" : writing.kind === "accept" ? "الملاحظة (كيشوفها البائع)" : "الملاحظة (كيشوفها المالك قبل ما يوافق)"}
            </label>
            <textarea
              id="approval-note"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              autoFocus
              placeholder={
                writing.kind === "refuse"
                  ? "مثلا: المبلغ غلط، الزبون ما خلصش…"
                  : writing.kind === "accept"
                    ? "مثلا: مزيان، عيط عليه السبت…"
                    : "مثلا: خلص نص اليوم والباقي السبت…"
              }
            />
          </div>
        </Modal>
      )}
    </Modal>
  );
}

/** The bar in الكريدي: what waits for the owner (owner), or for the seller where their changes are. */
export function ApprovalsBar({ data, onOpen }: { data: LedgerState; onOpen: () => void }) {
  const ledger = data.ledger;
  if (!ledger || !data.me || data.me.role === "stock") return null;
  const waiting = waitingOf(ledger);
  const owner = data.me.role === "owner";
  const refused = owner ? [] : recentRefusals(ledger.approvals).filter((a) => a.op.by === data.me!.name);
  const notes = owner ? [] : recentOwnerNotes(ledger.approvals).filter((a) => a.op.by === data.me!.name);
  // The owner sees how many waiting changes came with a note from the seller.
  const noted = waiting.filter((a) => a.note).length;
  if (!waiting.length && !refused.length && !notes.length) return null;
  const clients = new Set(waiting.map((a) => describe(a.op, ledger).clientId)).size;
  return (
    <button type="button" className={`approvals-bar ${owner && waiting.length ? "attention" : ""}`} onClick={onOpen}>
      <span>
        {waiting.length > 0 &&
          (owner ? (
            <>
              ⏳ <strong>{clients}</strong> زبون عندهم <strong>{waiting.length}</strong> تعديل كيتسنى الموافقة ديالك
              {noted > 0 && <> · 📝 {noted} فيهم ملاحظة</>}
            </>
          ) : (
            <>
              ⏳ <strong>{waiting.length}</strong> تعديل كيتسنى موافقة المالك
            </>
          ))}
        {refused.length > 0 && (
          <>
            {waiting.length > 0 && " · "}❌ <strong>{refused.length}</strong> ترفضو
          </>
        )}
        {notes.length > 0 && (
          <>
            {(waiting.length > 0 || refused.length > 0) && " · "}📝 <strong>{notes.length}</strong> ملاحظة من المالك
          </>
        )}
      </span>
      <span className="approvals-go">{owner && waiting.length ? "شوف ووافق ←" : "شوف ←"}</span>
    </button>
  );
}
