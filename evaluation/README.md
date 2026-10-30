# ClaimCheck evaluation and regression suite

This directory holds the deterministic evaluation corpus and its runner. Two layers of testing protect
the product:

- **`tests/`** — a committed `node:test` suite that exercises extraction, section detection, claim
  selection, evidence matching, numeric comparisons, context guards, classification, report generation,
  API validation, processing failures, persistence/retrieval, and quote/offset integrity.
- **`evaluation/`** — a hand-annotated synthetic corpus with explicit ground truth for every finding,
  scored for precision, recall, F1, and per-category accuracy.

Both layers run the **real** PDF extractor and **real** audit engine. Neither calls the HTTP API from
the corpus runner, nor a language model, nor an external service. The API suite starts the actual
server against a throwaway SQLite directory.

## Commands

```bash
npm ci                  # clean, lockfile-based install
npm test                # unit/API suite, then the annotated corpus
npm run test:unit       # node:test suite only (extraction, audit, reports, API)
npm run test:evaluation # annotated corpus only
npm run test:write      # corpus + write evaluation/results/latest.json
npm run test:publish    # corpus + publish a passing evaluation/summary.json
npm run build           # typecheck and production client build
```

The published summary is served by `GET /api/evaluation` and rendered at `/evaluation` in the
product. `test:publish` refuses to overwrite the published summary when the corpus has failures.
Generation timestamps are the only non-deterministic field in the report; classifications, traces,
and metrics are reproducible.

## Corpus

Thirteen fixtures, **52 annotated findings**, and explicit expected non-findings. Nine fixtures forbid
specific categories, and 11 individual expectations list a category that must not be assigned (for
example, a different dataset must not become a contradiction). The committed demo paper is locked in
as its own regression fixture. Every fixture is labeled synthetic in the generated PDF.

| Fixture | Requirement covered | What it exercises |
| --- | --- | --- |
| `numeric-core` | 1, 2, 11 | Abstract-versus-table conflict, supported table value, partial metric support, absent metric, missing table, significance gap, citation-only claim, all five categories. |
| `context-guards` | 4, 9 | Different dataset, validation-versus-test split, language pair, and ablation must not become contradictions; a same-context cross-section conflict still must. |
| `tables-and-references` | 1, 2, 8 | Reliable table reconstruction, rounding tolerance, text-versus-table conflict, missing figure reference. |
| `margin-vs-score` | 3, 9 | A percentage-point margin is excluded from absolute-score comparisons; the matching score claim is supported. |
| `task-guard` | 4 | IWSLT and WMT14 results, and English-to-French versus English-to-German, must not be compared as the same measurement. |
| `model-variants` | 5 | Model-scale variants on one benchmark must bind to the correct table row; a digit-free table header must still be parsed. |
| `scope-overgeneralization` | 6 | Universal conclusions beyond the single reported dataset and baseline set. |
| `missing-evidence` | 7 | A numeric claim with no matching value anywhere is unsupported, never a contradiction. |
| `malformed-references` | 8 | Missing Table 9, Figure 9, and Table 2B references; an existing Table 2A still passes traceability. |
| `unreliable-table` | 10 | Misaligned columns make a table unusable as evidence; no contradiction is manufactured from it. |
| `headingless-paper` | 11 | Readable body text without headings is audited as an unstructured section with a visible warning. |
| `sample-regression` | 12 | Locks the committed demo paper to its nine findings and known contradiction. |
| `quiet-paper` | 12 | A qualitative paper with no checkable claims must produce zero findings. |

## Scoring rules

For every expected finding:

- The claim must be selected.
- The classification must match exactly.
- Expected checks must have the expected outcome (`flagged`, `passed`, `inconclusive`).
- Expected numeric traces must name the right metric, claim value, evidence value, and evidence kind.
  Values are compared by magnitude, so `92%` and `92.0%` match; the assertion is about which number
  was traced, not how it was printed.
- Evidence quotations must exist in the extracted document.
- Claim offsets must map back to the extracted text.
- Markdown and JSON report generation must succeed and retain evidence quotations.
- Unexpected findings fail the run. If a finding is legitimate, add it to the fixture ground truth
  rather than widening the test.

Aggregate output includes claim-selection recall, exact category accuracy, strict finding precision
(a wrong category counts as a false positive), per-category true positives/false positives/false
negatives/precision/recall/F1, and evidence-trace failures. `evaluation/results/latest.json` contains
the machine-readable run and `evaluation/summary.json` is the published product summary.

The unit suite additionally asserts that text-based claims and evidence are anchored by character
offset, that document-level metadata evidence is not page-anchored, that JSON reports exclude the full
text, and that rejected uploads never create archive records.

## What the numbers mean

A 1.000 score here means the engine is consistent with the hand-authored expectations in this small,
synthetic corpus. It is **not** an estimate of precision or recall on real papers. The corpus is
intentionally designed around implemented checks and known negative controls; it cannot measure
semantic entailment, external citation validity, or performance on arbitrary PDF layouts.

Real-paper observations belong in a separate, independently annotated set and must be reported
separately. Do not merge those results with this regression score.

## Adding a fixture

1. Add a paper definition and `ExpectedFinding[]` to `corpus.ts`.
2. Include negative controls for any context distinction the engine is supposed to respect.
3. Run `npm test`.
4. Inspect failures rather than changing expectations to match accidental behavior. If behavior is
   genuinely correct, update the expectation and explain why in the fixture purpose.
5. If extraction behavior changes, add or adjust a focused test in `tests/extraction.test.ts`.
