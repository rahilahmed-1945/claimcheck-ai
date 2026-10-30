/**
 * Benchmark manifest and the paper-level split.
 *
 * Every paper is assigned to "dev" or "test" from a hash of its id, so the
 * assignment is reproducible, independent of the order papers are added, and
 * never changes once made. About 30% of papers are held out for test. All
 * claims from one paper stay in one split, so nothing leaks between them.
 *
 * Regression cases (for example a private manuscript used while fixing the
 * extractor) are listed separately and are never part of either split.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const MANIFEST_SCHEMA = "claimcheck-benchmark-manifest/v1";
export const SPLIT_SALT = "claimcheck-benchmark-v1";
export const TEST_FRACTION = 0.3;

export type Split = "dev" | "test";

export interface BenchmarkPaper {
  id: string;
  title: string;
  /** Where the PDF can be obtained. The PDF itself is not committed. */
  sourceUrl: string;
  /** SPDX identifier or a short licence statement, e.g. "CC-BY-4.0". */
  license: string;
  /** Who confirmed the licence permits this use, and when. */
  licenseCheckedBy: string;
  sha256: string;
  split: Split;
  pages: number;
  addedAt: string;
}

export interface RegressionCase {
  id: string;
  role: "regression-only";
  description: string;
  sha256: string | null;
  /** Environment variable that points at the local, non-redistributed PDF. */
  localPathEnv: string;
}

export interface BenchmarkManifest {
  schema: typeof MANIFEST_SCHEMA;
  split: { method: string; salt: string; testFraction: number };
  papers: BenchmarkPaper[];
  regressionCases: RegressionCase[];
}

export const BENCHMARK_DIR = path.resolve(process.cwd(), "benchmark");
export const MANIFEST_PATH = path.join(BENCHMARK_DIR, "manifest.json");
export const ANNOTATIONS_DIR = path.join(BENCHMARK_DIR, "annotations");
export const PREDICTIONS_DIR = path.join(BENCHMARK_DIR, "predictions");
export const PAPERS_DIR = path.join(BENCHMARK_DIR, "papers");
export const TEMPLATES_DIR = path.join(BENCHMARK_DIR, "templates");

/** Deterministic split from the paper id alone. */
export function assignSplit(paperId: string, salt = SPLIT_SALT, testFraction = TEST_FRACTION): Split {
  const digest = crypto.createHash("sha256").update(`${salt}:${paperId}`).digest();
  const bucket = digest.readUInt32BE(0) / 0xffffffff;
  return bucket < testFraction ? "test" : "dev";
}

export function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function loadManifest(manifestPath = MANIFEST_PATH): BenchmarkManifest {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as BenchmarkManifest;
  if (manifest.schema !== MANIFEST_SCHEMA) throw new Error(`Unsupported manifest schema in ${manifestPath}`);
  for (const paper of manifest.papers) {
    const expected = assignSplit(paper.id, manifest.split.salt, manifest.split.testFraction);
    if (paper.split !== expected) {
      throw new Error(`Paper ${paper.id} is listed in "${paper.split}" but the split rule assigns "${expected}". Do not move papers between splits.`);
    }
  }
  const regressionIds = new Set(manifest.regressionCases.map((entry) => entry.id));
  for (const paper of manifest.papers) {
    if (regressionIds.has(paper.id)) throw new Error(`Regression case ${paper.id} must not also be a benchmark paper.`);
  }
  return manifest;
}

export function saveManifest(manifest: BenchmarkManifest, manifestPath = MANIFEST_PATH): void {
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
