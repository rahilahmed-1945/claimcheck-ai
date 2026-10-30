import path from "node:path";
import { pathToFileURL } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type {
  CaptionInfo,
  PageText,
  SectionInfo,
  TableInfo,
} from "../../../shared/types.js";
import { MAX_PAGES, ROOT_DIR } from "../config.js";
import { AuditError, ERRORS, safeDetail } from "../errors.js";

export interface Sentence {
  text: string;
  startOffset: number;
  endOffset: number;
  page: number;
  sectionId: string;
  sectionTitle: string;
  sectionCanonical: string;
}

export interface ParsedTable {
  info: TableInfo;
  rowQuotes: string[];
  cells: string[][];
}

export interface ExtractedDocument {
  pageCount: number;
  pages: PageText[];
  sections: SectionInfo[];
  tables: TableInfo[];
  captions: CaptionInfo[];
  text: string;
  sentences: Sentence[];
  extractionMs: number;
  bodyFontSize: number;
  charCount: number;
  wordCount: number;
  pagesWithText: number;
  warnings: string[];
  parsedTables: ParsedTable[];
}

export interface RawItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
}

interface Segment {
  text: string;
  x: number;
  width: number;
}

interface DocLine {
  text: string;
  page: number;
  x: number;
  y: number;
  segments: Segment[];
  fontSize: number;
  bold: boolean;
  /** Share of the line's characters set in a bold face (0–1). */
  boldRatio: number;
  tabular: boolean;
  /** 0 = full width / single column, 1 = left column, 2 = right column. */
  column: number;
  /** Set when the line belongs to a geometrically detected table region. */
  tableRegion: number | null;
  captionKind: "table" | "figure" | null;
  captionLabel: string | null;
  heading: boolean;
  headingTitle: string | null;
  canonical: string | null;
  level: number;
  sectionId: string;
  sectionTitle: string;
  sectionCanonical: string;
  auditable: boolean;
}

interface Block {
  text: string;
  page: number;
  sectionId: string;
  sectionTitle: string;
  sectionCanonical: string;
  kind: "prose" | "table" | "caption";
  startOffset: number;
  endOffset: number;
}

const KNOWN_HEADINGS: { canonical: string; pattern: RegExp }[] = [
  { canonical: "abstract", pattern: /^abstract$/i },
  { canonical: "introduction", pattern: /^(introduction|overview|motivation)$/i },
  { canonical: "related", pattern: /^(related work|literature review|background(?: and related work)?|prior work)$/i },
  {
    canonical: "methods",
    pattern:
      /^(materials? and methods?|methodology|methods?|approach|proposed (?:method|approach|framework|model|system)|experimental (?:setup|design|settings)|experiments?|system design|framework design|architecture(?: and (?:design|components))?|components? and workflow)$/i,
  },
  {
    canonical: "results",
    pattern:
      /^(experimental )?(results?|findings?|evaluation)( and (?:discussion|analysis))?$|^(worked (?:example|scenario|case)|case stud(?:y|ies)|scenario|pilot study|simulation results?|illustrative example|example application|numerical (?:example|results?))$/i,
  },
  { canonical: "discussion", pattern: /^(discussion|analysis|general discussion|interpretation)$/i },
  { canonical: "limitations", pattern: /^(limitations?|threats to validity|scope and limitations?)$/i },
  { canonical: "conclusion", pattern: /^(conclusions?|concluding remarks|summary and conclusions?|future (?:work|directions?)|conclusion and future work)( and future work)?$/i },
  { canonical: "references", pattern: /^(references?|bibliography|works cited)$/i },
  { canonical: "acknowledgments", pattern: /^acknowledge?ments?$/i },
  { canonical: "appendix", pattern: /^(appendix|appendices|supplementary(?: material| information)?)( [a-z0-9])?$/i },
];

const AUDITABLE_CANONICAL = new Set([
  "abstract",
  "introduction",
  "related",
  "methods",
  "results",
  "discussion",
  "limitations",
  "conclusion",
  "appendix",
  "subsection",
  "body",
]);

const CAPTION_RE = /^(table|figure|fig\.)\s+([0-9]+[a-z]?)\s*(?:[.:]\s*(.*)|$)/i;

function normalizeSpace(input: string): string {
  return input.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function cleanHeading(raw: string): string {
  return normalizeSpace(raw.replace(/^\d+(?:\.\d+)*\.?\s+/, ""));
}

// Keyword fallbacks for top-level headings such as "4 Research Methodology"
// or "5 Worked Irrigation Scenario" that do not match a standard title exactly.
const HEADING_KEYWORDS: { canonical: string; pattern: RegExp }[] = [
  { canonical: "related", pattern: /\b(literature review|related work|background)\b/i },
  { canonical: "methods", pattern: /\b(methodology|methods?)\b/i },
  { canonical: "results", pattern: /\b(results?|evaluation|experiments?|worked (?:\w+ )?(?:example|scenario)|case stud(?:y|ies))\b/i },
  { canonical: "discussion", pattern: /\bdiscussion\b/i },
  { canonical: "limitations", pattern: /\blimitations?\b/i },
  { canonical: "conclusion", pattern: /\bconclu(?:sion|sions|ding)\b/i },
];

function canonicalForHeading(rawTitle: string): string | null {
  const cleaned = cleanHeading(rawTitle).replace(/[:.]$/, "").trim();
  for (const entry of KNOWN_HEADINGS) {
    if (entry.pattern.test(cleaned)) return entry.canonical;
  }
  return null;
}

function keywordCanonical(rawTitle: string): string | null {
  // Only single-level numbered headings ("4 Research Methodology").
  if (!/^\d+\.?\s+[A-Z]/.test(rawTitle)) return null;
  const cleaned = cleanHeading(rawTitle);
  if (cleaned.split(/\s+/).length > 6) return null;
  return HEADING_KEYWORDS.find((entry) => entry.pattern.test(cleaned))?.canonical ?? null;
}

function levelForHeading(line: DocLine): number {
  if (line.canonical === "title") return 1;
  if (line.fontSize >= 16) return 1;
  if (/^\d+\.\d+/.test(line.text)) return 2;
  if (/^\d+\./.test(line.text)) return 1;
  return 2;
}

function weightedMedianSize(items: RawItem[]): number {
  const counts = new Map<number, number>();
  for (const item of items) {
    if (!item.str.trim()) continue;
    const size = Math.round(item.height * 2) / 2;
    if (size <= 0) continue;
    counts.set(size, (counts.get(size) ?? 0) + item.str.trim().length);
  }
  const entries = [...counts.entries()].sort((a, b) => a[0] - b[0]);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  if (total === 0) return 10;
  let running = 0;
  for (const [size, count] of entries) {
    running += count;
    if (running >= total / 2) return size;
  }
  return 10;
}

/**
 * Column layout of one page. `gutter` is the x-coordinate of the empty vertical
 * strip that separates two text columns; it is null for single-column pages.
 */
interface PageLayout {
  gutter: number | null;
}

/**
 * Detect a two-column page from the horizontal coverage of its text items.
 *
 * A real column gutter is an x-range that (almost) no text item crosses, located
 * near the middle of the page, with a substantial share of the page's text on
 * each side. Items that do cross it (a full-width title, a spanning figure
 * caption, a centred page number) are treated as full-width lines later.
 *
 * This is deliberately conservative: when no clean gutter exists the page is
 * read as a single column, which is the pre-existing behaviour.
 */
export function detectPageLayout(items: RawItem[], pageWidth: number): PageLayout {
  const usable = items.filter((item) => item.str.trim() && item.width > 0);
  const totalChars = usable.reduce((sum, item) => sum + item.str.trim().length, 0);
  if (usable.length < 20 || totalChars < 400) return { gutter: null };

  const from = Math.floor(pageWidth * 0.3);
  const to = Math.ceil(pageWidth * 0.7);
  const crossing = new Array<number>(to - from + 1).fill(0);
  for (const item of usable) {
    const start = Math.max(from, Math.ceil(item.x));
    const end = Math.min(to, Math.floor(item.x + item.width));
    for (let x = start; x <= end; x += 1) crossing[x - from] = (crossing[x - from] ?? 0) + 1;
  }

  // Allow a few crossing items (titles, affiliations, spanning captions). The
  // interior of a real text column is crossed by dozens of items, one per line.
  const allowed = Math.max(6, Math.floor(usable.length * 0.05));
  let bestStart = -1;
  let bestLength = 0;
  let runStart = -1;
  for (let index = 0; index <= crossing.length; index += 1) {
    const open = index < crossing.length && (crossing[index] ?? 0) <= allowed;
    if (open && runStart < 0) runStart = index;
    if (!open && runStart >= 0) {
      const length = index - runStart;
      if (length > bestLength) {
        bestLength = length;
        bestStart = runStart;
      }
      runStart = -1;
    }
  }
  if (bestStart < 0 || bestLength < 8) return { gutter: null };

  // Within the open strip, place the boundary where the fewest items cross it,
  // so a table cell that pokes into the gutter stays in its own column.
  let fewest = Number.POSITIVE_INFINITY;
  for (let index = bestStart; index < bestStart + bestLength; index += 1) fewest = Math.min(fewest, crossing[index] ?? 0);
  let clearStart = -1;
  let clearLength = 0;
  for (let index = bestStart, run = -1; index <= bestStart + bestLength; index += 1) {
    const clear = index < bestStart + bestLength && (crossing[index] ?? 0) === fewest;
    if (clear && run < 0) run = index;
    if (!clear && run >= 0) {
      if (index - run > clearLength) {
        clearLength = index - run;
        clearStart = run;
      }
      run = -1;
    }
  }
  const gutter = from + clearStart + clearLength / 2;
  let leftChars = 0;
  let rightChars = 0;
  for (const item of usable) {
    const chars = item.str.trim().length;
    if (item.x + item.width <= gutter) leftChars += chars;
    else if (item.x >= gutter) rightChars += chars;
  }
  if (leftChars < totalChars * 0.2 || rightChars < totalChars * 0.2) return { gutter: null };
  return { gutter };
}

/**
 * Build lines for a page in reading order. On a two-column page, the left and
 * right columns are read separately; full-width lines (titles, spanning
 * figures) split the page into horizontal bands, and within each band the
 * left column is read before the right column.
 */
function buildPageLines(items: RawItem[], page: number, layout: PageLayout): DocLine[] {
  const gutter = layout.gutter;
  if (gutter === null) return buildLines(items, page, 0);

  const left: RawItem[] = [];
  const right: RawItem[] = [];
  const spanning: RawItem[] = [];
  for (const item of items) {
    if (item.x + item.width <= gutter + 0.5) left.push(item);
    else if (item.x >= gutter - 0.5) right.push(item);
    else spanning.push(item);
  }

  const leftLines = buildLines(left, page, 1);
  const rightLines = buildLines(right, page, 2);
  const spanLines = buildLines(spanning, page, 0);

  const breaks: { y: number; line: DocLine | null }[] = spanLines.map((line) => ({ y: line.y, line }));
  // On the first page, author blocks often fill both columns above the
  // Abstract / Introduction headings. Read everything above the first such
  // heading (in either column) before the body, so a right-column author
  // block is not appended to the end of the left-column abstract.
  if (page === 1) {
    const opening = [...leftLines, ...rightLines].filter((line) => {
      const canonical = canonicalForHeading(line.text);
      return (canonical === "abstract" || canonical === "introduction") && line.text.split(/\s+/).length <= 4;
    });
    if (opening.length > 0) {
      const top = opening.reduce((best, line) => (line.y > best.y ? line : best));
      breaks.push({ y: top.y + top.fontSize * 0.5, line: null });
      breaks.sort((a, b) => b.y - a.y);
    }
  }

  const ordered: DocLine[] = [];
  let upper = Number.POSITIVE_INFINITY;
  const inBand = (line: DocLine, top: number, bottom: number) => line.y < top && line.y >= bottom;
  for (const separator of [...breaks, null]) {
    const lower = separator ? separator.y : Number.NEGATIVE_INFINITY;
    ordered.push(...leftLines.filter((line) => inBand(line, upper, lower)));
    ordered.push(...rightLines.filter((line) => inBand(line, upper, lower)));
    if (separator?.line) ordered.push(separator.line);
    upper = lower;
  }
  return ordered;
}

function buildLines(items: RawItem[], page: number, column: number): DocLine[] {
  const lines: { y: number; height: number; items: RawItem[] }[] = [];
  // Larger glyphs define lines first; smaller items (sub- and superscripts,
  // inline indices) then attach to the line they sit on instead of forming
  // fragment lines such as "0 T" that later look like headings.
  const sorted = [...items].sort((a, b) => {
    if (Math.abs(b.height - a.height) > 0.5) return b.height - a.height;
    if (Math.abs(b.y - a.y) > 2) return b.y - a.y;
    return a.x - b.x;
  });

  for (const item of sorted) {
    if (!item.str || !item.str.trim()) continue;
    let best: (typeof lines)[number] | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of lines) {
      const dy = item.y - candidate.y;
      const script = item.height < candidate.height * 0.8;
      const fits = script
        ? dy >= -candidate.height * 0.35 && dy <= candidate.height * 0.55
        : Math.abs(dy) <= Math.max(2.2, item.height * 0.35);
      if (fits && Math.abs(dy) < bestDistance) {
        best = candidate;
        bestDistance = Math.abs(dy);
      }
    }
    if (!best) {
      best = { y: item.y, height: item.height, items: [] };
      lines.push(best);
    }
    best.items.push(item);
  }

  const result: DocLine[] = [];
  for (const group of lines) {
    const ordered = group.items.sort((a, b) => a.x - b.x);
    const segments: Segment[] = [];
    let text = "";
    let previousEnd: number | null = null;
    let fontSize = 0;
    let boldWeight = 0;
    let totalChars = 0;

    for (const item of ordered) {
      const raw = item.str.replace(/\u00a0/g, " ");
      if (!raw.trim()) continue;
      const trimmed = raw.replace(/^\s+/, "").replace(/\s+$/, "");
      if (!trimmed) continue;
      const size = item.height || 10;
      fontSize = Math.max(fontSize, size);
      const isBold = /bold|black|heavy|semibold|medi/i.test(item.fontName);
      boldWeight += isBold ? trimmed.length : 0;
      totalChars += trimmed.length;

      if (previousEnd !== null) {
        const gap = item.x - previousEnd;
        const spaceWidth = Math.max(1.8, size * 0.22);
        if (gap > spaceWidth) {
          const spaces = Math.min(5, Math.max(1, Math.round(gap / spaceWidth)));
          text += " ".repeat(spaces);
        } else if (gap > 0.4 && !/\s$/.test(text)) {
          text += " ";
        }
      }
      text += trimmed;
      segments.push({ text: trimmed, x: item.x, width: item.width || trimmed.length * size * 0.5 });
      previousEnd = item.x + (item.width || trimmed.length * size * 0.5);
    }

    const cleaned = normalizeSpace(text);
    if (!cleaned) continue;

    const maxGap = segments.reduce((max, segment, index) => {
      const previous = segments[index - 1];
      if (!previous) return max;
      return Math.max(max, segment.x - (previous.x + previous.width));
    }, 0);

    // Column-like spacing must be substantially larger than a word gap. This keeps
    // numbered headings ("1  Introduction") and inline labels out of table parsing.
    // A header line ("Model  BLEU  Parameters") often has no digits at all, so a
    // short, unpunctuated line with three or more widely spaced segments also counts.
    const headerLike =
      segments.length >= 3 &&
      cleaned.split(/\s+/).filter(Boolean).length <= 10 &&
      !/[.;:]$/.test(cleaned);
    const tabular =
      segments.length >= 2 &&
      maxGap > Math.max(24, fontSize * 2.2) &&
      (/(\d|\.\d)/.test(cleaned) || headerLike) &&
      !/^\d+(?:\.\d+)*\.?\s+[A-Z][A-Za-z]/.test(cleaned);

    const captionMatch = CAPTION_RE.exec(cleaned);
    const line: DocLine = {
      text: cleaned,
      page,
      x: ordered[0]?.x ?? 0,
      y: group.y,
      segments,
      fontSize: fontSize || 10,
      bold: totalChars > 0 && boldWeight / totalChars >= 0.6,
      boldRatio: totalChars > 0 ? boldWeight / totalChars : 0,
      tabular,
      column,
      tableRegion: null,
      captionKind: captionMatch ? (captionMatch[1]?.toLowerCase().startsWith("fig") ? "figure" : "table") : null,
      captionLabel: captionMatch ? String(captionMatch[2]).toUpperCase() : null,
      heading: false,
      headingTitle: null,
      canonical: null,
      level: 1,
      sectionId: "sec-0",
      sectionTitle: "Front matter",
      sectionCanonical: "front",
      auditable: false,
    };
    result.push(line);
  }

  return result.sort((a, b) => {
    if (Math.abs(b.y - a.y) > 2) return b.y - a.y;
    return a.x - b.x;
  });
}

function looksLikeHeading(line: DocLine, bodyFontSize: number, page: number): boolean {
  if (line.tabular || line.captionKind) return false;
  if (line.text.length > 90) return false;
  const words = line.text.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 14) return false;
  if (/[.;]$/.test(line.text)) return false;
  // Fragments such as "0 T" (stray super/subscripts) are never headings.
  if (!/[A-Za-z]{3,}/.test(line.text)) return false;
  // Run-in paragraph labels ("1. Intake Layer: operators submit…",
  // "Steps 3–4, evaluation. Table 2 lists…") mix a bold label with body text.
  const mixedWeight = line.boldRatio > 0.05 && line.boldRatio < 0.95;
  if (mixedWeight && (/:\s*\S/.test(line.text) || /[.!?]\s+\S/.test(line.text))) return false;

  const canonical = canonicalForHeading(line.text);
  if (canonical) {
    if (words.length <= 8) return true;
    return false;
  }

  const pageOneTitle =
    page === 1 && line.fontSize >= bodyFontSize * 1.45 && line.text.length >= 12 && words.length <= 20;
  if (pageOneTitle) return true;

  // Numbered subheadings (e.g. "3.1 Data and splits") are common at body size.
  if (/^\d+(?:\.\d+)*\.?\s+[A-Z]/.test(line.text) && words.length <= 10 && !/[.;:]$/.test(line.text)) {
    return true;
  }

  // Short bold section labels at body size, excluding captions and sentences.
  if (line.bold && words.length <= 8 && titleCaseish(line.text) && !/[.;:]$/.test(line.text)) return true;

  if (!line.bold) return false;
  if (line.fontSize < bodyFontSize * 1.04) return false;
  if (words.length > 10) return false;
  if (/^[a-z]/.test(line.text)) return false;
  if (/^(table|figure|fig\.|eq\.|equation)\b/i.test(line.text)) return false;
  return true;
}

function titleCaseish(text: string): boolean {
  const words = text.replace(/^\d+(?:\.\d+)*\.?\s*/, "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const capitalized = words.filter((word) => /^[A-Z0-9]/.test(word)).length;
  return capitalized / words.length >= 0.5;
}

const ABBREVIATIONS = [
  "e.g.",
  "i.e.",
  "et al.",
  "vs.",
  "cf.",
  "Fig.",
  "Figs.",
  "Eq.",
  "Eqs.",
  "Sec.",
  "Tab.",
  "Ref.",
  "Refs.",
  "No.",
  "Nos.",
  "Dr.",
  "Prof.",
  "Mr.",
  "Ms.",
  "Mrs.",
  "St.",
  "approx.",
  "resp.",
];

function protectAbbreviations(text: string): string {
  let output = text;
  for (const abbreviation of ABBREVIATIONS) {
    // Escape once: the previous double escaping produced a pattern that could
    // never match, so "Fig. 4" and "e.g. X" were split as sentence ends.
    const escaped = abbreviation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    output = output.replace(new RegExp(`(?<![A-Za-z])${escaped}`, "g"), (match) => match.replace(/\./g, "\u0001"));
  }
  // Initials such as "J. Smith" and version numbers should not end a sentence.
  output = output.replace(/\b([A-Z])\.(?=\s+[A-Z][a-z])/g, "$1\u0001");
  return output;
}

function splitSentences(block: Block): { text: string; start: number }[] {
  const original = block.text;
  const protectedText = protectAbbreviations(original);
  const boundaries: number[] = [];
  const regex = /[.!?](?=\s+[A-Z0-9(“"'])/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(protectedText)) !== null) {
    boundaries.push(match.index + 1);
  }

  const pieces: { text: string; start: number }[] = [];
  let cursor = 0;
  for (const boundary of [...boundaries, protectedText.length]) {
    const raw = original.slice(cursor, boundary);
    const restored = raw.replace(/\u0001/g, ".");
    const leading = restored.length - restored.trimStart().length;
    const cleaned = normalizeSpace(restored);
    if (cleaned.length > 0) {
      pieces.push({ text: cleaned, start: cursor + leading });
    }
    cursor = boundary;
  }
  return pieces;
}

function cellSplit(line: DocLine): string[] {
  const byGap: string[] = [];
  let current = "";
  const ordered = [...line.segments].sort((a, b) => a.x - b.x);
  for (let index = 0; index < ordered.length; index += 1) {
    const segment = ordered[index];
    if (!segment) continue;
    const previous = ordered[index - 1];
    if (previous) {
      const gap = segment.x - (previous.x + previous.width);
      if (gap > Math.max(10, line.fontSize * 1.0)) {
        if (current.trim()) byGap.push(normalizeSpace(current));
        current = segment.text;
        continue;
      }
    }
    current = current ? `${current} ${segment.text}` : segment.text;
  }
  if (current.trim()) byGap.push(normalizeSpace(current));
  if (byGap.length >= 2) return byGap;

  const bySpaces = line.text.split(/\s{2,}/).map(normalizeSpace).filter(Boolean);
  return bySpaces;
}

const SYMBOL_CELL_RE = /^[●○◐◑◒◓■□▪▫✓✔✗✘×•◦✚–—−-]$/u;

/** A single table-cell-like token: a number, tuple, symbol, short code or yes/no. */
function isCellToken(raw: string): boolean {
  const text = raw.trim();
  if (!text) return false;
  if (SYMBOL_CELL_RE.test(text)) return true;
  if (/^[([]?[−\-+±]?(?:\d+(?:[.,]\d+)*|[.,]\d+)%?[)\]]?[,;]?$/.test(text)) return true;
  if (/^\(?[−\-+]?\d*\.?\d+(?:\s*,\s*[−\-+]?\d*\.?\d+)+\)?$/.test(text)) return true;
  if (/^(?:yes|no|n\/a|na)$/i.test(text)) return true;
  return /^[A-Z]{2,5}\d?$/.test(text);
}

function isCellularLine(line: DocLine): boolean {
  if (line.captionKind || line.segments.length < 3) return false;
  const cells = line.segments.filter((segment) => isCellToken(segment.text)).length;
  return cells >= 3 && cells / line.segments.length >= 0.6;
}

/** Two cell rows are aligned when most of their cell positions line up vertically. */
function rowsAligned(upper: DocLine, lower: DocLine): boolean {
  const positions = (line: DocLine) =>
    line.segments.filter((segment) => isCellToken(segment.text)).map((segment) => ({
      start: segment.x,
      end: segment.x + segment.width,
    }));
  const a = positions(upper);
  const b = positions(lower);
  if (a.length === 0 || b.length === 0) return false;
  const matched = a.filter((cell) =>
    b.some((other) => Math.abs(other.start - cell.start) <= 2.5 || Math.abs(other.end - cell.end) <= 2.5),
  ).length;
  return matched / Math.min(a.length, b.length) >= 0.6;
}

function isTableLabelLine(line: DocLine): boolean {
  return !line.captionKind && line.text.length <= 45 && !/[.;:]$/.test(line.text);
}

/**
 * Mark compact tables that the large-gap heuristic misses. Two-column papers
 * typeset tables with cell gaps of only a few points, so their rows were
 * previously read as prose and merged into surrounding sentences.
 *
 * A region requires at least two cell rows whose numeric/symbol cells align
 * vertically. Short header lines directly above and short wrapped label lines
 * between or just below the rows are included. Prose lines are never absorbed:
 * they are long, end in punctuation, or contain mostly words.
 */
function markTableRegions(lines: DocLine[], firstRegionId: number): void {
  let regionId = firstRegionId;
  const near = (a: DocLine, b: DocLine) =>
    a.page === b.page && a.column === b.column && Math.abs(a.y - b.y) <= Math.max(a.fontSize, b.fontSize) * 2.6;

  let index = 0;
  while (index < lines.length) {
    const first = lines[index];
    if (!first || first.tableRegion !== null || !isCellularLine(first)) {
      index += 1;
      continue;
    }

    const cellRows = [index];
    let cursor = index + 1;
    let pendingLabels = 0;
    while (cursor < lines.length) {
      const candidate = lines[cursor];
      const previous = lines[cursor - 1];
      if (!candidate || !previous || !near(previous, candidate)) break;
      if (isCellularLine(candidate)) {
        cellRows.push(cursor);
        pendingLabels = 0;
      } else if (isTableLabelLine(candidate) && pendingLabels < 2) {
        pendingLabels += 1;
      } else {
        break;
      }
      cursor += 1;
    }
    const lastRow = cellRows[cellRows.length - 1] ?? index;

    let alignedPairs = 0;
    for (let pair = 1; pair < cellRows.length; pair += 1) {
      const upper = lines[cellRows[pair - 1] ?? -1];
      const lower = lines[cellRows[pair] ?? -1];
      if (upper && lower && rowsAligned(upper, lower)) alignedPairs += 1;
    }
    if (cellRows.length < 2 || alignedPairs < Math.max(1, (cellRows.length - 1) / 2)) {
      index += 1;
      continue;
    }

    // Header and wrapped first-column labels above the first cell row.
    let start = index;
    for (let up = index - 1; up >= Math.max(0, index - 3); up -= 1) {
      const candidate = lines[up];
      const below = lines[up + 1];
      if (!candidate || !below || !near(candidate, below) || candidate.tableRegion !== null) break;
      const headerLike = candidate.segments.length >= 2 && candidate.text.length <= 120 && !/[.;:]$/.test(candidate.text);
      if (!(headerLike || isTableLabelLine(candidate)) || candidate.captionKind || candidate.heading) break;
      start = up;
    }

    // Wrapped labels belonging to the last row.
    let end = lastRow;
    for (let down = lastRow + 1; down <= Math.min(lines.length - 1, lastRow + 2); down += 1) {
      const candidate = lines[down];
      const above = lines[down - 1];
      if (!candidate || !above || !near(above, candidate) || !isTableLabelLine(candidate)) break;
      if (Math.abs(above.y - candidate.y) > candidate.fontSize * 1.4) break;
      end = down;
    }

    for (let member = start; member <= end; member += 1) {
      const line = lines[member];
      if (!line) continue;
      line.tableRegion = regionId;
      line.tabular = true;
    }
    regionId += 1;
    index = end + 1;
  }
}

interface RegionTable {
  header: string[];
  rows: { quote: string; cells: string[] }[];
}

/**
 * Rebuild a geometric table region into header and rows. Columns are the
 * x-intervals of the aligned cell rows; header items and wrapped label lines
 * are assigned to the column they overlap most.
 */
function parseTableRegion(lines: DocLine[]): RegionTable {
  let cellLines = lines.filter(isCellularLine);
  // A header of short codes ("Approach DT MAS LLM") looks like a cell row but
  // carries no values; the rows below it do.
  const hasValues = (line: DocLine) =>
    line.segments.some((segment) => /\d/.test(segment.text) || SYMBOL_CELL_RE.test(segment.text.trim()));
  if (cellLines.length > 2 && !hasValues(cellLines[0] as DocLine) && cellLines.slice(1).every(hasValues)) {
    cellLines = cellLines.slice(1);
  }
  const firstCell = lines.indexOf(cellLines[0] as DocLine);
  // Lines above the first cell row are header lines when they span several
  // columns; a single-segment line there is the wrapped label of the first row.
  const preLines = lines.slice(0, Math.max(0, firstCell));
  const headerLines = preLines.filter((line) => line.segments.length >= 2);
  const labelLines = [
    ...preLines.filter((line) => line.segments.length < 2),
    ...lines.slice(firstCell).filter((line) => !cellLines.includes(line)),
  ];

  const intervals = cellLines
    .flatMap((line) => line.segments.map((segment) => ({ start: segment.x, end: segment.x + segment.width })))
    .sort((a, b) => a.start - b.start);
  const columns: { start: number; end: number }[] = [];
  for (const interval of intervals) {
    const last = columns[columns.length - 1];
    if (last && interval.start <= last.end + 0.5) last.end = Math.max(last.end, interval.end);
    else columns.push({ ...interval });
  }
  // Wrapped labels widen the first column.
  for (const line of [...labelLines, ...headerLines]) {
    for (const segment of line.segments) {
      const first = columns[0];
      if (first && segment.x < first.start + 2 && segment.x + segment.width < (columns[1]?.start ?? Infinity)) {
        first.end = Math.max(first.end, segment.x + segment.width);
        first.start = Math.min(first.start, segment.x);
      }
    }
  }

  const columnFor = (segment: Segment): number => {
    let best = 0;
    let bestScore = -Infinity;
    columns.forEach((column, columnIndex) => {
      const overlap = Math.min(column.end, segment.x + segment.width) - Math.max(column.start, segment.x);
      const centre = Math.abs((column.start + column.end) / 2 - (segment.x + segment.width / 2));
      const score = overlap > 0 ? 1000 + overlap : -centre;
      if (score > bestScore) {
        bestScore = score;
        best = columnIndex;
      }
    });
    return best;
  };
  const toCells = (sources: DocLine[]): string[] => {
    const cells = columns.map(() => [] as string[]);
    for (const line of sources) {
      for (const segment of [...line.segments].sort((a, b) => a.x - b.x)) {
        cells[columnFor(segment)]?.push(segment.text);
      }
    }
    return cells.map((parts) => normalizeSpace(parts.join(" ")));
  };

  const attached = new Map<DocLine, DocLine[]>(cellLines.map((line) => [line, []]));
  for (const label of labelLines) {
    let nearest: DocLine | undefined;
    for (const row of cellLines) {
      if (!nearest || Math.abs(row.y - label.y) < Math.abs(nearest.y - label.y)) nearest = row;
    }
    if (nearest) attached.get(nearest)?.push(label);
  }

  return {
    header: headerLines.length > 0 ? toCells(headerLines) : [],
    rows: cellLines.map((line) => {
      const sources = [...(attached.get(line) ?? []), line].sort((a, b) => b.y - a.y);
      return { quote: line.text, cells: toCells(sources) };
    }),
  };
}

/** The geometric table region directly above or below a table caption, if any. */
function adjacentRegion(lines: DocLine[], captionIndex: number, used: Set<number>): number | null {
  const caption = lines[captionIndex];
  if (!caption) return null;
  const sameColumn = (line: DocLine | undefined): line is DocLine =>
    !!line && line.page === caption.page && line.column === caption.column;
  const above = lines[captionIndex - 1];
  if (sameColumn(above) && above.tableRegion !== null && !used.has(above.tableRegion)) return above.tableRegion;
  for (let cursor = captionIndex + 1; cursor <= Math.min(lines.length - 1, captionIndex + 3); cursor += 1) {
    const candidate = lines[cursor];
    if (!sameColumn(candidate) || candidate.captionKind || candidate.heading) break;
    if (candidate.tableRegion !== null) return used.has(candidate.tableRegion) ? null : candidate.tableRegion;
  }
  return null;
}

/**
 * Captions set in a smaller font often wrap over several lines. Fold those
 * continuation lines into the caption so they are not audited as prose.
 */
function mergeCaptionContinuations(lines: DocLine[], bodyFontSize: number): DocLine[] {
  const result: DocLine[] = [];
  let caption: DocLine | null = null;
  let lastY = 0;
  for (const line of lines) {
    const continues =
      caption !== null &&
      line.page === caption.page &&
      line.column === caption.column &&
      !line.captionKind &&
      line.tableRegion === null &&
      caption.fontSize < bodyFontSize * 0.95 &&
      Math.abs(line.fontSize - caption.fontSize) <= 0.6 &&
      lastY - line.y > 0 &&
      lastY - line.y <= caption.fontSize * 1.8;
    if (continues && caption) {
      caption.text = normalizeSpace(`${caption.text} ${line.text}`);
      lastY = line.y;
      continue;
    }
    caption = line.captionKind ? line : null;
    lastY = line.y;
    result.push(line);
  }
  return result;
}

function detectTables(lines: DocLine[]): { tables: ParsedTable[]; captions: CaptionInfo[] } {
  const captions: CaptionInfo[] = [];
  const tables: ParsedTable[] = [];
  const usedCaptionIndexes = new Set<number>();
  const usedRegions = new Set<number>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || !line.captionKind || !line.captionLabel) continue;
    if (line.captionKind === "figure") {
      captions.push({ kind: "figure", label: line.captionLabel, page: line.page });
      continue;
    }
    captions.push({ kind: "table", label: line.captionLabel, page: line.page });
    if (usedCaptionIndexes.has(index)) continue;
    usedCaptionIndexes.add(index);

    const regionId = adjacentRegion(lines, index, usedRegions);
    if (regionId !== null) {
      usedRegions.add(regionId);
      const region = parseTableRegion(lines.filter((candidate) => candidate.tableRegion === regionId));
      const header = region.header;
      const allRows = header.length > 0 ? [{ quote: "", cells: header }, ...region.rows] : region.rows;
      // Symbol matrices (●/○ capability tables) are structurally reliable even
      // though they carry no numbers; numeric checks simply find nothing in them.
      const numericCells = region.rows
        .flatMap((row) => row.cells)
        .filter((cell) => /\d/.test(cell) || SYMBOL_CELL_RE.test(cell)).length;
      const complete = (cells: string[]) => cells.length === header.length && cells.every((cell) => cell.length > 0);
      const reliable = header.length >= 2 && region.rows.length >= 1 && numericCells >= 2 && complete(header) && region.rows.every((row) => complete(row.cells));
      let reason: string | undefined;
      if (!reliable) {
        if (header.length < 2) reason = "The table header could not be resolved into columns.";
        else if (numericCells < 2) reason = "The table appears to contain no numerical cells.";
        else reason = "Some cells could not be aligned to a column, so values may be misattributed.";
      }
      const headerQuote = lines.find((candidate) => candidate.tableRegion === regionId)?.text ?? "";
      tables.push({
        info: {
          id: `table-${line.page}-${line.captionLabel}-${index}`,
          label: line.captionLabel,
          caption: line.text,
          page: line.page,
          sectionTitle: line.sectionTitle,
          header,
          rows: allRows.map((row) => row.cells),
          reliable,
          ...(reason ? { reason } : {}),
        },
        rowQuotes: allRows.map((row, rowIndex) => (rowIndex === 0 && header.length > 0 ? headerQuote : row.quote)),
        cells: allRows.map((row) => row.cells),
      });
      continue;
    }

    const rows: { line: DocLine; cells: string[] }[] = [];
    const startPage = line.page;
    for (let cursor = index + 1; cursor < Math.min(lines.length, index + 30); cursor += 1) {
      const candidate = lines[cursor];
      if (!candidate) break;
      if (candidate.captionKind || candidate.heading) break;
      if (candidate.page !== startPage) break;
      if (!candidate.tabular) {
        if (rows.length > 0) break;
        if (/^(figure|table)\b/i.test(candidate.text)) break;
        if (candidate.text.length > 160) break;
        continue;
      }
      const cells = cellSplit(candidate);
      if (cells.length >= 2) rows.push({ line: candidate, cells });
      if (rows.length >= 20) break;
    }

    if (rows.length === 0) {
      // Some journals place the caption below the table.
      for (let cursor = index - 1; cursor >= Math.max(0, index - 12); cursor -= 1) {
        const candidate = lines[cursor];
        if (!candidate) break;
        if (candidate.captionKind || candidate.heading) break;
        if (candidate.page !== startPage) break;
        if (!candidate.tabular) {
          if (rows.length > 0) break;
          continue;
        }
        const cells = cellSplit(candidate);
        if (cells.length >= 2) rows.unshift({ line: candidate, cells });
      }
    }

    const header = rows[0]?.cells ?? [];
    const dataRows = rows.slice(1);
    const numericCells = rows.flatMap((row) => row.cells).filter((cell) => /\d/.test(cell)).length;
    // Every row must have the same number of cells as the header. A short row
    // (for example a merged cell or a wrapped label) would silently shift later
    // values into the wrong column, so such a table is not used as evidence.
    const reliable =
      header.length >= 2 &&
      dataRows.length >= 1 &&
      numericCells >= 2 &&
      rows.every((row) => row.cells.length === header.length);

    let reason: string | undefined;
    if (!reliable) {
      if (rows.length === 0) reason = "No table rows could be separated from the surrounding text.";
      else if (header.length < 2) reason = "The table header could not be resolved into columns.";
      else if (numericCells < 2) reason = "The table appears to contain no numerical cells.";
      else reason = "Rows have inconsistent column counts, so values may be misaligned.";
    }

    tables.push({
      info: {
        id: `table-${line.page}-${line.captionLabel}-${index}`,
        label: line.captionLabel,
        caption: line.text,
        page: line.page,
        sectionTitle: line.sectionTitle,
        header,
        rows: rows.map((row) => row.cells),
        reliable,
        ...(reason ? { reason } : {}),
      },
      rowQuotes: rows.map((row) => row.line.text),
      cells: rows.map((row) => row.cells),
    });
  }

  return { tables, captions };
}

export interface ExtractOptions {
  onPage?: (page: number, total: number) => void;
}

export async function extractPdf(buffer: Buffer, options: ExtractOptions = {}): Promise<ExtractedDocument> {
  const started = Date.now();
  const standardFonts = path.join(ROOT_DIR, "node_modules", "pdfjs-dist", "standard_fonts");
  const cmaps = path.join(ROOT_DIR, "node_modules", "pdfjs-dist", "cmaps");
  const toUrl = (directory: string): string => {
    const href = pathToFileURL(`${directory}${path.sep}`).href;
    return href.endsWith("/") ? href : `${href}/`;
  };

  let pdf: Awaited<ReturnType<typeof getDocument>["promise"]> | null = null;
  try {
    const task = getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: false,
      disableFontFace: true,
      useWorkerFetch: false,
      verbosity: 0,
      standardFontDataUrl: toUrl(standardFonts),
      cMapUrl: toUrl(cmaps),
      cMapPacked: true,
    });
    pdf = await task.promise;

    if (pdf.numPages === 0) throw ERRORS.emptyPdf();
    if (pdf.numPages > MAX_PAGES) throw ERRORS.tooManyPages(pdf.numPages);

    const pages: PageText[] = [];
    let allLines: DocLine[] = [];
    const allItems: RawItem[] = [];
    let tableRegionCounter = 0;
    const fontNames = new Map<string, string>();

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      // pdfjs reports opaque font ids ("g_d0_f3"). The real PostScript name
      // ("TimesNewRomanPS-BoldMT") is needed to recognise bold headings and is
      // only available once the page's fonts are loaded. Font ids are shared
      // across the document, so this runs only for pages that add new fonts.
      const pageFonts = new Set(
        (content.items as { fontName?: unknown }[]).map((item) => String(item.fontName ?? "")).filter(Boolean),
      );
      if ([...pageFonts].some((id) => !fontNames.has(id))) {
        try {
          await page.getOperatorList();
        } catch {
          // Font names are a heuristic aid only; fall back to the ids.
        }
        for (const id of pageFonts) {
          if (fontNames.has(id)) continue;
          let resolved = id;
          try {
            const font = page.commonObjs.get(id) as { name?: unknown } | undefined;
            if (typeof font?.name === "string" && font.name) resolved = font.name;
          } catch {
            // Not resolved; keep the id.
          }
          fontNames.set(id, resolved);
        }
      }
      const items: RawItem[] = [];
      for (const raw of content.items as unknown[]) {
        const candidate = raw as {
          str?: unknown;
          transform?: number[];
          width?: number;
          height?: number;
          fontName?: string;
        };
        if (typeof candidate.str !== "string" || !candidate.str.trim()) continue;
        const transform = candidate.transform;
        if (!Array.isArray(transform) || transform.length < 6) continue;
        const item: RawItem = {
          str: candidate.str,
          x: Number(transform[4] ?? 0),
          y: Number(transform[5] ?? 0),
          width: Number(candidate.width ?? 0),
          height: Math.abs(Number(candidate.height ?? 0)) || Math.hypot(Number(transform[2] ?? 0), Number(transform[3] ?? 0)) || 10,
          fontName: fontNames.get(String(candidate.fontName ?? "")) ?? String(candidate.fontName ?? ""),
        };
        items.push(item);
      }
      allItems.push(...items);
      const layout = detectPageLayout(items, page.view?.[2] ?? 612);
      const lines = buildPageLines(items, pageNumber, layout);
      markTableRegions(lines, tableRegionCounter);
      tableRegionCounter = Math.max(tableRegionCounter, ...lines.map((line) => (line.tableRegion ?? -1) + 1));
      allLines.push(...lines);
      pages.push({
        number: pageNumber,
        width: page.view?.[2] ?? 612,
        height: page.view?.[3] ?? 792,
        text: lines.map((line) => line.text).join("\n"),
        lineCount: lines.length,
      });
      options.onPage?.(pageNumber, pdf.numPages);
      page.cleanup();
    }

    const bodyFontSize = weightedMedianSize(allItems);
    allLines = mergeCaptionContinuations(allLines, bodyFontSize);
    const pagesWithText = pages.filter((page) => page.text.trim().length >= 40).length;

    // Mark headings, then assign sections in reading order. The paper title and
    // author block remain front matter; a wrapped title must not create sections.
    const consumed = new Set<DocLine>();
    let topCanonical: string | null = null;
    for (let lineIndex = 0; lineIndex < allLines.length; lineIndex += 1) {
      const line = allLines[lineIndex];
      if (!line || consumed.has(line)) continue;
      if (line.page === 1 && line.fontSize >= bodyFontSize * 1.45) continue;
      if (!looksLikeHeading(line, bodyFontSize, line.page)) continue;

      // A long heading can wrap onto a second short line in the same style
      // ("4.2 Field Site Model and Adoption" / "Protocol").
      const next = allLines[lineIndex + 1];
      if (
        next &&
        next.page === line.page &&
        next.column === line.column &&
        !next.tabular &&
        !next.captionKind &&
        next.bold === line.bold &&
        line.bold &&
        Math.abs(next.fontSize - line.fontSize) <= 0.5 &&
        line.y - next.y > 0 &&
        line.y - next.y <= line.fontSize * 1.6 &&
        /^[A-Z]/.test(next.text) &&
        !/^\d/.test(next.text) &&
        !/[.;:]$/.test(next.text) &&
        next.text.split(/\s+/).length <= 5 &&
        /^\d+(?:\.\d+)*\.?\s/.test(line.text)
      ) {
        line.text = normalizeSpace(`${line.text} ${next.text}`);
        consumed.add(next);
      }

      const canonical = canonicalForHeading(line.text) ?? keywordCanonical(line.text);
      line.heading = true;
      line.level = levelForHeading(line);
      if (canonical) {
        line.headingTitle = cleanHeading(line.text);
        line.canonical = canonical;
      } else {
        line.headingTitle = line.text;
        // Numbered subsections ("4.4 Score Model") inherit the canonical role
        // of their parent section ("4 Research Methodology").
        line.canonical = /^\d+\.\d+/.test(line.text) && topCanonical ? topCanonical : "subsection";
      }
      if (/^\d+\.?\s/.test(line.text) || (canonical && line.level === 1)) topCanonical = canonical;
    }
    if (consumed.size > 0) allLines = allLines.filter((line) => !consumed.has(line));

    const blocks: Block[] = [];
    const sections: SectionInfo[] = [];
    let sectionCounter = 0;
    let current: DocLine["sectionId"] = "sec-0";
    let currentTitle = "Front matter";
    let currentCanonical = "front";
    let currentAuditable = false;
    let currentStartPage = 1;
    let currentLevel = 1;

    const startSection = (title: string, canonical: string, page: number, level: number, auditable: boolean) => {
      sectionCounter += 1;
      current = `sec-${sectionCounter}`;
      currentTitle = title;
      currentCanonical = canonical;
      currentAuditable = auditable;
      currentStartPage = page;
      currentLevel = level;
      sections.push({
        id: current,
        title,
        canonical,
        level,
        pageStart: page,
        pageEnd: page,
        wordCount: 0,
        auditable,
      });
    };

    startSection("Front matter", "front", 1, 1, false);

    let paragraph: DocLine[] = [];
    const flushParagraph = () => {
      if (paragraph.length === 0) return;
      const first = paragraph[0];
      if (!first) {
        paragraph = [];
        return;
      }
      const text = normalizeSpace(
        paragraph
          .map((line, index) => {
            if (index === 0) return line.text;
            const previous = paragraph[index - 1];
            if (previous && /-$/.test(previous.text) && /^[a-z]/.test(line.text)) {
              return line.text;
            }
            return line.text;
          })
          .join(" ")
          .replace(/(\w)-\s+([a-z])/g, "$1$2")
          // Preserve compound hyphens before a capital (“English-to- German”).
          .replace(/(\w)-\s+([A-Z])/g, "$1-$2"),
      );
      if (text.length >= 15) {
        blocks.push({
          text,
          page: first.page,
          sectionId: first.sectionId,
          sectionTitle: first.sectionTitle,
          sectionCanonical: first.sectionCanonical,
          kind: "prose",
          startOffset: 0,
          endOffset: 0,
        });
      }
      paragraph = [];
    };

    for (const line of allLines) {
      if (line.heading) {
        flushParagraph();
        const title = line.headingTitle ?? line.text;
        const canonical = line.canonical ?? "subsection";
        const auditable = AUDITABLE_CANONICAL.has(canonical);
        const previousSection = sections[sections.length - 1];
        if (previousSection) previousSection.pageEnd = Math.max(previousSection.pageStart, line.page);
        startSection(title, canonical, line.page, line.level, auditable);
        continue;
      }

      line.sectionId = current;
      line.sectionTitle = currentTitle;
      line.sectionCanonical = currentCanonical;
      line.auditable = currentAuditable;

      const previous = paragraph[paragraph.length - 1];
      const verticalGap = previous ? previous.y - line.y : 0;
      // A line that starts a numbered list item ("1. ", "2) ", "(a) ") must
      // begin a fresh paragraph. Merging these with the preceding line produces
      // concatenated multi-step sentences that are not coherent claims.
      const isNumberedListItem = /^(?:\d+[.)\-]|\([a-z0-9]+\))\s+[A-Za-z]/i.test(line.text);
      const canJoin =
        previous !== undefined &&
        !isNumberedListItem &&
        previous.page === line.page &&
        !line.tabular &&
        !line.captionKind &&
        !(previous.tabular || previous.captionKind) &&
        !/[.!?:]$/.test(previous.text) &&
        // A jump back to the top of the page is a column change: continue the
        // paragraph only when the next column visibly continues the sentence.
        (verticalGap >= 0 ? verticalGap <= Math.max(previous.fontSize * 1.9, 22) : /^[a-z]/.test(line.text));

      if (line.tabular || line.captionKind) {
        flushParagraph();
        blocks.push({
          text: line.text,
          page: line.page,
          sectionId: current,
          sectionTitle: currentTitle,
          sectionCanonical: currentCanonical,
          kind: line.captionKind ? "caption" : "table",
          startOffset: 0,
          endOffset: 0,
        });
        continue;
      }

      if (!canJoin && paragraph.length > 0) flushParagraph();
      paragraph.push(line);
    }
    flushParagraph();

    // Verify heading sections' page ranges against blocks.
    for (const section of sections) {
      const sectionBlocks = blocks.filter((block) => block.sectionId === section.id);
      if (sectionBlocks.length > 0) {
        section.pageStart = Math.min(...sectionBlocks.map((block) => block.page));
        section.pageEnd = Math.max(...sectionBlocks.map((block) => block.page));
        section.wordCount = sectionBlocks.reduce(
          (sum, block) => sum + block.text.split(/\s+/).filter(Boolean).length,
          0,
        );
      }
      const sectionLines = allLines.filter((line) => line.sectionId === section.id);
      if (sectionLines.length === 0 && section.auditable) section.auditable = false;
    }

    // A readable paper with no recognised headings should still be auditable.
    // Keep an explicit warning so the UI never implies structural certainty.
    const hadStandardSections = sections.some((section) => section.auditable);
    if (!hadStandardSections) {
      const fallback = sections.find((section) => section.id === "sec-0") ?? sections[0];
      if (fallback) {
        fallback.auditable = true;
        fallback.title = "Body (unstructured)";
        fallback.canonical = "body";
        for (const block of blocks) {
          if (block.sectionId !== fallback.id) continue;
          block.sectionTitle = fallback.title;
          block.sectionCanonical = "body";
        }
      }
    }

    let cursor = 0;
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      if (!block) continue;
      block.startOffset = cursor;
      block.endOffset = cursor + block.text.length;
      cursor = block.endOffset + 1;
    }
    const docText = blocks.map((block) => block.text).join("\n");

    const sentences: Sentence[] = [];
    for (const block of blocks) {
      if (block.kind !== "prose") continue;
      const section = sections.find((candidate) => candidate.id === block.sectionId);
      if (!section?.auditable) continue;
      for (const piece of splitSentences(block)) {
        if (piece.text.length < 25) continue;
        // Reject sentences that look like concatenated numbered list steps.
        // A real claim does not start with a digit and contain a second "N. " pattern.
        const numberedStepPattern = /^\d+[.)\-]\s|\s\d+[.)\-]\s[A-Z]/;
        const multipleStepPattern = /(\d+[.)\-]\s[A-Za-z].{5,}){3,}/;
        if (multipleStepPattern.test(piece.text)) continue;
        // Reject bare numbered-list items that are not standalone sentences.
        // e.g. "1. Collect data from validators" is procedural, not a claim.
        if (
          /^\d+[.)\-]\s/.test(piece.text) &&
          !/[.!?](?:\s|$)/.test(piece.text)
        ) continue;
        sentences.push({
          text: piece.text,
          startOffset: block.startOffset + piece.start,
          endOffset: block.startOffset + piece.start + piece.text.length,
          page: block.page,
          sectionId: block.sectionId,
          sectionTitle: block.sectionTitle,
          sectionCanonical: block.sectionCanonical,
        });
      }
    }

    const { tables, captions } = detectTables(allLines);

    const warnings: string[] = [];
    const silentPages = pages.filter((page) => page.text.trim().length < 40).length;
    if (silentPages > 0) {
      warnings.push(
        `${silentPages} page${silentPages === 1 ? "" : "s"} contained little or no selectable text. Claims on those pages cannot be audited.`,
      );
    }
    const unreliable = tables.filter((table) => !table.info.reliable);
    if (unreliable.length > 0) {
      warnings.push(
        `${unreliable.length} detected table${unreliable.length === 1 ? "" : "s"} could not be reconstructed reliably. Table-dependent checks may be incomplete.`,
      );
    }
    if (tables.length === 0 && captions.some((caption) => caption.kind === "table")) {
      warnings.push("Table captions were found, but their contents could not be parsed. No table-value comparisons were run.");
    }
    if (!hadStandardSections) {
      warnings.push("No standard paper sections were detected. Claims were audited from the body text as an unstructured section.");
    }

    const text = docText;
    return {
      pageCount: pages.length,
      pages,
      sections,
      tables: tables.map((table) => table.info),
      captions,
      text,
      sentences,
      extractionMs: Date.now() - started,
      bodyFontSize,
      charCount: text.replace(/\s+/g, "").length,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      pagesWithText,
      warnings,
      parsedTables: tables,
    };
  } catch (error) {
    if (error instanceof AuditError) throw error;
    const name = error instanceof Error ? error.name : "";
    if (name === "PasswordException") throw ERRORS.encrypted();
    if (name === "InvalidPDFException") throw ERRORS.corrupt(safeDetail(error));
    throw ERRORS.extractionFailed(safeDetail(error));
  } finally {
    if (pdf) {
      try {
        await pdf.destroy();
      } catch {
        // Cleanup failure must not replace the real extraction result.
      }
    }
  }
}
