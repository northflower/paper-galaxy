import { fetchJson, type Result } from "./http.js";

const S2_API = "https://api.semanticscholar.org/graph/v1";
const SOURCE = "Semantic Scholar";

const PAPER_FIELDS = [
  "paperId",
  "externalIds",
  "url",
  "title",
  "abstract",
  "venue",
  "year",
  "publicationDate",
  "authors",
  "citationCount",
  "referenceCount",
  "influentialCitationCount",
  "fieldsOfStudy",
  "openAccessPdf",
  "tldr",
].join(",");

const LINKED_PAPER_FIELDS = ["paperId", "externalIds", "title", "year", "venue", "authors", "citationCount", "abstract"];

export interface PaperSummary {
  paperId: string | null;
  title: string | null;
  year: number | null;
  venue: string | null;
  authors: string[];
  citationCount: number | null;
  arxivId?: string;
  doi?: string;
  abstract?: string | null;
}

export interface PaperDetails extends PaperSummary {
  url: string | null;
  abstract: string | null;
  publicationDate: string | null;
  referenceCount: number | null;
  influentialCitationCount: number | null;
  fieldsOfStudy: string[];
  openAccessPdf: string | null;
  tldr: string | null;
}

export interface LinkedPaper {
  paper: PaperSummary;
  isInfluential: boolean;
  intents: string[];
  contexts: string[];
}

export interface LinkedPapersResult {
  paperId: string;
  direction: "references" | "citations";
  offset: number;
  next: number | null;
  returned: number;
  papers: LinkedPaper[];
}

/**
 * Accepts the identifier shapes people actually paste and maps them onto the
 * Semantic Scholar paper-id syntax:
 *   2106.09685 / 2106.09685v2 / arXiv:2106.09685 / arxiv.org/abs/… → arXiv:2106.09685
 *   10.18653/v1/N19-1423 / doi:… / https://doi.org/…            → DOI:10.18653/v1/N19-1423
 *   40-char S2 hash, CorpusId:123, PMID:…, ACL:…                   → passed through
 */
export function normalizePaperId(input: string): string {
  let id = input.trim();

  const arxivUrl = id.match(/arxiv\.org\/(?:abs|pdf)\/([^\s?#]+?)(?:\.pdf)?(?:[?#].*)?$/i);
  if (arxivUrl) id = `arXiv:${arxivUrl[1]}`;

  const doiUrl = id.match(/^https?:\/\/(?:dx\.)?doi\.org\/(.+)$/i);
  if (doiUrl) id = decodeURIComponent(doiUrl[1]);

  const s2Url = id.match(/semanticscholar\.org\/paper\/(?:[^/]+\/)?([0-9a-f]{40})/i);
  if (s2Url) return s2Url[1];

  if (/^doi:/i.test(id)) return `DOI:${id.slice(4).trim()}`;
  if (/^10\.\d{4,9}\//.test(id)) return `DOI:${id}`;

  const arxivPrefixed = id.match(/^arxiv:\s*(.+)$/i);
  const bareArxiv = arxivPrefixed ? arxivPrefixed[1] : id;
  // New-style (2106.09685) and old-style (hep-th/9901001) arXiv ids; S2 wants no version suffix.
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(bareArxiv) || /^[a-z-]+(\.[A-Z]{2})?\/\d{7}(v\d+)?$/i.test(bareArxiv)) {
    return `arXiv:${bareArxiv.replace(/v\d+$/, "")}`;
  }

  return id;
}

function headers(): Record<string, string> {
  const key = process.env.SEMANTIC_SCHOLAR_API_KEY?.trim();
  return key ? { "x-api-key": key } : {};
}

function summarize(p: Record<string, any> | null | undefined, withAbstract = false): PaperSummary {
  const ext = p?.externalIds ?? {};
  const summary: PaperSummary = {
    paperId: p?.paperId ?? null,
    title: p?.title ?? null,
    year: p?.year ?? null,
    venue: p?.venue || null,
    authors: (p?.authors ?? []).map((a: { name?: string }) => a.name).filter(Boolean),
    citationCount: p?.citationCount ?? null,
  };
  if (ext.ArXiv) summary.arxivId = ext.ArXiv;
  if (ext.DOI) summary.doi = ext.DOI;
  if (withAbstract) summary.abstract = p?.abstract ?? null;
  return summary;
}

export async function getPaper(idOrDoi: string): Promise<Result<PaperDetails>> {
  const id = normalizePaperId(idOrDoi);
  const res = await fetchJson<Record<string, any>>(
    `${S2_API}/paper/${encodeURIComponent(id)}?fields=${PAPER_FIELDS}`,
    { source: SOURCE, headers: headers(), retries: 2 },
  );
  if (!res.ok) {
    if (res.error.code === "NOT_FOUND") {
      res.error.message = `Semantic Scholar 未收录论文 "${idOrDoi}"（解析为 ${id}）。可尝试 arXiv id、DOI 或先用 search_arxiv 查找。`;
    }
    return res;
  }
  const p = res.data;
  return {
    ok: true,
    data: {
      ...summarize(p),
      url: p.url ?? null,
      abstract: p.abstract ?? null,
      publicationDate: p.publicationDate ?? null,
      referenceCount: p.referenceCount ?? null,
      influentialCitationCount: p.influentialCitationCount ?? null,
      fieldsOfStudy: p.fieldsOfStudy ?? [],
      openAccessPdf: p.openAccessPdf?.url || null,
      tldr: p.tldr?.text ?? null,
    },
  };
}

async function getLinked(
  direction: "references" | "citations",
  paperId: string,
  limit: number,
  offset: number,
  includeAbstract: boolean,
): Promise<Result<LinkedPapersResult>> {
  const id = normalizePaperId(paperId);
  const nested = direction === "references" ? "citedPaper" : "citingPaper";
  const linkedFields = includeAbstract ? LINKED_PAPER_FIELDS : LINKED_PAPER_FIELDS.filter((f) => f !== "abstract");
  const fields = ["contexts", "intents", "isInfluential", ...linkedFields.map((f) => `${nested}.${f}`)].join(",");
  const params = new URLSearchParams({ fields, limit: String(limit), offset: String(offset) });

  const res = await fetchJson<{ offset?: number; next?: number; data?: Record<string, any>[] }>(
    `${S2_API}/paper/${encodeURIComponent(id)}/${direction}?${params}`,
    { source: SOURCE, headers: headers(), retries: 2 },
  );
  if (!res.ok) {
    if (res.error.code === "NOT_FOUND") {
      res.error.message = `Semantic Scholar 未收录论文 "${paperId}"（解析为 ${id}）。`;
    }
    return res;
  }

  const papers = (res.data.data ?? [])
    .filter((row) => row[nested]?.title)
    .map((row) => ({
      paper: summarize(row[nested], includeAbstract),
      isInfluential: Boolean(row.isInfluential),
      intents: row.intents ?? [],
      // Citation contexts can be long; a couple of snippets is enough for an agent.
      contexts: (row.contexts ?? []).slice(0, 2),
    }));

  return {
    ok: true,
    data: {
      paperId: id,
      direction,
      offset: res.data.offset ?? offset,
      next: res.data.next ?? null,
      returned: papers.length,
      papers,
    },
  };
}

export const getReferences = (paperId: string, limit = 20, offset = 0, includeAbstract = false) =>
  getLinked("references", paperId, limit, offset, includeAbstract);

export const getCitations = (paperId: string, limit = 20, offset = 0, includeAbstract = false) =>
  getLinked("citations", paperId, limit, offset, includeAbstract);
