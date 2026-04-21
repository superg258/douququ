"use client";

import { useEffect, useRef, useState } from "react";
import { CanvasCardView } from "@/components/canvas-card";
import { CanvasConnectorView } from "@/components/canvas-connector";
import type { WorkspaceStage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { clampViewportPosition, fitWorkspaceViewport } from "@/lib/workspace-viewport";

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
  const activePointers = useRef(new Map<number, { x: number; y: number }>());
  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const pinchState = useRef<{
    startDistance: number;
    originScale: number;
    worldX: number;
    worldY: number;
    centerX: number;
    centerY: number;
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
    setViewport(fitWorkspaceViewport(stage, frameSize.width, frameSize.height));
  }, [stage, frameSize.height, frameSize.width]);

  const resetViewport = () => {
    if (!frameSize.width || !frameSize.height) return;
    setViewport(fitWorkspaceViewport(stage, frameSize.width, frameSize.height));
  };

  const updateViewport = (nextViewport: { scale: number; x: number; y: number }) => {
    if (!frameSize.width || !frameSize.height) return;
    setViewport(clampViewportPosition(stage, frameSize, nextViewport));
  };

  const setScale = (nextScale: number) => {
    const frameCenterX = frameSize.width / 2;
    const frameCenterY = frameSize.height / 2;

    setViewport((current) => {
      const scale = Math.min(2, Math.max(0.4, nextScale));
      const worldX = (frameCenterX - current.x) / current.scale;
      const worldY = (frameCenterY - current.y) / current.scale;
      return clampViewportPosition(stage, frameSize, {
        scale,
        x: frameCenterX - worldX * scale,
        y: frameCenterY - worldY * scale,
      });
    });
  };

  const clearInteraction = (pointerId: number, target: EventTarget | null) => {
    activePointers.current.delete(pointerId);

    if (dragState.current?.pointerId === pointerId) {
      if (target instanceof HTMLElement && target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
      dragState.current = null;
    }

    if (activePointers.current.size < 2) {
      pinchState.current = null;
    }
  };

  const maybeStartPinch = () => {
    if (activePointers.current.size !== 2) {
      pinchState.current = null;
      return;
    }

    const [first, second] = [...activePointers.current.values()];
    const centerX = (first.x + second.x) / 2;
    const centerY = (first.y + second.y) / 2;
    const startDistance = Math.hypot(second.x - first.x, second.y - first.y);

    if (!startDistance) return;

    pinchState.current = {
      startDistance,
      originScale: viewport.scale,
      worldX: (centerX - viewport.x) / viewport.scale,
      worldY: (centerY - viewport.y) / viewport.scale,
      centerX,
      centerY,
    };
    dragState.current = null;
  };

  return (
    <section className="relative flex flex-col h-full bg-transparent border-t border-rm-metal-border rounded-none overflow-hidden">
      {/* Top Banner / Toolbar */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-start md:items-center justify-between p-2 md:p-4 bg-gradient-to-b from-rm-metal-panel/90 to-transparent pointer-events-none">
        <div className="flex flex-col max-w-[50%] md:max-w-none">
          <span className="text-[10px] text-rm-metal-text tracking-widest uppercase font-mono mb-1 hidden md:block">
            Tactical Simulation Canvas
          </span>
          <h2 className="text-sm md:text-xl font-bold text-white tracking-widest font-machine leading-tight">{stage.title}</h2>
          {stage.description && (
            <p className="hidden md:block text-xs text-rm-metal-text mt-1 max-w-xl">{stage.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 md:gap-2 pointer-events-auto bg-rm-metal-panel/80 border border-rm-metal-border px-2 md:px-3 py-1 md:py-1.5 backdrop-blur-md clip-chamfer">
          <button 
            className="text-rm-metal-text hover:text-white px-1 md:px-2 py-0.5 text-xs font-mono uppercase transition-colors focus:outline-none"
            onClick={() => setScale(viewport.scale * 1.15)}
          >
            <span className="hidden md:inline">Zoom In</span><span className="md:hidden">+</span>
          </button>
          <span className="text-[10px] md:text-xs text-rm-blue font-bold font-mono min-w-[3ch] text-center">
            {Math.round(viewport.scale * 100)}%
          </span>
          <button 
            className="text-rm-metal-text hover:text-white px-1 md:px-2 py-0.5 text-xs font-mono uppercase transition-colors focus:outline-none"
            onClick={() => setScale(viewport.scale / 1.15)}
          >
            <span className="hidden md:inline">Zoom Out</span><span className="md:hidden">-</span>
          </button>
          <div className="w-[1px] h-3 bg-rm-metal-text/30 mx-1"></div>
          <button 
            className="text-rm-metal-text hover:text-white px-1 md:px-2 py-0.5 text-xs font-mono uppercase transition-colors focus:outline-none"
            onClick={resetViewport}
          >
            <span className="hidden md:inline">Reset</span><span className="md:hidden">归位</span>
          </button>
        </div>
      </div>

      {/* Surface for Zooming & Dragging */}
      <div
        ref={frameRef}
        className="flex-1 w-full h-full cursor-grab active:cursor-grabbing overflow-hidden touch-none"
        onPointerDown={(event) => {
          if (event.pointerType === "mouse" && event.button !== 0) return;
          activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          maybeStartPinch();

          if (activePointers.current.size > 1) {
            return;
          }

          dragState.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: viewport.x,
            originY: viewport.y,
            moved: false,
          };
          (event.target as HTMLElement).setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

          if (pinchState.current && activePointers.current.size >= 2) {
            const [first, second] = [...activePointers.current.values()];
            const centerX = (first.x + second.x) / 2;
            const centerY = (first.y + second.y) / 2;
            const distance = Math.hypot(second.x - first.x, second.y - first.y);

            if (!distance) return;

            const scale = Math.min(2, Math.max(0.4, pinchState.current.originScale * (distance / pinchState.current.startDistance)));
            updateViewport({
              scale,
              x: centerX - pinchState.current.worldX * scale,
              y: centerY - pinchState.current.worldY * scale,
            });
            return;
          }

          if (!dragState.current || dragState.current.pointerId !== event.pointerId) return;
          const currentDrag = dragState.current;
          const clientX = event.clientX;
          const clientY = event.clientY;
          const deltaX = clientX - currentDrag.startX;
          const deltaY = clientY - currentDrag.startY;

          if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
            dragState.current = { ...currentDrag, moved: true };
          }

          updateViewport({
            scale: viewport.scale,
            x: currentDrag.originX + deltaX,
            y: currentDrag.originY + deltaY,
          });
        }}
        onPointerUp={(event) => {
          clearInteraction(event.pointerId, event.target);
        }}
        onPointerCancel={(event) => {
          clearInteraction(event.pointerId, event.target);
        }}
        onWheel={(event) => {
           event.preventDefault();
           const nextScale = viewport.scale - event.deltaY * 0.001;
           setScale(nextScale);
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
