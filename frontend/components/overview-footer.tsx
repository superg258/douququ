// frontend/components/overview-footer.tsx
export function OverviewFooter() {
  return (
    <footer className="mt-4">
      {/* Gradient separator */}
      <div className="h-px bg-gradient-to-r from-transparent via-rm-metal-border to-transparent" />
      <div className="text-center font-mono text-[9px] text-rm-metal-textFaint/50 pt-5 pb-12 tracking-widest">
        RoboMaster 2026 机甲大师区域赛战术测算系统 / TrueSkill 2 + 蒙特卡洛预测引擎
        <br />
        <span className="text-rm-metal-textFaint/30">引擎核心：基于对战历史的 TrueSkill 2 与全分组平行蒙特卡洛预测方案</span>
      </div>
    </footer>
  );
}
