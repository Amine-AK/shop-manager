"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/client";
import { dueText, matchesClient, money } from "@/lib/format";
import { whatsappLink } from "@/lib/receipt";
import { fillTemplate, parseTemplates, REMINDER_TEMPLATES_KEY } from "@/lib/reminder-templates";
import { listAudios, shareAudio, type ReminderAudio } from "@/lib/reminder-audio";
import { ReminderSettingsDialog } from "./ReminderSettings";
import { formatMoroccoPhone, isValidPhone } from "@/lib/sheet-logic";
import { Modal } from "./Modal";
import type { LedgerState } from "./useLedger";

type Outcome = { status: "sent" | "failed" | "skipped"; detail: string };

/** What WATI knows (only when it is set up on the server): who was already reminded today. */
interface WatiInfo {
  watiConfigured: boolean;
  sentToday: Set<string>;
}

const BATCH = 10;

// Who was reminded by hand from this device today (WhatsApp opened or called), so the
// list shows it. Per device, kept a day.
const CONTACTED_KEY = "reminder-contacted";
// The text and the voice message chosen last time on this device.
const TEMPLATE_KEY = "reminder-template";
const AUDIO_KEY = "reminder-audio";

function readKey(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeKey(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}
type Contacted = Record<string, { day: string; how: "wa" | "call" }>;

function readContacted(today: string): Contacted {
  try {
    const all = JSON.parse(localStorage.getItem(CONTACTED_KEY) || "{}") as Contacted;
    return Object.fromEntries(Object.entries(all).filter(([, v]) => v?.day === today));
  } catch {
    return {};
  }
}

/**
 * The late customers. For each one: «📞 اتصل» and «💬 واتساب» (WhatsApp opens on
 * their number with the reminder typed; nothing is sent until you press send).
 * This works from the data on the device, also offline, without any API. When
 * WATI is set up on the server, several can also be sent at once through it.
 */
export function RemindersDialog({ data, bulkBlocked, onClose, onToast }: { data: LedgerState; bulkBlocked: string; onClose: () => void; onToast: (msg: string) => void }) {
  const today = data.today;
  const templates = parseTemplates(data.ledger!.settings.find((x) => x.key === REMINDER_TEMPLATES_KEY));
  const [templateId, setTemplateId] = useState("");
  const template = templates.find((t) => t.id === templateId) ?? templates[0];
  const [audios, setAudios] = useState<ReminderAudio[]>([]);
  const [audioId, setAudioId] = useState("");
  const audio = audios.find((a) => a.id === audioId);
  const [settings, setSettings] = useState(false);
  const overdue = useMemo(
    () => data.summaries.filter((s) => s.status === "overdue").sort((a, b) => a.client.nextDueDate.localeCompare(b.client.nextDueDate)),
    [data.summaries],
  );
  const [query, setQuery] = useState("");
  const [contacted, setContacted] = useState<Contacted>({});
  const [wati, setWati] = useState<WatiInfo | null>(null);
  const [waTarget, setWaTarget] = useState<"app" | "web">("app");
  // WATI (bulk) only
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<"pick" | "confirm" | "sending" | "done">("pick");
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [sendError, setSendError] = useState("");

  useEffect(() => {
    setContacted(readContacted(today));
    setTemplateId(readKey(TEMPLATE_KEY));
    setAudioId(readKey(AUDIO_KEY));
    // A PC opens WhatsApp Web; a phone opens the app.
    if (!/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) setWaTarget("web");
  }, [today]);

  // Voice messages are on this device; read again after the settings window closes.
  useEffect(() => {
    if (!settings) void listAudios().then(setAudios);
  }, [settings]);

  async function sendAudio(c: { id: string; name: string }) {
    if (!audio) return;
    const how = await shareAudio(audio, `${audio.name} - ${c.name}`);
    if (how === "cancelled") return;
    mark(c.id, "wa");
    onToast(how === "shared" ? "🎤 اختار واتساب ومن بعد الزبون" : "🎤 الصوت تحمّل: جرّو للمحادثة ديال الزبون فواتساب");
  }

  // Ask the server whether WATI is set up; without internet the list still works by hand.
  useEffect(() => {
    if (!data.online) return;
    apiFetch<{ watiConfigured: boolean; overdue: { id: string; sentToday: boolean }[] }>("/api/reminders")
      .then((d) => {
        const sent = new Set(d.overdue.filter((i) => i.sentToday).map((i) => i.id));
        setWati({ watiConfigured: d.watiConfigured, sentToday: sent });
        setSelected(new Set(overdue.filter((s) => isValidPhone(formatMoroccoPhone(s.client.phone)) && !sent.has(s.client.id)).map((s) => s.client.id)));
      })
      .catch(() => setWati(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.online]);

  function mark(id: string, how: "wa" | "call") {
    setContacted((old) => {
      const next = { ...old, [id]: { day: today, how } };
      try {
        localStorage.setItem(CONTACTED_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  const bulk = Boolean(wati?.watiConfigured);
  const shown = overdue.filter((s) => matchesClient(s.client.name, s.client.phone, query));
  const valid = (phone: string) => isValidPhone(formatMoroccoPhone(phone));
  const chosen = overdue.filter((s) => selected.has(s.client.id) && valid(s.client.phone));
  const counts = Object.values(outcomes).reduce((acc, o) => ({ ...acc, [o.status]: acc[o.status] + 1 }), { sent: 0, failed: 0, skipped: 0 });
  const doneByHand = overdue.filter((s) => contacted[s.client.id]).length;

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function send() {
    setStep("sending");
    setSendError("");
    const queue = chosen.map((s) => s.client.id);
    for (let i = 0; i < queue.length; i += BATCH) {
      try {
        const { results } = await apiFetch<{ results: ({ id: string } & Outcome)[] }>("/api/reminders/send", {
          method: "POST",
          body: { ids: queue.slice(i, i + BATCH) },
        });
        setOutcomes((o) => ({ ...o, ...Object.fromEntries(results.map((r) => [r.id, { status: r.status, detail: r.detail }])) }));
      } catch (e) {
        setSendError(e instanceof Error ? e.message : String(e));
        break;
      }
    }
    setStep("done");
  }

  const busy = step === "sending";
  let footer: React.ReactNode = (
    <button type="button" className="btn" onClick={onClose}>
      سد
    </button>
  );
  if (bulk && step === "pick") {
    footer = (
      <>
        <button type="button" className="btn" onClick={onClose}>
          سد
        </button>
        <button type="button" className="btn primary" disabled={!chosen.length || Boolean(bulkBlocked)} onClick={() => setStep("confirm")} title={bulkBlocked || undefined}>
          صيفط للمختارين عبر WATI ({chosen.length})
        </button>
      </>
    );
  } else if (step === "confirm") {
    footer = (
      <>
        <button type="button" className="btn" onClick={() => setStep("pick")}>
          رجوع
        </button>
        <button type="button" className="btn primary" onClick={send}>
          أكد وصيفط
        </button>
      </>
    );
  } else if (step === "done") {
    footer = (
      <button type="button" className="btn primary" onClick={onClose}>
        سالينا
      </button>
    );
  }

  return (
    <Modal title="تذكير الزبناء المتأخرين" onClose={onClose} busy={busy} footer={footer}>
      {overdue.length === 0 ? (
        <p className="empty">ما كاين حتى زبون متأخر. 👌</p>
      ) : (
        <p className="muted small">
          عيّط ولا صيفط واتساب لكل زبون بوحدو: الرسالة كتكون مكتوبة، وما كتمشي حتى تضغط إرسال فواتساب.
          {doneByHand > 0 && (
            <>
              {" "}
              · ✓ <bdi dir="ltr">{doneByHand}</bdi> تذكّرو اليوم من هاد الجهاز
            </>
          )}
        </p>
      )}
      {overdue.length > 0 && step === "pick" && (
        <div className="remind-choose">
          <label className="field">
            <span>💬 الرسالة المكتوبة</span>
            <select
              value={template.id}
              onChange={(e) => {
                setTemplateId(e.target.value);
                writeKey(TEMPLATE_KEY, e.target.value);
              }}
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>🎤 رسالة صوتية</span>
            <select
              value={audio?.id ?? ""}
              onChange={(e) => {
                setAudioId(e.target.value);
                writeKey(AUDIO_KEY, e.target.value);
              }}
            >
              <option value="">{audios.length ? "بلا صوت" : "ما كاين حتى صوت"}</option>
              {audios.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="link-btn" onClick={() => setSettings(true)}>
            ✏️ كتب ولا سجل الرسائل
          </button>
        </div>
      )}
      {bulk && bulkBlocked && step === "pick" && <p className="muted small">الإرسال الجماعي (WATI): {bulkBlocked}</p>}

      {step === "confirm" && (
        <p className="alert info">
          غادي تصيفط رسالة واتساب لـ <strong>{chosen.length}</strong> زبون عبر WATI. الرسالة ما يمكنش ترجع.
        </p>
      )}
      {(step === "sending" || step === "done") && (
        <div className="progress" role="status" aria-live="polite">
          <progress max={chosen.length} value={counts.sent + counts.failed + counts.skipped} />
          <span>
            تصيفطو {counts.sent} · فشلو {counts.failed} · تخطيناهم {counts.skipped}
          </span>
        </div>
      )}
      {sendError && (
        <p className="alert error" role="alert">
          {sendError}
        </p>
      )}

      {overdue.length > 0 && step === "pick" && (
        <div className="search-row">
          <label className="visually-hidden" htmlFor="reminder-search">
            قلب على زبون
          </label>
          <input id="reminder-search" type="search" className="search" placeholder="قلب بالسمية ولا الهاتف…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}
      {overdue.length > 0 && step === "pick" && shown.length === 0 && <p className="empty">حتى زبون متأخر ما كيطابق «{query.trim()}».</p>}

      {overdue.length > 0 && (
        <ul className="pick-list remind-list">
          {(step === "pick" ? shown : chosen).map((s) => {
            const c = s.client;
            const ok = valid(c.phone);
            const wa = ok ? whatsappLink(c.phone, fillTemplate(template.text, s, today), waTarget) : null;
            const tel = c.phone.replace(/[^\d+]/g, "");
            const done = contacted[c.id];
            const outcome = outcomes[c.id];
            return (
              <li key={c.id} className={done ? "contacted" : ""}>
                <div className="remind-row">
                  {bulk && (
                    <input
                      type="checkbox"
                      aria-label={`اختار ${c.name} للإرسال الجماعي`}
                      checked={selected.has(c.id) && ok}
                      disabled={!ok || step !== "pick"}
                      onChange={() => toggle(c.id)}
                    />
                  )}
                  <span className="pick-main">
                    <strong>{c.name}</strong>
                    <bdi dir="ltr" className="muted">
                      {c.phone || "—"}
                    </bdi>
                  </span>
                  <span className="pick-side">
                    <span className="amount">{money(s.remaining)}</span>
                    <span className="muted">{dueText(c.nextDueDate, s.status, today)}</span>
                  </span>
                </div>
                {step === "pick" && (
                  <div className="remind-actions">
                    {tel ? (
                      <a className="btn small-btn" href={`tel:${tel}`} onClick={() => mark(c.id, "call")}>
                        📞 اتصل
                      </a>
                    ) : (
                      <span className="muted small">ما عندوش رقم</span>
                    )}
                    {wa ? (
                      <a className="btn whatsapp small-btn" href={wa} target="_blank" rel="noopener noreferrer" onClick={() => mark(c.id, "wa")}>
                        💬 واتساب
                      </a>
                    ) : (
                      tel && <span className="muted small">الرقم ما صالحش لواتساب</span>
                    )}
                    {audio && ok && (
                      <button type="button" className="btn small-btn" onClick={() => void sendAudio(c)}>
                        🎤 صوت
                      </button>
                    )}
                    {done && <span className="remind-done">✓ {done.how === "wa" ? "تحلّ الواتساب" : "تعيّط ليه"} اليوم</span>}
                    {!done && wati?.sentToday.has(c.id) && <span className="remind-done">✓ تصيفط ليه اليوم (WATI)</span>}
                  </div>
                )}
                {outcome && <p className={`pick-note ${outcome.status}`}>{outcome.status === "sent" ? "✓ تصيفط" : outcome.detail}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {settings && <ReminderSettingsDialog data={data} onClose={() => setSettings(false)} onToast={onToast} />}
    </Modal>
  );
}
