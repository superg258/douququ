import * as React from "react";
import { cn } from "@/lib/utils";

export interface BattleBadgeProps {
  className?: string;
  teamRed: string;
  teamBlue: string;
  scoreRed?: number;
  scoreBlue?: number;
  winner?: "red" | "blue" | "draw" | null;
  // 控制是否采用高对比度的胶囊风格，或更紧凑的文本行
  size?: "sm" | "lg";
}

/**
 * 红蓝对抗的交战牌
 * 解决原版“胜负不明显”和“红色色盲区”问题：
 *  - 获胜方：高亮全彩发光
 *  - 战败方：灰度降低透明度，文字降维
 *  - 高对比度，拒绝含糊不清的色调
 */
export function BattleBadge({
  className,
  teamRed,
  teamBlue,
  scoreRed,
  scoreBlue,
  winner,
  size = "lg"
}: BattleBadgeProps) {
  const isLg = size === "lg";

  return (
    <div className={cn("grid grid-cols-[1fr_auto_1fr] bg-rm-metal-dark border border-rm-metal-border font-mono relative overflow-hidden", 
      isLg ? "text-sm" : "text-xs",
      className
    )}>
      {/* Blue Team (Left) */}
      <div 
        className={cn(
          "flex items-center justify-between px-3 py-1.5 transition-all duration-300",
          winner === "blue" 
            ? "bg-rm-blue text-white shadow-[inset_0_0_12px_rgba(0,163,255,0.8)] font-bold" 
            : winner === "red" 
              ? "bg-black/40 text-rm-metal-text line-through opacity-60" 
              : "bg-rm-blue-dim text-rm-blue font-medium"
        )}
      >
        <span className="truncate pr-2">{teamBlue}</span>
        <span className={cn("font-bold font-machine", winner === "blue" && "text-glow-blue")}>
          {scoreBlue ?? '-'}
        </span>
      </div>

      {/* VS divider */}
      <div className="flex items-center justify-center bg-rm-metal-panel px-1.5 text-[0.6rem] text-rm-metal-text border-x border-rm-metal-border/50 font-sans tracking-widest z-10 z-10 box-border skew-x-[-15deg]">
        <div className="skew-x-[15deg]">VS</div>
      </div>

      {/* Red Team (Right) */}
      <div 
        className={cn(
          "flex items-center justify-between px-3 py-1.5 transition-all duration-300",
          winner === "red" 
            ? "bg-rm-red text-white shadow-[inset_0_0_12px_rgba(230,0,0,0.8)] font-bold text-glow-red" 
            : winner === "blue" 
              ? "bg-black/40 text-rm-metal-text line-through opacity-60" 
              : "bg-rm-red-dim text-rm-red font-medium"
        )}
      >
        <span className={cn("font-bold font-machine text-left")}>
          {scoreRed ?? '-'}
        </span>
        <span className="truncate pl-2 text-right">{teamRed}</span>
      </div>
    </div>
  );
}
