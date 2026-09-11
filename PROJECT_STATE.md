# Project state

**Read this first if you are picking this work up cold.** It is rewritten at
the end of every work session so that a new person — or a new agent with no
conversation history — can continue without needing to reconstruct context.

Last updated: 2026-09-10 · commit `5828782` · branch `main`

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

- Repo, CI (`node --test` on Linux + a real `./build.sh` on macOS), README,
  licence note, `.gitignore`.
- `docs/TI-34-SPEC.md` — full behavioural spec.
- `docs/ARCHITECTURE.md` — module contracts.
- `src/engine/tokens.js` — the 45-key table, verified for duplicate ids and
  grid collisions. **Single source of truth for the layout**: the UI builds the
  faceplate by iterating this, and the engine takes key ids from it.

### In progress

| Unit | Files | Status |
|---|---|---|
| Math core | `src/engine/value.js`, `src/engine/eos.js` | in progress |
| macOS shell | `mac/main.swift`, `build.sh` | in progress |
| Faceplate | `src/ui/index.html`, `src/ui/faceplate.css` | in progress |

### Not started

| Unit | Files | Depends on |
|---|---|---|
| Display formatting | `src/engine/format.js` | `value.js` |
| Statistics | `src/engine/stats.js` | `value.js` |
| State machine | `src/engine/calculator.js` | `eos.js`, `format.js` |
| Render + input | `src/ui/render.js`, `src/ui/input.js` | `calculator.js`, faceplate DOM |

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
node --test test/                  # engine tests — the gate
./build.sh                         # -> dist/TI-34 MultiView.app
open "dist/TI-34 MultiView.app"
open src/ui/index.html             # the UI alone, in a browser
```

**Xcode is not installed on the development machine and is not required.**
Command Line Tools only: `xcodebuild` does not exist, so the app is compiled
with `swiftc` directly against the CLT SDK (which does ship AppKit and WebKit).
Do not introduce an `.xcodeproj`.

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

Finish the three in-progress units, then build `format.js` and `stats.js`
against `value.js`, then `calculator.js`, then wire `render.js` and `input.js`
to the faceplate DOM.
