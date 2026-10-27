"use client";

import { create } from "zustand";

/** 网页中填写的模型配置，只保存在本机浏览器（localStorage），随 AI 请求发送给本站服务端，服务端不保存 */
export interface LlmSettings {
  baseURL: string;
  apiKey: string;
  model: string;
  fastModel: string;
  visionModel: string;
  disableThinking: boolean;
  /** 当前配置是否通过了“测试连接”；修改任一字段后重置 */
  verified?: boolean;
}

/** 服务端是否配置了默认模型（部署公共实例时） */
export interface ServerStatus {
  chat: boolean;
  vision: boolean;
}

const STORAGE_KEY = "pg-llm-settings";
const EMPTY: LlmSettings = { baseURL: "", apiKey: "", model: "", fastModel: "", visionModel: "", disableThinking: false };

function load(): LlmSettings {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

interface SettingsState {
  open: boolean;
  settings: LlmSettings;
  hydrated: boolean;
  server: ServerStatus | null;
  fetchServer: () => void;
  setOpen: (open: boolean) => void;
  hydrate: () => void;
  save: (s: LlmSettings) => void;
  clear: () => void;
}

let serverRequest: Promise<void> | null = null;

export const useSettings = create<SettingsState>((set) => ({
  open: false,
  settings: EMPTY,
  hydrated: false,
  server: null,
  // 多个组件同时调用时只请求一次
  fetchServer: () => {
    serverRequest ??= fetch("/api/check")
      .then((r) => r.json())
      .then((d: ServerStatus) => set({ server: { chat: !!d.chat, vision: !!d.vision } }))
      .catch(() => {
        serverRequest = null;
      });
  },
  setOpen: (open) => set({ open }),
  hydrate: () => set({ settings: load(), hydrated: true }),
  save: (settings) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {}
    set({ settings });
  },
  clear: () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    set({ settings: EMPTY });
  },
}));

/** AI 请求头：填写了 Key 时附上模型配置（UTF-8 JSON 的 base64） */
export function aiHeaders(): Record<string, string> {
  const s = useSettings.getState().hydrated ? useSettings.getState().settings : load();
  if (!s.apiKey.trim()) return {};
  const json = JSON.stringify(s);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return { "x-pg-llm": btoa(bin) };
}
