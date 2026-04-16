import type { Metadata } from "next";
import { Noto_Sans_SC, Rajdhani } from "next/font/google";
import "@/app/globals.css";

const bodyFont = Noto_Sans_SC({
  variable: "--font-body",
  weight: ["400", "500", "700", "900"],
  preload: false,
});

const techFont = Rajdhani({
  subsets: ["latin"],
  variable: "--font-tech",
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "RMUC 2026 赛程模拟总控台",
  description: "查看三大赛区的资格赛、主淘汰赛、最终排名与 Elo 对照。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className={`${bodyFont.variable} ${techFont.variable} rmuc-app`}>{children}</body>
    </html>
  );
}
