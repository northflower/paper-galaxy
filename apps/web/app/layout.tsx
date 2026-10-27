import type { Metadata, Viewport } from "next";
import { Starfield } from "@/components/Starfield";
import "./globals.css";

export const metadata: Metadata = {
  title: "论文星图 PaperGalaxy",
  description: "AI 驱动的论文研读平台：研究轨迹拆解、术语一致的双语对照、可溯源问答",
};

export const viewport: Viewport = {
  themeColor: "#05060f",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <Starfield />
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
