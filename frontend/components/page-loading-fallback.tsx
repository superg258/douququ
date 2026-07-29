interface PageLoadingFallbackProps {
  label?: string;
}

export function PageLoadingFallback({
  label = "正在加载赛程数据...",
}: PageLoadingFallbackProps) {
  return (
    <main
      className="flex min-h-screen items-center justify-center px-4"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="clip-chamfer-tr-bl border border-rm-blue/40 bg-rm-metal-panel px-8 py-6 text-center shadow-lg">
        <div
          className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-rm-blue/20 border-t-rm-blue"
          aria-hidden="true"
        />
        <p className="font-mono text-xs tracking-widest text-rm-blue">{label}</p>
      </div>
    </main>
  );
}
