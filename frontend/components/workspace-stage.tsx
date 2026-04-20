"use client";

import { useEffect, useRef, useState } from "react";
import { CanvasCardView } from "@/components/canvas-card";
import { CanvasConnectorView } from "@/components/canvas-connector";
import type { WorkspaceStage } from "@/lib/types";
import { cn } from "@/lib/utils";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function fitViewport(stage: WorkspaceStage, width: number, height: number) {
  const requestedPaddingX = stage.viewport?.paddingX ?? 72;
  const requestedPaddingY = stage.viewport?.paddingY ?? 72;
  const gutterX = clamp(Math.min(requestedPaddingX, width * 0.045), 18, 36);
  const gutterY = clamp(Math.min(requestedPaddingY, height * 0.055), 18, 34);
  const fittedScale = Math.min((width - gutterX * 2) / stage.width, (height - gutterY * 2) / stage.height, 1);
  const scale = clamp(Math.max(fittedScale, stage.viewport?.minScale ?? 0.56), 0.56, 1);
  const align = stage.viewport?.align ?? "center";
  return {
    scale,
    x: align === "left" ? gutterX : Math.max(gutterX, (width - stage.width * scale) / 2),
    y: Math.max(gutterY, (height - stage.height * scale) / 2),
  };
}

export function WorkspaceStageView({
  stage,
  mode,
  selectedTeamKey,
  highlightedTeamKey,
  selectedMatchLabel,
  onTeamSelect,
  onMatchSelect,
}: {
  stage: WorkspaceStage;
  mode?: "sim" | "live";
  selectedTeamKey: string | null;
  highlightedTeamKey: string | null;
  selectedMatchLabel: string | null;
  onTeamSelect: (teamKey: string) => void;
  onMatchSelect: (matchLabel: string) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState({ scale: 1, x: 0, y: 0 });
  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    if (!frameRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setFrameSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!frameSize.width || !frameSize.height) return;
    setViewport(fitViewport(stage, frameSize.width, frameSize.height));
  }, [stage, frameSize.height, frameSize.width]);

  const resetViewport = () => {
    if (!frameSize.width || !frameSize.height) return;
    setViewport(fitViewport(stage, frameSize.width, frameSize.height));
  };

  const setScale = (nextScale: number) => {
    setViewport((current) => ({
      ...current,
      scale: clamp(nextScale, 0.4, 2.0),
    }));
  };

  return (
    <section className="relative flex flex-col h-full bg-transparent border-t border-rm-metal-border rounded-none overflow-hidden">
      {/* Top Banner / Toolbar */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between p-4 bg-gradient-to-b from-rm-metal-panel/90 to-transparent pointer-events-none">
        <div className="flex flex-col">
          <span className="text-[10px] text-rm-metal-text tracking-widest uppercase font-mono mb-1">
            Tactical Simulation Canvas
          </span>
          <h2 className="text-xl font-bold text-white tracking-widest font-machine">{stage.title}</h2>
          {stage.description && (
            <p className="text-xs text-rm-metal-text mt-1 max-w-xl">{stage.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 pointer-events-auto bg-rm-metal-panel/80 border border-rm-metal-border px-3 py-1.5 backdrop-blur-md clip-chamfer">
          <button 
            className="text-rm-metal-text hover:text-white px-2 py-0.5 text-xs font-mono uppercase transition-colors focus:outline-none"
            onClick={() => setScale(viewport.scale * 1.15)}
          >
            Zoom In
          </button>
          <span className="text-xs text-rm-blue font-bold font-mono min-w-[3ch] text-center">
            {Math.round(viewport.scale * 100)}%
          </span>
          <button 
            className="text-rm-metal-text hover:text-white px-2 py-0.5 text-xs font-mono uppercase transition-colors focus:outline-none"
            onClick={() => setScale(viewport.scale / 1.15)}
          >
            Zoom Out
          </button>
          <div className="w-[1px] h-3 bg-rm-metal-text/30 mx-1"></div>
          <button 
            className="text-rm-metal-text hover:text-white px-2 py-0.5 text-xs font-mono uppercase transition-colors focus:outline-none"
            onClick={resetViewport}
          >
            Reset
          </button>
        </div>
      </div>

      {/* Surface for Zooming & Dragging */}
      <div
        ref={frameRef}
        className="flex-1 w-full h-full cursor-grab active:cursor-grabbing overflow-hidden touch-none"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          dragState.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: viewport.x,
            originY: viewport.y,
          };
          (event.target as HTMLElement).setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!dragState.current || dragState.current.pointerId !== event.pointerId) return;
          const currentDrag = dragState.current;
          const clientX = event.clientX;
          const clientY = event.clientY;
          setViewport((current) => ({
            ...current,
            x: currentDrag.originX + (clientX - currentDrag.startX),
            y: currentDrag.originY + (clientY - currentDrag.startY),
          }));
        }}
        onPointerUp={(event) => {
          if (!dragState.current || dragState.current.pointerId !== event.pointerId) return;
          (event.target as HTMLElement).releasePointerCapture(event.pointerId);
          dragState.current = null;
        }}
        onPointerCancel={(event) => {
          if (!dragState.current || dragState.current.pointerId !== event.pointerId) return;
          (event.target as HTMLElement).releasePointerCapture(event.pointerId);
          dragState.current = null;
        }}
        onWheel={(event) => {
           event.preventDefault();
           setViewport((current) => ({
             ...current,
             scale: clamp(current.scale - event.deltaY * 0.001, 0.4, 2.0),
           }));
        }}
      >
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{
            transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.scale})`,
            width: stage.width,
            height: stage.height,
          }}
        >
          {/* Header Banners (e.g. Round 1, Round 2, Final Band) */}
          {stage.headers.map((header) => (
             <div 
               key={header.id}
               className={cn(
                 "absolute border-t-2 text-[11px] font-bold tracking-widest font-mono pt-2 pl-1",
                 header.tone === "amber" ? "border-rm-status-safe text-rm-status-safe" : 
                 header.tone === "steel" ? "border-rm-metal-text/50 text-rm-metal-text/50" : 
                 "border-rm-blue text-rm-blue text-glow-blue" // default cyan / blue
               )}
               style={{
                 left: header.x,
                 top: header.y,
                 width: header.width,
               }}
             >
                {header.title}
             </div>
          ))}

          {/* Connectors (SVG) */}
          <svg className="absolute inset-0 pointer-events-none" width={stage.width} height={stage.height}>
            {stage.connectors.map((connector, i) => (
              <CanvasConnectorView
                key={i}
                connector={connector}
                selectedTeamKey={selectedTeamKey}
                highlightedTeamKey={highlightedTeamKey}
              />
            ))}
          </svg>

          {/* Cards */}
          {stage.cards.map((card) => (
            <CanvasCardView
              key={card.id}
              card={card}
              mode={mode}
              showProbability={stage.showProbability || false}
              onMatchSelect={onMatchSelect}
              selectedMatchLabel={selectedMatchLabel}
              selectedTeamKey={selectedTeamKey}
              highlightedTeamKey={highlightedTeamKey}
              onTeamSelect={onTeamSelect}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
