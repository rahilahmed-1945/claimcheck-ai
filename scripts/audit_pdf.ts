/**
 * Offline audit script: runs extractPdf + runAudit on a local PDF file
 * and prints a structured summary without starting the server.
 *
 * Usage:
 *   node --import tsx scripts/audit_pdf.ts <path-to-pdf>
 */
import fs from "node:fs";
import path from "node:path";
import { extractPdf } from "../server/src/pdf/extract.js";
import { runAudit } from "../server/src/audit/engine.js";

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error("Usage: node --import tsx scripts/audit_pdf.ts <path-to-pdf>");
  process.exit(1);
}

const absPath = path.resolve(pdfPath);
if (!fs.existsSync(absPath)) {
  console.error("File not found:", absPath);
  process.exit(1);
}

console.log("Reading:", absPath);
const buffer = fs.readFileSync(absPath);
console.log(`File size: ${(buffer.length / 1024).toFixed(1)} KB\n`);

const extracted = await extractPdf(buffer);
console.log(`Pages: ${extracted.pageCount}, Pages with text: ${extracted.pagesWithText}`);
console.log(`Words: ${extracted.wordCount}, Sentences extracted: ${extracted.sentences.length}`);
console.log(`Tables detected: ${extracted.tables.length} (reliable: ${extracted.tables.filter(t=>t.reliable).length})`);
console.log(`Sections: ${extracted.sections.filter(s=>s.auditable).map(s=>s.title).join(", ")}`);

if (extracted.warnings.length > 0) {
  console.log("\nExtraction warnings:");
  for (const w of extracted.warnings) console.log("  !", w);
}

const audit = runAudit(extracted, Date.now());
console.log(`\nFindings: ${audit.findings.length}`);
console.log(`Limitations: ${audit.limitations.length}`);

if (audit.findings.length === 0) {
  console.log("No auditable claims were found.");
  process.exit(0);
}

console.log("\n--- FINDINGS ---");
for (const f of audit.findings) {
  console.log(`\n[${f.id}] ${f.category.toUpperCase()} (${f.confidence})`);
  console.log(`  Claim (p.${f.claim.page}, §${f.claim.sectionTitle}):`);
  console.log(`    "${f.claim.text.slice(0, 160)}${f.claim.text.length > 160 ? "…" : ""}"`);
  console.log(`  Rationale: ${f.rationale.slice(0, 200)}`);
  if (f.evidence.length === 0) {
    console.log("  Evidence: NONE");
  } else {
    for (const ev of f.evidence) {
      console.log(`  Evidence [${ev.relation}] (p.${ev.page}, §${ev.sectionTitle}, kind=${ev.kind}):`);
      console.log(`    "${ev.quote.slice(0, 100)}${ev.quote.length > 100 ? "…" : ""}"`);
      if (ev.note) console.log(`    note: ${ev.note}`);
    }
  }
  if (f.numericComparisons.length > 0) {
    for (const c of f.numericComparisons) {
      console.log(`  Numeric: ${c.metric} — claim ${c.claimValue} vs evidence ${c.evidenceValue} (Δ${c.delta})`);
    }
  }
}

// Summary table
const byCategory: Record<string, number> = {};
for (const f of audit.findings) byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
console.log("\n--- SUMMARY ---");
console.log(`Total findings: ${audit.findings.length}`);
for (const [cat, count] of Object.entries(byCategory)) {
  console.log(`  ${cat}: ${count}`);
}
const withEvidence = audit.findings.filter(f => f.evidence.length > 0).length;
console.log(`Findings with evidence links: ${withEvidence}/${audit.findings.length}`);
const withContext = audit.findings.filter(f => f.evidence.some(e => e.relation === "context")).length;
const withSupport = audit.findings.filter(f => f.evidence.some(e => e.relation === "supports")).length;
const withConflict = audit.findings.filter(f => f.evidence.some(e => e.relation === "conflicts")).length;
console.log(`  - supporting evidence: ${withSupport}`);
console.log(`  - conflicting evidence: ${withConflict}`);
console.log(`  - context-only evidence: ${withContext}`);
