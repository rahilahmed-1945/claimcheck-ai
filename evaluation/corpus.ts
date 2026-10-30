/**
 * Synthetic evaluation corpus for the deterministic audit engine.
 *
 * These papers are generated locally and are not real publications. Every
 * fixture is deliberately labeled as synthetic. Ground truth lives beside the
 * paper definition so an engine change cannot silently redefine success.
 */
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";

export interface TableSpec {
  caption: string;
  header: string[];
  rows: string[][];
}

export interface SectionSpec {
  heading: string;
  paragraphs: string[];
  tables?: TableSpec[];
}

export interface PaperSpec {
  id: string;
  title: string;
  abstract: string[];
  sections: SectionSpec[];
  references?: string[];
  /** Emit a title and body paragraphs without any section headings. */
  headingless?: boolean;
}

export interface ExpectedFinding {
  /** A unique, normalized phrase from the claim sentence. */
  claimIncludes: string;
  category:
    | "supported"
    | "partially_supported"
    | "potentially_unsupported"
    | "potential_contradiction"
    | "needs_review";
  /** The finding must not be assigned any of these categories. */
  forbiddenCategories?: ExpectedFinding["category"][];
  /** At least one evidence quote must contain each phrase. */
  evidenceIncludes?: string[];
  /** Numeric trace assertions, matched by metric label. */
  numeric?: {
    metric: string;
    claimValue: string;
    evidenceValue: string;
    evidenceKind?: "sentence" | "table_row";
  }[];
  /** Required check ids, each with an expected outcome. */
  checks?: { id: string; outcome: "flagged" | "passed" | "inconclusive" | "not_applicable" }[];
  /** Phrases that must occur in the rationale. */
  rationaleIncludes?: string[];
}

export interface ExtractionExpectation {
  minPages: number;
  sectionTitles?: string[];
  minTables?: number;
  reliableTables?: number;
  unreliableTables?: number;
  warningsInclude?: string[];
  minWords?: number;
  maxWords?: number;
}

export interface EvaluationCase {
  id: string;
  title: string;
  purpose: string;
  /** A generated fixture, or an existing committed PDF when pdfPath is set. */
  paper?: PaperSpec;
  pdfPath?: string;
  extraction: ExtractionExpectation;
  expected: ExpectedFinding[];
  /** The complete audit must not contain these categories. */
  forbiddenCategories?: ExpectedFinding["category"][];
  /** Claims that must not be selected as findings at all. */
  forbiddenClaimIncludes?: string[];
}

export const CATEGORY_ORDER = [
  "potential_contradiction",
  "potentially_unsupported",
  "partially_supported",
  "needs_review",
  "supported",
] as const;

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function claimMatches(claimText: string, phrase: string): boolean {
  return normalize(claimText).includes(normalize(phrase));
}

const BODY_FONT = "Times-Roman";
const BODY_SIZE = 10;

function buildPaperPdf(paper: PaperSpec): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margins: { top: 64, bottom: 64, left: 64, right: 64 },
      bufferPages: true,
      info: {
        Title: paper.title,
        Author: "ClaimCheck AI synthetic evaluation corpus",
        Subject: "Synthetic evaluation fixture — not a real publication",
        Creator: "ClaimCheck AI evaluation corpus",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const contentWidth = doc.page.width - 128;

    const ensureSpace = (height: number) => {
      if (doc.y + height > doc.page.height - 78) doc.addPage();
    };

    const section = (title: string) => {
      ensureSpace(46);
      doc.moveDown(0.8);
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#15211c").text(title);
      doc.moveDown(0.35);
      doc.font(BODY_FONT).fontSize(BODY_SIZE).fillColor("#222c27");
    };

    const paragraph = (text: string) => {
      ensureSpace(30);
      doc.font(BODY_FONT).fontSize(BODY_SIZE).fillColor("#222c27").text(text, {
        align: "justify",
        lineGap: 1.4,
      });
      doc.moveDown(0.45);
    };

    const drawTable = (table: TableSpec) => {
      ensureSpace(160);
      doc.moveDown(0.4);
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#333f38").text(table.caption);
      doc.moveDown(0.25);

      const startX = 82;
      const colX = [startX, startX + 220, startX + 350];
      const colWidths = [210, 120, 100];
      const y = doc.y + 3;

      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#333f38");
      table.header.forEach((cell, index) => {
        doc.text(cell, colX[index] ?? startX, y, { width: colWidths[index] ?? 100, lineBreak: false });
      });

      doc
        .moveTo(startX, y + 13)
        .lineTo(startX + 440, y + 13)
        .lineWidth(0.6)
        .strokeColor("#9aa39d")
        .stroke();

      table.rows.forEach((row, rowIndex) => {
        const rowY = y + 21 + rowIndex * 16;
        doc.font("Times-Roman").fontSize(9.5).fillColor("#222c27");
        row.forEach((cell, index) => {
          doc.text(cell, colX[index] ?? startX, rowY, { width: colWidths[index] ?? 100, lineBreak: false });
        });
      });

      doc
        .moveTo(startX, y + 21 + table.rows.length * 16 - 4)
        .lineTo(startX + 440, y + 21 + table.rows.length * 16 - 4)
        .lineWidth(0.6)
        .strokeColor("#c3c9c5")
        .stroke();

      doc.y = y + 21 + table.rows.length * 16 + 10;
      doc.x = 64;
    };

    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#8a5a20");
    doc.text("SYNTHETIC EVALUATION FIXTURE — NOT A REAL PUBLICATION", { characterSpacing: 0.8 });
    doc.moveDown(0.65);

    doc.font("Helvetica-Bold").fontSize(18).fillColor("#15211c").text(paper.title, { lineGap: 2 });
    doc.moveDown(0.45);
    doc.font("Helvetica").fontSize(8.5).fillColor("#4a554f");
    doc.text("ClaimCheck AI Evaluation Corpus");
    doc.text("Generated fixture for deterministic audit regression testing.");
    doc.moveDown(0.7);
    doc
      .moveTo(64, doc.y)
      .lineTo(64 + contentWidth, doc.y)
      .lineWidth(0.8)
      .strokeColor("#d6d0c1")
      .stroke();
    doc.moveDown(0.8);

    if (paper.headingless) {
      paper.abstract.forEach(paragraph);
      for (const block of paper.sections) {
        block.paragraphs.forEach(paragraph);
        block.tables?.forEach(drawTable);
      }
    } else {
      section("Abstract");
      paper.abstract.forEach(paragraph);

      for (const block of paper.sections) {
        section(block.heading);
        block.paragraphs.forEach(paragraph);
        block.tables?.forEach(drawTable);
      }
    }

    if (paper.references?.length) {
      section("References");
      doc.font(BODY_FONT).fontSize(8.3).fillColor("#333f38");
      for (const reference of paper.references) {
        ensureSpace(18);
        doc.text(reference, { lineGap: 0.8 });
        doc.moveDown(0.18);
      }
    }

    doc.end();
  });
}

export function buildCasePdf(testCase: EvaluationCase): Promise<Buffer> {
  if (testCase.pdfPath) {
    return Promise.resolve(fs.readFileSync(path.join(process.cwd(), testCase.pdfPath)));
  }
  if (!testCase.paper) throw new Error(`Evaluation case ${testCase.id} has neither paper nor pdfPath.`);
  return buildPaperPdf(testCase.paper);
}

export const EVALUATION_CASES: EvaluationCase[] = [
  {
    id: "numeric-core",
    title: "Numeric consistency and support",
    purpose:
      "Checks repeated metrics, table support, partial support, absent metrics, a missing table, a statistical-significance gap, and a citation-only claim.",
    extraction: {
      minPages: 1,
      sectionTitles: ["Abstract", "Introduction", "Method", "Results", "Discussion", "Conclusion", "References"],
      minTables: 1,
      reliableTables: 1,
      minWords: 300,
    },
    paper: {
      id: "numeric-core",
      title: "Nimbus: A Controlled Numeric Audit Fixture",
      abstract: [
        "Nimbus is a compact classifier for clinical text. On the ClaimBench test set, Nimbus achieves 97.4% accuracy and 0.91 macro-F1. The improvement over the strongest baseline is statistically significant. Nimbus improves accuracy over Baseline A by 4.2 percentage points. Our results demonstrate that Nimbus generalizes across all clinical domains.",
      ],
      sections: [
        {
          heading: "1. Introduction",
          paragraphs: [
            "Clinical notes are heterogeneous and expensive to annotate. Prior work has explored weak supervision and transfer learning, but label scarcity remains a practical barrier [3].",
          ],
        },
        {
          heading: "2. Method",
          paragraphs: [
            "We use the ClaimBench corpus, divided into training, validation, and test partitions. Labels cover several note categories. All methods receive the same training partition.",
          ],
        },
        {
          heading: "3. Results",
          paragraphs: [
            "Nimbus reaches 94.1% accuracy and 0.87 macro-F1 on the ClaimBench test set.",
            "Nimbus reaches 94.1% accuracy and 0.93 AUC on the ClaimBench test set.",
            "Nimbus reaches 96.8% precision on the ClaimBench test set.",
            "On the CIFAR-10 test set, Nimbus reaches 88.5% accuracy.",
            "Table 5 reports the full ablation.",
            "On the ClaimBench test set, Nimbus is better than Baseline A and consistent with prior work [3].",
          ],
          tables: [
            {
              caption: "Table 2. Accuracy and macro-F1 on the ClaimBench test set.",
              header: ["Method", "Accuracy", "Macro-F1"],
              rows: [
                ["Nimbus (ours)", "94.1%", "0.87"],
                ["Baseline A", "91.0%", "0.84"],
                ["Baseline B", "89.4%", "0.82"],
              ],
            },
          ],
        },
        {
          heading: "4. Discussion",
          paragraphs: [
            "The remaining gap is consistent with the small training set and the limited label budget.",
          ],
        },
        {
          heading: "5. Conclusion",
          paragraphs: [
            "Nimbus is a practical classifier for this benchmark, and the reported results are easy to reproduce.",
          ],
        },
      ],
      references: [
        "[1] A. Demo. Retrieval for small clinical corpora. Journal of Synthetic Methods, 2024.",
        "[2] B. Sample. Weak supervision in clinical text. Example Medical Informatics, 2022.",
        "[3] C. Fixture et al. Transfer learning under label scarcity. Example AI Letters, 2021.",
      ],
    },
    expected: [
      {
        claimIncludes: "Nimbus achieves 97.4% accuracy and 0.91 macro-F1",
        category: "potential_contradiction",
        numeric: [
          { metric: "accuracy", claimValue: "97.4%", evidenceValue: "94.1%", evidenceKind: "table_row" },
          { metric: "F1", claimValue: "0.91", evidenceValue: "0.87", evidenceKind: "table_row" },
        ],
        checks: [{ id: "number_consistency", outcome: "flagged" }],
        evidenceIncludes: ["Nimbus (ours)", "94.1%"],
      },
      {
        claimIncludes: "improvement over the strongest baseline is statistically significant",
        category: "potentially_unsupported",
        checks: [{ id: "statistical_support", outcome: "flagged" }],
      },
      {
        claimIncludes: "generalizes across all clinical domains",
        category: "partially_supported",
        checks: [{ id: "scope_check", outcome: "inconclusive" }],
      },
      {
        claimIncludes: "Nimbus reaches 94.1% accuracy and 0.87 macro-F1",
        category: "supported",
        numeric: [
          { metric: "accuracy", claimValue: "94.1%", evidenceValue: "94.1%", evidenceKind: "table_row" },
          { metric: "F1", claimValue: "0.87", evidenceValue: "0.87", evidenceKind: "table_row" },
        ],
        checks: [{ id: "number_consistency", outcome: "passed" }],
      },
      {
        claimIncludes: "Nimbus reaches 94.1% accuracy and 0.93 AUC",
        category: "partially_supported",
        checks: [{ id: "number_consistency", outcome: "passed" }],
      },
      {
        claimIncludes: "Nimbus reaches 96.8% precision",
        category: "potentially_unsupported",
        checks: [{ id: "number_consistency", outcome: "inconclusive" }],
      },
      {
        claimIncludes: "On the CIFAR-10 test set, Nimbus reaches 88.5% accuracy",
        category: "potentially_unsupported",
        forbiddenCategories: ["potential_contradiction"],
      },
      {
        claimIncludes: "Table 5 reports the full ablation",
        category: "potentially_unsupported",
        checks: [{ id: "reference_traceability", outcome: "flagged" }],
      },
      {
        claimIncludes: "Nimbus is better than Baseline A and consistent with prior work",
        category: "needs_review",
        checks: [{ id: "citation_support", outcome: "inconclusive" }],
      },
    ],
    forbiddenClaimIncludes: ["improves accuracy over Baseline A by 4.2 percentage points"],
  },
  {
    id: "context-guards",
    title: "Experimental context guards",
    purpose:
      "Ensures different datasets, splits, language pairs, and ablation settings do not become false contradictions, while a same-context cross-section conflict still does.",
    extraction: {
      minPages: 1,
      sectionTitles: ["Abstract", "Method", "Results", "Discussion", "Conclusion"],
      minTables: 0,
      minWords: 190,
    },
    paper: {
      id: "context-guards",
      title: "Astra: Translation Context Guard Fixture",
      abstract: [
        "Astra is a translation model evaluated on standard benchmarks. Astra reports 28.4 BLEU on WMT14 English-to-German. It reports 41.8 BLEU on WMT14 English-to-French. On IWSLT English-to-German, Astra reports 30.1 BLEU.",
      ],
      sections: [
        {
          heading: "1. Method",
          paragraphs: [
            "We train Astra on the provided training partitions and decode with beam search. We evaluate translation quality with BLEU on the held-out test split.",
          ],
        },
        {
          heading: "2. Results",
          paragraphs: [
            "On WMT14 English-to-German, Astra reports 28.4 BLEU.",
            "On WMT14 English-to-French, Astra reports 41.8 BLEU.",
            "On WMT14 English-to-French, Astra reports 41.0 BLEU in the final rerun.",
            "On the validation split, Astra reports 32.5 BLEU for WMT14 English-to-German.",
            "On WMT14 English-to-German, removing reranking reduces BLEU to 26.1.",
            "On WMT14 English-to-German, Astra improves BLEU by 2.0 over the prior system.",
          ],
        },
        {
          heading: "3. Discussion",
          paragraphs: [
            "The reranking step accounts for part of the improvement, while the remaining variance is consistent with decoding noise.",
          ],
        },
        {
          heading: "4. Conclusion",
          paragraphs: [
            "Astra is a strong translation baseline, and the evaluation uses standard benchmark splits.",
          ],
        },
      ],
    },
    expected: [
      {
        claimIncludes: "Astra reports 28.4 BLEU on WMT14 English-to-German",
        category: "supported",
        numeric: [{ metric: "BLEU", claimValue: "28.4", evidenceValue: "28.4", evidenceKind: "sentence" }],
      },
      {
        claimIncludes: "It reports 41.8 BLEU on WMT14 English-to-French",
        category: "potential_contradiction",
        numeric: [{ metric: "BLEU", claimValue: "41.8", evidenceValue: "41.0", evidenceKind: "sentence" }],
      },
      {
        claimIncludes: "On WMT14 English-to-German, Astra reports 28.4 BLEU",
        category: "supported",
        numeric: [{ metric: "BLEU", claimValue: "28.4", evidenceValue: "28.4", evidenceKind: "sentence" }],
      },
      {
        claimIncludes: "On WMT14 English-to-French, Astra reports 41.8 BLEU",
        category: "supported",
        numeric: [{ metric: "BLEU", claimValue: "41.8", evidenceValue: "41.8", evidenceKind: "sentence" }],
      },
      {
        claimIncludes: "On IWSLT English-to-German, Astra reports 30.1 BLEU",
        category: "potentially_unsupported",
        forbiddenCategories: ["potential_contradiction"],
      },
      {
        claimIncludes: "On WMT14 English-to-French, Astra reports 41.0 BLEU",
        category: "potential_contradiction",
        numeric: [{ metric: "BLEU", claimValue: "41.0", evidenceValue: "41.8", evidenceKind: "sentence" }],
      },
      {
        claimIncludes: "On the validation split, Astra reports 32.5 BLEU",
        category: "potentially_unsupported",
        forbiddenCategories: ["potential_contradiction"],
      },
      {
        claimIncludes: "removing reranking reduces BLEU to 26.1",
        category: "needs_review",
        forbiddenCategories: ["potential_contradiction"],
      },
    ],
    forbiddenClaimIncludes: ["improves BLEU by 2.0 over the prior system"],
  },
  {
    id: "tables-and-references",
    title: "Table traceability and rounding",
    purpose:
      "Checks a reliable table, a legitimate rounding difference, a text-versus-table conflict, and a missing figure reference.",
    extraction: {
      minPages: 1,
      sectionTitles: ["Abstract", "Method", "Results", "Conclusion"],
      minTables: 1,
      reliableTables: 1,
      minWords: 140,
    },
    paper: {
      id: "tables-and-references",
      title: "Orion: Table Traceability Fixture",
      abstract: [
        "On ImageNet, Orion reaches 91.2% accuracy and 0.88 macro-F1.",
      ],
      sections: [
        {
          heading: "1. Method",
          paragraphs: [
            "We train Orion on ImageNet and evaluate it on a held-out test split. The same preprocessing is used for every method.",
          ],
        },
        {
          heading: "2. Results",
          paragraphs: [
            "On ImageNet, Orion reaches 91.20% accuracy and 0.88 macro-F1.",
            "On ImageNet, Orion reaches 89.7% accuracy.",
            "Figure 3 shows the learning curve for Orion.",
          ],
          tables: [
            {
              caption: "Table 2. Accuracy and macro-F1 on the ImageNet test split.",
              header: ["Method", "Accuracy", "Macro-F1"],
              rows: [
                ["Orion (ours)", "91.20%", "0.88"],
                ["Baseline A", "89.8%", "0.86"],
                ["Baseline B", "88.9%", "0.85"],
              ],
            },
          ],
        },
        {
          heading: "3. Conclusion",
          paragraphs: [
            "Orion is a strong baseline for image classification, and the reported table is easy to verify.",
          ],
        },
      ],
    },
    expected: [
      {
        claimIncludes: "On ImageNet, Orion reaches 91.2% accuracy",
        category: "supported",
        numeric: [
          { metric: "accuracy", claimValue: "91.2%", evidenceValue: "91.2%", evidenceKind: "table_row" },
          { metric: "F1", claimValue: "0.88", evidenceValue: "0.88", evidenceKind: "table_row" },
        ],
      },
      {
        claimIncludes: "On ImageNet, Orion reaches 91.20% accuracy and 0.88 macro-F1",
        category: "supported",
      },
      {
        claimIncludes: "On ImageNet, Orion reaches 89.7% accuracy",
        category: "potential_contradiction",
        numeric: [{ metric: "accuracy", claimValue: "89.7%", evidenceValue: "91.2%", evidenceKind: "table_row" }],
      },
      {
        claimIncludes: "Figure 3 shows the learning curve for Orion",
        category: "potentially_unsupported",
        checks: [{ id: "reference_traceability", outcome: "flagged" }],
      },
    ],
  },
  {
    id: "margin-vs-score",
    title: "Score improvement vs absolute score",
    purpose:
      "A three-point improvement margin must not be compared with the absolute accuracy values in a results table.",
    extraction: {
      minPages: 1,
      sectionTitles: ["Abstract", "Method", "Results", "Conclusion"],
      minTables: 1,
      reliableTables: 1,
      minWords: 120,
    },
    paper: {
      id: "margin-vs-score",
      title: "Nova: Margin Wording Fixture",
      abstract: [
        "Nova is a compact classifier. Nova reaches 90.2% accuracy on the ClaimBench test set. Nova improves accuracy over the strongest baseline by 3.1 percentage points.",
      ],
      sections: [
        {
          heading: "1. Method",
          paragraphs: [
            "We use the ClaimBench corpus and the published training and test partitions. All methods receive the same data.",
          ],
        },
        {
          heading: "2. Results",
          paragraphs: [
            "On ClaimBench, Nova reaches 90.2% accuracy.",
            "The absolute gain over Baseline A is 3.1 percentage points.",
          ],
          tables: [
            {
              caption: "Table 2. Accuracy and macro-F1 on the ClaimBench test set.",
              header: ["Method", "Accuracy", "Macro-F1"],
              rows: [
                ["Nova (ours)", "90.2%", "0.88"],
                ["Baseline A", "87.1%", "0.85"],
              ],
            },
          ],
        },
        {
          heading: "3. Conclusion",
          paragraphs: [
            "Nova is a practical classifier for this benchmark, and the margin is reported separately from the absolute score.",
          ],
        },
      ],
    },
    expected: [
      {
        claimIncludes: "Nova reaches 90.2% accuracy on the ClaimBench test set",
        category: "supported",
        numeric: [{ metric: "accuracy", claimValue: "90.2%", evidenceValue: "90.2%", evidenceKind: "table_row" }],
      },
      {
        claimIncludes: "On ClaimBench, Nova reaches 90.2% accuracy",
        category: "supported",
        numeric: [{ metric: "accuracy", claimValue: "90.2%", evidenceValue: "90.2%", evidenceKind: "table_row" }],
      },
    ],
    forbiddenCategories: ["potential_contradiction"],
    forbiddenClaimIncludes: ["improves accuracy over the strongest baseline by 3.1 percentage points"],
  },
  {
    id: "task-guard",
    title: "Different tasks and benchmarks",
    purpose:
      "BLEU values from WMT14, IWSLT, and different translation directions must not be compared as one measurement.",
    extraction: {
      minPages: 1,
      sectionTitles: ["Abstract", "Method", "Results"],
      minTables: 0,
      minWords: 100,
    },
    paper: {
      id: "task-guard",
      title: "Lumen: Task and Benchmark Guard Fixture",
      abstract: [
        "Lumen is a translation model. Lumen reports 30.2 BLEU on WMT14 English-to-German.",
      ],
      sections: [
        {
          heading: "1. Method",
          paragraphs: [
            "We evaluate translation on WMT14 and IWSLT. The test split is fixed across runs.",
          ],
        },
        {
          heading: "2. Results",
          paragraphs: [
            "On WMT14 English-to-German, Lumen reports 30.2 BLEU.",
            "On IWSLT English-to-German, Lumen reports 28.9 BLEU.",
            "On WMT14 English-to-French, Lumen reports 41.1 BLEU.",
          ],
        },
      ],
    },
    expected: [
      {
        claimIncludes: "Lumen reports 30.2 BLEU on WMT14 English-to-German",
        category: "supported",
        numeric: [{ metric: "BLEU", claimValue: "30.2", evidenceValue: "30.2", evidenceKind: "sentence" }],
      },
      {
        claimIncludes: "On WMT14 English-to-German, Lumen reports 30.2 BLEU",
        category: "supported",
        numeric: [{ metric: "BLEU", claimValue: "30.2", evidenceValue: "30.2", evidenceKind: "sentence" }],
      },
      {
        claimIncludes: "On IWSLT English-to-German, Lumen reports 28.9 BLEU",
        category: "potentially_unsupported",
        forbiddenCategories: ["potential_contradiction"],
      },
      {
        claimIncludes: "On WMT14 English-to-French, Lumen reports 41.1 BLEU",
        category: "potentially_unsupported",
        forbiddenCategories: ["potential_contradiction"],
      },
    ],
    forbiddenCategories: ["potential_contradiction"],
  },
  {
    id: "model-variants",
    title: "Different model scales",
    purpose:
      "Astra-Small and Astra-Base report different values on the same benchmark; the variant names, not the numbers alone, determine the table row.",
    extraction: {
      minPages: 1,
      sectionTitles: ["Abstract", "Results"],
      minTables: 1,
      reliableTables: 1,
      minWords: 100,
    },
    paper: {
      id: "model-variants",
      title: "Aurora: Model Variant Guard Fixture",
      abstract: [
        "Aurora-Small reports 36.2 BLEU on WMT14 English-to-German.",
      ],
      sections: [
        {
          heading: "1. Results",
          paragraphs: [
            "On WMT14 English-to-German, Aurora-Small reports 36.2 BLEU.",
            "Aurora-Base reports 41.0 BLEU on the same test set.",
          ],
          tables: [
            {
              caption: "Table 2. BLEU by model scale on WMT14 English-to-German.",
              header: ["Model", "BLEU", "Parameters"],
              rows: [
                ["Aurora-Small", "36.2", "65M"],
                ["Aurora-Base", "41.0", "213M"],
                ["Baseline A", "33.8", "—"],
              ],
            },
          ],
        },
      ],
    },
    expected: [
      {
        claimIncludes: "Aurora-Small reports 36.2 BLEU on WMT14 English-to-German",
        category: "supported",
        numeric: [{ metric: "BLEU", claimValue: "36.2", evidenceValue: "36.2", evidenceKind: "table_row" }],
      },
      {
        claimIncludes: "On WMT14 English-to-German, Aurora-Small reports 36.2 BLEU",
        category: "supported",
        numeric: [{ metric: "BLEU", claimValue: "36.2", evidenceValue: "36.2", evidenceKind: "table_row" }],
      },
      {
        claimIncludes: "Aurora-Base reports 41.0 BLEU",
        category: "supported",
        numeric: [{ metric: "BLEU", claimValue: "41.0", evidenceValue: "41.0", evidenceKind: "table_row" }],
      },
    ],
    forbiddenCategories: ["potential_contradiction"],
  },
  {
    id: "scope-overgeneralization",
    title: "Overgeneralized conclusion",
    purpose:
      "A conclusion that generalizes across all domains or baselines must be classified as broader than the single reported experiment.",
    extraction: {
      minPages: 1,
      sectionTitles: ["Abstract", "Method", "Results", "Conclusion"],
      minTables: 1,
      reliableTables: 1,
      minWords: 110,
    },
    paper: {
      id: "scope-overgeneralization",
      title: "Sable: Scope Fixture",
      abstract: [
        "Sable reaches 92.1% accuracy on the ClaimBench test set.",
      ],
      sections: [
        {
          heading: "1. Method",
          paragraphs: [
            "We evaluate only on ClaimBench, using records from two hospital departments.",
          ],
        },
        {
          heading: "2. Results",
          paragraphs: ["On ClaimBench, Sable reaches 92.1% accuracy."],
          tables: [
            {
              caption: "Table 2. Accuracy on the ClaimBench test set.",
              header: ["Method", "Accuracy", "Macro-F1"],
              rows: [
                ["Sable (ours)", "92.1%", "0.88"],
                ["Baseline A", "89.0%", "0.85"],
              ],
            },
          ],
        },
        {
          heading: "3. Conclusion",
          paragraphs: [
            "Our results show that Sable generalizes across all clinical domains and label regimes.",
            "Sable outperforms all baselines on ClaimBench.",
          ],
        },
      ],
    },
    expected: [
      {
        claimIncludes: "Sable reaches 92.1% accuracy on the ClaimBench test set",
        category: "supported",
        numeric: [{ metric: "accuracy", claimValue: "92.1%", evidenceValue: "92.1%", evidenceKind: "table_row" }],
      },
      {
        claimIncludes: "On ClaimBench, Sable reaches 92.1% accuracy",
        category: "supported",
        numeric: [{ metric: "accuracy", claimValue: "92.1%", evidenceValue: "92.1%", evidenceKind: "table_row" }],
      },
      {
        claimIncludes: "Sable generalizes across all clinical domains",
        category: "potentially_unsupported",
        checks: [{ id: "scope_check", outcome: "flagged" }],
      },
      {
        claimIncludes: "Sable outperforms all baselines on ClaimBench",
        category: "potentially_unsupported",
        checks: [{ id: "scope_check", outcome: "flagged" }],
      },
    ],
    forbiddenCategories: ["potential_contradiction"],
  },
  {
    id: "missing-evidence",
    title: "No identifiable supporting evidence",
    purpose:
      "A numeric claim with no matching value anywhere in the accessible document is unsupported, not a contradiction.",
    extraction: {
      minPages: 1,
      sectionTitles: ["Abstract", "Method", "Results"],
      minTables: 0,
      minWords: 80,
    },
    paper: {
      id: "missing-evidence",
      title: "Vela: Missing Evidence Fixture",
      abstract: ["Vela reaches 97.2% accuracy on CIFAR-10."],
      sections: [
        {
          heading: "1. Method",
          paragraphs: ["We train Vela on the CIFAR-10 training partition."],
        },
        {
          heading: "2. Results",
          paragraphs: ["Vela reaches 95.8% accuracy on MNIST."],
        },
        {
          heading: "3. Conclusion",
          paragraphs: ["Vela is a practical classifier for small image datasets."],
        },
      ],
    },
    expected: [
      {
        claimIncludes: "Vela reaches 97.2% accuracy on CIFAR-10",
        category: "potentially_unsupported",
        checks: [{ id: "number_consistency", outcome: "inconclusive" }],
        forbiddenCategories: ["potential_contradiction"],
      },
      {
        claimIncludes: "Vela reaches 95.8% accuracy on MNIST",
        category: "potentially_unsupported",
        forbiddenCategories: ["potential_contradiction"],
      },
    ],
    forbiddenCategories: ["potential_contradiction"],
  },
  {
    id: "malformed-references",
    title: "Missing and malformed references",
    purpose:
      "References to Table 9, Figure 9, and Table 2B are traceable and missing; Table 2A exists.",
    extraction: {
      minPages: 1,
      sectionTitles: ["Abstract", "Results"],
      minTables: 1,
      reliableTables: 1,
      minWords: 85,
    },
    paper: {
      id: "malformed-references",
      title: "Reference Traceability Fixture",
      abstract: ["The primary results are summarized in Table 9."],
      sections: [
        {
          heading: "1. Results",
          paragraphs: [
            "Figure 9 shows the training curve.",
            "Table 2B reports the secondary analysis.",
          ],
          tables: [
            {
              caption: "Table 2A. Primary accuracy results.",
              header: ["Method", "Accuracy", "Macro-F1"],
              rows: [
                ["Vela (ours)", "91.0%", "0.88"],
                ["Baseline A", "88.0%", "0.84"],
              ],
            },
          ],
        },
      ],
    },
    expected: [
      {
        claimIncludes: "The primary results are summarized in Table 9",
        category: "potentially_unsupported",
        checks: [{ id: "reference_traceability", outcome: "flagged" }],
      },
      {
        claimIncludes: "Figure 9 shows the training curve",
        category: "potentially_unsupported",
        checks: [{ id: "reference_traceability", outcome: "flagged" }],
      },
      {
        claimIncludes: "Table 2B reports the secondary analysis",
        category: "potentially_unsupported",
        checks: [{ id: "reference_traceability", outcome: "flagged" }],
      },
    ],
    forbiddenCategories: ["potential_contradiction"],
  },
  {
    id: "unreliable-table",
    title: "Unreliable table extraction",
    purpose:
      "A row with an inconsistent column count makes the table unreliable; a claim that only exists in that table must not become a contradiction.",
    extraction: {
      minPages: 1,
      sectionTitles: ["Abstract", "Results"],
      minTables: 1,
      reliableTables: 0,
      unreliableTables: 1,
      warningsInclude: ["could not be reconstructed reliably"],
      minWords: 85,
    },
    paper: {
      id: "unreliable-table",
      title: "Kite: Table Reliability Fixture",
      abstract: ["Kite reaches 92.0% accuracy on the ClaimBench test set."],
      sections: [
        {
          heading: "1. Results",
          paragraphs: [
            "On ClaimBench, Kite reaches 92.0% accuracy.",
            "On ClaimBench, Kite reaches 0.95 AUC.",
          ],
          tables: [
            {
              caption: "Table 2. Accuracy and AUC on the ClaimBench test set.",
              header: ["Method", "Accuracy", "AUC"],
              rows: [
                ["Kite (ours)", "92.0%", "0.93"],
                ["Baseline A", "88.0%"],
              ],
            },
          ],
        },
      ],
    },
    expected: [
      {
        claimIncludes: "Kite reaches 92.0% accuracy on the ClaimBench test set",
        category: "supported",
        numeric: [{ metric: "accuracy", claimValue: "92.0%", evidenceValue: "92.0%", evidenceKind: "sentence" }],
      },
      {
        claimIncludes: "On ClaimBench, Kite reaches 92.0% accuracy",
        category: "supported",
        numeric: [{ metric: "accuracy", claimValue: "92.0%", evidenceValue: "92.0%", evidenceKind: "sentence" }],
      },
      {
        claimIncludes: "On ClaimBench, Kite reaches 0.95 AUC",
        category: "potentially_unsupported",
        checks: [{ id: "number_consistency", outcome: "inconclusive" }],
        forbiddenCategories: ["potential_contradiction"],
      },
    ],
    forbiddenCategories: ["potential_contradiction"],
  },
  {
    id: "headingless-paper",
    title: "Readable text without section headings",
    purpose:
      "A text-based paper with no recognised headings is audited as an unstructured body and surfaces an extraction warning instead of failing silently.",
    extraction: {
      minPages: 1,
      sectionTitles: ["Body (unstructured)"],
      minTables: 0,
      warningsInclude: ["No standard paper sections were detected"],
      minWords: 70,
    },
    paper: {
      id: "headingless-paper",
      title: "Unstructured Evaluation Note",
      headingless: true,
      abstract: [
        "This note reports an internal evaluation of a small classifier. On ClaimBench, the model reaches 91.5% accuracy. The result is preliminary and has not been externally validated. We report it to document an early experiment rather than to establish a general conclusion.",
      ],
      sections: [
        {
          heading: "Internal notes",
          paragraphs: [
            "The evaluation uses a held-out test split. No external benchmark was used. The classifier was trained on the provided training partition and evaluated once. These choices make the result easy to reproduce but restrict its scope.",
          ],
        },
      ],
    },
    expected: [
      {
        claimIncludes: "On ClaimBench, the model reaches 91.5% accuracy",
        category: "potentially_unsupported",
        checks: [{ id: "number_consistency", outcome: "inconclusive" }],
        forbiddenCategories: ["potential_contradiction"],
      },
    ],
    forbiddenCategories: ["potential_contradiction"],
  },
  {
    id: "sample-regression",
    title: "Committed demo-paper regression",
    purpose:
      "Locks the committed synthetic demo paper to its known findings so changes to selection, tables, or report generation cannot silently alter the product demo.",
    pdfPath: "samples/claimcheck-demo-paper.pdf",
    extraction: {
      minPages: 3,
      sectionTitles: ["Abstract", "Introduction", "Results", "Discussion", "Conclusion", "References"],
      minTables: 1,
      reliableTables: 1,
      minWords: 900,
      maxWords: 1000,
    },
    expected: [
      {
        claimIncludes: "ARC achieves 98.2% accuracy and a macro-F1 of 0.89",
        category: "potential_contradiction",
        numeric: [
          { metric: "accuracy", claimValue: "98.2%", evidenceValue: "94.1%", evidenceKind: "table_row" },
          { metric: "F1", claimValue: "0.89", evidenceValue: "0.87", evidenceKind: "table_row" },
        ],
        evidenceIncludes: ["ARC (ours)"],
      },
      {
        claimIncludes: "This is a statistically significant improvement",
        category: "potentially_unsupported",
        checks: [{ id: "statistical_support", outcome: "flagged" }],
      },
      {
        claimIncludes: "Our results demonstrate that ARC generalizes across all clinical domains",
        category: "potentially_unsupported",
        checks: [{ id: "scope_check", outcome: "flagged" }],
      },
      {
        claimIncludes: "As shown in Table 4",
        category: "potentially_unsupported",
        checks: [{ id: "reference_traceability", outcome: "flagged" }],
      },
      {
        claimIncludes: "Because the gains are consistent across runs",
        category: "potentially_unsupported",
        checks: [{ id: "scope_check", outcome: "flagged" }],
      },
      {
        claimIncludes: "ARC outperforms all baselines on ClaimBench",
        category: "partially_supported",
        checks: [{ id: "scope_check", outcome: "inconclusive" }],
      },
      {
        claimIncludes: "removing adaptive weighting reduces accuracy to 91.8",
        category: "needs_review",
        forbiddenCategories: ["potential_contradiction"],
      },
      {
        claimIncludes: "The transformer baseline performs worse than ARC",
        category: "needs_review",
      },
      {
        claimIncludes: "ARC reaches 94.1% accuracy and 0.87 macro-F1",
        category: "supported",
        numeric: [
          { metric: "accuracy", claimValue: "94.1%", evidenceValue: "94.1%", evidenceKind: "table_row" },
          { metric: "F1", claimValue: "0.87", evidenceValue: "0.87", evidenceKind: "table_row" },
        ],
      },
    ],
  },
  {
    id: "quiet-paper",
    title: "Quiet paper precision control",
    purpose:
      "A short qualitative paper with no checkable numeric or universal statements must produce no findings.",
    extraction: {
      minPages: 1,
      sectionTitles: ["Abstract", "Introduction", "Method", "Discussion", "Conclusion"],
      minTables: 0,
      minWords: 170,
    },
    paper: {
      id: "quiet-paper",
      title: "Documentation Practices in Research Software: A Qualitative Fixture",
      abstract: [
        "This paper reviews documentation practices in research software. We discuss themes from interviews with practitioners and propose a checklist for project maintainers. The study is exploratory and does not evaluate a predictive model.",
      ],
      sections: [
        {
          heading: "1. Introduction",
          paragraphs: [
            "Documentation is important for reuse, but it is often treated as secondary work. Practitioners describe competing priorities and limited time for maintenance.",
            "Recent work has achieved significant improvements in computational efficiency through sparse attention. The best performing systems often combine retrieval with a compact classifier.",
          ],
        },
        {
          heading: "2. Method",
          paragraphs: [
            "We conducted interviews with practitioners from several research groups. The interviews were transcribed and reviewed thematically. No quantitative benchmark was used.",
          ],
        },
        {
          heading: "3. Discussion",
          paragraphs: [
            "Participants described documentation as a social and organizational challenge rather than a purely technical one. The proposed checklist is intended to support reflection rather than prescribe a single process.",
          ],
        },
        {
          heading: "4. Conclusion",
          paragraphs: [
            "Documentation remains an area for improvement in research software, and further qualitative work would help characterize maintenance practices.",
          ],
        },
      ],
    },
    expected: [],
    forbiddenCategories: [
      "potential_contradiction",
      "potentially_unsupported",
      "partially_supported",
      "needs_review",
      "supported",
    ],
  },
];
