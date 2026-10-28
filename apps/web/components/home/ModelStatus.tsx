"use client";

import clsx from "clsx";
import { ArrowRight, Eye, Sparkles } from "lucide-react";
import { useEffect } from "react";
import { useSettings } from "@/stores/settings";

/**
 * 首页的模型连接状态：
 * - 未配置：极光描边的“连接你的 AI 模型”卡片，三步说明 + 一键打开设置；
 * - 已配置：一枚状态胶囊，显示模型名、服务商域名与是否支持视觉，点“更换”重新配置；
 * - 只有服务端默认模型：显示“站点默认模型”，可改用自己的 Key。
 */
export function ModelStatus() {
  const { settings, hydrated, hydrate, server, fetchServer, setOpen } = useSettings();
  useEffect(() => {
    if (!hydrated) hydrate();
    fetchServer();
  }, [hydrated, hydrate, fetchServer]);

  // 读取本地配置和服务端状态之前先占位，避免闪出“未连接”
  if (!hydrated || (!settings.apiKey && !server)) return <div className="h-[52px]" aria-hidden />;

  if (settings.apiKey) {
    const host = hostOf(settings.baseURL);
    const verified = !!settings.verified;
    return (
      <Pill
        tone={verified ? "ok" : "warn"}
        label={verified ? "模型已连接" : "尚未测试"}
        detail={
          <>
            <span className="truncate font-medium text-fg/90">{settings.model || "未填写模型"}</span>
            {host && <span className="hidden truncate font-mono text-[11px] text-faint sm:inline">{host}</span>}
            {settings.visionModel && (
              <span
                title={`视觉模型：${settings.visionModel}`}
                className="flex shrink-0 items-center gap-1 rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-muted"
              >
                <Eye className="h-3 w-3" /> 视觉
              </span>
            )}
          </>
        }
        action={verified ? "更换" : "去测试"}
        onAction={() => setOpen(true)}
      />
    );
  }

  if (server?.chat) {
    return (
      <Pill tone="info" label="站点默认模型" action="用自己的 Key" onAction={() => setOpen(true)} />
    );
  }

  return <ConnectCard onConnect={() => setOpen(true)} />;
}

const TONES = {
  ok: { dot: "bg-emerald-400", ring: "text-emerald-400/70", text: "text-emerald-300" },
  warn: { dot: "bg-amber-400", ring: "text-amber-400/70", text: "text-amber-300" },
  info: { dot: "bg-sky-400", ring: "text-sky-400/70", text: "text-sky-300" },
} as const;

function Pill(props: {
  tone: keyof typeof TONES;
  label: string;
  detail?: React.ReactNode;
  action: string;
  onAction: () => void;
}) {
  const t = TONES[props.tone];
  return (
    <div className="mb-4 flex justify-center">
      <div className="glass flex max-w-full items-center gap-2.5 rounded-full py-1.5 pl-3.5 pr-1.5 text-xs shadow-[0_12px_40px_-16px_rgba(0,0,0,0.8)]">
        <span className={clsx("relative flex h-2 w-2 shrink-0 rounded-full", t.dot)} />
        <span className={clsx("shrink-0", t.text)}>{props.label}</span>
        {props.detail && (
          <>
            <span className="h-3 w-px shrink-0 bg-white/10" />
            <span className="flex min-w-0 items-center gap-2">{props.detail}</span>
          </>
        )}
        <button
          onClick={props.onAction}
          className="shrink-0 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-muted transition hover:bg-white/[0.12] hover:text-fg"
        >
          {props.action}
        </button>
      </div>
    </div>
  );
}

const STEPS = ["填写接口地址", "粘贴 API Key", "测试连接"];

function ConnectCard({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="aurora-border mb-4 rounded-2xl">
      <div className="flex flex-col gap-4 rounded-2xl bg-[#0a0c12]/90 px-5 py-4 backdrop-blur-xl sm:flex-row sm:items-center sm:px-6">
        <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-accent/40">
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-[radial-gradient(circle_at_50%_40%,rgba(163,177,255,0.28),transparent_70%)]">
            <Sparkles className="h-5 w-5 text-accent" />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-medium">连接你的 AI 模型</div>
          <ol className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span className="flex h-4 w-4 items-center justify-center rounded-full border border-white/15 font-mono text-[10px] text-faint">
                  {i + 1}
                </span>
                {s}
                {i < STEPS.length - 1 && <span className="h-px w-4 bg-white/15" />}
              </li>
            ))}
          </ol>
        </div>
        <button
          onClick={onConnect}
          className="group flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-fg px-4 py-2.5 text-[13px] font-medium text-bg shadow-[0_8px_30px_-8px_rgba(163,177,255,0.6)] transition hover:bg-white"
        >
          连接模型
          <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
        </button>
      </div>
    </div>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
