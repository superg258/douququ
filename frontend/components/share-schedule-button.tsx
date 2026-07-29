"use client";

import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

export function ShareScheduleButton({
  buildUrl,
  title,
  className,
}: {
  buildUrl: () => string;
  title: string;
  className?: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  const [manualUrl, setManualUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const share = async () => {
    let url: string;
    try {
      url = buildUrl();
      if (navigator.share) {
        await navigator.share({ title, url });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        throw new Error("clipboard unavailable");
      }
      setManualUrl("");
      setStatus("copied");
      window.setTimeout(() => setStatus("idle"), 1800);
    } catch {
      try {
        url = buildUrl();
      } catch {
        return;
      }
      setManualUrl(url);
      setStatus("manual");
      window.setTimeout(() => inputRef.current?.select(), 0);
    }
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => void share()}
        title="复制可复现的语义视图；实时链接打开后会继续读取最新数据"
        className={cn(
          "min-h-10 border border-white/10 bg-rm-metal-dark/80 px-2.5 py-1.5 text-xs uppercase text-rm-metal-text transition-colors hover:border-rm-blue/50 hover:text-white md:min-h-0",
          className,
        )}
      >
        {status === "copied" ? "已复制" : "分享"}
      </button>
      {status === "manual" && manualUrl ? (
        <div className="fixed bottom-5 left-1/2 z-[220] w-[min(90vw,32rem)] -translate-x-1/2 border border-rm-status-warn/50 bg-black/95 p-3 shadow-2xl">
          <div className="mb-2 font-mono text-[10px] text-rm-status-warn">
            自动复制不可用，请手工复制链接
          </div>
          <input
            ref={inputRef}
            readOnly
            value={manualUrl}
            onFocus={(event) => event.currentTarget.select()}
            className="w-full border border-white/15 bg-rm-metal-dark px-2 py-2 font-mono text-[10px] text-white outline-none"
          />
          <button
            type="button"
            onClick={() => setStatus("idle")}
            className="mt-2 font-mono text-[10px] text-rm-metal-textMuted underline"
          >
            关闭
          </button>
        </div>
      ) : null}
    </div>
  );
}
