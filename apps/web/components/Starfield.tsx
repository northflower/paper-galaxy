"use client";

import { useEffect, useRef } from "react";

interface Star {
  x: number;
  y: number;
  z: number;
  r: number;
  phase: number;
  hue: number;
}

/**
 * 全局星空背景：Canvas 2D 绘制带视差与闪烁的星点 + 星云光晕。
 * 页面不可见时暂停动画，尊重“减少动态效果”系统设置。
 */
export function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let stars: Star[] = [];
    let raf = 0;
    let w = 0;
    let h = 0;
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round((w * h) / 6500);
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        z: Math.random() ** 2,
        r: Math.random() * 1.2 + 0.2,
        phase: Math.random() * Math.PI * 2,
        hue: 225 + Math.random() * 40,
      }));
    };

    const draw = (t: number) => {
      pointer.x += (pointer.tx - pointer.x) * 0.04;
      pointer.y += (pointer.ty - pointer.y) * 0.04;
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        // 近处的星（z 大）视差更明显、缓慢漂移
        const drift = reduced ? 0 : t * 0.004 * (0.2 + s.z);
        const x = (s.x + drift + pointer.x * s.z * 18 + w) % w;
        const y = s.y + pointer.y * s.z * 18;
        const twinkle = reduced ? 1 : 0.55 + 0.45 * Math.sin(t * 0.0015 + s.phase);
        const alpha = (0.15 + s.z * 0.55) * twinkle;
        ctx.beginPath();
        ctx.fillStyle = `hsla(${s.hue}, 60%, 88%, ${alpha})`;
        ctx.arc(x, y, s.r * (0.6 + s.z), 0, Math.PI * 2);
        ctx.fill();
      }
      if (!reduced) raf = requestAnimationFrame(draw);
    };

    const onMove = (e: PointerEvent) => {
      pointer.tx = e.clientX / w - 0.5;
      pointer.ty = e.clientY / h - 0.5;
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* 极淡的星云：顶部一束冷光，右下一抹紫 */}
      <div className="absolute left-1/2 top-[-28rem] h-[48rem] w-[72rem] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(120,134,255,0.16),transparent_62%)]" />
      <div className="absolute -bottom-72 -right-40 h-[40rem] w-[40rem] rounded-full bg-[radial-gradient(circle,rgba(168,120,255,0.07),transparent_65%)]" />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
