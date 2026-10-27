import { create } from "zustand";

export type ViewMode = "bilingual" | "original" | "translation";
export type SideTab = "chat" | "glossary";

interface ReaderState {
  /** 当前被定位/高亮的段落编号（ref，如 c12） */
  activeRefs: string[];
  activeNodeIndex: number | null;
  viewMode: ViewMode;
  sideTab: SideTab;
  /** 由划词、轨迹节点等入口投递给问答面板的问题 */
  pendingQuestion: string | null;
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
  focus: (refs, { nodeIndex = null, scroll = true } = {}) => {
    set({ activeRefs: refs, activeNodeIndex: nodeIndex });
    if (scroll && refs[0]) {
      document.getElementById(`chunk-${refs[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
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
  reset: () => set({ activeRefs: [], activeNodeIndex: null, pendingQuestion: null }),
}));
