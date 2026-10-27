"use client";

import clsx from "clsx";
import { Check, Eye, EyeOff, KeyRound, Loader2, Settings2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { postJson } from "@/lib/stream";
import { useSettings, type LlmSettings } from "@/stores/settings";

/** 顶栏的“模型设置”按钮；未配置任何模型时带提示点 */
export function SettingsButton({ className }: { className?: string }) {
  const { settings, setOpen, hydrate, hydrated, server, fetchServer } = useSettings();
  useEffect(() => {
    if (!hydrated) hydrate();
    fetchServer();
  }, [hydrated, hydrate, fetchServer]);
  const missing = hydrated && server?.chat === false && !settings.apiKey;
  return (
    <button
      aria-label="模型设置"
      title={missing ? "还没有配置模型，点击填写" : "模型设置"}
      onClick={() => setOpen(true)}
      className={clsx("relative rounded-lg p-2 text-muted transition hover:bg-white/5 hover:text-fg", className)}
    >
      <Settings2 className="h-4 w-4" />
      {missing && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />}
    </button>
  );
}

/**
 * 模型设置：填写 OpenAI 兼容接口的地址、Key 与模型名。
 * 配置只保存在本机浏览器，随 AI 请求发给本站服务端转发给模型服务，服务端不保存。
 */
export function SettingsDialog() {
  const { open, setOpen, settings, save, clear, hydrate, hydrated, server, fetchServer } = useSettings();
  const [draft, setDraft] = useState<LlmSettings>(settings);
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<{ state: "idle" | "running" | "ok" | "error"; message?: string }>({ state: "idle" });

  useEffect(() => {
    if (!hydrated) hydrate();
  }, [hydrated, hydrate]);

  useEffect(() => {
    if (!open) return;
    setDraft(settings);
    setTest({ state: "idle" });
    fetchServer();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, settings, setOpen, fetchServer]);

  if (!open) return null;

  const set = <K extends keyof LlmSettings>(k: K, v: LlmSettings[K]) => {
    setDraft((d) => ({ ...d, [k]: v, verified: false }));
    setTest({ state: "idle" });
  };

  const runTest = async () => {
    // 先保存，测试请求才会带上新配置
    save(draft);
    setTest({ state: "running" });
    try {
      const res = await postJson<{ reply: string }>("/api/check", {});
      save({ ...draft, verified: true });
      setDraft((d) => ({ ...d, verified: true }));
      setTest({ state: "ok", message: `连接成功，模型回复：${res.reply || "（空）"}` });
    } catch (err) {
      setTest({ state: "error", message: (err as Error).message });
    }
  };

  const field = "w-full rounded-lg border border-line bg-white/[0.03] px-3 py-2 text-[13px] outline-none transition placeholder:text-faint focus:border-line-strong";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="模型设置"
        onClick={(e) => e.stopPropagation()}
        className="panel rise scrollbar-thin max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl p-5 sm:p-6"
      >
        <div className="mb-1 flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-accent" />
          <h2 className="flex-1 text-[15px] font-medium">模型设置</h2>
          <button aria-label="关闭" onClick={() => setOpen(false)} className="rounded-md p-1 text-muted hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-faint">
          支持任意 OpenAI 兼容接口。配置只保存在当前浏览器，调用 AI 时经本站服务端转发给模型服务，服务端不保存。
          {server?.chat && " 服务端已配置默认模型，不填写也可以直接使用。"}
        </p>


        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs text-muted">接口地址（Base URL）</span>
            <input className={field} value={draft.baseURL} onChange={(e) => set("baseURL", e.target.value)} placeholder="https://your-provider.com/v1" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">API Key</span>
            <div className="relative">
              <input
                className={clsx(field, "pr-9 font-mono")}
                type={showKey ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                value={draft.apiKey}
                onChange={(e) => set("apiKey", e.target.value)}
                placeholder="sk-..."
              />
              <button
                type="button"
                aria-label={showKey ? "隐藏" : "显示"}
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-muted"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-muted">主模型（问答、脉络）</span>
              <input className={field} value={draft.model} onChange={(e) => set("model", e.target.value)} placeholder="模型名称" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-muted">快速模型（翻译、Agent）</span>
              <input className={field} value={draft.fastModel} onChange={(e) => set("fastModel", e.target.value)} placeholder="留空则同主模型" />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">视觉模型（框选讲解，可选）</span>
            <input className={field} value={draft.visionModel} onChange={(e) => set("visionModel", e.target.value)} placeholder="支持图片输入的模型，留空则不可用" />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={draft.disableThinking} onChange={(e) => set("disableThinking", e.target.checked)} />
            快速模型关闭思考模式
          </label>
        </div>

        {test.state !== "idle" && (
          <p
            className={clsx(
              "mt-4 flex items-start gap-1.5 text-xs",
              test.state === "ok" ? "text-emerald-300" : test.state === "error" ? "text-red-300" : "text-muted",
            )}
          >
            {test.state === "running" ? <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin" /> : test.state === "ok" && <Check className="mt-0.5 h-3.5 w-3.5" />}
            {test.state === "running" ? "正在测试连接…" : test.message}
          </p>
        )}

        <div className="mt-5 flex items-center gap-2">
          {settings.apiKey && (
            <button
              onClick={() => {
                clear();
                setDraft(useSettings.getState().settings);
              }}
              className="text-xs text-faint transition hover:text-red-300"
            >
              清除本机配置
            </button>
          )}
          <div className="flex-1" />
          <button onClick={runTest} disabled={!draft.baseURL.trim() || !draft.apiKey.trim() || !draft.model.trim() || test.state === "running"} className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-40">
            测试连接
          </button>
          <button
            onClick={() => {
              save(draft);
              setOpen(false);
            }}
            className="rounded-lg bg-fg px-4 py-1.5 text-xs font-medium text-bg transition hover:bg-white"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
