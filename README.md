# Fretboard Builder

A tiny web app that generates **3D-printable fretboards for cigar box guitars** —
with the frets and nut printed right into the board, and the board attached to the
wooden neck with screws instead of glue.

## Why

Metal strings wear PLA down. Glued-on fretboards make that a neck problem; a
screwed-on fretboard makes it a two-minute swap. Print a spare, keep it in the
case, and a worn board becomes a fresh fret job for a few cents of filament.

## How it works

- The board is tapered (narrower at the nut, wider at the last fret) with
  **raised frets** printed in place, positioned with the standard
  equal-temperament formula: `distance = scale × (1 − 2^(−n/12))`. Each fret
  has a **rounded crown** (a half-ellipse profile, like real fret wire), so
  strings roll over it instead of catching a sharp rectangular edge. The
  fret **ends are rounded over** too, like filed fret ends on a real guitar.
- The **nut** is printed in place too, sitting on the headstock side of
  the scale's zero point, so fret distances are measured from the face
  the strings actually leave from. Each slot is sized for its string
  (width = gauge + a hair of clearance), and its floor is set by action,
  not by depth: the string's underside sits a target height above the
  first fret's crown (0.30 mm at the treble side, ramping up to 0.50 mm
  at the bass side — adjustable under *Advanced*). Each floor also
  slopes down toward the headstock from its high point at the nut's
  fret-side face, so the string's break point is exactly at the face.
  Gauges assumed: 3-string **GDg**
  (.042/.032/.024), 4-string **GDgB** (adds a .017), 6-string standard
  **EADGBE** (.046–.010). A **Left-handed** option under *Advanced* mirrors
  the slot order. The nut's left and right ends are rounded over (the
  long front/back edges stay square), so it won't catch or cut a hand
  sliding up the neck.
- **Screw holes sit at the traditional fret-marker positions** (3, 5, 7, 9, 12,
  15, 19, 21, 24) — countersunk for **#6 flat-head wood screws** (4.2 mm
  clearance, 8.2 mm head, 82° countersink), so the screw heads double as your
  fret markers. An extra hole at the nut end is on by default; one at the
  tail end is optional. The fret 17
  hole is off by default (a checkbox brings it back) — the board is plenty
  held down without it.
- If a marker position is too tight for a screw head (high frets on short
  scales), that hole is skipped and the app tells you.
- Choose strings (2–6), frets (12–24), scale length, nut and heel width, and
  fine-tune thickness, fret height and tail length under *Advanced*.
- A full-size board is ~433 mm long at the default 23.5″ CBG scale — longer
  than most print beds — so by
  default the board is **split into two printable pieces just past the fret 7
  ridge** (the ridge hides the seam; both pieces screw to the same neck,
  which registers them). You get one STL download per piece, with each
  piece's length shown so you can check it against your bed. Each part's
  STL is exported in its own local coordinates (starting at its own
  origin), so both parts can go on one slicer plate together. Split point
  options: after fret 5, 7, 9 or 12, three-piece splits (after frets
  5 & 12 or 7 & 14), or **Auto** — give it your print-bed length and it
  picks the fewest seams, on fret lines, that make every piece fit.
  Under *Advanced*, **alignment pins** add a pin-and-socket key
  (0.15 mm clearance) at each seam so the pieces register to each other
  when glued.
- **Fret modes** (next to the Frets slider): Chromatic (every fret),
  Diatonic (major scale only), Pentatonic (minor pentatonic), and
  Pentatonic Plus — Del Puckett's layout, which his site defines as the
  blues scale: the minor pentatonic plus the ♭5 blue note — the
  dulcimer-style layouts where every fret is in key. Screw markers stay at
  the standard positions in every mode.
- The **tail corners are rounded to a ¼″ radius** by default (an option
  under *Advanced*), so the tail drops into a routed neck pocket — router
  bits don't cut square corners.
- The two **long top edges are rounded over** — 1 mm radius by default
  (*Advanced* → Top edge round-over: off, 0.5–2 mm), so the printed board
  isn't sharp under the hand. The bottom face and its edges stay sharp and
  flat so the board sits flush on the neck, and the end/seam faces stay
  flat. Frets and the nut are shortened by the same radius at each end,
  so they finish on the flat top instead of hanging over the curve.
- **Headstock extension** (*Advanced*, off by default): a classic electric-style
  tongue past the nut — ¼″ of flat at full thickness, then a 45° taper
  down the full thickness to the tip (about 0.45″ total reach).
- **Fretboard radius** (*Advanced*, off/flat by default): the traditional
  radii — 16″, 12″, 9.5″ (modern) and 7.25″ (vintage). The crown
  is at the centerline, the bottom stays flat, and the frets, nut slots
  and extension all follow the curve. Downloads get an `_r12`-style
  suffix so radiused parts can't be confused with flat ones.
- **Presets** (top of the form): *T-Style* (25.5″ scale, 22 frets, 1.650″
  nut, 2.2″ at the heel, .046″-tall frets) and *LP-Style* (24.75″ scale,
  22 frets, 1.695″ nut, 2.26″ at the end of the board, .045″-tall frets)
  fill in a standard 6-string electric layout from commonly published
  specs, with the nut slots set for .010″ over fret 1 on the treble
  string. *Custom* (the default) changes nothing. Editing any of those
  fields afterwards switches the menu back to Custom. Presets keep the
  board flat and leave split, screw, tail and edge options alone.
- On a **3-string nut** the slots use fixed spacing — center slot on the
  centerline, the other two ½″ away on each side.

## Run it

Just open `index.html` (fretboards) or `body-builder.html` (bodies) in a
browser — no build step, no server, no internet.
Everything (including the 3D preview) runs locally in plain JavaScript.

## Printing notes

- Print **flat-side down**, no supports. 0.2 mm layers are fine; 0.12 mm makes
  the fret tops smoother — and it's the practical choice for a radiused
  board, where the curve steps visibly at 0.2 mm.
- Two-piece boards: butt the seam faces together on the neck and let the
  screws register the joint — the seam sits right at the split fret's ridge,
  so it's nearly invisible. A drop of CA glue on the seam faces is optional.
- 3+ walls and 40%+ infill keep the screw holes strong. PLA works; PETG lasts
  longer under string wear.
- Drill pilot holes in the neck (1/16″ for #6 in hardwood, 3/32″ in softwood)
  and use **#6 × 3/4″ flat-head wood screws** — snug, not gorilla-tight, or
  you'll crack the print.
- String slots in the printed nut are starter slots; a few strokes with a nut
  file or folded sandpaper dials in the action.

## Files

| File | What it does |
| --- | --- |
| `index.html` / `styles.css` | The page |
| `app.js` | Controls, dependency-free canvas 3D preview, download |
| `geometry.js` | All the fretboard math and mesh generation (pure JS — runs in Node too) |
| `stl.js` | Binary STL writer |
| `vendor/earcut.min.js` | Earcut triangulation (ISC license, © Mapbox) |
| `test.js` | Headless geometry tests: `node test.js` (also runs `body-test.js`) |
| `body-builder.html` / `body-app.js` | The body builder page and its controls |
| `body-geometry.js` | Body outline, rim halves, tracks, pocket, bolts, panel outlines (pure JS — runs in Node too) |
| `body-test.js` | Body builder tests: `node body-test.js` |
| `preview.js` | The canvas 3D preview, packaged for the body page |
| `vendor/clipper.js` | Clipper polygon booleans / offsets (Boost license, © Angus Johnson) |

## Body Builder (`body-builder.html`)

A second page for a **clamshell guitar body** for small 3- and 4-string
guitars. Open `body-builder.html` (or use the link at the top of the
fretboard page) — same panels, preview and offline behaviour.

- **Rim in two halves** (mirror images, except on the single-cutaway
  T-Style), split down the centre line (x = 0).
  The split runs right through the neck block and the tail block, so each
  half is a "C" that is open on the inside: the ⅛″ (3.175 mm) plywood top
  and back slide sideways into **tracks** cut into the inside of the wall
  near the top and bottom edges, then the second half closes over them.
  A top/bottom split wouldn't work (each half would be a closed loop the
  panels can't get into), and a front/back split puts the joints at the
  waist where you can't reach the bolts.
- **Panel channels**: each panel edge sits in a channel with a **flat
  2 mm lip on each face** of the panel (no chamfers), reaching **4 mm** in
  over it; the panel is cut 0.5 mm short of the channel back, so 3.5 mm of
  every edge is held. The outside of the rim stays a plain 3 mm wall
  (2 mm minimum). Lip thickness (default 2 mm) and lip overlap (default
  4 mm) are set on the page. The back panel's channel runs round its whole
  edge: along both side walls and straight across the faces of the tail
  and neck end slabs, where the lips continue on the block faces, so it is
  held on all four sides with no gap. It can't follow the outer wall round
  the tail and neck ends instead: the halves close sideways, so any ply
  beside a block at the same position along the body would have to pass
  through that block. Inside the neck and tail blocks the block tops carry
  the top panel instead of a lip. The second half still closes sideways
  over the panels (and the neck collar).
  **Bridge sag:** printed back face down, the underside of three lips (both
  lips of the top channel and the upper lip of the back channel) is a flat
  4 mm ledge off the wall with nothing under it. Every channel is
  0.3 mm taller than panel + 0.4 mm fit (3.875 mm for ⅛″ ply), so a little
  droop on those ledges doesn't pinch the panel. Turn on bridge / overhang
  cooling. Lip overlaps past about 5 mm get a droop warning.
- **Neck pocket**: 3″ long × 1.5″ wide (+0.15 mm each side), floor 0.9″
  below the top surface of the top panel. The pocket sits in a **solid neck
  block** (19 mm walls each side and past the end of the pocket) that runs
  from the pocket floor all the way down to the back face. The four neck
  screws (0.875″ × 1.75″ pattern) go straight down through that block, and
  the back plate sits on the flat back face — the face that was printed on
  the bed. So the screw clamp only squeezes a solid column of plastic
  (~2,900 mm² under the neck heel); nothing spans or bends.
  *Wells* mode adds counterbores from the back for washers or ferrules,
  leaving 1″ of floor, so standard 1¾″ screws reach.
- **Split neck block (on by default)**: the neck block is split
  horizontally at the pocket floor. Everything below the floor stays in
  the two halves (so the neck heel and the neck screws still bear on solid
  lower block, as above). Everything above it — the pocket's side and end
  walls — prints as a separate U-shaped **neck collar** that bridges the
  centre split. Four vertical bolts (two into each half; M4 × 25 mm on the
  presets) come up from the back face, heads sunk in counterbored wells,
  through snug holes in the lower block and into hex-nut traps that open
  at the collar's top (or heat-set inserts in its underside). The bolts
  pull the collar down onto the lower block, so every printed layer in the
  joint is in compression. Because the collar is bolted to both halves it
  replaces the long sideways neck bolt (still available, 1 max with the
  collar). The collar prints flat on its underside, no supports, and sits
  0.25 mm inside the rim wall so the second half can close over it.
- **Clamshell bolts** (M3, M4 or #6) run sideways through full-width end
  slabs at the bottom of the tail block (and, optionally, the neck block:
  one between the two rows of neck screws, or a second behind the pocket
  when the neck collar is off). By default the tail gets two: the low one in
  the end slab and an upper one just under the top-panel channel, so the
  top of the tail seam can't spread. The tail block runs up to the top
  channel, and the last 23 mm of the tail is solid block from wall to
  wall up to that channel, so the upper bolt clamps solid
  material from washer seat to washer seat, not an empty cavity. At the
  neck end the top of the seam is held by the collar, which is bolted
  down into both halves and spans the joint up to the top channel. Holes are teardrop-shaped (print without support) with
  a flat washer seat at each outside wall; they're long, so use threaded
  rod with nuts and washers or long bolts (the page shows the lengths).
  With both ends pinned, each C-half can't bulge at the waist without
  stretching the panels, so no bolt is needed in between. Glue in the
  tracks is optional.
- **Body styles**: Parlor, Small dreadnought style, Round, Cigar-box
  style and T-Style presets. The T-Style outline is traced from a drawing
  (`t-style-body-outline.svg`, built into `body-geometry.js`) and scaled
  uniformly to 12.9″ × 10.52″, 1.85″ deep (the channels need 1.80″
  minimum); the drawing's pocket marker sets the pocket (it measures
  3.01″ × 1.505″ at this scale). The drawing's neck end is the 1.5″
  tongue the neck sits on, so the rim closes it with a straight edge
  from the bass horn to the neck end and a straight wall beside the
  pocket on the treble side; the cutaway curve and both horns are
  otherwise as drawn. The left-handed option mirrors it. At 12.9″ it
  uses the whole 12.9″ bed, so the page keeps a bed warning on: each half
  fits turned corner to corner (an 11.7″ square), or use a bigger bed,
  cut the halves, or scale the body down.
- **Cutaway cap** (T-Style only): the treble horn curls back towards the
  neck, so the cutaway's walls sit between the neck and the horn's part of
  the top panel and the treble half could not slide on over the panel with
  them in place. Those walls, from the top panel's seat up, with their top
  lip, are a separate small part: close the body, then glue the cap down
  onto the half's wall top and the top panel. It prints top face down
  with no supports. The page finds this automatically (any outline whose
  rim would collide gets a cap); the other presets don't need one.
- Editing any shape field switches to Custom. Everything is
  checked against the print bed (12.9″ by default) and warned in the page.
- **Downloads**: an STL for each half, the neck collar STL, the cutaway cap STL (T-Style), and the top and back panel outlines
  as 1:1 SVG (mm, with a 100 mm check bar) or DXF.

Print each half back face down in PETG (or ASA), with bridge/overhang cooling on for the flat 4 mm lip undersides, 7 perimeters (the 3 mm wall prints fully solid), 6 top and
bottom layers, 30–40% gyroid, and use a slicer modifier for 80–100% infill
in the neck and tail blocks.

## Possible next steps

- Side-dot markers, a zero-fret option, scarf/angle compensation
- Bridge-side string spacing control, 12th-fret double screws
- Export a drilling template for the neck pilot holes
