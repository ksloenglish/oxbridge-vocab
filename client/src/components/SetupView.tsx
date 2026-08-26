/** Oxbridge Ledger: asymmetric editorial setup folio with large touch targets and dynamic availability. */
// Oxbridge Ledger setup: portrait scholarship art on wide folios, established landscape crop on compact screens.
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Play, RotateCcw } from "lucide-react";
import { BrandLockup } from "@/components/BrandLockup";
import { APP_VERSION } from "@/lib/appVersion";
import { getRangeLabel, normaliseSegmentMode } from "@/lib/exercise";
import type { ReleaseCatalogue, SegmentMode } from "@/types";

const QUESTION_COUNTS = [10, 20, 30, 40, 50, 100];
const desktopHeroArt = "/oxbridge-vocab/assets/oxbridge-scholarship-hero.webp";
const compactHeroArt = "/oxbridge-vocab/assets/oxbridge-ledger-hero.png";

interface SetupViewProps {
  catalogue: ReleaseCatalogue;
  hasSavedExercise: boolean;
  savedSummary?: string;
  busy: boolean;
  errorMessage: string | null;
  onResume: () => void;
  onStart: (collectionId: string, mode: SegmentMode, count: number) => void;
}

export function SetupView({
  catalogue,
  hasSavedExercise,
  savedSummary,
  busy,
  errorMessage,
  onResume,
  onStart,
}: SetupViewProps) {
  const [collectionId, setCollectionId] = useState(catalogue.collections[0].id);
  const collection =
    catalogue.collections.find((item) => item.id === collectionId) ??
    catalogue.collections[0];
  const [mode, setMode] = useState<SegmentMode>(collection.segments[0].id);
  const [count, setCount] = useState(10);
  const effectiveMode = normaliseSegmentMode(collection, mode);

  useEffect(() => {
    if (effectiveMode !== mode) setMode(effectiveMode);
  }, [effectiveMode, mode]);

  const maximum = useMemo(() => {
    if (effectiveMode === "full") {
      return Math.min(...collection.segments.map((item) => item.availableCount)) * 2;
    }
    return (
      collection.segments.find((item) => item.id === effectiveMode)?.availableCount ?? 0
    );
  }, [collection, effectiveMode]);

  useEffect(() => {
    if (count > maximum) {
      setCount([...QUESTION_COUNTS].reverse().find((item) => item <= maximum) ?? 10);
    }
  }, [count, maximum]);

  const combinedAvailable = collection.segments.reduce(
    (total, segment) => total + segment.availableCount,
    0,
  );
  const formattedQuestionTotal = new Intl.NumberFormat("en-GB").format(
    catalogue.releasedQuestionCount,
  );
  const selectionLabel =
    effectiveMode === "full"
      ? "Full list"
      : collection.segments.find((item) => item.id === effectiveMode)?.label ??
        collection.segments[0].label;

  return (
    <main className="setup-page">
      <section className="setup-shell" aria-labelledby="setup-title">
        <aside className="brand-panel">
          <BrandLockup />
          <div className="brand-panel__message">
            <p className="eyebrow">ESSENTIAL ENGLISH VOCABULARY</p>
            <h1 id="setup-title">Learn the words that matter most.</h1>
            <p className="brand-panel__description">
              Practise the Oxford 3000, Oxford 5000, and C2 Proficiency word lists
              through precise sentence-completion challenges.
            </p>
            <div className="brand-panel__catalogue-total" aria-label={`${formattedQuestionTotal} questions available`}>
              <span>Current question bank</span>
              <strong>{formattedQuestionTotal}</strong>
              <small>questions available</small>
            </div>
          </div>
          <picture aria-hidden="true">
            <source media="(max-width: 820px)" srcSet={compactHeroArt} />
            <img className="brand-panel__art" src={desktopHeroArt} alt="" />
          </picture>
        </aside>

        <section className="setup-folio">
          {hasSavedExercise && (
            <div className="resume-banner">
              <div>
                <span className="folio-kicker">Unfinished exercise</span>
                <strong>{savedSummary}</strong>
              </div>
              <button className="button button--resume" type="button" onClick={onResume}>
                <RotateCcw size={18} aria-hidden="true" />
                Resume exercise
              </button>
            </div>
          )}

          {errorMessage && (
            <div className="error-banner" role="alert">
              <strong>Question bank unavailable.</strong>
              <span>{errorMessage}</span>
            </div>
          )}

          <fieldset className="folio-section">
            <legend>
              <span>01</span>
              Vocabulary collection
            </legend>
            <div className="collection-grid">
              {catalogue.collections.map((item) => (
                <label
                  className={`collection-card${item.id === collectionId ? " is-selected" : ""}`}
                  key={item.id}
                >
                  <input
                    type="radio"
                    name="collection"
                    value={item.id}
                    checked={item.id === collectionId}
                    onChange={() => {
                      setCollectionId(item.id);
                      setMode((current) =>
                        current === "full" ? "full" : item.segments[0].id,
                      );
                    }}
                  />
                  <span className="collection-card__level">{item.cefrLevel}</span>
                  <strong>{item.label.replace(` ${item.cefrLevel}`, "")}</strong>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="folio-section">
            <legend>
              <span>02</span>
              Word range
            </legend>
            <div className="segment-grid">
              {collection.segments.map((segment) => (
                <label
                  className={`segment-card${effectiveMode === segment.id ? " is-selected" : ""}`}
                  key={segment.id}
                >
                  <input
                    type="radio"
                    name="segment"
                    value={segment.id}
                    checked={effectiveMode === segment.id}
                    onChange={() => setMode(segment.id)}
                  />
                  <strong>{segment.label}</strong>
                  <span>
                    {segment.rangeStart}–{segment.rangeEnd} · {segment.firstHeadword} – {segment.lastHeadword}
                  </span>
                  <small className="range-count">{segment.availableCount} questions available</small>
                </label>
              ))}
              <label className={`segment-card${effectiveMode === "full" ? " is-selected" : ""}`}>
                <input
                  type="radio"
                  name="segment"
                  value="full"
                  checked={effectiveMode === "full"}
                  onChange={() => setMode("full")}
                />
                <strong>Full list</strong>
                <span>
                  {collection.segments[0].rangeStart}–{collection.segments[1].rangeEnd} · both halves
                </span>
                <small className="range-count">{combinedAvailable} questions available</small>
              </label>
            </div>
          </fieldset>

          <fieldset className="folio-section folio-section--count">
            <legend>
              <span>03</span>
              Number of questions
            </legend>
            <div className="count-row">
              {QUESTION_COUNTS.map((value) => (
                <label
                  className={`count-chip${count === value ? " is-selected" : ""}${
                    value > maximum ? " is-disabled" : ""
                  }`}
                  key={value}
                >
                  <input
                    type="radio"
                    name="count"
                    value={value}
                    checked={count === value}
                    disabled={value > maximum}
                    onChange={() => setCount(value)}
                  />
                  {value}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="selection-summary">
            <div className="summary-badge" aria-label={`CEFR level ${collection.cefrLevel}`}>
              {collection.cefrLevel}
            </div>
            <div>
              <span>Current selection</span>
              <strong>
                {collection.label} · {selectionLabel}
              </strong>
              <small>{getRangeLabel(collection, effectiveMode)}</small>
            </div>
            <div className="summary-count">
              <strong>{count}</strong>
              <span>questions</span>
            </div>
          </div>

          <button
            className="button button--primary button--start"
            type="button"
            disabled={busy || Boolean(errorMessage)}
            onClick={() => onStart(collection.id, effectiveMode, count)}
          >
            <span>
              <Play size={19} fill="currentColor" aria-hidden="true" />
              {busy ? "Preparing exercise…" : "Start exercise"}
            </span>
            <ArrowRight size={21} aria-hidden="true" />
          </button>
        </section>
      </section>

      <footer className="site-footer">
        <span>Version {APP_VERSION}</span>
        <span>© {new Date().getFullYear()} K S Lo English. All Rights Reserved.</span>
      </footer>
    </main>
  );
}
