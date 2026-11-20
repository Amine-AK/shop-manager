"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  claimMessage,
  contactsOf,
  contactsValue,
  isLate,
  isOpen,
  lateClaims,
  reminderMessage,
  searchClaims,
  SERVICE_CONTACTS_KEY,
  sinceText,
  soldItems,
  STATUS_INFO,
  type ServiceContact,
  type SoldItem,
} from "@/lib/claims";
import { CLAIM_STATUSES, newLedgerId, nowParts, type Claim, type ClaimStatus } from "@/lib/ledger";
import { displayDate, displayDateTime, whatsappLink } from "@/lib/receipt";
import { Modal } from "./Modal";
import { Confirm, Field } from "./ui";
import type { LedgerState } from "./useLedger";

type Filter = "open" | "late" | "done" | "all";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "open", label: "مفتوحين" },
  { value: "late", label: "⏰ معطلين" },
  { value: "done", label: "✅ تحلو" },
  { value: "all", label: "الكل" },
];

type Sub = { kind: "add" } | { kind: "edit"; id: string } | { kind: "open"; id: string } | { kind: "delete"; id: string } | { kind: "contacts" } | null;

/** The time now, refreshed every minute, so a request turns late while the screen stays open. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * خدمة الشركة: requests sent to the brands' after-sales services for products
 * we sold. Late ones (48 h without a solution) come first, with a reminder button.
 */
export function ClaimsView({ data, onToast, initialFilter = "open" }: { data: LedgerState; onToast: (msg: string) => void; initialFilter?: Filter }) {
  const claims = data.ledger!.claims;
  const now = useNow();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [sub, setSub] = useState<Sub>(null);

  const late = lateClaims(claims, now);
  const open = claims.filter(isOpen);
  const list = useMemo(() => {
    const found = searchClaims(claims, query, now);
    if (query.trim()) return found;
    return found.filter((c) => (filter === "all" ? true : filter === "late" ? isLate(c, now) : filter === "done" ? !isOpen(c) : isOpen(c)));
  }, [claims, query, filter, now]);

  return (
    <div className="view">
      <section className="summary" aria-label="ملخص خدمة الشركة">
        <div className="stat">
          <span className="stat-label">مفتوحين</span>
          <span className="stat-value">{open.length}</span>
          <span className="stat-sub">طلب</span>
        </div>
        <div className="stat">
          <span className="stat-label">معطلين</span>
          <span className={`stat-value ${late.length ? "danger-text" : ""}`}>{late.length}</span>
          <span className="stat-sub">فاتو 48 ساعة</span>
        </div>
      </section>

      <div className="actions-row in-flow">
        <button type="button" className="btn" onClick={() => setSub({ kind: "contacts" })}>
          🏭 خدمة العملاء
        </button>
        <button type="button" className="btn primary" onClick={() => setSub({ kind: "add" })}>
          ＋ طلب جديد
        </button>
      </div>

      <div className="search-row">
        <label className="visually-hidden" htmlFor="claim-search">
          قلب فالطلبات
        </label>
        <input id="claim-search" type="search" className="search" placeholder="قلب بالزبون، السلعة، الشركة ولا التيليفون…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {!query.trim() && (
        <div className="chips" role="group" aria-label="شنو نشوفو">
          {FILTERS.map((f) => (
            <button key={f.value} type="button" className={`chip ${filter === f.value ? "on" : ""}`} aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
              {f.label}
            </button>
          ))}
        </div>
      )}

      <p className="result-count muted">{list.length} طلب</p>
      {list.length === 0 ? (
        <p className="empty">
          {claims.length ? "ما كاين حتى طلب هنا." : "باقي ما تسجل حتى طلب. ملي شي سلعة بعتيها يكون فيها عطب وخاصها الشركة، ضغط «＋ طلب جديد» ولا زر «🏭 ريكلاماسيون» فصفحة الزبون."}
        </p>
      ) : (
        <ul className="repair-list">
          {list.map((c) => {
            const lateNow = isLate(c, now);
            return (
              <li key={c.id} className={`repair-row tone-${lateNow ? "bad" : STATUS_INFO[c.status].tone === "done" ? "ready" : STATUS_INFO[c.status].tone}`}>
                <button type="button" className="repair-open" onClick={() => setSub({ kind: "open", id: c.id })} aria-label={`${c.item} · ${c.customer}`}>
                  <span className="repair-thumb empty-thumb" aria-hidden="true">
                    🏭
                  </span>
                  <span className="repair-main">
                    <span className="repair-device">{c.item}</span>
                    <span className="repair-sub">
                      {c.customer} · {c.company}
                    </span>
                  </span>
                  <span className="repair-side">
                    <ClaimBadge claim={c} now={now} />
                    <span className="repair-sub">{isOpen(c) ? `هادي ${sinceText(c.createdAt, now)}` : <bdi dir="ltr">{displayDate(c.resolvedDate)}</bdi>}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {(sub?.kind === "add" || sub?.kind === "edit") && (
        <ClaimForm
          data={data}
          claim={sub.kind === "edit" ? claims.find((c) => c.id === sub.id) : undefined}
          onClose={() => setSub(sub.kind === "edit" ? { kind: "open", id: sub.id } : null)}
          onSaved={(id, isNew) => {
            onToast(isNew ? "تسجل الطلب" : "تبدل الطلب");
            setSub({ kind: "open", id });
          }}
        />
      )}
      {sub?.kind === "open" && claims.some((c) => c.id === sub.id) && (
        <ClaimDetail
          data={data}
          claim={claims.find((c) => c.id === sub.id)!}
          now={now}
          onClose={() => setSub(null)}
          onEdit={() => setSub({ kind: "edit", id: sub.id })}
          onDelete={() => setSub({ kind: "delete", id: sub.id })}
          onToast={onToast}
        />
      )}
      {sub?.kind === "delete" && (
        <Confirm
          title="حذف الطلب"
          confirmLabel="حذف"
          danger
          onClose={() => setSub({ kind: "open", id: sub.id })}
          onConfirm={() => {
            const c = claims.find((x) => x.id === sub.id);
            data.run(`حذف طلب · ${c?.item ?? ""}`, { type: "claim.delete", id: sub.id });
            onToast("تحذف الطلب");
            setSub(null);
          }}
        >
          <p className="lead">نحيدو هاد الطلب من اللائحة؟</p>
        </Confirm>
      )}
      {sub?.kind === "contacts" && <ServiceContactsDialog data={data} onClose={() => setSub(null)} onToast={onToast} />}
    </div>
  );
}

/** One request opened from elsewhere (a customer's page): its detail, edit and delete. */
export function ClaimPanel({ data, claimId, onClose, onToast }: { data: LedgerState; claimId: string; onClose: () => void; onToast: (msg: string) => void }) {
  const now = useNow();
  const [mode, setMode] = useState<"open" | "edit" | "delete">("open");
  const claim = data.ledger!.claims.find((c) => c.id === claimId);
  if (!claim) return null;
  if (mode === "edit") {
    return (
      <ClaimForm
        data={data}
        claim={claim}
        onClose={() => setMode("open")}
        onSaved={() => {
          onToast("تبدل الطلب");
          setMode("open");
        }}
      />
    );
  }
  if (mode === "delete") {
    return (
      <Confirm
        title="حذف الطلب"
        confirmLabel="حذف"
        danger
        onClose={() => setMode("open")}
        onConfirm={() => {
          data.run(`حذف طلب · ${claim.item}`, { type: "claim.delete", id: claim.id });
          onToast("تحذف الطلب");
          onClose();
        }}
      >
        <p className="lead">نحيدو هاد الطلب من اللائحة؟</p>
      </Confirm>
    );
  }
  return <ClaimDetail data={data} claim={claim} now={now} onClose={onClose} onEdit={() => setMode("edit")} onDelete={() => setMode("delete")} onToast={onToast} />;
}

/** «⏰ معطل» when late, else the status. */
export function ClaimBadge({ claim: c, now }: { claim: Claim; now: Date }) {
  if (isLate(c, now)) return <span className="repair-status tone-bad">⏰ معطل</span>;
  const info = STATUS_INFO[c.status];
  return (
    <span className={`repair-status tone-${info.tone === "done" ? "ready" : info.tone}`}>
      {info.icon} {c.status}
    </span>
  );
}

/**
 * New request (saved, then WhatsApp opens on the service's number with the
 * message ready), or edit of one. `clientId`: opened from a customer's page,
 * with their purchases to choose from; else any sale, cash or credit.
 */
export function ClaimForm({
  data,
  claim,
  clientId,
  onClose,
  onSaved,
}: {
  data: LedgerState;
  claim?: Claim;
  clientId?: string;
  onClose: () => void;
  onSaved: (id: string, isNew: boolean) => void;
}) {
  const ledger = data.ledger!;
  const contacts = contactsOf(ledger);
  const client = clientId ? ledger.clients.find((c) => c.id === clientId) : undefined;
  const [v, setV] = useState({
    item: claim?.item ?? "",
    saleDate: claim?.saleDate ?? "",
    // The customer's name and number come from the app's data, and can be changed here.
    customer: claim?.customer ?? client?.name ?? "",
    phone: claim?.phone ?? client?.phone ?? "",
    problem: claim?.problem ?? "",
    notes: claim?.notes ?? "",
    contact: claim ? "" : contacts.length === 1 ? contacts[0].id : "",
  });
  const [picked, setPicked] = useState<SoldItem | null>(null);
  const [search, setSearch] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [addingContact, setAddingContact] = useState(false);
  const saved = useRef(false);
  const set = (k: keyof typeof v) => (value: string) => {
    setV((o) => ({ ...o, [k]: value }));
    setErrors((e) => ({ ...e, [k]: "" }));
  };

  const options = useMemo(
    () => (claim ? [] : soldItems(ledger, clientId ? { clientId } : { query: search, limit: 6 })),
    [ledger, clientId, search, claim],
  );

  function pick(x: SoldItem) {
    setPicked(x);
    setV((o) => ({ ...o, item: x.item, saleDate: x.date, customer: o.customer.trim() ? o.customer : x.customer, phone: o.phone.trim() ? o.phone : x.phone }));
    setErrors((e) => ({ ...e, item: "" }));
  }

  // The service: the one chosen, or (edit) the one the request was sent to.
  const chosen = contacts.find((c) => c.id === v.contact);
  const service = chosen ? { company: chosen.company, servicePhone: chosen.phone } : claim ? { company: claim.company, servicePhone: claim.servicePhone } : null;
  const told = { item: v.item.trim(), saleDate: v.saleDate, problem: v.problem.trim(), customer: v.customer.trim(), phone: v.phone.trim() };

  function submit(e: FormEvent) {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!told.item) err.item = "شنو هي السلعة؟";
    if (!service) err.contact = "اختار خدمة الصيانة ديال الشركة";
    else if (!whatsappLink(service.servicePhone, "")) err.contact = "رقم الواتساب ديال هاد الشركة غير صحيح. صلحو فـ «خدمة العملاء».";
    if (!told.customer) err.customer = "سمية الزبون ضرورية";
    if (!told.problem) err.problem = "شنو هو العطب؟";
    setErrors(err);
    if (Object.keys(err).length || !service || saved.current) return;
    saved.current = true;
    const fields = { ...told, notes: v.notes.trim(), ...service };
    if (claim) {
      data.run(`تعديل طلب · ${fields.item}`, { type: "claim.update", id: claim.id, base: claim.updatedAt, patch: fields });
      return onSaved(claim.id, false);
    }
    const id = newLedgerId("W");
    const at = new Date().toISOString();
    const now = nowParts();
    // The product chosen in the list, unless its name was retyped to something else.
    const from = picked && picked.item === fields.item ? picked : null;
    data.run(`طلب خدمة الشركة · ${fields.item}`, {
      type: "claim.add",
      claim: {
        id,
        date: now.date,
        time: now.time,
        ...fields,
        status: "تصيفط",
        lastSentAt: at,
        reminders: 0,
        resolvedDate: "",
        resolvedTime: "",
        clientId: from?.clientId ?? clientId ?? "",
        purchaseId: from?.purchaseId ?? "",
        saleId: from?.saleId ?? "",
        createdAt: at,
        updatedAt: at,
      },
    });
    // Nothing is sent until the user presses send in WhatsApp.
    const link = whatsappLink(service.servicePhone, claimMessage(told));
    if (link) window.open(link, "_blank", "noopener");
    onSaved(id, true);
  }

  return (
    <>
      <Modal
        title={claim ? `تعديل: ${claim.item}` : client ? `🏭 ريكلاماسيون · ${client.name}` : "🏭 طلب جديد لخدمة الشركة"}
        onClose={onClose}
        footer={
          <>
            <button type="button" className="btn" onClick={onClose}>
              إلغاء
            </button>
            <button type="submit" form="claim-form" className={`btn ${claim ? "primary" : "whatsapp"}`}>
              {claim ? "حفظ" : "📲 سجل وصيفط فواتساب"}
            </button>
          </>
        }
      >
        <form id="claim-form" className="form-grid" noValidate onSubmit={submit}>
          {!claim && (
            <div className="field wide">
              <span>{clientId ? "السلعة لي فيها العطب" : "اختار من المبيعات (كاش ولا كريدي)"}</span>
              {!clientId && (
                <input type="search" className="search" aria-label="قلب فالمبيعات" placeholder="قلب بسمية السلعة ولا الزبون…" value={search} onChange={(e) => setSearch(e.target.value)} />
              )}
              {options.length === 0 ? (
                <span className="field-hint">{clientId ? "هاد الزبون ما عندو حتى سلعة مسجلة. كتب السلعة لتحت." : "ما لقينا والو فالمبيعات. كتب السلعة لتحت."}</span>
              ) : (
                <ul className="claim-pick">
                  {options.map((x) => (
                    <li key={x.key}>
                      <button type="button" className={picked?.key === x.key ? "on" : ""} aria-pressed={picked?.key === x.key} onClick={() => pick(x)}>
                        <strong>{x.item}</strong>
                        <span className="muted small">
                          <bdi dir="ltr">{displayDate(x.date)}</bdi>
                          {!clientId && ` · ${x.customer || "كاش"}`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <Field id="cl-item" label="السلعة (نوع الجهاز)" error={errors.item}>
            <input id="cl-item" value={v.item} onChange={(e) => set("item")(e.target.value)} />
          </Field>
          <Field id="cl-sale-date" label="تاريخ البيع">
            <input id="cl-sale-date" type="date" value={v.saleDate} onChange={(e) => set("saleDate")(e.target.value)} />
          </Field>
          <Field
            id="cl-contact"
            label="خدمة الصيانة ديال الشركة"
            error={errors.contact}
            wide
            hint={
              <>
                {service && <bdi dir="ltr">{service.servicePhone}</bdi>}
                {service && " · "}
                <button type="button" className="link-btn" onClick={() => setAddingContact(true)}>
                  {contacts.length ? "بدل ولا زيد شركة" : "＋ زيد شركة"}
                </button>
              </>
            }
          >
            <select id="cl-contact" value={v.contact} onChange={(e) => set("contact")(e.target.value)}>
              <option value="">{claim ? `${claim.company} (كيف تصيفط)` : contacts.length ? "اختار الشركة…" : "ما كاينة حتى شركة مسجلة"}</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company}
                </option>
              ))}
            </select>
          </Field>
          <Field id="cl-customer" label="اسم الزبون" error={errors.customer}>
            <input id="cl-customer" value={v.customer} onChange={(e) => set("customer")(e.target.value)} />
          </Field>
          <Field id="cl-phone" label="هاتف الزبون" hint="باش الشركة تتصل بيه">
            <input id="cl-phone" type="tel" inputMode="tel" dir="ltr" value={v.phone} onChange={(e) => set("phone")(e.target.value)} />
          </Field>
          <Field id="cl-problem" label="العطب" error={errors.problem} wide>
            <textarea id="cl-problem" rows={3} value={v.problem} onChange={(e) => set("problem")(e.target.value)} />
          </Field>
          <Field id="cl-notes" label="ملاحظات (للمحل فقط)" wide>
            <input id="cl-notes" value={v.notes} onChange={(e) => set("notes")(e.target.value)} />
          </Field>
          {!claim && (
            <details className="wa-preview wide">
              <summary>الرسالة لي غادي توجد فواتساب</summary>
              <pre dir="rtl">{claimMessage(told)}</pre>
            </details>
          )}
        </form>
      </Modal>
      {addingContact && <ServiceContactsDialog data={data} onClose={() => setAddingContact(false)} onToast={() => {}} />}
    </>
  );
}

function ClaimDetail({
  data,
  claim: c,
  now,
  onClose,
  onEdit,
  onDelete,
  onToast,
}: {
  data: LedgerState;
  claim: Claim;
  now: Date;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToast: (msg: string) => void;
}) {
  const late = isLate(c, now);
  const remindLink = whatsappLink(c.servicePhone, reminderMessage(c, now));
  const firstLink = whatsappLink(c.servicePhone, claimMessage(c));
  const tel = c.phone.replace(/[^\d+]/g, "");

  function setStatus(status: ClaimStatus) {
    if (status === c.status) return;
    const t = nowParts();
    const solved = status === "تحل" ? { resolvedDate: t.date, resolvedTime: t.time } : { resolvedDate: "", resolvedTime: "" };
    data.run(`${STATUS_INFO[status].icon} ${status} · ${c.item}`, { type: "claim.update", id: c.id, base: c.updatedAt, patch: { status, ...solved } });
    onToast(`${STATUS_INFO[status].icon} ${status}`);
  }

  /** The reminder is counted when WhatsApp opens: the service gets 48 h more before the next one. */
  function reminded() {
    data.run(`🔔 تذكير · ${c.company} · ${c.item}`, {
      type: "claim.update",
      id: c.id,
      base: c.updatedAt,
      patch: { reminders: c.reminders + 1, lastSentAt: new Date().toISOString() },
    });
    onToast("تسجل التذكير");
  }

  return (
    <Modal
      title={`🏭 ${c.item}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn danger-ghost" onClick={onDelete}>
            حذف
          </button>
          <button type="button" className="btn" onClick={onEdit}>
            ✏️ تعديل
          </button>
        </>
      }
    >
      {late && (
        <p className="alert error">
          ⏰ فاتت 48 ساعة ({sinceText(c.lastSentAt, now)} من آخر رسالة) وباقي ما تحلش المشكل. ذكّر الشركة باش تتصل بالزبون.
        </p>
      )}
      <dl className="facts">
        <div>
          <dt>الزبون</dt>
          <dd>{c.customer}</dd>
        </div>
        <div>
          <dt>هاتف الزبون</dt>
          <dd>
            <bdi dir="ltr">{c.phone || "—"}</bdi>
            {tel && (
              <>
                {" "}
                <a className="call-mini" href={`tel:${tel}`} aria-label={`اتصل بـ ${c.customer}`}>
                  📞 اتصل
                </a>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>الشركة</dt>
          <dd>
            {c.company} · <bdi dir="ltr">{c.servicePhone}</bdi>
          </dd>
        </div>
        <div>
          <dt>تاريخ البيع</dt>
          <dd>
            <bdi dir="ltr">{c.saleDate ? displayDate(c.saleDate) : "—"}</bdi>
          </dd>
        </div>
        <div>
          <dt>تصيفط الطلب</dt>
          <dd>
            <bdi dir="ltr">{displayDateTime(c.date, c.time)}</bdi>
            <span className="muted small"> (هادي {sinceText(c.createdAt, now)})</span>
          </dd>
        </div>
        <div>
          <dt>التذكيرات</dt>
          <dd>
            {c.reminders}
            {c.reminders > 0 && <span className="muted small"> (الأخير هادي {sinceText(c.lastSentAt, now)})</span>}
          </dd>
        </div>
        {!isOpen(c) && (
          <div>
            <dt>تحل نهار</dt>
            <dd className="ok-text">
              <bdi dir="ltr">{displayDateTime(c.resolvedDate, c.resolvedTime || "00:00")}</bdi>
            </dd>
          </div>
        )}
      </dl>
      <p>
        <strong>العطب:</strong> {c.problem}
      </p>
      {c.notes && <p className="muted small">{c.notes}</p>}

      <div className="field">
        <span>الحالة</span>
        <div className="segmented wide-seg repair-statuses" role="group" aria-label="الحالة">
          {CLAIM_STATUSES.map((s) => (
            <button key={s} type="button" className={c.status === s ? "on" : ""} aria-pressed={c.status === s} onClick={() => setStatus(s)}>
              {STATUS_INFO[s].icon} {s}
            </button>
          ))}
        </div>
      </div>

      {isOpen(c) && (
        <div className="actions-row in-flow">
          {remindLink ? (
            <a className={`btn ${late ? "whatsapp" : ""}`} href={remindLink} target="_blank" rel="noopener noreferrer" onClick={reminded}>
              🔔 ذكّر الشركة فواتساب
            </a>
          ) : (
            <p className="alert warn">رقم الواتساب ديال الشركة غير صحيح. صلحو بـ «✏️ تعديل».</p>
          )}
          {firstLink && (
            <a className="btn" href={firstLink} target="_blank" rel="noopener noreferrer">
              📨 عاود صيفط الطلب
            </a>
          )}
        </div>
      )}
      {(c.by || c.origin) && (
        <p className="muted small">
          آخر تعديل: {c.by} {c.origin && `· ${c.origin}`}
        </p>
      )}
    </Modal>
  );
}

/**
 * خدمة العملاء: the after-sales service of each brand (name + WhatsApp number),
 * saved in the shop settings and shared by every device.
 */
export function ServiceContactsDialog({ data, onClose, onToast }: { data: LedgerState; onClose: () => void; onToast: (msg: string) => void }) {
  const contacts = contactsOf(data.ledger!);
  const empty = { id: "", company: "", phone: "", notes: "" };
  const [v, setV] = useState<ServiceContact | null>(contacts.length ? null : empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<ServiceContact | null>(null);

  const save = (label: string, list: ServiceContact[]) => data.run(label, { type: "setting.save", key: SERVICE_CONTACTS_KEY, value: contactsValue(list) });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!v) return;
    const next = { ...v, company: v.company.trim(), phone: v.phone.trim(), notes: v.notes.trim() };
    const err: Record<string, string> = {};
    if (!next.company) err.company = "سمية الشركة ضرورية";
    else if (contacts.some((c) => c.id !== next.id && c.company.toLowerCase() === next.company.toLowerCase())) err.company = "هاد الشركة مسجلة ديجا";
    if (!whatsappLink(next.phone, "")) err.phone = "رقم الواتساب غير صحيح";
    setErrors(err);
    if (Object.keys(err).length) return;
    if (next.id) save(`خدمة العملاء · ${next.company}`, contacts.map((c) => (c.id === next.id ? next : c)));
    else save(`خدمة العملاء · ${next.company}`, [...contacts, { ...next, id: Math.random().toString(36).slice(2, 10) }]);
    onToast("تسجلات الشركة");
    setV(null);
  }

  return (
    <Modal title="🏭 خدمة العملاء ديال الشركات" onClose={onClose}>
      <p className="muted small">سجل هنا رقم الواتساب ديال خدمة الصيانة ديال كل شركة. ملي تدير ريكلاماسيون كتختار الشركة والرسالة كتمشي ليها.</p>
      {contacts.length > 0 && (
        <ul className="rows">
          {contacts.map((c) => (
            <li key={c.id}>
              <div className="row-main">
                <strong>{c.company}</strong>
                <span className="muted small">
                  <bdi dir="ltr">{c.phone}</bdi>
                  {c.notes && ` · ${c.notes}`}
                </span>
              </div>
              <div className="row-actions">
                <button type="button" className="link-btn" onClick={() => { setErrors({}); setV(c); }}>
                  تعديل
                </button>
                <button type="button" className="link-btn danger-text" onClick={() => setDeleting(c)}>
                  حذف
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {v ? (
        <form className="form-grid contact-form" noValidate onSubmit={submit}>
          <Field id="sc-company" label="الشركة" error={errors.company} hint="مثلا: Samsung، LG، Candy">
            <input id="sc-company" value={v.company} onChange={(e) => setV({ ...v, company: e.target.value })} autoFocus />
          </Field>
          <Field id="sc-phone" label="واتساب خدمة الصيانة" error={errors.phone}>
            <input id="sc-phone" type="tel" inputMode="tel" dir="ltr" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
          </Field>
          <Field id="sc-notes" label="ملاحظات" wide hint="مثلا: سمية المسؤول، أوقات الخدمة">
            <input id="sc-notes" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
          </Field>
          <div className="actions-row in-flow wide">
            {contacts.length > 0 && (
              <button type="button" className="btn" onClick={() => setV(null)}>
                إلغاء
              </button>
            )}
            <button type="submit" className="btn primary">
              {v.id ? "حفظ" : "＋ سجل الشركة"}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn primary" onClick={() => { setErrors({}); setV(empty); }}>
          ＋ شركة جديدة
        </button>
      )}
      {deleting && (
        <Confirm
          title="حذف الشركة"
          confirmLabel="حذف"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            save(`حذف خدمة العملاء · ${deleting.company}`, contacts.filter((c) => c.id !== deleting.id));
            setDeleting(null);
          }}
        >
          <p className="lead">نحيدو «{deleting.company}» من خدمة العملاء؟ الطلبات لي تصيفطو ليها كيبقاو.</p>
        </Confirm>
      )}
    </Modal>
  );
}
