import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AuditErrorPayload, EvaluationSummary } from "@shared/types";
import { ApiError, fetchEvaluation } from "../lib/api";
import { CATEGORY_META, CATEGORY_ORDER } from "../lib/categories";
import { ErrorPanel } from "../components/ErrorPanel";
import { Icon } from "../components/Icon";

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function recordedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "good" | "warning";
}) {
  return (
    <article className={`eval-metric eval-metric-${tone}`}>
      <span className="eval-metric-label">{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

export function EvaluationPage() {
  const [data, setData] = useState<EvaluationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AuditErrorPayload | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchEvaluation(controller.signal)
      .then((summary) => {
        setData(summary);
        setError(null);
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(
          caught instanceof ApiError
            ? caught.payload
            : {
                code: "EVALUATION_UNAVAILABLE",
                title: "The measured corpus could not be loaded",
                message: "The server did not return an evaluation summary.",
                recovery: ["Run `npm run test:publish` from the project root.", "Reload the page."],
              },
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [nonce]);

  return (
    <div className="page eval-page">
      <div className="workspace-topline">
        <span className="eyebrow">
          <span className="eyebrow-dot" aria-hidden="true" />
          Measured corpus
        </span>
        <Link to="/methodology" className="text-link">
          Read the method <Icon name="arrowRight" size={14} />
        </Link>
      </div>

      <header className="page-header eval-header">
        <span className="card-kicker">Evaluation</span>
        <h1>
          Measured on a known corpus.
          <em>Not asserted in a demo.</em>
        </h1>
        <p className="lede">
          ClaimCheck runs the real extractor and audit engine against a labeled synthetic corpus on
          every test run. The numbers below come from that run. They are a regression signal for this
          deterministic engine, not a claim about performance on the scientific literature.
        </p>
        {data && (
          <div className="eval-record">
            <span>
              <Icon name="flask" size={14} /> Engine {data.engineVersion}
            </span>
            <span>
              <Icon name="layers" size={14} /> Corpus {data.corpusVersion}
            </span>
            <span>
              <Icon name="clock" size={14} /> Recorded {recordedAt(data.generatedAt)}
            </span>
          </div>
        )}
      </header>

      {loading && (
        <div className="eval-loading" aria-busy="true">
          <div className="eval-metrics">
            {[0, 1, 2, 3].map((index) => (
              <div className="eval-metric" key={index}>
                <span className="skeleton skeleton-line" />
                <span className="skeleton skeleton-line skeleton-lg" />
                <span className="skeleton skeleton-line" />
              </div>
            ))}
          </div>
          <div className="card eval-table-card">
            <span className="skeleton skeleton-line" />
            <span className="skeleton skeleton-line" />
            <span className="skeleton skeleton-line" />
          </div>
        </div>
      )}

      {!loading && error && (
        <ErrorPanel
          error={error}
          actions={
            <button
              type="button"
              className="button button-secondary button-sm"
              onClick={() => setNonce((value) => value + 1)}
            >
              <Icon name="refresh" size={14} /> Try again
            </button>
          }
        />
      )}

      {!loading && !error && data && (
        <>
          <section className="eval-metrics" aria-label="Evaluation summary">
            <MetricCard
              label="Exact classifications"
              value={`${data.totals.exactCategoryMatches}/${data.totals.expectedFindings}`}
              detail={`${formatPercent(data.totals.exactCategoryAccuracy)} of annotated findings matched their expected category.`}
              tone="good"
            />
            <MetricCard
              label="Claim recall"
              value={`${data.totals.matchedFindings}/${data.totals.expectedFindings}`}
              detail={`${formatPercent(data.totals.claimSelectionRecall)} of the ground-truth claims were selected and matched.`}
              tone="good"
            />
            <MetricCard
              label="Evidence trace failures"
              value={String(data.totals.evidenceTraceFailures)}
              detail="Every retained quotation and offset was checked against the extracted document."
              tone={data.totals.evidenceTraceFailures === 0 ? "good" : "warning"}
            />
            <MetricCard
              label="Unannotated findings"
              value={String(data.totals.unexpectedFindings)}
              detail="A finding not represented in the ground truth fails the run instead of being counted as a success."
              tone={data.totals.unexpectedFindings === 0 ? "good" : "warning"}
            />
          </section>

          <div className="notice notice-quiet eval-caveat">
            <Icon name="info" size={16} />
            <p>
              This corpus is intentionally built around implemented checks and known negative
              controls. A perfect score here means the engine is consistent with its regression
              contract. It does <strong>not</strong> prove semantic entailment, external citation
              validity, or accuracy on arbitrary real papers.
            </p>
          </div>

          <section className="eval-grid">
            <div className="card eval-table-card">
              <div className="eval-section-head">
                <div>
                  <span className="card-kicker">Classification</span>
                  <h2>Per-category quality</h2>
                </div>
                <span className="subtle-tag">
                  <Icon name="scale" size={13} /> Strict matching
                </span>
              </div>
              <div className="eval-category-table" role="table" aria-label="Per-category metrics">
                <div className="eval-category-row eval-category-head" role="row">
                  <span role="columnheader">Classification</span>
                  <span role="columnheader">Truth</span>
                  <span role="columnheader">Predicted</span>
                  <span role="columnheader">Precision</span>
                  <span role="columnheader">Recall</span>
                  <span role="columnheader">F1</span>
                </div>
                {CATEGORY_ORDER.map((category) => {
                  const meta = CATEGORY_META[category];
                  const metric = data.perCategory[category];
                  return (
                    <div className={`eval-category-row ${meta.className}`} role="row" key={category}>
                      <span className="eval-category-name" role="cell">
                        <span className="badge-dot" aria-hidden="true" />
                        {meta.label}
                      </span>
                      <span role="cell" className="mono">
                        {metric.expected}
                      </span>
                      <span role="cell" className="mono">
                        {metric.predicted}
                      </span>
                      <span role="cell" className="mono">
                        {formatPercent(metric.precision)}
                      </span>
                      <span role="cell" className="mono">
                        {formatPercent(metric.recall)}
                      </span>
                      <span role="cell" className="mono">
                        {formatPercent(metric.f1)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="eval-table-note">
                Precision is strict: a finding with the wrong category counts as a false positive.
                A miss also counts as a false negative. Runtime:{" "}
                {data.totals.runtimeMs < 1000
                  ? `${data.totals.runtimeMs} ms`
                  : `${(data.totals.runtimeMs / 1000).toFixed(1)} s`}
                .
              </p>
            </div>

            <aside className="card eval-method-card">
              <span className="card-kicker">How to reproduce</span>
              <h2>One command. The real pipeline.</h2>
              <p>
                The suite generates labeled PDFs, runs the production extractor and audit engine, and
                fails on an unexpected claim, a wrong category, an untraceable quote, or a broken
                report.
              </p>
              <pre className="eval-command">
                <code>npm test</code>
              </pre>
              <p className="eval-method-note">
                Publish a new summary for this page with <code>npm run test:publish</code>.
              </p>
              <div className="eval-method-links">
                <Link to="/methodology" className="text-link">
                  Read the checks <Icon name="arrowRight" size={13} />
                </Link>
                <Link to="/" className="text-link">
                  Start an audit <Icon name="arrowRight" size={13} />
                </Link>
              </div>
            </aside>
          </section>

          <section className="card eval-table-card eval-cases-card">
            <div className="eval-section-head">
              <div>
                <span className="card-kicker">Fixtures</span>
                <h2>What the corpus covers</h2>
              </div>
              <span className="subtle-tag">
                <Icon name="fileCheck" size={13} /> {data.totals.cases} fixtures
              </span>
            </div>
            <div className="eval-cases" role="table" aria-label="Evaluation fixtures">
              <div className="eval-case-row eval-case-head" role="row">
                <span role="columnheader">Fixture</span>
                <span role="columnheader">Document</span>
                <span role="columnheader">Findings</span>
                <span role="columnheader">Exact</span>
                <span role="columnheader">Unexpected</span>
                <span role="columnheader">Trace failures</span>
              </div>
              {data.cases.map((testCase) => (
                <div className="eval-case-row" role="row" key={testCase.id}>
                  <span className="eval-case-name" role="cell">
                    <strong>{testCase.title}</strong>
                    <span>{testCase.purpose}</span>
                  </span>
                  <span role="cell" className="mono eval-case-doc">
                    {testCase.pages}p · {(testCase.words / 1000).toFixed(1)}k words
                    {testCase.tables > 0 ? ` · ${testCase.reliableTables}/${testCase.tables} tables` : ""}
                  </span>
                  <span role="cell" className="mono">
                    {testCase.findings}
                  </span>
                  <span role="cell" className="mono">
                    {testCase.correctCategories}/{testCase.expectedFindings}
                  </span>
                  <span role="cell" className="mono">
                    {testCase.findingsWithoutExpectation}
                  </span>
                  <span role="cell" className="mono">
                    {testCase.evidenceTraceFailures}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="eval-limit-band">
            <div>
              <span className="card-kicker">The honest boundary</span>
              <h2>A regression benchmark is not a validation study.</h2>
              <p>
                An independently annotated set of real papers is still required before publishing
                precision or recall claims to researchers. The synthetic corpus cannot measure
                paraphrased support, complex table layouts, external literature, or domain drift.
              </p>
            </div>
            <Link to="/methodology" className="button button-secondary">
              <Icon name="book" size={15} /> Read the limits
            </Link>
          </section>
        </>
      )}
    </div>
  );
}
