import type { RegionSlug, RegionViewConfig, WorkspaceView } from "@/lib/types";

export const REGION_VIEWS: RegionViewConfig[] = [
  {
    id: "slots",
    label: "抽签落位",
    description: "先看 A、B 两组的抽签位置与种子分布，快速判断各队开局站位。",
    kind: "canvas",
    tone: "steel",
  },
  {
    id: "swiss-a",
    label: "A 组瑞士轮",
    description: "按轮次查看 A 组从开局到出线或出局的完整路径。",
    kind: "canvas",
    tone: "cyan",
  },
  {
    id: "swiss-b",
    label: "B 组瑞士轮",
    description: "按轮次查看 B 组从开局到出线或出局的完整路径。",
    kind: "canvas",
    tone: "cyan",
  },
  {
    id: "qualification",
    label: "资格赛",
    description: "逐轮看清资格赛的名额去向，谁进国赛、谁进复活赛、谁在这里止步。",
    kind: "canvas",
    tone: "emerald",
  },
  {
    id: "playoff",
    label: "主淘汰赛",
    description: "沿主淘汰链查看 16 进 8、8 进 4、半决赛到冠军战的完整走势。",
    kind: "canvas",
    tone: "amber",
  },
  {
    id: "final-rankings",
    label: "最终排名",
    description: "按最终名次回看国赛、复活赛与其余队伍的落位。",
    kind: "canvas",
    tone: "emerald",
  },
];

export const DEFAULT_SEED = 20260414;
const SESSION_SEED_STORAGE_KEY = "rmuc-live-seed";

export const REGION_ORDER: RegionSlug[] = ["south_region", "east_region", "north_region"];

const REGION_ORDER_INDEX = new Map(REGION_ORDER.map((regionSlug, index) => [regionSlug, index]));

export function compareRegionOrder(left: RegionSlug, right: RegionSlug) {
  return (REGION_ORDER_INDEX.get(left) ?? Number.MAX_SAFE_INTEGER) - (REGION_ORDER_INDEX.get(right) ?? Number.MAX_SAFE_INTEGER);
}

export const REGION_LABELS: Record<RegionSlug, string> = {
  east_region: "东部赛区",
  south_region: "南部赛区",
  north_region: "北部赛区",
};

export function isValidSeed(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function parseSeed(seedText: string | null) {
  const seed = Number(seedText);
  return isValidSeed(seed) ? seed : null;
}

export function createLiveSeed() {
  const timeComponent = Date.now().toString().slice(-9);
  let randomComponent = "000";

  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.getRandomValues === "function") {
    const buffer = new Uint16Array(1);
    globalThis.crypto.getRandomValues(buffer);
    randomComponent = String(buffer[0] % 1000).padStart(3, "0");
  } else {
    randomComponent = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
  }

  const seed = Number(`${timeComponent}${randomComponent}`);
  return isValidSeed(seed) ? seed : DEFAULT_SEED;
}

export function getOrCreateSessionSeed() {
  if (typeof window === "undefined") {
    return DEFAULT_SEED;
  }

  try {
    const savedSeed = parseSeed(window.sessionStorage.getItem(SESSION_SEED_STORAGE_KEY));
    if (savedSeed) {
      return savedSeed;
    }

    const nextSeed = createLiveSeed();
    window.sessionStorage.setItem(SESSION_SEED_STORAGE_KEY, String(nextSeed));
    return nextSeed;
  } catch {
    return createLiveSeed();
  }
}

export function buildRegionHref(
  regionSlug: RegionSlug,
  view: WorkspaceView,
  options: {
    seed?: number | null;
    highlight?: string | null;
    mode?: "sim" | "live";
  } = {}
) {
  const params = new URLSearchParams({ view });
  if (isValidSeed(options.seed)) {
    params.set("seed", String(options.seed));
  }
  if (options.mode) {
    params.set("mode", options.mode);
  }
  if (options.highlight) {
    params.set("highlight", options.highlight);
  }
  return `/regions/${regionSlug}?${params.toString()}`;
}
