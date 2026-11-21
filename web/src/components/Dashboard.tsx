"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { idbClearLedger } from "@/lib/idb";
import { can, type Me } from "@/lib/roles";
import { backupDue } from "@/lib/backup";
import { BackupDialog } from "./BackupDialog";
import { UsersDialog } from "./UsersDialog";
import { DevResetDialog } from "./DevReset"; // DEV ONLY
import { CaisseView } from "./CaisseView";
import { ReportsView } from "./ReportsView";
import { SaleForm, type SaleDone } from "./SaleForm";
import { SaleTicketDialog } from "./SaleTicket";
import { StockView } from "./StockView";
import { NotesView } from "./NotesView";
import { reloadNewest } from "@/lib/app-version";
import { useNoteAlerts, useNoteReminders } from "./useNoteAlerts";
import { isOpenRequest } from "@/lib/notes";
import { useNow } from "./useNow";
import { ApprovalRulesDialog, ApprovalsBar, ApprovalsDialog } from "./ApprovalsView";
import { InstallButton } from "./InstallButton";
import { SetupScreen } from "./SetupScreen";
import { SyncBar } from "./SyncBar";
import { TopMenu } from "./TopMenu";
import { useLedger } from "./useLedger";

type Dialog =
  | { kind: "backup"; reminder?: boolean }
  | { kind: "sale-ticket"; ticket: string }
  | { kind: "dev-reset" } // DEV ONLY
  | { kind: "users" }
  | { kind: "approvals" }
  | { kind: "approval-rules" }
  | null;

type View = "sell" | "stock" | "budget" | "notes";
/** الميزانية holds the cash drawer and the reports. */
type BudgetTab = "caisse" | "reports";
const BUDGET_TABS: { value: BudgetTab; label: string }[] = [
  { value: "caisse", label: "💰 الصندوق" },
  { value: "reports", label: "📊 التقارير" },
];
const BUDGET_KEY = "budget-tab";

const VIEWS: { value: View; icon: string; label: string }[] = [
  { value: "sell", icon: "🛒", label: "البيع" },
  { value: "stock", icon: "📦", label: "المخزون" },
  { value: "budget", icon: "💼", label: "الميزانية" },
  { value: "notes", icon: "📝", label: "الكناش" },
];
const VIEW_KEY = "view";

/** The sections this user can open (the notebook is for every account). */
function viewsFor(me: Me | null): typeof VIEWS {
  if (!me) return VIEWS.filter((v) => v.value === "notes");
  if (me.role === "stock") return VIEWS.filter((v) => v.value === "stock" || v.value === "notes");
  return VIEWS.filter(
    (v) =>
      v.value === "notes" ||
      (v.value === "sell" && can(me, "sell_cash")) ||
      (v.value === "stock" && can(me, "stock")) ||
      (v.value === "budget" && (can(me, "caisse") || can(me, "reports"))),
  );
}

export function Dashboard() {
  const data = useLedger();
  const { online } = data;
  const [dialog, setDialog] = useState<Dialog>(null);
  const [view, setViewState] = useState<View>("sell");
  const [budgetTab, setBudgetTabState] = useState<BudgetTab>("caisse");
  const now = useNow();

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(VIEW_KEY);
      if (saved && VIEWS.some((v) => v.value === saved)) setViewState(saved as View);
      const tab = sessionStorage.getItem(BUDGET_KEY);
      if (tab === "caisse" || tab === "reports") setBudgetTabState(tab);
    } catch {}
  }, []);

  function setBudgetTab(t: BudgetTab) {
    setBudgetTabState(t);
    try {
      sessionStorage.setItem(BUDGET_KEY, t);
    } catch {}
  }

  const me = data.me;
  // Customers' requests in the notebook not done yet.
  const openNotes = (data.ledger?.notes ?? []).filter(isOpenRequest).length;
  const allow = (p: Parameters<typeof can>[1]) => can(me, p);
  const views = viewsFor(me);
  // A section this user can't open (e.g. remembered from another account) falls back to the first allowed one.
  const current: View = views.some((v) => v.value === view) ? view : views[0].value;

  function setView(v: View) {
    setViewState(v);
    window.scrollTo({ top: 0 });
    try {
      sessionStorage.setItem(VIEW_KEY, v);
    } catch {}
  }

  function saleDone(done: SaleDone) {
    setToast(`تسجل البيع${online ? "" : " · محفوظ فالتيليفون"}`);
    setDialog({ kind: "sale-ticket", ticket: done.ticket });
  }
  const [toast, setToast] = useState("");

  // The notebook as notifications (what others wrote / ticked / changed).
  const noteAlerts = useNoteAlerts(data, setToast, current === "notes");
  const unreadNotes = noteAlerts.events.length;
  // Notebook reminders whose time has come (⏰): a red bar on every tab and the tab's count.
  const dueNotes = useNoteReminders(data, now, setToast, current === "notes");

  // A notebook notification tapped (service worker message, or the app opened from it).
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "open-view" && VIEWS.some((v) => v.value === e.data.view)) setView(e.data.view);
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    try {
      const asked = new URLSearchParams(window.location.search).get("view");
      if (asked && VIEWS.some((v) => v.value === asked)) {
        setView(asked as View);
        window.history.replaceState(null, "", window.location.pathname);
      }
    } catch {}
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Every 24 hours, ask to send the Excel backup on WhatsApp. Checked when the
  // app opens, after each window closes, and every 10 minutes while it stays open.
  const ready = Boolean(data.ledger) && online;
  useEffect(() => {
    if (!ready || dialog) return;
    const check = () => {
      if (can(data.me, "backup") && backupDue()) setDialog({ kind: "backup", reminder: true });
    };
    check();
    const timer = setInterval(check, 10 * 60 * 1000);
    return () => clearInterval(timer);
  }, [ready, dialog]);

  if (data.needsSetup) return <SetupScreen onDone={() => void data.refresh()} />;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ⚡
          </span>
          <div>
            <h1>Shop manager</h1>
            <p className="muted">البيع والمخزون</p>
          </div>
        </div>
        <div className="topbar-actions">
          <InstallButton />
          <button type="button" className="btn ghost" onClick={() => void data.refresh()} disabled={!online || data.syncing} aria-label="حدّث من الـ Google Sheet">
            {data.syncing ? "…" : "↻"}
          </button>
          <TopMenu
            online={online}
            devReset={data.devReset}
            onDevReset={() => setDialog({ kind: "dev-reset" })}
            onToast={setToast}
            onSendBackup={() => setDialog({ kind: "backup" })}
            me={me}
            canBackup={allow("backup")}
            onUsers={allow("owner_only") ? () => setDialog({ kind: "users" }) : undefined}
            onApprovalRules={allow("owner_only") && data.ledger ? () => setDialog({ kind: "approval-rules" }) : undefined}
            onLogout={async () => {
              // Changes not sent yet belong to this user: they must reach the sheet before someone else logs in.
              if (data.pendingCount > 0) {
                window.alert(`تسنى حتى يتزامنو ${data.pendingCount} تعديل قبل ما تخرج.`);
                return;
              }
              await apiFetch("/api/logout", { method: "POST" }).catch(() => {});
              await idbClearLedger();
              window.location.href = "/login";
            }}
          />
        </div>
      </header>

      {/* One section only (the stock manager): no need for the bar. */}
      {views.length > 1 && (
      <nav className="views" aria-label="الأقسام">
        {views.map((v) => (
          <button key={v.value} type="button" className={current === v.value ? "on" : ""} aria-current={current === v.value ? "page" : undefined} onClick={() => setView(v.value)}>
            <span aria-hidden="true">{v.icon}</span>
            <span>
              {v.label}
              {v.value === "notes" &&
                (dueNotes.length > 0 ? (
                  <bdi className="tab-count" title="تذكيرات جا الوقت ديالهم">{dueNotes.length}</bdi>
                ) : unreadNotes > 0 ? (
                  <bdi className="tab-count note-unread" title="جديد فالكناش">{unreadNotes}</bdi>
                ) : (
                  openNotes > 0 && <bdi className="tab-count note-count" title="طلبات الزبناء لي باقي ما تداروش">{openNotes}</bdi>
                ))}
            </span>
          </button>
        ))}
      </nav>
      )}

      <main className="content">
        {/* A newer build is online: reload on a tap (not by itself: a cart or a form may be half filled). */}
        {data.updateReady && (
          <div className="update-bar" role="status">
            <span>🔄 كاينة نسخة جديدة ديال التطبيق.</span>
            <button type="button" className="btn primary small-btn" onClick={() => void reloadNewest()}>
              حدّث دابا
            </button>
          </div>
        )}
        {dueNotes.length > 0 && current !== "notes" && (
          <button type="button" className="remind-due-bar" onClick={() => setView("notes")}>
            <span>
              ⏰ <strong>{dueNotes.length}</strong> {dueNotes.length === 1 ? "تذكير" : "تذكيرات"} فالكناش: «{dueNotes[0].text.length > 60 ? `${dueNotes[0].text.slice(0, 60)}…` : dueNotes[0].text}»
              {dueNotes[0].customer && ` · 👤 ${dueNotes[0].customer}`}
            </span>
            <span className="approvals-go">شوف ←</span>
          </button>
        )}
        <SyncBar state={data} />

        {!data.ledger && !data.loadError && <p className="muted center">كنجيبو المعلومات من الـ Google Sheet…</p>}
        {data.loadError && !data.ledger && (
          <div className="alert error" role="alert">
            <p>{data.loadError}</p>
            <button type="button" className="btn" onClick={() => void data.refresh()}>
              عاود
            </button>
          </div>
        )}
        {/* Sellers' changes waiting for the owner: on the screens where they are made. */}
        {(current === "sell" || current === "stock") && <ApprovalsBar data={data} onOpen={() => setDialog({ kind: "approvals" })} />}
        {current === "sell" && data.ledger && (
          <section className="sell-view" aria-label="البيع">
            <SaleForm data={data} onDone={saleDone} />
          </section>
        )}
        {current === "stock" && data.ledger && <StockView data={data} onToast={setToast} />}
        {current === "notes" && data.ledger && <NotesView data={data} onToast={setToast} alerts={noteAlerts} />}
        {current === "budget" && data.ledger && (() => {
          // Only the parts of الميزانية this account may open.
          const tabs = BUDGET_TABS.filter((b) => allow(b.value));
          const tab = tabs.some((b) => b.value === budgetTab) ? budgetTab : tabs[0].value;
          return (
            <>
              {tabs.length > 1 && (
                <div className="segmented wide-seg budget-tabs" role="tablist" aria-label="الميزانية">
                  {tabs.map((b) => (
                    <button key={b.value} type="button" role="tab" aria-selected={tab === b.value} className={tab === b.value ? "on" : ""} onClick={() => setBudgetTab(b.value)}>
                      {b.label}
                    </button>
                  ))}
                </div>
              )}
              {tab === "caisse" ? <CaisseView data={data} onToast={setToast} /> : <ReportsView data={data} onToast={setToast} />}
            </>
          );
        })()}

      </main>

      {dialog?.kind === "sale-ticket" && data.ledger && (
        <SaleTicketDialog lines={data.ledger.sales.filter((x) => x.ticket === dialog.ticket)} notice="تسجل البيع ✓" onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "approvals" && data.ledger && <ApprovalsDialog data={data} onClose={() => setDialog(null)} onToast={setToast} />}
      {dialog?.kind === "approval-rules" && data.ledger && <ApprovalRulesDialog data={data} onClose={() => setDialog(null)} onToast={setToast} />}
      {dialog?.kind === "users" && <UsersDialog onClose={() => setDialog(null)} onToast={setToast} />}
      {/* DEV ONLY */}
      {dialog?.kind === "dev-reset" && <DevResetDialog data={data} onClose={() => setDialog(null)} onToast={setToast} />}
      {dialog?.kind === "backup" && (
        <BackupDialog reminder={dialog.reminder} pending={data.pendingCount} onClose={() => setDialog(null)} onToast={setToast} />
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
