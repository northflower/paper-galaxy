import { XMLParser } from "fast-xml-parser";
import { fetchText, type Result } from "./http.js";

const ARXIV_API = "https://export.arxiv.org/api/query";
const SOURCE = "arXiv";

export interface ArxivPaper {
  /** Versioned id, e.g. "1706.03762v7". */
  id: string;
  /** Id without the version suffix, e.g. "1706.03762". Usable with get_paper. */
  baseId: string;
  title: string;
  authors: string[];
  summary: string;
  published: string;
  updated: string;
  primaryCategory?: string;
  categories: string[];
  absUrl: string;
  pdfUrl: string;
  doi?: string;
  comment?: string;
  journalRef?: string;
}

export interface ArxivSearchResult {
  query: string;
  searchQuery: string;
  totalResults: number;
  returned: number;
  papers: ArxivPaper[];
}

export type ArxivSortBy = "relevance" | "lastUpdatedDate" | "submittedDate";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  isArray: (name) => ["entry", "author", "link", "category"].includes(name),
  textNodeName: "#text",
  trimValues: true,
});

const FIELD_PREFIX = /\b(ti|au|abs|co|jr|cat|rn|id|all):/;

// arXiv's index drops these, so `AND all:is` would match nothing.
const STOPWORDS = new Set(
  "a an and are as at be but by for if in into is it no not of on or such that the their then there these they this to was will with".split(
    " ",
  ),
);

/**
 * Plain text such as `diffusion transformer` becomes
 * `all:diffusion AND all:transformer` (stopwords removed); queries that already
 * use arXiv field prefixes (ti:, au:, cat: …) or quotes are passed through.
 */
export function buildArxivQuery(query: string): string {
  const q = query.trim();
  if (FIELD_PREFIX.test(q)) return q;
  if (q.startsWith('"') && q.endsWith('"')) return `all:${q}`;
  const words = q
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}\-.]/gu, ""))
    .filter(Boolean);
  const terms = words.filter((t) => !STOPWORDS.has(t.toLowerCase()));
  return (terms.length ? terms : words).map((t) => `all:${t}`).join(" AND ");
}

const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) {
    return String((v as Record<string, unknown>)["#text"]);
  }
  return "";
};

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

function toPaper(entry: Record<string, any>): ArxivPaper {
  const absUrl = text(entry.id);
  const id = absUrl.replace(/^https?:\/\/arxiv\.org\/abs\//, "");
  const links: Record<string, any>[] = entry.link ?? [];
  const pdfLink = links.find((l) => l["@_title"] === "pdf" || l["@_type"] === "application/pdf");
  const categories: string[] = (entry.category ?? []).map((c: Record<string, any>) => c["@_term"]).filter(Boolean);

  return {
    id,
    baseId: id.replace(/v\d+$/, ""),
    title: clean(text(entry.title)),
    authors: (entry.author ?? []).map((a: Record<string, any>) => clean(text(a.name))),
    summary: clean(text(entry.summary)),
    published: text(entry.published),
    updated: text(entry.updated),
    primaryCategory: entry.primary_category?.["@_term"],
    categories,
    absUrl,
    pdfUrl: pdfLink?.["@_href"] ?? absUrl.replace("/abs/", "/pdf/"),
    doi: text(entry.doi) || undefined,
    comment: clean(text(entry.comment)) || undefined,
    journalRef: clean(text(entry.journal_ref)) || undefined,
  };
}

export async function searchArxiv(
  query: string,
  maxResults = 10,
  sortBy: ArxivSortBy = "relevance",
): Promise<Result<ArxivSearchResult>> {
  const searchQuery = buildArxivQuery(query);
  const params = new URLSearchParams({
    search_query: searchQuery,
    start: "0",
    max_results: String(maxResults),
    sortBy,
    sortOrder: "descending",
  });

  const res = await fetchText(`${ARXIV_API}?${params}`, { source: SOURCE, timeoutMs: 20_000, retries: 2 });
  if (!res.ok) return res;

  let feed: Record<string, any>;
  try {
    feed = parser.parse(res.data)?.feed;
    if (!feed) throw new Error("missing <feed>");
  } catch (err) {
    return {
      ok: false,
      error: { code: "PARSE_ERROR", source: SOURCE, message: `无法解析 arXiv Atom 响应：${String(err)}` },
    };
  }

  const entries: Record<string, any>[] = feed.entry ?? [];
  // arXiv reports malformed queries as a single entry whose id points at /api/errors.
  const errorEntry = entries.find((e) => text(e.id).includes("/api/errors"));
  if (errorEntry) {
    return {
      ok: false,
      error: { code: "BAD_REQUEST", source: SOURCE, message: `arXiv 查询语法错误：${clean(text(errorEntry.summary))}` },
    };
  }

  const papers = entries.map(toPaper);
  return {
    ok: true,
    data: {
      query,
      searchQuery,
      totalResults: Number(text(feed.totalResults)) || papers.length,
      returned: papers.length,
      papers,
    },
  };
}
