# Architecture and module contracts

Read `TI-34-SPEC.md` first — it says *what* the calculator does. This file says
*how this codebase is arranged*, and pins the interfaces between modules so
several people (or agents) can work on them independently.

**These signatures are a contract.** If you need to change one, change it here
in the same commit and say so in `PROJECT_STATE.md`.

---

## Layering

```
  src/ui/input.js      physical keyboard + clicks  ──┐
  src/ui/render.js     DisplayModel -> DOM         ──┤  UI layer, no math
  src/ui/faceplate.css + index.html                ──┘

  ────────── the only crossing point: press() / render() ──────────

  src/engine/calculator.js   state machine (2nd layer, menus, editing, history)
  src/engine/stats.js        1-var / 2-var statistics
  src/engine/format.js       Value -> DisplayModel, notation modes, MathPrint
  src/engine/eos.js          tokens -> parse -> evaluate (order of operations)
  src/engine/value.js        exact rationals, pi-multiples, floats
  src/engine/tokens.js       the key table (shared with the UI)
```

Dependencies point **downward only**. `value.js` imports nothing. The UI never
imports anything below `calculator.js`.

---

## The one contract that matters

```js
// src/engine/calculator.js
export function initialState(): State
export function press(state: State, keyId: string): State   // pure
export function render(state: State): DisplayModel          // pure
```

`press` takes a **key id from `tokens.js`** — never a "meaning". Pressing
`'second'` sets a flag on the state; the *next* `press` resolves the 2nd layer.
This mirrors the hardware and keeps the UI free of calculator semantics.

Both functions are **pure**: no dates, no I/O, no mutation of the input. The
sole exception is `rand`, which draws from a seed carried in the state, so even
randomness is reproducible in tests.

Because of this, every behaviour in the spec is testable as:

```js
const out = keys.reduce(press, initialState());
assert.equal(render(out).answer.text, '5.5');
```

Test helpers in `test/helpers.js` wrap that into `run('1 + 2 enter')`.

---

## value.js — numbers

The exact/decimal toggle is not cosmetic, so numbers carry an exact form until
something forces them to collapse.

```js
/**
 * @typedef {{k:'rat',   n: bigint, d: bigint}}  Rat    exact n/d, d > 0
 * @typedef {{k:'pirat', n: bigint, d: bigint}}  PiRat  exact (n/d) * pi
 * @typedef {{k:'float', v: number}}             Flt    approximate
 * @typedef {Rat|PiRat|Flt} Value
 */
```

- `d > 0` always; the sign lives in `n`.
- **Rationals are deliberately NOT auto-reduced.** MODE line 6 defaults to
  `MANSIMP`, where `1/4 + 3/12` must display as `6/12` with the
  not-in-lowest-terms marker, and only `►simp` (or `AUTOSIMP`) reduces it.
  Addition uses the **lcm** of the denominators; multiplication multiplies
  straight through. Reduction is an explicit operation, never a side effect.
- There is **no exact-radical form** on this model — `sqrt(8)` is a float.
  Do not add one.
- `pirat` exists only so `2 × π` can display as `2π` and toggle to
  `6.283185307`. Any operation that cannot stay a pi-multiple collapses to
  `float`.

Required exports:

```js
rat(n, d)            // normalises sign, throws on d === 0n
pirat(n, d)
flt(v)
fromDigits(str)      // '3.25' -> rat(325n, 100n)
add(a, b) sub(a, b) mul(a, b) div(a, b)   // -> Value, may collapse to float
neg(a) abs(a)
pow(base, exp) root(index, radicand)
toNumber(v)          // collapse to JS number, applying round13
isExact(v)           // true for rat and pirat
reduce(v)            // lowest terms
simpBy(v, k)         // divide n and d by k; used by ►simp
lowestPrimeFactor(v) // for bare `►simp enter`
cmp(a, b)
ROUND_DIGITS = 13    // significant digits carried internally
round13(x)           // round a JS number to 13 significant digits
```

`round13` is applied on every float-producing operation so the emulator
accumulates error the way the hardware does (13 carried, 10 shown).

### Errors

Math errors are thrown as `CalcError`, defined in `value.js`:

```js
export class CalcError extends Error {
  constructor(code) { ... }   // code is one of the exact strings in the spec
}
```

`code` must be one of: `ARGUMENT`, `DIVIDE BY 0`, `DOMAIN`, `EQUATION LENGTH`,
`FRQ DOMAIN`, `OVERFLOW`, `STAT`, `CONVERSION`, `SYNTAX`, `OP NOT DEFINED`,
`MEMORY LIMIT`. `calculator.js` catches these and turns them into the error
display state; nothing below `calculator.js` catches them.

---

## eos.js — the expression layer

```js
export function evaluate(nodes: Node[], ctx: EvalContext): Value
```

`nodes` is the **entry-line model** built by `calculator.js` (see below), not a
string. `EvalContext`:

```js
{
  angle:   'DEG' | 'RAD',
  classic: boolean,    // changes ^ associativity — see spec 5.1
  vars:    { x: Value, y: Value, z: Value, t: Value, a: Value, b: Value, c: Value },
  ans:     Value,
  stats:   StatVars | null,
  randSeed: bigint,
}
```

Precedence is the 11-level table in spec 5.1. Two things are easy to get wrong
and are explicitly tested:

- `^` is **left**-associative in Classic (`2^3^2` = 64) and **right**-
  associative in MathPrint (`2^3^2` = 512).
- Implicit multiplication has the **same** precedence as `×` and `÷`, so
  `8 ÷ 2π` = `(8÷2)·π` = 12.566…, **not** `8÷(2π)`.

---

## The entry-line model

The entry line is a tree, because MathPrint fractions and radicals nest.

```js
/**
 * @typedef {object} Node
 * @property {string} t     'digit' | 'op' | 'func' | 'frac' | 'sqrt' | 'pow' | 'paren' | 'var' | 'const' | ...
 * @property {string} [v]   literal text for digits/operators
 * @property {Node[]} [num] fraction numerator      (t === 'frac')
 * @property {Node[]} [den] fraction denominator    (t === 'frac')
 * @property {Node[]} [arg] radicand / argument
 * @property {Node[]} [idx] root index              (t === 'root')
 * @property {Node[]} [exp] exponent                (t === 'pow')
 */
```

The cursor is a **path** into this tree: `{path: number[], offset: number}`.
`DOWN` inside a fraction moves numerator -> denominator (spec 5.5); that is a
cursor move, not a new node.

---

## format.js — Value to pixels-worth-of-text

```js
export function formatValue(v: Value, mode: ModeState): Layout
export function formatEntry(nodes: Node[], mode: ModeState): Layout
```

A `Layout` is a small tree the renderer can draw in either MathPrint or Classic
without knowing any math:

```js
/**
 * @typedef {object} Layout
 * @property {'text'|'frac'|'sup'|'radical'|'row'} t
 * @property {string} [text]
 * @property {Layout[]} [items]        (t === 'row')
 * @property {Layout} [num] [den]      (t === 'frac')
 * @property {Layout} [base] [sup]     (t === 'sup')
 * @property {Layout} [arg] [index]    (t === 'radical')
 */
```

`ModeState` is the six MODE lines from spec 3:

```js
{ angle: 'DEG'|'RAD', notation: 'NORM'|'SCI', decimals: 'FLOAT'|0..9,
  entry: 'CLASSIC'|'MATHPRINT', fracStyle: 'Un/d'|'n/d', simp: 'MANSIMP'|'AUTOSIMP' }
```

---

## DisplayModel — what the UI draws

```js
/**
 * @typedef {object} DisplayModel
 * @property {Line[]}  lines       up to 4; each { layout: Layout, align: 'left'|'right' }
 * @property {object}  indicators  { second, fix, sci, deg, rad, L1, L2, L3, busy,
 *                                   scrollUp, scrollDown, scrollLeft, scrollRight }
 * @property {?object} cursor      { line, col, style: 'block'|'underline' }
 * @property {?string} error       an exact error string from the spec, or null
 * @property {?object} menu        { title, tabs, items, selected } when a menu is open
 */
```

The renderer draws exactly this and nothing else. If the UI needs a new fact
about calculator state, it goes in `DisplayModel` — the UI never reaches into
`State`.

---

## Testing

`node --test 'test/**/*.test.js'` — no dependencies, no config.

Every test is a key sequence plus an expected display. Write the test from
`TI-34-SPEC.md` (cite the section in the test name), watch it fail, then
implement. Worked examples in the spec are the highest-value tests because they
come with TI's own expected output.

```js
test('spec 5.2 — implicit multiplication is left to right', () => {
  assert.equal(answerOf(run('8 ÷ 2 π enter')), '12.56637061');
});
```
