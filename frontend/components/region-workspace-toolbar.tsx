"use client";

import type { ReactNode } from "react";

import { handleHorizontalTabKeyDown } from "@/lib/keyboard-navigation";
import { REGION_VIEWS } from "@/lib/region-config";
import type { WorkspaceView } from "@/lib/types";
import { cn } from "@/lib/utils";

export function RegionWorkspaceToolbar({
  view,
  homeButton,
  regionSelector,
  modeToggle,
  seedControl,
  searchButton,
  legendButton,
  inspectorButton,
  desktopSeedLabel,
  onViewChange,
}: {
  view: WorkspaceView;
  homeButton: ReactNode;
  regionSelector: ReactNode;
  modeToggle: ReactNode;
  seedControl: ReactNode;
  searchButton: ReactNode;
  legendButton: ReactNode;
  inspectorButton: ReactNode;
  desktopSeedLabel: ReactNode;
  onViewChange: (view: WorkspaceView) => void;
}) {
  return (
    <header className="glass-sheet z-30 flex select-none flex-col gap-2 px-3 py-2 md:px-4 md:py-2.5">
      <div className="hidden items-center gap-2 md:flex md:flex-wrap">
        {homeButton}
        {regionSelector}
        {modeToggle}
        {seedControl}
        <div className="hidden flex-1 md:block" />
        {searchButton}
        {legendButton}
        {inspectorButton}
        {desktopSeedLabel}
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-0.5 no-scrollbar md:hidden">
        {homeButton}
        {regionSelector}
        {modeToggle}
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-0.5 no-scrollbar md:hidden">
        {seedControl}
        {searchButton}
        {legendButton}
        {inspectorButton}
      </div>

      <div role="tablist" aria-label="赛区视图" onKeyDown={handleHorizontalTabKeyDown} className="flex items-center gap-1 overflow-x-auto no-scrollbar">
        {REGION_VIEWS.map((item) => (
          <button
            key={item.id}
            id={`region-${item.id}-tab`}
            role="tab"
            aria-selected={item.id === view}
            aria-controls="region-workspace-panel"
            tabIndex={item.id === view ? 0 : -1}
            onClick={() => onViewChange(item.id)}
            className={cn(
              "min-h-10 flex-none px-3 py-1 text-[11px] font-bold uppercase tracking-widest transition-all clip-chamfer md:min-h-0",
              item.id === view
                ? "bg-rm-blue text-white shadow-[0_0_10px_rgba(42,159,255,0.4)]"
                : "border border-transparent text-rm-metal-text hover:border-white/15"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </header>
  );
}
