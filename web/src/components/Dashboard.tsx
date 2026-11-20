"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/client";
import { idbClearLedger } from "@/lib/idb";
import { can, ROLE_LABEL, type Me } from "@/lib/roles";
import { backupDue } from "@/lib/backup";
import { dueText, matchesClient, money, STATUS_LABEL } from "@/lib/format";
import { clientPhones, unpaidItems, type ClientSummary } from "@/lib/ledger";
import { displayDate, installmentText } from "@/lib/receipt";
import type { DueStatus } from "@/lib/sheet-logic";
import { ArchiveView } from "./ArchiveView";
import { EyeButton, shown, useHiddenAmount } from "./HideAmount";
import { BackupDialog } from "./BackupDialog";
import { UsersDialog } from "./UsersDialog";
import { DevResetDialog } from "./DevReset"; // DEV ONLY
import { CaisseView } from "./CaisseView";
import { ReportsView } from "./ReportsView";
import { SaleForm, type SaleDone } from "./SaleForm";
import { SaleTicketDialog } from "./SaleTicket";
import { StockView } from "./StockView";
import { RepairsView } from "./RepairsView";
import { NotesView } from "./NotesView";
import { reloadNewest } from "@/lib/app-version";
import { Modal } from "./Modal";
import { useNoteAlerts, useNoteReminders } from "./useNoteAlerts";
import { isOpenRequest } from "@/lib/notes";
import { ClaimsView, ServiceContactsDialog, useNow } from "./ClaimsView";
import { claimsByClient, isOpen as claimOpen, lateClaims } from "@/lib/claims";
import { ApprovalsBar, ApprovalsDialog } from "./ApprovalsView";
import { waitingByClient } from "@/lib/approvals";
import { ClientDetail } from "./ClientDetail";
import { InstallButton } from "./InstallButton";
import { NewClientForm } from "./ClientForms";
import { PaymentForm } from "./MoneyForms";
import { ReceiptDialog } from "./ReceiptDialog";
import { RemindersDialog } from "./RemindersDialog";
import { ReminderSettingsDialog } from "./ReminderSettings";
import { SetupScreen } from "./SetupScreen";
import { SyncBar } from "./SyncBar";
import { TopMenu } from "./TopMenu";
import { useLedger } from "./useLedger";
import { Confirm } from "./ui";

type Sort = "due" | "debt-desc" | "debt-asc" | "name" | "recent";
/** Where to search: people who owe (default, fastest), paid, everyone, or the archive. */
type Scope = "owing" | DueStatus | "paid-up" | "all" | "archive";

interface Filters {
  scope: Scope;
  from: string;
  to: string;
  minDebt: string;
  maxDebt: string;
  sort: Sort;
}

const DEFAULT_FILTERS: Filters = { scope: "owing", from: "", to: "", minDebt: "", maxDebt: "", sort: "due" };

const SCOPES: { value: Scope; label: string }[] = [
  { value: "owing", label: "عليهم الكريدي" },
  { value: "overdue", label: STATUS_LABEL.overdue },
  { value: "today", label: STATUS_LABEL.today },
  { value: "tomorrow", label: STATUS_LABEL.tomorrow },
  { value: "upcoming", label: STATUS_LABEL.upcoming },
  { value: "nodate", label: STATUS_LABEL.nodate },
  { value: "paid-up", label: "خالصين" },
  { value: "all", label: "الكل" },
  { value: "archive", label: "🗄️ الأرشيف" },
];

type Dialog =
  | { kind: "add" }
  | { kind: "client"; id: string }
  | { kind: "pay"; id: string }
  | { kind: "receipt"; id: string; paymentId?: string; notice?: string }
  | { kind: "remind" }
  | { kind: "archive-all" }
  | { kind: "backup"; reminder?: boolean }
  | { kind: "sale-ticket"; ticket: string }
  | { kind: "dev-reset" } // DEV ONLY
  | { kind: "users" }
  | { kind: "contacts" }
  | { kind: "approvals" }
  | { kind: "claims" }
  | { kind: "reminder-texts" }
  | null;

type View = "credit" | "sell" | "stock" | "repairs" | "budget" | "notes";
/** الميزانية holds the cash drawer and the reports. */
type BudgetTab = "caisse" | "reports";
const BUDGET_TABS: { value: BudgetTab; label: string }[] = [
  { value: "caisse", label: "💰 الصندوق" },
  { value: "reports", label: "📊 التقارير" },
];
const BUDGET_KEY = "budget-tab";
/** الإصلاح holds the devices repaired in the shop and the requests sent to the brands' services. */
type RepairTab = "repairs" | "claims";
const REPAIR_TABS: { value: RepairTab; label: string }[] = [
  { value: "repairs", label: "🔧 الإصلاح" },
  { value: "claims", label: "🏭 خدمة الشركة" },
];
const REPAIR_KEY = "repair-tab";

const VIEWS: { value: View; icon: string; label: string }[] = [
  { value: "credit", icon: "📒", label: "الكريدي" },
  { value: "sell", icon: "🛒", label: "البيع" },
  { value: "stock", icon: "📦", label: "المخزون" },
  { value: "repairs", icon: "🔧", label: "الإصلاح" },
  { value: "budget", icon: "💼", label: "الميزانية" },
  { value: "notes", icon: "📝", label: "الكناش" },
];
const VIEW_KEY = "view";

/** The sections this user can open. */
function viewsFor(me: Me | null): typeof VIEWS {
  if (!me) return VIEWS.filter((v) => v.value === "credit");
  // The notebook is for every account.
  if (me.role === "stock") return VIEWS.filter((v) => v.value === "stock" || v.value === "notes");
  return VIEWS.filter(
    (v) =>
      v.value === "credit" ||
      v.value === "notes" ||
      (v.value === "sell" && (can(me, "sell_cash") || can(me, "sell_credit"))) ||
      (v.value === "stock" && can(me, "stock")) ||
      (v.value === "repairs" && (can(me, "repairs") || can(me, "claims"))) ||
      (v.value === "budget" && (can(me, "caisse") || can(me, "reports"))),
  );
}

const MAX_CARDS = 200;

export function Dashboard() {
  const data = useLedger();
  const { summaries, today, online } = data;
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [view, setViewState] = useState<View>("credit");
  const phone = useIsPhone();
  const [hideDebt, toggleDebt] = useHiddenAmount("credit-total");

  const [budgetTab, setBudgetTabState] = useState<BudgetTab>("caisse");
  const [repairTab, setRepairTabState] = useState<RepairTab>("repairs");
  const now = useNow();

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(VIEW_KEY);
      // Saved before الميزانية existed: «الصندوق» / «التقارير» open in it.
      if (saved === "caisse" || saved === "reports") {
        setViewState("budget");
        setBudgetTabState(saved);
      } else if (saved && VIEWS.some((v) => v.value === saved)) setViewState(saved as View);
      const tab = sessionStorage.getItem(BUDGET_KEY);
      if (tab === "caisse" || tab === "reports") setBudgetTabState(tab);
      const rtab = sessionStorage.getItem(REPAIR_KEY);
      if (rtab === "repairs" || rtab === "claims") setRepairTabState(rtab);
    } catch {}
  }, []);

  function setBudgetTab(t: BudgetTab) {
    setBudgetTabState(t);
    try {
      sessionStorage.setItem(BUDGET_KEY, t);
    } catch {}
  }

  function setRepairTab(t: RepairTab) {
    setRepairTabState(t);
    try {
      sessionStorage.setItem(REPAIR_KEY, t);
    } catch {}
  }

  const me = data.me;
  // Sellers' credit changes still waiting for the owner, per customer (⏳ on the list).
  const waiting = useMemo(() => (data.ledger ? waitingByClient(data.ledger) : new Map<string, unknown[]>()), [data.ledger]);
  // Requests to the brands' services still open 48 h after the last message (none for accounts without the service).
  const lateCount = lateClaims(data.ledger?.claims ?? [], now).length;
  // After-sales requests in الكريدي: a card like «متأخرين», and a badge on each customer concerned.
  const openClaims = (data.ledger?.claims ?? []).filter(claimOpen).length;
  const claimsPerClient = useMemo(() => claimsByClient(data.ledger?.clients ?? [], data.ledger?.claims ?? [], now), [data.ledger, now]);
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
    if (done.type === "كاش") {
      setToast(`تسجل البيع${online ? "" : " · محفوظ فالتيليفون"}`);
      setDialog({ kind: "sale-ticket", ticket: done.ticket });
    } else if (done.clientId && done.paymentId) {
      setDialog({ kind: "receipt", id: done.clientId, paymentId: done.paymentId, notice: "تسجل البيع بالكريدي والتسبيق" });
    } else if (done.clientId) {
      setToast("تسجل البيع بالكريدي");
      setDialog({ kind: "client", id: done.clientId });
    }
  }
  const [toast, setToast] = useState("");
  const [archiving, setArchiving] = useState(false);

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

  const visible = useMemo(() => {
    const f = filters;
    const min = f.minDebt ? Number(f.minDebt) : -Infinity;
    const max = f.maxDebt ? Number(f.maxDebt) : Infinity;
    // Narrow by scope first: by default only people who owe money are searched.
    const list = summaries.filter((s) => {
      if (f.scope === "owing" && s.remaining <= 0) return false;
      if (f.scope === "paid-up" && s.remaining > 0) return false;
      if (!["owing", "paid-up", "all", "archive"].includes(f.scope) && s.status !== f.scope) return false;
      if (!matchesClient(s.client.name, clientPhones(s.client), query)) return false;
      if (f.from && (!s.client.nextDueDate || s.client.nextDueDate < f.from)) return false;
      if (f.to && (!s.client.nextDueDate || s.client.nextDueDate > f.to)) return false;
      if (s.remaining < min || s.remaining > max) return false;
      return true;
    });
    const due = (s: ClientSummary) => (s.remaining > 0 && s.client.nextDueDate) || "9999";
    const sorters: Record<Sort, (a: ClientSummary, b: ClientSummary) => number> = {
      due: (a, b) => due(a).localeCompare(due(b)),
      "debt-desc": (a, b) => b.remaining - a.remaining,
      "debt-asc": (a, b) => a.remaining - b.remaining,
      name: (a, b) => a.client.name.localeCompare(b.client.name, "ar"),
      recent: (a, b) => b.lastActivity.localeCompare(a.lastActivity),
    };
    return list.sort(sorters[f.sort]);
  }, [summaries, query, filters]);

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

  const summary = useMemo(() => {
    const owing = summaries.filter((s) => s.remaining > 0);
    const overdue = owing.filter((s) => s.status === "overdue");
    return {
      totalDebt: owing.reduce((t, s) => t + s.remaining, 0),
      owing: owing.length,
      overdue: overdue.length,
      overdueDebt: overdue.reduce((t, s) => t + s.remaining, 0),
      dueSoon: owing.filter((s) => s.status === "today" || s.status === "tomorrow").length,
      archivable: summaries.filter((s) => s.archivable),
    };
  }, [summaries]);

  if (data.needsSetup) return <SetupScreen onDone={() => void data.refresh()} />;

  const savedNote = online ? "" : " · محفوظ فالتيليفون";
  // Only the bulk sending through WATI needs this; reminding one by one works offline.
  const reminderBlocked = !online ? "خاصو الأنترنيت" : data.pendingCount > 0 || data.syncing ? "تسنى حتى تتزامن التعديلات" : "";
  const archiveBlocked = !online || data.pendingCount > 0 || data.syncing;
  const activeFilterCount = [filters.from, filters.to, filters.minDebt, filters.maxDebt].filter(Boolean).length;
  const find = (id: string) => summaries.find((s) => s.client.id === id);

  async function archiveAll() {
    setDialog(null);
    setArchiving(true);
    try {
      const { archived } = await apiFetch<{ archived: number }>("/api/archive", { method: "POST", body: {} });
      await data.refresh();
      setToast(`تأرشفو ${archived} زبون`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ⚡
          </span>
          <div>
            <h1>ELECTRO-LMESTOUR</h1>
            <p className="muted">كريدي الزبناء</p>
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
            onContacts={allow("claims") && data.ledger ? () => setDialog({ kind: "contacts" }) : undefined}
            onReminderTexts={allow("reminders") && data.ledger ? () => setDialog({ kind: "reminder-texts" }) : undefined}
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
              {v.value === "repairs" && lateCount > 0 && <bdi className="tab-count" title="طلبات خدمة الشركة لي فاتو 48 ساعة">{lateCount}</bdi>}
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

        {current !== "credit" && !data.ledger && !data.loadError && <p className="muted center">كنجيبو المعلومات من الـ Google Sheet…</p>}
        {current !== "credit" && data.loadError && !data.ledger && <p className="alert error">{data.loadError}</p>}
        {current === "sell" && data.ledger && (
          <section className="sell-view" aria-label="البيع">
            <SaleForm data={data} onDone={saleDone} />
          </section>
        )}
        {current === "stock" && data.ledger && <StockView data={data} onToast={setToast} />}
        {current === "notes" && data.ledger && <NotesView data={data} onToast={setToast} alerts={noteAlerts} />}
        {current === "repairs" && data.ledger && (() => {
          // Only the parts of الإصلاح this account may open.
          const tabs = REPAIR_TABS.filter((b) => allow(b.value));
          const tab = tabs.some((b) => b.value === repairTab) ? repairTab : tabs[0].value;
          return (
            <>
              {tabs.length > 1 && (
                <div className="segmented wide-seg budget-tabs" role="tablist" aria-label="الإصلاح">
                  {tabs.map((b) => (
                    <button key={b.value} type="button" role="tab" aria-selected={tab === b.value} className={tab === b.value ? "on" : ""} onClick={() => setRepairTab(b.value)}>
                      {b.label}
                      {b.value === "claims" && lateCount > 0 && <bdi className="tab-count">{lateCount}</bdi>}
                    </button>
                  ))}
                </div>
              )}
              {tab === "repairs" ? <RepairsView data={data} onToast={setToast} /> : <ClaimsView data={data} onToast={setToast} />}
            </>
          );
        })()}
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

        {current === "credit" && (
        <>

        <section
          className={`summary ${allow("claims") ? (me?.role === "owner" ? "four" : "trio") : ""}`}
          aria-label="ملخص"
        >
          {me?.role === "owner" && (
            <div className="stat">
              <span className="stat-label">
                مجموع الكريدي <EyeButton hidden={hideDebt} onToggle={toggleDebt} what="مجموع الكريدي" />
              </span>
              <span className="stat-value">{shown(hideDebt, money(summary.totalDebt))}</span>
              <span className="stat-sub">{summary.owing} زبون</span>
            </div>
          )}
          <div className="stat alert-stat">
            <span className="stat-label">متأخرين</span>
            <span className="stat-value">{summary.overdue}</span>
            <span className="stat-sub">{money(summary.overdueDebt)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">اليوم وغداً</span>
            <span className="stat-value">{summary.dueSoon}</span>
            <span className="stat-sub">خاصهم يخلصو</span>
          </div>
          {allow("claims") && (
            <button
              type="button"
              className={`stat claim-stat ${lateCount ? "alert-stat late" : ""}`}
              onClick={() => setDialog({ kind: "claims" })}
              aria-label={`خدمة الشركة: ${lateCount} معطلين، ${openClaims} مفتوحين`}
            >
              <span className="stat-label">{lateCount ? "⏰ عند الشركة" : "🏭 خدمة الشركة"}</span>
              <span className="stat-value">{lateCount || openClaims}</span>
              <span className="stat-sub">{lateCount ? `فاتو 48 ساعة · ${openClaims} مفتوحين` : openClaims ? "طلب مفتوح" : "ما كاين والو"}</span>
            </button>
          )}
        </section>
        {lateCount > 0 && allow("claims") && (
          <button type="button" className="claims-late-bar" onClick={() => setDialog({ kind: "claims" })}>
            <span>
              ⏰ <strong>{lateCount}</strong> {lateCount === 1 ? "طلب" : "طلبات"} عند الشركات فاتو 48 ساعة بلا حل. ذكّرهم باش يتصلو بالزبناء.
            </span>
            <span className="approvals-go">شوف ←</span>
          </button>
        )}

        <ApprovalsBar data={data} onOpen={() => setDialog({ kind: "approvals" })} />

        {/* On a phone this row sits fixed at the bottom of the screen, under the thumb. */}
        <div className="actions-row">
          {allow("client_add") && (
            <button type="button" className="btn primary" onClick={() => setDialog({ kind: "add" })}>
              + زبون جديد
            </button>
          )}
          {allow("reminders") && (
          <button
            type="button"
            className="btn whatsapp"
            onClick={() => setDialog({ kind: "remind" })}
          >
            تذكير المتأخرين
            {summary.overdue > 0 && <span className="badge">{summary.overdue}</span>}
          </button>
          )}
        </div>
        {summary.archivable.length > 0 && allow("client_delete") && (
          <div className="archive-banner">
            <p>
              <strong>{summary.archivable.length}</strong> زبون خلصو كلشي من أكثر من 3 شهور.
            </p>
            <button type="button" className="btn small-btn" onClick={() => setDialog({ kind: "archive-all" })} disabled={archiveBlocked || archiving}>
              {archiving ? "كنأرشفو…" : "أرشفهم"}
            </button>
          </div>
        )}

        <div className="search-row">
          <label className="visually-hidden" htmlFor="search">
            قلب بالاسم ولا بالتيليفون
          </label>
          <input
            id="search"
            type="search"
            className="search"
            placeholder={filters.scope === "archive" ? "قلب فالأرشيف بالاسم ولا بالتيليفون…" : "قلب بالاسم ولا بالتيليفون…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {filters.scope !== "archive" && (
            <button type="button" className={`btn ${showFilters ? "selected" : ""}`} aria-expanded={showFilters} aria-controls="filters" onClick={() => setShowFilters((x) => !x)}>
              فلتر{activeFilterCount ? ` (${activeFilterCount})` : ""}
            </button>
          )}
        </div>

        <div className="chips" role="group" aria-label="فين تقلب">
          {SCOPES.map((chip) => (
            <button
              key={chip.value}
              type="button"
              className={`chip ${filters.scope === chip.value ? "on" : ""}`}
              aria-pressed={filters.scope === chip.value}
              onClick={() => setFilters((f) => ({ ...f, scope: chip.value }))}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {showFilters && filters.scope !== "archive" && (
          <section id="filters" className="filters" aria-label="فلتر">
            <fieldset>
              <legend>تاريخ الدفعة المقبلة</legend>
              <div className="filter-pair">
                <label>
                  من
                  <input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
                </label>
                <label>
                  حتى
                  <input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
                </label>
              </div>
            </fieldset>
            <fieldset>
              <legend>المتبقي (درهم)</legend>
              <div className="filter-pair">
                <label>
                  من
                  <input
                    inputMode="decimal"
                    dir="ltr"
                    value={filters.minDebt}
                    onChange={(e) => setFilters((f) => ({ ...f, minDebt: e.target.value.replace(/[^\d.]/g, "") }))}
                  />
                </label>
                <label>
                  حتى
                  <input
                    inputMode="decimal"
                    dir="ltr"
                    value={filters.maxDebt}
                    onChange={(e) => setFilters((f) => ({ ...f, maxDebt: e.target.value.replace(/[^\d.]/g, "") }))}
                  />
                </label>
              </div>
            </fieldset>
            <fieldset>
              <legend>الترتيب</legend>
              <select value={filters.sort} onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as Sort }))} aria-label="الترتيب">
                <option value="due">الدفعة المقبلة (الأقرب)</option>
                <option value="debt-desc">المتبقي (الأكبر)</option>
                <option value="debt-asc">المتبقي (الأصغر)</option>
                <option value="recent">آخر حركة</option>
                <option value="name">الاسم</option>
              </select>
            </fieldset>
            <button type="button" className="btn ghost" onClick={() => setFilters({ ...DEFAULT_FILTERS, scope: filters.scope })}>
              مسح الفلتر
            </button>
          </section>
        )}

        {filters.scope === "archive" ? (
          <ArchiveView data={data} query={query} onToast={setToast} />
        ) : (
          <>
            {data.loadError && (
              <div className="alert error" role="alert">
                <p>{data.loadError}</p>
                <button type="button" className="btn" onClick={() => void data.refresh()}>
                  عاود
                </button>
              </div>
            )}
            {!data.ledger && !data.loadError && <p className="muted center">كنجيبو الزبناء من الـ Google Sheet…</p>}
            {data.ledger && (
              <>
                <p className="result-count muted" aria-live="polite">
                  {visible.length} زبون
                </p>
                {visible.length === 0 ? (
                  <p className="empty">{query ? "ما لقينا حتى زبون بهاد البحث هنا. جرب «الكل» ولا «الأرشيف»." : "ما كاين حتى زبون هنا."}</p>
                ) : (
                  <ul className={phone ? "client-rows" : "cards"}>
                    {visible.slice(0, MAX_CARDS).map((s) => {
                      const Item = phone ? ClientRow : ClientCard;
                      return (
                        <Item
                          key={s.client.id}
                          s={s}
                          today={today}
                          waiting={waiting.get(s.client.id)?.length ?? 0}
                          claims={allow("claims") ? claimsPerClient.get(s.client.id) : undefined}
                          onOpen={() => setDialog({ kind: "client", id: s.client.id })}
                          onPay={allow("payment") ? () => setDialog({ kind: "pay", id: s.client.id }) : undefined}
                        />
                      );
                    })}
                  </ul>
                )}
                {visible.length > MAX_CARDS && <p className="muted center small">كيبانو غير {MAX_CARDS} الأولين. قلب بالاسم باش تلقا الباقي.</p>}
              </>
            )}
          </>
        )}
        </>
        )}
      </main>

      {dialog?.kind === "add" && (
        <NewClientForm
          data={data}
          onClose={() => setDialog(null)}
          onDone={(id, paymentId) => {
            setToast(`تزاد الزبون${savedNote}`);
            setDialog(paymentId ? { kind: "receipt", id, paymentId, notice: "تسجل الزبون والتسبيق" } : { kind: "client", id });
          }}
        />
      )}
      {dialog?.kind === "client" && <ClientDetail data={data} clientId={dialog.id} onClose={() => setDialog(null)} onToast={setToast} />}
      {dialog?.kind === "pay" && find(dialog.id) && (
        <PaymentForm
          data={data}
          summary={find(dialog.id)!}
          onClose={() => setDialog(null)}
          onDone={(paymentId) => setDialog({ kind: "receipt", id: dialog.id, paymentId, notice: `تسجلات الدفعة${savedNote}` })}
        />
      )}
      {dialog?.kind === "receipt" && find(dialog.id) && (
        <ReceiptDialog summary={find(dialog.id)!} mode="payment" paymentId={dialog.paymentId} notice={dialog.notice} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "sale-ticket" && data.ledger && (
        <SaleTicketDialog lines={data.ledger.sales.filter((x) => x.ticket === dialog.ticket)} notice="تسجل البيع ✓" onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "reminder-texts" && data.ledger && <ReminderSettingsDialog data={data} onClose={() => setDialog(null)} onToast={setToast} />}
      {dialog?.kind === "claims" && data.ledger && (
        <Modal title="🏭 خدمة الشركة" className="page" onClose={() => setDialog(null)}>
          <ClaimsView data={data} onToast={setToast} initialFilter={lateCount ? "late" : "open"} />
        </Modal>
      )}
      {dialog?.kind === "approvals" && data.ledger && <ApprovalsDialog data={data} onClose={() => setDialog(null)} onToast={setToast} />}
      {dialog?.kind === "contacts" && data.ledger && <ServiceContactsDialog data={data} onClose={() => setDialog(null)} onToast={setToast} />}
      {dialog?.kind === "users" && <UsersDialog onClose={() => setDialog(null)} onToast={setToast} />}
      {/* DEV ONLY */}
      {dialog?.kind === "dev-reset" && <DevResetDialog data={data} onClose={() => setDialog(null)} onToast={setToast} />}
      {dialog?.kind === "backup" && (
        <BackupDialog reminder={dialog.reminder} pending={data.pendingCount} onClose={() => setDialog(null)} onToast={setToast} />
      )}
      {dialog?.kind === "remind" && data.ledger && <RemindersDialog data={data} bulkBlocked={reminderBlocked} onClose={() => setDialog(null)} onToast={setToast} />}
      {dialog?.kind === "archive-all" && (
        <Confirm title="أرشفة الخالصين" confirmLabel={`أرشف ${summary.archivable.length}`} onClose={() => setDialog(null)} onConfirm={() => void archiveAll()}>
          <p className="lead">هاد الزبناء خلصو كلشي من أكثر من 3 شهور، غادي يتنقلو للأرشيف مع المشتريات والدفعات ديالهم:</p>
          <ul className="plain-list">
            {summary.archivable.slice(0, 15).map((s) => (
              <li key={s.client.id}>
                {s.client.name} <span className="muted small">· آخر حركة {displayDate(s.lastActivity)}</span>
              </li>
            ))}
            {summary.archivable.length > 15 && <li className="muted">و {summary.archivable.length - 15} آخرين…</li>}
          </ul>
          <p className="muted small">تقدر تلقاهم فـ «🗄️ الأرشيف» وترجعهم إلا شراو من جديد.</p>
        </Confirm>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

/** Phone width: the customer list is compact lines instead of cards. */
const PHONE_QUERY = "(max-width: 639px)";
function subscribePhone(cb: () => void) {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function useIsPhone(): boolean {
  return useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => false);
}

/**
 * One customer as a line (phones): initial coloured by status, name, when the
 * next payment is due and what is still being paid, the amount owed, and a
 * quick «payment» button. Tap the line for the account.
 */
/** «⏰ الشركة» (late) or «🏭» (open) after a customer's name: their requests at the brands' services. */
function ClaimFlag({ claims, short }: { claims?: { open: number; late: number }; short?: boolean }) {
  if (!claims?.open) return null;
  return claims.late ? (
    <span className="claim-flag late row-claim" title={`${claims.late} طلب عند الشركة فات 48 ساعة`} aria-label="طلب عند الشركة فات 48 ساعة">
      {short ? "⏰" : "⏰ الشركة"}
    </span>
  ) : (
    <span className="claim-flag row-claim" title={`${claims.open} طلب مفتوح عند الشركة`}>
      🏭
    </span>
  );
}

function ClientRow({ s, today, waiting, claims, onOpen, onPay }: { s: ClientSummary; today: string; waiting: number; claims?: { open: number; late: number }; onOpen: () => void; onPay?: () => void }) {
  const c = s.client;
  const owes = s.remaining > 0;
  const unpaid = unpaidItems(s);
  const due = owes ? (c.nextDueDate ? dueText(c.nextDueDate, s.status, today) : STATUS_LABEL.nodate) : STATUS_LABEL.paid;
  return (
    <li className={`client-row status-${s.status}`}>
      <button type="button" className="client-row-open" onClick={onOpen} aria-label={`حساب ${c.name}`}>
        <span className="avatar" aria-hidden="true">
          {initial(c.name)}
        </span>
        <span className="row-main">
          <span className="row-name">
            {c.name}
            {c.type === 1 && <span className="special-star" title="زبون خاص">⭐</span>}
            {waiting > 0 && <span className="pending-dot" title={`${waiting} تعديل كيتسنى موافقة المالك`}>⏳</span>}
            <ClaimFlag claims={claims} short />
          </span>
          <span className="row-sub">
            <span className="row-due">{due}</span>
            {unpaid.length > 0 && (
              <>
                <span aria-hidden="true">·</span>
                {/* Its own direction, so a long Latin name is cut at its end. */}
                <span className="row-item" dir="auto">
                  {unpaid[0]}
                </span>
                {unpaid.length > 1 && (
                  <bdi dir="ltr" className="row-more">
                    +{unpaid.length - 1}
                  </bdi>
                )}
              </>
            )}
          </span>
        </span>
        <span className="row-amount">
          <span className="row-remaining">{owes ? money(s.remaining) : "✓ خالص"}</span>
          {owes && c.nextDueDate && <bdi dir="ltr" className="row-date">{displayDate(c.nextDueDate)}</bdi>}
        </span>
      </button>
      {onPay && owes && (
        <button type="button" className="row-pay" onClick={onPay} aria-label={`دفعة ديال ${c.name}`} title="دفعة">
          💰
        </button>
      )}
    </li>
  );
}

/** The first letter of a name, for the round avatar. */
function initial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "؟";
}

function ClientCard({ s, today, waiting, claims, onOpen, onPay }: { s: ClientSummary; today: string; waiting: number; claims?: { open: number; late: number }; onOpen: () => void; onPay?: () => void }) {
  const c = s.client;
  const unpaid = unpaidItems(s);
  return (
    <li className={`card status-${s.status}`}>
      <button type="button" className="card-open" onClick={onOpen} aria-label={`حساب ${c.name}`}>
        <div className="card-top">
          <div className="card-who">
            <h3>
              {c.name}
              {c.type === 1 && <span className="special-star" title="زبون خاص">⭐</span>}
              {waiting > 0 && <span className="pending-dot" title={`${waiting} تعديل كيتسنى موافقة المالك`}>⏳</span>}
              <ClaimFlag claims={claims} />
            </h3>
            {c.phone && (
              <span className="phone" dir="ltr">
                {c.phone}
                {c.phones?.length ? <span className="muted small"> <bdi dir="ltr">+{c.phones.length}</bdi></span> : null}
              </span>
            )}
          </div>
          <span className={`pill ${s.status}`}>{STATUS_LABEL[s.status]}</span>
        </div>
        <p className="items">
          {s.purchases.length} {s.purchases.length === 1 ? "سلعة" : "سلع"}
          {unpaid.length > 0 && ` · باقي: ${unpaid.join("، ")}`}
        </p>
        <div className="card-money">
          <div>
            <span className="label">المتبقي</span>
            <span className="remaining">{s.remaining > 0 ? money(s.remaining) : "خالص"}</span>
          </div>
          <div className="card-due">
            <span className="label">الدفعة المقبلة</span>
            <span>{s.remaining > 0 && c.nextDueDate ? displayDate(c.nextDueDate) : "—"}</span>
            {s.remaining > 0 && <span className="muted small">{dueText(c.nextDueDate, s.status, today)}</span>}
          </div>
        </div>
        {s.remaining > 0 && installmentText(s) && <p className="muted small">الطريطة: {installmentText(s)}</p>}
      </button>
      <div className="card-actions two">
        {onPay && (
        <button type="button" className="btn primary" onClick={onPay} disabled={!s.purchases.length}>
          دفعة
        </button>
        )}
        <button type="button" className="btn" onClick={onOpen}>
          الحساب
        </button>
      </div>
    </li>
  );
}
