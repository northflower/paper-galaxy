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
}

export const PROVIDER_PRESETS: { name: string; settings: Omit<LlmSettings, "apiKey"> }[] = [
  {
    name: "阿里云百炼",
    settings: {
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "deepseek-v4.1-flash",
      fastModel: "deepseek-v4.1-flash",
      visionModel: "qwen3-vl-plus",
      disableThinking: true,
    },
  },
  {
    name: "DeepSeek",
    settings: { baseURL: "https://api.deepseek.com/v1", model: "deepseek-chat", fastModel: "deepseek-chat", visionModel: "", disableThinking: false },
  },
  {
    name: "智谱",
    settings: {
      baseURL: "https://open.bigmodel.cn/api/paas/v4",
      model: "glm-4.5-air",
      fastModel: "glm-4.5-flash",
      visionModel: "glm-4.5v",
      disableThinking: false,
    },
  },
  {
    name: "OpenAI",
    settings: { baseURL: "https://api.openai.com/v1", model: "gpt-5-mini", fastModel: "gpt-5-nano", visionModel: "gpt-5-mini", disableThinking: false },
  },
];

const STORAGE_KEY = "pg-llm-settings";
const EMPTY: LlmSettings = { ...PROVIDER_PRESETS[0].settings, apiKey: "" };

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
  setOpen: (open: boolean) => void;
  hydrate: () => void;
  save: (s: LlmSettings) => void;
  clear: () => void;
}

export const useSettings = create<SettingsState>((set) => ({
  open: false,
  settings: EMPTY,
  hydrated: false,
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
