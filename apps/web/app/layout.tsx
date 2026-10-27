import type { Metadata, Viewport } from "next";
import { Starfield } from "@/components/Starfield";
import "./globals.css";

export const metadata: Metadata = {
  title: "论文星图 PaperGalaxy",
  description: "AI 论文阅读器：双语对照翻译、论文脉络解读、可溯源问答",
};

export const viewport: Viewport = {
  themeColor: "#07080c",
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
