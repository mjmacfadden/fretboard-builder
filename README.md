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
| `body-geometry.js` | One-piece body: outline, rim + floor, glue shelf, neck block and pocket, access panel, top/cover outlines (pure JS — runs in Node too) |
| `body-test.js` | Body builder tests: `node body-test.js` |
| `preview.js` | The canvas 3D preview, packaged for the body page |
| `vendor/clipper.js` | Clipper polygon booleans / offsets (Boost license, © Angus Johnson) |

## Body Builder (`body-builder.html`)

A second page for a **one-piece guitar body** for small 3- and 4-string
guitars. Open `body-builder.html` (or use the link at the top of the
fretboard page) — same panels, preview, downloads and offline behaviour as
the fretboard builder.

- **One printed part**: a perimeter rim (wall, 3 mm by default, 2 mm
  minimum) and a solid back floor (3 mm), printed **floor down on the bed
  with the open side up**. No halves, slots, lips, bolts or separate blocks.
- **Glue shelf for the top**: a shelf runs round the inside of the rim, its
  glue surface *ply thickness + allowance* below the rim edge (3.175 + 0.25 =
  3.425 mm by default), so the ⅛″ ply top drops into the rim, sits on the
  shelf and ends up flush (0.25 mm below the edge; set the allowance to 0
  for dead flush). The shelf reaches **7 mm** in from the wall (6.7 mm of
  glue surface after the 0.3 mm top fit), has a 1.6 mm straight edge, and
  its underside is a **45° taper** back to the wall (0.4 mm staircase
  steps), so it prints without supports.
- **Integral neck block, a ribbed shell** rather than a solid lump:
  - **6 mm pocket walls** (sides and inner end) from the back floor up to
    the shelf, so the top is glued to them too;
  - **three 20 mm gussets** (3 mm) behind the pocket's inner end: one on
    the centreline and one on each outer corner;
  - **low ties** (3 mm thick, 20 mm high) from each side wall out to the
    rim, one where the corner round meets the side and one mid-pocket.
    Where the rim comes within 4 mm of the wall (the T-Style treble side,
    about 10 mm) that gap is filled solid instead;
  - under the pocket, a **6 mm solid plate** below the pocket floor. Beneath
    it, a centreline rib and a cross rib (3 mm) and a **boss round each
    neck screw hole** (3 mm wall: 10.6 mm across for the plate holes) run
    down to the back floor. The four cells between them are sealed and
    their roofs close in 45° staircases, so there are no bridges and no
    supports.
  - All of these are adjustable, with a 2 mm minimum. Each neck screw
    clamps back plate, back floor, boss, plate and neck in one straight
    line.
  - Parlor body: about 579 cm³ of plastic (847 cm³ with the old solid
    block).
  - T-Style: about 492 cm³ (574 cm³ before).
- **Neck pocket**: **2.75″ long × 1.5″ wide** (+0.15 mm fit each side),
  **¼″ (6.35 mm) radius** inner corners (set 0 for square), floor **0.9″
  below the top surface of the top**, open
  through the neck end. It is **never scaled**, whatever the outline.
- **Neck screws**: four #8 wood screws up through the back floor and the
  block, either through a back plate on the back face (screw = plate +
  floor and block under the pocket + 19 mm bite) or from counterbored wells
  with washers / ferrules (washer + 25.4 mm of block + bite). Lengths are
  rounded up to ¼″: parlor 3¼″ (plate) or 2″ (wells), T-Style 2″ (plate;
  it is too shallow for wells).
- **Optional back access panel**: a rounded opening (75 × 110 mm by
  default, centred a third of the way up from the tail) with a 4 mm deep
  recess whose seat is a **45° bevel** (a countersink, printed as a
  staircase — no flat ledge over air) and a raised ring inside the body.
  The printed cover plate has the matching bevel, sits flush with the back
  and prints outer face down; four small screws (#2 / M2.5) go through it
  into the ring. Turn it off and the back is solid.
- **Styles**: parlor, small dreadnought style, round, cigar-box style, the
  **T-Style** single cutaway (traced from `t-style-body-outline.svg`; its
  neck end is closed with a straight wall beside the pocket) and Custom.
  Depth and all sizes stay adjustable; left-handed mirrors the cutaway.
- **Bed fit**: the whole body must fit the bed (12.9″ by default) less a
  **5 mm margin**. If a style is too big it is **not split**: only the
  outline is scaled down uniformly until it fits; the pocket, wall, floor,
  shelf and screw holes stay true size. The T-Style (12.9″ × 10.52″ drawn)
  lands at **12.70″ × 10.36″** (98.5%); the small dreadnought style
  (12.75″) at 12.70″; the parlor (12.5″ × 9.5″) fits unscaled.
- **Downloads**: the body STL (already in print orientation), the cover
  plate STL (when the access panel is on), the top panel outline (with the
  pocket notch) and the cover outline (with its screw holes) as 1:1 SVG
  (mm, with a 100 mm check bar) or DXF.

Print in PETG (or ASA), 0.2 mm layers, 7 perimeters (the rim and shelf
print fully solid), 6 top and bottom layers and normal infill (15–25%); the
neck block is a ribbed shell, so it needs no infill modifier. With screw wells on, the flat round roof of
each well is a short bridge — the only one. Glue the top to the shelf and
the neck block, weighted flat.

`node body-test.js` (also run by `node test.js`) checks every style with
the access panel on and off and both screw modes: one watertight body on
the bed (plus its sealed cells), the pocket size / corner radius / floor
depth, the neck block's walls, ribs, bosses and cells, the shelf drop, width and
45° taper, a slab-by-slab overhang audit (nothing more than one 0.4 mm step
past the layer below, except the well roofs), the screw maths, the access
recess and cover fit, bed scaling, the SVG / DXF output, and random shapes.

## Possible next steps

- Side-dot markers, a zero-fret option, scarf/angle compensation
- Bridge-side string spacing control, 12th-fret double screws
- Export a drilling template for the neck pilot holes
