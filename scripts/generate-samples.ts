/**
 * Generates the synthetic demo paper used to exercise the audit workflow.
 * It is deliberately not a real publication and contains seeded inconsistencies.
 */
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";

const outDir = path.join(process.cwd(), "samples");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "claimcheck-demo-paper.pdf");

const doc = new PDFDocument({
  size: "LETTER",
  margins: { top: 64, bottom: 64, left: 64, right: 64 },
  bufferPages: true,
  info: {
    Title: "Adaptive Retrieval for Low-Resource Clinical Text Classification",
    Author: "Synthetic demo document for ClaimCheck AI",
    Subject: "Deliberately seeded test paper — not a real publication",
    Creator: "ClaimCheck AI sample generator",
  },
});

const stream = fs.createWriteStream(outPath);
doc.pipe(stream);

const CONTENT_WIDTH = doc.page.width - 128;
const BODY_FONT = "Times-Roman";
const BODY_SIZE = 10;

function ensureSpace(height: number) {
  if (doc.y + height > doc.page.height - 78) doc.addPage();
}

function section(title: string) {
  ensureSpace(46);
  doc.moveDown(0.8);
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#15211c").text(title);
  doc.moveDown(0.35);
  doc.font(BODY_FONT).fontSize(BODY_SIZE).fillColor("#222c27");
}

function subheading(title: string) {
  ensureSpace(34);
  doc.moveDown(0.5);
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#23302a").text(title);
  doc.moveDown(0.2);
  doc.font(BODY_FONT).fontSize(BODY_SIZE).fillColor("#222c27");
}

function para(text: string) {
  ensureSpace(30);
  doc.font(BODY_FONT).fontSize(BODY_SIZE).fillColor("#222c27").text(text, {
    align: "justify",
    lineGap: 1.4,
  });
  doc.moveDown(0.45);
}

function drawTable(caption: string, header: string[], rows: string[][]) {
  ensureSpace(150);
  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#333f38").text(caption);
  doc.moveDown(0.25);

  const startX = 64 + 18;
  const colX = [startX, startX + 220, startX + 350];
  const colWidths = [210, 120, 100];
  let y = doc.y + 3;

  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#333f38");
  header.forEach((cell, index) => {
    doc.text(cell, colX[index], y, { width: colWidths[index], lineBreak: false });
  });

  doc
    .moveTo(startX, y + 13)
    .lineTo(startX + 440, y + 13)
    .lineWidth(0.6)
    .strokeColor("#9aa39d")
    .stroke();

  rows.forEach((row, rowIndex) => {
    const rowY = y + 21 + rowIndex * 16;
    doc.font("Times-Roman").fontSize(9.5).fillColor("#222c27");
    row.forEach((cell, index) => {
      doc.text(cell, colX[index], rowY, { width: colWidths[index], lineBreak: false });
    });
  });

  doc
    .moveTo(startX, y + 21 + rows.length * 16 - 4)
    .lineTo(startX + 440, y + 21 + rows.length * 16 - 4)
    .lineWidth(0.6)
    .strokeColor("#c3c9c5")
    .stroke();

  doc.y = y + 21 + rows.length * 16 + 10;
  doc.x = 64;
}

// ---------------------------------------------------------------------------
// Title block
// ---------------------------------------------------------------------------
doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#8a5a20");
doc.text("SYNTHETIC TEST DOCUMENT — NOT A REAL PUBLICATION", {
  characterSpacing: 0.8,
});
doc.moveDown(0.65);

doc
  .font("Helvetica-Bold")
  .fontSize(18)
  .fillColor("#15211c")
  .text("Adaptive Retrieval for Low-Resource Clinical Text Classification", {
    lineGap: 2,
  });

doc.moveDown(0.5);
doc.font("Helvetica").fontSize(9).fillColor("#4a554f");
doc.text("A. Demo, B. Sample, and C. Fixture");
doc.fontSize(8).fillColor("#6b756f");
doc.text("Department of Synthetic Informatics, Example University");
doc.text("Demo evaluation paper generated for ClaimCheck AI workflow testing.");

doc.moveDown(0.7);
doc
  .moveTo(64, doc.y)
  .lineTo(64 + CONTENT_WIDTH, doc.y)
  .lineWidth(0.8)
  .strokeColor("#d6d0c1")
  .stroke();
doc.moveDown(0.8);

// ---------------------------------------------------------------------------
// Abstract
// ---------------------------------------------------------------------------
section("Abstract");
para(
  "Label scarcity limits supervised clinical text classification. We introduce ARC, an adaptive retrieval classifier that pairs a sparse retriever with a lightweight task model. On the ClaimBench test set, ARC achieves 98.2% accuracy and a macro-F1 of 0.89. This is a statistically significant improvement over both baselines. Our results demonstrate that ARC generalizes across all clinical domains.",
);
doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#333f38").text("Keywords: ");
doc
  .font("Times-Roman")
  .fontSize(8.5)
  .fillColor("#333f38")
  .text("clinical NLP; retrieval augmentation; evaluation; reproducibility", { continued: false });
doc.moveDown(0.5);

// ---------------------------------------------------------------------------
// 1. Introduction
// ---------------------------------------------------------------------------
section("1. Introduction");
para(
  "Clinical notes are heterogeneous, sensitive, and expensive to annotate. Prior work has explored weak supervision and transfer learning, but label scarcity remains a practical barrier [3, 7]. Retrieval augmentation offers a way to ground predictions in similar labeled examples without additional annotation.",
);
para(
  "In this paper we ask whether a compact retrieval classifier can close the gap to larger supervised models under limited labels. We make three contributions: a sparse retrieval pipeline for clinical text, an adaptive weighting scheme for retrieved neighbors, and an evaluation on a held-out benchmark.",
);
para(
  "We show that retrieval augmentation improves accuracy substantially over the two baselines we evaluate, and we argue that the approach is a practical default for low-resource clinical settings.",
);

// ---------------------------------------------------------------------------
// 2. Related work
// ---------------------------------------------------------------------------
section("2. Related Work");
para(
  "Retrieval-augmented generation has been studied extensively in open-domain question answering [2, 5]. Clinical applications remain less explored, and reported gains are often sensitive to retrieval quality [4]. Our work differs by using retrieval only at inference time, without updating the underlying language model.",
);

// ---------------------------------------------------------------------------
// 3. Method
// ---------------------------------------------------------------------------
section("3. Method");
subheading("3.1 Data and splits");
para(
  "We use ClaimBench, a synthetic benchmark of 1,200 short clinical notes spanning four departments. The corpus is divided into 70% training, 15% validation, and 15% test partitions. No patient identifiers are included. Labels cover six note categories, and every example is short enough to fit within a single retrieval window.",
);

subheading("3.2 Adaptive retrieval classifier");
para(
  "ARC encodes each query with a sparse TF-IDF representation and retrieves the k = 12 nearest training examples. A logistic regression head combines the query features with neighbor labels. Retrieval weights are adjusted by validation accuracy, which we tune on the development split. The final model has fewer than two million parameters and runs on a single CPU core.",
);

subheading("3.3 Baselines and metrics");
para(
  "We compare ARC with Baseline A, a linear classifier trained only on the query, and Baseline B, a fine-tuned transformer. We report accuracy and macro-F1 on the ClaimBench test set. All methods receive the same training partition and use the published test split without modification.",
);

// ---------------------------------------------------------------------------
// 4. Results
// ---------------------------------------------------------------------------
section("4. Results");
para(
  "Table 2 reports accuracy and macro-F1 on the ClaimBench test set. ARC reaches 94.1% accuracy and 0.87 macro-F1, compared with 91.0% and 0.84 for Baseline A, and 89.4% and 0.82 for Baseline B. The absolute accuracy gain over the strongest baseline is 3.1 percentage points.",
);

drawTable(
  "Table 2. Accuracy and macro-F1 on the ClaimBench test set.",
  ["Method", "Accuracy", "Macro-F1"],
  [
    ["ARC (ours)", "94.1%", "0.87"],
    ["Baseline A", "91.0%", "0.84"],
    ["Baseline B", "89.4%", "0.82"],
  ],
);

para(
  "The retrieval component contributes most of the improvement: removing adaptive weighting reduces accuracy to 91.8%, while removing retrieval entirely reduces macro-F1 to 0.83. Across five repeated runs, ARC remained ahead of both baselines.",
);
para(
  "As shown in Table 4, inference latency remains below 20 ms per document on a single CPU core. This makes the method suitable for interactive review workflows. The reported latency includes retrieval and classification but excludes PDF rendering in the review interface.",
);

// ---------------------------------------------------------------------------
// 5. Discussion
// ---------------------------------------------------------------------------
section("5. Discussion");
para(
  "The gap between ARC and the linear baseline suggests that retrieved neighbors supply information that the query alone does not capture. The transformer baseline performs worse than ARC on this benchmark, which may reflect the limited training set rather than a general disadvantage.",
);
para(
  "Because the gains are consistent across runs, ARC should generalize across all clinical domains and label regimes. We therefore recommend it as a default for clinical text classification.",
);
para(
  "Our evaluation has clear limits: one benchmark, four departments, and a synthetic note distribution. These choices make the results easy to reproduce but restrict external validity. Prospective validation on real clinical corpora is needed before deployment.",
);

// ---------------------------------------------------------------------------
// 6. Conclusion
// ---------------------------------------------------------------------------
section("6. Conclusion");
para(
  "ARC outperforms all baselines on ClaimBench and establishes a new state of the art for low-resource clinical text classification. The method is simple to implement, requires no model fine-tuning, and can be deployed with modest compute.",
);
para(
  "Future work should evaluate ARC on real clinical corpora, with prospective validation and clinician review. Such studies are required before any clinical deployment.",
);

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------
section("References");
const references = [
  "[1] A. Demo and B. Sample. Sparse retrieval for small clinical corpora. Journal of Synthetic Methods, 2024.",
  "[2] C. Fixture et al. Retrieval-augmented generation in open domains. Proceedings of ExampleNLP, 2023.",
  "[3] D. Placeholder. Weak supervision for clinical text. Synthetic Medical Informatics, 2022.",
  "[4] E. Example. How retrieval quality affects downstream accuracy. Demo Workshop on NLP, 2024.",
  "[5] F. Synthetic. A survey of retrieval augmentation. Example Computing Surveys, 2023.",
  "[6] G. Fixture. Reproducibility checklists for small benchmarks. Journal of Demo Science, 2021.",
  "[7] H. Sample. Transfer learning under label scarcity. Example AI Letters, 2020.",
  "[8] I. Demo. Clinical text de-identification: a short review. Synthetic Health Data, 2019.",
];
doc.font("Times-Roman").fontSize(8.3).fillColor("#333f38");
for (const reference of references) {
  ensureSpace(18);
  doc.text(reference, { lineGap: 0.8 });
  doc.moveDown(0.18);
}

// ---------------------------------------------------------------------------
// Appendix
// ---------------------------------------------------------------------------
section("Appendix A. Reproducibility Checklist");
para(
  "Code: not released. Data: synthetic, generated for demonstration. Compute: one CPU core. Random seeds: fixed across runs. Hyperparameter search: validation accuracy over nine configurations. Ethics review: not applicable to synthetic records.",
);

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------
const range = doc.bufferedPageRange();
for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
  doc.switchToPage(pageIndex);
  const footer = `Synthetic demo document for ClaimCheck AI · not a real publication · page ${
    pageIndex + 1
  } of ${range.count}`;
  const bottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor("#8b938e")
    .text(footer, 64, doc.page.height - 44, {
      width: CONTENT_WIDTH,
      align: "center",
      lineBreak: false,
    });
  doc.page.margins.bottom = bottomMargin;
}

doc.end();

await new Promise<void>((resolve, reject) => {
  stream.on("finish", () => resolve());
  stream.on("error", reject);
});

console.log(`Wrote ${outPath}`);
