// Statistics engine of the TI-34 MultiView emulator: list storage (the
// `data` editor) and 1-Var / 2-Var statistical computation.
//
// See docs/TI-34-SPEC.md section 6 (statistics) above all, plus 4.7/4.8
// (data/stat menus) and 5.11 (error strings), and docs/ARCHITECTURE.md
// "Layering" for where this module sits: below calculator.js, above
// value.js, a sibling of eos.js and format.js. Pure module — no I/O, no
// mutation of its inputs.
//
// ---------------------------------------------------------------- Lists ---
//
// A `Lists` object holds the three named lists from spec 6.1:
//
//   { L1: Cell[], L2: Cell[], L3: Cell[] }
//
// Each list is a plain JS array, at most MAX_LIST_LEN (42, spec section 0)
// items long. A `Cell` is a `Value` (see value.js): setCell auto-wraps a
// plain finite JS number with `V.flt`, so a caller may pass either a Value
// or a bare number. An unset cell is a genuine *array hole*, not a stored
// `null`/`undefined` — `Array#filter` skips holes, which is what lets
// `activeValues()` below treat "the populated cells" as simply the values
// present, in index order, with no separate blank marker to check. Passing
// `null`/`undefined` to setCell *creates* a hole (clears that one cell).
//
//   emptyLists()                          -> Lists
//   setCell(lists, listId, index, value)  -> Lists   (new object; 0 <= index < 42)
//   clearList(lists, listId)              -> Lists   (new object; list -> [])
//   getCell(lists, listId, index)         -> Value | undefined
//   listLength(lists, listId)             -> number of populated cells
//
// `listId` is one of 'L1' | 'L2' | 'L3'. setCell/clearList do not mutate
// their input and return a new Lists object, matching the pure-function
// convention used throughout the engine (calculator.js's State is expected
// to hold a Lists the same way eos.js's EvalContext holds `vars`/`ans`).
//
// ------------------------------------------------------------ Statistics --
//
//   oneVarStats(lists, dataList, frqList) -> OneVarResult
//   twoVarStats(lists, xList, yList)      -> TwoVarResult
//
// `dataList`/`xList`/`yList` are 'L1' | 'L2' | 'L3'; `frqList` is
// 'ONE' | 'L1' | 'L2' | 'L3' (spec 6.2 setup screens). Both throw
// `CalcError('STAT')` for no data points, or for length mismatches between
// the lists a calculation pairs up (spec 5.11 states this for 2-Var
// explicitly; see the judgement-call note above oneVarStats for why the
// same is applied when FRQ is a list). `oneVarStats` also throws
// `CalcError('FRQ DOMAIN')` for any negative entry in the FRQ list.
//
// Results are plain objects of already-rounded JS numbers (see "Precision
// boundary" below), tagged with enough metadata for the caller to build
// the results-screen header and StatVars menu:
//
//   OneVarResult: { type: '1-var', dataList, frqList, header,
//                   n, xbar, Sx, sigmax, sumX, sumX2 }
//   TwoVarResult: { type: '2-var', xList, yList, header,
//                   n, xbar, Sx, sigmax, ybar, Sy, sigmay,
//                   sumX, sumX2, sumY, sumY2, sumXY, a, b, r }
//
// `header` is the exact results-screen title from spec 6.2, e.g.
// '1-Var:L1,ONE' or '2-Var:L1,L2'.
//
//   statVarMenu(result) -> [{ key, name, value }]
//
// The ordered StatVars menu for `result` (spec 6.3): 6 items for 1-Var
// (keys '1'..'6'), 17 for 2-Var (keys '1'..'9' then 'A'..'H'). `name` is
// the exact display name from spec 6.3 ('n', 'xbar', 'Sx', 'sigmax',
// 'Sum x', 'Sum x^2', 'ybar', 'Sy', 'sigmay', 'Sum y', 'Sum y^2', 'Sum xy',
// 'a', 'b', 'r', "x'", "y'"). `value` is the rounded number for every item
// except "x'"/"y'" — those are *functions* pasted by name (spec 6.3: "x'
// and y' are used as functions: y'(55) enter -> 18.58651222"), so their
// `value` is `null`; the caller pastes the name and, once the user supplies
// an argument, calls predictX/predictY below.
//
//   predictX(result, y) -> number     x' = (y - b) / a
//   predictY(result, x) -> number     y' = a*x + b
//
// Both require a TwoVarResult — passing a OneVarResult (or anything else)
// throws a plain TypeError, not a CalcError: the StatVars menu only offers
// x'/y' after a 2-Var calculation (spec 6.3), so reaching this with the
// wrong result shape is a calculator.js bug, not a user-facing calculator
// error. predictX throws `CalcError('DIVIDE BY 0')` when the regression
// line is horizontal in x (a === 0, i.e. y is constant).
//
// ------------------------------------------------------- Precision boundary
//
// All accumulation (sums, means, the regression) happens in plain JS
// numbers: exact rational tracking buys nothing here, since every quantity
// in spec 6.3 is inherently an approximation once more than a trivial
// dataset is involved. Every number that leaves this module has been
// passed through value.js's round13 (via V.round13), so it carries the
// same 13-significant-digit precision as every other float in the engine
// (spec section 7). List *storage* still keeps whatever Value a cell was
// set with — an exact fraction entered in the Data editor stays exact for
// display purposes (spec 5.5 applies the Classic-fraction restrictions to
// the Data editor too, implying fractions are valid entries there) — cells
// are only collapsed to numbers at the moment a stat calculation reads
// them, via V.toNumber.

import * as V from './value.js';

const { CalcError } = V;

/** Lists hold at most this many items each (spec section 0). */
export const MAX_LIST_LEN = 42;

/** The three named lists (spec 6.1). */
export const LIST_IDS = ['L1', 'L2', 'L3'];

function assertListId(listId) {
  if (!LIST_IDS.includes(listId)) {
    throw new TypeError(`invalid list id: ${JSON.stringify(listId)} (expected 'L1' | 'L2' | 'L3')`);
  }
}

/** Wrap a plain finite number as a Value; pass an existing Value through. */
function toValue(x) {
  if (x && typeof x === 'object' && typeof x.k === 'string') return x;
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) throw new TypeError(`list cells must be finite: ${x}`);
    return V.flt(x);
  }
  throw new TypeError(`invalid list cell value: ${JSON.stringify(x)}`);
}

// ---------------------------------------------------------------- Lists ---

/** A fresh, empty set of the three lists (spec 6.1). */
export function emptyLists() {
  return { L1: [], L2: [], L3: [] };
}

/**
 * Set (or, with value null/undefined, clear) one cell. Returns a new Lists
 * object; does not mutate `lists`. `index` is 0-based, 0 <= index < 42.
 */
export function setCell(lists, listId, index, value) {
  assertListId(listId);
  if (!Number.isInteger(index) || index < 0 || index >= MAX_LIST_LEN) {
    throw new RangeError(`list index out of range: ${index} (expected 0..${MAX_LIST_LEN - 1})`);
  }
  const next = { ...lists };
  const arr = next[listId].slice(); // slice() preserves holes
  if (value === null || value === undefined) {
    delete arr[index];
  } else {
    arr[index] = toValue(value);
  }
  next[listId] = arr;
  return next;
}

/** Empty one list entirely (spec 4.7/6.2 "Clear L1" etc.). New object. */
export function clearList(lists, listId) {
  assertListId(listId);
  return { ...lists, [listId]: [] };
}

/** Read one cell. Returns undefined for a blank/unset/out-of-range cell. */
export function getCell(lists, listId, index) {
  assertListId(listId);
  return lists[listId][index];
}

/** Count of populated (non-blank) cells in a list. */
export function listLength(lists, listId) {
  return activeCells(lists, listId).length;
}

/** The populated cells of a list, as Values, in index order (holes skipped:
 * Array#filter never invokes its callback for a hole). */
function activeCells(lists, listId) {
  assertListId(listId);
  return lists[listId].filter(() => true);
}

/** The populated cells of a list, collapsed to plain JS numbers. This is
 * the value.js -> number boundary described above: exactness is dropped
 * here, at the moment a stat calculation reads the list. */
function activeValues(lists, listId) {
  return activeCells(lists, listId).map((c) => V.toNumber(c));
}

// ------------------------------------------------------------ Statistics --

/**
 * 1-Var Stats (spec 6.2/6.3). `frqList` is 'ONE' (every point counts once)
 * or a list id whose values weight the corresponding DATA entries.
 *
 * Judgement call: the spec's STAT entry (5.11) names only "2-var with
 * unequal list lengths" explicitly. We also throw STAT when a FRQ *list*
 * (not ONE) has a different populated length than DATA, since the pairing
 * is just as undefined as the 2-Var case and no other error string fits.
 * Flagging this because it isn't literally spelled out for the 1-Var case
 * and would be worth confirming against hardware.
 */
export function oneVarStats(lists, dataList, frqList) {
  assertListId(dataList);
  const data = activeValues(lists, dataList);
  if (data.length === 0) throw new CalcError('STAT');

  let frq;
  if (frqList === 'ONE') {
    frq = data.map(() => 1);
  } else {
    assertListId(frqList);
    frq = activeValues(lists, frqList);
    if (frq.some((f) => f < 0)) throw new CalcError('FRQ DOMAIN');
    if (frq.length !== data.length) throw new CalcError('STAT');
  }

  let n = 0;
  let sumX = 0;
  let sumX2 = 0;
  for (let i = 0; i < data.length; i++) {
    const f = frq[i];
    n += f;
    sumX += f * data[i];
    sumX2 += f * data[i] * data[i];
  }
  if (n === 0) throw new CalcError('STAT');

  const xbar = sumX / n;
  const ss = Math.max(sumX2 - n * xbar * xbar, 0); // Sum f*(x - xbar)^2
  const sigmax = Math.sqrt(ss / n); // population, divisor n (spec 6.3)

  // n === 1 (a single effective data point) makes the sample divisor n-1
  // exactly zero. Reported as the well-defined error for that division,
  // rather than inventing a new STAT variant not in spec 5.11.
  if (n === 1) throw new CalcError('DIVIDE BY 0');
  const Sx = Math.sqrt(ss / (n - 1)); // sample, divisor n-1 (spec 6.3)

  return {
    type: '1-var',
    dataList,
    frqList,
    header: `1-Var:${dataList},${frqList}`,
    n: V.round13(n),
    xbar: V.round13(xbar),
    Sx: V.round13(Sx),
    sigmax: V.round13(sigmax),
    sumX: V.round13(sumX),
    sumX2: V.round13(sumX2),
  };
}

/**
 * 2-Var Stats (spec 6.2/6.3): least-squares linear regression
 * y' = a*x' + b, where `a` is the slope and `b` the intercept — the
 * opposite of the usual a/b convention, per spec 6.3.
 */
export function twoVarStats(lists, xList, yList) {
  assertListId(xList);
  assertListId(yList);
  const xs = activeValues(lists, xList);
  const ys = activeValues(lists, yList);
  if (xs.length === 0 || ys.length === 0) throw new CalcError('STAT');
  if (xs.length !== ys.length) throw new CalcError('STAT'); // spec 5.11

  const n = xs.length;
  let sumX = 0;
  let sumY = 0;
  let sumX2 = 0;
  let sumY2 = 0;
  let sumXY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
    sumX2 += xs[i] * xs[i];
    sumY2 += ys[i] * ys[i];
    sumXY += xs[i] * ys[i];
  }
  const xbar = sumX / n;
  const ybar = sumY / n;
  const Sxx = Math.max(sumX2 - n * xbar * xbar, 0);
  const Syy = Math.max(sumY2 - n * ybar * ybar, 0);
  const Sxy = sumXY - n * xbar * ybar;

  const sigmax = Math.sqrt(Sxx / n);
  const sigmay = Math.sqrt(Syy / n);

  // Same n===1 reasoning as oneVarStats: the sample-stdev divisor n-1 is
  // exactly zero, and (as a consequence) so is Sxx, so the regression is
  // undefined too — one clean error rather than three.
  if (n === 1) throw new CalcError('DIVIDE BY 0');
  const Sx = Math.sqrt(Sxx / (n - 1));
  const Sy = Math.sqrt(Syy / (n - 1));

  // A vertical scatter (every x identical) leaves the slope undefined.
  if (Sxx === 0) throw new CalcError('DIVIDE BY 0');
  const a = Sxy / Sxx;
  const b = ybar - a * xbar;
  const r = Sxy / Math.sqrt(Sxx * Syy);

  return {
    type: '2-var',
    xList,
    yList,
    header: `2-Var:${xList},${yList}`,
    n: V.round13(n),
    xbar: V.round13(xbar),
    Sx: V.round13(Sx),
    sigmax: V.round13(sigmax),
    ybar: V.round13(ybar),
    Sy: V.round13(Sy),
    sigmay: V.round13(sigmay),
    sumX: V.round13(sumX),
    sumX2: V.round13(sumX2),
    sumY: V.round13(sumY),
    sumY2: V.round13(sumY2),
    sumXY: V.round13(sumXY),
    a: V.round13(a),
    b: V.round13(b),
    r: V.round13(r),
  };
}

// ------------------------------------------------------------- StatVars ---

const ONE_VAR_MENU = [
  ['1', 'n'],
  ['2', 'xbar'],
  ['3', 'Sx'],
  ['4', 'sigmax'],
  ['5', 'Sum x'],
  ['6', 'Sum x^2'],
];

// Order matters — this is spec 6.3's StatVars table, verbatim. Do not
// alphabetise or regroup it.
const TWO_VAR_MENU = [
  ['1', 'n'],
  ['2', 'xbar'],
  ['3', 'Sx'],
  ['4', 'sigmax'],
  ['5', 'ybar'],
  ['6', 'Sy'],
  ['7', 'sigmay'],
  ['8', 'Sum x'],
  ['9', 'Sum x^2'],
  ['A', 'Sum y'],
  ['B', 'Sum y^2'],
  ['C', 'Sum xy'],
  ['D', 'a'],
  ['E', 'b'],
  ['F', 'r'],
  ['G', "x'"],
  ['H', "y'"],
];

const NAME_TO_FIELD = {
  n: 'n',
  xbar: 'xbar',
  Sx: 'Sx',
  sigmax: 'sigmax',
  ybar: 'ybar',
  Sy: 'Sy',
  sigmay: 'sigmay',
  'Sum x': 'sumX',
  'Sum x^2': 'sumX2',
  'Sum y': 'sumY',
  'Sum y^2': 'sumY2',
  'Sum xy': 'sumXY',
  a: 'a',
  b: 'b',
  r: 'r',
};

/** The ordered StatVars menu for a 1-Var or 2-Var result (spec 6.3). */
export function statVarMenu(result) {
  const table = result && result.type === '2-var' ? TWO_VAR_MENU : ONE_VAR_MENU;
  return table.map(([key, name]) => ({
    key,
    name,
    value: name === "x'" || name === "y'" ? null : result[NAME_TO_FIELD[name]],
  }));
}

function assert2Var(result) {
  if (!result || result.type !== '2-var') {
    throw new TypeError('predictX/predictY require a 2-Var result (spec 6.3)');
  }
}

/** x' = (y - b) / a — predicted x for a given y (2-Var only, spec 6.3). */
export function predictX(result, y) {
  assert2Var(result);
  if (result.a === 0) throw new CalcError('DIVIDE BY 0');
  return V.round13((y - result.b) / result.a);
}

/** y' = a*x + b — predicted y for a given x (2-Var only, spec 6.3). */
export function predictY(result, x) {
  assert2Var(result);
  return V.round13(result.a * x + result.b);
}
