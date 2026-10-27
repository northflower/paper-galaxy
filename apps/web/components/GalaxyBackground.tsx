"use client";

import { useEffect, useRef } from "react";

/**
 * 首页粒子星系：WebGL 在 GPU 上绘制数万颗粒子组成的旋涡星系。
 * 内圈转得快、外圈转得慢（较差自转）；鼠标靠近时粒子被推开并卷成小漩涡，
 * 点击会激起一圈向外扩散的冲击波；视角随鼠标轻微倾斜，产生立体感。
 */
export function GalaxyBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl2", { alpha: true, antialias: false, premultipliedAlpha: false });
    if (!canvas || !gl) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mobile = window.innerWidth < 768;
    const count = mobile ? 14000 : 36000;

    const program = createProgram(gl, VERTEX, FRAGMENT);
    if (!program) return;
    gl.useProgram(program);

    // 粒子属性：极坐标半径、角度、盘面高度、大小、颜色、随机种子
    const data = buildGalaxy(count);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const stride = STRIDE * 4;
    const attr = (name: string, size: number, offset: number) => {
      const loc = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4);
    };
    attr("aR", 1, 0);
    attr("aTheta", 1, 1);
    attr("aY", 1, 2);
    attr("aSize", 1, 3);
    attr("aColor", 3, 4);
    attr("aSeed", 1, 7);

    const u = (name: string) => gl.getUniformLocation(program, name);
    const uni = {
      time: u("uTime"),
      res: u("uRes"),
      center: u("uCenter"),
      scale: u("uScale"),
      dpr: u("uDpr"),
      mouse: u("uMouse"),
      mouseOn: u("uMouseOn"),
      tilt: u("uTilt"),
      spin: u("uSpin"),
      click: u("uClick"),
    };

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.clearColor(0, 0, 0, 0);

    const state = {
      w: 0,
      h: 0,
      dpr: 1,
      mouse: { x: -9999, y: -9999, tx: -9999, ty: -9999, on: 0, target: 0 },
      parallax: { x: 0, y: 0 },
      click: { x: 0, y: 0, t: -100 },
      opacity: 1,
    };

    const center = () => ({ x: state.w * 0.5, y: state.h * (mobile ? 0.5 : 0.56) });
    const radius = () => Math.min(state.w * 0.4, state.h * 0.55) * (mobile ? 1.15 : 1);

    const resize = () => {
      state.dpr = Math.min(window.devicePixelRatio || 1, 2);
      state.w = window.innerWidth;
      state.h = window.innerHeight;
      canvas.width = Math.floor(state.w * state.dpr);
      canvas.height = Math.floor(state.h * state.dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      // 星系核心的暖色辉光用 CSS 绘制，位置与粒子中心对齐
      const glow = glowRef.current;
      if (glow) {
        const c = center();
        const r = radius();
        glow.style.left = `${c.x}px`;
        glow.style.top = `${c.y}px`;
        glow.style.width = glow.style.height = `${r * 1.5}px`;
      }
    };

    const onMove = (e: PointerEvent) => {
      state.mouse.tx = e.clientX;
      state.mouse.ty = e.clientY;
      if (state.mouse.x < -999) {
        state.mouse.x = e.clientX;
        state.mouse.y = e.clientY;
      }
      state.mouse.target = 1;
    };
    const onLeave = () => (state.mouse.target = 0);
    const onDown = (e: PointerEvent) => {
      state.click = { x: e.clientX, y: e.clientY, t: performance.now() / 1000 };
    };
    // 向下滚动时星系渐隐，不干扰下方的论文列表
    const onScroll = () => {
      state.opacity = Math.max(0.28, 1 - window.scrollY / (state.h * 0.9));
      canvas.style.opacity = String(state.opacity);
      if (glowRef.current) glowRef.current.style.opacity = String(state.opacity);
    };

    let raf = 0;
    const start = performance.now() / 1000;
    const frame = () => {
      const now = performance.now() / 1000;
      const m = state.mouse;
      m.x += (m.tx - m.x) * 0.12;
      m.y += (m.ty - m.y) * 0.12;
      m.on += (m.target - m.on) * 0.05;
      const px = m.x > -999 ? m.x / state.w - 0.5 : 0;
      const py = m.y > -999 ? m.y / state.h - 0.5 : 0;
      state.parallax.x += (px - state.parallax.x) * 0.03;
      state.parallax.y += (py - state.parallax.y) * 0.03;

      const c = center();
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uni.time, reduced ? 20 : now - start + 20);
      gl.uniform2f(uni.res, state.w, state.h);
      gl.uniform2f(uni.center, c.x, c.y);
      gl.uniform1f(uni.scale, radius());
      gl.uniform1f(uni.dpr, state.dpr);
      gl.uniform2f(uni.mouse, m.x, m.y);
      gl.uniform1f(uni.mouseOn, m.on);
      gl.uniform1f(uni.tilt, 0.92 + state.parallax.y * 0.22);
      gl.uniform1f(uni.spin, -0.38 + state.parallax.x * 0.18);
      gl.uniform3f(uni.click, state.click.x, state.click.y, state.click.t - start + 20);
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
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        ref={glowRef}
        className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(255,226,190,0.30) 0%, rgba(255,190,150,0.10) 14%, rgba(130,140,255,0.08) 34%, transparent 62%)",
        }}
      />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}

const STRIDE = 8;

/** 生成旋涡星系：核球 + 旋臂 + 弥散晕 */
function buildGalaxy(count: number) {
  const out = new Float32Array(count * STRIDE);
  const ARMS = 3;
  const TWIST = 4.6;
  const gauss = () => {
    let u = 0;
    let v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const mix = (a: number[], b: number[], t: number) => a.map((x, i) => x + (b[i] - x) * t);
  const CORE_A = [1.0, 0.95, 0.86];
  const CORE_B = [1.0, 0.78, 0.55];
  const ARM_IN = [0.82, 0.86, 1.0];
  const ARM_OUT = [0.42, 0.45, 1.0];
  const PINK = [1.0, 0.55, 0.8];
  const CYAN = [0.5, 0.88, 1.0];
  const HALO = [0.55, 0.58, 0.8];

  for (let i = 0; i < count; i++) {
    const roll = Math.random();
    let r: number;
    let theta: number;
    let y: number;
    let size: number;
    let color: number[];

    if (roll < 0.16) {
      // 核球：高斯分布的暖色密集恒星
      r = Math.abs(gauss()) * 0.11;
      theta = Math.random() * Math.PI * 2;
      y = gauss() * 0.045 * (1 - r * 3);
      size = 1.1 + Math.random() * 1.6;
      color = mix(CORE_A, CORE_B, Math.random()).map((c) => c * (0.6 + Math.random() * 0.4));
    } else if (roll < 0.94) {
      // 旋臂：对数螺线 + 随半径增大的横向弥散
      const arm = Math.floor(Math.random() * ARMS);
      const base = 0.06 + Math.pow(Math.random(), 0.75) * 0.94;
      const angle = (arm / ARMS) * Math.PI * 2 + base * TWIST;
      const spread = 0.018 + base * 0.042;
      const x = Math.cos(angle) * base + gauss() * spread;
      const z = Math.sin(angle) * base + gauss() * spread;
      r = Math.hypot(x, z);
      theta = Math.atan2(z, x);
      y = gauss() * 0.018 * (1.2 - r);
      const t = Math.random();
      color =
        t < 0.06 ? PINK : t < 0.16 ? CYAN : mix(ARM_IN, ARM_OUT, Math.min(1, r * 1.1)).map((c) => c * (0.75 + Math.random() * 0.45));
      size = Math.random() < 0.025 ? 2.6 + Math.random() * 1.6 : 0.7 + Math.random() * 1.2;
    } else {
      // 弥散晕：稀疏暗淡的背景恒星
      r = 0.2 + Math.random() * 1.15;
      theta = Math.random() * Math.PI * 2;
      y = gauss() * 0.18;
      size = 0.5 + Math.random() * 0.8;
      color = HALO.map((c) => c * (0.35 + Math.random() * 0.4));
    }
    const o = i * STRIDE;
    out[o] = r;
    out[o + 1] = theta;
    out[o + 2] = y;
    out[o + 3] = size;
    out[o + 4] = color[0];
    out[o + 5] = color[1];
    out[o + 6] = color[2];
    out[o + 7] = Math.random();
  }
  return out;
}

function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const compile = (type: number, src: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn("[galaxy]", gl.getShaderInfoLog(shader));
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
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

const VERTEX = /* glsl */ `#version 300 es
in float aR;
in float aTheta;
in float aY;
in float aSize;
in vec3 aColor;
in float aSeed;
uniform float uTime;
uniform vec2 uRes;
uniform vec2 uCenter;
uniform float uScale;
uniform float uDpr;
uniform vec2 uMouse;
uniform float uMouseOn;
uniform float uTilt;
uniform float uSpin;
uniform vec3 uClick;
out vec3 vColor;
out float vAlpha;

void main() {
  // 较差自转：内圈角速度大
  float th = aTheta + uTime * 0.028 / (aR + 0.18);
  vec3 p = vec3(cos(th) * aR, aY, sin(th) * aR);
  // 倾斜盘面，再绕视线轴旋转
  float ct = cos(uTilt), st = sin(uTilt);
  p = vec3(p.x, p.y * ct - p.z * st, p.y * st + p.z * ct);
  float cs = cos(uSpin), ss = sin(uSpin);
  p.xy = vec2(p.x * cs - p.y * ss, p.x * ss + p.y * cs);
  float persp = 2.4 / (2.4 + p.z);
  vec2 s = uCenter + vec2(p.x, -p.y) * uScale * persp;

  // 鼠标：推开粒子并带一点切向旋转，形成小漩涡
  vec2 d = s - uMouse;
  float dist = max(length(d), 1.0);
  float R = 140.0;
  float f = exp(-(dist * dist) / (R * R)) * uMouseOn;
  s += d / dist * f * 70.0 + vec2(-d.y, d.x) / dist * f * 28.0;

  // 点击：向外扩散的冲击波
  float glow = f;
  float age = uTime - uClick.z;
  if (age > 0.0 && age < 3.0) {
    vec2 dc = s - uClick.xy;
    float dl = max(length(dc), 1.0);
    float ring = age * 560.0;
    float w = exp(-pow(dl - ring, 2.0) / 3200.0) * exp(-age * 1.3);
    s += dc / dl * w * 46.0;
    glow += w * 1.5;
  }

  gl_Position = vec4(s.x / uRes.x * 2.0 - 1.0, 1.0 - s.y / uRes.y * 2.0, 0.0, 1.0);
  float twinkle = 0.72 + 0.28 * sin(uTime * (1.5 + aSeed * 2.0) + aSeed * 60.0);
  gl_PointSize = aSize * 2.3 * uDpr * persp * (1.0 + glow * 1.4);
  vColor = aColor * (1.0 + glow * 1.3);
  vAlpha = twinkle * clamp(persp, 0.6, 1.2);
}
`;

const FRAGMENT = /* glsl */ `#version 300 es
precision mediump float;
in vec3 vColor;
in float vAlpha;
out vec4 outColor;

void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  // 明亮的星核 + 柔和的光晕
  float core = smoothstep(0.22, 0.0, d);
  float halo = smoothstep(0.5, 0.0, d);
  outColor = vec4(vColor, (core * 0.9 + halo * halo * 0.55) * vAlpha);
}
`;
