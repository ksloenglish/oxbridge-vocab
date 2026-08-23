# Compact iPad question layout

## Measured baseline

The current 1024-pixel iPad layout uses the spacious desktop question composition. Across the four real-data stress records and three interaction states, every 1024×650 and 1024×715 case requires scrolling. The worst document height is 1,078 px and the final interaction control reaches approximately 947 px. At 768×1024, eight of twelve states scroll; at 820×1080, five of twelve scroll. Answer cards are 76 px high before tablet compaction.

## Tablet-only contract

Apply the compact layer only from 621 px through 1100 px. Keep the existing phone layout at 620 px and below and the wide desktop layout above 1100 px.

1. Reduce the brand header, page padding, progress ledger margins, and metric typography while retaining the complete app title and Quit control.
2. Keep the asymmetric reading desk, but narrow the question margin rail and replace its long saffron marker with a compact folio accent.
3. Remove excessive workspace padding and the keyboard hint on touch-oriented tablet widths.
4. Keep the two-column answer ledger in both landscape and portrait, with every choice at least 48 px high.
5. Use the existing deterministic sentence-length classes with tablet-specific Fraunces sizes: approximately 30 px short, 27 px medium, 23 px long, and 20 px extra-long.
6. Render feedback as a compact two-column ledger panel separated from the answer grid by 8 px. Keep the selected-option definition before resolution and the target definition after resolution.
7. Keep Next/Finish at least 44 px high and visible after resolution without scrolling.

## Visual identity

Retain parchment, ink navy, Scholar Blue rules, saffron folio accents, numbered answer keys, status icons, and the asymmetric ledger rail. Compression must not reduce the interface to plain cards.

## Acceptance criteria

At 1024×650, 1024×715, 820×1080, and 768×1024, the shortest sentence, longest sentence, longest option, and longest definition must fit in unanswered, incorrect, and resolved states without document scrolling or horizontal overflow. All options remain at least 48 px high. Incorrect recovery, first-attempt scoring, definition switching, timer, Quit, Next, and Finish remain functional. Phone and wide-desktop screenshots remain visually unchanged.

## Visual verification findings

At 1024×650, the incorrect state presents the complete brand header, compact four-metric ledger, folio rail, sentence, two-by-two choice ledger, and selected-option definition together with substantial but intentional parchment breathing room. The compact saffron rail, blue rules, numbered keys, and red status treatment preserve the Oxbridge Ledger identity.

The 117-character longest released sentence remains readable in a balanced two-line extra-long Fraunces treatment. In the resolved state, all four 52 px choices, definition, recovery feedback, and 44 px Next button are visible together without scrolling. The option-status text is visually reduced to icons at tablet widths while accessible labels remain in the markup.

At 768×1024 portrait, the two-column answer ledger and two-column definition panel remain clear, with the complete incorrect-feedback state occupying only the upper half of the viewport and no crowding around the folio rail. At 1280×720, the original wide-screen scale, keyboard hint, 88 px rail, larger sentence, 82 px choices, and full visible status wording remain unchanged, confirming the tablet layer is isolated to 621–1100 px.

The final real-data stress suite covers four extreme release records across unanswered, incorrect, and resolved states at 1024×650, 1024×715, 820×1080, and 768×1024. All 48 cases pass with zero document scrolling, zero horizontal overflow, all final controls visible, and minimum 52 px answer targets. The corresponding 24 phone cases continue to pass at 390×844 and 412×800 with their original 48 px targets.

The interaction journey also passes at 1024×650, 1024×715, and 768×1024. It verifies the selected wrong option’s definition, recovery with no first-attempt point, a subsequent first-attempt point, active timer progression, Next, Finish, and no-scroll visibility throughout. Release validation confirms 3,035 questions across fourteen segments; all twenty-two unit tests, TypeScript, production build, and frozen installation pass.
