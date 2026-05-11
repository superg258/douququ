import type { SourceFreshness } from "@/lib/types";

function formatDateTime(value: string | null) {
  if (!value) return "暂无数据";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "暂无数据";
  return parsed.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function SourceFreshnessStrip({
  freshness,
}: {
  freshness: SourceFreshness;
}) {
  return (
    <div className="relative bg-rm-metal-panel border border-rm-metal-border overflow-hidden"
         style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02), inset 0 -1px 0 rgba(0,0,0,0.2)' }}>
      {/* Left accent */}
      <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b from-rm-status-safe/40 via-rm-status-warn/20 to-rm-blue/20" />

      {/* Scanline overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.015]"
           style={{
             backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.8) 2px, rgba(255,255,255,0.8) 3px)',
             backgroundSize: '100% 4px',
           }} />

      <div className="relative px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="h-3 w-0.5 bg-rm-status-safe/50 shadow-[0_0_4px_rgba(0,232,120,0.3)]" />
          <span className="font-mono text-[9px] tracking-[0.2em] text-rm-metal-textFaint/60 uppercase">数据源状态</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <div className="font-mono text-[9px] tracking-widest text-rm-metal-textFaint">服务响应时间</div>
            <div className="font-mono text-xs text-rm-status-safe">{formatDateTime(freshness.serviceGeneratedAt)}</div>
          </div>
          <div>
            <div className="font-mono text-[9px] tracking-widest text-rm-metal-textFaint">模型预测产物</div>
            <div className="font-mono text-xs text-rm-metal-textLight">{formatDateTime(freshness.modelGeneratedAt)}</div>
          </div>
          <div>
            <div className="font-mono text-[9px] tracking-widest text-rm-metal-textFaint">官方赛程同步</div>
            <div className="font-mono text-xs text-rm-status-warn">{formatDateTime(freshness.officialScheduleUpdatedAt)}</div>
            <div className="mt-1 font-mono text-[10px] leading-snug text-rm-metal-textMuted">
              {freshness.coverageLabel}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
