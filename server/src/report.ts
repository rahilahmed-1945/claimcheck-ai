import type { AuditRecord, FindingCategory } from "../../shared/types.js";
import { ENGINE_VERSION } from "../../shared/types.js";

const CATEGORY_LABELS: Record<FindingCategory, string> = {
  supported: "Supported",
  partially_supported: "Partially supported",
  potentially_unsupported: "Potentially unsupported",
  potential_contradiction: "Potential contradiction",
  needs_review: "Needs review",
};

const CATEGORY_ORDER: FindingCategory[] = [
  "potential_contradiction",
  "potentially_unsupported",
  "partially_supported",
  "needs_review",
  "supported",
];

const CATEGORY_DEFINITIONS: Record<FindingCategory, string> = {
  supported:
    "The available evidence appears to support the claim. This is not proof that the claim is universally true.",
  partially_supported:
    "Some aspects of the claim are supported, but other aspects are not adequately established by the available evidence.",
  potentially_unsupported:
    "The system could not locate sufficient supporting evidence in the accessible document. This does not prove the claim is false.",
  potential_contradiction:
    "The extracted evidence appears inconsistent with the claim. The exact evidence is quoted below.",
  needs_review:
    "The claim or available evidence is too ambiguous, incomplete, or unreliable for a confident classification.",
};

function slugify(value: string): string {
  return value
    .replace(/\.pdf$/i, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .toLowerCase() || "paper";
}

export function reportFilename(record: AuditRecord, extension: "md" | "json"): string {
  const date = record.createdAt.slice(0, 10);
  return `claimcheck-${slugify(record.filename)}-${date}.${extension}`;
}

export function buildMarkdownReport(record: AuditRecord): string {
  if (!record.document || !record.summary) {
    throw new Error("Audit is not complete");
  }
  const lines: string[] = [];
  const summary = record.summary;
  const extraction = record.extraction;

  lines.push(`# ClaimCheck AI audit report`);
  lines.push("");
  lines.push(`**Document:** ${record.filename}  `);
  lines.push(`**Audit ID:** ${record.id}  `);
  lines.push(`**Created:** ${record.createdAt}  `);
  lines.push(`**Engine:** ${ENGINE_VERSION} (deterministic, no external AI service)  `);
  lines.push(`**Pages:** ${extraction?.pageCount ?? "—"} · **Words extracted:** ${extraction?.wordCount.toLocaleString() ?? "—"}  `);
  lines.push(`**Claims audited:** ${summary.claimsAudited} · **Evidence links:** ${summary.evidenceLinks}  `);
  lines.push(`**Tables detected:** ${summary.tablesDetected} · **Reliably reconstructed:** ${summary.tablesParsedReliably}`);
  lines.push("");
  lines.push("## What this report is");
  lines.push("");
  lines.push(
    "This report identifies relationships between statements in one paper and evidence extracted from the same PDF. " +
      "It is a revision aid, not a verdict on research validity, integrity, or author intent. " +
      "Every quotation below is drawn from the extracted document text; nothing is generated or externally retrieved.",
  );
  lines.push("");
  lines.push("## Classification summary");
  lines.push("");
  lines.push("| Classification | Findings |");
  lines.push("| --- | ---: |");
  for (const category of CATEGORY_ORDER) {
    lines.push(`| ${CATEGORY_LABELS[category]} | ${summary.byCategory[category]} |`);
  }
  lines.push("");
  for (const category of CATEGORY_ORDER) {
    lines.push(`**${CATEGORY_LABELS[category]}.** ${CATEGORY_DEFINITIONS[category]}`);
    lines.push("");
  }

  if (extraction?.warnings.length) {
    lines.push("## Extraction warnings");
    lines.push("");
    for (const warning of extraction.warnings) lines.push(`- ${warning}`);
    lines.push("");
  }

  lines.push("## Findings");
  lines.push("");
  if (record.findings.length === 0) {
    lines.push("No auditable claims were identified by the phase-one claim selector in this document.");
    lines.push("");
  }

  record.findings.forEach((finding, index) => {
    lines.push(`### ${index + 1}. ${finding.title}`);
    lines.push("");
    lines.push(`**Classification:** ${CATEGORY_LABELS[finding.category]} · **Confidence:** ${finding.confidence}`);
    lines.push("");
    lines.push(`**Claim** (${finding.claim.sectionTitle}, page ${finding.claim.page}):`);
    lines.push("");
    lines.push(`> ${finding.claim.text}`);
    lines.push("");
    lines.push(`**Why this classification:** ${finding.rationale}`);
    lines.push("");
    if (finding.numericComparisons.length > 0) {
      lines.push("**Numeric comparison**");
      lines.push("");
      lines.push("| Metric | Claim value | Evidence value | Difference | Claim page | Evidence page |");
      lines.push("| --- | --- | --- | --- | ---: | ---: |");
      for (const comparison of finding.numericComparisons) {
        lines.push(
          `| ${comparison.metric} | ${comparison.claimValue} | ${comparison.evidenceValue} | ${comparison.delta} | ${comparison.claimPage} | ${comparison.evidencePage} |`,
        );
      }
      lines.push("");
    }
    lines.push("**Checks run**");
    lines.push("");
    for (const check of finding.checks) {
      lines.push(`- ${check.label} — *${check.outcome}*: ${check.detail}`);
    }
    lines.push("");
    lines.push("**Evidence located**");
    lines.push("");
    if (finding.evidence.length === 0) {
      lines.push("_No qualifying evidence was located. This is not evidence that the claim is false._");
    } else {
      for (const evidence of finding.evidence) {
        const location =
          evidence.kind === "metadata"
            ? "Document structure"
            : `${evidence.sectionTitle}, page ${evidence.page}`;
        lines.push(`- **${location}** — ${evidence.relation}`);
        lines.push("");
        lines.push(`  > ${evidence.quote}`);
        if (evidence.note) {
          lines.push("");
          lines.push(`  ${evidence.note}`);
        }
        lines.push("");
      }
    }
    lines.push(`**Search scope:** ${finding.searchScope.sentencesChecked} extracted sentences and ${finding.searchScope.tableRowsChecked} table rows checked.`);
    lines.push("");
    lines.push("**Interpretation limits**");
    lines.push("");
    for (const limitation of finding.limitations) lines.push(`- ${limitation}`);
    lines.push("");
  });

  lines.push("## Audit limitations");
  lines.push("");
  for (const limitation of record.limitations) lines.push(`- ${limitation}`);
  lines.push("");
  lines.push("## Extracted structure");
  lines.push("");
  if (record.document.sections.length > 0) {
    lines.push("| Section | Pages | Words | Audited |");
    lines.push("| --- | --- | ---: | --- |");
    for (const section of record.document.sections) {
      lines.push(
        `| ${section.title.replace(/\|/g, "\\|")} | ${section.pageStart}–${section.pageEnd} | ${section.wordCount} | ${section.auditable ? "yes" : "no"} |`,
      );
    }
  } else {
    lines.push("_No sections detected._");
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(
    `Generated by ClaimCheck AI ${ENGINE_VERSION}. Deterministic audit engine; no language model was used. ` +
      "The classifications must be interpreted with the quoted evidence and the limitations above.",
  );
  lines.push("");
  return lines.join("\n");
}

export function buildJsonReport(record: AuditRecord): string {
  if (!record.document) throw new Error("Audit is not complete");
  return JSON.stringify(
    {
      product: "ClaimCheck AI",
      reportFormatVersion: 1,
      engineVersion: ENGINE_VERSION,
      generatedAt: new Date().toISOString(),
      document: {
        filename: record.filename,
        fileSize: record.fileSize,
        sha256: record.fileHash,
        pageCount: record.extraction?.pageCount ?? null,
        wordCount: record.extraction?.wordCount ?? null,
        createdAt: record.createdAt,
      },
      extraction: record.extraction,
      audit: {
        summary: record.summary,
        findings: record.findings,
        limitations: record.limitations,
        timings: record.timings,
      },
      documentTextIncluded: false,
      note:
        "This JSON report contains traceable evidence quotations and page locations. Full extracted text is viewable in the application. Classifications are evidence relationships, not verdicts.",
    },
    null,
    2,
  );
}
