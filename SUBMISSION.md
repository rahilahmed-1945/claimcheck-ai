# ClaimCheck AI: No Hands challenge submission pack

Drafts for the WeMakeDevs × Wispr Flow "No Hands" challenge (Builders track). Everything below was
checked against this repository on 30 October 2026. **[YOU]** marks what only you can supply, confirm,
or do.

> **Deadline: submit tonight.** The challenge page (wemakedevs.org/wispr) says 31 October, 11:59 pm IST.
> The announcement blog says Friday 30 October, 11:59 pm IST. Submitting by 30 October meets both. The
> form is linked from the challenge page ("Submit your project", /wispr/submit).

The challenge page asks for:

1. A link to your working project.
2. A demo video of up to two minutes.
3. A screenshot of your Wispr usage card from Insights in the desktop app.
4. A few lines on the problem, who it is for, and how you used Wispr.

The blog also asks for "a short clip of Flow in use". Blog judging weights: real problem (30%), how you
used Wispr (30%), whether it works (25%), demo clarity (15%).

---

## 1. Project description

**ClaimCheck AI checks a research paper against itself.** Upload a PDF and it finds the sentences that
make checkable claims: numbers, comparisons, stated changes, and references to tables and figures. It
then looks for evidence inside the same paper. Every finding carries the exact quote, page, section,
and the checks it ran. Some findings are confirmed: a number in the prose matches the right table
cell, or a stated change matches its arithmetic. Others are flagged for a person to review. It never
invents evidence, and it says when it cannot tell. The engine is deterministic, runs locally, and
needs no paid AI API.

## 2. The real problem

Before submitting or revising a manuscript, authors have to check that every number in the abstract,
results, and conclusions matches the tables, that stated changes add up, and that every "Table 3" or
"Figure 2" reference exists. This is slow, error-prone work done by eye just before a deadline.
Reviewers face the same job from the other side. ClaimCheck AI makes that pass systematic and
traceable. It does not judge whether the science is right.

**Who it is for:** researchers and graduate students preparing or revising papers, co-authors doing a
final consistency pass, and reviewers or editors.

**[YOU]** Add one sentence on why this is a problem in your own work.

## 3. How Wispr Flow was used

Only you can state this truthfully, and judges compare it with your usage card.

- **[YOU]** What you dictated with Wispr Flow, for example the mission briefs and prompts given to the
  AI coding assistant, specifications, and review feedback.
- **[YOU]** Words dictated during the challenge, read from your own usage card. Do not estimate.
- **In the product (verified):** the finding Q&A field and the reviewer-notes field are ordinary text
  inputs, so Wispr Flow desktop dictation works in them.
- **In the video:** the voice scene (about 82–96 s) is an **animated illustration**. It is labelled on
  screen "Animated illustration · Voice input with Wispr Flow · not a screen recording". It is not
  evidence of Wispr usage.
- **Do not claim** a Wispr API integration. The optional API path is off by default and has never run
  against the real API.

Draft "few lines" (fill in, then paste):

> ClaimCheck AI audits a research paper against its own evidence. It traces numbers in the prose to the
> right table cells, recomputes stated changes, flags references to tables that don't exist, and marks
> what it can't verify, with the quote and page for every finding. It's for researchers and
> co-authors doing the final consistency pass before submission or revision. **[YOU: your own
> experience of this problem.]** I built it with Wispr Flow, dictating **[YOU: what]**. In the app,
> questions about findings and reviewer notes are plain text fields, so they can be dictated with Flow.

## 4. Video

**`submission/claimcheck_explainer.mp4`**: 1920×1080, 30 fps, 117.1 s, H.264 with AAC stereo audio,
102 MB. The MP4 is gitignored, so upload it separately. Source and provenance are in `video/README.md`.

- **Real captures.** Every app screen is a real capture of the production build running the synthetic
  sample paper, including the answer shown in the voice scene. That answer is the app's real reply to
  the exact dictated question.
- **Drawn or synthetic.** The cursor, file icon, browser frame, download indicator, motion graphics,
  and the voice-input illustration are drawn. Narration is a local synthetic voice (Kokoro,
  Apache-2.0). The music and sound effects are generated in code.
- **No real Wispr footage.** The blog's "short clip of Flow in use" is still yours to record: about 10
  seconds of you dictating into ClaimCheck's question field with Flow, which can be a separate upload
  or appended. Live alternative: `DEMO.md` (two-minute script using the same sample paper).

## 5. What has actually been tested

- **Synthetic regression corpus:** 13 generated fixtures with known answers, 52/52 on every measure.
  It is built around the engine's checks and is not a real-world accuracy figure.
- **Synthetic sample paper:** `samples/claimcheck-demo-paper.pdf`. Full workflow verified on the
  production build after the privacy cleanup: 9 findings, Markdown, JSON, and UI all served.
- **Generated layout fixtures** in the tests (two-column, compact table, stated-change), with invented
  content.
- **One private, unpublished manuscript** was audited locally during development. Nothing from it is
  in the repository, and it was not labelled, so it supports no accuracy claim.
- **Real-paper benchmark:** incomplete. Ten openly licensed candidates are listed, but none are
  downloaded or human-labelled, so no real-paper metrics exist.
- **Checks passed:** typecheck, production build, 104 automated tests (103 pass; 1 optional
  private-PDF test is skipped unless `CLAIMCHECK_REGRESSION_PDF` is set, and it passes locally when
  set), and the synthetic evaluation.

## 6. Verified capabilities and limitations

**Capabilities:**

- PDF upload by picker or drag-and-drop, with validation (type, 25 MB, 150 pages, selectable text).
- Layout-aware extraction: two-column order, compact tables, captions, and headings.
- Five finding categories, each with quote, page, section, and checks:
  - table-cell tracing (never on a number alone);
  - stated-change arithmetic;
  - symbol-bound values;
  - missing table and figure references.
- "View in document" evidence highlighting.
- Q&A built only from the audit record.
- Reviewer workspace (in the browser).
- Markdown and JSON reports, a report archive, and deletion.

**Limitations:**

- Not a truth detector.
- No real-world accuracy figure.
- No authentication and no encryption at rest.
- Text PDFs only.
- Citations, code, and data are not checked.
- Reviewer notes stay in the browser.
- The Wispr API path is off and unverified.

## 7. Run it locally

Requirements: Node.js 22.5 or newer, and npm.

```bash
npm ci
npm run build
npm run start
```

Open http://127.0.0.1:8787, then click **Run sample audit** or upload
`samples/claimcheck-demo-paper.pdf`. Tests: `npm run test:unit` and `npm test`.

## 8. Publish the repository (clean history)

The local `master` branch still contains the unpublished manuscript in **older commits**: test
fixtures, values, and a local path, all removed from current files but recoverable from history.
**Do not push `master`.**

Branch `publish` has a single commit with no parents. It contains only the cleaned tree, so pushing it
transfers none of the old history.

1. Create an empty **public** repository on GitHub with no README or licence, for example
   `claimcheck-ai`.
2. Optionally set the author for that one commit first (the default is
   `ClaimCheck checkpoint <idkskemcursor@gmail.com>`, which becomes public). To change it:
   ```bash
   git checkout publish
   ```
   ```bash
   git commit --amend --reset-author --no-edit
   ```
   This uses your configured `user.name` and `user.email`. A GitHub no-reply address keeps your email
   private.
3. Push only that branch, as `main`:
   ```bash
   git remote add origin https://github.com/<you>/claimcheck-ai.git
   ```
   ```bash
   git push -u origin publish:main
   ```
4. Check on GitHub that there is exactly one commit, and that searching the repository for
   the unpublished manuscript's title finds nothing.

Never push `master` or any other branch to that remote.

## 9. Optional free deployment (Render), not yet deployed

Not required: the repository link plus the video meets "a link to your working project". Deploy only
if you accept the risks below.

| Render setting | Value |
| --- | --- |
| Service | Web Service connected to the GitHub repo, runtime Node, instance type Free |
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm run start` |
| Environment | `HOST=0.0.0.0`, `NODE_VERSION=22` (Render supplies `PORT`) |

Risks, per Render's free-tier terms (confirm them in the dashboard):

- **Storage is wiped.** Reports are lost on every restart or redeploy.
- **Cold starts.** The service sleeps after about 15 minutes idle, and the first request can take up to
  a minute.
- **No authentication.** Anyone with the URL can upload papers and see or delete every report. Tell
  judges to use **Run sample audit**.

Verified locally: a production build bound to `0.0.0.0` served the UI and API and completed the
sample workflow. **Not verified:** a live Render URL. Only list it as working after you open it and
run the sample audit there.

## 10. Wispr Insights usage-card screenshot

1. Open the Wispr Flow desktop app with the account registered for the challenge.
2. Go to **Insights**, then **Your usage**.
3. Screenshot the usage card for the challenge period (16–31 October) without editing it.
4. Use those numbers, unchanged, in your written description. Do not round up or estimate.

## 11. Final checklist

- [ ] **[YOU]** Watch `submission/claimcheck_explainer.mp4` once end to end (117.1 s).
- [ ] **[YOU]** Record about 10 s of real Wispr Flow dictation into ClaimCheck's question field.
- [ ] **[YOU]** Upload the video (or videos) unlisted, for example on YouTube. Check the link while
      signed out.
- [ ] **[YOU]** Create the public repo and push **only** `publish` as `main` (section 8). Confirm it has
      one commit.
- [ ] **[YOU]** Optional: deploy on Render (section 9). Call it live only after the sample audit works
      at the URL.
- [ ] **[YOU]** Take the Insights usage-card screenshot (section 10).
- [ ] **[YOU]** Fill the [YOU] lines in sections 2–3 and paste the "few lines".
- [ ] **[YOU]** Submit at wemakedevs.org/wispr/submit before 30 October, 11:59 pm IST.
