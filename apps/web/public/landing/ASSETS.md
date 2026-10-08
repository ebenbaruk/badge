# Images de la page d'accueil

Les quatre grandes illustrations utilisent des sculptures SVG animées dans
`src/components/landing/sculpture.tsx`, avec les mouvements dans `src/styles/sculptures.css`.
Le héros présente une séquence d’interface animée (demande, accord, partage), sans image de fond.
Le bandeau Agent garde un fond uni adapté au thème, sans image
derrière le texte. Les fichiers WebP restent disponibles pour les petites tuiles, preuves et personnages.
Les anciens rendus du héros et des quatre actes sont conservés, mais ne sont plus utilisés à ces endroits.

Les spécifications ci-dessous conservent la direction artistique et les prompts de référence ; les tailles
indiquées dans le tableau sont les cibles de production initiales.

## Direction artistique commune

À placer **avant** chaque prompt, en remplaçant `<HEX>` par le fond du slot et `<PALETTE>` par ses
couleurs :

> Minimal soft 3D render, matte clay and frosted glass materials, isometric-ish three-quarter view, single
> object centred with generous negative space, smooth studio lighting from top-left, very soft long
> contact shadow down-right, no text, no logos, no people's faces, flat solid background exactly <HEX>,
> colour palette limited to <PALETTE>, crisp edges, subtle bevels, Swiss editorial poster feel, 8k, clean,
> calm.

## Emplacements

| id                   | fichier                                     | taille              | emplacement                                                                                 | fond      |
| -------------------- | ------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------- | --------- |
| `hero-warp-poster`   | `hero-warp-poster.webp`                     | 2880×1800 (16:10)   | affiche fixe derrière le canvas du héros (mouvement réduit, avant JS) ; image OG de secours | `#060010` |
| `act-memory`         | `act-memory.webp`                           | 1600×1600           | acte 1, carte lavande « Mémoire »                                                           | `#c8bef9` |
| `act-ledger`         | `act-ledger.webp`                           | 1600×1600           | acte 2, carte gris brume « Demande »                                                        | `#e0e2e8` |
| `act-refusal`        | `act-refusal.webp`                          | 1600×1600           | acte 3, carte pervenche « Refus »                                                           | `#9bb3eb` |
| `act-attest`         | `act-attest.webp`                           | 1600×1600           | acte 4, carte pêche « Révocation et attestation »                                           | `#e9ab86` |
| `tile-global`        | `tile-global.webp`                          | 460×460             | tuile « Contexte global »                                                                   | `#c8bef9` |
| `tile-personal`      | `tile-personal.webp`                        | 460×460             | tuile « Contexte perso »                                                                    | `#1b2231` |
| `tile-consent`       | `tile-consent.webp`                         | 460×460             | tuile « Accord signé »                                                                      | `#e9ab86` |
| `tile-enclave`       | `tile-enclave.webp`                         | 460×460             | tuile « Enclave »                                                                           | `#dadce2` |
| `consent-receipt`    | `consent-receipt.webp`                      | 1200×1200           | figure 1 « Chaque accord laisse une preuve »                                                | `#143c91` |
| `attestation-report` | `attestation-report.webp`                   | 1200×1200           | figure 2, rapport d'attestation                                                             | `#143c91` |
| `persona-alice`      | `persona-alice.webp`                        | 512×512             | sélecteur de persona (panneau démo)                                                         | `#c8bef9` |
| `persona-bob`        | `persona-bob.webp`                          | 512×512             | sélecteur de persona                                                                        | `#9bb3eb` |
| `persona-chloe`      | `persona-chloe.webp`                        | 512×512             | sélecteur de persona                                                                        | `#e9ab86` |
| `og-image`           | `og.png`                                    | 1200×630            | carte de partage sur les réseaux                                                            | `#060010` |
| `wordmark-xl`        | `badge-wordmark.svg` (+ `badge-symbol.svg`) | vectoriel, ~862×428 | logo géant du pied de page et marque de la barre de navigation                              | —         |

## Prompts (après la direction artistique commune)

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

**`wordmark-xl`** — à dessiner à la main (pas de générateur d'images) : « Badge » en Montserrat 600,
interlettrage -0.06em, avec un symbole en forme d'écusson arrondi ; remplissage blanc pour le pied de page
sombre, `filter: brightness(0)` sur la barre de navigation claire.
