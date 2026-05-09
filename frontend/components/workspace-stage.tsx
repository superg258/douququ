"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CanvasCardView } from "@/components/canvas-card";
import { CanvasConnectorView } from "@/components/canvas-connector";
import type { WorkspaceStage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { isPageFullscreenActive, setPageFullscreenLock } from "@/lib/fullscreen-api";
import { clampViewportPosition, fitWorkspaceViewport, scaleViewportAroundFramePoint } from "@/lib/workspace-viewport";

const CANVAS_PAN_BLOCK_SELECTOR = "input, textarea, select, a, [data-canvas-pan-exempt]";

export function shouldBlockCanvasPanTarget(target: Pick<HTMLElement, "closest"> | null) {
  return Boolean(target?.closest(CANVAS_PAN_BLOCK_SELECTOR));
}

function headerToneClass(tone: WorkspaceStage["headers"][number]["tone"]) {
  switch (tone) {
    case "amber":
      return "border-l-4 border-rm-result-winner border-y-white/10 border-r-white/10 bg-black/80 text-rm-result-winner";
    case "emerald":
      return "border-l-4 border-rm-status-safe border-y-white/10 border-r-white/10 bg-black/80 text-rm-status-safe";
    case "steel":
      return "border-l-4 border-rm-metal-text border-y-white/10 border-r-white/10 bg-black/80 text-rm-metal-text";
    default:
      return "border-l-4 border-rm-blue border-y-white/10 border-r-white/10 bg-black/80 text-rm-blue";
  }
}

export function WorkspaceStageView({
  stage,
  mode,
  selectedTeamKey,
  highlightedTeamKey,
  selectedMatchLabel,
  onTeamSelect,
  onMatchSelect,
  onFullscreenChange,
}: {
  stage: WorkspaceStage;
  mode?: "sim" | "live";
  selectedTeamKey: string | null;
  highlightedTeamKey: string | null;
  selectedMatchLabel: string | null;
  onTeamSelect: (teamKey: string) => void;
  onMatchSelect: (matchLabel: string) => void;
  onFullscreenChange?: (fullscreen: boolean) => void;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState({ scale: 1, x: 0, y: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const hasActiveHighlight = highlightedTeamKey !== null;
  const [portalReady, setPortalReady] = useState(false);
  const [panning, setPanning] = useState(false);
  const frameSizeRef = useRef(frameSize);
  const viewportRef = useRef(viewport);
  const suppressClickRef = useRef(false);
  const suppressAutoPanRef = useRef(false);
  const handleTeamSelect = (teamKey: string) => {
    suppressAutoPanRef.current = true;
    onTeamSelect(teamKey);
  };
  const panTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    setPortalReady(true);
  }, []);

  useEffect(() => {
    const frameElement = frameRef.current;
    if (!frameElement || typeof window === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setFrameSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(frameElement);
    return () => observer.disconnect();
  }, [fullscreen]);

  useEffect(() => {
    frameSizeRef.current = frameSize;
  }, [frameSize]);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    setPageFullscreenLock(document, fullscreen);
    onFullscreenChange?.(fullscreen);

    return () => {
      setPageFullscreenLock(document, false);
      onFullscreenChange?.(false);
    };
  }, [fullscreen, onFullscreenChange]);

  useEffect(() => {
    return () => {
      if (panTimerRef.current) clearTimeout(panTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!fullscreen || typeof window === "undefined") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFullscreen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fullscreen]);

  useEffect(() => {
    if (!frameSize.width || !frameSize.height) return;
    setViewport(fitWorkspaceViewport(stage, frameSize.width, frameSize.height));
  }, [stage, frameSize.height, frameSize.width]);

  // Auto-pan to highlighted team card (skip if triggered by canvas click)
  useEffect(() => {
    if (suppressAutoPanRef.current) {
      suppressAutoPanRef.current = false;
      return;
    }
    if (!highlightedTeamKey || !frameSize.width || !frameSize.height) return;
    const targetCard = stage.cards.find(
      (card) =>
        (card.kind === "team" && card.teamKey === highlightedTeamKey) ||
        (card.kind === "match" &&
          (card.redSide.teamKey === highlightedTeamKey || card.blueSide.teamKey === highlightedTeamKey))
    );
    if (!targetCard) return;
    const cx = targetCard.x + targetCard.width / 2;
    const cy = targetCard.y + targetCard.height / 2;
    const targetX = frameSize.width / 2 - cx * viewportRef.current.scale;
    const targetY = frameSize.height / 2 - cy * viewportRef.current.scale;
    const nextViewport = clampViewportPosition(stage, frameSize, {
      scale: viewportRef.current.scale,
      x: targetX,
      y: targetY,
    });
    setPanning(true);
    viewportRef.current = nextViewport;
    setViewport(nextViewport);
    if (panTimerRef.current) clearTimeout(panTimerRef.current);
    panTimerRef.current = setTimeout(() => setPanning(false), 700);
  }, [highlightedTeamKey, stage, frameSize]);

  const resetViewport = () => {
    if (!frameSize.width || !frameSize.height) return;
    setViewport(fitWorkspaceViewport(stage, frameSize.width, frameSize.height));
  };

  const updateViewport = (nextViewport: { scale: number; x: number; y: number }) => {
    const currentFrameSize = frameSizeRef.current;
    if (!currentFrameSize.width || !currentFrameSize.height) return;
    const clampedViewport = clampViewportPosition(stage, currentFrameSize, nextViewport);
    viewportRef.current = clampedViewport;
    setViewport(clampedViewport);
  };

  const setScale = (nextScale: number) => {
    const currentFrameSize = frameSizeRef.current;
    if (!currentFrameSize.width || !currentFrameSize.height) return;
    const currentViewport = viewportRef.current;
    const frameCenterX = currentFrameSize.width / 2;
    const frameCenterY = currentFrameSize.height / 2;
    const nextViewport = scaleViewportAroundFramePoint(stage, currentFrameSize, currentViewport, frameCenterX, frameCenterY, nextScale);
    viewportRef.current = nextViewport;
    setViewport(nextViewport);
  };

  const minimapViewport = (() => {
    if (!frameSize.width || !frameSize.height) {
      return null;
    }

    const mapWidth = 112;
    const mapHeight = Math.max(40, Math.round((stage.height / stage.width) * mapWidth));
    const visibleWorldWidth = frameSize.width / viewport.scale;
    const visibleWorldHeight = frameSize.height / viewport.scale;
    const visibleWorldX = -viewport.x / viewport.scale;
    const visibleWorldY = -viewport.y / viewport.scale;

    return {
      mapHeight,
      left: Math.max(0, Math.min(mapWidth, (visibleWorldX / stage.width) * mapWidth)),
      top: Math.max(0, Math.min(mapHeight, (visibleWorldY / stage.height) * mapHeight)),
      width: Math.max(8, Math.min(mapWidth, (visibleWorldWidth / stage.width) * mapWidth)),
      height: Math.max(8, Math.min(mapHeight, (visibleWorldHeight / stage.height) * mapHeight)),
    };
  })();

  const toggleFullscreen = () => {
    setFullscreen((current) => !current);
  };

  const clearInteraction = (pointerId: number, target: EventTarget | null) => {
    activePointers.current.delete(pointerId);

    if (dragState.current?.pointerId === pointerId) {
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
      originScale: viewportRef.current.scale,
      worldX: (centerX - viewportRef.current.x) / viewportRef.current.scale,
      worldY: (centerY - viewportRef.current.y) / viewportRef.current.scale,
      centerX,
      centerY,
    };
    dragState.current = null;
  };

  useEffect(() => {
    const frameElement = frameRef.current;
    if (!frameElement) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (shouldBlockCanvasPanTarget(target)) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      suppressClickRef.current = false;
      activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      maybeStartPinch();
      if (activePointers.current.size > 1) return;

      dragState.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: viewportRef.current.x,
        originY: viewportRef.current.y,
        moved: false,
      };
    };

    const handlePointerMove = (event: PointerEvent) => {
      activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pinchState.current && activePointers.current.size >= 2) {
        const [first, second] = [...activePointers.current.values()];
        const centerX = (first.x + second.x) / 2;
        const centerY = (first.y + second.y) / 2;
        const distance = Math.hypot(second.x - first.x, second.y - first.y);

        if (!distance) return;

        updateViewport(
          scaleViewportAroundFramePoint(
            stage,
            frameSizeRef.current,
            {
              scale: pinchState.current.originScale,
              x: pinchState.current.centerX - pinchState.current.worldX * pinchState.current.originScale,
              y: pinchState.current.centerY - pinchState.current.worldY * pinchState.current.originScale,
            },
            centerX,
            centerY,
            pinchState.current.originScale * (distance / pinchState.current.startDistance)
          )
        );
        return;
      }

      if (!dragState.current || dragState.current.pointerId !== event.pointerId) return;
      const currentDrag = dragState.current;
      const deltaX = event.clientX - currentDrag.startX;
      const deltaY = event.clientY - currentDrag.startY;

      if (Math.abs(deltaX) > 6 || Math.abs(deltaY) > 6) {
        dragState.current = { ...currentDrag, moved: true };
        suppressClickRef.current = true;
      }

      updateViewport({
        scale: viewportRef.current.scale,
        x: currentDrag.originX + deltaX,
        y: currentDrag.originY + deltaY,
      });
    };

    const handlePointerEnd = (event: PointerEvent) => {
      clearInteraction(event.pointerId, frameElement);
      if (event.type === "pointercancel") {
        suppressClickRef.current = false;
      }
    };

    const handleClickCapture = (event: MouseEvent) => {
      if (!suppressClickRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClickRef.current = false;
    };

    frameElement.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerup", handlePointerEnd, true);
    window.addEventListener("pointercancel", handlePointerEnd, true);
    frameElement.addEventListener("click", handleClickCapture, true);

    return () => {
      frameElement.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerEnd, true);
      window.removeEventListener("pointercancel", handlePointerEnd, true);
      frameElement.removeEventListener("click", handleClickCapture, true);
    };
  }, [fullscreen, portalReady, stage]);

  const stageShell = (
    <section
      ref={sectionRef}
      className={cn(
        "canvas-background relative flex flex-col h-full border-t border-rm-metal-border rounded-none overflow-hidden",
        isPageFullscreenActive(fullscreen) && "fixed inset-0 z-[140] h-screen w-screen border-0 bg-[#05070c]"
      )}
    >
      {/* Zoom toolbar — top-right floating */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-1 md:gap-2 bg-black/90 border border-white/10 px-2 md:px-3 py-1 md:py-1.5 clip-chamfer">
          <button 
            className="text-rm-metal-text hover:text-white px-1 md:px-2 py-0.5 text-xs font-mono uppercase transition-colors focus:outline-none"
            onClick={() => setScale(viewport.scale * 1.15)}
          >
            <span className="hidden md:inline">放大</span><span className="md:hidden">+</span>
          </button>
          <span className="text-[10px] md:text-xs text-rm-blue font-bold font-mono min-w-[3ch] text-center">
            {Math.round(viewport.scale * 100)}%
          </span>
          <button 
            className="text-rm-metal-text hover:text-white px-1 md:px-2 py-0.5 text-xs font-mono uppercase transition-colors focus:outline-none"
            onClick={() => setScale(viewport.scale / 1.15)}
          >
            <span className="hidden md:inline">缩小</span><span className="md:hidden">-</span>
          </button>
          <div className="w-[1px] h-3 bg-rm-metal-text/30 mx-1"></div>
          <button 
            className="text-rm-metal-text hover:text-white px-1 md:px-2 py-0.5 text-xs font-mono uppercase transition-colors focus:outline-none"
            onClick={resetViewport}
          >
            <span className="hidden md:inline">归位</span><span className="md:hidden">归位</span>
          </button>
          <div className="w-[1px] h-3 bg-rm-metal-text/30 mx-1"></div>
          <button
            className="text-rm-metal-text hover:text-white px-1 md:px-2 py-0.5 text-xs font-mono uppercase transition-colors focus:outline-none"
            onClick={toggleFullscreen}
          >
            <span className="hidden md:inline">{fullscreen ? "退出全屏" : "全屏"}</span>
            <span className="md:hidden">{fullscreen ? "退出全屏" : "全屏"}</span>
          </button>
        </div>

      <div className="pointer-events-none absolute top-3 left-3 z-20 flex flex-col gap-2 md:hidden">
        <div className="border border-rm-blue/35 bg-black/55 px-2 py-1 text-[10px] font-mono text-rm-blue/85 shadow-[0_0_10px_rgba(0,163,255,0.18)] clip-chamfer">
          拖拽查看
        </div>
        {minimapViewport ? (
          <div
            className="relative hidden border border-rm-metal-border bg-rm-metal-dark/70 sm:block"
            style={{ width: 72, height: Math.max(28, Math.round(minimapViewport.mapHeight * (72 / 112))) }}
          >
            <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.07)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.07)_1px,transparent_1px)] bg-[length:12px_12px]" />
            <div
              className="absolute border border-rm-blue bg-rm-blue/20 shadow-[0_0_8px_rgba(0,163,255,0.45)]"
              style={{
                left: minimapViewport.left * (72 / 112),
                top: minimapViewport.top * (72 / 112),
                width: Math.max(6, minimapViewport.width * (72 / 112)),
                height: Math.max(6, minimapViewport.height * (72 / 112)),
              }}
            />
          </div>
        ) : null}
      </div>

      {/* Surface for Zooming & Dragging */}
      <div
        ref={frameRef}
        className="flex-1 w-full h-full cursor-grab active:cursor-grabbing overflow-hidden touch-none"
        onWheel={(event) => {
           event.preventDefault();
           const nextScale = viewportRef.current.scale - event.deltaY * 0.001;
           setScale(nextScale);
        }}
      >
        <div
          className="absolute top-0 left-0 origin-top-left canvas-grid"
          style={{
            transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.scale})`,
            width: stage.width,
            height: stage.height,
            transition: panning ? "transform 0.55s cubic-bezier(0.34, 1.56, 0.64, 1)" : "none",
          }}
        >
          {/* Header Banners (e.g. Round 1, Round 2, Final Band) */}
          {stage.headers.map((header) => (
             <div
               key={header.id}
               className={cn(
                "absolute flex h-12 items-center justify-between gap-3 overflow-hidden px-3 py-2 font-mono clip-chamfer min-w-0 border-y border-r border-y-white/10 border-r-white/10 glass-panel",
                 headerToneClass(header.tone),
                 hasActiveHighlight && "opacity-30 grayscale-[30%]"
               )}
               style={{
                 left: header.x,
                 top: header.y,
                 width: header.width,
               }}
             >
                <div className="min-w-0">
                  <div className="truncate font-machine text-[16px] font-extrabold leading-none tracking-widest text-current">
                    {header.title}
                  </div>
                  {header.subtitle ? (
                    <div className="mt-1 truncate text-[10px] font-semibold leading-none tracking-widest text-current opacity-70">
                      {header.subtitle}
                    </div>
                  ) : null}
                </div>
                <div className="flex h-full shrink-0 items-center gap-1 opacity-80">
                  <span className="h-6 w-[3px] bg-current" />
                  <span className="h-4 w-[3px] bg-current opacity-60" />
                </div>
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
              onMatchSelect={onMatchSelect}
              selectedMatchLabel={selectedMatchLabel}
              selectedTeamKey={selectedTeamKey}
              highlightedTeamKey={highlightedTeamKey}
              hasActiveHighlight={hasActiveHighlight}
              onTeamSelect={handleTeamSelect}
            />
          ))}
        </div>
      </div>
    </section>
  );

  if (fullscreen && portalReady && typeof document !== "undefined") {
    return createPortal(stageShell, document.body);
  }

  return stageShell;
}
