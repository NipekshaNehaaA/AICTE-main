import type { HandbookChunk } from './indexer.ts';

export interface SearchResult {
  chunk: HandbookChunk;
  score: number;
  matchedTerms: string[];
}

const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren',
  'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'could', 'did', 'do', 'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from',
  'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself',
  'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'me', 'more', 'most',
  'my', 'myself', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our',
  'ours', 'ourselves', 'out', 'over', 'own', 'same', 'she', 'should', 'so', 'some', 'such', 'than',
  'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this',
  'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what', 'when',
  'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'would', 'you', 'your', 'yours',
  // Common conversation & action fillers
  'make', 'get', 'take', 'give', 'find', 'know', 'tell', 'show', 'use', 'using', 'need', 'want',
  'help', 'please', 'like', 'good', 'well', 'many', 'much', 'also'
]);

export function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9.()\-]/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 1);
}

export function extractSignificantTerms(query: string): string[] {
  return tokenize(query).filter(t => !STOP_WORDS.has(t) && isNaN(Number(t)));
}

export class BM25Engine {
  private chunks: HandbookChunk[];
  private docTokens: string[][];
  private docLengths: number[];
  private termFreqs: Map<string, number>[];
  private docFreqs: Map<string, number>;
  private idf: Map<string, number>;
  private avgdl: number;
  private k1: number = 1.5;
  private b: number = 0.75;

  constructor(chunks: HandbookChunk[]) {
    this.chunks = chunks;
    const N = chunks.length;
    this.docTokens = [];
    this.docLengths = [];
    this.termFreqs = [];
    this.docFreqs = new Map();
    this.idf = new Map();

    let totalLen = 0;
    for (let i = 0; i < N; i++) {
      const c = chunks[i];
      const fullText = `${c.clause} ${c.title} ${c.chapter} ${c.text}`;
      const tokens = tokenize(fullText);
      this.docTokens.push(tokens);
      this.docLengths.push(tokens.length);
      totalLen += tokens.length;

      const tf = new Map<string, number>();
      const seen = new Set<string>();
      for (const t of tokens) {
        tf.set(t, (tf.get(t) || 0) + 1);
        if (!seen.has(t)) {
          seen.add(t);
          this.docFreqs.set(t, (this.docFreqs.get(t) || 0) + 1);
        }
      }
      this.termFreqs.push(tf);
    }

    this.avgdl = totalLen / (N || 1);

    for (const [term, df] of this.docFreqs.entries()) {
      const idfVal = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      this.idf.set(term, idfVal);
    }
  }

  public search(query: string, topK: number = 3, cutoffScore: number = 10.0): SearchResult[] {
    const rawTokens = tokenize(query);
    if (rawTokens.length === 0) return [];

    const significantTerms = extractSignificantTerms(query);

    // Detect exact clause pattern in query (e.g., "1.8", "2.14", "clause 6.2")
    const clauseMatch = query.match(/(?:clause|section)?\s*([1-8]\.[0-9]+(?:\.[0-9]+)?(?:\([a-z0-9]+\))?)/i);
    const targetClause = clauseMatch ? clauseMatch[1].toLowerCase() : null;

    // Detect annexure pattern in query (e.g., "annexure 2", "annexure-5")
    const annexureMatch = query.match(/annexure\s*[-–—]?\s*([0-9]+)/i);
    const targetAnnexure = annexureMatch ? `annexure ${annexureMatch[1]}`.toLowerCase() : null;

    // Detect chapter pattern in query (e.g. "chapter 1", "chapter vii")
    const chapterMatch = query.match(/chapter\s*([ivxlcdm0-9]+)/i);
    const targetChapter = chapterMatch ? `chapter ${chapterMatch[1]}`.toLowerCase() : null;

    const scores: { index: number; score: number; matched: string[] }[] = [];

    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i];
      const tf = this.termFreqs[i];
      const dl = this.docLengths[i];
      let score = 0;
      const matched: string[] = [];

      let hasSignificantMatch = false;
      if (significantTerms.length > 0) {
        for (const st of significantTerms) {
          if (tf.has(st)) {
            hasSignificantMatch = true;
            break;
          }
        }
      } else {
        hasSignificantMatch = true;
      }

      // Exact clause boost (+35.0)
      if (targetClause && (chunk.clause.toLowerCase() === targetClause || chunk.clause.toLowerCase().startsWith(targetClause))) {
        score += 35.0;
        hasSignificantMatch = true;
        matched.push(`Clause ${chunk.clause}`);
      }

      // Exact annexure boost (+30.0)
      if (targetAnnexure && (chunk.clause.toLowerCase().includes(targetAnnexure) || chunk.chapter.toLowerCase().includes(targetAnnexure))) {
        score += 30.0;
        hasSignificantMatch = true;
        matched.push(chunk.clause);
      }

      // Exact chapter boost (+25.0)
      if (targetChapter && chunk.chapter.toLowerCase().includes(targetChapter)) {
        score += 25.0;
        hasSignificantMatch = true;
        matched.push(chunk.chapter);
      }

      // If neither clause matched nor any significant content term matched, disqualify
      if (!hasSignificantMatch && !targetClause && !targetAnnexure && !targetChapter) {
        continue;
      }

      for (const qt of rawTokens) {
        const count = tf.get(qt) || 0;
        if (count > 0 && !STOP_WORDS.has(qt)) {
          matched.push(qt);
          const idfVal = this.idf.get(qt) || 0.5;
          const numerator = count * (this.k1 + 1);
          const denominator = count + this.k1 * (1 - this.b + this.b * (dl / this.avgdl));
          score += idfVal * (numerator / denominator);
        }
      }

      const chunkTitleLower = chunk.title.toLowerCase();
      for (const qt of significantTerms) {
        if (chunkTitleLower.includes(qt)) {
          score += 5.0;
        }
      }

      if (score >= cutoffScore) {
        scores.push({
          index: i,
          score,
          matched: Array.from(new Set(matched)),
        });
      }
    }

    scores.sort((a, b) => b.score - a.score);

    return scores.slice(0, topK).map(s => ({
      chunk: this.chunks[s.index],
      score: s.score,
      matchedTerms: s.matched,
    }));
  }
}
