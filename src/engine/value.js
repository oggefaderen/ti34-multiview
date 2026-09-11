// Numeric core of the TI-34 MultiView emulator.
//
// See docs/TI-34-SPEC.md sections 3, 5.4, 5.5, 5.11 and 7, and
// docs/ARCHITECTURE.md "value.js — numbers" for the contract this file
// implements.
//
// Three value shapes, tagged by `k`:
//   Rat    {k:'rat',   n: bigint, d: bigint}   exact n/d, d > 0, sign in n
//   PiRat  {k:'pirat', n: bigint, d: bigint}   exact (n/d) * pi, d > 0
//   Flt    {k:'float', v: number}              approximate, carries 13 sig figs
//
// Rationals are DELIBERATELY not auto-reduced — MODE defaults to MANSIMP
// (spec section 3), so `1/4 + 3/12` must produce `6/12`, not `1/2`. Only
// `reduce`/`simpBy`/`lowestPrimeFactor` (driven by the `>simp` key) lower a
// fraction. Addition/subtraction combine via the lcm of the denominators;
// multiplication multiplies straight through. Never call reduce() as a side
// effect of an arithmetic op.
//
// There is no exact-radical form on this model: `root`/`sqrt` always produce
// a float, even when the mathematical result is a whole number.

/** Thrown for every calculator-visible math error. `code` is one of the
 * exact strings from spec 5.11. */
export class CalcError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CalcError';
    this.code = code;
  }
}

/** Significant digits carried internally (spec section 7: 13 carried, 10 shown). */
export const ROUND_DIGITS = 13;

const OVERFLOW_LIMIT = 1e100;

/** Round a JS number to ROUND_DIGITS significant digits. Applied by every
 * float-producing operation so error accumulates the way the hardware does.
 * Throws OVERFLOW for a result beyond the model's representable range. */
export function round13(x) {
  if (Number.isNaN(x)) throw new CalcError('DOMAIN');
  if (x === 0) return 0;
  if (!Number.isFinite(x) || Math.abs(x) >= OVERFLOW_LIMIT) {
    throw new CalcError('OVERFLOW');
  }
  const r = parseFloat(x.toPrecision(ROUND_DIGITS));
  if (!Number.isFinite(r) || Math.abs(r) >= OVERFLOW_LIMIT) {
    throw new CalcError('OVERFLOW');
  }
  return r;
}

// ---------------------------------------------------------------- helpers --

function absBig(x) {
  return x < 0n ? -x : x;
}

function gcdBig(a, b) {
  a = absBig(a);
  b = absBig(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a === 0n ? 1n : a;
}

function lcmBig(a, b) {
  if (a === 0n || b === 0n) return 0n;
  return absBig((a / gcdBig(a, b)) * b);
}

function isZeroVal(v) {
  return v.k === 'float' ? v.v === 0 : v.n === 0n;
}

// ------------------------------------------------------------ constructors --

/** Exact n/d. Normalises sign into n so d > 0. Throws DIVIDE BY 0 for d===0n. */
export function rat(n, d) {
  n = BigInt(n);
  d = BigInt(d);
  if (d === 0n) throw new CalcError('DIVIDE BY 0');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  return { k: 'rat', n, d };
}

/** Exact (n/d) * pi. Same sign/zero rules as rat(). */
export function pirat(n, d) {
  n = BigInt(n);
  d = BigInt(d);
  if (d === 0n) throw new CalcError('DIVIDE BY 0');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  return { k: 'pirat', n, d };
}

/** Approximate value. Applies round13 so the 13-significant-digit invariant
 * holds for every float in the system. */
export function flt(v) {
  return { k: 'float', v: round13(v) };
}

/** Parse a literal digit string as typed on the keypad, e.g. '3.25'. */
export function fromDigits(str) {
  const s = String(str).trim();
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) throw new CalcError('SYNTAX');
  const [, sign, intPart, fracPart = ''] = m;
  const digits = (intPart || '0') + fracPart || '0';
  let n = BigInt(digits === '' ? '0' : digits);
  if (sign === '-') n = -n;
  const d = 10n ** BigInt(fracPart.length);
  return rat(n, d);
}

// ------------------------------------------------------------- predicates --

export function isExact(v) {
  return v.k === 'rat' || v.k === 'pirat';
}

/** Collapse to a JS number, applying round13. */
export function toNumber(v) {
  switch (v.k) {
    case 'rat':
      return round13(Number(v.n) / Number(v.d));
    case 'pirat':
      return round13((Number(v.n) / Number(v.d)) * Math.PI);
    case 'float':
      return v.v;
    default:
      throw new TypeError(`not a Value: ${JSON.stringify(v)}`);
  }
}

export function cmp(a, b) {
  if (a.k === 'rat' && b.k === 'rat') {
    const l = a.n * b.d;
    const r = b.n * a.d;
    return l < r ? -1 : l > r ? 1 : 0;
  }
  if (a.k === 'pirat' && b.k === 'pirat') {
    const l = a.n * b.d;
    const r = b.n * a.d;
    return l < r ? -1 : l > r ? 1 : 0;
  }
  const an = toNumber(a);
  const bn = toNumber(b);
  return an < bn ? -1 : an > bn ? 1 : 0;
}

// -------------------------------------------------------------- unary ops --

export function neg(a) {
  switch (a.k) {
    case 'rat':
      return { k: 'rat', n: -a.n, d: a.d };
    case 'pirat':
      return { k: 'pirat', n: -a.n, d: a.d };
    case 'float':
      return flt(-a.v);
    default:
      throw new TypeError('not a Value');
  }
}

export function abs(a) {
  switch (a.k) {
    case 'rat':
      return { k: 'rat', n: a.n < 0n ? -a.n : a.n, d: a.d };
    case 'pirat':
      return { k: 'pirat', n: a.n < 0n ? -a.n : a.n, d: a.d };
    case 'float':
      return flt(Math.abs(a.v));
    default:
      throw new TypeError('not a Value');
  }
}

// ------------------------------------------------------------- binary ops --

/** a + b. Rat+Rat and PiRat+PiRat combine via lcm of denominators, never
 * reduced. A zero operand of the "other" kind is dropped so `0 + 2π` stays
 * exact pi-rat. Anything else that can't stay exact collapses to float. */
export function add(a, b) {
  if (a.k === 'rat' && b.k === 'rat') {
    const d = lcmBig(a.d, b.d);
    const n = a.n * (d / a.d) + b.n * (d / b.d);
    return { k: 'rat', n, d };
  }
  if (a.k === 'pirat' && b.k === 'pirat') {
    const d = lcmBig(a.d, b.d);
    const n = a.n * (d / a.d) + b.n * (d / b.d);
    return { k: 'pirat', n, d };
  }
  if (a.k !== 'float' && b.k !== 'float') {
    // one rat, one pirat (mixed exact kinds)
    if (isZeroVal(a)) return b;
    if (isZeroVal(b)) return a;
    return flt(toNumber(a) + toNumber(b));
  }
  return flt(toNumber(a) + toNumber(b));
}

/** a - b, defined as a + (-b) so it inherits add()'s exactness rules. */
export function sub(a, b) {
  return add(a, neg(b));
}

/** a * b. Rat*Rat multiplies straight through (no reduce). PiRat*Rat scales
 * the pi coefficient and stays exact. PiRat*PiRat collapses to float (pi^2
 * isn't representable) except for an exact-zero result. */
export function mul(a, b) {
  if (a.k === 'rat' && b.k === 'rat') {
    return { k: 'rat', n: a.n * b.n, d: a.d * b.d };
  }
  if (a.k === 'float' || b.k === 'float') {
    return flt(toNumber(a) * toNumber(b));
  }
  if (a.k === 'pirat' && b.k === 'pirat') {
    if (isZeroVal(a) || isZeroVal(b)) return { k: 'rat', n: 0n, d: 1n };
    return flt(toNumber(a) * toNumber(b));
  }
  // exactly one pirat, one rat
  const p = a.k === 'pirat' ? a : b;
  const r = a.k === 'rat' ? a : b;
  if (isZeroVal(r)) return { k: 'rat', n: 0n, d: 1n };
  return { k: 'pirat', n: p.n * r.n, d: p.d * r.d };
}

/** a / b. PiRat/PiRat cancels pi exactly, producing a plain Rat. PiRat/Rat
 * stays a PiRat. Rat/PiRat (and anything involving a float) collapses to
 * float, except an exact-zero dividend. */
export function div(a, b) {
  if (isZeroVal(b)) throw new CalcError('DIVIDE BY 0');
  if (a.k === 'rat' && b.k === 'rat') {
    return rat(a.n * b.d, a.d * b.n);
  }
  if (a.k === 'float' || b.k === 'float') {
    return flt(toNumber(a) / toNumber(b));
  }
  if (a.k === 'pirat' && b.k === 'pirat') {
    return rat(a.n * b.d, a.d * b.n); // pi cancels
  }
  if (a.k === 'pirat' && b.k === 'rat') {
    return pirat(a.n * b.d, a.d * b.n);
  }
  // a.k === 'rat', b.k === 'pirat'
  if (isZeroVal(a)) return { k: 'rat', n: 0n, d: 1n };
  return flt(toNumber(a) / toNumber(b));
}

// ---------------------------------------------------------- powers/roots --

function isIntegerValue(v) {
  if (v.k === 'rat') return v.n % v.d === 0n;
  if (v.k === 'pirat') return v.n === 0n; // 0*pi is the only integer pi-multiple
  return Number.isInteger(v.v);
}

function toIntBig(v) {
  if (v.k === 'rat') return v.n / v.d;
  if (v.k === 'pirat') return 0n; // only reachable when isIntegerValue(v) is true
  return BigInt(Math.trunc(v.v));
}

/** base ^ exp. Preserves exactness for an integer exponent applied to a Rat
 * or (trivially) a PiRat; anything else collapses to float. Negative-base
 * non-integer exponents are DOMAIN (no complex numbers on this model); 0
 * raised to a negative exponent is DIVIDE BY 0. */
export function pow(base, exp) {
  if (isIntegerValue(exp)) {
    const k = toIntBig(exp);
    if (base.k === 'rat') {
      if (k === 0n) return { k: 'rat', n: 1n, d: 1n };
      if (base.n === 0n && k < 0n) throw new CalcError('DIVIDE BY 0');
      if (k > 0n) return { k: 'rat', n: base.n ** k, d: base.d ** k };
      const ik = -k;
      return rat(base.d ** ik, base.n ** ik);
    }
    if (base.k === 'pirat') {
      if (k === 0n) return { k: 'rat', n: 1n, d: 1n };
      if (k === 1n) return base;
      if (isZeroVal(base) && k < 0n) throw new CalcError('DIVIDE BY 0');
      return flt(Math.pow(toNumber(base), Number(k)));
    }
    // float base
    if (base.v === 0 && k < 0n) throw new CalcError('DIVIDE BY 0');
    return flt(Math.pow(base.v, Number(k)));
  }
  const bnum = toNumber(base);
  const enum_ = toNumber(exp);
  if (bnum < 0) throw new CalcError('DOMAIN');
  if (bnum === 0 && enum_ < 0) throw new CalcError('DIVIDE BY 0');
  return flt(Math.pow(bnum, enum_));
}

/** The `index`-th root of `radicand`. Always a float (no exact-radical form).
 * DOMAIN for index===0, or a negative radicand with a non-odd-integer index. */
export function root(index, radicand) {
  const idx = toNumber(index);
  const rad = toNumber(radicand);
  if (idx === 0) throw new CalcError('DOMAIN');
  const isOddInt = Number.isInteger(idx) && Math.abs(idx % 2) === 1;
  if (rad < 0 && !isOddInt) throw new CalcError('DOMAIN');
  if (rad === 0) {
    if (idx < 0) throw new CalcError('DIVIDE BY 0');
    return { k: 'rat', n: 0n, d: 1n };
  }
  const result = rad < 0 ? -Math.pow(-rad, 1 / idx) : Math.pow(rad, 1 / idx);
  return flt(result);
}

// ------------------------------------------------------ fraction handling --

/** Lowest terms. No-op side effect free; only called explicitly (>simp,
 * AUTOSIMP), never automatically after an arithmetic op. */
export function reduce(v) {
  if (v.k === 'float') return v;
  const g = gcdBig(v.n, v.d);
  if (g <= 1n) return { k: v.k, n: v.n, d: v.d };
  return { k: v.k, n: v.n / g, d: v.d / g };
}

/** Divide numerator and denominator by k (a positive integer < 1e10), as
 * `>simp k enter`. DOMAIN for k<=0, k>=1e10, a non-fraction, or a k that
 * doesn't evenly divide both n and d. */
export function simpBy(v, k) {
  const kb = typeof k === 'bigint' ? k : BigInt(k);
  if (v.k !== 'rat') throw new CalcError('DOMAIN');
  if (kb <= 0n || kb >= 10000000000n) throw new CalcError('DOMAIN');
  if (v.n % kb !== 0n || v.d % kb !== 0n) throw new CalcError('DOMAIN');
  return rat(v.n / kb, v.d / kb);
}

/** Lowest common prime factor of |n| and d, for bare `>simp enter`. Returns
 * 1n when the fraction is already in lowest terms. */
export function lowestPrimeFactor(v) {
  if (v.k !== 'rat') throw new CalcError('DOMAIN');
  const g = gcdBig(v.n, v.d);
  if (g <= 1n) return 1n;
  let f = g;
  for (let p = 2n; p * p <= f; p++) {
    if (f % p === 0n) return p;
  }
  return f;
}
