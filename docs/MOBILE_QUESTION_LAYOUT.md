# Mobile question layout contract

## Measured baseline

At a 390×844 CSS-pixel viewport, the existing question screen requires scrolling in every state. The unanswered page is 957 px tall, the incorrect-feedback page is 1,032 px, and the resolved page with its Next button is 1,139 px. The four answer cards alone consume 303–392 px because status text creates extra rows. The current question preview sentence uses 31.2 px type regardless of content length.

The 3,035-record production release ranges from a 23-character visible sentence to a 118-character visible sentence. The longest visible option is 23 characters, and the longest option definition is 53 characters.

## Mobile-only hierarchy

The desktop question design remains unchanged. At widths up to 620 px, the interface uses one compact reading desk:

1. Keep the shared brand header and Quit action, but reduce their padding and mark size.
2. Compress the three progress metrics into one short ledger row with the progress rule beneath them.
3. Hide the duplicate question margin rail; the ledger already identifies the current question.
4. Keep the collection/range eyebrow, sentence, four options, feedback, and navigation in one compact workspace.
5. Hide the keyboard hint and the unanswered definition placeholder on touch-size screens.
6. Preserve a minimum 48 px answer touch target and a 44 px navigation target.
7. Keep status meaning in colour, icon, and accessible labels; hide only redundant visible status wording on mobile.
8. Show compact feedback and the selected option’s definition after an attempt. Show the target definition after resolution.

## Sentence auto-sizing

Assign one deterministic class from the visible sentence character count, including a blank placeholder:

| Class | Visible characters | Mobile type target |
|---|---:|---:|
| Short | 0–47 | about 25–27 px |
| Medium | 48–71 | about 22–24 px |
| Long | 72–94 | about 19–21 px |
| Extra long | 95+ | about 16–18 px |

The class affects only mobile typography. All sizes retain Fraunces, tight editorial tracking, balanced wrapping, and a line height near 1.15.

## Acceptance criteria

At 390×844 and 412×800, the full unanswered, incorrect-feedback, and resolved-with-Next states must fit without document scrolling for the shortest and longest released questions. No state may overflow horizontally. Focus indicators, disabled options, incorrect recovery, correct resolution, definition switching, scoring, timer, and Next/Finish navigation must remain functional. Desktop screenshots must remain visually unchanged.

## Visual verification findings

The 118-character longest released sentence remains readable in the extra-long Fraunces treatment and occupies five compact lines without overpowering the answer area. The parchment surface, Scholar Blue rules, saffron top tab, numbered option boxes, and green/red state accents preserve the Oxbridge Ledger identity despite the reduced height. In the resolved state, all four 48 px choices, the target definition, and the 44 px Next button are visible together within 390×844. The incorrect-state evidence was initially captured during the brief staggered option entrance; the test harness should wait for that sub-300 ms decorative transition before taking final evidence screenshots, although geometry and interaction tests are unaffected.
