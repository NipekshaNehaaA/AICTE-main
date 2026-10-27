import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
// @ts-ignore
import pdf from 'pdf-parse/lib/pdf-parse.js';

export interface HandbookChunk {
  id: string;
  chapter: string;
  clause: string;
  title: string;
  page: number;
  pageEnd: number;
  text: string;
  keywords: string[];
}

export interface HandbookIndex {
  version: string;
  sourceFile: string;
  fileHash: string;
  totalPages: number;
  totalChunks: number;
  indexedAt: string;
  chunks: HandbookChunk[];
}

const CHAPTER_MAP = [
  { start: 1, end: 16, title: 'Preliminary, Definitions & Abbreviations' },
  { start: 17, end: 26, title: 'Chapter I: Grant of Approval for New Technical Institution' },
  { start: 27, end: 48, title: 'Chapter II: Grant of Extension of Approval (EoA)' },
  { start: 49, end: 52, title: 'Chapter III: Collaboration & Twinning Programme' },
  { start: 53, end: 60, title: 'Chapter IV: Grant of Approval for Universities' },
  { start: 61, end: 68, title: 'Chapter V: Approval for ODL and Online Learning' },
  { start: 69, end: 85, title: 'Chapter VI: Standard Norms and Requirements' },
  { start: 86, end: 90, title: 'Chapter VII: Penal Actions on Violation of Norms' },
  { start: 91, end: 92, title: 'Chapter VIII: AICTE Do’s and Don’ts' },
  { start: 93, end: 96, title: 'Annexure 1: Documents for Setting up New Technical Institution' },
  { start: 97, end: 101, title: 'Annexure 2: Documents to be Uploaded for EoA' },
  { start: 102, end: 107, title: 'Annexure 3: Norms for Land and Built-up Area' },
  { start: 108, end: 110, title: 'Annexure 4: Norms for Books, Library, Computer, Software' },
  { start: 111, end: 112, title: 'Annexure 5: Norms for Faculty Requirements and Cadre Ratio' },
  { start: 113, end: 115, title: 'Annexure 6: Norms for PGDM/PGCM Courses' },
  { start: 116, end: 116, title: 'Annexure 7: Process Flow Chart for New Technical Institution' },
  { start: 117, end: 126, title: 'Annexure 8: Norms for Duration and Entry Level Qualifications' },
  { start: 127, end: 127, title: 'Annexure 9: MBA/PGDM in Innovation' },
  { start: 128, end: 128, title: 'Annexure 10: Undertaking by Applicant Institute' },
  { start: 129, end: 191, title: 'Annexure 11-15: Course Nomenclature, Disciplines & FPM' },
  { start: 192, end: 194, title: 'Annexure 16: Structure of Various Committees (Scrutiny, EVC, SAC, SHC)' },
  { start: 195, end: 195, title: 'Annexure 17: Recommended Composition of Board of Governors' },
  { start: 196, end: 231, title: 'Annexure 18: Mandatory Disclosures & Affidavits' },
];

function getChapterTitle(page: number): string {
  for (const ch of CHAPTER_MAP) {
    if (page >= ch.start && page <= ch.end) return ch.title;
  }
  return 'Approval Process Handbook 2024-27';
}

function cleanText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/Approval Process Handbook 2024[-–]2027\s*\d*/gi, '')
    .trim();
}

function extractKeywords(text: string, title: string, clause: string): string[] {
  const full = `${text} ${title} ${clause}`.toLowerCase();
  const words = full.replace(/[^a-z0-9\-]/g, ' ').split(/\s+/);
  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'are', 'from', 'shall', 'been', 'have',
    'which', 'will', 'such', 'not', 'any', 'all', 'per', 'under', 'may', 'has', 'their',
    'can', 'into', 'our', 'out', 'also', 'other', 'more', 'one', 'two'
  ]);
  const freq: Record<string, number> = {};
  for (const w of words) {
    if (w.length > 2 && !stopWords.has(w)) {
      freq[w] = (freq[w] || 0) + 1;
    }
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([w]) => w);
}

export async function getOrBuildHandbookIndex(
  pdfRelativePath = 'data/handbook/aph_2024_27.pdf',
  indexRelativePath = 'data/handbook/aph_index.json',
): Promise<HandbookIndex> {
  const pdfPath = path.resolve(process.cwd(), pdfRelativePath);
  const indexPath = path.resolve(process.cwd(), indexRelativePath);

  if (!fs.existsSync(pdfPath)) {
    throw new Error(`Handbook PDF not found at ${pdfPath}`);
  }

  const pdfBuffer = fs.readFileSync(pdfPath);
  const pdfHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

  // Check if cache index exists and is up to date
  if (fs.existsSync(indexPath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as HandbookIndex;
      if (cached.fileHash === pdfHash && cached.chunks && cached.chunks.length > 0) {
        return cached;
      }
    } catch {
      // Rebuild if corrupted
    }
  }

  // Parse PDF page by page
  const pages: { pageNumber: number; text: string }[] = [];
  const options = {
    pagerender: (pageData: any) => {
      return pageData.getTextContent().then((textContent: any) => {
        let text = '';
        for (const item of textContent.items) {
          text += item.str + ' ';
        }
        pages.push({ pageNumber: pageData.pageIndex + 1, text: text.trim() });
        return text;
      });
    },
  };

  await (pdf as any)(pdfBuffer, options);

  const chunks: HandbookChunk[] = [];

  for (const page of pages) {
    const chTitle = getChapterTitle(page.pageNumber);
    const cleanedPageText = cleanText(page.text);

    if (page.pageNumber >= 93) {
      // Annexure sections: chunk by page or section header
      const annexureMatch = cleanedPageText.match(/(ANNEXURE\s*[-–—]?\s*[0-9]+)\s+([A-Za-z0-9\s,/()\-–]{4,80})/i);
      const clauseTag = annexureMatch ? annexureMatch[1].toUpperCase() : chTitle.split(':')[0].trim();
      const titleTag = annexureMatch ? annexureMatch[2].trim() : (chTitle.includes(':') ? chTitle.split(':')[1].trim() : chTitle);

      chunks.push({
        id: `chunk_p${page.pageNumber}`,
        chapter: chTitle,
        clause: clauseTag,
        title: titleTag,
        page: page.pageNumber,
        pageEnd: page.pageNumber,
        text: cleanedPageText,
        keywords: extractKeywords(cleanedPageText, titleTag, clauseTag),
      });
      continue;
    }

    // Chapters I through VIII: Split by numbered statutory clauses (e.g. 1.8, 2.14, 6.2)
    const parts = cleanedPageText.split(/(?=(?:^|\s)(?:Clause\s+)?[1-8]\.[0-9]+(?:\.[0-9]+)?\s+[A-Z])/);
    for (const part of parts) {
      const cleanPart = part.trim();
      if (!cleanPart) continue;

      const m = cleanPart.match(/(?:Clause\s+)?([1-8]\.[0-9]+(?:\.[0-9]+)?)\s+([A-Z][A-Za-z0-9\s,/()\-–]{3,60}?)(?:\.|\n|\r|[a-z])/);
      if (m) {
        const clauseNum = m[1];
        const clauseTitle = m[2].trim();
        chunks.push({
          id: `chunk_${clauseNum.replace(/[^0-9a-z]/gi, '_')}_p${page.pageNumber}`,
          chapter: chTitle,
          clause: clauseNum,
          title: clauseTitle,
          page: page.pageNumber,
          pageEnd: page.pageNumber,
          text: cleanPart,
          keywords: extractKeywords(cleanPart, clauseTitle, clauseNum),
        });
      } else {
        // Subpart or introductory text
        const fallbackTitle = chTitle.includes(':') ? chTitle.split(':')[1].trim() : chTitle;
        const clauseNum = chTitle.split(':')[0].trim();
        chunks.push({
          id: `chunk_p${page.pageNumber}_${chunks.length}`,
          chapter: chTitle,
          clause: clauseNum,
          title: fallbackTitle,
          page: page.pageNumber,
          pageEnd: page.pageNumber,
          text: cleanPart,
          keywords: extractKeywords(cleanPart, fallbackTitle, clauseNum),
        });
      }
    }
  }

  const indexData: HandbookIndex = {
    version: 'AICTE Approval Process Handbook (APH 2024-25 to 2026-27)',
    sourceFile: path.basename(pdfPath),
    fileHash: pdfHash,
    totalPages: pages.length,
    totalChunks: chunks.length,
    indexedAt: new Date().toISOString(),
    chunks,
  };

  // Ensure parent directory exists and persist cache
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2), 'utf8');

  return indexData;
}
