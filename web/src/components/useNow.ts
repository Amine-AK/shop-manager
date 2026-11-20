"use client";

import { useEffect, useState } from "react";

/** The current time, refreshed every minute (for «late» / «due» marks). */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}
