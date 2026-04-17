"use client";

import { useEffect, useRef, useState } from "react";

import { CanvasCardView } from "@/components/canvas-card";
import { CanvasConnectorLine } from "@/components/canvas-connector";
import type { WorkspaceStage } from "@/lib/types";

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
  selectedTeamKey,
  highlightedTeamKey,
  selectedMatchLabel,
  onTeamSelect,
  onMatchSelect,
}: {
  stage: WorkspaceStage;
  selectedTeamKey: string | null;
  highlightedTeamKey: string | null;
  selectedMatchLabel: string | null;
  onTeamSelect: (teamKey: string) => void;
  onMatchSelect: (matchLabel: string) => void;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState({ x: 32, y: 32, scale: 1 });

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect;
      if (!next) {
        return;
      }
      setFrameSize({ width: next.width, height: next.height });
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!frameSize.width || !frameSize.height) {
      return;
    }
    setViewport(fitViewport(stage, frameSize.width, frameSize.height));
  }, [stage, frameSize.height, frameSize.width]);

  const resetViewport = () => {
    if (!frameSize.width || !frameSize.height) {
      return;
    }
    setViewport(fitViewport(stage, frameSize.width, frameSize.height));
  };

  const setScale = (nextScale: number) => {
    setViewport((current) => ({
      ...current,
      scale: clamp(nextScale, 0.5, 1.4),
    }));
  };

  return (
    <section className="workspace-stage-frame">
      <div className="workspace-stage-meta">
        <div className="workspace-stage-copy-block">
          <p className="canvas-stage-kicker">赛程画布</p>
          <h2>{stage.title}</h2>
          <p>{stage.description}</p>
        </div>
        <div className="canvas-toolbar">
          <button type="button" onClick={() => setScale(viewport.scale * 1.08)}>
            放大
          </button>
          <span>{Math.round(viewport.scale * 100)}%</span>
          <button type="button" onClick={() => setScale(viewport.scale / 1.08)}>
            缩小
          </button>
          <button type="button" onClick={resetViewport}>
            归位
          </button>
        </div>
      </div>

      <div
        ref={frameRef}
        className="workspace-stage-surface"
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }
          dragState.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: viewport.x,
            originY: viewport.y,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const current = dragState.current;
          if (!current || current.pointerId !== event.pointerId) {
            return;
          }
          setViewport((viewportState) => ({
            ...viewportState,
            x: current.originX + (event.clientX - current.startX),
            y: current.originY + (event.clientY - current.startY),
          }));
        }}
        onPointerUp={(event) => {
          if (dragState.current?.pointerId === event.pointerId) {
            dragState.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => {
          dragState.current = null;
        }}
      >
        <div
          className="workspace-stage-canvas"
          style={{
            width: stage.width,
            height: stage.height,
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
          }}
        >
          <svg className="workspace-connector-layer" width={stage.width} height={stage.height} viewBox={`0 0 ${stage.width} ${stage.height}`}>
            <defs>
              <marker
                id="workspace-arrow"
                markerWidth="10"
                markerHeight="10"
                refX="8"
                refY="5"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" className="workspace-arrow-head" />
              </marker>
            </defs>
            {stage.connectors.map((connector) => (
              <CanvasConnectorLine key={connector.id} connector={connector} />
            ))}
          </svg>

          {stage.headers.map((header) => (
            <div
              key={header.id}
              className={`stage-header tone-${header.tone ?? "cyan"}`}
              style={{
                left: header.x,
                top: header.y,
                width: header.width,
              }}
            >
              <strong>{header.title}</strong>
              {header.subtitle ? <span>{header.subtitle}</span> : null}
            </div>
          ))}

          {stage.cards.map((card) => (
            <CanvasCardView
              key={card.id}
              card={card}
              selectedTeamKey={selectedTeamKey}
              highlightedTeamKey={highlightedTeamKey}
              selectedMatchLabel={selectedMatchLabel}
              onTeamSelect={onTeamSelect}
              onMatchSelect={onMatchSelect}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
