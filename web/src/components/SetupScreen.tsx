"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/client";

/** First run on an empty Google Sheet: create the app's tabs. */
export function SetupScreen({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    try {
      await apiFetch("/api/setup", { method: "POST", body: { confirm: true } });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <div className="login-card setup-card">
        <span className="brand-mark big" aria-hidden="true">
          🏪
        </span>
        <h1>نوجدو الـ Google Sheet</h1>
        <p>
          غادي نزيدو الأوراق ديال التطبيق: <strong>المخزون</strong>، <strong>الفئات</strong>، <strong>المبيعات</strong>، <strong>الصندوق اليومي</strong>،
          <strong> الكناش</strong>…
        </p>
        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="btn primary block" onClick={run} disabled={busy}>
          {busy ? "كنوجدو…" : "وجد الأوراق ودخل"}
        </button>
      </div>
    </main>
  );
}
