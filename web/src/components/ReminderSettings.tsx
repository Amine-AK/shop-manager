"use client";

import { useEffect, useRef, useState } from "react";
import { deleteAudio, listAudios, MAX_AUDIO_BYTES, recordingType, saveAudio, type ReminderAudio } from "@/lib/reminder-audio";
import {
  fillTemplate,
  parseTemplates,
  REMINDER_TEMPLATES_KEY,
  TEMPLATE_VARIABLES,
  templatesValue,
  unknownVariables,
  type ReminderTemplate,
} from "@/lib/reminder-templates";
import type { ClientSummary } from "@/lib/ledger";
import { Modal } from "./Modal";
import { Confirm, Field } from "./ui";
import type { LedgerState } from "./useLedger";

/** A customer to show the preview with: a late one if any, else any customer. */
function sampleCustomer(data: LedgerState): ClientSummary | undefined {
  return data.summaries.find((s) => s.status === "overdue") ?? data.summaries.find((s) => s.remaining > 0) ?? data.summaries[0];
}

/**
 * ⚙️ «💬 رسائل التذكير»: the reminders' written texts (shared by every device,
 * with [variables]) and the voice messages recorded on this device.
 */
export function ReminderSettingsDialog({ data, onClose, onToast }: { data: LedgerState; onClose: () => void; onToast: (msg: string) => void }) {
  const templates = parseTemplates(data.ledger!.settings.find((s) => s.key === REMINDER_TEMPLATES_KEY));
  const [editing, setEditing] = useState<ReminderTemplate | null>(null);
  const [deleting, setDeleting] = useState<ReminderTemplate | null>(null);

  const save = (label: string, list: ReminderTemplate[]) => data.run(label, { type: "setting.save", key: REMINDER_TEMPLATES_KEY, value: templatesValue(list) });

  return (
    <Modal title="💬 رسائل التذكير" onClose={onClose}>
      <section className="detail-section" aria-label="الرسائل المكتوبة">
        <h3>✍️ الرسائل المكتوبة</h3>
        <p className="muted small">
          كتب الرسالة كيف بغيتي، وحط بين [ ] اللي خاص التطبيق يعمر: [الاسم]، [الباقي]… كتبان لجميع الأجهزة، وفـ «تذكير المتأخرين» كتختار شمن وحدة تصيفط.
        </p>
        <ul className="rows">
          {templates.map((t) => (
            <li key={t.id}>
              <div className="row-main">
                <strong>{t.name}</strong>
                <span className="muted small template-peek">{t.text.split("\n").slice(0, 2).join(" · ")}</span>
              </div>
              <div className="row-actions">
                <button type="button" className="link-btn" onClick={() => setEditing(t)}>
                  تعديل
                </button>
                {t.id !== "default" && (
                  <button type="button" className="link-btn danger-text" onClick={() => setDeleting(t)}>
                    حذف
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        <button type="button" className="btn" onClick={() => setEditing({ id: "", name: "", text: "السلام عليكم [الاسم] 👋\n" })}>
          ＋ رسالة جديدة
        </button>
      </section>

      <AudioSection onToast={onToast} />

      {editing && (
        <TemplateEditor
          data={data}
          template={editing}
          onClose={() => setEditing(null)}
          onSave={(t) => {
            const list = templates.some((x) => x.id === t.id) ? templates.map((x) => (x.id === t.id ? t : x)) : [...templates, t];
            save(`💬 رسالة التذكير · ${t.name}`, list);
            onToast("تسجلات الرسالة");
            setEditing(null);
          }}
        />
      )}
      {deleting && (
        <Confirm
          title="حذف الرسالة"
          confirmLabel="حذف"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            save(`حذف رسالة التذكير · ${deleting.name}`, templates.filter((x) => x.id !== deleting.id));
            setDeleting(null);
          }}
        >
          <p className="lead">نحيدو «{deleting.name}»؟</p>
        </Confirm>
      )}
    </Modal>
  );
}

function TemplateEditor({ data, template, onClose, onSave }: { data: LedgerState; template: ReminderTemplate; onClose: () => void; onSave: (t: ReminderTemplate) => void }) {
  const [name, setName] = useState(template.name);
  const [text, setText] = useState(template.text);
  const [error, setError] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const sample = sampleCustomer(data);
  const unknown = unknownVariables(text);

  /** Put [variable] where the cursor is. */
  function insert(variable: string) {
    const el = area.current;
    const token = `[${variable}]`;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + token + text.slice(end));
    setTimeout(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    }, 0);
  }

  function submit() {
    if (!name.trim()) return setError("عطي سمية للرسالة (مثلا: لطيفة، قوية…)");
    if (!text.trim()) return setError("الرسالة خاوية");
    if (text.length > 3000) return setError("الرسالة طويلة بزاف");
    onSave({ id: template.id || Math.random().toString(36).slice(2, 10), name: name.trim().slice(0, 60), text });
  }

  return (
    <Modal
      title={template.id ? `تعديل: ${template.name}` : "💬 رسالة جديدة"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            إلغاء
          </button>
          <button type="button" className="btn primary" onClick={submit}>
            حفظ
          </button>
        </>
      }
    >
      <Field id="tpl-name" label="سمية الرسالة" error={error && !name.trim() ? error : undefined} hint="باش تعرفها ملي تختار">
        <input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      </Field>
      <div className="field">
        <span>زيد معلومة (كتدخل فين كاين المؤشر)</span>
        <div className="var-chips" role="group" aria-label="المتغيرات">
          {TEMPLATE_VARIABLES.map((v) => (
            <button key={v.name} type="button" className="chip" title={v.hint} onClick={() => insert(v.name)}>
              [{v.name}]
            </button>
          ))}
        </div>
      </div>
      <Field id="tpl-text" label="الرسالة" error={error && name.trim() ? error : undefined}>
        <textarea id="tpl-text" ref={area} rows={9} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      {unknown.length > 0 && (
        <p className="alert warn">
          ما كنعرفش: {unknown.map((u) => `[${u}]`).join("، ")}. غادي يبانو كيف ما كتبتيهم. اختار من اللائحة لفوق.
        </p>
      )}
      <div className="wa-preview template-preview">
        <p className="muted small">كيفاش غادي توصل{sample ? ` (مثلا لـ ${sample.client.name})` : ""}:</p>
        <pre dir="rtl">{sample ? fillTemplate(text, sample, data.today) : text}</pre>
      </div>
    </Modal>
  );
}

/** Voice messages kept on this device: record or pick a file, listen, delete. */
function AudioSection({ onToast }: { onToast: (msg: string) => void }) {
  const [list, setList] = useState<ReminderAudio[]>([]);
  const [name, setName] = useState("");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const canRecord = typeof window !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && recordingType() !== "";

  useEffect(() => {
    void listAudios().then(setList);
    return () => {
      if (timer.current) clearInterval(timer.current);
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function keep(blob: Blob) {
    if (blob.size > MAX_AUDIO_BYTES) return setError("الصوت كبير بزاف (أكثر من 3 ميغا). سجل رسالة قصيرة.");
    setList(await saveAudio(name || `رسالة صوتية ${list.length + 1}`, blob));
    setName("");
    setError("");
    onToast("🎤 تسجل الصوت فهاد الجهاز");
  }

  async function start() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = recordingType();
      const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void keep(new Blob(chunks.current, { type: rec.mimeType || type }));
      };
      rec.start();
      recorder.current = rec;
      setRecording(true);
      setSeconds(0);
      timer.current = setInterval(() => {
        setSeconds((s) => {
          // A reminder stays short: stop by itself after 2 minutes.
          if (s + 1 >= 120) stop();
          return s + 1;
        });
      }, 1000);
    } catch {
      setError("ما قدرناش نحلو الميكرو. سمح للتطبيق باستعمال الميكرو فإعدادات المتصفح.");
    }
  }

  function stop() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (recorder.current?.state === "recording") recorder.current.stop();
    recorder.current = null;
    setRecording(false);
  }

  return (
    <section className="detail-section" aria-label="الرسائل الصوتية">
      <h3>🎤 الرسائل الصوتية (فهاد الجهاز)</h3>
      <p className="muted small">
        سجل بصوتك ولا اختار ملف صوتي. كيتحفظ غير فهاد الجهاز. فالتيليفون كيتصيفط عبر قائمة المشاركة ← واتساب ← الزبون. فالـ PC كيتحمّل الملف وكتجرّو للمحادثة.
      </p>
      {list.length > 0 && (
        <ul className="rows audio-list">
          {list.map((a) => (
            <AudioRow
              key={a.id}
              audio={a}
              onDelete={async () => {
                setList(await deleteAudio(a.id));
              }}
            />
          ))}
        </ul>
      )}
      <div className="audio-new">
        <input aria-label="سمية الرسالة الصوتية" placeholder="سمية الرسالة الصوتية (مثلا: تذكير لطيف)" value={name} onChange={(e) => setName(e.target.value)} disabled={recording} />
        <div className="audio-buttons">
          {canRecord &&
            (recording ? (
              <button type="button" className="btn danger" onClick={stop}>
                ⏹️ وقف التسجيل · <bdi dir="ltr">{`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}</bdi>
              </button>
            ) : (
              <button type="button" className="btn primary" onClick={() => void start()}>
                🎤 سجل
              </button>
            ))}
          {!recording && (
            <label className="btn">
              📁 اختار ملف صوتي
              <input
                type="file"
                accept="audio/*"
                className="visually-hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void keep(f);
                }}
              />
            </label>
          )}
        </div>
        {error && <p className="field-error">{error}</p>}
      </div>
    </section>
  );
}

function AudioRow({ audio, onDelete }: { audio: ReminderAudio; onDelete: () => void }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const u = URL.createObjectURL(audio.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [audio.blob]);
  return (
    <li>
      <div className="row-main">
        <strong>🎤 {audio.name}</strong>
        {url && <audio controls preload="none" src={url} className="audio-player" />}
      </div>
      <div className="row-actions">
        <button type="button" className="link-btn danger-text" onClick={onDelete}>
          حذف
        </button>
      </div>
    </li>
  );
}
