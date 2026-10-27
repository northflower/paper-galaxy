"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Trash2 } from "lucide-react";
import Link from "next/link";
import { SearchBox, SearchResults, useLibrarySearch } from "@/components/home/LibrarySearch";
import { Brand } from "@/components/Logo";
import { UploadDropzone } from "@/components/UploadDropzone";
import { db, deletePaper } from "@/lib/db";

const CAPABILITIES = ["双语对照翻译", "论文脉络", "溯源问答", "术语表"];

export default function HomePage() {
  const papers = useLiveQuery(() => db.papers.orderBy("createdAt").reverse().toArray(), []);
  const search = useLibrarySearch();

  return (
    <div className="min-h-dvh">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Brand />
      </nav>

      <main className="mx-auto max-w-6xl px-5 pb-28 sm:px-8">
        <header className="rise pb-12 pt-14 text-center sm:pt-24">
          <h1 className="font-display text-[44px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-7xl">
            <span className="text-gradient">用母语读懂论文</span>
          </h1>
          <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted">
            {CAPABILITIES.map((c) => (
              <li key={c} className="flex items-center gap-2">
                <span className="h-1 w-1 rounded-full bg-accent" />
                {c}
              </li>
            ))}
          </ul>
        </header>

        <div className="rise mx-auto max-w-2xl" style={{ animationDelay: "80ms" }}>
          <UploadDropzone />
        </div>

        {papers && papers.length > 0 && (
          <section className="rise mt-20" style={{ animationDelay: "160ms" }}>
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="eyebrow">
                论文库 <span className="ml-1 text-faint/70">{papers.length}</span>
              </h2>
              <SearchBox search={search} />
            </div>

            {search.result || search.error ? (
              <SearchResults search={search} papers={papers} />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {papers.map((p) => (
                  <li key={p.id} className="panel group relative rounded-xl transition duration-200 hover:-translate-y-0.5 hover:border-line-strong">
                    <Link href={`/paper/${p.id}`} className="flex h-full flex-col p-5">
                      <div className="line-clamp-2 pr-6 font-serif text-[17px] font-medium leading-snug text-fg">{p.title}</div>
                      {p.oneLiner && <p className="mt-2.5 line-clamp-3 text-[13px] leading-relaxed text-muted">{p.oneLiner}</p>}
                      <div className="mt-auto flex items-center gap-2 pt-5 text-xs text-faint">
                        <span>{p.pageCount} 页</span>
                        <span className="h-0.5 w-0.5 rounded-full bg-faint" />
                        <span>{new Date(p.createdAt).toLocaleDateString("zh-CN", { month: "long", day: "numeric" })}</span>
                      </div>
                    </Link>
                    <button
                      aria-label="删除论文"
                      onClick={() => confirm(`删除《${p.title}》？`) && deletePaper(p.id)}
                      className="absolute right-3 top-3 rounded-md p-1.5 text-faint opacity-0 transition hover:bg-white/5 hover:text-red-300 focus:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
