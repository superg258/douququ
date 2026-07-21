"use client";

type LegendCounts = {
  pre: number;
  post: number;
};

type AccuracyCounts = {
  correct: number;
  mismatch: number;
  upset: number;
};

export function RegionLegendPopover({
  open,
  counters,
  accuracy,
  winnerHitRate,
  onClose,
}: {
  open: boolean;
  counters: LegendCounts;
  accuracy: AccuracyCounts;
  winnerHitRate: number | null;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="关闭图例"
        className="absolute inset-0 z-40 cursor-default bg-black/50"
        onClick={onClose}
      />
      <aside
        aria-label="图例与统计"
        className="absolute inset-x-3 bottom-4 z-50 px-3 py-3 glass-sheet md:inset-x-auto md:bottom-auto md:right-4 md:top-20 md:w-72 md:border md:border-rm-metal-border"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] font-bold uppercase tracking-widest text-rm-metal-text">图例与统计</div>
          <button type="button" onClick={onClose} className="min-h-10 px-2 font-mono text-[10px] uppercase text-rm-metal-text hover:text-white md:min-h-0">
            收起
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <span className="border border-rm-status-safe bg-rm-status-safe/10 px-1.5 py-0.5 text-[10px] font-bold text-rm-status-safe shadow-[0_0_5px_rgba(0,255,157,0.3)]">精准预测</span>
          <span className="border border-rm-status-deviation bg-rm-status-deviation/10 px-1.5 py-0.5 text-[10px] font-bold text-rm-status-deviation shadow-[0_0_5px_rgba(168,85,247,0.3)]">比分偏离</span>
          <span className="border border-rm-status-upset bg-rm-status-upset/10 px-1.5 py-0.5 text-[10px] font-bold text-rm-status-upset shadow-[0_0_5px_rgba(232,48,42,0.3)]">路线爆冷</span>
          <span className="border border-rm-status-scheduled bg-rm-status-scheduled/10 px-1.5 py-0.5 text-[10px] font-bold text-rm-status-scheduled shadow-[0_0_5px_rgba(250,204,21,0.3)]">确认未赛</span>
          <span className="border border-rm-blue bg-rm-blue/10 px-1.5 py-0.5 text-[10px] font-bold text-rm-blue shadow-[0_0_5px_rgba(0,163,255,0.3)]">模拟预测</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[10px]">
          <span className="border border-rm-blue/35 bg-rm-blue/10 px-2 py-1 text-rm-blue">待验证 {counters.pre}</span>
          <span className="border border-rm-status-safe/35 bg-rm-status-safe/10 px-2 py-1 text-rm-status-safe">已完赛 {counters.post}</span>
          <span className="col-span-2 border border-white/15 bg-white/5 px-2 py-1 text-white">胜负命中率 {winnerHitRate === null ? "0.0%" : `${(winnerHitRate * 100).toFixed(1)}%`}</span>
          <span className="border border-rm-status-safe/35 bg-rm-status-safe/10 px-2 py-1 text-rm-status-safe">精准 {accuracy.correct}</span>
          <span className="border border-rm-status-deviation/35 bg-rm-status-deviation/10 px-2 py-1 text-rm-status-deviation">偏离 {accuracy.mismatch}</span>
          <span className="col-span-2 border border-rm-status-upset/35 bg-rm-status-upset/10 px-2 py-1 text-rm-status-upset">爆冷 {accuracy.upset}</span>
        </div>
      </aside>
    </>
  );
}
