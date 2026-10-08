# Landing page images

The four large illustrations are animated SVG sculptures in
`src/components/landing/sculpture.tsx`, with their motion in `src/styles/sculptures.css`.
The hero shows an animated interface sequence (request, consent, share), with no background image.
The Agent banner keeps a plain, theme-aware background, with no image
behind the text. The WebP files remain in use for the small tiles, proofs and personas.
The former hero and four-act renders are kept, but are no longer used in those places.

The specifications below keep the art direction and the reference prompts; the sizes
in the table are the initial production targets.

## Shared art direction

Place **before** each prompt, replacing `<HEX>` with the slot background and `<PALETTE>` with its
colours:

> Minimal soft 3D render, matte clay and frosted glass materials, isometric-ish three-quarter view, single
> object centred with generous negative space, smooth studio lighting from top-left, very soft long
> contact shadow down-right, no text, no logos, no people's faces, flat solid background exactly <HEX>,
> colour palette limited to <PALETTE>, crisp edges, subtle bevels, Swiss editorial poster feel, 8k, clean,
> calm.

## Slots

| id                   | file                                        | size              | placement                                                                          | background |
| -------------------- | ------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------- | ---------- |
| `hero-warp-poster`   | `hero-warp-poster.webp`                     | 2880×1800 (16:10) | still poster behind the hero canvas (reduced motion, before JS); fallback OG image | `#060010`  |
| `act-memory`         | `act-memory.webp`                           | 1600×1600         | act 1, lavender "Memory" card                                                      | `#c8bef9`  |
| `act-ledger`         | `act-ledger.webp`                           | 1600×1600         | act 2, mist grey "Request" card                                                    | `#e0e2e8`  |
| `act-refusal`        | `act-refusal.webp`                          | 1600×1600         | act 3, periwinkle "Denied" card                                                    | `#9bb3eb`  |
| `act-attest`         | `act-attest.webp`                           | 1600×1600         | act 4, peach "Revocation and attestation" card                                     | `#e9ab86`  |
| `tile-global`        | `tile-global.webp`                          | 460×460           | "Company context" tile                                                             | `#c8bef9`  |
| `tile-personal`      | `tile-personal.webp`                        | 460×460           | "Personal context" tile                                                            | `#1b2231`  |
| `tile-consent`       | `tile-consent.webp`                         | 460×460           | "Signed consent" tile                                                              | `#e9ab86`  |
| `tile-enclave`       | `tile-enclave.webp`                         | 460×460           | "Enclave" tile                                                                     | `#dadce2`  |
| `consent-receipt`    | `consent-receipt.webp`                      | 1200×1200         | figure 1, "Every consent leaves proof"                                             | `#143c91`  |
| `attestation-report` | `attestation-report.webp`                   | 1200×1200         | figure 2, attestation report                                                       | `#143c91`  |
| `persona-alice`      | `persona-alice.webp`                        | 512×512           | persona picker (demo panel)                                                        | `#c8bef9`  |
| `persona-bob`        | `persona-bob.webp`                          | 512×512           | persona picker                                                                     | `#9bb3eb`  |
| `persona-chloe`      | `persona-chloe.webp`                        | 512×512           | persona picker                                                                     | `#e9ab86`  |
| `og-image`           | `og.png`                                    | 1200×630          | social sharing card                                                                | `#060010`  |
| `wordmark-xl`        | `badge-wordmark.svg` (+ `badge-symbol.svg`) | vector, ~862×428  | giant footer logo and navigation bar mark                                          | —          |

## Prompts (after the shared art direction)

**`hero-warp-poster`** — Background #060010. A deep-space tunnel of thin luminous streaks radiating from a
bright pale-blue point at centre (#edf5ff to #5c99ff), about one in five streaks soft violet (#a8a0f4),
dark navy radial haze (#153e83 → #0b1d42) around the centre, long-exposure hyperspace feel, no stars
clutter, very clean, cinematic.

**`act-memory`** — Background #c8bef9. Four stacked rounded-square rings floating with small gaps like
layered memory, top ring off-white #f0eaff, lower rings violet #7960c6 / #554291 / #443477, tilted 58°
towards the viewer and rotated -35°, gentle depth, one small glowing dot travelling between layers.

**`act-ledger`** — Background #e0e2e8. A modern credit-card-sized hardware signer with a large curved
e-ink screen and slim graphite body (#1c212e to #4c5362), tilted -12°, the screen pale paper grey
(#e9ebe6) showing only abstract horizontal grey lines and a checkmark icon (no readable text), a thin blue
progress ring (#5c99ff) around a round button. Do not reproduce any real brand logo.

**`act-refusal`** — Background #9bb3eb. Seven navy 3D bars (#273b69 to #445f9d) of varying height on an
isometric plane like a data histogram, a translucent frosted-glass shield standing in front of them, the
tallest bar in muted crimson (#b72f45) being stopped by the shield, small fragments bouncing off.

**`act-attest`** — Background #e9ab86. A sealed glass cube (enclave) with a small glowing core, three thin
elliptical orbit rings around it at -30°, 30° and 90°, warm terracotta and cream materials (#ba6039,
#763722, #fbe0c8), one ring carrying a tiny round wax-seal-like disc.

**`tile-global`** — Background #c8bef9. A small cluster of soft rounded documents and a tiny globe, violet
ink #292442, simple and iconic.

**`tile-personal`** — Background #1b2231. A single glowing asterisk-shaped light sculpture in electric
blue #5c99ff with soft bloom, iconic.

**`tile-consent`** — Background #e9ab86. A round dashed-edge stamp seal pressed into soft clay, tilted -8°,
deep brown ink #47281a, embossed checkmark.

**`tile-enclave`** — Background #dadce2. A tiny frosted glass vault box with a padlock-shaped glowing slit,
cool grey metal.

**`consent-receipt`** — Background #143c91. A floating paper receipt card, off-white #f5f7fc with rounded
corners, abstract mono-spaced grey lines (unreadable), a small dashed circular stamp in signal blue
#5c99ff, slight perspective tilt, soft shadow.

**`attestation-report`** — Background #143c91. A translucent glass tablet showing an abstract hexadecimal
pattern as tiny glowing dots, a ring of three orbits above it, cyan-blue #89b9ff accents, calm and
technical.

**`persona-alice` / `persona-bob` / `persona-chloe`** — Background respectively #c8bef9 / #9bb3eb /
#e9ab86. A faceless rounded capsule-shaped character (pill body with a sphere head, like soft toy
figurines) in matching darker tone, holding a tiny object: Alice a briefcase, Bob a balance scale, Chloé a
clipboard. No faces, no text.

**`og-image`** — Background #060010 with the same blue/violet warp streaks converging on the right third,
large empty left area for text overlay (added in code), no text in image.

**`wordmark-xl`** — drawn by hand (no image generator): "Badge" in Montserrat 600, letter-spacing
-0.06em, with a rounded crest symbol; white fill for the dark footer, `filter: brightness(0)` on the
light navigation bar.
