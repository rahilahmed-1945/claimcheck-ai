/**
 * Diagnostic: show scoreClaim outputs for every sentence in a PDF.
 * Usage: node --import tsx scripts/score_sentences.ts <path-to-pdf>
 */
import fs from "node:fs";
import path from "node:path";
import { extractPdf } from "../server/src/pdf/extract.js";
import { extractNumericFacts, containsCausalLanguage, containsUniversalApplicability, isBroadGeneralization, isStatisticalClaim, isUniversalClaim, extractReferencedObjects } from "../server/src/audit/text.js";

const pdfPath = process.argv[2];
if (!pdfPath) { console.error("Usage: node --import tsx scripts/score_sentences.ts <pdf>"); process.exit(1); }

const buffer = fs.readFileSync(path.resolve(pdfPath));
const extracted = await extractPdf(buffer);

console.log(`Sentences: ${extracted.sentences.length}\n`);

let selected = 0;
for (const s of extracted.sentences) {
  const text = s.text;
  if (text.length < 25 || text.length > 700) continue;
  if (/^(figure|table|fig\.)\s+\d+\s*[.:]/i.test(text)) continue;
  if (/^(we|the authors)\s+(thank|acknowledge)/i.test(text)) continue;

  const facts = extractNumericFacts(text);
  const metricFacts = facts.filter(f => f.kind === "metric");
  const hasMetric = metricFacts.some(f => f.metricKey !== null);
  const hasQuant = metricFacts.length > 0;
  const hasPValue = facts.some(f => f.kind === "pvalue");
  const hasUnlabeledPercent = facts.some(f => f.unit === "percent" && f.kind === "metric");
  const referenced = extractReferencedObjects(text);

  const resultCue = /\b(achiev\w*|reach\w*|obtain\w*|report\w*|improv\w*|outperform\w*|surpass\w*|exceed\w*|yield\w*|gain\w*|reduc\w*|increase\w*|higher|lower|better|worse|decline\w*)\b/i.test(text);
  const comparative = /\b(outperform\w*|surpass\w*|better than|worse than|superior|inferior|higher than|lower than|more accurate|less accurate|faster|slower|compare[sd]? (?:with|to|against))\b/i.test(text);
  const statistical = isStatisticalClaim(text);
  const universal = isUniversalClaim(text);
  const broad = isBroadGeneralization(text);
  const oursText = /\b(our|we|this (?:paper|work|study)|the proposed)\b/i.test(text);
  const scopeCue = (universal || broad) && oursText;

  let score = 0;
  const gated = !hasQuant && !hasPValue && !statistical && !scopeCue && !comparative && referenced.length === 0 && !hasUnlabeledPercent;
  if (!gated) {
    if (hasMetric) score += 3;
    if (hasUnlabeledPercent && !hasMetric) score += 1.5;
    if (hasPValue) score += 2;
    if (resultCue && hasQuant) score += 1;
    if (resultCue && hasUnlabeledPercent && !hasQuant) score += 0.8;
    if (comparative) score += 2;
    if (statistical) score += 2.2;
    if (scopeCue) score += 2;
    // section weight
    const w: Record<string, number> = { abstract: 0.7, conclusion: 0.6, results: 0.5, discussion: 0.5, introduction: 0.3, methods: 0.2 };
    score += w[s.sectionCanonical] ?? 0.1;
  }

  if (score >= 2.5) { selected++; }
  if (score > 0 || hasUnlabeledPercent || hasQuant) {
    console.log(`score=${score.toFixed(2)} §${s.sectionTitle.slice(0,25)} p${s.page} | metric=${hasMetric} quant=${hasQuant} pct=${hasUnlabeledPercent} comparative=${comparative} statistical=${statistical} resultCue=${resultCue}`);
    console.log(`  "${text.slice(0,100)}"`);
    if (facts.length > 0) console.log(`  facts: ${facts.map(f=>f.raw+':'+f.unit).join(', ')}`);
  }
}
console.log(`\nTotal would-be claims (score >= 2.5): ${selected}`);
