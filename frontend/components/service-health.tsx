"use client";

import { useCallback, useEffect, useState } from "react";

import { getOverview } from "@/lib/api";

type HealthState = "checking" | "online" | "offline";

export function ServiceHealth() {
  const [state, setState] = useState<HealthState>("checking");

  const check = useCallback(() => {
    setState("checking");
    getOverview()
      .then(() => setState("online"))
      .catch(() => setState("offline"));
  }, []);

  useEffect(() => {
    check();
    const handleVisibility = () => {
      if (!document.hidden) check();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [check]);

  const label = state === "online" ? "数据接口已连接" : state === "offline" ? "数据接口中断" : "正在检查数据接口";
  const tone = state === "online" ? "text-rm-status-safe" : state === "offline" ? "text-rm-red" : "text-rm-status-warn";

  return (
    <span role="status" aria-live="polite" className={`hidden md:inline-flex ml-3 items-center gap-1.5 text-[10px] tracking-normal ${tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full bg-current ${state === "checking" ? "animate-pulse" : ""}`} aria-hidden="true" />
      {label}
    </span>
  );
}
