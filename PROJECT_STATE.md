# Project state

**Read this first if you are picking this work up cold.** It is rewritten at
the end of every work session so that a new person — or a new agent with no
conversation history — can continue without needing to reconstruct context.

Last updated: 2026-09-10 · commit `92b6070` · branch `main` · CI green · 217 tests

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

### Done

- Repo, CI (engine tests on Linux + a real `./build.sh` on macOS) — **green**.
- `docs/TI-34-SPEC.md`, `docs/ARCHITECTURE.md` — the two governing documents.
- `src/engine/tokens.js` — 45-key table, single source of truth for the layout.
- `src/engine/value.js`, `src/engine/eos.js` — math core. Read the Node-shape
  contract in `eos.js`'s header before touching anything that builds entries.
- `src/engine/stats.js` — 1-var and 2-var statistics. The guidebook's
  braking-distance dataset is a test and reproduces its published regression
  to all ten displayed digits.
- `src/engine/format.js` — Value -> Layout, notation modes, MathPrint.
- `mac/main.swift`, `build.sh` — the app builds, launches and reports
  `ui ready: 45 keys rendered` from inside the bundle.
- `src/ui/index.html`, `src/ui/faceplate.css` — the faceplate replica. Palette
  sampled from a production-unit photograph.

**217 tests passing.**

### In progress

| Unit | Files |
|---|---|
| Entry-line editing | `src/engine/entry.js` |
| Menu model | `src/engine/menus.js` |
| Renderer + keyboard input | `src/ui/render.js`, `src/ui/input.js` |

### Not started

| Unit | Files | Depends on |
|---|---|---|
| State machine | `src/engine/calculator.js` | everything above; it is the integration point |

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

**`node --test test/` fails on Node 22.** A bare directory argument is resolved
as a *module* path (`Cannot find module .../test`). Use the glob form,
`node --test 'test/**/*.test.js'`, which is what `npm test` and CI now run.

There are no third-party dependencies anywhere — no npm packages, no Electron,
no CDN links. Keep it that way; it is why the thing builds from a clean
checkout with one command.

---

## Known divergences from the real TI-34

Nothing verified yet — the engine isn't finished. Record anything found here so
a later reader doesn't mistake a known gap for a fresh bug.

Open questions inherited from the guidebook itself are in
`docs/TI-34-SPEC.md` section 8. The ones most likely to bite: the exact
OVERFLOW threshold, the rounding rule for the 10th displayed digit, and whether
the data menu tabs read `CLEAR`/`CNVRSN` or `CLR`/`FORMULA` on current
firmware.

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

Build `src/engine/calculator.js`, the last piece. It owns `initialState`,
`press` and `render`, and integrates entry.js, menus.js, eos.js, format.js and
stats.js. Specifically it must own: the 2nd-key flag, the menu stack and acting
on selections, history and previous-entry recall, `ans`, the memory variables
and `sto►`, the `◄►` exact/decimal toggle state, `op1`/`op2` stored operations,
`►simp`, and catching `CalcError` into the error display.

Then hand `render.js` a real `DisplayModel` and confirm a full calculation
works end to end in the app, by keyboard as well as by clicking.
