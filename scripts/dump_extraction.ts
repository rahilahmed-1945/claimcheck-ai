/**
 * Diagnostic: print the structure the extractor recovers from a PDF —
 * sections, tables, and the reading-order document text with page markers.
 *
 * Usage:
 *   node --import tsx scripts/dump_extraction.ts <path-to-pdf>
 */
import fs from "node:fs";
import path from "node:path";
import { extractPdf } from "../server/src/pdf/extract.js";

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error("Usage: node --import tsx scripts/dump_extraction.ts <path-to-pdf>");
  process.exit(1);
}
const extracted = await extractPdf(fs.readFileSync(path.resolve(pdfPath)));
console.log(`Pages ${extracted.pageCount} · words ${extracted.wordCount} · sentences ${extracted.sentences.length}`);
console.log("\n## Sections");
for (const s of extracted.sections) {
  console.log(`  [${s.canonical}${s.auditable ? "" : ", not audited"}] L${s.level} p${s.pageStart}-${s.pageEnd} ${s.title} (${s.wordCount} words)`);
}
console.log("\n## Tables");
for (const t of extracted.tables) {
  console.log(`  Table ${t.label} p${t.page} reliable=${t.reliable}${t.reason ? ` (${t.reason})` : ""}`);
  for (const row of t.rows) console.log(`    | ${row.join(" | ")} |`);
}
console.log("\n## Warnings");
for (const w of extracted.warnings) console.log("  !", w);
console.log("\n## Sentences");
for (const s of extracted.sentences) console.log(`  p${s.page} §${s.sectionTitle} :: ${s.text}`);
