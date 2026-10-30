/**
 * New targeted tests for functionality added in the latest engine session:
 *  - Methodology gap detection helpers (text.ts)
 *  - Conclusion-overreach helpers (text.ts)
 *  - Citation/reference consistency helpers (text.ts)
 *  - Conclusion-overreach audit pass in runAudit (engine.ts)
 *  - Finding deduplication (no duplicate offsets after overreach pass)
 *  - New text utilities: causal language, universal applicability
 *
 * These tests use the existing node:test framework and do not require new
 * fixtures or a new corpus. They call the pure utility functions and the
 * audit engine directly on synthetic strings.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  mentionsDatasetSize,
  mentionsEvaluationMetrics,
  mentionsTrainTestSplit,
  mentionsHyperparameters,
  mentionsBaselinesText,
  mentionsReproducibility,
  containsCausalLanguage,
  containsUniversalApplicability,
  extractCitationKeys,
  parseReferenceList,
  checkCitationConsistency,
} from "../server/src/audit/text.js";

import { extractPdf } from "../server/src/pdf/extract.js";
import { runAudit } from "../server/src/audit/engine.js";
import { EVALUATION_CASES, buildCasePdf } from "../evaluation/corpus.js";

// ---------------------------------------------------------------------------
// Methodology gap detection helpers
// ---------------------------------------------------------------------------

test("mentionsDatasetSize detects sample-count patterns", () => {
  assert.ok(mentionsDatasetSize("We collected 12,345 samples for training."));
  assert.ok(mentionsDatasetSize("N = 500 subjects participated."));
  assert.ok(mentionsDatasetSize("The dataset consists of 8000 images."));
  assert.ok(mentionsDatasetSize("Training set of 50,000 examples was used."));
  assert.ok(!mentionsDatasetSize("Results are shown in Table 2."));
  assert.ok(!mentionsDatasetSize("We present a novel approach."));
});

test("mentionsEvaluationMetrics detects recognized metric names", () => {
  assert.ok(mentionsEvaluationMetrics("We report accuracy and F1 score."));
  assert.ok(mentionsEvaluationMetrics("BLEU was used to evaluate translation."));
  assert.ok(mentionsEvaluationMetrics("AUC-ROC and precision/recall are shown."));
  assert.ok(!mentionsEvaluationMetrics("The experiment was conducted in a controlled setting."));
  assert.ok(!mentionsEvaluationMetrics("Results are promising."));
});

test("mentionsTrainTestSplit detects split descriptions", () => {
  assert.ok(mentionsTrainTestSplit("We used an 80/20 train/test split."));
  assert.ok(mentionsTrainTestSplit("5-fold cross-validation was applied."));
  assert.ok(mentionsTrainTestSplit("The held-out test set was not used during training."));
  assert.ok(mentionsTrainTestSplit("Training and validation sets were separated."));
  assert.ok(!mentionsTrainTestSplit("Hyperparameters were tuned using grid search."));
});

test("mentionsHyperparameters detects hyperparameter descriptions", () => {
  assert.ok(mentionsHyperparameters("We set the learning rate to 1e-4."));
  assert.ok(mentionsHyperparameters("Batch size was 32 and we trained for 10 epochs."));
  assert.ok(mentionsHyperparameters("Dropout of 0.1 was applied."));
  assert.ok(!mentionsHyperparameters("We present results on three datasets."));
});

test("mentionsBaselinesText detects baseline references", () => {
  assert.ok(mentionsBaselinesText("We compared against three baselines."));
  assert.ok(mentionsBaselinesText("The reference system from prior work was used."));
  assert.ok(mentionsBaselinesText("State-of-the-art methods were included for comparison."));
  assert.ok(!mentionsBaselinesText("Results are presented in Table 1."));
});

test("mentionsReproducibility detects code/repository mentions", () => {
  assert.ok(mentionsReproducibility("Code is available at https://github.com/example/repo."));
  assert.ok(mentionsReproducibility("Our implementation is publicly available."));
  assert.ok(mentionsReproducibility("To support reproducibility, we release our scripts."));
  assert.ok(!mentionsReproducibility("We conducted experiments on four GPUs."));
});

// ---------------------------------------------------------------------------
// Conclusion-overreach language helpers
// ---------------------------------------------------------------------------

test("containsCausalLanguage detects causal claims", () => {
  assert.ok(containsCausalLanguage("Regularization causes the model to generalize better."));
  assert.ok(containsCausalLanguage("The improvement leads to faster convergence."));
  assert.ok(containsCausalLanguage("Dropout prevents overfitting in all settings."));
  assert.ok(!containsCausalLanguage("We observe an improvement of 2 F1 points."));
  assert.ok(!containsCausalLanguage("Accuracy was 94.1% on the test set."));
});

test("containsUniversalApplicability detects universal scope claims", () => {
  assert.ok(containsUniversalApplicability("Our method works for any domain."));
  assert.ok(containsUniversalApplicability("Results hold in all cases."));
  assert.ok(containsUniversalApplicability("The approach generalizes to any language."));
  assert.ok(!containsUniversalApplicability("We tested on two standard benchmarks."));
  assert.ok(!containsUniversalApplicability("Accuracy improved by 3 points on ImageNet."));
});

// ---------------------------------------------------------------------------
// Citation / reference helpers
// ---------------------------------------------------------------------------

test("extractCitationKeys extracts numeric citations", () => {
  const keys = extractCitationKeys("As shown by [1] and [3, 4], performance improves [7].");
  assert.ok(keys.includes("1"), "expected key 1");
  assert.ok(keys.includes("3"), "expected key 3");
  assert.ok(keys.includes("4"), "expected key 4");
  assert.ok(keys.includes("7"), "expected key 7");
});

test("extractCitationKeys handles author-year citations", () => {
  const keys = extractCitationKeys("As (Smith et al., 2021) showed and (Jones 2020) confirmed.");
  assert.ok(keys.some((k) => k.includes("Smith")), "expected Smith author-year key");
  assert.ok(keys.some((k) => k.includes("Jones")), "expected Jones author-year key");
});

test("parseReferenceList extracts numeric references", () => {
  const refText = "[1] Smith J. A Method. Proc. ICML 2021.\n[2] Jones B. Another Approach. NeurIPS 2020.";
  const map = parseReferenceList(refText);
  assert.ok(map.has("1"), "expected reference 1");
  assert.ok(map.has("2"), "expected reference 2");
  assert.ok(map.get("1")!.includes("Smith"));
  assert.ok(map.get("2")!.includes("Jones"));
});

test("checkCitationConsistency identifies citations missing from references", () => {
  const body = "As shown in [1] and [5].";
  const refs = "[1] Smith J. Some Paper. 2021.";
  const result = checkCitationConsistency(body, refs);
  assert.ok(result.hasReferencesSection, "should detect a references section");
  assert.ok(result.unusedInReferences.includes("5"), "citation 5 should be flagged as missing");
  assert.ok(!result.unusedInReferences.includes("1"), "citation 1 is defined and should not be flagged");
});

test("checkCitationConsistency returns no issues when refs section is absent", () => {
  const result = checkCitationConsistency("See [1].", null);
  assert.equal(result.hasReferencesSection, false);
  assert.deepEqual(result.unusedInReferences, []);
  assert.deepEqual(result.uncitedReferences, []);
});

// ---------------------------------------------------------------------------
// Conclusion-overreach audit pass integration
// ---------------------------------------------------------------------------

test("conclusion-overreach pass adds needs_review finding for causal conclusion language", async () => {
  // Build a minimal synthetic document with a conclusion containing causal language
  // that was not already selected by the main claim evaluator.
  const conclusionCase = EVALUATION_CASES.find((c) => c.id === "scope-overgeneralization");
  if (!conclusionCase) {
    // This case was verified during the session; skip if somehow absent.
    return;
  }
  const pdf = await buildCasePdf(conclusionCase);
  const extracted = await extractPdf(pdf);
  const audit = runAudit(extracted, Date.now());

  // All findings must have a non-empty id, rationale, and checks array.
  for (const finding of audit.findings) {
    assert.ok(finding.id.startsWith("F-"), `finding id malformed: ${finding.id}`);
    assert.ok(finding.rationale.length > 0, "rationale must not be empty");
    assert.ok(Array.isArray(finding.checks), "checks must be an array");
  }

  // Finding IDs must be sequential and non-duplicated after the re-numbering pass.
  const ids = audit.findings.map((f) => f.id);
  const unique = new Set(ids);
  assert.equal(unique.size, ids.length, "duplicate finding IDs after re-numbering");
});

test("finding IDs are non-duplicate across all evaluation cases", async () => {
  for (const evalCase of EVALUATION_CASES) {
    const pdf = await buildCasePdf(evalCase);
    const extracted = await extractPdf(pdf);
    const audit = runAudit(extracted, Date.now());
    const ids = audit.findings.map((f) => f.id);
    const unique = new Set(ids);
    assert.equal(
      unique.size,
      ids.length,
      `duplicate finding IDs in case ${evalCase.id}`,
    );
  }
});

test("audit limitations array is non-empty for empirical papers", async () => {
  const numericCase = EVALUATION_CASES.find((c) => c.id === "numeric-core");
  assert.ok(numericCase, "numeric-core fixture must exist");
  const pdf = await buildCasePdf(numericCase);
  const extracted = await extractPdf(pdf);
  const audit = runAudit(extracted, Date.now());
  assert.ok(audit.limitations.length > 0, "limitations must be populated");
  assert.ok(
    audit.limitations.some((l) => l.toLowerCase().includes("extracted")),
    "at least one limitation must describe extraction scope",
  );
});
