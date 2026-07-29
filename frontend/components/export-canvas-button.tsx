"use client";

import { useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8001";

export function ExportCanvasButton({
  competition,
  stage,
  mode,
  seed,
  highlight,
  revision,
}: {
  competition: string;
  stage: string;
  mode: "live" | "sim";
  seed: number | null;
  highlight: string | null;
  revision: string | null | undefined;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");

  const download = async () => {
    setStatus("loading");
    setMessage("");
    const params = new URLSearchParams({ competition, stage, mode });
    if (mode === "sim" && seed) params.set("seed", String(seed));
    if (highlight) params.set("highlight", highlight);
    if (revision) params.set("revision", revision);
    try {
      const response = await fetch(`${API_BASE_URL}/api/exports/canvas.png?${params}`);
      if (!response.ok) {
        const detail = await response.json().catch(() => null) as { detail?: string } | null;
        throw new Error(
          response.status === 409
            ? "数据已更新，请重试导出"
            : detail?.detail ?? `导出失败：${response.status}`,
        );
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `rmuc-${competition}-${stage}-${mode}.png`;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus("idle");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setStatus("error");
    }
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        disabled={status === "loading" || !revision}
        onClick={() => void download()}
        className="min-h-10 border border-white/10 bg-rm-metal-dark/80 px-2.5 py-1.5 text-xs uppercase text-rm-metal-text transition-colors hover:border-rm-blue/50 hover:text-white disabled:cursor-wait disabled:opacity-50 md:min-h-0"
      >
        {status === "loading" ? "导出中…" : "导出 PNG"}
      </button>
      {status === "error" ? (
        <div className="fixed bottom-5 left-1/2 z-[220] w-[min(90vw,28rem)] -translate-x-1/2 border border-rm-red/50 bg-black/95 p-3 font-mono text-[11px] text-rm-red shadow-2xl">
          {message}
          <button type="button" onClick={() => setStatus("idle")} className="ml-3 underline">关闭</button>
        </div>
      ) : null}
    </div>
  );
}
