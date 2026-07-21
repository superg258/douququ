"use client";

import { useEffect, type ReactNode } from "react";

export function WorkspaceSearchModal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-in fade-in"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col border border-rm-metal-border bg-rm-metal-dark shadow-2xl clip-chamfer-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-rm-metal-border bg-rm-metal-panel p-4">
          <h3 className="font-machine uppercase tracking-widest text-white">{title}</h3>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="min-h-10 px-2 font-mono text-xs text-rm-metal-text hover:text-rm-red focus:outline-none"
          >
            关闭
          </button>
        </div>
        <div className="overflow-y-auto p-4 no-scrollbar">{children}</div>
      </div>
    </div>
  );
}
