"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { StaticWorkspaceStage } from "@/components/static-workspace-stage";
import { getFinalEvents, getOverview, getSimulation } from "@/lib/api";
import { buildWorkspaceStage } from "@/lib/canvas-builders";
import { buildFinalsWorkspaceStage } from "@/lib/finals-canvas";
import { simulateFinalsEvents } from "@/lib/finals-simulation";
import { FINAL_STAGE_OPTIONS } from "@/lib/finals-schedule";
import { isRegionSlug, REGION_LABELS, REGION_VIEWS } from "@/lib/region-config";
import type {
  FinalEventSlug,
  FinalEventStageFilter,
  WorkspaceStage,
  WorkspaceView,
} from "@/lib/types";

interface ExportState {
  stage: WorkspaceStage;
  title: string;
  modeLabel: string;
  sourceUpdatedAt: string | null;
  dataRevision: string;
  modelVersion: string | null;
  seed: number | null;
}

function isFinalEvent(value: string | null): value is FinalEventSlug {
  return value === "repechage" || value === "nationals";
}

export function CanvasExportPage() {
  const searchParams = useSearchParams();
  const competition = searchParams.get("competition");
  const requestedStage = searchParams.get("stage");
  const mode = searchParams.get("mode") === "sim" ? "sim" : "live";
  const seed = Number(searchParams.get("seed") || "20260414");
  const requestedRevision = searchParams.get("revision");
  const highlight = searchParams.get("highlight");
  const [state, setState] = useState<ExportState | null>(null);
  const [status, setStatus] = useState<"pending" | "ready" | "error">("pending");
  const [error, setError] = useState("");

  useEffect(() => {
    let canceled = false;
    setStatus("pending");
    setError("");
    const load = async () => {
      if (competition && isRegionSlug(competition)) {
        const view = REGION_VIEWS.some((item) => item.id === requestedStage)
          ? requestedStage as WorkspaceView
          : "playoff";
        const simulation = await getSimulation(competition, seed, mode);
        const revision = simulation.meta.dataRevision ?? "";
        if (requestedRevision && requestedRevision !== revision) throw new Error("export revision conflict");
        return {
          stage: buildWorkspaceStage(view, competition, simulation),
          title: `${REGION_LABELS[competition]} · ${REGION_VIEWS.find((item) => item.id === view)?.label ?? view}`,
          modeLabel: simulation.meta.liveStatus?.isSynthetic ? "合成测试" : mode === "live" ? "实时" : "模拟",
          sourceUpdatedAt: simulation.meta.liveStatus?.sourceUpdatedAt ?? null,
          dataRevision: revision,
          modelVersion: simulation.meta.modelVersion ?? null,
          seed: mode === "sim" ? seed : null,
        };
      }
      if (!isFinalEvent(competition)) throw new Error("invalid competition");
      const stage = FINAL_STAGE_OPTIONS[competition].some((item) => item.id === requestedStage)
        ? requestedStage as FinalEventStageFilter
        : FINAL_STAGE_OPTIONS[competition][0].id;
      const [snapshot, overview] = await Promise.all([getFinalEvents(mode), getOverview()]);
      const revision = snapshot.dataRevision ?? snapshot.runtimeArtifactVersion;
      if (requestedRevision && requestedRevision !== revision) throw new Error("export revision conflict");
      const simulation = mode === "sim"
        ? simulateFinalsEvents(
          snapshot.events.repechage.event,
          snapshot.events.nationals.event,
          overview,
          seed,
        )[competition]
        : undefined;
      const event = snapshot.events[competition];
      return {
        stage: buildFinalsWorkspaceStage(event.event, stage, simulation),
        title: `${competition === "repechage" ? "复活赛" : "全国赛"} · ${FINAL_STAGE_OPTIONS[competition].find((item) => item.id === stage)?.label ?? stage}`,
        modeLabel: event.liveStatus?.isSynthetic ? "合成测试" : mode === "live" ? "实时" : "模拟",
        sourceUpdatedAt: event.liveStatus?.sourceUpdatedAt ?? event.verifiedAt,
        dataRevision: revision,
        modelVersion: snapshot.modelVersion ?? null,
        seed: mode === "sim" ? seed : null,
      };
    };
    load().then((next) => {
      if (!canceled) setState(next);
    }).catch((reason) => {
      if (!canceled) {
        setError(reason instanceof Error ? reason.message : String(reason));
        setStatus("error");
      }
    });
    return () => {
      canceled = true;
    };
  }, [competition, mode, requestedRevision, requestedStage, seed]);

  useEffect(() => {
    if (!state) return;
    let canceled = false;
    const markReady = async () => {
      await document.fonts.ready;
      await Promise.all(
        Array.from(document.images).map((image) => image.complete
          ? image.decode().catch(() => {})
          : new Promise<void>((resolve) => {
            image.addEventListener("load", () => resolve(), { once: true });
            image.addEventListener("error", () => resolve(), { once: true });
          })),
      );
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!canceled) setStatus("ready");
    };
    void markReady();
    return () => {
      canceled = true;
    };
  }, [state]);

  const generatedAt = useMemo(() => new Date().toISOString(), []);

  return (
    <main className="min-h-screen bg-rm-metal-canvas p-0 text-white">
      <div
        id="canvas-export-root"
        data-export-status={status}
        data-export-error={error || undefined}
        className="inline-block overflow-hidden border border-rm-metal-border bg-rm-metal-canvas"
      >
        {state ? (
          <>
            <header className="flex h-20 items-center justify-between gap-8 border-b border-rm-metal-border bg-black/90 px-6 font-mono">
              <div>
                <h1 className="font-machine text-2xl tracking-widest text-rm-blue">{state.title}</h1>
                <div className="mt-1 text-[11px] text-rm-metal-textMuted">
                  斗蛐蛐 · {state.modeLabel} · 数据 {state.sourceUpdatedAt ?? "未提供更新时间"}
                </div>
              </div>
              <div className="text-right text-[10px] leading-5 text-rm-metal-textMuted">
                <div>revision {state.dataRevision}</div>
                {state.seed ? <div>seed {state.seed}</div> : null}
                {state.modelVersion ? <div>model {state.modelVersion}</div> : null}
                <div>exported {generatedAt}</div>
              </div>
            </header>
            <StaticWorkspaceStage stage={state.stage} mode={mode} highlight={highlight} />
          </>
        ) : (
          <div className="flex h-64 w-[800px] items-center justify-center font-mono text-rm-metal-textMuted">
            {status === "error" ? error : "正在准备静态赛程图…"}
          </div>
        )}
      </div>
    </main>
  );
}
