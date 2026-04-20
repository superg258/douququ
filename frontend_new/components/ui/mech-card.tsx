import * as React from "react";
import { cn } from "@/lib/utils";

export interface MechCardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "red" | "blue" | "safe";
  label?: string; // 标题
}

/**
 * 机械风战术面板容器
 * 采用多边形切角设计，配合暗色底透明度与发光边缘
 */
const MechCard = React.forwardRef<HTMLDivElement, MechCardProps>(
  ({ className, variant = "default", label, children, ...props }, ref) => {
    
    const variantStyles = {
      default: "border-rm-metal-border bg-rm-metal-panel/90 text-rm-metal-text backdrop-blur-md",
      red: "border-rm-red bg-rm-red-dim text-rm-red backdrop-blur-md shadow-[0_0_15px_rgba(230,0,0,0.2)]",
      blue: "border-rm-blue bg-rm-blue-dim text-rm-blue backdrop-blur-md shadow-[0_0_15px_rgba(0,163,255,0.2)]",
      safe: "border-rm-status-safe bg-rm-status-safe/10 text-rm-status-safe backdrop-blur-md shadow-[0_0_15px_rgba(0,255,157,0.2)]",
    };

    return (
      <div 
        ref={ref}
        className={cn(
          "relative flex flex-col clip-chamfer-tr-bl p-4 @container overflow-hidden border transition-colors",
          variantStyles[variant],
          className
        )}
        {...props}
      >
        {/* 左上/右下 发光机甲点线 */}
        <div className="absolute top-1 left-2 h-1 w-6 bg-current opacity-50" />
        <div className="absolute bottom-1 right-2 h-1 w-6 bg-current opacity-50" />
        
        {label && (
          <div className="mb-2 border-b border-current/30 pb-1 text-[11px] font-bold uppercase tracking-[0.2em] opacity-80">
            {label}
            <span className="ml-2 inline-block h-2 w-2 rounded-none bg-current animate-pulse" />
          </div>
        )}
        {children}
      </div>
    );
  }
);

MechCard.displayName = "MechCard";

export { MechCard };
