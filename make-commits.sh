#!/usr/bin/env bash
# Fretboard Builder: make the 8 commits in order (pre-audit work, audit fixes 1-6, then the fret-end half domes).
# Does NOT push. Progress and results are written to _commit_report.txt.
cd "$(dirname "$0")"
R=_commit_report.txt
P=_fb_patches
: > "$R"
say() { echo "$@" | tee -a "$R"; }
fail() { say "FAILED: $1"; say "Stopped here. Nothing was pushed. Send Mike the _commit_report.txt contents."; exit 1; }

[ "$(git branch --show-current)" = "main" ] || fail "not on branch main"
git diff --cached --quiet || fail "index is not empty (something is already staged)"

decode() {
  if base64 -D -i "$P/$1.b64" -o "$P/$1.patch" 2>/dev/null; then :; else base64 --decode < "$P/$1.b64" > "$P/$1.patch" || fail "cannot decode $1.b64"; fi
  got=$(shasum -a 256 "$P/$1.patch" | awk '{print $1}')
  [ "$got" = "$2" ] || fail "checksum mismatch on $1.patch (got $got)"
  say "patch $1 verified"
}
decode fix1 84219ce54215a3576d005943f110799995759665d8f0e9e882beb0d7936ab480
decode fix2 35535b726678136f6a8b2bd4405fe67a27d62454f59003ea93f2eb34074b0405
decode fix3 cb4915dc51797662212b8a9656ab09bd2c1a19a5d0ec53d0edaa9e5832d7ed6b
decode fix5 93e11bbf707fe5fcffb8b6d2eba26c8646d23f045d6265b78d01e398f5bc5cd5
decode fix6 b54a8c9b0fce5f4664b95b28603827e0746ca990139f1c864facc0c2345d6bd9
decode fix7 b044ea82631fc48bfd84f92cf0810c9758b14348e43e0cabe1c4406fc10329ed

runtests() {
  if command -v node >/dev/null 2>&1; then
    if node test.js >> "$R" 2>&1; then say "tests pass ($1)"; else say "tests FAILED ($1) - see log above"; fi
  else
    say "node not on PATH; tests skipped here ($1) - they were already run per stage on Muse's machine"
  fi
}

say "=== rewinding working tree to pre-audit state ==="
git apply -R "$P/fix7.patch" || fail "reverse fix7"
git apply -R "$P/fix6.patch" || fail "reverse fix6"
git apply -R "$P/fix5.patch" || fail "reverse fix5"
git apply -R "$P/fix3.patch" || fail "reverse fix3"
git apply -R "$P/fix2.patch" || fail "reverse fix2"
git apply -R "$P/fix1.patch" || fail "reverse fix1"
head -1 vendor/earcut.min.js | grep -q 'earcut 2.2.4' || fail "earcut header line not found"
tail -n +2 vendor/earcut.min.js > "$P/earcut.tmp" && mv "$P/earcut.tmp" vendor/earcut.min.js || fail "strip earcut header"
[ "$(wc -c < vendor/earcut.min.js | tr -d ' ')" = "7131" ] || fail "earcut size after header strip"

say "=== commit 1 of 8: pre-audit work ==="
git add .gitattributes app.js geometry.js index.html README.md stl.js styles.css test.js vendor/earcut.min.js || fail "add stage 0"
git commit -m "Pre-audit work: full-orbit preview with pan and zoom-to-cursor, true-arc nut roll, smoother fret ends, finer fret crowns" >> "$R" 2>&1 || fail "commit 1"
say "commit 1 done"
runtests "after commit 1"

say "=== commit 2 of 8: fix 1, nut position ==="
git apply "$P/fix1.patch" || fail "apply fix1"
git add geometry.js test.js || fail "add fix1"
git commit -m "Move nut to the headstock side of y=0 so its fret-side face is the scale zero" >> "$R" 2>&1 || fail "commit 2"
say "commit 2 done"
runtests "after commit 2"

say "=== commit 3 of 8: fix 2, watertight mesh ==="
git apply "$P/fix2.patch" || fail "apply fix2"
git add geometry.js test.js || fail "add fix2"
git commit -m "Make the board mesh watertight: build side walls from the top face's own boundary" >> "$R" 2>&1 || fail "commit 3"
say "commit 3 done"
runtests "after commit 3"

say "=== commit 4 of 8: fix 3, input validation ==="
git apply "$P/fix3.patch" || fail "apply fix3"
git add geometry.js app.js test.js || fail "add fix3"
git commit -m "Validate geometry inputs and show build errors in the UI" >> "$R" 2>&1 || fail "commit 4"
say "commit 4 done"
runtests "after commit 4"

say "=== commit 5 of 8: fix 4, licensing ==="
{ printf '%s\n' '/* earcut 2.2.4 — Copyright (c) Mapbox. ISC License; see earcut-LICENSE in this directory. */'; cat vendor/earcut.min.js; } > "$P/earcut.tmp" && mv "$P/earcut.tmp" vendor/earcut.min.js || fail "restore earcut header"
[ "$(wc -c < vendor/earcut.min.js | tr -d ' ')" = "7227" ] || fail "earcut size after header restore"
git add vendor/earcut.min.js vendor/earcut-LICENSE LICENSE .gitignore || fail "add fix4"
git commit -m "Add earcut ISC license and attribution header, MIT LICENSE, and .gitignore" >> "$R" 2>&1 || fail "commit 5"
say "commit 5 done"
runtests "after commit 5"

say "=== commit 6 of 8: fix 5, slot floors from target height ==="
git apply "$P/fix5.patch" || fail "apply fix5"
git add geometry.js app.js index.html test.js || fail "add fix5"
git commit -m "Set nut slot floors from target string height over the first fret" >> "$R" 2>&1 || fail "commit 6"
say "commit 6 done"
runtests "after commit 6"

say "=== commit 7 of 8: fix 6, sloped nut slots ==="
git apply "$P/fix6.patch" || fail "apply fix6"
git add geometry.js app.js index.html README.md test.js || fail "add fix6"
git commit -m "Slope nut slots down toward the headstock, break point at the fret-side face" >> "$R" 2>&1 || fail "commit 7"
say "commit 7 done"
runtests "after commit 7"

say "=== commit 8 of 8: fret ends as true half domes ==="
git apply "$P/fix7.patch" || fail "apply fix7"
git add geometry.js test.js || fail "add fix7"
git commit -m "Round fret ends into true half domes that curve down to the board surface" >> "$R" 2>&1 || fail "commit 8"
say "commit 8 done"
runtests "after commit 8"

say "=== final git log ==="
git log --oneline -9 >> "$R" 2>&1
say "=== final git status (only _fb_patches/, make-commits.sh, _commit_report.txt should be untracked) ==="
git status --porcelain >> "$R" 2>&1
say "ALL 8 COMMITS DONE - nothing pushed"
