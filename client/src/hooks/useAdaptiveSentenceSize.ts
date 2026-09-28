/** Oxbridge Ledger: measures the sentence on the real reading desk and keeps the largest size that fits. */
import { useLayoutEffect } from "react";
import type { RefObject } from "react";

function readNumber(style: CSSStyleDeclaration, name: string, fallback: number): number {
  const parsed = Number.parseFloat(style.getPropertyValue(name));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface AdaptiveSentenceOptions {
  /** Aesthetic ceiling on rendered lines, however much room is free. */
  maxLines?: number;
  /** Search resolution; 12 steps is a quarter-pixel on a 64 px range. */
  steps?: number;
}

/**
 * Size the sentence to the space the reading desk actually has.
 *
 * A length band alone cannot do this: two sentences of equal character count wrap
 * differently, and the same sentence wraps differently at different widths. So the
 * element is measured for real at each candidate size, and the largest size whose
 * rendered height and line count both fit is applied.
 *
 * The sentence is the one element that may grow. Everything else in the stage keeps its
 * size, so enlarging the question can never push the answer choices, the definition or
 * the Next button off the screen.
 *
 * The size is written straight to the element rather than through React state: the search
 * forces a layout on every probe, and routing that through a re-render would flicker. It
 * runs in a layout effect, so only the final size is ever painted.
 */
export function useAdaptiveSentenceSize(
  ref: RefObject<HTMLElement | null>,
  dependencies: readonly unknown[] = [],
  options: AdaptiveSentenceOptions = {},
): void {
  const steps = options.steps ?? 12;
  const maxLinesOption = options.maxLines;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof window === "undefined") return;
    let disposed = false;

    const fit = () => {
      if (disposed) return;
      const page = element.closest(".exercise-page") as HTMLElement | null;
      const stage = element.closest(".question-stage") as HTMLElement | null;
      if (!page || !stage) return;

      const pageStyle = getComputedStyle(page);
      // Each responsive layer states its own reading size in CSS, and that size is the
      // lower bound here: text may grow into free space but is never shrunk, so a layer
      // cannot end up smaller than its design intended. The compact layers declare a
      // comfortable minimum; the wide desktop layer keeps its large editorial size.
      element.style.fontSize = "";
      const declaredSize = Number.parseFloat(getComputedStyle(element).fontSize);
      const minFontSize = Number.isFinite(declaredSize) && declaredSize > 0
        ? declaredSize
        : readNumber(pageStyle, "--sentence-min-px", 18);
      const maxFontSize = Math.max(
        minFontSize,
        readNumber(pageStyle, "--sentence-max-px", 46),
      );
      const maxLines =
        maxLinesOption ?? readNumber(pageStyle, "--sentence-max-lines", 4);

      // Room from the top of the stage to the bottom of the viewport, less the controls
      // that must stay visible. The stage top sits above the sentence, so it does not
      // move when the sentence is resized; the footer sits below, so its height is
      // deducted rather than its current offset.
      const footer = document.querySelector(".exercise-footer");
      const stageStyle = getComputedStyle(stage);
      // The stage's own chrome: border plus padding. Both sit inside the height budget
      // computed from the stage's outer box, so neither can be spent on the sentence.
      const stageChrome =
        (Number.parseFloat(stageStyle.paddingTop) || 0) +
        (Number.parseFloat(stageStyle.paddingBottom) || 0) +
        (Number.parseFloat(stageStyle.borderTopWidth) || 0) +
        (Number.parseFloat(stageStyle.borderBottomWidth) || 0);
      const maxStageHeight =
        window.innerHeight -
        stage.getBoundingClientRect().top -
        (footer ? footer.getBoundingClientRect().height : 0) -
        (Number.parseFloat(pageStyle.paddingBottom) || 0);

      // Everything in the stage except the sentence: rail, eyebrow, choices, definition
      // panel and navigation. Summed from the siblings themselves rather than from the
      // stage's own height, because the stage stretches to fill the viewport and would
      // otherwise report the free space as if it were content. Measuring rather than
      // assuming also accounts for the resolved state's extra Next button.
      const workspace = element.closest(".question-workspace") as HTMLElement | null;
      const copy = element.closest(".question-copy") as HTMLElement | null;
      const siblings: HTMLElement[] = [];
      if (copy) {
        for (const child of Array.from(copy.children)) {
          if (child !== element) siblings.push(child as HTMLElement);
        }
      }
      if (workspace && copy) {
        for (const child of Array.from(workspace.children)) {
          if (child !== copy) siblings.push(child as HTMLElement);
        }
      }
      const workspaceStyle = workspace ? getComputedStyle(workspace) : null;
      const workspacePadding = workspaceStyle
        ? (Number.parseFloat(workspaceStyle.paddingTop) || 0) +
          (Number.parseFloat(workspaceStyle.paddingBottom) || 0)
        : 0;
      let otherContent = stageChrome + workspacePadding;
      for (const sibling of siblings) {
        if (sibling.hidden) continue;
        const siblingStyle = getComputedStyle(sibling);
        if (siblingStyle.display === "none") continue;
        otherContent +=
          sibling.getBoundingClientRect().height +
          (Number.parseFloat(siblingStyle.marginTop) || 0) +
          (Number.parseFloat(siblingStyle.marginBottom) || 0);
      }
      // The sentence's own top margin is part of the fixed budget too.
      const elementStyle = getComputedStyle(element);
      otherContent += Number.parseFloat(elementStyle.marginTop) || 0;

      const availableHeight = maxStageHeight - otherContent;

      const apply = (size: number) => {
        element.style.fontSize = `${size}px`;
        element.dataset.sentenceFontPx = size.toFixed(2);
      };

      if (!(availableHeight > 0)) {
        apply(minFontSize);
        return;
      }

      const measure = (candidate: number) => {
        element.style.fontSize = `${candidate}px`;
        const rect = element.getBoundingClientRect();
        const lineHeight =
          Number.parseFloat(getComputedStyle(element).lineHeight) || candidate;
        return {
          height: rect.height,
          lines: Math.max(1, Math.round(rect.height / lineHeight)),
        };
      };

      // On the compact reading desks the whole exercise must stay on one screen, so the
      // document's own overflow is the final authority: it accounts for margins, borders
      // and rounding that no sum of parts reliably captures. The wide desktop layer is
      // exempt because its editorial size is fixed and the page is allowed to scroll.
      const noScroll = getComputedStyle(stage).getPropertyValue("--sentence-no-scroll")
        .trim() === "1";
      const overflows = () =>
        noScroll &&
        document.documentElement.scrollHeight > window.innerHeight + 0.5;

      const fits = (candidate: number) => {
        const { height, lines } = measure(candidate);
        return height <= availableHeight && lines <= maxLines && !overflows();
      };

      // Never cross the layer's floor: readable text beats a flawless fit.
      if (maxFontSize <= minFontSize || !fits(minFontSize)) {
        apply(minFontSize);
        return;
      }
      if (fits(maxFontSize)) {
        apply(maxFontSize);
        return;
      }

      let low = minFontSize;
      let high = maxFontSize;
      for (let step = 0; step < steps; step += 1) {
        const mid = (low + high) / 2;
        if (fits(mid)) {
          low = mid;
        } else {
          high = mid;
        }
      }
      let chosen = Math.round(low * 4) / 4;
      // Step down a quarter pixel at a time until the page genuinely fits, so a
      // sub-pixel rounding difference can never leave the footer below the fold. The
      // step-down stops at the layer's readable lower bound rather than at zero.
      while (chosen > minFontSize && !fits(chosen)) {
        chosen = Math.round((chosen - 0.25) * 4) / 4;
      }
      chosen = Math.max(chosen, minFontSize);
      apply(chosen);
    };

    fit();
    // Web fonts change the wrap, so refit once the real face has loaded.
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (!disposed) fit();
      });
    }
    const onResize = () => fit();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [ref, steps, maxLinesOption, ...dependencies]);
}
