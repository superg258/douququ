"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "全景战略板" },
  { href: "/forecast-center", label: "实时预测中心" },
  { href: "/elo-rankings", label: "Elo 战力榜" },
];

export function RootNav() {
  const pathname = usePathname();

  // Canvas workspaces own their compact navigation and need the full viewport.
  if (pathname.startsWith("/regions/") || pathname.startsWith("/forecast-center")) {
    return null;
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-rm-metal-border bg-rm-metal-panel/80 p-3 md:p-4 backdrop-blur-md">
      <div className="mx-auto flex max-w-screen-2xl items-center justify-between flex-wrap gap-2">
        <div className="flex items-center space-x-2 md:space-x-4">
          <div className="flex h-6 w-6 md:h-8 md:w-8 text-[10px] md:text-base items-center justify-center border border-rm-blue bg-rm-blue/20 text-rm-blue clip-chamfer shadow-[0_0_15px_rgba(0,163,255,0.4)]">
            RM
          </div>
          <h1 className="font-machine tracking-widest text-sm md:text-lg font-bold text-white uppercase text-glow-blue">
            赛事总控台
            <span className="hidden md:inline-block ml-3 animate-pulse text-xs tracking-normal text-rm-status-safe">
              服务运行中
            </span>
          </h1>
        </div>
        <nav className="flex flex-wrap justify-end gap-x-4 gap-y-2 md:gap-x-6">
          {NAV_ITEMS.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "text-[11px] font-bold uppercase tracking-widest transition-colors md:text-sm",
                  active ? "text-rm-blue" : "text-rm-metal-text hover:text-white",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="absolute bottom-0 left-0 h-[1px] w-full bg-gradient-to-r from-transparent via-rm-blue to-transparent opacity-50" />
    </header>
  );
}
