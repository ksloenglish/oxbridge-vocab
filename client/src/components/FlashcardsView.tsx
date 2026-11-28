/** Oxbridge Ledger: browser-only revision folio — one released word per card, no scoring. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import { BrandLockup } from "@/components/BrandLockup";
import { APP_VERSION } from "@/lib/appVersion";
import { loadSegment } from "@/lib/data";
import { getRangeLabel } from "@/lib/exercise";
import {
  buildExampleSentence,
  getCardSourceLabel,
  getRevisionSegments,
  readRevisionPosition,
  revisionPositionKey,
  writeRevisionPosition,
} from "@/lib/flashcards";
import type {
  CollectionCatalogueItem,
  ReleaseCatalogue,
  ReleaseQuestion,
  SegmentMode,
} from "@/types";

interface FlashcardsViewProps {
  catalogue: ReleaseCatalogue;
  collection: CollectionCatalogueItem;
  mode: SegmentMode;
  onBack: () => void;
  onExercise: () => void;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; cards: ReleaseQuestion[] };

const SWIPE_DISTANCE = 48;

export function FlashcardsView({
  catalogue,
  collection,
  mode,
  onBack,
  onExercise,
}: FlashcardsViewProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [index, setIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const positionKey = revisionPositionKey(
    catalogue.releaseVersion,
    collection.id,
    mode
  );
  const swipeStart = useRef<{ x: number; y: number; id: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    Promise.all(
      getRevisionSegments(collection, mode).map(segment =>
        loadSegment(segment.dataFile, catalogue.releaseVersion)
      )
    )
      .then(loaded => {
        if (cancelled) return;
        const cards = loaded.flatMap(segment => segment.questions);
        if (cards.length === 0) throw new Error("This range has no words yet.");
        setIndex(readRevisionPosition(positionKey, cards.length));
        setState({ status: "ready", cards });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "The flash cards could not be loaded.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [catalogue.releaseVersion, collection, mode, positionKey, attempt]);

  const total = state.status === "ready" ? state.cards.length : 0;

  const goTo = useCallback(
    (next: number) => {
      if (total === 0) return;
      const bounded = Math.min(Math.max(next, 0), total - 1);
      setIndex(bounded);
      writeRevisionPosition(positionKey, bounded);
    },
    [positionKey, total]
  );

  useEffect(() => {
    if (total === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) {
        return;
      }
      // Never move the card behind an open confirmation or dialog.
      if (document.querySelector("[aria-modal='true'], dialog[open]")) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goTo(index + 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goTo(index - 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goTo, index, total]);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse") return;
    swipeStart.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    goTo(dx < 0 ? index + 1 : index - 1);
  };

  const sourceLabel = getCardSourceLabel(collection);
  const selectionLabel =
    mode === "full"
      ? "Full list"
      : (collection.segments.find(item => item.id === mode)?.label ??
        collection.segments[0].label);
  const card = state.status === "ready" ? state.cards[index] : null;
  const isLast = total > 0 && index === total - 1;

  return (
    <main className="flashcards-page">
      <header className="high-scores-header flashcards-header">
        <BrandLockup compact />
        <button
          className="button high-scores-back"
          type="button"
          onClick={onBack}
        >
          <ArrowLeft size={17} aria-hidden="true" />
          Back to Home
        </button>
      </header>

      <section className="flashcards-folio" aria-labelledby="flashcards-title">
        <div className="flashcards-intro">
          <div className="flashcards-intro__copy">
            <p className="flashcards-kicker">Revision · flash cards</p>
            <h1 id="flashcards-title">
              {collection.label}
              <span> · {selectionLabel}</span>
            </h1>
            <p className="flashcards-range">{getRangeLabel(collection, mode)}</p>
          </div>
          {total > 0 && (
            <div className="flashcards-counter" aria-hidden="true">
              <strong>{index + 1}</strong>
              <span>of {total}</span>
            </div>
          )}
        </div>

        {state.status === "loading" && (
          <div className="flashcards-message" role="status">
            <LoaderCircle className="loading-spinner" size={26} aria-hidden="true" />
            <strong>Opening the flash cards…</strong>
          </div>
        )}

        {state.status === "error" && (
          <div className="flashcards-message" role="alert">
            <strong>Flash cards unavailable.</strong>
            <span>{state.message}</span>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => setAttempt(value => value + 1)}
            >
              <RotateCcw size={17} aria-hidden="true" />
              Try again
            </button>
          </div>
        )}

        {card && (
          <div className="flashcards-desk">
            <div
              className="flashcards-progress"
              role="progressbar"
              aria-label="Revision progress"
              aria-valuemin={1}
              aria-valuemax={total}
              aria-valuenow={index + 1}
              aria-valuetext={`Card ${index + 1} of ${total}`}
            >
              <span style={{ width: `${((index + 1) / total) * 100}%` }} />
            </div>

            <article
              className="flashcard"
              key={card.id}
              aria-roledescription="flash card"
              aria-labelledby="flashcard-headword"
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              onPointerCancel={() => {
                swipeStart.current = null;
              }}
            >
              <div className="flashcard__tags">
                <span
                  className="flashcard__level"
                  aria-label={`CEFR level ${collection.cefrLevel}`}
                >
                  {collection.cefrLevel}
                </span>
                {sourceLabel && (
                  <span className="flashcard__source">{sourceLabel}</span>
                )}
                <span className="flashcard__number">
                  Card {index + 1} of {total}
                </span>
              </div>

              <div className="flashcard__word">
                <h2 id="flashcard-headword" lang="en">
                  {card.headword}
                </h2>
                <span
                  className="flashcard__pos"
                  aria-label={`Part of speech: ${card.partOfSpeech}`}
                >
                  {card.partOfSpeech}
                </span>
              </div>

              <dl className="flashcard__details">
                <div className="flashcard__definition">
                  <dt>Definition</dt>
                  <dd lang="zh-Hant">{card.definition}</dd>
                </div>
                <div className="flashcard__example">
                  <dt>Example</dt>
                  <dd lang="en">
                    {buildExampleSentence(card).map((part, partIndex) =>
                      part.highlight ? (
                        <mark key={partIndex}>{part.text}</mark>
                      ) : (
                        <span key={partIndex}>{part.text}</span>
                      )
                    )}
                  </dd>
                </div>
              </dl>
            </article>

            <p className="flashcards-live" aria-live="polite">
              Card {index + 1} of {total}: {card.headword}
            </p>

            <nav className="flashcards-nav" aria-label="Flash card navigation">
              <button
                className="button button--secondary flashcards-nav__previous"
                type="button"
                disabled={index === 0}
                onClick={() => goTo(index - 1)}
              >
                <ChevronLeft size={20} aria-hidden="true" />
                Previous
              </button>
              {isLast ? (
                <button
                  className="button button--primary flashcards-nav__next"
                  type="button"
                  onClick={() => goTo(0)}
                >
                  <RotateCcw size={18} aria-hidden="true" />
                  Start again
                </button>
              ) : (
                <button
                  className="button button--primary flashcards-nav__next"
                  type="button"
                  onClick={() => goTo(index + 1)}
                >
                  Next
                  <ChevronRight size={20} aria-hidden="true" />
                </button>
              )}
            </nav>
            <p className="flashcards-hint">
              Use the ← → arrow keys or swipe the card to move between words.
            </p>
            {isLast && (
              <button
                className="flashcards-exercise-link"
                type="button"
                onClick={onExercise}
              >
                Finished revising? Set up an exercise on this range
                <ArrowRight size={17} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </section>

      <footer className="site-footer">
        <span>Version {APP_VERSION}</span>
        <span>
          © {new Date().getFullYear()} K S Lo English. All Rights Reserved.
        </span>
      </footer>
    </main>
  );
}
