"use client";

import { useEffect, useState } from "react";
import { getPredictionRecap } from "@/lib/api";
import type { PredictionRecapResponse } from "@/lib/types";
import { ModelRecapPanel } from "@/components/model-recap-panel";

export function OverviewModelRecap() {
  const [recap, setRecap] = useState<PredictionRecapResponse | null>(null);

  useEffect(() => {
    let canceled = false;
    getPredictionRecap()
      .then((payload) => {
        if (!canceled) setRecap(payload);
      })
      .catch(() => {
        if (!canceled) setRecap(null);
      });
    return () => {
      canceled = true;
    };
  }, []);

  if (!recap) return null;
  return <ModelRecapPanel recap={recap} compact />;
}
