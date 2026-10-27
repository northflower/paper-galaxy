/**
 * 星云层：数万颗粒子沿几条缓慢起伏的能量带分布，每条带由被噪声扭曲、彼此交织的细丝组成，
 * 叠加弥散雾气与大而淡的光晕。全部运动在顶点着色器中以 simplex 噪声计算。
 * 作为首页背景的底层，与前景的星图仪共用同一个 WebGL 上下文。
 */

export interface NebulaLayer {
  draw(u: { time: number; w: number; h: number; dpr: number; mouse: [number, number, number]; parallax: [number, number]; ripple: [number, number, number] }): void;
  dispose(): void;
}

export function createNebulaLayer(
  gl: WebGL2RenderingContext,
  compile: (gl: WebGL2RenderingContext, vs: string, fs: string) => WebGLProgram | null,
  count: number,
): NebulaLayer | null {
  const program = compile(gl, NEBULA_VS, NEBULA_FS);
  if (!program) return null;
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, buildNebula(count), gl.STATIC_DRAW);
  const attr = (name: string, size: number, offset: number) => {
    const loc = gl.getAttribLocation(program, name);
    if (loc < 0) return;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, offset * 4);
  };
  attr("aU", 1, 0);
  attr("aJitter", 2, 1);
  attr("aZ", 1, 3);
  attr("aRibbon", 1, 4);
  attr("aStrand", 1, 5);
  attr("aSize", 1, 6);
  attr("aKind", 1, 7);
  attr("aSeed", 1, 8);
  const loc = (n: string) => gl.getUniformLocation(program, n);
  const U = {
    time: loc("uTime"),
    res: loc("uRes"),
    dpr: loc("uDpr"),
    mouse: loc("uMouse"),
    mouseOn: loc("uMouseOn"),
    parallax: loc("uParallax"),
    ripple: loc("uRipple"),
  };
  return {
    draw(u) {
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.uniform1f(U.time, u.time);
      gl.uniform2f(U.res, u.w, u.h);
      gl.uniform1f(U.dpr, u.dpr);
      gl.uniform2f(U.mouse, u.mouse[0], u.mouse[1]);
      gl.uniform1f(U.mouseOn, u.mouse[2]);
      gl.uniform2f(U.parallax, u.parallax[0], u.parallax[1]);
      gl.uniform3f(U.ripple, u.ripple[0], u.ripple[1], u.ripple[2]);
      gl.drawArrays(gl.POINTS, 0, count);
    },
    dispose() {
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    },
  };
}

const STRIDE = 9;
const RIBBONS = 4;
const STRANDS = 6;

/**
 * 粒子类型（aKind）：0 细丝粒子（沿噪声细丝紧密分布，最亮）、1 弥散粒子（同一条带内的松散雾气）、
 * 2 光晕粒子（大而淡，制造朦胧感）、3 远景星点
 */
function buildNebula(count: number) {
  const out = new Float32Array(count * STRIDE);
  const gauss = () => {
    let a = 0;
    let b = 0;
    while (!a) a = Math.random();
    while (!b) b = Math.random();
    return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
  };
  for (let i = 0; i < count; i++) {
    const roll = Math.random();
    const kind = roll < 0.74 ? 0 : roll < 0.9 ? 1 : roll < 0.925 ? 2 : 3;
    const o = i * STRIDE;
    out[o] = (Math.random() * 2 - 1) * 1.25; // 沿带方向的位置，略超出屏幕两侧
    // 细丝粒子大多紧贴细丝中心，少量稍散开形成毛边
    const tier = Math.random();
    const spread = kind === 0 ? (tier < 0.45 ? 0.006 : tier < 0.8 ? 0.03 : 0.09) : kind === 1 ? 0.26 : 0.32;
    out[o + 1] = gauss() * spread;
    out[o + 2] = gauss() * spread;
    out[o + 3] = Math.random() * 2 - 1;
    out[o + 4] = kind === 3 ? -1 : Math.floor(Math.random() * RIBBONS);
    out[o + 5] = Math.floor(Math.random() * STRANDS);
    out[o + 6] =
      kind === 0
        ? 0.7 + Math.pow(Math.random(), 3) * 2.4
        : kind === 1
          ? 0.6 + Math.random() * 1.1
          : kind === 2
            ? 26 + Math.random() * 50
            : 0.5 + Math.pow(Math.random(), 4) * 2.2;
    out[o + 7] = kind;
    out[o + 8] = Math.random();
  }
  return out;
}

const NEBULA_VS = /* glsl */ `#version 300 es
precision highp float;
in float aU;
in vec2 aJitter;
in float aZ;
in float aRibbon;
in float aStrand;
in float aSize;
in float aKind;
in float aSeed;
uniform float uTime;
uniform vec2 uRes;
uniform float uDpr;
uniform vec2 uMouse;
uniform float uMouseOn;
uniform vec2 uParallax;
uniform vec3 uRipple;
out vec3 vColor;
out float vAlpha;
out float vSoft;

// Ashima 3D simplex noise
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// 每条能量带的走向：偏移、斜率、起伏幅度、频率、相位、宽度
vec4 ribbonA(float r) {
  if (r < 0.5) return vec4(-0.18, -0.32, 0.30, 1.6);
  if (r < 1.5) return vec4(0.22, -0.18, 0.26, 2.1);
  if (r < 2.5) return vec4(0.02, 0.10, 0.20, 2.7);
  return vec4(-0.42, 0.22, 0.16, 1.3);
}
vec2 ribbonB(float r) {
  if (r < 0.5) return vec2(0.3, 0.30);
  if (r < 1.5) return vec2(2.1, 0.26);
  if (r < 2.5) return vec2(4.2, 0.18);
  return vec2(5.3, 0.22);
}

// 配色：极光——左侧青绿、经天蓝与紫，到右侧玫红与琥珀金，与星图仪的黄铜色呼应
vec3 palette(float x, float r, float seed) {
  vec3 teal = vec3(0.22, 0.95, 0.80);
  vec3 azure = vec3(0.28, 0.62, 1.00);
  vec3 violet = vec3(0.58, 0.40, 1.00);
  vec3 rose = vec3(1.00, 0.38, 0.62);
  vec3 amber = vec3(1.00, 0.72, 0.36);
  float t = clamp(x * 0.42 + 0.5 + (r - 1.5) * 0.06 + (seed - 0.5) * 0.18, 0.0, 1.0);
  return t < 0.25 ? mix(teal, azure, t / 0.25)
       : t < 0.5 ? mix(azure, violet, (t - 0.25) / 0.25)
       : t < 0.75 ? mix(violet, rose, (t - 0.5) / 0.25)
       : mix(rose, amber, (t - 0.75) / 0.25);
}

void main() {
  float t = uTime;
  vec3 p;
  vec3 color;
  float alpha;

  if (aKind > 2.5) {
    // 远景星点：缓慢漂移
    p = vec3(aU * 1.1, aJitter.x * 2.2 + sin(t * 0.02 + aSeed * 6.28) * 0.01, aZ);
    color = mix(vec3(0.75, 0.80, 1.0), vec3(1.0, 0.85, 0.95), aSeed);
    alpha = 0.35 + 0.65 * (0.5 + 0.5 * sin(t * (0.8 + aSeed * 2.0) + aSeed * 40.0));
  } else {
    vec4 A = ribbonA(aRibbon);
    vec2 B = ribbonB(aRibbon);
    float x = aU;
    // 带的中线：两层正弦叠加，缓慢起伏
    float yc = A.x + A.y * x + A.z * sin(A.w * x + B.x + t * 0.05) + A.z * 0.45 * sin(2.3 * A.w * x - B.x * 1.7 - t * 0.037);
    float w = B.y * (0.65 + 0.35 * sin(x * 1.4 + B.x * 2.0 + t * 0.03));
    // 细丝：每条带由若干条被噪声扭曲、彼此交织的细线组成
    float strand = snoise(vec3(x * 1.7 + aRibbon * 5.0, aStrand * 3.3, t * 0.03));
    float y = yc + w * (strand * 0.9 + aJitter.x);
    // 同一条细丝深度连续（只随位置缓慢变化），否则透视会把细丝拉散；弥散粒子才给随机深度
    float z = 0.35 * snoise(vec3(x * 0.9, aStrand * 1.7 + aRibbon, t * 0.02)) + (aKind < 0.5 ? aZ * 0.02 : aZ * 0.25);
    p = vec3(x + aJitter.y * 0.15, y, z);
    // 细小的卷曲扰动，让细丝呈现能量流动的纹理
    float curl = aKind < 0.5 ? 0.018 : 0.04;
    p.xy += curl * vec2(snoise(p * 3.2 + vec3(0.0, 0.0, t * 0.06)), snoise(p * 3.2 + vec3(17.0, 9.0, t * 0.06)));

    color = palette(x, aRibbon, aSeed);
    // 带的两端淡出；细丝越靠近中心越亮
    float edge = 1.0 - smoothstep(0.7, 1.25, abs(x));
    float core = aKind < 0.5 ? 1.0 : aKind < 1.5 ? 0.32 : 0.055;
    float pulse = 0.75 + 0.25 * sin(t * 0.6 + aSeed * 30.0 + x * 3.0);
    alpha = edge * core * pulse;
    // 少量白热的亮点
    if (aKind < 0.5 && aSeed > 0.985) { color = mix(color, vec3(1.0), 0.65); alpha *= 1.6; }
  }

  // 投影：x 映射到屏幕宽度，y 按高度；远近带来轻微透视与视差
  float persp = 1.8 / (1.8 + p.z);
  // 横纵用同一尺度（半屏宽），竖屏时适当放大纵向，让星云带铺满画面
  float k = uRes.x * 0.5;
  float ky = k * max(1.0, uRes.y / uRes.x * 0.9);
  vec2 scr = vec2(uRes.x * 0.5 + p.x * k * persp, uRes.y * 0.5 - p.y * ky * persp);
  scr += uParallax * vec2(-40.0, -26.0) * (1.2 - p.z);

  // 鼠标：粒子绕光标打旋并被轻轻吸引，同时点亮
  vec2 d = uMouse - scr;
  float dist = max(length(d), 1.0);
  float R = 190.0;
  float f = exp(-(dist * dist) / (R * R)) * uMouseOn;
  scr += d / dist * f * min(dist * 0.25, 18.0) + vec2(-d.y, d.x) / dist * f * 30.0;
  float glow = f;

  // 点击：一圈柔和的涟漪
  float age = t - uRipple.z;
  if (age > 0.0 && age < 3.5) {
    vec2 dc = scr - uRipple.xy;
    float dl = max(length(dc), 1.0);
    float wv = exp(-pow(dl - age * 420.0, 2.0) / 4000.0) * exp(-age * 1.1);
    scr += dc / dl * wv * 26.0;
    glow += wv;
  }

  gl_Position = vec4(scr.x / uRes.x * 2.0 - 1.0, 1.0 - scr.y / uRes.y * 2.0, 0.0, 1.0);
  gl_PointSize = aSize * 1.7 * uDpr * persp * (1.0 + glow * 1.2);
  vColor = color * 1.25 * (1.0 + glow * 0.8);
  vAlpha = alpha * (0.55 + 0.45 * persp);
  vSoft = aKind > 1.5 && aKind < 2.5 ? 1.0 : 0.0;
}
`;

const NEBULA_FS = /* glsl */ `#version 300 es
precision mediump float;
in vec3 vColor;
in float vAlpha;
in float vSoft;
out vec4 outColor;

void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a;
  if (vSoft > 0.5) {
    // 光晕粒子：极柔和的高斯雾
    a = exp(-d * d * 14.0) * 0.5;
  } else {
    float core = 1.0 - smoothstep(0.0, 0.2, d);
    float halo = 1.0 - smoothstep(0.0, 0.5, d);
    a = core * 0.85 + halo * halo * 0.45;
  }
  outColor = vec4(vColor, a * vAlpha);
}
`;
