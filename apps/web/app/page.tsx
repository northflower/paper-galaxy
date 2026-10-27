"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { BookOpenText, Languages, MessagesSquare, Orbit, Trash2 } from "lucide-react";
import Link from "next/link";
import { UploadDropzone } from "@/components/UploadDropzone";
import { db, deletePaper } from "@/lib/db";

const FEATURES = [
  { icon: Orbit, title: "研究轨迹拆解", desc: "从问题、动机到方法、实验、结论，把论证链条连成星轨，点哪颗星跳到哪段原文" },
  { icon: Languages, title: "术语一致的双语对照", desc: "先抽取全文术语表，再逐段检索注入翻译，同一个术语全文只有一种译法" },
  { icon: MessagesSquare, title: "可溯源问答", desc: "混合检索 + 查询改写，每个回答都标注原文出处，没有依据就直说" },
  { icon: BookOpenText, title: "本地优先", desc: "解析与向量化在浏览器端完成，论文数据保存在你自己的设备上" },
];

export default function HomePage() {
  const papers = useLiveQuery(() => db.papers.orderBy("createdAt").reverse().toArray(), []);

  return (
    <main className="mx-auto max-w-5xl px-4 pb-24 pt-16 sm:px-6 sm:pt-24">
      <header className="mb-10 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-xs text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--accent)]" />
          AI 论文研读平台
        </div>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
          <span className="text-gradient">论文星图</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-muted sm:text-lg">
          上传一篇论文，AI 帮你看清它的研究轨迹，逐段对照翻译，有问题随时问，每个回答都能追溯到原文。
        </p>
      </header>

      <UploadDropzone />

      {papers && papers.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-widest text-faint">我的星图</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {papers.map((p) => (
              <li key={p.id} className="glass group relative rounded-xl transition hover:border-line-strong">
                <Link href={`/paper/${p.id}`} className="block p-4 pr-12">
                  <div className="line-clamp-2 font-medium leading-snug">{p.title}</div>
                  {p.oneLiner && <div className="mt-2 line-clamp-2 text-sm text-muted">{p.oneLiner}</div>}
                  <div className="mt-3 text-xs text-faint">
                    {p.pageCount} 页 · {new Date(p.createdAt).toLocaleDateString("zh-CN")}
                    {p.trajectory && ` · ${p.trajectory.length} 个轨迹节点`}
                  </div>
                </Link>
                <button
                  aria-label="删除论文"
                  onClick={() => confirm(`删除《${p.title}》？`) && deletePaper(p.id)}
                  className="absolute right-3 top-3 rounded-md p-1.5 text-faint opacity-0 transition hover:bg-white/5 hover:text-red-300 group-hover:opacity-100 focus:opacity-100"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-16 grid gap-4 sm:grid-cols-2">
        {FEATURES.map(({ icon: Icon, title, desc }) => (
          <div key={title} className="glass rounded-xl p-5">
            <Icon className="mb-3 h-5 w-5 text-accent" />
            <div className="font-medium">{title}</div>
            <div className="mt-1.5 text-sm leading-relaxed text-muted">{desc}</div>
          </div>
        ))}
      </section>
    </main>
  );
}
