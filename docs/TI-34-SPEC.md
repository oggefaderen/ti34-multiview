# TI-34 MultiView — Behavioural Specification

Authoritative reference for this emulator, compiled from the official TI
guidebook (2019 revision) and production-hardware photographs at the Datamath
Calculator Museum. **When implementation and this document disagree, this
document wins** — unless hardware evidence says otherwise, in which case update
this file in the same commit.

Sources:
- TI-34 MultiView Guidebook (education.ti.com, PDF)
- Datamath Calculator Museum: TI-34 MV specs, faceplate and display photos

---

## 0. Hardware characteristics

| Property | Value |
|---|---|
| Display | LCD dot matrix, 96 x 31 addressable pixels |
| Text capacity | 4 lines x 16 characters (normal font) |
| Menu capacity | 5 lines x 19 characters (narrower menu font) |
| Internal precision | 13 significant digits |
| Displayed precision | 10 digits |
| Memory variables | 7 (x y z t a b c) |
| Lists | 3 lists x 42 items |
| Pending operations | max 23 (else MEMORY LIMIT) |
| Entry length | max 88 digits; 47 in stat/constant entries |

---

## 1. Key layout

5 columns x 9 rows. The arrow pad is a single physical unit occupying
columns 4-5 of rows 1-2.

Each cell below shows the **2nd function on the first line** and the
**primary key label on the second line**.

```
        col 1            col 2            col 3            col 4            col 5
      +---------------+----------------+---------------+----------------------------------+
row 1 |   (no 2nd)    |     quit       |    insert     |                                  |
      |     2nd       |     mode       |    delete     |            UP                    |
      +---------------+----------------+---------------+      LEFT (pad) RIGHT            |
row 2 | n/d <-> U n/d |    f <-> d     |      >%       |           DOWN                   |
      |    U n/d      |      n/d       |       %       |                                  |
      +---------------+----------------+---------------+---------------+------------------+
row 3 |   (no 2nd)    |     angle      |      log      |     stat      |    (no 2nd)      |
      |    >simp      |     math       |      prb      |     data      |      clear       |
      +---------------+----------------+---------------+---------------+------------------+
row 4 |     trig      |      1/x       |    set op1    |    set op2    |      int/        |
      |      pi       |     x10^n      |      op1      |      op2      |        /         |
      +---------------+----------------+---------------+---------------+------------------+
row 5 |   (no 2nd)    |    (no 2nd)    |   (no 2nd)    |   (no 2nd)    |    (no 2nd)      |
      |      x^2      |      sqrt      |       (       |       )       |        x         |
      +---------------+----------------+---------------+---------------+------------------+
row 6 |    x-root     |                |               |               | contrast down    |
      |       ^       |       7        |       8       |       9       |        -         |
      +---------------+----------------+---------------+---------------+------------------+
row 7 |   clear var   |                |               |               |  contrast up     |
      | x y z t a b c |       4        |       5       |       6       |        +         |
      +---------------+----------------+---------------+---------------+------------------+
row 8 |    recall     |                |               |               |    (no 2nd)      |
      |     sto>      |       1        |       2       |       3       |       <->        |
      +---------------+----------------+---------------+---------------+------------------+
row 9 |      off      |     reset      |       ,       |      ans      |    (no 2nd)      |
      |      on       |       0        |       .       |      (-)      |      enter       |
      +---------------+----------------+---------------+---------------+------------------+
```

### Faceplate colours (production unit)

- Body / faceplate: **dark teal-navy**.
- **2nd-function labels are printed in light grey/white** directly above each
  key. They are **NOT yellow** — do not copy the TI-84 convention.
- `2nd` key: white/cream.
- Digit keys `0`-`9`, `.`, `(-)`: white.
- `/ x - +`, the arrow pad, `<->` and `enter`: dark blue-violet.
- All other function keys: mid-blue.
- `<->` sits directly above `enter` in a merged dark bezel.

### Key notes

- `x y z t a b c` (row 7 col 1) is printed as a stacked glyph: italic *x* with
  `y z t` on the upper line and `a b c` on the lower. Pressing it repeatedly
  cycles x -> y -> z -> t -> a -> b -> c.
- Contrast has no word label: the 2nd positions above `-` and `+` are
  half-filled circle icons. `2nd` `+` darkens, `2nd` `-` lightens.
- Keys with **no** second function: `sqrt`, `x^2`, `(`, `)`, `x`, `>simp`,
  `clear`, `<->`, `enter`, `2nd`.
- This model has **no** hyperbolics, no base-n, no complex numbers, no unit
  conversions, no log-base-b, and **no GRAD angle mode**.

---

## 2. Display behaviour

### 2.1 Lines, entry and answer

- Home screen: up to 4 lines of 16 characters.
- Entries longer than 16 characters scroll horizontally with LEFT / RIGHT.
- On `enter`, the answer appears either directly right of the entry on the same
  line, or right-aligned on the next line, depending on available space.
- Answers are always right-aligned; entries left-aligned.
- History accumulates upward; older pairs scroll off the top.
- MathPrint allows up to **four levels** of nested consecutive fractions,
  square roots, `^` exponents, `x-root` and `x^2`.

### 2.2 Indicators (top annunciator row)

| Indicator | Meaning |
|---|---|
| `2ND` | 2nd key armed |
| `FIX` | fixed-decimal setting active |
| `SCI` | scientific notation mode active |
| `DEG` / `RAD` | angle mode (only these two) |
| `L1` `L2` `L3` | shown above columns in Data editor / list conversions |
| hourglass | busy |
| up / down arrows | history exists above/below the visible area |
| left / right arrows | entry or menu extends beyond 16 chars |

### 2.3 Previous-entry recall

- UP / DOWN move a highlight through previous entries on the Home screen.
- `enter` on a highlighted entry **pastes it onto the bottom entry line** for
  editing and re-evaluation.
  Worked example: enter `1+1`, `2+2`, `3+3`, `4+4`; press UP x4 then `enter`
  pastes `3+3`; typing `+2` `enter` yields `3+3+2` -> `8`.
- `2nd` UP jumps to the previous entry; again jumps to the **oldest** entry.
- `2nd` DOWN moves back below the last entry (to the live entry line).
- `clear` on a highlighted history entry deletes that entry.
- History survives power-off. It is **erased** by `2nd [reset]` and by
  switching between Classic and MathPrint (which also clears op1/op2).

### 2.4 MathPrint rendering

Stacked fractions (numerator over a horizontal bar), mixed numbers as unit plus
stacked fraction, superscript exponents, radicals with a vinculum over the
radicand, and a small pre-superscript index for `x-root`.

Classic renders everything on one line: `2^5`, `3 sqrt(64)`, `1/8`.

---

## 3. MODE menu

`mode` opens a 6-line menu shown 4 lines at a time with scroll arrows.
Navigate with arrows, select with `enter`, leave with `clear` or `2nd [quit]`.
The current setting is shown in **inverse video**.

| Line | Options | Default |
|---|---|---|
| 1 | `DEG` `RAD` | **DEG** |
| 2 | `NORM` `SCI` | **NORM** |
| 3 | `FLOAT` `0123456789` | **FLOAT** |
| 4 | `CLASSIC` `MATHPRINT` | **MATHPRINT** |
| 5 | `Un/d` `n/d` | **Un/d** |
| 6 | `MANSIMP` `AUTOSIMP` | **MANSIMP** |

- **DEG / RAD** — angle mode; affects both input interpretation and result unit.
- **NORM / SCI** — display notation only; stored values keep full precision.
- **FLOAT / 0-9** — FLOAT shows up to 10 digits plus sign and decimal point;
  a digit fixes that many decimal places and lights `FIX`.
- **CLASSIC / MATHPRINT** — see 2.4. Switching **clears history and op1/op2**.
- **Un/d / n/d** — mixed number vs simple fraction display. Default `Un/d`:
  `1/2 + 3/4` -> `1 1/4`; `2nd [n/d<->Un/d]` converts it to `5/4`.
- **MANSIMP / AUTOSIMP** — `MANSIMP` (default) leaves fractions unsimplified and
  shows a **down-arrow marker next to the result** meaning "not in lowest
  terms"; reduce manually with `>simp`. `AUTOSIMP` reduces automatically
  (`1/4 + 3/12` -> `1/2`).

---

## 4. Menus

### 4.1 Navigation model

Menus are single-panel or two-tab. Two-tab menus show both tab names on the top
line, active tab in inverse video, switched with LEFT / RIGHT. Within a panel,
UP / DOWN move the highlight, or press the **item number directly** (`1`-`9`,
then letters `A`..`H` for long lists such as 2-Var StatVars). `enter` selects.
`clear` backs out one screen; `2nd [quit]` exits to Home.

Menu-opening keys: `prb`, `2nd [angle]`, `2nd [log]`, `2nd [trig]`, `math`,
`data data`, `2nd [stat]`, `2nd [reset]`, `2nd [recall]`, `2nd [clear var]`.

### 4.2 prb

```
PRB            RAND
1: nPr         1: rand
2: nCr         2: randint(
3: !
```

- `nPr`, `nCr` — infix; n and r positive integers. `8 nPr 3` -> `336`;
  `52 nCr 5` -> `2598960`.
- `!` — postfix factorial; whole number **<= 69**.
- `rand` — uniform real in (0,1). Store an integer seed >= 0 into `rand` with
  `sto>` for a reproducible sequence; the seed re-randomises after each draw.
- `randint(A,B)` — integer with A <= result <= B; arguments separated by
  `2nd [,]`.

### 4.3 2nd [angle]

```
DMS            R <-> P
1: deg         1: R>Pr(
2: '           2: R>Ptheta(
3: "           3: P>Rx(
4: r           4: P>Ry(
5: >DMS
```

`deg`, `'`, `"`, `r` are **postfix unit modifiers**: they force the preceding
value to be read in that unit, but the **result is still reported in the
current angle mode**. `>DMS` converts a decimal angle to degrees-minutes-
seconds (`1.5 >DMS` -> `1deg30'0"`).

### 4.4 2nd [log]

```
LOG            LN
1: log(        1: ln(
2: 10^(        2: e^(
```

e = 2.718281828459.

### 4.5 2nd [trig]

```
TRIG
1: sin(     2: cos(     3: tan(
4: sin^-1(  5: cos^-1(  6: tan^-1(
```

Prefix functions requiring a closing `)`.

### 4.6 math

```
MATH                 NUM
1: lcm(              1: abs(
2: gcd(              2: round(
3: ^3  (cube)        3: iPart(
4: cbrt(             4: fPart(
                     5: min(
                     6: max(
                     7: remainder(
```

Two-argument functions take `value1 , value2` separated by `2nd [,]`.
`round(n,digits)`.

### 4.7 data / data data

`data` opens the Data editor. `data` again opens:

```
CLEAR              CNVRSN
1: Clear L1        1: Add/Edit Cnvrs
2: Clear L2        2: Clear L1 Cnvrs
3: Clear L3        3: Clear L2 Cnvrs
4: Clear ALL       4: Clear L3 Cnvrs
                   5: Clear ALL
```

Inside Add/Edit Cnvrs, pressing `data` opens a list picker:
`Ls  1: L1  2: L2  3: L3`.

> Known ambiguity: two screenshots in the 2019 guidebook label these tabs
> `CLR` / `FORMULA` (apparently borrowed from TI-30XS MultiView docs), while the
> TI-34 body text consistently says `CLEAR` / `CNVRSN`. We implement
> `CLEAR` / `CNVRSN`.

### 4.8 2nd [stat]

```
STATS
1: 1-Var Stats
2: 2-Var Stats
3: StatVars      <- present only after a 1-Var or 2-Var calculation
```

### 4.9 Small confirmation menus

```
2nd [reset]        2nd [recall]        2nd [clear var]
Reset              Recall Var          Clear Var
1: No              1: x =              1: Yes
2: Yes             2: y =              2: No
                   3: z =
                   4: t =
                   5: a =
                   6: b =
                   7: c =
```

Note the deliberate asymmetry: **Reset lists `No` first, Clear Var lists `Yes`
first.** Recall Var shows each variable's current value inline, e.g.
`1: x=196000`.

---

## 5. Math semantics

### 5.1 EOS order of operations

Within a priority level, evaluation is **left to right**.

| Priority | Operations |
|---|---|
| 1 | expressions inside parentheses |
| 2 | prefix functions needing a closing `)` — `sin`, `log`, R<->P items, etc. |
| 3 | fractions |
| 4 | postfix functions — `x^2`, angle unit modifiers (`deg`, `'`, `"`, `r`) |
| 5 | exponentiation `^` and roots `x-root` |
| 6 | negation `(-)` |
| 7 | `nPr`, `nCr` |
| 8 | multiplication, **implied multiplication**, division |
| 9 | addition, subtraction |
| 10 | conversions — `n/d<->Un/d`, `f<->d`, `>DMS` |
| 11 | `enter` completes all operations and closes all open parentheses |

Two exponentiation subtleties that **must** be implemented:

- `^` associativity **depends on the mode**: in **Classic**, `2^3^2` = `(2^3)^2`
  = **64**; in **MathPrint**, `2^3^2` = `2^(3^2)` = **512**.
- `x^2` always evaluates **left to right in both modes**: `3 x^2 x^2` = `(3^2)^2`
  = **81**.
- An expression used as an exponent via `^` must be parenthesised.

### 5.2 Implicit multiplication

Implied multiplication has the **same precedence as explicit `x` and `/`**
(level 8), so it is purely left-to-right. There is **no** "juxtaposition binds
tighter" rule. `8 / 2pi` evaluates as `(8/2) * pi`.

### 5.3 Negation vs subtraction

`(-)` is a distinct unary key producing a **raised minus glyph**, visually
narrower and higher than the binary `-`. Guidebook examples render as
`60+5x^-12` and `1+^-8+12`. Negation is priority 6, **below** exponentiation,
so `(-)3 x^2` = `-9`.

### 5.4 The `<->` answer toggle

A single key, no `2nd` prefix. Toggles the **most recent answer** between
fraction <-> decimal, and exact pi-multiple <-> decimal.

It **adds a new line to the history** showing the original answer with a `<->`
marker appended, and the toggled value as the new answer.
Example: `2 x pi` `enter` -> `2pi`; `<->` -> a line `2pi<->` with result
`6.283185307`. `pi x 12^2` -> `144pi`, toggled -> `452.3893421`.

**There is no exact-radical arithmetic on this model** — `sqrt(8)` returns
`2.828427125`, not `2 sqrt(2)`. In **Classic** mode, pi expressions display as
decimal approximations rather than exact pi-multiples.

### 5.5 Fractions

Keys: `n/d`, `U n/d`, `2nd [n/d<->Un/d]`, `>simp`, `2nd [f<->d]`.

- **`n/d`** enters a simple fraction. Pressed *after* a number, that number
  becomes the numerator; pressed *before* typing anything it gives an empty
  template (required for operators inside the numerator; MathPrint only).
  MathPrint: DOWN moves numerator -> denominator. Classic: press `n/d` again.
- **`U n/d`** enters a mixed number: `U n/d` between unit and numerator, then
  DOWN (MathPrint) or `n/d` (Classic) between numerator and denominator.
- **MathPrint fractions** may contain operation keys (`+`, `x`, ...) and most
  function keys (`x^2`, `%`, ...). **Classic fractions may not** contain
  operators, functions or complex fractions — use `/` instead. The same
  restriction applies inside the Data editor.
- **`>simp`**: `>simp n enter` divides numerator and denominator by the positive
  integer `n`. `>simp enter` alone divides by the **lowest common prime factor**
  and displays which factor was used. Repeat until fully reduced.
- **`2nd [n/d<->Un/d]`** converts between simple fraction and mixed number.
- **`2nd [f<->d]`** converts between fraction and decimal
  (`4 U 1/2  f<->d` -> `4.5`).
- **MANSIMP marker**: an unsimplified result shows a down-arrow immediately
  beside it.

### 5.6 ans

- The most recent result is stored in `ans`, retained through power-off.
- Recall with `2nd [ans]`, or implicitly by starting an entry with any operator
  key (`+ - x /` ...) — the display then shows `ans` followed by that operator.
- `int/` stores **only the quotient** to `ans`, not the remainder.

### 5.7 Memory variables

Seven: **x, y, z, t, a, b, c**.

- **Store:** `value` `sto>` then press `x y z t a b c` repeatedly to select,
  then `enter`. Displays as e.g. `340x610->y`.
- **Recall by name:** press `x y z t a b c` inside an expression — the *name* is
  inserted and its value used at evaluation time.
- **Recall by menu:** `2nd [recall]` lists all seven with current values;
  selecting pastes the **value**.
- **Clear all:** `2nd [clear var]` -> `1: Yes`.
- `rand` can also be a store target (to seed it).

### 5.8 Percent

- **`%`** (unshifted) appends a percent sign to the number just typed, meaning
  divide by 100: `2% x 150` -> `3`; `3% x 5000` -> `150`.
- **`2nd [>%]`** is a postfix conversion expressing a value as a percentage:
  `1/5 >%` -> `20%`.

### 5.9 Integer divide

`2nd [int/]` between two positive integers displays quotient and remainder as
`5r2` (`17 int/ 3` -> `5r2`). Only the quotient goes to `ans`.

### 5.10 Angle mode effects

Trig inputs/outputs follow DEG/RAD. An angle unit modifier (`deg`, `'`, `"`,
`r`) makes that calculation use that unit, but the **result is still expressed
in the current mode**. In RAD mode `sin(30deg)` = `0.5`; `2pi^r` displays as
`360` in DEG mode.

### 5.11 Error messages (exact on-screen strings)

`clear` dismisses; the previous screen returns with the cursor at or near the
error.

| Message | Cause |
|---|---|
| `ARGUMENT` | wrong number of arguments to a function |
| `DIVIDE BY 0` | division by zero |
| `DOMAIN` | argument out of range — see below |
| `EQUATION LENGTH` | entry exceeds 88 digits (entry line) or 47 (stat/constant) |
| `FRQ DOMAIN` | FRQ value in 1-var statistics < 0 |
| `OVERFLOW` | entered or computed number beyond range |
| `STAT` | stats with no data points, or 2-var with unequal list lengths |
| `CONVERSION` | list conversion lacks an `L1`/`L2`/`L3` name followed by a conversion, or a function such as `L1 + 3` was entered |
| `SYNTAX` | misplaced functions, arguments, parentheses or commas |
| `OP NOT DEFINED` | `op1`/`op2` recalled but never set |
| `MEMORY LIMIT` | more than 23 pending operations; or, with op1/op2, more than four levels of nested fractions/radicals/`^`/`x-root`/`x^2` (MathPrint) |
| `LOW BATTERY` | displays briefly and self-dismisses; `clear` does not clear it |

`DOMAIN` specifically covers: `x-root y` with x=0, or y<0 and x not an odd
integer; `sqrt(x)` with x<0; `log`/`ln` with x <= 0; `tan` at +/-90, +/-270,
450 degrees (and radian equivalents); `sin^-1`/`cos^-1` with |x|>1; `nCr`/`nPr`
with n or r not integers >= 0; `>simp` with factor 0, factor >= 1e10, or applied
to a non-fraction.

### 5.12 Clearing and correcting

| Key | Effect |
|---|---|
| `clear` | clears characters and error messages; clears the entry line, then the display on a second press; backs out one screen inside applications; deletes a highlighted history entry |
| `delete` | deletes the character at the cursor |
| `2nd [insert]` | inserts a character at the cursor |
| `2nd [clear var]` | clears x, y, z, t, a, b, c |
| `2nd [reset]` | full reset: default modes, cleared variables, pending operations, history, application state, statistical data, op1/op2 and ans |

### 5.13 Stored operations (op1 / op2)

`2nd [set op1]` / `2nd [set op2]`, then type any operation (numbers, operators,
menu items with arguments), then `enter`. The set screen displays e.g.
`op1=x2+3`.

Afterwards, pressing `op1` or `op2` recalls and **immediately evaluates** it
against the current value — **no `enter` needed** — and shows a repetition
counter: `4x2+3  n=1  11`, then `6x2+3  n=1  15`. Repeatedly pressing the same
op key chains it on the previous result and increments `n`:
`1x10 n=1 10` -> `10x10 n=2 100` -> `100x10 n=3 1000`.

---

## 6. Statistics

### 6.1 Data entry

`data` opens the Data editor: three columns headed `L1`, `L2`, `L3`, each
holding up to **42 items**. A bottom author/status line shows the active cell as
e.g. `L1(5)=`. Navigate with arrows; `2nd` UP jumps to the top of a column,
`2nd` DOWN to the first blank row.

List elements display according to numeric-notation, decimal-notation and
angle-mode settings (except fractional elements), and column width forces
rounding — the guidebook shows `0.777777...` displaying as `0.77778`.

**List conversions:** `data data` -> `CNVRSN` -> `Add/Edit Cnvrs` attaches a
formula to a list. Accepted conversions are `f<->d`, `>%`, `>Simp`,
`n/d<->Un/d`. The author line shows e.g. `.L2=L1 f<->d`, a bullet marks the
conversion-driven list, and the target recalculates live as the source is
edited.

### 6.2 Running a calculation

1. Enter data into L1/L2/L3.
2. `2nd [stat]`, choose `1-Var Stats` or `2-Var Stats`, `enter`.
3. Setup screen:
   - **1-Var:** `1-VAR STATS` / `DATA: L1 L2 L3` / `FRQ: ONE L1 L2 L3` /
     `CALC` (right-aligned on the last line)
   - **2-Var:** `2-VAR STATS` / `xDATA: L1 L2 L3` / `yDATA: L1 L2 L3` / `CALC`
     (no FRQ for 2-var)
4. Highlight `CALC` and `enter`.
5. Results screen with a header naming the source, e.g. `1-Var:L1,ONE` or
   `2-Var:L1,L2`, then a numbered scrollable list.
6. Return later via `2nd [stat]` -> `3: StatVars`; selecting an item pastes it
   into the current expression (`xbar x 2` -> `105`).
7. Clear data with `data data`, pick a list, `enter`.

### 6.3 Statistics computed

| Name | Meaning |
|---|---|
| `n` | number of x or (x,y) data points |
| `xbar` / `ybar` | mean of x / y |
| `Sx` / `Sy` | **sample** standard deviation (divisor n-1) |
| `sigmax` / `sigmay` | **population** standard deviation (divisor n) |
| `Sum x` / `Sum y` | sum of values |
| `Sum x^2` / `Sum y^2` | sum of squares |
| `Sum xy` | sum of x*y over all pairs |
| `a` | linear regression slope |
| `b` | linear regression y-intercept |
| `r` | correlation coefficient |
| `x'` | predicted x from a given y (2-Var only) |
| `y'` | predicted y from a given x (2-Var only) |

**StatVars menu ordering** (indexes 1-9 then letters A-H):

- *1-Var (6 items):* `1: n`, `2: xbar`, `3: Sx`, `4: sigmax`, `5: Sum x`,
  `6: Sum x^2`
- *2-Var (17 items):* `1: n`, `2: xbar`, `3: Sx`, `4: sigmax`, `5: ybar`,
  `6: Sy`, `7: sigmay`, `8: Sum x`, `9: Sum x^2`, `A: Sum y`, `B: Sum y^2`,
  `C: Sum xy`, `D: a`, `E: b`, `F: r`, `G: x'`, `H: y'`

Regression model is **least squares**, written `y' = a*x' + b`. `x'` and `y'`
are used as functions: `y'(55)` `enter` -> `18.58651222`.

---

## 7. Number formatting

- **Precision:** 13 significant digits internally, **10 displayed**. Canonical
  illustration: pi is 3.141592653590 for calculation, `3.141592654` displayed.
- **FLOAT:** up to 10 digits plus sign and decimal point.
- **FIX 0-9:** fixes decimal places and lights `FIX`. Display only — stored
  values keep full precision.
- **SCI:** one digit before the decimal plus a power of ten, rendered as
  `1.2345678x10^4` with a true superscript in MathPrint and as a literal
  `x10^4` in Classic. Lights `SCI`.
- **`x10^n` key:** shortcut for entering a value in scientific form
  (`2 x10^n 5` -> `2x10^5`). The *result* still displays per the notation mode,
  so in NORM it shows `200000`.
- **`E` substitution:** in the Data editor and the `2nd [recall]` menu the
  calculator prints `E` instead of the `x10^n` glyph.
- **Exact vs decimal:** results stay exact (as a fraction, or a multiple of pi)
  whenever the input was exact and the arithmetic permits; `<->` switches the
  presentation. Fraction display style and auto-reduction are governed by the
  two MODE lines in section 3. There is no exact-radical form.

---

## 8. Unverified — confirm against hardware before relying on

1. Exact exponent range, and the threshold at which NORM auto-switches to
   scientific notation. (TI scientifics of this family conventionally run to
   about +/-9.999999999e99, but this is **not** stated in the guidebook.)
2. Rounding / tie-breaking rule for the 10th displayed digit.
3. Whether the data menu tabs are `CLEAR`/`CNVRSN` or `CLR`/`FORMULA` on
   current firmware (the 2019 guidebook contradicts itself).
4. StatVars items A and B for 2-Var (`Sum y`, `Sum y^2`) — inferred from the
   variable table ordering, not directly screenshotted.
5. Column width / rounding rule inside the Data editor (appears to be about 5
   significant digits).
