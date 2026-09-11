# Project state

**Read this first if you are picking this work up cold.** It is rewritten at
the end of every work session so that a new person — or a new agent with no
conversation history — can continue without needing to reconstruct context.

Last updated: 2026-09-11 · commit `a911734` · branch `main` · 337 tests · **the app works end to end**

---

## What this is

A macOS app that emulates the **TI-34 MultiView** scientific calculator, for
exam practice (CBTF at UIUC) without owning the physical unit. It must be
usable both by clicking keys and by typing on a physical keyboard.

Repo: https://github.com/oggefaderen/ti34-multiview (public)

The target is a **full clone**, not a subset: MathPrint display, fractions, the
2nd layer, every menu including data/stat. The faceplate is meant to be a
**faithful visual replica**, because the point is that muscle memory transfers
to the real device.

---

## The two documents that govern the work

| File | Role |
|---|---|
| `docs/TI-34-SPEC.md` | **What the calculator does.** Compiled from TI's official guidebook. When the app and this file disagree, the file is right and the app has a bug. Section 8 lists the handful of things the guidebook itself doesn't settle. |
| `docs/ARCHITECTURE.md` | **How the code is arranged.** Pins the interface of every module so layers can be built independently. Treat the signatures there as a contract — if you change one, change the doc in the same commit. |

---

## Status

### Done — all units complete

| Unit | Files |
|---|---|
| Key table | `src/engine/tokens.js` |
| Math core | `src/engine/value.js`, `src/engine/eos.js` |
| Statistics | `src/engine/stats.js` |
| Display formatting | `src/engine/format.js` |
| Menus | `src/engine/menus.js` |
| Entry-line editing | `src/engine/entry.js` |
| State machine | `src/engine/calculator.js` |
| Faceplate, renderer, input | `src/ui/*` |
| macOS shell | `mac/main.swift`, `build.sh` |

**337 tests passing. CI green.** The built app launches, reports
`ui ready: 45 keys rendered`, and computes correctly from the physical
keyboard — verified end to end, not just in unit tests.

---

## Orientation

Dependencies point **downward only**; the UI never reaches past `calculator.js`.

```
ui/input.js  ui/render.js  ui/faceplate.css  ui/index.html
─────────── press() / render() is the only crossing point ───────────
engine/calculator.js   state machine: 2nd layer, menus, editing, history
engine/stats.js        1-var / 2-var statistics
engine/format.js       Value -> DisplayModel, notation modes, MathPrint
engine/eos.js          entry-line tree -> evaluated Value
engine/value.js        exact rationals, pi-multiples, floats
engine/tokens.js       the key table (shared with the UI)
```

The whole design rests on one contract:

```js
press(state, keyId) -> state      // pure
render(state)       -> DisplayModel
```

`press` takes a **key id**, never a meaning — pressing `'second'` just sets a
flag, and the next press resolves the 2nd layer, exactly as the hardware does.
Because both functions are pure, every behaviour in the spec is testable as
"press these keys, check the screen", and any bug you hit in practice can be
reported as a one-line test.

### Adding a key end to end

1. It is already in `tokens.js` (all 45 are) — the faceplate picks it up for free.
2. Handle its id in `calculator.js`, in both the plain and 2nd-armed branches.
3. If it produces math, add a Node type in `eos.js`.
4. If it changes how things look, extend the `Layout` tree in `format.js`.
5. Add a keyboard binding in `src/ui/input.js` and to the table in `README.md`.

---

## Build, run, test

```bash
node --test 'test/**/*.test.js'                  # engine tests — the gate
./build.sh                         # -> dist/TI-34 MultiView.app
open "dist/TI-34 MultiView.app"
open src/ui/index.html             # the UI alone, in a browser
```

**Xcode is not installed on the development machine and is not required.**
Command Line Tools only: `xcodebuild` does not exist, so the app is compiled
with `swiftc` directly against the CLT SDK (which does ship AppKit and WebKit).
Do not introduce an `.xcodeproj`.

### Two traps that cost real time to find

**ES modules will not load over `file://`.** WebKit (and every browser)
CORS-checks `<script type="module">` fetches, and a `file://` origin can never
satisfy that check — not even for an import from the *same* directory. A
classic non-module `<script src>` to the identical file succeeds, which makes
this confusing to diagnose. Consequences:

- The app serves its bundle over a custom `ti34resource://` scheme handler in
  `main.swift` rather than using `loadFileURL(_:allowingReadAccessTo:)`. That
  API does grant filesystem read access, but it does not change the origin, so
  it does not fix the module fetch. Don't "simplify" it back.
- To open the UI in a browser you must serve it: `python3 -m http.server 8000`,
  then `http://localhost:8000/src/ui/index.html`. Double-clicking the file
  silently renders a dead page.

**Keyboard mappings are silently wrong until they bite.** `+` was wired to
divide for a while, because README's table listed `+ - * /` against the
operators in the calculator's physical column order and that read as a
positional pairing. `test/input-map.test.js` now pins every binding. If you
add a key, add it there too.

**Browser automation cannot test the keyboard here.** Synthetic keystrokes
from the automation tool arrive with empty `key`/`code`. Dispatch
`new KeyboardEvent('keydown', {key: '+'})` from page JS instead, or test the
exported maps directly in Node.

**Screenshots:** `screencapture` needs Screen Recording permission that the
agent shell does not have, but headless Chrome works and is how
`docs/screenshot.png` was made:

    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
      --screenshot=/tmp/shot.png --window-size=900,1680 \
      --force-device-scale-factor=2 --virtual-time-budget=3000 \
      http://localhost:8731/src/ui/index.html

**`node --test test/` fails on Node 22.** A bare directory argument is resolved
as a *module* path (`Cannot find module .../test`). Use the glob form,
`node --test 'test/**/*.test.js'`, which is what `npm test` and CI now run.

There are no third-party dependencies anywhere — no npm packages, no Electron,
no CDN links. Keep it that way; it is why the thing builds from a clean
checkout with one command.

---

## Known divergences from the real TI-34

These are known gaps, not undiscovered bugs. The list at the foot of
`calculator.js` is the authoritative version; keep the two in step.

- **The cursor renders at the end of the entry line**, not at its true
  position inside a MathPrint fraction or exponent. Placing it properly needs
  a mapping from the cursor path to a rendered column, which `format.js` does
  not expose yet.
- **The `data` editor (spec 6.1) is not wired.** Its menu opens, but cell
  editing and list conversions are missing, so 1-Var/2-Var statistics cannot
  be run from the keypad. `stats.js` itself is complete and tested — this is
  purely the editing UI.
- **`rand` / `randint(` do nothing** — the PRB menu's RAND tab is present but
  the expression layer has no random-number support.
- **`2nd [,]` is not wired**, so the two-argument forms of `round`, `lcm`,
  `gcd`, `min`, `max`, `remainder` and `randint(` cannot be entered.
- **`x10ⁿ` enters `× 10 ^ n`** rather than eos.js's `sci` node. It evaluates
  identically and stays editable; only the internal representation differs.
- **`rand`/`randint` are not implemented** in the expression layer.

Open questions inherited from the guidebook itself are in
`docs/TI-34-SPEC.md` section 8 — most notably the exact OVERFLOW threshold
and the rounding rule for the 10th displayed digit.

---

## Conventions

- **Test-first.** Write the failing test naming its spec section
  (`test('spec 5.2 — implicit multiplication is left to right', ...)`), watch
  it fail, then implement. The spec's worked examples are the best tests
  because they ship with TI's own expected output.
- Engine code is pure and imports nothing from the UI.
- Errors are thrown as `CalcError` carrying one of the exact strings in spec
  5.11; only `calculator.js` catches them.

---

## Next action

The app is usable. The highest-value remaining work, in order:

1. **The data editor** — the last substantial feature, and the one a stats
   question in the exam would need. `stats.js` is ready; this is the editing
   screen and `2nd [stat]`'s setup/CALC flow.
2. **True cursor placement** inside MathPrint structures.
3. **`2nd [,]`** and the two-argument functions.

Before trusting any of it in anger, work through a past paper on it and
compare against a real TI-34 where you can. Anything that differs is a bug
worth a one-line test — `press` and `render` are pure, so any misbehaviour
reproduces as a key sequence plus an expected screen.
