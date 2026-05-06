// frontend/components/overview-hero.tsx
import Link from "next/link";
export function OverviewHero({
  generatedLabel,
  nextMatchHref,
}: {
  generatedLabel: string;
  nextMatchHref: string | null;
}) {
  return (
    <div>
      <div className="relative">
        {/* Outer glow bar */}
        <div className="h-0.5 bg-gradient-to-r from-rm-red/90 via-rm-red/30 to-rm-blue/30 via-rm-blue/90
                        shadow-[0_0_12px_rgba(232,48,42,0.3),0_0_12px_rgba(42,159,255,0.3)]" />

        {/* Main panel */}
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
          <div className="absolute top-0 right-0 w-64 h-64 bg-rm-blue/6 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-72 h-72 bg-rm-red/5 rounded-full blur-3xl translate-y-1/3 -translate-x-1/4 pointer-events-none" />

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
          <div className="absolute top-0 left-1/2 -translate-x-6 text-[7px] text-rm-metal-textFaint/30 font-mono pointer-events-none">SYS</div>

          {/* ═══════════════════════════════════
              CONTENT — responsive layout
              Mobile: stacked | Desktop: title left, intro right
              ═══════════════════════════════════ */}
          <div className="relative z-10 flex flex-col lg:flex-row lg:items-center gap-6 lg:gap-10 px-6 sm:px-8 lg:px-10 py-8 lg:py-10">

            {/* ── LEFT: Massive title ── */}
            <div className="flex-1 lg:min-w-0">
              {/* Classification */}
              <div className="flex items-center gap-2 mb-3">
                <div className="h-px w-6 bg-rm-metal-textMuted/20" />
                <span className="font-mono text-[9px] text-rm-metal-textFaint/50 tracking-[0.3em] uppercase">
                  战术指挥中心
                </span>
              </div>

              {/* Title with golden rain + chromatic aberration */}
              <h1 className="relative inline-block font-['Quantico'] font-black tracking-[0.12em] leading-[0.85] select-none">
                {/* ── Golden rain particles ── */}
                <span aria-hidden="true" className="absolute inset-0 overflow-hidden pointer-events-none">
                  {[...Array(50)].map((_, i) => (
                    <span
                      key={i}
                      className="absolute animate-[goldenRain_6s_linear_infinite]"
                      style={{
                        left: `${Math.random() * 100}%`,
                        animationDelay: `${Math.random() * 6}s`,
                        animationDuration: `${3.5 + Math.random() * 4}s`,
                        width: `${1 + Math.random() * 3}px`,
                        height: `${2 + Math.random() * 8}px`,
                        background: ['#F5D76E','#E8C44A','#FFF1B0','#D4A830','#FBE68C','#FFEAA7','#C8962E','#FDE68A'][i % 8],
                        boxShadow: `0 0 ${2 + Math.random() * 4}px ${['#F5D76E','#E8C44A','#FFF1B0'][i % 3]}`,
                        borderRadius: Math.random() > 0.6 ? '1px' : '50%',
                        opacity: 0,
                        transform: `rotate(${Math.random() * 30 - 15}deg)`,
                      }}
                    />
                  ))}
                </span>

                {/* Red-gold ghost (offset left) */}
                <span
                  aria-hidden="true"
                  className="absolute inset-0 text-5xl sm:text-6xl lg:text-7xl xl:text-8xl text-transparent bg-clip-text
                             bg-gradient-to-r from-rm-red/60 via-[#E8C44A]/50 to-rm-red/40
                             translate-x-[-2px] opacity-[0.13]"
                >
                  ROBOMASTER
                </span>
                {/* Blue ghost (offset right) */}
                <span
                  aria-hidden="true"
                  className="absolute inset-0 text-5xl sm:text-6xl lg:text-7xl xl:text-8xl text-transparent bg-clip-text
                             bg-gradient-to-r from-rm-blue/50 via-[#D4A830]/30 to-rm-blue/60
                             translate-x-[2px] opacity-[0.10]"
                >
                  ROBOMASTER
                </span>
                {/* Main — champagne gold gradient */}
                <span className="relative text-5xl sm:text-6xl lg:text-7xl xl:text-8xl">
                  <span className="bg-gradient-to-b from-[#E8C44A] via-white to-[#F5D76E] bg-clip-text text-transparent
                                 [text-shadow:0_0_30px_rgba(232,196,74,0.15),0_0_60px_rgba(245,215,110,0.08)]">
                    ROBOMASTER
                  </span>
                </span>
              </h1>

              {/* Sub-line */}
              <p className="mt-1 font-machine text-lg sm:text-xl lg:text-2xl font-bold text-rm-metal-textLight/80 tracking-[0.25em]">
                胜率预测总控台
              </p>
            </div>

            {/* ── Vertical divider (desktop only) ── */}
            <div className="hidden lg:block w-px h-24 bg-gradient-to-b from-transparent via-rm-metal-border to-transparent shrink-0" />

            {/* ── RIGHT: Intro + Status (stacked on mobile, side on desktop) ── */}
            <div className="lg:w-72 xl:w-80 shrink-0 space-y-4">
              {/* Crosshair accent */}
              <div className="flex items-center gap-0">
                <div className="h-px w-6 bg-gradient-to-r from-transparent to-rm-red/40" />
                <div className="relative mx-1">
                  <div className="w-2 h-2 border border-[#F0972C]/60 rotate-45" />
                  <div className="absolute inset-0 w-2 h-2 border border-rm-blue/50 -rotate-45" />
                </div>
                <div className="h-px flex-1 bg-gradient-to-l from-transparent to-rm-blue/40" />
              </div>

              {/* Intro text */}
              <div className="space-y-2">
                <p className="font-mono text-[11px] sm:text-xs text-rm-metal-textMuted leading-relaxed tracking-[0.08em]">
                  覆盖南部 · 东部 · 北部三赛区
                </p>
                <p className="font-mono text-[11px] sm:text-xs text-rm-metal-textFaint leading-relaxed tracking-[0.08em]">
                  基于 Elo 评分与蒙特卡洛模拟，实时推演各赛区从抽签、瑞士轮、资格赛、淘汰赛到最终排名的完整晋级形势。
                </p>
              </div>

              {/* Status line */}
              <div className="flex items-center gap-2 pt-1">
                <span className="flex h-2 w-2 relative shrink-0">
                  <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-rm-status-confirmed opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-rm-status-confirmed shadow-[0_0_6px_rgba(0,232,120,0.7)]" />
                </span>
                <span className="font-mono text-[9px] text-rm-metal-textFaint/60 tracking-[0.2em]">
                  系统运行正常 &nbsp;|&nbsp; {generatedLabel}
                </span>
              </div>

              <Link
                href={nextMatchHref ?? "/regions/south_region"}
                className="inline-flex w-full items-center justify-center border border-rm-red/60 bg-rm-red/15 px-4 py-2.5 font-mono text-sm font-bold tracking-wider text-rm-red shadow-[0_0_10px_rgba(232,48,42,0.2)] transition-all hover:bg-rm-red hover:text-white hover:shadow-[0_0_20px_rgba(232,48,42,0.4)] active:scale-[0.98]"
              >
                进入实时赛程
              </Link>
            </div>
          </div>
        </div>

        {/* Bottom edge decoration */}
        <div className="flex items-center gap-0 -mt-px">
          <div className="h-0.5 flex-1 bg-rm-red/30" />
          <div className="h-0.5 w-12 bg-rm-red/60" />
          <div className="h-0.5 w-8 bg-[#F0972C]/50" />
          <div className="h-0.5 w-6 bg-rm-metal-textMuted/20" />
          <div className="h-0.5 w-12 bg-rm-blue/60" />
          <div className="h-0.5 flex-1 bg-rm-blue/30" />
        </div>
      </div>
    </div>
  );
}
