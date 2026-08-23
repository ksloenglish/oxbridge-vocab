# Compact mobile Home and Results contract

## Measured baseline

At 390×844, Home is 1,815 pixels tall: the 430-pixel hero and 1,305-pixel folio are the main contributors. Collection cards are 80 pixels tall in four two-column rows; range cards are approximately 102 pixels tall in three single-column rows; Current selection is approximately 150 pixels tall.

Results is 2,357 pixels tall at both target phone widths. Its 460-pixel hero, 332-pixel stacked statistics, ten 108-pixel single-column review rows, and 188-pixel action area create most of the vertical cost. The apparent score-to-slash gap is caused by stretched grid tracks inside `.score-pullquote`, not source markup.

## Mobile Home contract

The mobile hero should remain photographic and editorial but reduce to approximately 360 pixels. The logo, eyebrow, Fraunces headline, and descriptive copy remain; their sizes, margins, and line heights tighten proportionally.

The setup folio should use a compact three-column collection grid and three-column word-range grid. Collection cards retain at least 56 pixels of height, range cards retain at least 76 pixels, and question chips retain 44-pixel touch targets. Section headings, blue indices, selected blue inset rules, saffron range tabs, parchment surfaces, and the dark Current selection strip remain.

Current selection returns to a single compact row on phones. The Start exercise control remains at least 48 pixels tall. Scrolling is acceptable, but total height should fall substantially without hiding information.

## Mobile Results contract

The compact Results hero keeps the navy field, celebratory motif, saffron eyebrow, Fraunces remark, collection/range context, and final score. The score expression must render as one tight visual unit: score, narrow gap, and `/ total`.

The three metrics should form a compact three-column ledger. The review index should use two columns with legible headwords and definitions. Copy and Play again remain touch-safe and appear side by side where the viewport permits, with status text below.

## Acceptance criteria

All mobile controls remain at least 44 pixels tall. There is no horizontal overflow at 390×844 or 412×800. Copy-to-clipboard, Play again, version display, score, accuracy, active time, level, and all ten review entries remain correct. Desktop Home and Results geometry must remain unchanged.
