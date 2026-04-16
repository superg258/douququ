"use client";

import type { ReactNode } from "react";

import type { CanvasTone, OverviewModule as OverviewModuleMeta } from "@/lib/types";

function toneClass(tone: CanvasTone | undefined) {
  switch (tone) {
    case "amber":
      return "overview-module tone-amber";
    case "emerald":
      return "overview-module tone-emerald";
    case "steel":
      return "overview-module tone-steel";
    default:
      return "overview-module tone-cyan";
  }
}

export function OverviewModule({
  meta,
  children,
  action,
}: {
  meta: OverviewModuleMeta;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className={toneClass(meta.tone)}>
      <div className="overview-module-head">
        <div>
          <p className="module-eyebrow">{meta.eyebrow}</p>
          <h2>{meta.title}</h2>
          {meta.description ? <p className="module-description">{meta.description}</p> : null}
        </div>
        {action ? <div className="overview-module-action">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}
