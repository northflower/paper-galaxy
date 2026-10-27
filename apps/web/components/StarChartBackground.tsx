"use client";

import { useEffect, useRef } from "react";
import { createNebulaLayer } from "./nebulaLayer";

/**
 * 首页全屏背景：极光星云 + “星图仪”。
 * 底层是流动的极光粒子星云（见 nebulaLayer），前景是一台星图仪：
 * 以古代星盘（astrolabe）为灵感，用数万颗粒子构成一台缓慢运转的天体仪：
 * 带刻度的倾斜轨道环、经纬线星球、金色核心、拖着尾迹沿轨道运行的行星，外围是稀疏的星尘。
 * 远景是一张星图：亮星之间以细线连成星座；鼠标划过时，附近的星星被即时连成新的星座，
 * 仪器中的粒子被光标的“引力”轻轻吸引并点亮，整台星图仪随鼠标微微转动视角；点击激起一圈光波。
 */
export function StarChartBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    // 不透明画布 + 加色混合：粒子越密越亮，透明度不会在页面合成时被二次衰减
    const gl = canvas?.getContext("webgl2", { alpha: false, antialias: true });
    if (!canvas || !gl) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mobile = window.innerWidth < 768;

    const points = createProgram(gl, POINT_VS, POINT_FS);
    const lines = createProgram(gl, LINE_VS, LINE_FS);
    if (!points || !lines) return;

    const { data, count, stars } = buildScene(mobile ? 0.45 : 1);
    const nebula = createNebulaLayer(gl, createProgram, mobile ? 26000 : 72000);

    // 粒子缓冲
    const pointVao = gl.createVertexArray();
    gl.bindVertexArray(pointVao);
    const pointBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const pAttr = (name: string, size: number, offset: number) => {
      const loc = gl.getAttribLocation(points, name);
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, offset * 4);
    };
    pAttr("aKind", 1, 0);
    pAttr("aA", 4, 1);
    pAttr("aB", 2, 5);
    pAttr("aSize", 1, 7);
    pAttr("aColor", 3, 8);
    pAttr("aSeed", 1, 11);

    // 星座连线缓冲：每帧在 CPU 上生成（x, y, alpha）
    const MAX_SEG = 600;
    const lineData = new Float32Array(MAX_SEG * 2 * 3);
    const lineVao = gl.createVertexArray();
    gl.bindVertexArray(lineVao);
    const lineBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, lineData.byteLength, gl.DYNAMIC_DRAW);
    const lPos = gl.getAttribLocation(lines, "aPos");
    const lAlpha = gl.getAttribLocation(lines, "aAlpha");
    gl.enableVertexAttribArray(lPos);
    gl.vertexAttribPointer(lPos, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(lAlpha);
    gl.vertexAttribPointer(lAlpha, 1, gl.FLOAT, false, 12, 8);

    const pu = (n: string) => gl.getUniformLocation(points, n);
    const U = {
      time: pu("uTime"),
      res: pu("uRes"),
      dpr: pu("uDpr"),
      center: pu("uCenter"),
      scale: pu("uScale"),
      view: pu("uView"),
      mouse: pu("uMouse"),
      mouseOn: pu("uMouseOn"),
      parallax: pu("uParallax"),
      ripple: pu("uRipple"),
    };
    const lRes = gl.getUniformLocation(lines, "uRes");

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.clearColor(0.016, 0.018, 0.035, 1);

    const s = {
      w: 0,
      h: 0,
      dpr: 1,
      mouse: { x: -9999, y: -9999, tx: -9999, ty: -9999, on: 0, target: 0 },
      parallax: { x: 0, y: 0 },
      ripple: { x: 0, y: 0, t: -100 },
    };
    const center = () => ({ x: s.w * (mobile ? 0.5 : 0.5), y: s.h * (mobile ? 0.52 : 0.55) });
    const radius = () => Math.min(s.w * 0.36, s.h * 0.46) * (mobile ? 1.25 : 1);

    const resize = () => {
      s.dpr = Math.min(window.devicePixelRatio || 1, 2);
      s.w = window.innerWidth;
      s.h = window.innerHeight;
      canvas.width = Math.floor(s.w * s.dpr);
      canvas.height = Math.floor(s.h * s.dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    const onMove = (e: PointerEvent) => {
      s.mouse.tx = e.clientX;
      s.mouse.ty = e.clientY;
      if (s.mouse.x < -999) {
        s.mouse.x = e.clientX;
        s.mouse.y = e.clientY;
      }
      s.mouse.target = 1;
    };
    const onLeave = () => (s.mouse.target = 0);
    const start = performance.now() / 1000;
    const onDown = (e: PointerEvent) => (s.ripple = { x: e.clientX, y: e.clientY, t: performance.now() / 1000 - start });
    const onScroll = () => {
      canvas.style.opacity = String(Math.max(0.35, 1 - window.scrollY / (s.h * 0.9)));
    };

    // 远景星点的屏幕坐标：与着色器中 kind = 4 的公式一致
    const starScreen = (st: Star) => ({
      x: (st.x * 0.5 + 0.5) * s.w - s.parallax.x * 36 * (1 - st.depth),
      y: (st.y * 0.5 + 0.5) * s.h - s.parallax.y * 24 * (1 - st.depth),
    });

    let raf = 0;
    const frame = () => {
      const t = reduced ? 40 : performance.now() / 1000 - start + 40;
      const m = s.mouse;
      m.x += (m.tx - m.x) * 0.1;
      m.y += (m.ty - m.y) * 0.1;
      m.on += (m.target - m.on) * 0.05;
      const px = m.x > -999 ? m.x / s.w - 0.5 : 0;
      const py = m.y > -999 ? m.y / s.h - 0.5 : 0;
      s.parallax.x += (px - s.parallax.x) * 0.03;
      s.parallax.y += (py - s.parallax.y) * 0.03;

      // 视角：固定俯角 + 缓慢自转，并随鼠标轻微偏转
      const view = viewMatrix(0.5 + s.parallax.y * 0.3, t * 0.035 + s.parallax.x * 0.6, -0.28);
      const c = center();

      gl.clear(gl.COLOR_BUFFER_BIT);

      // 0. 底层极光星云
      nebula?.draw({
        time: t,
        w: s.w,
        h: s.h,
        dpr: s.dpr,
        mouse: [m.x, m.y, m.on],
        parallax: [s.parallax.x, s.parallax.y],
        ripple: [s.ripple.x, s.ripple.y, s.ripple.t + 40],
      });

      // 1. 星座连线
      let n = 0;
      const push = (ax: number, ay: number, bx: number, by: number, alpha: number) => {
        if (n >= MAX_SEG) return;
        lineData.set([ax, ay, alpha, bx, by, alpha], n * 6);
        n++;
      };
      const pos = stars.map(starScreen);
      for (const [a, b] of CONSTELLATIONS(stars)) {
        const twinkle = 0.75 + 0.25 * Math.sin(t * 0.5 + a);
        push(pos[a].x, pos[a].y, pos[b].x, pos[b].y, 0.11 * twinkle);
      }
      if (m.on > 0.02) {
        // 鼠标附近的星星即时连成星座
        const near = pos
          .map((p, i) => ({ i, d: Math.hypot(p.x - m.x, p.y - m.y) }))
          .filter((o) => o.d < 210)
          .sort((a, b) => a.d - b.d)
          .slice(0, 7);
        for (const o of near) push(m.x, m.y, pos[o.i].x, pos[o.i].y, (1 - o.d / 210) * 0.5 * m.on);
        for (let i = 0; i < near.length; i++)
          for (let j = i + 1; j < near.length; j++) {
            const a = pos[near[i].i];
            const b = pos[near[j].i];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d < 150) push(a.x, a.y, b.x, b.y, (1 - d / 150) * 0.28 * m.on);
          }
      }
      gl.useProgram(lines);
      gl.uniform2f(lRes, s.w, s.h);
      gl.bindVertexArray(lineVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, lineData.subarray(0, n * 6));
      gl.drawArrays(gl.LINES, 0, n * 2);

      // 2. 粒子
      gl.useProgram(points);
      gl.bindVertexArray(pointVao);
      gl.uniform1f(U.time, t);
      gl.uniform2f(U.res, s.w, s.h);
      gl.uniform1f(U.dpr, s.dpr);
      gl.uniform2f(U.center, c.x, c.y);
      gl.uniform1f(U.scale, radius());
      gl.uniformMatrix3fv(U.view, false, view);
      gl.uniform2f(U.mouse, m.x, m.y);
      gl.uniform1f(U.mouseOn, m.on);
      gl.uniform2f(U.parallax, s.parallax.x, s.parallax.y);
      gl.uniform3f(U.ripple, s.ripple.x, s.ripple.y, s.ripple.t + 40);
      gl.drawArrays(gl.POINTS, 0, count);

      if (!reduced) raf = requestAnimationFrame(frame);
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(frame);
    };

    resize();
    onScroll();
    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      gl.deleteBuffer(pointBuf);
      gl.deleteBuffer(lineBuf);
      gl.deleteVertexArray(pointVao);
      gl.deleteVertexArray(lineVao);
      gl.deleteProgram(points);
      gl.deleteProgram(lines);
      nebula?.dispose();
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#040509]">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {/* 暗角与标题区压暗，保证前景文字清晰 */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_55%,transparent_45%,rgba(2,3,7,0.7)_100%)]" />
      <div className="absolute inset-x-0 top-0 h-[38vh] bg-[radial-gradient(ellipse_55%_70%_at_50%_25%,rgba(3,4,9,0.6),transparent_72%)]" />
    </div>
  );
}

/** 视图旋转矩阵：先绕 Y 轴自转（yaw），再绕 X 轴俯仰（pitch），最后绕视线轴倾斜（roll） */
function viewMatrix(pitch: number, yaw: number, roll: number) {
  const [cp, sp, cy, sy, cr, sr] = [Math.cos(pitch), Math.sin(pitch), Math.cos(yaw), Math.sin(yaw), Math.cos(roll), Math.sin(roll)];
  const Ry = [cy, 0, -sy, 0, 1, 0, sy, 0, cy];
  const Rx = [1, 0, 0, 0, cp, sp, 0, -sp, cp];
  const Rz = [cr, sr, 0, -sr, cr, 0, 0, 0, 1];
  // 列主序 3x3 乘法
  const mul = (a: number[], b: number[]) => {
    const o = new Array(9).fill(0);
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) o[c * 3 + r] += a[k * 3 + r] * b[c * 3 + k];
    return o;
  };
  return new Float32Array(mul(Rz, mul(Rx, Ry)));
}

interface Star {
  x: number;
  y: number;
  depth: number;
}

// 星座：每颗亮星连向最近的一两颗，形成稀疏的星图网络（只计算一次）
let constellationCache: [number, number][] | null = null;
function CONSTELLATIONS(stars: Star[]) {
  if (constellationCache) return constellationCache;
  const edges: [number, number][] = [];
  const degree = new Array(stars.length).fill(0);
  stars.forEach((a, i) => {
    if (i % 3 === 0) return; // 留出一部分孤星
    const nearest = stars
      .map((b, j) => ({ j, d: Math.hypot((a.x - b.x) * 1.6, a.y - b.y) }))
      .filter((o) => o.j !== i && o.d < 0.22)
      .sort((p, q) => p.d - q.d)
      .slice(0, 2);
    for (const o of nearest) {
      if (degree[i] >= 3 || degree[o.j] >= 3) continue;
      if (edges.some(([p, q]) => (p === o.j && q === i) || (p === i && q === o.j))) continue;
      edges.push([i, o.j]);
      degree[i]++;
      degree[o.j]++;
    }
  });
  constellationCache = edges;
  return edges;
}

const STRIDE = 12;

/**
 * 粒子类型（aKind）与参数：
 * 0 轨道环 / 刻度：aA = (半径, 初始角, 倾角 a, 倾角 b)，aB = (角速度, 径向偏移)
 * 1 经纬线星球：aA.xyz = 球面坐标，aB.x = 自转速度
 * 2 核心：aA.xyz = 位置
 * 3 行星与尾迹：aA 同轨道环，aB = (角速度, 尾迹序号)
 * 4 远景星点：aA = (屏幕 x, 屏幕 y, 深度)
 * 5 星尘：aA.xyz = 盘面内的位置
 */
function buildScene(density: number) {
  const parts: number[] = [];
  const add = (kind: number, a: number[], b: number[], size: number, color: number[], seed = Math.random()) =>
    parts.push(kind, a[0], a[1], a[2] ?? 0, a[3] ?? 0, b[0] ?? 0, b[1] ?? 0, size, color[0], color[1], color[2], seed);
  const gauss = () => {
    let u = 0;
    let v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const N = (x: number) => Math.round(x * density);
  const ICE = [0.62, 0.86, 1.0];
  const INDIGO = [0.6, 0.66, 1.0];
  const BRASS = [1.0, 0.8, 0.46];
  const LAVENDER = [0.78, 0.74, 1.0];

  // 轨道环：半径、倾角、角速度、颜色、是否虚线
  const rings = [
    { r: 0.42, a: 0.0, b: 0.0, sp: 0.16, color: BRASS, dashed: false },
    { r: 0.62, a: 0.35, b: 0.6, sp: -0.1, color: ICE, dashed: true },
    { r: 0.78, a: -0.22, b: 1.9, sp: 0.07, color: INDIGO, dashed: false },
    { r: 0.95, a: 0.12, b: 3.1, sp: -0.05, color: ICE, dashed: true },
    { r: 1.15, a: -0.05, b: 0.3, sp: 0.035, color: BRASS, dashed: false },
    { r: 1.42, a: 0.08, b: 2.4, sp: -0.022, color: LAVENDER, dashed: true },
  ];
  rings.forEach((ring, ri) => {
    // 环线
    for (let i = 0; i < N(3600); i++) {
      const th = Math.random() * Math.PI * 2;
      // 虚线环：每 15° 留一段空隙
      if (ring.dashed && (th / (Math.PI / 12)) % 1 > 0.62) continue;
      add(0, [ring.r, th, ring.a, ring.b], [ring.sp, gauss() * 0.004], 0.8 + Math.random() * 0.9, ring.color.map((c) => c * (0.5 + Math.random() * 0.4)));
    }
    // 刻度：每 5° 一个短刻度，每 30° 一个长刻度
    const ticks = ri % 2 === 0 ? 72 : 36;
    for (let k = 0; k < ticks; k++) {
      const th = (k / ticks) * Math.PI * 2;
      const major = k % (ticks / 12) === 0;
      const len = major ? 0.06 : 0.025;
      for (let j = 0; j < N(major ? 26 : 10); j++) {
        add(0, [ring.r, th + gauss() * 0.002, ring.a, ring.b], [ring.sp, Math.random() * len], major ? 1.5 : 1.1, major ? BRASS : ring.color, Math.random());
      }
    }
  });

  // 经纬线星球
  const R0 = 0.26;
  for (let m = 0; m < 8; m++) {
    const lon = (m / 8) * Math.PI;
    for (let i = 0; i < N(260); i++) {
      const lat = Math.random() * Math.PI * 2;
      add(1, [R0 * Math.cos(lat) * Math.cos(lon), R0 * Math.sin(lat), R0 * Math.cos(lat) * Math.sin(lon)], [0.12], 0.8, INDIGO.map((c) => c * 0.55));
    }
  }
  for (let p = 1; p < 6; p++) {
    const lat = -Math.PI / 2 + (p / 6) * Math.PI;
    for (let i = 0; i < N(260); i++) {
      const lon = Math.random() * Math.PI * 2;
      add(1, [R0 * Math.cos(lat) * Math.cos(lon), R0 * Math.sin(lat), R0 * Math.cos(lat) * Math.sin(lon)], [0.12], 0.8, ICE.map((c) => c * 0.5));
    }
  }

  // 核心：金色的致密光团
  for (let i = 0; i < N(2600); i++) {
    const r = Math.abs(gauss()) * 0.05;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    add(2, [r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th)], [], 1 + Math.random() * 2.2, BRASS.map((c) => c * (0.7 + Math.random() * 0.5)));
  }

  // 行星：沿第 1、3、5、6 环运行，带渐隐尾迹
  [0, 2, 4, 5].forEach((ri, pi) => {
    const ring = rings[ri];
    const th0 = pi * 1.7;
    const color = pi % 2 ? ICE : BRASS;
    for (let k = 0; k < 90; k++) add(3, [ring.r, th0, ring.a, ring.b], [ring.sp, k], k === 0 ? 7 : Math.max(0.8, 3.2 - k * 0.03), color);
  });

  // 星尘：沿盘面稀疏分布
  for (let i = 0; i < N(9000); i++) {
    const r = 0.3 + Math.pow(Math.random(), 0.7) * 1.5;
    const th = Math.random() * Math.PI * 2;
    add(5, [Math.cos(th) * r, gauss() * 0.06 * r, Math.sin(th) * r], [], 0.6 + Math.random() * 0.9, (Math.random() < 0.3 ? BRASS : LAVENDER).map((c) => c * (0.12 + Math.random() * 0.2)));
  }

  // 远景星点：其中最亮的一批用于星座连线
  const stars: Star[] = [];
  for (let i = 0; i < N(2400); i++) {
    const x = Math.random() * 2 - 1;
    const y = Math.random() * 2 - 1;
    const depth = Math.random();
    const bright = i < 170;
    if (bright) stars.push({ x, y, depth });
    add(4, [x, y, depth], [], bright ? 1.8 + Math.random() * 1.6 : 0.5 + Math.random() * 1.1, bright ? (Math.random() < 0.25 ? BRASS : [0.9, 0.93, 1]) : [0.62, 0.66, 0.85]);
  }

  return { data: new Float32Array(parts), count: parts.length / STRIDE, stars };
}

function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const compile = (type: number, src: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn("[starchart]", gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  };
  const v = compile(gl.VERTEX_SHADER, vs);
  const f = compile(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const program = gl.createProgram()!;
  gl.attachShader(program, v);
  gl.attachShader(program, f);
  gl.linkProgram(program);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("[starchart]", gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

const POINT_VS = /* glsl */ `#version 300 es
precision highp float;
in float aKind;
in vec4 aA;
in vec2 aB;
in float aSize;
in vec3 aColor;
in float aSeed;
uniform float uTime;
uniform vec2 uRes;
uniform float uDpr;
uniform vec2 uCenter;
uniform float uScale;
uniform mat3 uView;
uniform vec2 uMouse;
uniform float uMouseOn;
uniform vec2 uParallax;
uniform vec3 uRipple;
out vec3 vColor;
out float vAlpha;

// 轨道环上的点：环位于 XZ 平面，先绕 X 轴倾斜 a，再绕 Y 轴旋转 b
vec3 ringPoint(float r, float th, float a, float b) {
  vec3 p = vec3(cos(th) * r, 0.0, sin(th) * r);
  p = vec3(p.x, p.y * cos(a) - p.z * sin(a), p.y * sin(a) + p.z * cos(a));
  return vec3(p.x * cos(b) + p.z * sin(b), p.y, -p.x * sin(b) + p.z * cos(b));
}

void main() {
  float t = uTime;
  vec3 color = aColor;
  float alpha = 1.0;
  float size = aSize;
  vec2 scr;
  float persp = 1.0;

  if (aKind > 3.5 && aKind < 4.5) {
    // 远景星点：屏幕空间，随鼠标做视差
    scr = vec2((aA.x * 0.5 + 0.5) * uRes.x, (aA.y * 0.5 + 0.5) * uRes.y) - uParallax * vec2(36.0, 24.0) * (1.0 - aA.z);
    alpha = 0.45 + 0.55 * (0.5 + 0.5 * sin(t * (0.6 + aSeed * 1.8) + aSeed * 50.0));
  } else {
    vec3 p;
    if (aKind < 0.5) {
      // 轨道环与刻度
      float th = aA.y + t * aB.x;
      p = ringPoint(aA.x + aB.y, th, aA.z, aA.w);
      alpha = 0.85;
    } else if (aKind < 1.5) {
      // 经纬线星球：绕自身轴自转
      float c = cos(t * aB.x), s = sin(t * aB.x);
      p = vec3(aA.x * c + aA.z * s, aA.y, -aA.x * s + aA.z * c);
      alpha = 0.7;
    } else if (aKind < 2.5) {
      // 核心：轻微呼吸
      p = aA.xyz * (1.0 + 0.08 * sin(t * 1.3));
      alpha = 0.9;
    } else if (aKind < 3.5) {
      // 行星与尾迹：尾迹点沿轨道落后于行星
      float dir = sign(aB.x);
      float th = aA.y + t * aB.x * 1.6 - dir * aB.y * 0.012;
      p = ringPoint(aA.x, th, aA.z, aA.w);
      alpha = aB.y < 0.5 ? 1.0 : pow(1.0 - aB.y / 90.0, 1.6) * 0.75;
      if (aB.y < 0.5) color = mix(color, vec3(1.0), 0.5);
    } else {
      // 星尘：随盘面缓慢转动
      float w = 0.02 / (length(aA.xz) + 0.4);
      float c = cos(t * w), s = sin(t * w);
      p = vec3(aA.x * c + aA.z * s, aA.y, -aA.x * s + aA.z * c);
      alpha = 0.8;
    }
    p = uView * p;
    persp = 3.4 / (3.4 + p.z);
    scr = uCenter + vec2(p.x, -p.y) * uScale * persp;
    // 远处的半边更暗，增强立体感
    alpha *= clamp(0.55 + 0.45 * persp, 0.35, 1.2);
  }

  // 鼠标：引力——粒子被轻轻吸向光标并点亮（与常见的“推开”相反）
  vec2 d = uMouse - scr;
  float dist = max(length(d), 1.0);
  float f = exp(-(dist * dist) / (150.0 * 150.0)) * uMouseOn;
  scr += d / dist * f * min(dist * 0.35, 26.0);
  float glow = f;

  // 点击：一圈向外扩散的光波
  float age = t - uRipple.z;
  if (age > 0.0 && age < 3.0) {
    vec2 dc = scr - uRipple.xy;
    float dl = max(length(dc), 1.0);
    float wv = exp(-pow(dl - age * 480.0, 2.0) / 2600.0) * exp(-age * 1.2);
    scr += dc / dl * wv * 18.0;
    glow += wv * 1.6;
  }

  gl_Position = vec4(scr.x / uRes.x * 2.0 - 1.0, 1.0 - scr.y / uRes.y * 2.0, 0.0, 1.0);
  gl_PointSize = size * 1.5 * uDpr * persp * (1.0 + glow * 0.9);
  vColor = color * 1.2 * (1.0 + glow * 0.9);
  vAlpha = alpha;
}
`;

const POINT_FS = /* glsl */ `#version 300 es
precision mediump float;
in vec3 vColor;
in float vAlpha;
out vec4 outColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float core = 1.0 - smoothstep(0.0, 0.22, d);
  float halo = 1.0 - smoothstep(0.0, 0.5, d);
  outColor = vec4(vColor, (core * 0.85 + halo * halo * 0.4) * vAlpha);
}
`;

const LINE_VS = /* glsl */ `#version 300 es
in vec2 aPos;
in float aAlpha;
uniform vec2 uRes;
out float vAlpha;
void main() {
  gl_Position = vec4(aPos.x / uRes.x * 2.0 - 1.0, 1.0 - aPos.y / uRes.y * 2.0, 0.0, 1.0);
  vAlpha = aAlpha;
}
`;

const LINE_FS = /* glsl */ `#version 300 es
precision mediump float;
in float vAlpha;
out vec4 outColor;
void main() {
  outColor = vec4(0.72, 0.78, 1.0, vAlpha);
}
`;
