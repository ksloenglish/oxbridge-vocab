# Home hero artwork contract

## Visual diagnosis

The former 2560×1440 landscape artwork placed nearly all meaningful detail on its far-right side. In the narrow desktop Home panel, `object-fit: cover` removed most of that detail and exposed mainly a dark ledger edge, so the image did not communicate the Oxbridge theme. Its wide composition remains suitable for the shallow mobile hero and is therefore retained below 821 px.

## Chosen desktop direction

The new 1664×2080 portrait artwork is designed for the desktop folio panel. It combines classical Oxford-inspired domes, Cambridge-inspired Gothic architecture, an open vocabulary notebook, a fountain pen, and flowing letterforms. The left side is deliberately dark and low-detail for the white brand lockup and headline; the meaningful imagery occupies the centre-right and remains recognisable in the narrow crop.

## Responsive contract

- Use the portrait scholarship artwork above 820 px with an approximately 68% horizontal focal position.
- Retain the former landscape ledger artwork at 820 px and below with centred positioning.
- Keep the desktop artwork dark enough for white overlaid text and preserve the existing navy overlay.
- Verify the visual story at desktop, coarse-pointer iPad, and phone widths rather than relying on the uncropped source image.

## Verified implementation

The portrait artwork is served as a 1664×2080 WebP compressed from 5.7 MB to approximately 432 KB without changing its composition. Responsive source inspection confirmed that 1024, 1180, and 1366 px iPad profiles and a 1366 px pointer-fine laptop select the portrait image at `68% 50%`, while the 390 px phone selects the established landscape image at `50% 50%`.

Word-range remarks now render at approximately 14.08 px on wide desktop, 11.52 px on compact iPad, and 10.88 px on phone. Availability counts remain intentionally quieter at approximately 8.96, 8, and 7.68 px respectively, preserving the distinction between the range information and the low-profile count.
