"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * SSR 安全的媒体查询 hook：
 * 服务端与首次 hydration 一律返回 false（移动端布局），
 * 挂载后由 useSyncExternalStore 自动校正为真实匹配结果。
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mediaQueryList = window.matchMedia(query);
      mediaQueryList.addEventListener("change", onStoreChange);
      return () => mediaQueryList.removeEventListener("change", onStoreChange);
    },
    [query],
  );
  const getSnapshot = () => window.matchMedia(query).matches;
  const getServerSnapshot = () => false;

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** 与 Tailwind 默认 lg 断点（1024px）对齐的桌面判定 */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)");
}
