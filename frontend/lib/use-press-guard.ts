"use client";

import { useCallback, useRef } from "react";

export const DEFAULT_PRESS_THRESHOLD = 6;

export function exceedsPressThreshold(
  startX: number,
  startY: number,
  x: number,
  y: number,
  threshold: number = DEFAULT_PRESS_THRESHOLD,
) {
  return Math.abs(x - startX) > threshold || Math.abs(y - startY) > threshold;
}

/**
 * 区分「点按」与「拖拽」：按下后移动超过阈值即视为拖拽，随后的 click 应被吞掉。
 * 返回的 pressGuardProps 直接铺到目标元素上；click 处理器里先调 consumePress()，
 * 返回 true 表示这是一次拖拽，应跳过后续动作。
 */
export function usePressGuard(threshold: number = DEFAULT_PRESS_THRESHOLD) {
  const pointerIntentRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const consumePress = useCallback(() => {
    const moved = pointerIntentRef.current?.moved ?? false;
    pointerIntentRef.current = null;
    return moved;
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    pointerIntentRef.current = { x: event.clientX, y: event.clientY, moved: false };
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const intent = pointerIntentRef.current;
      if (!intent) return;
      if (exceedsPressThreshold(intent.x, intent.y, event.clientX, event.clientY, threshold)) {
        pointerIntentRef.current = { ...intent, moved: true };
      }
    },
    [threshold],
  );

  const onPointerUp = useCallback(() => {
    if (pointerIntentRef.current?.moved) {
      pointerIntentRef.current = null;
    }
  }, []);

  const onPointerCancel = useCallback(() => {
    pointerIntentRef.current = null;
  }, []);

  return {
    consumePress,
    pressGuardProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  };
}
