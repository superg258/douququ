// frontend/components/rankings-hero.tsx
import Link from "next/link";

export function RankingsHero({
  generatedLabel,
}: {
  generatedLabel: string;
}) {
  return (
    <header className="sticky top-0 z-10">
      {/* Red-blue gradient bottom bar */}
      <div className="bg-rm-metal-dark/95 backdrop-blur-md border-b border-rm-metal-border">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="flex items-center gap-2 text-rm-metal-textMuted hover:text-rm-metal-textLight transition-colors group"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-4 h-4 group-hover:-translate-x-1 transition-transform"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
              <span className="text-xs tracking-widest font-bold uppercase">
                返回总控台
              </span>
            </Link>
            <div className="h-5 w-px bg-rm-metal-border" />
            <h1 className="font-machine text-lg font-bold tracking-widest text-rm-metal-textLight">
              Elo 战力排名
            </h1>
          </div>
          <span className="font-mono text-[10px] text-rm-metal-textFaint">
            {generatedLabel}
          </span>
        </div>
      </div>
      <div className="h-0.5 bg-gradient-to-r from-rm-red/70 via-rm-violet/50 to-rm-blue/70" />
    </header>
  );
}
