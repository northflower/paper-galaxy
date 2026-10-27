import { create } from "zustand";

export type ViewMode = "bilingual" | "original" | "translation";
export type SideTab = "chat" | "glossary" | "scholar";

/** 框选得到的页面区域截图，交给视觉模型讲解 */
export interface VisionRequest {
  image: string;
  page: number;
  /** 与框选区域重叠的原文段落，帮助模型结合上下文讲解 */
  context: string;
}

interface ReaderState {
  /** 当前被定位/高亮的段落编号（ref，如 c12） */
  activeRefs: string[];
  activeNodeIndex: number | null;
  viewMode: ViewMode;
  sideTab: SideTab;
  /** 由划词、轨迹节点等入口投递给问答面板的问题 */
  pendingQuestion: string | null;
  /** 框选模式：在 PDF 页面上拖动选取图表、公式或表格 */
  regionMode: boolean;
  pendingVision: VisionRequest | null;
  setRegionMode: (on: boolean) => void;
  askVision: (req: VisionRequest) => void;
  consumeVision: () => VisionRequest | null;
  focus: (refs: string[], opts?: { nodeIndex?: number | null; scroll?: boolean }) => void;
  setViewMode: (m: ViewMode) => void;
  setSideTab: (t: SideTab) => void;
  ask: (q: string) => void;
  consumeQuestion: () => string | null;
  reset: () => void;
}

export const useReader = create<ReaderState>((set, get) => ({
  activeRefs: [],
  activeNodeIndex: null,
  viewMode: "bilingual",
  sideTab: "chat",
  pendingQuestion: null,
  regionMode: false,
  pendingVision: null,
  setRegionMode: (regionMode) => set({ regionMode }),
  askVision: (req) => set({ pendingVision: req, regionMode: false, sideTab: "chat" }),
  consumeVision: () => {
    const v = get().pendingVision;
    if (v) set({ pendingVision: null });
    return v;
  },
  focus: (refs, { nodeIndex = null, scroll = true } = {}) => {
    set({ activeRefs: refs, activeNodeIndex: nodeIndex });
    if (scroll && refs[0]) {
      // 原版 PDF 视图优先滚到页面上的段落位置，其次是文本视图中的段落
      const target =
        document.getElementById(`anchor-${refs[0]}`) ??
        document.getElementById(`tr-${refs[0]}`) ??
        document.getElementById(`chunk-${refs[0]}`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  },
  setViewMode: (viewMode) => set({ viewMode }),
  setSideTab: (sideTab) => set({ sideTab }),
  ask: (q) => set({ pendingQuestion: q, sideTab: "chat" }),
  consumeQuestion: () => {
    const q = get().pendingQuestion;
    if (q) set({ pendingQuestion: null });
    return q;
  },
  reset: () => set({ activeRefs: [], activeNodeIndex: null, pendingQuestion: null, regionMode: false, pendingVision: null }),
}));
