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
- The **nut** is printed in place too, with one slot per string — and each
  slot is sized for its string (width = gauge + a hair of clearance, floor
  ≈60% of the string's diameter down). Gauges assumed: 3-string **GDg**
  (.042/.032/.024), 4-string **GDgB** (adds a .017), 6-string standard
  **EADGBE** (.046–.010). A **Left-handed** option under *Advanced* mirrors
  the slot order.
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
- A full-size board is ~428 mm long at the default 23.5″ CBG scale — longer
  than most print beds — so by
  default the board is **split into two printable pieces just past the fret 7
  ridge** (the ridge hides the seam; both pieces screw to the same neck,
  which registers them). You get one STL download per piece, with each
  piece's length shown so you can check it against your bed. Split point
  options: after fret 5, 7, 9 or 12, or no split.
- The **tail corners are rounded to a ¼″ radius** by default (an option
  under *Advanced*), so the tail drops into a routed neck pocket — router
  bits don't cut square corners.

## Run it

Just open `index.html` in a browser — no build step, no server, no internet.
Everything (including the 3D preview) runs locally in plain JavaScript.

## Printing notes

- Print **flat-side down**, no supports. 0.2 mm layers are fine; 0.12 mm makes
  the fret tops smoother.
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
| `test.js` | Headless geometry tests: `node test.js` |

## Possible next steps

- Side-dot markers, a zero-fret option, scarf/angle compensation
- Bridge-side string spacing control, 12th-fret double screws
- Export a drilling template for the neck pilot holes
