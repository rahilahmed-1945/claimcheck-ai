/**
 * Table-cell evidence for claims that restate table values without a named
 * metric ("the northern site is in favour (r0 = 0.903)").
 *
 * The metric-based matcher in engine.ts only links a value to a table when the
 * column header is a known metric (accuracy, BLEU, …). Many papers report
 * domain quantities instead: model parameters, indices, scores. This module
 * links such values to a specific cell only when the claim identifies the
 * cell's row, and never on a number alone:
 *
 *  - Row: the claim names the row label, or the label is a short code that
 *    abbreviates a word in the claim ("NOR" → "northern").
 *  - Value: equal at the precision of the less precise value. Only specific
 *    values may match on their own: at least three significant digits
 *    ("0.903", "0.364"). Two significant digits ("0.25") need the column
 *    confirmed by a bound symbol. One significant digit ("0.30", "0.60", "12")
 *    never matches: a parameter table is full of such values.
 *    The cell must be at least as precise as the claim.
 *  - Uniqueness: exactly one cell among the referenced rows holds the value.
 *  - Column: if the claim binds a symbol to the number ("r0 = 0.903"), the
 *    column header must be notation-compatible with it ("r i 0").
 *  - Table: a claim that names a table ("Table 3") is matched only to it, and
 *    the caption context (dataset, split) must be comparable.
 *
 * A conflict is reported only when both the row and the column are explicitly
 * identified and the values differ. Everything else is left unmatched.
 */
import type { ParsedTable } from "../pdf/extract.js";
import { contextsComparable, extractContext, extractReferencedObjects, extractSymbolValues, roundedEqual } from "./text.js";

export interface ClaimNumber {
  text: string;
  value: number;
  decimals: number;
  /** Significant digits, ignoring leading and trailing zeros ("0.30" → 1). */
  significant: number;
  index: number;
  end: number;
}

export interface CellMatch {
  table: ParsedTable;
  rowIndex: number;
  columnIndex: number;
  rowLabel: string;
  header: string;
  cellText: string;
  number: ClaimNumber;
  /** True when a symbol bound to the number matched the column header. */
  columnConfirmed: boolean;
}

const NUMBER_RE = /(?<![\w.[])([+−-]?(?:\d+\.\d+|\.\d+|\d+))(?![\w.]*\])/g;

/** Numbers in the claim that are specific enough to identify a cell. */
export function specificNumbers(text: string): ClaimNumber[] {
  const numbers: ClaimNumber[] = [];
  for (const match of text.matchAll(NUMBER_RE)) {
    const raw = match[1] ?? "";
    const normalized = raw.replace(/−/g, "-");
    const decimals = normalized.includes(".") ? normalized.split(".")[1]!.length : 0;
    const significant = normalized.replace(/[^\d]/g, "").replace(/^0+/, "").replace(/0+$/, "").length;
    if (significant < 2) continue;
    const index = match.index ?? 0;
    // Citation numbers ("[19]") and section numbers ("Section 4.1") are not values.
    const before = text.slice(Math.max(0, index - 9), index);
    if (/\b(?:section|sec\.|table|figure|fig\.|eq\.|equation)\s*\(?$/i.test(before)) continue;
    numbers.push({ text: raw, value: Number(normalized), decimals, significant, index, end: index + raw.length });
  }
  return numbers;
}

function cellNumber(cell: string): { value: number; decimals: number } | null {
  const trimmed = cell.trim().replace(/−/g, "-");
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)%?$/.test(trimmed)) return null;
  const numeric = trimmed.replace(/%$/, "");
  const decimals = numeric.includes(".") ? numeric.split(".")[1]!.length : 0;
  return { value: Number(numeric), decimals };
}

/** Whether the claim refers to this row by its label. */
export function claimMentionsRow(claimText: string, label: string): boolean {
  // Drop citations ("[1],[2]") and parentheticals ("(this work)") from the label.
  const cleaned = label
    .replace(/\s*\[[^\]]*\]/g, "")
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/[\s,;]+$/, "")
    .trim();
  if (cleaned.length < 2) return false;
  const escaped = cleaned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(claimText)) return true;
  // A short upper-case code abbreviates a word in the claim: NOR → northern.
  if (/^[A-Z]{3,5}$/.test(cleaned)) {
    const words = claimText.toLowerCase().match(/\p{L}+/gu) ?? [];
    return words.some((word) => word.length > cleaned.length + 2 && word.startsWith(cleaned.toLowerCase()));
  }
  return false;
}

/**
 * A claim symbol is compatible with a header when the header's notation
 * contains the symbol's characters in order with the same first and last
 * character, allowing only an index letter or two in between ("r0" ↔ "r i 0").
 */
export function symbolMatchesHeader(symbol: string, header: string): boolean {
  const a = symbol.replace(/\s+/g, "").toLowerCase();
  const b = header.replace(/\s+/g, "").toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a[0] !== b[0] || a[a.length - 1] !== b[b.length - 1] || b.length - a.length > 2) return false;
  let cursor = 0;
  for (const char of b) if (char === a[cursor]) cursor += 1;
  return cursor === a.length;
}

export function matchTableCells(claimText: string, tables: ParsedTable[]): { supports: CellMatch[]; conflicts: CellMatch[] } {
  const supports: CellMatch[] = [];
  const conflicts: CellMatch[] = [];
  const numbers = specificNumbers(claimText);
  if (numbers.length === 0) return { supports, conflicts };

  const namedTables = extractReferencedObjects(claimText)
    .filter((reference) => reference.kind === "table")
    .map((reference) => reference.label);
  const symbols = extractSymbolValues(claimText);
  const claimContext = extractContext(claimText);

  for (const table of tables) {
    if (!table.info.reliable) continue;
    if (namedTables.length > 0 && !namedTables.includes(table.info.label)) continue;
    const header = table.info.header;
    if (header.length < 2) continue;
    if (!contextsComparable(claimContext, extractContext(table.info.caption)).comparable) continue;

    const rows = table.cells
      .map((cells, rowIndex) => ({ cells, rowIndex }))
      .filter(({ rowIndex }) => rowIndex > 0)
      .filter(({ cells }) => claimMentionsRow(claimText, cells[0] ?? ""));
    if (rows.length === 0) continue;

    for (const number of numbers) {
      const bound = symbols.find((symbol) => number.index >= symbol.index && number.end <= symbol.end);
      const candidates: CellMatch[] = [];
      const columnMatches: CellMatch[] = [];
      for (const { cells, rowIndex } of rows) {
        for (let columnIndex = 1; columnIndex < cells.length; columnIndex += 1) {
          const parsed = cellNumber(cells[columnIndex] ?? "");
          if (!parsed) continue;
          const columnConfirmed = bound ? symbolMatchesHeader(bound.symbol, header[columnIndex] ?? "") : false;
          const match: CellMatch = {
            table,
            rowIndex,
            columnIndex,
            rowLabel: cells[0] ?? "",
            header: header[columnIndex] ?? "",
            cellText: cells[columnIndex] ?? "",
            number,
            columnConfirmed,
          };
          if (columnConfirmed) columnMatches.push(match);
          // A symbol that names a different column rules the cell out.
          if (bound && !columnConfirmed) continue;
          // Two significant digits are too common to identify a cell without its column.
          if (number.significant < 3 && !columnConfirmed) continue;
          // A claim may round a table value ("0.90" from ".903"), but a claim more
          // precise than the cell ("0.903" vs "0.90") cannot have come from it.
          if (parsed.decimals >= number.decimals && roundedEqual(number, parsed)) candidates.push(match);
        }
      }
      if (candidates.length === 1) {
        supports.push(candidates[0]!);
      } else if (candidates.length === 0 && rows.length === 1 && columnMatches.length === 1) {
        // Row and column are both explicit, yet the value differs.
        conflicts.push(columnMatches[0]!);
      }
    }
  }
  return { supports, conflicts };
}
