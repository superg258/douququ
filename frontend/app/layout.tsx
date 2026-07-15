import "./globals.css";
import type { Metadata } from "next";
import { Quantico } from "next/font/google";
import { RootNav } from "@/components/root-nav";

const quantico = Quantico({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-quantico",
  display: "swap",
});

export const metadata: Metadata = {
  title: "RoboMaster 赛事总控台 | RMUC 2026 赛程与胜率预测",
  description: "RoboMaster 机甲大师 RMUC 2026 区域赛预测、复活赛与全国赛官方赛程总控台",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className="dark" suppressHydrationWarning>
      <body className={`min-h-screen bg-rm-metal-dark text-rm-metal-text antialiased ${quantico.variable}`}>
        <div className="flex min-h-screen w-full flex-col">
          <RootNav />
          <main className="flex-1 relative z-10 p-6 md:p-8">
            <div className="mx-auto max-w-screen-2xl h-full">
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
