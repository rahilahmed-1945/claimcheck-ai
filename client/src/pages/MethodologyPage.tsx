import { Link } from "react-router-dom";
import { ENGINE_VERSION } from "@shared/types";
import { Icon, type IconName } from "../components/Icon";
import { CATEGORY_META, CATEGORY_ORDER, CONFIDENCE_META } from "../lib/categories";

const PIPELINE = [
  {
    step: "01",
    title: "Validate",
    body: "Check the PDF signature, size, page count, and whether a usable text layer exists. Rejected files produce no findings.",
  },
  {
    step: "02",
    title: "Extract",
    body: "Read selectable text and layout positions page by page with pdfjs. The original PDF is never written to disk.",
  },
  {
    step: "03",
    title: "Structure",
    body: "Detect headings and standard sections, reflow wrapped lines, and reconstruct simple table rows and captions from positions.",
  },
  {
    step: "04",
    title: "Select claims",
    body: "Use deterministic cues to pick up to 40 auditable statements: labelled metrics, comparisons, significance language, scope language.",
  },
  {
    step: "05",
    title: "Retrieve evidence",
    body: "Search other passages and reconstructed table rows for matching metric values, numbers, and lexical context. Apply dataset/split guards.",
  },
  {
    step: "06",
    title: "Classify",
    body: "Apply explicit precedence rules and attach only traceable quotes, page locations, checks, and interpretation limits to each finding.",
  },
];

const CHECKS: { name: string; does: string; cannot: string }[] = [
  {
    name: "Repeated numeric claims",
    does: "Compares labelled metric values across sections, normalizing percentages and fractions and allowing a small rounding tolerance.",
    cannot: "Verify the experiment or compare unlabelled numbers, counts, times, or dates.",
  },
  {
    name: "Claim versus table",
    does: "Reconstructs simple table rows from text positions, checks the extraction is internally consistent, and compares same-metric values for the paper’s own method.",
    cannot: "Reliably parse complex, merged-cell, borderless, or multi-page tables. Column alignment can be wrong.",
  },
  {
    name: "Significance language",
    does: "When a claim asserts statistical significance, checks the extracted document for a p-value, confidence interval, named test, or effect size.",
    cannot: "Recompute statistics or prove a non-significant result. Absence in the text is not disproof.",
  },
  {
    name: "Claim scope",
    does: "Weighs universal or broad-generalization wording against the baselines and datasets actually located in the paper.",
    cannot: "Establish external generalizability or know whether comparisons exist outside the document.",
  },
  {
    name: "Reference traceability",
    does: "Checks references such as “Table 4” against the table and figure captions that were actually extracted.",
    cannot: "See content whose caption was not extractable. A missing caption is reported as missing, not inferred.",
  },
  {
    name: "Evidence retrieval",
    does: "Scores candidate passages by shared metric labels, shared values, and lexical overlap, then retains a small set with exact quotes.",
    cannot: "Understand paraphrase or entailment. A retrieved passage is context, not automatic proof.",
  },
];

const NOT_IMPLEMENTED = [
  "OCR for scanned or image-only PDFs. These documents are rejected instead of being audited from guesses.",
  "External citation and literature verification. No source outside the uploaded PDF is fetched.",
  "Semantic entailment or language-model reasoning. No paid AI API is used.",
  "Verification against code, raw data, supplementary files, or replication material.",
  "Complex table and figure-content parsing, including multi-page tables.",
  "Consistency checks for counts, sample sizes, dates, training times, and unlabelled values.",
  "Accounts, per-user isolation, encryption at rest, automatic retention, or audit logs.",
  "Public hosting, authentication, rate limiting, and production hardening.",
  "PDF annotation export or in-place markup of the original paper.",
  "Cross-document comparison or checking multiple versions of a manuscript.",
];

const NAV = [
  { id: "pipeline", label: "How an audit runs" },
  { id: "classifications", label: "Five classifications" },
  { id: "checks", label: "Checks implemented" },
  { id: "evidence", label: "Evidence rules" },
  { id: "confidence", label: "Confidence" },
  { id: "data", label: "Data handling" },
  { id: "not-implemented", label: "Not implemented" },
  { id: "technical", label: "Technical basis" },
];

const DATA_CARDS: { icon: IconName; title: string; body: string; tone?: "warning" }[] = [
  {
    icon: "file",
    title: "The original PDF",
    body: "Validated and processed in server memory. The uploaded PDF is not written to disk and is released after extraction.",
  },
  {
    icon: "database",
    title: "What is stored",
    body: "Only the audit is stored: findings (with the short claim and evidence excerpts they quote), summaries, limitations, timings, and aggregate counts. The full text, page text, section headings, tables, captions, and a file hash are not stored.",
  },
  {
    icon: "lock",
    title: "No external transmission",
    body: "The application makes no outbound AI or document-processing calls. Fonts and assets are served locally. The server does not log paper text.",
  },
  {
    icon: "alert",
    title: "Security limits",
    body: "The SQLite file is not encrypted at rest and there is no retention automation. The report list and report pages are public. Deleting reports requires the server's admin token when one is set; otherwise anyone who can reach the server can delete them.",
    tone: "warning",
  },
];

export function MethodologyPage() {
  return (
    <div className="page method-page">
      <header className="page-header method-header">
        <span className="eyebrow">
          <span className="eyebrow-dot" aria-hidden="true" />
          Method & limits
        </span>
        <h1>How ClaimCheck reads a paper.</h1>
        <p className="lede">
          ClaimCheck AI is an evidence-first auditing workbench, not a chatbot. It uses deterministic
          extraction and comparison rules on one uploaded document. It never generates a quotation,
          citation, or page location that is not traceable to the extracted text.
        </p>
        <div className="method-header-meta">
          <span className="subtle-tag">
            <Icon name="flask" size={13} /> Engine {ENGINE_VERSION}
          </span>
          <span className="subtle-tag">
            <Icon name="shield" size={13} /> No language model
          </span>
          <span className="subtle-tag">
            <Icon name="lock" size={13} /> Single-document scope
          </span>
        </div>
      </header>

      <div className="method-layout">
        <aside className="method-nav" aria-label="On this page">
          <span className="rail-label">On this page</span>
          {NAV.map((item) => (
            <a href={`#${item.id}`} key={item.id}>
              {item.label}
            </a>
          ))}
          <Link to="/" className="button button-primary button-sm method-cta">
            <Icon name="upload" size={14} /> Start an audit
          </Link>
        </aside>

        <div className="method-content">
          <section className="method-section" id="pipeline">
            <div className="method-section-head">
              <span className="section-number">01</span>
              <div>
                <h2>How an audit runs</h2>
                <p>
                  The pipeline is deterministic. Each stage either succeeds or produces a clear
                  failure; documents that cannot be extracted reliably do not receive a report.
                </p>
              </div>
            </div>
            <ol className="pipeline-list">
              {PIPELINE.map((item) => (
                <li key={item.step}>
                  <span className="pipeline-step">{item.step}</span>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="method-section" id="classifications">
            <div className="method-section-head">
              <span className="section-number">02</span>
              <div>
                <h2>The five classifications</h2>
                <p>
                  Every finding gets exactly one category. The category describes the relationship
                  between the claim and the evidence located in this paper.
                </p>
              </div>
            </div>
            <div className="method-categories">
              {CATEGORY_ORDER.map((category) => {
                const meta = CATEGORY_META[category];
                return (
                  <article className={`method-category ${meta.className}`} key={category}>
                    <div className="method-category-head">
                      <span className="badge-dot" aria-hidden="true" />
                      <h3>{meta.label}</h3>
                    </div>
                    <p>{meta.definition}</p>
                  </article>
                );
              })}
            </div>
            <div className="notice notice-quiet">
              <Icon name="info" size={16} />
              <p>
                “Supported” means the paper internally reports the same value or directly relevant
                evidence; it does not establish that the experiment is valid. “Potentially
                unsupported” means evidence was not located; it does not establish that the claim is
                false. No category is a finding of misconduct.
              </p>
            </div>
          </section>

          <section className="method-section" id="checks">
            <div className="method-section-head">
              <span className="section-number">03</span>
              <div>
                <h2>Checks implemented in phase one</h2>
                <p>Only these checks run. The interface does not show controls for unimplemented verification.</p>
              </div>
            </div>
            <div className="check-matrix">
              <div className="check-matrix-head">
                <span>Check</span>
                <span>What it does</span>
                <span>What it cannot establish</span>
              </div>
              {CHECKS.map((check) => (
                <div className="check-matrix-row" key={check.name}>
                  <strong>{check.name}</strong>
                  <p>{check.does}</p>
                  <p className="cannot">{check.cannot}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="method-section" id="evidence">
            <div className="method-section-head">
              <span className="section-number">04</span>
              <div>
                <h2>Evidence rules</h2>
                <p>These constraints determine what can appear in a finding.</p>
              </div>
            </div>
            <ul className="rule-list">
              <li>
                <strong>Only extracted text is quoted.</strong> Paragraph whitespace is normalized,
                and table-row quotes come from extracted lines. Nothing is paraphrased into a quote
                or attributed to a page that was not read.
              </li>
              <li>
                <strong>Numbers are compared in context.</strong> Only labelled metrics are compared,
                differences within rounding tolerance are ignored, and passages naming different
                datasets or evaluation splits are not treated as direct contradictions.
              </li>
              <li>
                <strong>Citations are not proof.</strong> A citation does not make a claim supported;
                a missing citation does not make it false. External sources are outside this audit.
              </li>
              <li>
                <strong>Absence is reported as absence.</strong> When no evidence is located, the
                finding says so, names the search scope, and prefers “potentially unsupported” or
                “needs review” over an unjustified conclusion.
              </li>
              <li>
                <strong>Order matters.</strong> A comparable numeric conflict takes precedence. Then
                missing referenced objects, statistical gaps, scope gaps, partial or full numeric
                support, and finally ambiguity or qualitative statements.
              </li>
              <li>
                <strong>Every check records an outcome.</strong> Findings show which checks ran and
                whether each passed, was flagged, was inconclusive, or did not apply.
              </li>
            </ul>
          </section>

          <section className="method-section" id="confidence">
            <div className="method-section-head">
              <span className="section-number">05</span>
              <div>
                <h2>What confidence means</h2>
                <p>
                  Confidence describes the strength of the evidence relationship, not the truth of
                  the claim.
                </p>
              </div>
            </div>
            <div className="confidence-grid">
              {(["high", "moderate", "low"] as const).map((level) => (
                <article className={`confidence-card confidence-${level}`} key={level}>
                  <span className={`confidence confidence-${level}`}>
                    <span className="confidence-dots" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    {CONFIDENCE_META[level].label}
                  </span>
                  <p>{CONFIDENCE_META[level].detail}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="method-section" id="data">
            <div className="method-section-head">
              <span className="section-number">06</span>
              <div>
                <h2>Data handling and privacy</h2>
                <p>
                  The destination of every document is stated here. These are implemented behaviors,
                  not policy claims.
                </p>
              </div>
            </div>
            <div className="data-grid">
              {DATA_CARDS.map((card) => (
                <article className={`data-card${card.tone === "warning" ? " data-card-warning" : ""}`} key={card.title}>
                  <span className="data-icon">
                    <Icon name={card.icon} size={18} />
                  </span>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="method-section" id="not-implemented">
            <div className="method-section-head">
              <span className="section-number">07</span>
              <div>
                <h2>Not implemented in phase one</h2>
                <p>
                  These capabilities are deliberately absent. No visible button claims to provide
                  them.
                </p>
              </div>
            </div>
            <ul className="not-implemented-list">
              {NOT_IMPLEMENTED.map((item) => (
                <li key={item}>
                  <Icon name="x" size={14} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="method-section" id="technical">
            <div className="method-section-head">
              <span className="section-number">08</span>
              <div>
                <h2>Technical basis and running limits</h2>
                <p>
                  The current build is a local full-stack application. It is not publicly deployed.
                </p>
              </div>
            </div>
            <div className="technical-grid">
              <div>
                <span className="detail-label">Stack</span>
                <ul className="plain-list">
                  <li>React 19 + Vite client, Express 5 API on Node 22</li>
                  <li>pdfjs-dist for selectable PDF text and layout positions</li>
                  <li>node:sqlite for local report persistence</li>
                  <li>Deterministic TypeScript audit engine, no paid API</li>
                </ul>
              </div>
              <div>
                <span className="detail-label">Limits</span>
                <ul className="plain-list">
                  <li>25 MB per PDF, up to 150 pages, 90-second processing timeout</li>
                  <li>Up to 40 highest-priority claim candidates per audit</li>
                  <li>One document per audit; no cross-paper comparison</li>
                  <li>Selectable-text PDFs only; scanned documents are rejected</li>
                </ul>
              </div>
            </div>
            <div className="notice notice-warning">
              <Icon name="alert" size={16} />
              <p>
                <strong>Deployment status:</strong> the Node server binds to 127.0.0.1 and has no
                authentication. It should not be exposed publicly as-is. A public deployment needs a
                Node-capable host with a persistent disk for SQLite and uploaded audit data, plus
                authentication and hardening. Static-only or Workers hosting would require porting
                the PDF extraction pipeline and storage layer.
              </p>
            </div>
            <p className="method-signoff">
              ClaimCheck AI · Engine {ENGINE_VERSION} · Phase one foundation. The classifications are
              evidence relationships for revision, not verdicts on research integrity.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
