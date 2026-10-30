# Real-paper benchmark

**Status: incomplete, awaiting human annotation.** Ten openly licensed candidate papers are listed in
[`candidates.json`](candidates.json), but none has been downloaded, registered, or labelled yet, so no
real-paper precision, recall, or accuracy is reported anywhere in this project. The tooling below is
built and tested. The numbers come only when people label papers.

**What a label means.** Every label judges a sentence against *the paper's own evidence*: its text,
tables, figures, and the values it reports. "Supported" means the paper's evidence backs the sentence
as stated. It says nothing about whether the paper's conclusions are true in the world, whether its
data are sound, or whether cited work says what the paper claims. Annotators should not use outside
knowledge to mark a claim "contradicted".

This benchmark is separate from the synthetic regression corpus in `evaluation/`. That corpus is
designed around the engine's own checks and says nothing about real-world accuracy.

## Principles

1. **Human labels only.** An annotation file is accepted only if every annotator is declared
   `kind: "human"` and the file says `source: "human"`. Engine output uses a different schema
   (`claimcheck-prediction/v1`) and is rejected if placed where an annotation is expected.
2. **Blind annotation.** The template lists each extracted sentence with its page and section, and no
   engine output. Annotators label from the PDF, not from the ClaimCheck report.
3. **Split by paper.** Each paper goes to `dev` or `test` by hashing its id
   (`sha256("claimcheck-benchmark-v1:" + id)`, about 30% test). All claims from a paper stay together,
   the assignment never changes, and `loadManifest` refuses a paper listed in the wrong split.
4. **Held-out test set.** Develop against `dev` only. `evaluate --split test` refuses to run without
   `--confirm-held-out`; use it once per frozen engine version and record the version.
5. **Regression cases are not benchmark papers.** A private, unpublished PDF used for local extraction
   regression is listed under `regressionCases` (no content, no hash). It cannot also be added to a split.

## Candidate papers (proposed, not downloaded)

[`candidates.json`](candidates.json) lists ten CC BY research articles chosen for quantitative results
and likely tables, across clinical trials, public-health surveys, education, psychology replication,
ecology, an ML benchmark, health economics, and two arXiv NLP papers. Licence values come from the
Europe PMC and arXiv metadata APIs (queried 2026-10-30). Layout, tables, and length are unconfirmed
until the PDFs are opened.

| Id | Split | Discipline |
| --- | --- | --- |
| pmc8864028 | test | clinical trial (Nature Communications) |
| pmc9409540 | dev | public-health survey (PLoS Medicine) |
| pmc10163855 | dev | education survey (BMC Medical Education) |
| pmc9038876 | dev | psychology replication (Psychonomic Bulletin & Review) |
| pmc9541691 | dev | ecology (Ecological Applications) |
| pmc11421803 | dev | ML benchmark (PLoS Computational Biology) |
| pmc8881835 | dev | health economics (BMC Health Services Research) |
| pmc11605890 | test | medical-education trial (BMC Medical Education) |
| arxiv-2402.18101 | test | NLP human evaluation (arXiv, CC BY 4.0) |
| arxiv-2402.19133 | test | NLP / HCI (arXiv, CC BY 4.0) |

Ids are lowercase source identifiers. A first draft used descriptive slugs, which happened to hash all
ten papers into `dev` (about a 3% chance). The id convention was changed once, before any paper was
opened, and the resulting 6 dev / 4 test split is kept as is. The split rule did not change.

To register them, after a person approves the downloads and checks each licence page:

```bash
mkdir -p benchmark/papers
curl -L -o benchmark/papers/pmc9409540.pdf "https://europepmc.org/articles/PMC9409540?pdf=render"
npm run benchmark -- add benchmark/papers/pmc9409540.pdf --id pmc9409540 --title "Trends in smoking prevalence…" \
  --url https://pmc.ncbi.nlm.nih.gov/articles/PMC9409540/ --license CC-BY-4.0 --license-checked-by "<your name>"
npm run benchmark -- template pmc9409540
```

## Choosing papers

- Prefer openly licensed papers (for example arXiv or PubMed Central articles under CC BY 4.0) and
  record the licence and who checked it. PDFs are stored in `benchmark/papers/` and are **not
  committed**; the manifest stores the source URL and SHA-256 so others can obtain the same file.
- Mix layouts (one- and two-column), disciplines (ML benchmarks, clinical, social science, governance),
  and papers with and without tables.
- Aim for at least 20 papers before reading per-label numbers. Paper-level bootstrap intervals for F1
  are only reported with five or more papers.

## Workflow

```bash
npm run benchmark -- add paper.pdf --id smith-2024-trial --title "…" --url https://… \
  --license CC-BY-4.0 --license-checked-by "<reviewer name>"
npm run benchmark -- template smith-2024-trial          # writes benchmark/templates/<id>.csv and .json
# annotators fill in the CSV (Excel, Sheets, LibreOffice) from the PDF
npm run benchmark -- import smith-2024-trial filled.csv --annotator r1 --annotator r2 --method consensus
npm run benchmark -- predict                              # engine output → benchmark/predictions/ (gitignored)
npm run benchmark -- evaluate                             # dev split
npm run benchmark -- evaluate --split test --confirm-held-out
```

## AI-assisted review (optional, for a manageable first subset)

Labelling every sentence of ten papers is slow. To start, an AI assistant may propose labels for a
subset of sentences (for example 20–40 per paper that state results), with evidence quotes and page
numbers taken from the paper. **Proposals are not labels.**

1. Proposals go in `benchmark/proposals/<id>.json` (`claimcheck-proposal/v1`, `source: "ai"`, a named
   generator, and a rationale per item). ClaimCheck engine output is refused here: the engine is what
   is being measured.
2. `npm run benchmark -- review-sheet <id>` writes `benchmark/templates/<id>.review.csv`. Each row shows
   the sentence, the proposal, and the rationale, with an empty `decision` column and empty label
   columns.
3. A person checks each row against the PDF and sets `decision`:
   - `approve`: the proposal is right as written. Leave the label columns empty.
   - `amend`: fill the label columns with the correct values, which replace the proposal.
   - `reject`: the row is dropped and not labelled.
   - Blank rows are counted as not yet reviewed and dropped. Mark unclear cases `amend` with
     `needs_review`.
4. `npm run benchmark -- import <id> <sheet.csv> --annotator <name> --method single --reviewed`
   imports only the approved and amended rows. The file records `provenance.method:
   "ai_assisted_review"`, `scope: "subset"`, the generator, the decision counts, and each claim's decision.

The evaluator lists each paper's provenance. For subset reviews, recall and false-positive rate cover
the reviewed sentences only, and the report says so. Agreement with human-reviewed AI proposals is
weaker evidence than blind annotation, because reviewers can anchor on the proposal. Report the two
kinds separately, and prefer blind labels for the held-out test split.

## Annotation schema (`claimcheck-annotation/v1`)

Defined and validated in [`lib/schema.ts`](lib/schema.ts). One file per paper in `annotations/`.

| Field | Meaning |
| --- | --- |
| `annotators[]` | `{ id, kind: "human", expertise? }`; at least one |
| `adjudication.method` | `single`, `consensus` (annotators agreed), or `adjudicated` (a third person resolved disagreements) |
| `pagesReviewed[]` | Pages reviewed completely. Predictions on other pages are not scored |
| `claims[].auditable` | `true` for a checkable claim; `false` for a sentence that is not a claim (a negative item) |
| `claims[].label` | For auditable claims: `supported`, `partially_supported`, `contradicted`, `unsupported`, `needs_review` |
| `claims[].issues[]` | `numerical_inconsistency`, `citation_issue`, `reference_issue`, `overreach`, `statistical_reporting` |
| `claims[].evidence[]` | `{ page, quote, relation: supports \| contradicts \| context, tableLabel? }`: where the deciding evidence is |
| `referenceIssues[]` | `missing_table`, `missing_figure`, `uncited_reference`, `missing_bibliography_entry`, `malformed_reference` |
| `provenance` | Optional. `{ method: blind \| ai_assisted_review, scope: full_pages \| subset, proposalGenerator?, decisions? }`; absent means blind |
| `claims[].review` | AI-assisted review only: `approved` or `amended` |

Labels judge the claim **against the paper itself**, as the product does: "supported" means the paper's
own evidence supports the sentence, not that the science is right.

### Labelling guide (CSV columns)

- `auditable`: `yes` / `no`. Leave blank to skip a sentence (it is then not scored).
- `label`: required when `auditable` is `yes`.
- `issues`: semicolon-separated tags.
- `evidence_page`, `evidence_quote`, `evidence_relation`: the passage or table row that decides the
  label. Copy the quote from the PDF.

## Metrics (`lib/metrics.ts`)

Predictions and annotations are matched one-to-one on the same page by normalized text overlap
(containment or token Jaccard ≥ 0.6).

| Metric | Definition |
| --- | --- |
| Claim detection precision / recall / F1 | Findings on auditable claims ÷ all scored findings; ÷ auditable claims |
| False-positive rate | Findings on `auditable: false` sentences ÷ all such sentences |
| Per-label precision / recall / F1 | One-vs-rest over the five labels; missed claims count as false negatives for their true label |
| Exact label accuracy | Correct labels ÷ detected claims |
| Evidence localization | Detected claims whose supporting or conflicting evidence shares a page and ≥ 50% text overlap with an annotated evidence item ÷ claims where both sides give evidence |
| Coverage / decisive coverage | Detected ÷ auditable; detected and not `needs_review` ÷ auditable |
| Abstention rate | `needs_review` findings ÷ detected claims |
| Numerical inconsistency | Contradictions with a flagged numeric check vs claims tagged `numerical_inconsistency` |
| Missing table/figure | Findings with a flagged reference check vs annotated `missing_table` / `missing_figure` |

All proportions have 95% Wilson intervals. F1 has a paper-level percentile bootstrap interval (2,000
resamples, fixed seed) when at least five papers are scored. **Citation issues are recorded but not
scored**: the engine does not report bibliography or citation-list problems, and a score of zero
would misrepresent that as a measured failure.
