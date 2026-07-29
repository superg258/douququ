export type ShareMode = "live" | "sim";

export function buildScheduleShareUrl({
  origin,
  pathname,
  mode,
  seed,
  state,
}: {
  origin: string;
  pathname: string;
  mode: ShareMode;
  seed: number | null;
  state: Record<string, string | null | undefined>;
}) {
  const url = new URL(pathname, origin);
  for (const [key, value] of Object.entries(state)) {
    if (value) url.searchParams.set(key, value);
  }
  url.searchParams.set("mode", mode);
  if (mode === "sim") {
    if (!seed || !Number.isSafeInteger(seed) || seed < 1) {
      throw new Error("模拟分享链接缺少有效种子");
    }
    url.searchParams.set("seed", String(seed));
  } else {
    url.searchParams.delete("seed");
  }
  return url.toString();
}
