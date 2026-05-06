"use client";

import { useEffect, useState } from "react";
import { getCommandCenter, getPredictionRecap } from "@/lib/api";
import type { CommandCenterResponse, PredictionRecapResponse, RegionSlug } from "@/lib/types";
import { LiveCommandCenterPanel } from "@/components/live-command-center-panel";
import { ModelRecapPanel } from "@/components/model-recap-panel";
import { SourceFreshnessStrip } from "@/components/source-freshness-strip";

const REGIONS: Array<{ id: RegionSlug | "all"; label: string }> = [
  { id: "all", label: "全部赛区" },
  { id: "south_region", label: "南部" },
  { id: "east_region", label: "东部" },
  { id: "north_region", label: "北部" },
];

const BUCKETS = [
  { id: "all", label: "全部状态" },
  { id: "live-now", label: "正在进行" },
  { id: "up-next", label: "即将开赛" },
  { id: "today-pending", label: "尚未开赛" },
  { id: "overdue-unresolved", label: "过期未同步" },
];

const REGION_COLORS: Record<string, { border: string; bg: string; text: string; shadow: string }> = {
  all: {
    border: "border-rm-metal-textMuted/50",
    bg: "bg-rm-metal-textMuted/10",
    text: "text-rm-metal-textLight",
    shadow: "shadow-[0_0_10px_rgba(255,255,255,0.04)]",
  },
  south_region: {
    border: "border-rm-red/70",
    bg: "bg-rm-red/15",
    text: "text-white",
    shadow: "shadow-[0_0_10px_rgba(232,48,42,0.08)]",
  },
  east_region: {
    border: "border-rm-blue/70",
    bg: "bg-rm-blue/15",
    text: "text-white",
    shadow: "shadow-[0_0_10px_rgba(42,159,255,0.08)]",
  },
  north_region: {
    border: "border-rm-violet/70",
    bg: "bg-rm-violet/15",
    text: "text-white",
    shadow: "shadow-[0_0_10px_rgba(139,92,246,0.08)]",
  },
};

const BUCKET_COLORS: Record<string, { border: string; bg: string; text: string; shadow: string }> = {
  all: {
    border: "border-rm-metal-textMuted/50",
    bg: "bg-rm-metal-textMuted/10",
    text: "text-rm-metal-textLight",
    shadow: "shadow-[0_0_10px_rgba(255,255,255,0.04)]",
  },
  "live-now": {
    border: "border-rm-status-safe/70",
    bg: "bg-rm-status-safe/10",
    text: "text-white",
    shadow: "shadow-[0_0_10px_rgba(0,232,120,0.06)]",
  },
  "up-next": {
    border: "border-rm-status-warn/70",
    bg: "bg-rm-status-warn/10",
    text: "text-white",
    shadow: "shadow-[0_0_10px_rgba(255,176,0,0.06)]",
  },
  "today-pending": {
    border: "border-rm-blue/70",
    bg: "bg-rm-blue/15",
    text: "text-white",
    shadow: "shadow-[0_0_10px_rgba(42,159,255,0.08)]",
  },
  "overdue-unresolved": {
    border: "border-rm-status-upset/70",
    bg: "bg-rm-status-upset/10",
    text: "text-white",
    shadow: "shadow-[0_0_10px_rgba(255,80,80,0.06)]",
  },
};

export function ForecastCenterPage() {
  const [region, setRegion] = useState<RegionSlug | "all">("all");
  const [bucket, setBucket] = useState("all");
  const [command, setCommand] = useState<CommandCenterResponse | null>(null);
  const [recap, setRecap] = useState<PredictionRecapResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let canceled = false;
    setError("");
    Promise.all([getCommandCenter(20260414, "live"), getPredictionRecap(20260414, "live")])
      .then(([commandPayload, recapPayload]) => {
        if (!canceled) {
          setCommand(commandPayload);
          setRecap(recapPayload);
          // Default to the region currently playing; fall back to "all"
          const liveRegionSlugs = commandPayload.timelineBuckets.liveNow
            .map((m) => m.regionSlug)
            .filter((slug, i, arr) => arr.indexOf(slug) === i);
          setRegion(
            liveRegionSlugs.length > 0 ? liveRegionSlugs[0] : "all"
          );
        }
      })
      .catch((err) => {
        if (!canceled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      canceled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="mx-auto max-w-screen-2xl px-4 py-8">
        <div className="border border-rm-red/30 bg-rm-red/5 p-4 font-mono text-sm text-rm-red">
          实时预测中心加载失败：{error}
        </div>
      </div>
    );
  }

  if (!command || !recap) {
    return (
      <div className="flex min-h-[55vh] flex-col items-center justify-center animate-pulse">
        <div className="mb-4 h-8 w-8 rounded-full border-4 border-rm-blue/30 border-t-rm-blue animate-spin" />
        <span className="font-mono text-xs tracking-widest text-rm-blue">加载实时预测中心...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-screen-2xl space-y-8 px-4 py-8">

        {/* ══════════════════════════════════════
            HEADER — decorative panel
            ══════════════════════════════════════ */}
        <div className="relative">
          {/* Top glow bar */}
          <div className="h-0.5 bg-gradient-to-r from-rm-blue/90 via-rm-blue/30 to-rm-red/30 via-rm-red/90
                          shadow-[0_0_12px_rgba(42,159,255,0.3),0_0_12px_rgba(232,48,42,0.3)]" />

          <div className="relative bg-rm-metal-panel border-x border-b border-rm-metal-border
                          clip-chamfer-tr-bl overflow-hidden"
               style={{
                 boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03), inset 0 -1px 0 rgba(0,0,0,0.3)',
               }}>

            {/* Scanline overlay */}
            <div className="absolute inset-0 pointer-events-none z-10 opacity-[0.03]"
                 style={{
                   backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.8) 2px, rgba(255,255,255,0.8) 3px)',
                   backgroundSize: '100% 4px',
                 }} />

            {/* Atmospheric blobs */}
            <div className="absolute top-0 right-0 w-48 h-48 bg-rm-blue/5 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-56 h-56 bg-rm-red/4 rounded-full blur-3xl translate-y-1/3 -translate-x-1/4 pointer-events-none" />

            {/* Corner rivets */}
            <div className="absolute top-4 left-4 w-2 h-2 rounded-full bg-rm-metal-textMuted/30 shadow-[0_0_3px_rgba(255,255,255,0.1)]" />
            <div className="absolute top-4 left-9 w-2 h-2 rounded-full bg-rm-metal-textMuted/30 shadow-[0_0_3px_rgba(255,255,255,0.1)]" />
            <div className="absolute top-4 right-4 w-2 h-2 rounded-full bg-rm-metal-textMuted/30 shadow-[0_0_3px_rgba(255,255,255,0.1)]" />
            <div className="absolute top-4 right-9 w-2 h-2 rounded-full bg-rm-metal-textMuted/30 shadow-[0_0_3px_rgba(255,255,255,0.1)]" />
            <div className="absolute bottom-4 left-4 w-2 h-2 rounded-full bg-rm-metal-textMuted/30 shadow-[0_0_3px_rgba(255,255,255,0.1)]" />
            <div className="absolute bottom-4 left-9 w-2 h-2 rounded-full bg-rm-metal-textMuted/30 shadow-[0_0_3px_rgba(255,255,255,0.1)]" />
            <div className="absolute bottom-4 right-4 w-2 h-2 rounded-full bg-rm-metal-textMuted/30 shadow-[0_0_3px_rgba(255,255,255,0.1)]" />
            <div className="absolute bottom-4 right-9 w-2 h-2 rounded-full bg-rm-metal-textMuted/30 shadow-[0_0_3px_rgba(255,255,255,0.1)]" />

            {/* L-brackets */}
            <div className="absolute top-3 left-3 w-5 h-5 border-t-2 border-l-2 border-rm-metal-textMuted/25 pointer-events-none" />
            <div className="absolute top-3 right-3 w-5 h-5 border-t-2 border-r-2 border-rm-metal-textMuted/25 pointer-events-none" />
            <div className="absolute bottom-3 left-3 w-5 h-5 border-b-2 border-l-2 border-rm-metal-textMuted/25 pointer-events-none" />
            <div className="absolute bottom-3 right-3 w-5 h-5 border-b-2 border-r-2 border-rm-metal-textMuted/25 pointer-events-none" />

            {/* Top edge markings */}
            <div className="absolute top-0 left-1/3 w-px h-2 bg-rm-metal-textMuted/20 pointer-events-none" />
            <div className="absolute top-0 left-1/2 w-px h-2 bg-rm-metal-textMuted/25 pointer-events-none" />
            <div className="absolute top-0 right-1/3 w-px h-2 bg-rm-metal-textMuted/20 pointer-events-none" />

            {/* Content */}
            <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between px-6 sm:px-8 py-6">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-px w-6 bg-rm-blue/30" />
                  <span className="font-mono text-[10px] text-rm-metal-textFaint/60 tracking-[0.3em] uppercase">
                    预测指挥台
                  </span>
                </div>
                <h1 className="font-['Quantico'] font-black text-2xl tracking-[0.08em] text-rm-metal-textLight">
                  实时预测中心
                </h1>
                <p className="mt-2 max-w-3xl font-mono text-xs leading-relaxed text-rm-metal-textMuted">
                  按赛区与比赛状态筛选，集中查看赛前预测、数据源状态及模型复盘。
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-rm-status-warn opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-rm-status-warn shadow-[0_0_6px_rgba(255,176,0,0.7)]" />
                </span>
                <span className="font-mono text-[11px] text-rm-metal-textMuted">
                  下一行动：{command.nextActionMatch ? `${command.nextActionMatch.regionName} · ${command.nextActionMatch.matchLabel}` : "暂无"}
                </span>
              </div>
            </div>
          </div>

          {/* Bottom edge decoration */}
          <div className="flex items-center gap-0 -mt-px">
            <div className="h-0.5 flex-1 bg-rm-blue/30" />
            <div className="h-0.5 w-12 bg-rm-blue/60" />
            <div className="h-0.5 w-8 bg-[#F0972C]/50" />
            <div className="h-0.5 w-6 bg-rm-metal-textMuted/20" />
            <div className="h-0.5 w-12 bg-rm-red/60" />
            <div className="h-0.5 flex-1 bg-rm-red/30" />
          </div>
        </div>

        <SourceFreshnessStrip freshness={command.sourceFreshness} />

        {/* ══════════════════════════════════════
            FILTERS BAR
            ══════════════════════════════════════ */}
        <div className="relative bg-rm-metal-panel border border-rm-metal-border overflow-hidden"
             style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02), inset 0 -1px 0 rgba(0,0,0,0.2)' }}>
          {/* Left accent */}
          <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b from-rm-blue/40 via-rm-blue/10 to-rm-red/10 via-rm-red/40" />
          <div className="relative px-4 py-3">
            <div className="flex flex-wrap gap-2">
              {REGIONS.map((item) => {
                const c = REGION_COLORS[item.id];
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setRegion(item.id)}
                    className={`border px-3 py-2 font-mono text-[11px] transition-all ${
                      region === item.id
                        ? `${c.border} ${c.bg} ${c.text} ${c.shadow}`
                        : "border-rm-metal-border bg-transparent text-rm-metal-textMuted hover:border-rm-metal-textMuted/40 hover:text-rm-metal-textLight"
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bucket tabs */}
        <div className="flex flex-wrap gap-2">
          {BUCKETS.map((item) => {
            const c = BUCKET_COLORS[item.id];
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setBucket(item.id)}
                className={`border px-3 py-1.5 font-mono text-[11px] transition-all ${
                  bucket === item.id
                    ? `${c.border} ${c.bg} ${c.text} ${c.shadow}`
                    : "border-rm-metal-border bg-rm-metal-panel text-rm-metal-textMuted hover:border-rm-metal-textMuted/40 hover:text-rm-metal-textLight"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <LiveCommandCenterPanel
          command={command}
          regionFilter={region}
          bucketFilter={bucket}
        />

        <ModelRecapPanel recap={recap} />

        {/* Bottom decoration */}
        <div className="flex items-center gap-0 pt-2">
          <div className="h-0.5 flex-1 bg-rm-blue/20" />
          <div className="h-0.5 w-8 bg-rm-blue/40" />
          <div className="h-0.5 w-4 bg-[#F0972C]/30" />
          <div className="h-0.5 w-8 bg-rm-red/40" />
          <div className="h-0.5 flex-1 bg-rm-red/20" />
        </div>
      </div>
    </div>
  );
}
