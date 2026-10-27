"use client";

import { Billboard, Line, OrbitControls, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { shortTitle, type GalaxyPaper, type Star } from "@/lib/galaxy/useGalaxy";

export interface Hit {
  index: number;
  score: number;
}

interface Props {
  stars: Star[];
  papers: GalaxyPaper[];
  /** UMAP 输出的目标坐标，星星每帧向它插值移动 */
  positions: Float32Array;
  hits: Hit[];
  selected: number | null;
  hovered: number | null;
  /** 镜头要飞向的论文序号 */
  focusPaper: number | null;
  onHover: (index: number | null) => void;
  onSelect: (index: number | null) => void;
}

// 命中的星按相关度依次点亮的间隔（秒）
const REVEAL_STEP = 0.12;

/**
 * 文字标签（星云标题、悬停提示）放在画布外的 DOM 叠加层，每帧按投影坐标移动：
 * 中文排版与样式复用页面 CSS，也避免 drei Html 为每个标签单独创建 React 根节点
 */
interface Anchors {
  nebula: (THREE.Vector3 | null)[];
  hover: THREE.Vector3 | null;
}

export default function GalaxyScene(props: Props) {
  const overlay = useRef<HTMLDivElement>(null);
  const anchors = useRef<Anchors>({ nebula: [], hover: null });
  const hoverStar = props.hovered !== null && props.hovered !== props.selected ? props.stars[props.hovered] : undefined;
  const hoverColor = hoverStar ? props.papers[hoverStar.paperIndex]?.color : undefined;

  return (
    <div className="relative h-full w-full">
      <Canvas
        camera={{ position: [0, 6, 30], fov: 55 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        raycaster={{ params: { Points: { threshold: 0.35 } } as THREE.Raycaster["params"] }}
        onPointerMissed={() => props.onSelect(null)}
        fallback={<div className="flex h-full items-center justify-center text-muted">当前浏览器不支持 WebGL，无法显示 3D 星系</div>}
      >
        <Stars radius={90} depth={50} count={2500} factor={3} saturation={0} fade speed={0.6} />
        <Scene {...props} anchors={anchors} />
        <LabelProjector overlay={overlay} anchors={anchors} />
      </Canvas>
      <div ref={overlay} className="pointer-events-none absolute inset-0 overflow-hidden">
        {props.papers.map((p, i) => (
          <div
            key={p.paper.id}
            data-anchor={`n${i}`}
            className="absolute left-0 top-0 w-max max-w-[220px] text-center text-[13px] font-medium leading-snug opacity-0"
            style={{ color: p.color, textShadow: "0 0 12px rgba(0,0,0,.9)" }}
          >
            {shortTitle(p.paper.title)}
          </div>
        ))}
        <div data-anchor="hover" className="absolute left-0 top-0 opacity-0">
          {hoverStar && (
            <div className="glass ml-4 w-60 rounded-lg p-2.5 text-xs leading-relaxed shadow-xl">
              <div className="mb-1 truncate font-medium" style={{ color: hoverColor }}>
                {shortTitle(props.papers[hoverStar.paperIndex]?.paper.title ?? "")}
              </div>
              <div className="mb-1 text-faint">
                P{hoverStar.chunk.page}
                {hoverStar.chunk.section && ` · ${hoverStar.chunk.section}`}
              </div>
              <div className="line-clamp-3 text-muted">{hoverStar.chunk.text}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 每帧把锚点投影到屏幕坐标，直接写 DOM，不触发 React 渲染 */
function LabelProjector({ overlay, anchors }: { overlay: RefObject<HTMLDivElement | null>; anchors: RefObject<Anchors> }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    const root = overlay.current;
    if (!root) return;
    for (const el of root.querySelectorAll<HTMLElement>("[data-anchor]")) {
      const key = el.dataset.anchor!;
      const anchor = key === "hover" ? anchors.current.hover : anchors.current.nebula[Number(key.slice(1))];
      if (!anchor) {
        el.style.opacity = "0";
        continue;
      }
      v.copy(anchor).project(camera);
      const visible = v.z < 1;
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      el.style.opacity = visible ? "1" : "0";
      el.style.transform =
        key === "hover" ? `translate(${x}px, ${y}px) translateY(-50%)` : `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    }
  });
  return null;
}

function Scene({
  stars,
  papers,
  positions,
  hits,
  selected,
  hovered,
  focusPaper,
  onHover,
  onSelect,
  anchors,
}: Props & { anchors: RefObject<Anchors> }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const current = useRef<Float32Array>(new Float32Array(0));
  const geometry = useMemo(() => new THREE.BufferGeometry(), []);

  // 星星集合变化时重建几何体属性；颜色按论文、大小按段落类型
  useEffect(() => {
    const n = stars.length;
    current.current = new Float32Array(positions);
    geometry.setAttribute("position", new THREE.BufferAttribute(current.current, 3));
    const colors = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const color = new THREE.Color();
    stars.forEach((s, i) => {
      color.set(papers[s.paperIndex]?.color ?? "#8b9dff");
      color.toArray(colors, i * 3);
      // 段落越长，星越大
      sizes[i] = 1 + Math.min(s.chunk.text.length / 1400, 1) * 0.9;
    });
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aHi", new THREE.BufferAttribute(new Float32Array(n), 1));
    // 星星位置每帧变化，用固定的大包围球保证拾取不被裁掉
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stars, papers, geometry]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uDim: { value: 0 }, uPixelRatio: { value: 1 } },
        vertexShader: STAR_VERTEX,
        fragmentShader: STAR_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  // 竖屏（手机）视野较窄，把镜头拉远一些，让整个星系完整入画
  const camera = useThree((s) => s.camera);
  const aspect = useThree((s) => s.size.width / s.size.height);
  useEffect(() => {
    camera.position.setLength(aspect < 1 ? 30 * Math.min(1.6, 0.85 / Math.max(aspect, 0.4)) : 30);
  }, [camera, aspect]);

  const dpr = useThree((s) => s.viewport.dpr);
  useEffect(() => {
    material.uniforms.uPixelRatio.value = dpr;
  }, [dpr, material]);

  const hitStart = useRef(0);
  const clock = useThree((s) => s.clock);
  useEffect(() => {
    hitStart.current = clock.elapsedTime;
  }, [hits, clock]);
  const hitRank = useMemo(() => new Map(hits.map((h, rank) => [h.index, rank])), [hits]);
  const focusTarget = useFocusTarget(stars, positions, hits, selected, focusPaper);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    material.uniforms.uTime.value = t;
    const dimTarget = hits.length ? 1 : 0;
    material.uniforms.uDim.value += (dimTarget - material.uniforms.uDim.value) * Math.min(1, delta * 4);

    // 位置向 UMAP 目标插值，形成“星云聚拢”的动画
    const pos = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (pos && current.current.length === positions.length) {
      const k = Math.min(1, delta * 3);
      const arr = current.current;
      for (let i = 0; i < arr.length; i++) arr[i] += (positions[i] - arr[i]) * k;
      pos.needsUpdate = true;
    }

    // 检索命中的星按相关度依次点亮
    const hi = geometry.getAttribute("aHi") as THREE.BufferAttribute | undefined;
    if (hi) {
      const revealed = (t - hitStart.current) / REVEAL_STEP;
      const arr = hi.array as Float32Array;
      for (let i = 0; i < arr.length; i++) {
        const rank = hitRank.get(i);
        const on = i === selected ? 1 : rank !== undefined && rank < revealed ? 1 : 0;
        arr[i] += (on - arr[i]) * Math.min(1, delta * 6);
      }
      hi.needsUpdate = true;
    }
  });

  useEffect(() => {
    anchors.current.hover =
      hovered !== null && hovered !== selected
        ? new THREE.Vector3(positions[hovered * 3], positions[hovered * 3 + 1], positions[hovered * 3 + 2])
        : null;
  }, [anchors, hovered, selected, positions]);

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.index !== undefined) onHover(e.index);
  };

  return (
    <>
      <points
        geometry={geometry}
        material={material}
        onPointerMove={handleMove}
        onPointerOut={() => onHover(null)}
        onClick={(e) => {
          e.stopPropagation();
          if (e.index !== undefined) onSelect(e.index);
        }}
      />
      <Nebulae stars={stars} papers={papers} positions={positions} anchors={anchors} />
      <SearchBeams hits={hits} positions={positions} startRef={hitStart} />
      {hovered !== null && hovered !== selected && <StarMarker index={hovered} positions={positions} stars={stars} papers={papers} />}
      {selected !== null && <StarMarker index={selected} positions={positions} stars={stars} papers={papers} pinned />}
      <CameraRig controls={controls} target={focusTarget} />
      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        autoRotate={!hits.length && selected === null}
        autoRotateSpeed={0.35}
        minDistance={4}
        maxDistance={60}
      />
    </>
  );
}

/** 每篇论文星星最密集处放一团星云辉光，并登记标题锚点 */
function Nebulae({
  stars,
  papers,
  positions,
  anchors,
}: Pick<Props, "stars" | "papers" | "positions"> & { anchors: RefObject<Anchors> }) {
  const texture = useMemo(() => glowTexture(), []);
  const centers = useMemo(() => densestCores(stars, papers.length, positions), [stars, papers.length, positions]);

  useEffect(() => {
    anchors.current.nebula = centers.map((c) => (c.n ? new THREE.Vector3(c.x, c.y + c.r + 0.8, c.z) : null));
  }, [anchors, centers]);

  return (
    <>
      {centers.map((c, i) =>
        c.n ? (
          <sprite key={papers[i].paper.id} position={[c.x, c.y, c.z]} scale={c.r * 3}>
            <spriteMaterial
              map={texture}
              color={papers[i].color}
              transparent
              opacity={0.16}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </sprite>
        ) : null,
      )}
    </>
  );
}

/**
 * 星云中心取每篇论文星星最密集处，而不是简单平均：
 * 不同论文的相近主题会交织在一起，平均中心常常落在空处
 */
function densestCores(stars: Star[], paperCount: number, positions: Float32Array) {
  const R = 2.5;
  const best = Array.from({ length: paperCount }, () => ({ x: 0, y: 0, z: 0, n: 0, r: 3, score: -1 }));
  const byPaper: number[][] = Array.from({ length: paperCount }, () => []);
  stars.forEach((s) => byPaper[s.paperIndex]?.push(s.index));
  byPaper.forEach((idx, p) => {
    for (const i of idx) {
      let score = 0;
      let spread = 0;
      for (const j of idx) {
        const d = Math.hypot(positions[i * 3] - positions[j * 3], positions[i * 3 + 1] - positions[j * 3 + 1], positions[i * 3 + 2] - positions[j * 3 + 2]);
        if (d < R) {
          score++;
          spread += d;
        }
      }
      if (score > best[p].score) {
        best[p] = { x: positions[i * 3], y: positions[i * 3 + 1], z: positions[i * 3 + 2], n: idx.length, r: Math.max(2, (spread / score) * 2.2), score };
      }
    }
  });
  return best;
}

/** 检索可视化：问题化作一颗白星，光束依次连向命中的段落 */
function SearchBeams({
  hits,
  positions,
  startRef,
}: Pick<Props, "hits" | "positions"> & { startRef: React.RefObject<number> }) {
  const origin = useMemo(() => {
    if (!hits.length) return null;
    const c = new THREE.Vector3();
    hits.forEach((h) => c.add(new THREE.Vector3(positions[h.index * 3], positions[h.index * 3 + 1], positions[h.index * 3 + 2])));
    c.divideScalar(hits.length);
    // 稍微抬高，避免与星云重叠
    return c.add(new THREE.Vector3(0, 3, 0));
  }, [hits, positions]);
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const revealed = (t - startRef.current) / REVEAL_STEP;
    group.current?.children.forEach((child, i) => {
      child.visible = i < revealed;
    });
    if (core.current) core.current.scale.setScalar(1 + Math.sin(t * 4) * 0.15);
  });

  if (!origin) return null;
  return (
    <>
      <mesh ref={core} position={origin}>
        <sphereGeometry args={[0.28, 16, 16]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <group ref={group}>
        {hits.map((h, rank) => (
          <Line
            key={`${h.index}-${rank}`}
            points={[origin, [positions[h.index * 3], positions[h.index * 3 + 1], positions[h.index * 3 + 2]]]}
            color="#c7d0ff"
            transparent
            opacity={0.25 + h.score * 0.55}
            lineWidth={1 + (hits.length - rank) / hits.length}
          />
        ))}
      </group>
    </>
  );
}

function StarMarker({ index, positions, stars, papers, pinned }: Pick<Props, "positions" | "stars" | "papers"> & { index: number; pinned?: boolean }) {
  const star = stars[index];
  if (!star) return null;
  return (
    <Billboard position={[positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]]}>
      <mesh>
        <ringGeometry args={[0.42, 0.5, 40]} />
        <meshBasicMaterial color={papers[star.paperIndex]?.color ?? "#fff"} transparent opacity={pinned ? 0.95 : 0.6} />
      </mesh>
    </Billboard>
  );
}

/** 计算镜头焦点：选中的星 > 检索命中区域 > 指定论文的星云 */
function useFocusTarget(stars: Star[], positions: Float32Array, hits: Hit[], selected: number | null, focusPaper: number | null) {
  return useMemo(() => {
    const pick = (indices: number[]) => {
      if (!indices.length) return null;
      const c = new THREE.Vector3();
      for (const i of indices) c.add(new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]));
      return { point: c.divideScalar(indices.length), distance: indices.length === 1 ? 9 : 18 };
    };
    if (selected !== null) return pick([selected]);
    if (hits.length) return pick(hits.map((h) => h.index));
    if (focusPaper !== null) return pick(stars.filter((s) => s.paperIndex === focusPaper).map((s) => s.index));
    return null;
    // 布局成形过程中位置不断变化，焦点只在用户操作时重新计算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stars, hits, selected, focusPaper]);
}

/** 平滑飞向焦点；用户一旦拖动视角就停止接管 */
function CameraRig({
  controls,
  target,
}: {
  controls: React.RefObject<OrbitControlsImpl | null>;
  target: { point: THREE.Vector3; distance: number } | null;
}) {
  const flying = useRef(false);
  useEffect(() => {
    flying.current = !!target;
  }, [target]);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const stop = () => (flying.current = false);
    c.addEventListener("start", stop);
    return () => c.removeEventListener("start", stop);
  }, [controls]);

  useFrame(({ camera }, delta) => {
    const c = controls.current;
    if (!flying.current || !target || !c) return;
    const k = Math.min(1, delta * 2.5);
    c.target.lerp(target.point, k);
    const dir = camera.position.clone().sub(c.target).normalize();
    const desired = target.point.clone().add(dir.multiplyScalar(target.distance));
    camera.position.lerp(desired, k);
    if (camera.position.distanceTo(desired) < 0.05 && c.target.distanceTo(target.point) < 0.05) flying.current = false;
  });
  return null;
}

function glowTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}


const STAR_VERTEX = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aHi;
  uniform float uTime;
  uniform float uDim;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float twinkle = 0.75 + 0.25 * sin(uTime * 1.6 + position.x * 3.1 + position.y * 1.7);
    // 检索时未命中的星变暗，命中的星变亮变大并偏白
    float dim = mix(1.0, 0.18, uDim * (1.0 - aHi));
    vColor = mix(aColor, vec3(1.0), aHi * 0.45);
    vAlpha = twinkle * dim * (1.0 + aHi * 0.5);
    gl_PointSize = aSize * (1.0 + aHi * 0.8) * uPixelRatio * (200.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const STAR_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.0, d);
    float alpha = (pow(core, 3.0) + core * 0.3) * vAlpha;
    gl_FragColor = vec4(vColor, alpha);
  }
`;
