export { createScholarServer, SERVER_NAME, SERVER_VERSION } from "./server.js";
export { searchArxiv, buildArxivQuery } from "./arxiv.js";
export type { ArxivPaper, ArxivSearchResult, ArxivSortBy } from "./arxiv.js";
export { getPaper, getReferences, getCitations, normalizePaperId } from "./semanticScholar.js";
export type { PaperSummary, PaperDetails, LinkedPaper, LinkedPapersResult } from "./semanticScholar.js";
export type { Result, ScholarError, ScholarErrorCode } from "./http.js";
