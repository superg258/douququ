import type { RegionSlug, RegionViewConfig, WorkspaceView } from "@/lib/types";

export const REGION_VIEWS: RegionViewConfig[] = [
  {
    id: "slots",
    label: "抽签布位",
    description: "查看 A/B 组落位、种子层级和初始站位。",
    kind: "canvas",
    tone: "steel",
  },
  {
    id: "swiss-a",
    label: "A 组瑞士轮",
    description: "沿着 A 组 0-0 到 3-0 / 2-3 的晋级与淘汰路线浏览。",
    kind: "canvas",
    tone: "cyan",
  },
  {
    id: "swiss-b",
    label: "B 组瑞士轮",
    description: "沿着 B 组 0-0 到 3-0 / 2-3 的晋级与淘汰路线浏览。",
    kind: "canvas",
    tone: "cyan",
  },
  {
    id: "qualification",
    label: "资格赛",
    description: "单独查看资格赛里的国赛 / 复活赛 / 淘汰分流。",
    kind: "canvas",
    tone: "emerald",
  },
  {
    id: "playoff",
    label: "淘汰赛",
    description: "只查看主淘汰链与冠军战、季军战。",
    kind: "canvas",
    tone: "amber",
  },
  {
    id: "final-rankings",
    label: "结果回看",
    description: "按最终落点回看国赛、复活赛和尾部排名。",
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
  } = {}
) {
  const params = new URLSearchParams({ view });
  if (isValidSeed(options.seed)) {
    params.set("seed", String(options.seed));
  }
  if (options.highlight) {
    params.set("highlight", options.highlight);
  }
  return `/regions/${regionSlug}?${params.toString()}`;
}
