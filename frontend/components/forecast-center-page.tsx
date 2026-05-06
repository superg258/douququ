"use client";

import { useState } from "react";

const REGIONS = [
  { id: "all", label: "全部" },
  { id: "south_region", label: "南部" },
  { id: "east_region", label: "东部" },
  { id: "north_region", label: "北部" },
];

const BUCKETS = [
  { id: "all", label: "全部" },
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
  const [region, setRegion] = useState("all");
  const [bucket, setBucket] = useState("all");

  return (
    <section>
      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-4">
        {/* Region filters */}
        <div className="flex items-center gap-1.5">
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

        {/* Bucket filters */}
        <div className="flex items-center gap-1.5">
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
      </div>
    </section>
  );
}
