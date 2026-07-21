"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";

export interface ErrorPanelProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  backHref?: string;
  backLabel?: string;
}

/**
 * 红色切角错误面板：数据链路异常时的统一兜底
 */
export function ErrorPanel({
  title = "数据链路异常",
  message,
  onRetry,
  backHref,
  backLabel = "返回",
}: ErrorPanelProps) {
  return (
    <div className="clip-chamfer-tr-bl border border-rm-red/60 bg-rm-red-dim p-6 text-center">
      <div className="font-machine text-sm font-bold uppercase tracking-widest text-rm-red text-glow-red">
        {title}
      </div>
      <p className="mt-2 text-xs text-rm-metal-textMuted">{message}</p>
      <div className="mt-4 flex items-center justify-center gap-4">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="clip-chamfer-tr-bl border border-rm-red px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-rm-red transition-shadow hover:shadow-[0_0_15px_rgba(232,48,42,0.4)]"
          >
            重新连接
          </button>
        )}
        {backHref && (
          <Link
            href={backHref}
            className="text-xs uppercase tracking-widest text-rm-metal-textMuted transition-colors hover:text-white"
          >
            {backLabel}
          </Link>
        )}
      </div>
    </div>
  );
}

export interface EmptyStateProps {
  text: string;
  className?: string;
}

/**
 * 虚线切角空态框
 */
export function EmptyState({ text, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "clip-chamfer-tr-bl border border-dashed border-rm-metal-border p-6 text-center text-xs text-rm-metal-textMuted",
        className
      )}
    >
      {text}
    </div>
  );
}

export interface LoadingBlockProps {
  className?: string;
}

/**
 * 骨架加载块
 */
export function LoadingBlock({ className }: LoadingBlockProps) {
  return (
    <div
      className={cn(
        "clip-chamfer-tr-bl bg-rm-metal-raised animate-pulse",
        className
      )}
    />
  );
}
