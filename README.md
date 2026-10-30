# ClaimCheck AI

**A local, evidence-based research paper auditing workbench with a measured regression corpus.**

ClaimCheck AI reads a text-based academic PDF, identifies auditable statements, locates evidence
inside the same document, and produces a traceable audit report. It separates confirmed internal
inconsistencies from weak, missing, or ambiguous evidence. It is not a chatbot, a summarizer, or a
verdict on research integrity.

The engine is deterministic and runs without a paid AI API. Every finding is tied to extracted text
or a real reconstructed table row. Nothing is fabricated.

---

## Quick start

Requirements: Node.js 22+ (tested on Node 22.23, Windows), npm, and a modern browser.

```bash
npm ci              # clean, lockfile-based install (npm install also works)
npm run sample      # generates the labeled synthetic demo PDF
npm run dev         # API on http://127.0.0.1:8787, UI on http://localhost:5173
```

Open `http://localhost:5173`.

For the production-style local server:

```bash
npm run build
npm run start       # builds separately; serves UI + API on http://127.0.0.1:8787
```

`npm run build` runs a full TypeScript check and builds the React client into `client/dist`.
`npm run start` runs the Express API with `tsx` in production mode and serves the built client.

### Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | API and Vite client with hot reload |
| `npm run dev:server` | API only, watching TypeScript |
| `npm run dev:client` | Vite client only (proxies `/api` to port 8787) |
| `npm run typecheck` | Strict TypeScript check for client, server, shared code, scripts, evaluation |
| `npm run build` | Typecheck + production client build |
| `npm test` | Unit/API suite, then the annotated audit corpus |
| `npm run test:unit` | `node:test` suite: extraction, audit rules, reports, API and persistence |
| `npm run test:evaluation` | Annotated synthetic corpus and metrics |
| `npm run test:write` | Corpus run plus `evaluation/results/latest.json` |
| `npm run test:publish` | Run the corpus and publish `evaluation/summary.json` for the Evaluation page |
| `npm start` | Production-mode local server |
| `npm run sample` | Regenerate the synthetic sample paper |
| `npm run benchmark -- <command>` | Real-paper benchmark: `add`, `template`, `review-sheet`, `import`, `predict`, `evaluate` (see `benchmark/README.md`) |

---

## What works in phase one

- Real PDF selection by picker or drag-and-drop, with client-side and server-side validation.
- Genuine PDF text extraction with `pdfjs-dist`, including page text and positional layout data.
- Heading/section detection, wrapped-line reflow, and conservative reconstruction of simple tables.
- Asynchronous audit jobs with real queued, validating, extracting, structuring, claim-selection,
  evidence, and report stages.
- Deterministic claim selection and evidence retrieval over extracted text and table rows.
- Five-category findings: supported, partially supported, potentially unsupported, potential
  contradiction, and needs review.
- Evidence-linked findings with exact quotes, page numbers, section names, numeric comparisons,
  check outcomes, and interpretation limits.
- Every finding quotes its claim and evidence with section and page. The source text itself is not retained (see Data handling).
- Markdown and JSON report downloads.
- Local SQLite persistence, report archive, and deletion.
- A measured Evaluation page backed by the same extractor and engine, with per-category precision,
  recall, F1, fixture coverage, and evidence-trace checks.
- Clear, honest failure states for invalid, empty, corrupt, scanned, sparse, oversized, and
  unreadable PDFs.

Every visible primary action in the interface is backed by a real route or produces a real error.
There are no placeholder buttons.

---

## How the audit works

1. **Validate** — file name, declared size, PDF magic bytes, page count, and text availability.
2. **Extract** — read each page's selectable text and text positions with pdfjs. Each page's layout
   is classified separately: a two-column page is detected from an empty vertical gutter (an x-range
   almost no text item crosses), and each column is read top to bottom. Full-width lines (titles,
   spanning figures) split the page into bands. Pages without a clean gutter are read as one column.
   Sub- and superscripts are attached to the line they sit on.
3. **Structure** — infer headings and standard sections (using real font names, so bold headings are
   recognised even when pdfjs reports opaque font ids); reject run-in list labels and fragments as
   headings; merge two-line headings and wrapped small-font captions. Tables are reconstructed either
   from wide column gaps or, for compact tables, from vertically aligned cell rows; table lines are
   kept out of the prose that claims are drawn from. Unreliable tables are marked unreliable.
4. **Select claims** — deterministic cues pick auditable sentences: labelled metric values,
   comparisons, significance claims, universal scope language, and referenced tables/figures.
5. **Retrieve evidence** — compare claims with other passages and reconstructed table rows. Metric
   labels, values, methods, datasets, splits, language pairs, and conditional settings constrain what
   can be compared.
6. **Classify** — apply explicit precedence rules and attach only traceable evidence and explicit
   limitations.

### Checks implemented

- Repeated numeric values across sections for recognized metric labels.
- Claim-versus-table comparisons for reliably reconstructed rows.
- Thresholds and exact matches for metric values; rounding tolerance is applied conservatively.
- Statistical-significance language checked for a p-value, confidence interval, named test, or effect
  size in the extracted document.
- Universal/broad wording weighed against the baselines and datasets actually located — only for
  statements about the authors' own work (a superlative about something else is not a scope claim).
- Stated-change arithmetic: "from 48.0 to 59.7 (+11.7)" is checked exactly, with a tolerance derived
  from the reported precision. A mismatch is a potential contradiction; ambiguous relative `%` changes
  are skipped.
- Symbol-bound values ("ρ = 0.314", "ΔYI = +11.7") are compared with the same symbol elsewhere.
  Agreement at the reported precision is consistency evidence. A *different* value is shown as context
  only and never as a contradiction, because parameters legitimately vary across scenarios.
- Table-cell tracing for values without a named metric (`server/src/audit/tables.ts`). A sentence
  value is linked to a reliable table cell only when **all** of these hold: the sentence names the
  cell's row (its label, or a short code it abbreviates, such as NOR → "northern"); the value has
  at least three significant digits (two only if a bound symbol such as `r0 =` confirms the column;
  one never); exactly one cell among the named rows holds it; the cell is at least as precise as the
  sentence; any bound symbol is notation-compatible with the column header; and a table named in the
  sentence ("Table 3") is the one matched. A conflict is reported only when row and column are both
  explicit and the values differ. A matching number alone is never evidence.
- Referenced tables and figures checked against extracted captions.
- Cross-condition guards for datasets, splits, language pairs, methods, and ablations.
- Evidence retrieval via lexical and numeric overlap. Retrieval is context, not proof of entailment.

### What is deliberately not claimed

- The engine does not verify external literature, citations, code, raw data, or supplementary files.
- It does not perform OCR, so scanned PDFs are rejected rather than guessed at.
- It does not parse complex, merged-cell, borderless, or multi-page tables reliably.
- It does not use a language model or semantic entailment. Paraphrased support can be missed.
- It does not compare unlabelled counts, sample sizes, training times, dates, or arbitrary numbers.
- "Supported" is internal consistency evidence, not proof the experiment is valid.
- "Potentially unsupported" means evidence was not located; it does not prove a claim false.

The five labels describe the relationship between a sentence and the accessible document. They are
revision aids, never findings of misconduct.

---

## Architecture

```text
client/                   React 19 + Vite workbench
  src/components/         upload, workspace, document viewer, findings, evidence UI
  src/pages/              home, audit, reports, methodology
  src/lib/                API client, category metadata, polling hooks, formatting
server/
  src/index.ts            Express 5 routes, validation, static client serving
  src/pdf/extract.ts      pdfjs extraction, line layout, headings, sections, tables
  src/audit/text.ts       numeric facts, metric association, context guards, evidence matching
  src/audit/engine.ts     claim selection, evaluation, classification, evidence assembly
  src/jobs.ts             asynchronous processing pipeline and timeout handling
  src/db.ts               node:sqlite schema and audit persistence
  src/report.ts           Markdown and JSON report generation
shared/types.ts           shared API, audit, and finding types
scripts/generate-samples.ts  synthetic demo PDF generator
evaluation/               ground-truth synthetic corpus and regression runner
benchmark/                real-paper benchmark tooling (schema, split, metrics); awaiting human labels
server/src/voice.ts       optional Wispr Flow API transcription proxy (off by default)
tests/                    node:test suite (extraction, audit, reports, API, persistence)
samples/                  committed demo PDF
data/                     local SQLite database (created at runtime, ignored by git)
```

### API

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Engine/version, limits, persistence status, sample availability |
| `GET /api/evaluation` | Published synthetic-corpus regression summary |
| `GET /api/audits` | Stored report list |
| `POST /api/audits` | Upload one PDF (`multipart/form-data`, field `file`) |
| `POST /api/audits/sample` | Run the labeled synthetic sample PDF |
| `GET /api/audits/:id` | Audit record, findings, extraction, document text |
| `DELETE /api/audits/:id` | Delete a stored audit |
| `GET /api/audits/:id/report.md` | Download Markdown report |
| `GET /api/audits/:id/report.json` | Download structured JSON report |
| `GET /api/voice/status` | Whether optional Wispr Flow API transcription is enabled (never includes the key) |
| `POST /api/voice/transcribe` | `audio/wav` body (16 kHz mono 16-bit, ≤ 90 s) → `{ text, seconds }`; 503 when not configured |

---

## Voice input: two separate paths

**1. Desktop dictation (works today, no integration).** The question field under *Ask about this
finding* is an ordinary text input, so the Wispr Flow desktop app, or any dictation tool, can type
into it. ClaimCheck receives only the typed text.

**2. Wispr Flow API transcription (implemented, not verified, blocked by access approval).** The
official Flow API is [available only to organizations approved by Wispr](https://api-docs.wisprflow.ai/quickstart)
(contact enterprise@wisprflow.ai). No approved key exists for this project, so this path has **never
been run against the real API**. It is off unless the server operator sets:

```bash
CLAIMCHECK_WISPR_API=1
WISPR_FLOW_API_KEY=fl-…          # from platform.wisprflow.ai → API Keys; never commit it
# WISPR_FLOW_API_URL=…           # optional override; must be https:// (or a loopback test server)
```

How it works when enabled:

- The panel shows **Record**. The browser asks for microphone permission (the server sends
  `Permissions-Policy: microphone=(self)` only when the feature is enabled; otherwise `microphone=()`).
- Audio is recorded locally, converted to 16 kHz mono 16-bit WAV (`client/src/lib/wav.ts`), and posted
  to `POST /api/voice/transcribe` on this server.
- The server checks the WAV format and length (≤ 90 s), then calls the documented REST endpoint
  `POST https://platform-api.wisprflow.ai/api/v1/dash/api` with `Authorization: Bearer <key>` and
  `{ audio: <base64>, language: ["en"], context: { app, dictionary_context } }`. It returns only the
  text. The key never leaves the server, is not logged, and never appears in error responses.
- The transcript is placed in the question field with "Review or edit it, then press Ask". **Nothing
  is submitted automatically**, and the panel can only answer questions from the audit record. Voice
  cannot delete, change dispositions, or trigger any other action.
- Microphone denial, a missing microphone, oversized or invalid audio, API authentication failure,
  rate limiting, upstream errors, timeouts (30 s), and cancellation (during recording or
  transcription; the upstream request is aborted) each produce a specific message.

Not implemented: the Flow **WebSocket streaming** API with short-lived client tokens. It would put a
token in the browser and open the CSP to a third-party host. The documentation also leaves parts of
that protocol open (append `position` semantics, the `final` flag, the WebSocket error payload), and
they cannot be confirmed without an approved account. The server-side REST proxy needs no client
token, because the browser never talks to Wispr directly. Rate limits and per-request prices are not
documented by Wispr; usage is billed by tokens under the organization's contract.

---

## Data handling and privacy

- Uploaded PDFs are held in **server memory** during processing. The original file is never written to
  disk, and the buffer is released when processing ends.
- **The paper is not retained.** After an audit completes, only the audit is stored in SQLite
  (`data/claimcheck.sqlite`): findings, the summary and category counts, limitations, timings, and
  aggregate extraction statistics (pages, words, and section, table, and caption counts). The following
  are never stored:
  - the full text and page text;
  - section headings;
  - table cells;
  - captions;
  - a file hash (`server/src/privacy.ts`, `completeAudit` in `server/src/db.ts`).
- **What still reveals something about the source.**
  - Each finding quotes its claim sentence and its evidence passages or table rows, with section titles
    and page numbers. These excerpts are the audit result and are kept on purpose.
  - The original filename, file size, page and word counts, and extraction warnings (fixed templates
    with counts) are also kept.
  - The Markdown and JSON reports contain the same excerpts.
- **Older records are cleaned automatically.** On startup, `purgeStoredDocumentContent()` clears
  `document_json` and file hashes, and reduces `extraction_json` to counts. It keeps findings, summaries,
  limitations, and timings, and rewrites the database file (`VACUUM`) so removed text does not linger.
  It is idempotent and touches no other records.
- The UI's **Source text** tab explains that the document is not retained. "View in document" links
  are hidden.
- No outbound AI, document-processing, or font service is used. Fonts are bundled locally. The only
  exception is opt-in: with Wispr Flow API transcription enabled, recorded question audio (not paper
  text) is sent to Wispr's API.
- Paper text is not intentionally logged. Only startup and technical error information is logged.
- Reports remain until deleted. There is no automatic retention policy.
- **Access.**
  - **Reports are public.** The Reports list (`GET /api/audits`) and each report page are open to
    anyone who can reach the server.
  - The list returns only allow-listed metadata (`PUBLIC_LIST_FIELDS` in `server/src/privacy.ts`):
    ID, filename, size, status, dates, category counts, and page count. It never includes findings,
    excerpts, extraction details, document text, or hashes.
  - Opening a report shows its findings and their short quoted excerpts.
  - Uploading is open to anyone.
  - Set `CLAIMCHECK_ADMIN_TOKEN` to require `Authorization: Bearer <token>` for **deleting** reports and
    **restoring** backups. The browser never holds the token, and the UI hides delete buttons when it is
    set. Without it, anyone can delete reports.
  - There are no user accounts, per-user isolation, rate limits, or encryption at rest. Do not upload
    papers whose findings and quoted excerpts must stay private.
- **Backup and restore.**
  - `npx tsx scripts/backup-report.ts <baseUrl> <auditId> <out.json>` saves a sanitized copy of a
    report, with no document text and no hash. Keep it outside the repository: findings quote the
    paper.
  - `CLAIMCHECK_ADMIN_TOKEN=… npx tsx scripts/restore-report.ts <baseUrl> <out.json>` restores it under
    the same ID. It never overwrites an existing record.
  - `CLAIMCHECK_RESTORE_DIR=<dir>` restores every backup `.json` in that directory on each start. This
    keeps a report available on hosts whose disk is wiped by restarts. On Render, add the backup as a
    Secret File and set `CLAIMCHECK_RESTORE_DIR=/etc/secrets`. Backups are sanitized again on import,
    and existing IDs are never overwritten.
- Set `CLAIMCHECK_DATA_DIR` to move the database. Use `PORT` to change the API port.
- Reviewer dispositions and notes are stored in the **browser's localStorage**, keyed by audit ID.
  They are not sent to the server, do not follow you to another browser, and are not included in the
  Markdown or JSON reports. The UI states this under the reviewer workspace.

---

## Evaluation and regression testing

`npm test` runs two committed layers against the real extractor and engine:

- A `node:test` suite covering PDF extraction, section detection, claim selection, evidence matching,
  numeric comparisons, context guards, classification, report generation, API validation, processing
  failure states, persistence/retrieval, and quote/offset integrity.
- A labeled synthetic corpus of 13 fixtures and 52 annotated findings with explicit non-findings.
  The committed demo paper is a separate regression fixture.

Current run:

| Measure | Result |
| --- | --- |
| Unit/API/regression tests | 113/114 passed, 1 optional private-PDF test skipped |
| Fixtures | 13 |
| Annotated findings | 52 across all five categories |
| Claim-selection recall | 1.000 (52/52) |
| Exact category accuracy | 1.000 (52/52) |
| Strict finding precision | 1.000 (52/52) |
| Evidence-trace failures | 0 |
| Unexpected findings | 0 |

The recorded corpus result is visible in the product at `/evaluation`; publish a new snapshot with
`npm run test:publish`. `evaluation/results/latest.json` holds the machine-readable run.

This is a regression score on a small synthetic corpus designed around the engine's implemented
checks. It is **not** an estimate of accuracy on real papers. The corpus includes explicit negative
controls for cross-dataset, cross-split, cross-language-pair, task, model-variant, score-margin, and
ablation comparisons. See [`evaluation/README.md`](evaluation/README.md) for the fixture design,
scoring rules, and limits.

### Real-paper benchmark: awaiting human annotation

[`benchmark/`](benchmark/README.md) holds the real-paper benchmark tooling: a versioned annotation schema
(`claimcheck-annotation/v1`), blind CSV/JSON templates for annotators, a deterministic paper-level
dev/test split with a held-out test set, and an evaluator. The evaluator reports precision, recall
and F1 (overall and per label), the false-positive rate on non-claims, evidence-localization
accuracy, coverage, abstention rate, numerical-inconsistency and missing-reference detection, with
95% Wilson intervals and paper-level bootstrap intervals for F1.

**No real papers have been labelled, so no real-paper metrics exist.** `npm run benchmark -- evaluate`
currently prints `STATUS: AWAITING HUMAN ANNOTATION`. The tooling rejects machine-generated labels:
engine predictions cannot be loaded as annotations.

Ten openly licensed candidate papers (CC BY, across eight disciplines) are listed in
[`benchmark/candidates.json`](benchmark/candidates.json) with a precomputed 6 dev / 4 test split. They
are not downloaded or registered yet. An optional AI-assisted review path lets an assistant propose
labels for a subset of sentences, which a named person must approve, amend, or reject row by row;
only approved and amended rows become labels, and the evaluator reports their provenance and marks a
partly labelled split as incomplete.

## Validation and limits

- Maximum upload: **25 MB**.
- Maximum PDF pages: **150**.
- Processing timeout: **90 seconds**.
- Minimum auditable text: 500 characters and 60 words; multi-page documents also need an average of
  at least 140 extracted characters per page.
- Documents with no selectable text are rejected as scanned/image-only.
- Up to 40 highest-priority claim candidates are audited per document.
- One document per audit. No cross-paper comparison.

Handled failure modes include wrong file type, fake PDF signature, empty file, oversized file,
encrypted/corrupt PDF, password-protected PDF, scanned/image-only PDF, low-text PDF, extraction
failure, audit timeout, storage failure, report failure, missing sample, and server restart
interruption. No partial findings are shown as a completed audit.

---

## Verification performed

- `npm run typecheck` — passes with strict TypeScript, including the test suite.
- `npm run build` — passes; production client bundle generated.
- `npm run test:unit` — 113/114 tests pass (one optional structural test runs only when a private PDF is
  present locally; set `CLAIMCHECK_REGRESSION_PDF` to point at it), including:
  - two-column layout regression (`tests/two_column_layout.test.ts`): column reading order, page-1
    author blocks, compact tables kept out of prose and reconstructed cell-by-cell, superscripts,
    run-in list labels, wrapped headings and captions, page/offset provenance. These tests fail 8/9
    against the previous extractor;
  - stated-change arithmetic and symbol consistency (`tests/consistency_checks.test.ts`), including
    the negative cases: a symbol with a different value is never a contradiction, and a superlative
    about something other than the authors' work does not trigger the scope check;
  - table-cell evidence (`tests/table_evidence.test.ts`): valid row/column links, and rejection of a
    number with no row reference, one-significant-digit values, a symbol naming another column,
    values shared by several named rows, the wrong named table, unreliable tables, and a cell less
    precise than the claim. The end-to-end case fails against the previous engine;
  - optional Wispr Flow API transcription (`tests/voice.test.ts`, 15 tests) against a local mock of the
    documented REST contract: feature flag and key handling, WAV validation, the normal response, 401/403
    authentication failure, 400/413/429/500 and malformed responses, network failure, timeout,
    cancellation (including the server aborting its upstream request), the microphone policy
    header, and no key in responses or logs. The live Wispr API was never called;
  - real-paper benchmark tooling (`tests/benchmark.test.ts`, 12 tests): human-only annotation
    validation, rejection of predictions as labels, split determinism and tamper checks, metric
    arithmetic on a hand-written fixture, Wilson and bootstrap intervals, CSV round-trip, and the blind
    template, the AI-proposal review gate (approve, amend, reject; engine output refused as proposals), and incomplete-split and provenance reporting;
  - sample-paper upload through completion, with all findings’ claim and evidence offsets mapped to
    the stored document text;
  - Markdown and JSON report downloads, archive listing, deletion, and retrieval after a server
    restart from the same SQLite directory;
  - rejection of wrong extension, empty file, missing file, and fake PDF signature without creating
    archive records;
  - corrupt, image-only, and sparse-text PDF failure states with no findings and a 409 on report
    download;
  - unreliable-table rejection, digit-free table headers, decimal-formatted score columns, missing
    headings, and damaged-PDF extraction errors.
- `npm test` / `npm run test:publish` — 13 fixtures, 52/52 exact classifications and claim recall,
  zero unexpected findings, zero evidence-trace failures, zero assertion failures. All five
  categories score 1.000 precision and recall on this corpus.

Browser verification (production build in the desktop app's browser pane):

- Upload through the page's real file-input `change` handler and through `dragenter`/`drop` events on
  the dropzone, each with a real PDF `File`: upload progress, processing, and the finished audit all
  displayed. The drag-hover state (`is-dragging`) is applied.
- Client-side rejection of a `.txt` file, an empty file, and a two-file drop; server-side failure page
  for a corrupted PDF ("This PDF could not be read", recovery steps, technical detail limited to
  "Invalid PDF structure.", no partial findings).
- Finding detail with table-row evidence, reviewer disposition and note persisting across reload,
  grounded Q&A, phone-width layout without horizontal overflow, and Markdown/JSON downloads from
  the UI's own links (`attachment` disposition, correct filenames).
- **Not exercised:** the operating system's file-chooser dialog itself (browser automation cannot
  drive it), and a physical drag from the desktop. The events above go through the same React
  handlers those actions trigger. The full real-manuscript upload was sent with curl to the same
  `POST /api/audits` endpoint, because the page's Content-Security-Policy correctly blocks loading
  test bytes from another origin.

The synthetic corpus result must not be read as real-paper accuracy. Earlier exploratory runs on
real papers informed engine fixes but are not part of this measured result and are not committed as
ground truth.

### Papers actually tested

- **Synthetic regression corpus:** 13 generated fixtures with known answers (52/52, see above). They are
  built around the engine's checks and say nothing about real-world accuracy.
- **Synthetic sample paper:** `samples/claimcheck-demo-paper.pdf`, used for the demo and the API tests.
- **Generated layout fixtures:** two-column, compact-table and stated-change PDFs created in the tests
  (`tests/two_column_layout.test.ts`, `tests/table_evidence.test.ts`,
  `tests/consistency_checks.test.ts`), with invented content.
- **One private, unpublished manuscript** was audited locally while fixing two-column extraction and
  table tracing. It is not distributed, nothing from it is stored in this repository, and it was not
  labelled, so it supports no accuracy claim. An optional structural test runs against a private PDF
  only when `CLAIMCHECK_REGRESSION_PDF` points to one.
- **Real-paper benchmark:** none yet. Ten openly licensed candidates are listed but not downloaded or
  labelled (see `benchmark/README.md`).

Note: `node:sqlite` prints an experimental-feature warning under Node 22. It works, but it relies on
a Node feature whose API may change.

---

## Deployment status

A demo instance runs on Render's free web service with `HOST=0.0.0.0` and `PORT` from the host. See
[SUBMISSION.md](SUBMISSION.md) for settings. On the free plan the SQLite file is on Render's ephemeral
filesystem: it is lost on every redeploy, restart, or idle spin-down, so stored reports are not durable
there. Use `scripts/backup-report.ts` and `scripts/restore-report.ts` to carry a report across a
redeploy, or attach a persistent disk and point `CLAIMCHECK_DATA_DIR` at it. Reports are
public; without `CLAIMCHECK_ADMIN_TOKEN`, anyone who can reach the instance can also delete them. A public phase-two deployment needs a Node-capable host with a persistent disk for
SQLite, authentication, rate limiting, HTTPS, retention controls, and hardening. Static-only or
Cloudflare Workers hosting would require porting the Node PDF extraction pipeline and storage layer.

---

## Recommended next step

The deterministic regression framework is in place. The next step is to extend it with an
independently annotated real-paper set, kept separate from the synthetic regression score, and use
the disagreements to improve numerical checks and evidence reliability. Public, authenticated
deployment on a Node host with persistent storage should follow, then a controlled researcher pilot
with PDF annotation and review workflows.

---

ClaimCheck AI · Engine 0.1.0 · Evaluation foundation
