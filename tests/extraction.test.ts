/**
 * PDF extraction and document-structure tests.
 *
 * These run the real pdfjs-backed extractor against generated fixtures. They
 * assert structural facts (sections, tables, warnings) rather than specific
 * audit classifications, which are covered in audit.test.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import PDFDocument from "pdfkit";
import { EVALUATION_CASES, buildCasePdf, type EvaluationCase } from "../evaluation/corpus.js";
import { extractPdf } from "../server/src/pdf/extract.js";
import { AuditError } from "../server/src/errors.js";

function fixture(id: string): EvaluationCase {
  const testCase = EVALUATION_CASES.find((candidate) => candidate.id === id);
  assert.ok(testCase, `Missing corpus fixture ${id}`);
  return testCase;
}

function blankPdf(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 64 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.addPage();
    doc.end();
  });
}

test("extracts page structure, headings, and a reliable table from a text PDF", async () => {
  const extracted = await extractPdf(await buildCasePdf(fixture("numeric-core")));

  assert.equal(extracted.pageCount, 2);
  assert.ok(extracted.charCount > 1000, `expected substantial text, got ${extracted.charCount} characters`);
  assert.ok(extracted.sections.length >= 5, `expected several sections, got ${extracted.sections.length}`);

  const titles = extracted.sections.map((section) => section.title.toLowerCase());
  for (const expected of ["abstract", "method", "results", "conclusion", "references"]) {
    assert.ok(titles.includes(expected), `expected section “${expected}” in ${titles.join(", ")}`);
  }

  assert.equal(extracted.tables.length, 1);
  const table = extracted.tables[0]!;
  assert.equal(table.reliable, true);
  assert.match(table.header.join(" "), /accuracy/i);
  assert.ok(table.rows.length >= 2, "expected at least two data rows");
  for (const row of table.rows) {
    assert.equal(row.length, table.header.length, "every row must align with the header");
  }
});

test("keeps a digit-free table header and a decimal-formatted score column", async () => {
  const extracted = await extractPdf(await buildCasePdf(fixture("model-variants")));
  const table = extracted.tables[0];

  assert.ok(table, "expected one extracted table");
  assert.equal(table.reliable, true);
  assert.deepEqual(table.header, ["Model", "BLEU", "Parameters"]);
  const baseRow = table.rows.find((row) => row[0] === "Aurora-Base");
  assert.ok(baseRow, "expected the Aurora-Base row");
  assert.equal(baseRow[1], "41.0");
});

test("marks a table with misaligned columns unreliable and warns about it", async () => {
  const extracted = await extractPdf(await buildCasePdf(fixture("unreliable-table")));
  const table = extracted.tables[0];

  assert.ok(table, "expected the malformed table to be detected");
  assert.equal(table.reliable, false);
  assert.match(table.reason ?? "", /inconsistent column counts/i);
  assert.ok(
    extracted.warnings.some((warning) => warning.includes("could not be reconstructed reliably")),
    `expected an unreliable-table warning, got: ${extracted.warnings.join(" | ")}`,
  );
  assert.ok(table.rows.some((row) => row.length !== table.header.length), "fixture must have a short row");
});

test("audits readable body text when no section headings exist", async () => {
  const extracted = await extractPdf(await buildCasePdf(fixture("headingless-paper")));

  assert.ok(extracted.charCount > 0);
  assert.ok(
    extracted.warnings.some((warning) => warning.includes("No standard paper sections were detected")),
    `expected a structure warning, got: ${extracted.warnings.join(" | ")}`,
  );
  const body = extracted.sections.find((section) => section.auditable);
  assert.ok(body, "expected an auditable body section");
  assert.equal(body.title, "Body (unstructured)");
});

test("rejects a damaged PDF with a traceable error instead of empty results", async () => {
  await assert.rejects(
    extractPdf(Buffer.from("%PDF-1.4\nthis is not actually a PDF document\n%%EOF")),
    (error: unknown) => {
      assert.ok(error instanceof AuditError);
      assert.equal(error.payload.code, "CORRUPT_PDF");
      return true;
    },
  );
});

test("reports an image-only PDF as having no extractable text", async () => {
  const extracted = await extractPdf(await blankPdf());
  assert.equal(extracted.pagesWithText, 0);
  assert.equal(extracted.charCount, 0);
});
