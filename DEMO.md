# ClaimCheck AI: two-minute demo script

This demo uses the synthetic sample paper `samples/claimcheck-demo-paper.pdf`. It is a three-page test
paper with deliberately planted problems, not a real publication, so say that on camera. Everything
shown is the app running live on your machine. Nothing is pre-recorded or mocked.

The findings below were checked on 30 October 2026 against engine 0.1.0. The sample produces 9
findings: 1 contradiction, 4 unsupported, 1 partial, 2 needs review, 1 supported.

## Before recording

```bash
npm run build
npm run start          # http://127.0.0.1:8787
```

- Open http://127.0.0.1:8787 in a browser, with File Explorer showing the `samples` folder beside it.
- Open the Wispr Flow desktop app, and make sure its on-screen indicator is visible when you dictate.
  This is the "Flow in use" clip.
- Optionally delete old reports from **All reports** for a clean archive.
- Do one dry run. The first audit after a cold start is slower.

## Script (≈ 2:00)

| Time | Action | What to say |
| --- | --- | --- |
| 0:00 | Home page | "Before submitting a paper, someone has to check that every number in the text matches the tables. ClaimCheck AI does that pass and ties every finding to a quote and a page in the same PDF." |
| 0:12 | Drag `claimcheck-demo-paper.pdf` onto the upload area | "This is a synthetic test paper with problems planted on purpose. It checks the file first, then reads the layout, tables, and sections." |
| 0:22 | Audit summary: 9 claims | "Nine checkable claims. Each label describes how a sentence relates to the rest of the paper. It is not a verdict on the research." |
| 0:30 | Open **F-001**, the contradiction: "ARC achieves 98.2% accuracy and a macro-F1 of 0.89" | "The abstract says 98.2% accuracy. Table 2 says 94.1% for the same model. It shows both values, the difference, and the table row." |
| 0:45 | Click **View in document** on the evidence | "Every piece of evidence links back to the extracted text, so you can check it yourself." |
| 0:52 | Open **F-009**, supported | "Here the results paragraph matches Table 2 exactly, so it's marked supported. That's internal consistency only." |
| 1:00 | Open **F-004**: "As shown in Table 4…" | "This sentence cites Table 4, but the paper has no Table 4. Missing evidence is flagged, not guessed." |
| 1:08 | Open **F-007**, needs review (ablation values) | "When values come from a different setting, it doesn't guess. It asks a person to look." |
| 1:16 | Back on F-001: **Ask about this finding**, click the field, dictate with Wispr Flow: "What evidence was found for this finding?", then press **Ask** (tested: it answers with the conflicting Table 2 row) | "I built this by voice with Wispr Flow, and I use it here too. Answers come only from this audit's data, no AI model and nothing invented." |
| 1:35 | **Reviewer workspace** → **Confirmed issue**, then dictate a note: "Abstract must be corrected to 94.1 percent", and save | "My decision is kept separate from the engine's label." |
| 1:47 | Click **Markdown** in the header and open the downloaded report | "The report lists every claim, check, quote, page, and limitation, ready to send to co-authors." |
| 1:55 | Close | "Evidence first, uncertainty stated, nothing invented." |

If you are short on time, drop F-007 (1:08).

## What not to claim

- **Not a truth detector.** "Supported" means the paper's own numbers agree with each other, not that
  the science is right.
- **No real-world accuracy figure.** The 52/52 synthetic evaluation is a regression check on test
  papers built around the engine. The real-paper benchmark has candidate papers but no human labels,
  so it has no results.
- **Wispr Flow here is desktop dictation** into ordinary text fields. The optional Wispr Flow API path
  in the code is switched off and has never run against the real API. Do not show or describe it as
  working.
- **Running locally**, unless you have actually deployed and checked a public instance. There is no
  authentication.
- Reviewer notes are kept in the browser only. They are not on the server and not in the report.
- The engine does not check external citations, code, or data.

## Known rough edge

F-001's "Interpretation limits" includes a generic line, "Only one passage identifies a dataset, so the
differing values were not treated as a contradiction," which reads oddly next to a contradiction label.
Don't scroll to it on camera; the "Why this classification" text above it is accurate.
