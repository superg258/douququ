// frontend/components/overview-footer.tsx
export function OverviewFooter() {
  return (
    <footer className="mt-4">
      {/* Gradient separator */}
      <div className="h-px bg-gradient-to-r from-transparent via-rm-metal-border to-transparent" />
      <div className="text-center font-mono text-[9px] text-rm-metal-textFaint/50 pt-5 pb-12 tracking-widest">
        RoboMaster 2026 机甲大师赛况追踪
        <br />
        <span className="text-rm-metal-textFaint/30">Elo 战力评估 · 赛程推演模拟</span>
      </div>
    </footer>
  );
}
