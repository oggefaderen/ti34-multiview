// The expression layer: EOS (Equation Operating System) order of operations.
//
// See docs/TI-34-SPEC.md section 5.1 for the 11-level priority table this
// file implements, and docs/ARCHITECTURE.md "eos.js" / "The entry-line
// model" for the contract.
//
// calculator.js (the state machine that turns keystrokes into a Node tree)
// does not exist yet, so this file also PINS the node shapes it consumes.
// The entry line is a flat array of sibling Nodes; only a few node types
// nest (frac/sqrt/root/paren/func carry their own self-contained sub-lists;
// 'pow' and the postfix operators are the exception — they attach to
// whatever Value precedes them in the same flat array, which is how the
// physical MathPrint editor builds them: type a base, then press ^, x^2, a
// trig-angle-unit key, etc.).
//
// Node shapes used by evaluate():
//   {t:'num',   v: '3.25'}                         literal digit string
//   {t:'const', v: 'pi' | 'e'}
//   {t:'var',   v: 'x'|'y'|'z'|'t'|'a'|'b'|'c'}     looked up in ctx.vars
//   {t:'ans'}                                        ctx.ans
//   {t:'op',    v: '+'|'-'|'*'|'/'|'intdiv'|'nPr'|'nCr'}  flat infix operator
//   {t:'neg'}                                        flat prefix (-) marker
//   {t:'paren', arg: Node[]}
//   {t:'frac',  num: Node[], den: Node[]}
//   {t:'mixed', whole: Node[], num: Node[], den: Node[]}   U n/d (spec 5.5);
//     self-contained and ADDITIVE (whole + num/den) — this is why it needs
//     its own node type rather than relying on implicit multiplication for
//     "4" next to "1/2": that would wrongly give 2, not 4.5. A negative mixed
//     number is a preceding {t:'neg'} wrapping the whole 'mixed' node, same
//     as for any other primary.
//   {t:'sqrt',  arg: Node[]}
//   {t:'root',  idx: Node[], arg: Node[]}            x-root y (self-contained)
//   {t:'pow',   exp: Node[]}                          attaches to preceding base
//   {t:'postfix', v: 'square'|'cube'|'factorial'|'percent'|'deg'|'min'|'sec'|'rad'
//                   |'pct_convert'|'dms_convert'|'frac_convert'}
//                                                     attaches to preceding value
//   {t:'func',  v: <name>, arg: Node[], arg2?: Node[]}
//     names: 'sin','cos','tan','asin','acos','atan','log','ln','exp10','expE',
//            'lcm','gcd','cube','cbrt','abs','round','ipart','fpart','min',
//            'max','remainder','r2pr','r2ptheta','p2rx','p2ry'
//     (round/lcm/gcd/min/max/remainder are 2-argument: arg and arg2)
//   {t:'sci',   v: '2', exp: '5'}                     x10^n literal shortcut
//
// Everything else in the spec's 11-level table that doesn't change the
// numeric Value (the n/d<->Un/d, f<->d and >DMS "conversions" of priority
// level 10) is display-only and left as an identity here; format.js (not
// yet built) owns turning a Value into the DMS/mixed-number/percent text.

import * as value from './value.js';

/** Digits -> Value: decimals stay approximate, integers stay exact. */
function numberNodeValue(digits) {
  const v = value.fromDigits(digits);
  return String(digits).includes('.') ? value.flt(value.toNumber(v)) : v;
}
const { CalcError } = value;

/**
 * @typedef {object} EvalContext
 * @property {'DEG'|'RAD'} angle
 * @property {boolean} classic
 * @property {object} vars
 * @property {import('./value.js').Value} ans
 * @property {object|null} stats
 * @property {bigint} randSeed
 */

/** @param {Array} nodes @param {EvalContext} ctx */
export function evaluate(nodes, ctx) {
  const { value: v, i } = parseConversion(nodes, 0, ctx);
  if (i !== nodes.length) throw new CalcError('SYNTAX');
  return v;
}

// ------------------------------------------------------ precedence levels --
// From loosest (10) to tightest (1), mirroring spec 5.1. Each level function
// returns {value, i} where i is the next unconsumed index.

// level 10 — conversions (display-only here; identity on the Value)
function parseConversion(nodes, i, ctx) {
  let { value: v, i: j } = parseAddSub(nodes, i, ctx);
  while (
    nodes[j] &&
    nodes[j].t === 'postfix' &&
    (nodes[j].v === 'pct_convert' || nodes[j].v === 'dms_convert' || nodes[j].v === 'frac_convert')
  ) {
    j++; // identity: value unchanged, presentation only (format.js's job)
  }
  return { value: v, i: j };
}

// level 9 — addition, subtraction
function parseAddSub(nodes, i, ctx) {
  let { value: acc, i: j } = parseMulDiv(nodes, i, ctx);
  while (nodes[j] && nodes[j].t === 'op' && (nodes[j].v === '+' || nodes[j].v === '-')) {
    const op = nodes[j].v;
    const rhs = parseMulDiv(nodes, j + 1, ctx);
    acc = op === '+' ? value.add(acc, rhs.value) : value.sub(acc, rhs.value);
    j = rhs.i;
  }
  return { value: acc, i: j };
}

function startsOperand(node) {
  if (!node) return false;
  return (
    node.t === 'num' ||
    node.t === 'const' ||
    node.t === 'var' ||
    node.t === 'ans' ||
    node.t === 'paren' ||
    node.t === 'frac' ||
    node.t === 'mixed' ||
    node.t === 'sqrt' ||
    node.t === 'root' ||
    node.t === 'func' ||
    node.t === 'sci' ||
    node.t === 'neg'
  );
}

// level 8 — multiplication, IMPLIED multiplication, division (same precedence,
// left to right — spec 5.2: `8 / 2pi` = `(8/2) * pi`, not `8/(2pi)`), and
// int/ (spec 5.9), keyed the same way as ÷ between two positive integers.
function parseMulDiv(nodes, i, ctx) {
  let { value: acc, i: j } = parseNPrNCr(nodes, i, ctx);
  for (;;) {
    if (
      nodes[j] &&
      nodes[j].t === 'op' &&
      (nodes[j].v === '*' || nodes[j].v === '/' || nodes[j].v === 'intdiv')
    ) {
      const op = nodes[j].v;
      const rhs = parseNPrNCr(nodes, j + 1, ctx);
      acc =
        op === '*'
          ? value.mul(acc, rhs.value)
          : op === '/'
          ? value.div(acc, rhs.value)
          : evalIntDiv(acc, rhs.value);
      j = rhs.i;
      continue;
    }
    if (startsOperand(nodes[j])) {
      // implicit multiplication: no operator token consumed
      const rhs = parseNPrNCr(nodes, j, ctx);
      acc = value.mul(acc, rhs.value);
      j = rhs.i;
      continue;
    }
    break;
  }
  return { value: acc, i: j };
}

// level 7 — nPr, nCr (infix)
function parseNPrNCr(nodes, i, ctx) {
  let { value: acc, i: j } = parseNeg(nodes, i, ctx);
  while (nodes[j] && nodes[j].t === 'op' && (nodes[j].v === 'nPr' || nodes[j].v === 'nCr')) {
    const op = nodes[j].v;
    const rhs = parseNeg(nodes, j + 1, ctx);
    acc = op === 'nPr' ? nPrValue(acc, rhs.value) : nCrValue(acc, rhs.value);
    j = rhs.i;
  }
  return { value: acc, i: j };
}

// level 6 — negation (-), prefix, BELOW exponentiation
function parseNeg(nodes, i, ctx) {
  if (nodes[i] && nodes[i].t === 'neg') {
    const operand = parseNeg(nodes, i + 1, ctx); // allow chained (-)(-)3
    return { value: value.neg(operand.value), i: operand.i };
  }
  return parsePow(nodes, i, ctx);
}

// level 5 — exponentiation ^ and x-root. `^` chains: classic folds left,
// mathprint folds right (spec 5.1). Trailing postfix ops (level 4) can
// appear either before the chain starts or after it settles; both are
// handled by running the postfix loop at each end.
function parsePow(nodes, i, ctx) {
  let { value: base, i: j } = parsePostfixLoop(nodes, i, ctx, parsePrimary);
  const exps = [];
  while (nodes[j] && nodes[j].t === 'pow') {
    exps.push(evaluate(nodes[j].exp || [], ctx));
    j++;
  }
  let result = base;
  if (exps.length > 0) {
    if (ctx.classic) {
      result = base;
      for (const e of exps) result = value.pow(result, e);
    } else {
      let acc = exps[exps.length - 1];
      for (let k = exps.length - 2; k >= 0; k--) acc = value.pow(exps[k], acc);
      result = value.pow(base, acc);
    }
  }
  const post = applyPostfixOps(nodes, j, result, ctx);
  return { value: post.value, i: post.i };
}

function parsePostfixLoop(nodes, i, ctx, parsePrim) {
  const { value: v, i: j } = parsePrim(nodes, i, ctx);
  return applyPostfixOps(nodes, j, v, ctx);
}

// level 4 — postfix functions: x^2, !, %, and the angle-unit modifiers.
// Always left to right, in BOTH Classic and MathPrint (spec 5.1): `3 x^2
// x^2` = `(3^2)^2` = 81.
function applyPostfixOps(nodes, i, v, ctx) {
  let j = i;
  while (nodes[j] && nodes[j].t === 'postfix') {
    const op = nodes[j].v;
    switch (op) {
      case 'square':
        v = value.pow(v, value.rat(2n, 1n));
        break;
      // The MATH menu's cube is applied to the value you already typed, the
      // same way x2 is -- not as a prefix function taking an argument.
      case 'cube':
        v = value.pow(v, value.rat(3n, 1n));
        break;
      case 'factorial':
        v = evalFactorial(v);
        break;
      case 'percent':
        v = value.div(v, value.rat(100n, 1n));
        break;
      case 'deg':
      case 'min':
      case 'sec':
      case 'rad':
        v = applyAngleUnit(op, v, ctx);
        break;
      case 'pct_convert':
      case 'dms_convert':
      case 'frac_convert':
        // display-only conversions (priority level 10); if they show up
        // adjacent to a postfix run just pass the value through unchanged.
        break;
      default:
        throw new CalcError('SYNTAX');
    }
    j++;
  }
  return { value: v, i: j };
}

// levels 1-3 — parenthesised expressions, prefix functions, fractions (all
// self-contained sub-trees), plus the other primaries (literals, constants,
// variables, ans).
function parsePrimary(nodes, i, ctx) {
  const node = nodes[i];
  if (!node) throw new CalcError('SYNTAX');
  switch (node.t) {
    case 'num':
      // A number typed WITH a decimal point is a decimal, and its results
      // display as decimals: 3.75 reads "3.75", not "3 75/100". Exact
      // rational arithmetic is for values that arrive exact — integers, and
      // fractions entered with n/d — which is why 1 / 3 still gives 1/3 and
      // the ◄► toggle has something to switch.
      return { value: numberNodeValue(node.v), i: i + 1 };
    case 'sci': {
      const mantissa = value.fromDigits(node.v);
      const exp = value.fromDigits(node.exp);
      return { value: value.mul(mantissa, value.pow(value.rat(10n, 1n), exp)), i: i + 1 };
    }
    case 'const':
      if (node.v === 'pi') return { value: value.pirat(1n, 1n), i: i + 1 };
      if (node.v === 'e') return { value: value.flt(Math.E), i: i + 1 };
      throw new CalcError('SYNTAX');
    case 'var': {
      const val = ctx.vars ? ctx.vars[node.v] : undefined;
      if (val === undefined) throw new CalcError('SYNTAX');
      return { value: val, i: i + 1 };
    }
    case 'ans':
      return { value: ctx.ans ?? value.rat(0n, 1n), i: i + 1 };
    case 'paren':
      return { value: evaluate(node.arg || [], ctx), i: i + 1 };
    case 'frac': {
      const n = evaluate(node.num || [], ctx);
      const d = evaluate(node.den || [], ctx);
      return { value: value.div(n, d), i: i + 1 };
    }
    case 'mixed': {
      const whole = evaluate(node.whole || [], ctx);
      const n = evaluate(node.num || [], ctx);
      const d = evaluate(node.den || [], ctx);
      return { value: value.add(whole, value.div(n, d)), i: i + 1 };
    }
    case 'sqrt': {
      const a = evaluate(node.arg || [], ctx);
      return { value: value.root(value.rat(2n, 1n), a), i: i + 1 };
    }
    case 'root': {
      const idx = evaluate(node.idx || [], ctx);
      const a = evaluate(node.arg || [], ctx);
      return { value: value.root(idx, a), i: i + 1 };
    }
    case 'func':
      return { value: evalFunc(node, ctx), i: i + 1 };
    default:
      throw new CalcError('SYNTAX');
  }
}

// -------------------------------------------------------- angle handling --
// Angle-unit postfix modifiers (spec 5.10): force the preceding value to be
// read in that unit, but the result stays expressed in ctx.angle. deg<->rad
// conversions go through mul/div by an exact pirat(1,1) so a value that is
// itself an exact pi-multiple converts to a plain, exact rational (matching
// the guidebook's `2pi keyed as radians -> 360` in DEG mode) instead of
// picking up floating-point noise from Math.PI.

function radToDeg(v) {
  return value.div(value.mul(v, value.rat(180n, 1n)), value.pirat(1n, 1n));
}

function degToRad(v) {
  return value.div(value.mul(v, value.pirat(1n, 1n)), value.rat(180n, 1n));
}

function applyAngleUnit(unit, v, ctx) {
  let degrees;
  switch (unit) {
    case 'deg':
      degrees = v;
      break;
    case 'min':
      degrees = value.div(v, value.rat(60n, 1n));
      break;
    case 'sec':
      degrees = value.div(v, value.rat(3600n, 1n));
      break;
    case 'rad':
      degrees = radToDeg(v);
      break;
    default:
      throw new CalcError('SYNTAX');
  }
  return ctx.angle === 'DEG' ? degrees : degToRad(degrees);
}

// an argument already normalized to ctx.angle's unit -> radians for Math.*
function toRadians(v, ctx) {
  return ctx.angle === 'DEG' ? degToRad(v) : v;
}

// an angle result in radians (from Math.asin/acos/atan) -> ctx.angle's unit
function fromRadians(v, ctx) {
  return ctx.angle === 'DEG' ? radToDeg(v) : v;
}

function assertTanDomain(degreesValue) {
  if (degreesValue.k === 'rat') {
    const num = degreesValue.n - 90n * degreesValue.d;
    const den = 180n * degreesValue.d;
    const m = ((num % den) + den) % den;
    if (m === 0n) throw new CalcError('DOMAIN');
    return;
  }
  const x = value.toNumber(degreesValue);
  const m = (((x - 90) % 180) + 180) % 180;
  if (Math.abs(m) < 1e-7) throw new CalcError('DOMAIN');
}

// ------------------------------------------------------------- functions --

function evalFunc(node, ctx) {
  const name = node.v;
  switch (name) {
    case 'sin':
    case 'cos':
    case 'tan': {
      const raw = evaluate(node.arg || [], ctx);
      if (name === 'tan') {
        const degreesForCheck = ctx.angle === 'DEG' ? raw : radToDeg(raw);
        assertTanDomain(degreesForCheck);
      }
      const rad = value.toNumber(toRadians(raw, ctx));
      const fn = name === 'sin' ? Math.sin : name === 'cos' ? Math.cos : Math.tan;
      return value.flt(fn(rad));
    }
    case 'asin':
    case 'acos':
    case 'atan': {
      const x = value.toNumber(evaluate(node.arg || [], ctx));
      if ((name === 'asin' || name === 'acos') && Math.abs(x) > 1) throw new CalcError('DOMAIN');
      const fn = name === 'asin' ? Math.asin : name === 'acos' ? Math.acos : Math.atan;
      return fromRadians(value.flt(fn(x)), ctx);
    }
    case 'log': {
      const x = value.toNumber(evaluate(node.arg || [], ctx));
      if (x <= 0) throw new CalcError('DOMAIN');
      return value.flt(Math.log10(x));
    }
    case 'ln': {
      const x = value.toNumber(evaluate(node.arg || [], ctx));
      if (x <= 0) throw new CalcError('DOMAIN');
      return value.flt(Math.log(x));
    }
    case 'exp10': {
      const x = evaluate(node.arg || [], ctx);
      return value.pow(value.rat(10n, 1n), x);
    }
    case 'expE': {
      const x = value.toNumber(evaluate(node.arg || [], ctx));
      return value.flt(Math.exp(x));
    }
    case 'cube': {
      const x = evaluate(node.arg || [], ctx);
      return value.pow(x, value.rat(3n, 1n));
    }
    case 'cbrt': {
      const x = evaluate(node.arg || [], ctx);
      return value.root(value.rat(3n, 1n), x);
    }
    case 'abs':
      return value.abs(evaluate(node.arg || [], ctx));
    case 'ipart':
      return iPart(evaluate(node.arg || [], ctx));
    case 'fpart': {
      const x = evaluate(node.arg || [], ctx);
      return value.sub(x, iPart(x));
    }
    case 'round': {
      const x = value.toNumber(evaluate(node.arg || [], ctx));
      const digits = Number(requireNonnegInt(evaluate(node.arg2 || [], ctx)));
      const factor = 10 ** digits;
      return value.flt(Math.round(x * factor) / factor);
    }
    case 'min': {
      const a = evaluate(node.arg || [], ctx);
      const b = evaluate(node.arg2 || [], ctx);
      return value.cmp(a, b) <= 0 ? a : b;
    }
    case 'max': {
      const a = evaluate(node.arg || [], ctx);
      const b = evaluate(node.arg2 || [], ctx);
      return value.cmp(a, b) >= 0 ? a : b;
    }
    case 'lcm': {
      const a = requireInt(evaluate(node.arg || [], ctx));
      const b = requireInt(evaluate(node.arg2 || [], ctx));
      return { k: 'rat', n: lcmBig(a, b), d: 1n };
    }
    case 'gcd': {
      const a = requireInt(evaluate(node.arg || [], ctx));
      const b = requireInt(evaluate(node.arg2 || [], ctx));
      return { k: 'rat', n: gcdBig(a, b), d: 1n };
    }
    case 'remainder': {
      const a = evaluate(node.arg || [], ctx);
      const b = evaluate(node.arg2 || [], ctx);
      return value.sub(a, value.mul(b, iPart(value.div(a, b))));
    }
    case 'r2pr': {
      const x = value.toNumber(evaluate(node.arg || [], ctx));
      const y = value.toNumber(evaluate(node.arg2 || [], ctx));
      return value.flt(Math.hypot(x, y));
    }
    case 'r2ptheta': {
      const x = value.toNumber(evaluate(node.arg || [], ctx));
      const y = value.toNumber(evaluate(node.arg2 || [], ctx));
      return fromRadians(value.flt(Math.atan2(y, x)), ctx);
    }
    case 'p2rx': {
      const r = value.toNumber(evaluate(node.arg || [], ctx));
      const theta = value.toNumber(toRadians(evaluate(node.arg2 || [], ctx), ctx));
      return value.flt(r * Math.cos(theta));
    }
    case 'p2ry': {
      const r = value.toNumber(evaluate(node.arg || [], ctx));
      const theta = value.toNumber(toRadians(evaluate(node.arg2 || [], ctx), ctx));
      return value.flt(r * Math.sin(theta));
    }
    default:
      throw new CalcError('SYNTAX');
  }
}

// spec 5.9: `17 int/ 3` -> quotient 5, remainder 2, displayed as `5r2`.
// Only the quotient is a proper Value (spec 5.6: "int/ stores only the
// quotient to ans"); the remainder is attached as an extra, non-Value
// property for calculator.js/format.js to surface the `5r2` display. This is
// a provisional shape — evaluate()'s contract is to return a single Value,
// so a richer two-part result may need a real home once calculator.js exists.
function evalIntDiv(a, b) {
  const an = requireNonnegInt(a);
  const bn = requireNonnegInt(b);
  if (bn === 0n) throw new CalcError('DIVIDE BY 0');
  const q = { k: 'rat', n: an / bn, d: 1n };
  q.remainder = { k: 'rat', n: an % bn, d: 1n };
  return q;
}

function iPart(x) {
  if (x.k === 'rat') return { k: 'rat', n: x.n / x.d, d: 1n }; // BigInt division truncates toward 0
  return value.flt(Math.trunc(value.toNumber(x)));
}

// ------------------------------------------------------ integer helpers --

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

function requireNonnegInt(v) {
  if (v.k === 'rat' && v.n % v.d === 0n) {
    const q = v.n / v.d;
    if (q >= 0n) return q;
  }
  if (v.k === 'float' && Number.isInteger(v.v) && v.v >= 0) return BigInt(v.v);
  throw new CalcError('DOMAIN');
}

function requireInt(v) {
  if (v.k === 'rat' && v.n % v.d === 0n) return v.n / v.d;
  if (v.k === 'float' && Number.isInteger(v.v)) return BigInt(v.v);
  throw new CalcError('DOMAIN');
}

function factorialBig(n) {
  let r = 1n;
  for (let k = 2n; k <= n; k++) r *= k;
  return r;
}

function evalFactorial(v) {
  const n = requireNonnegInt(v);
  if (n > 69n) throw new CalcError('OVERFLOW');
  return { k: 'rat', n: factorialBig(n), d: 1n };
}

function nPrValue(nv, rv) {
  const n = requireNonnegInt(nv);
  const r = requireNonnegInt(rv);
  if (r > n) throw new CalcError('DOMAIN');
  let result = 1n;
  for (let k = n - r + 1n; k <= n; k++) result *= k;
  return { k: 'rat', n: result, d: 1n };
}

function nCrValue(nv, rv) {
  const n = requireNonnegInt(nv);
  const r = requireNonnegInt(rv);
  if (r > n) throw new CalcError('DOMAIN');
  const rr = r < n - r ? r : n - r;
  let num = 1n;
  let den = 1n;
  for (let k = 0n; k < rr; k++) {
    num *= n - k;
    den *= k + 1n;
  }
  return { k: 'rat', n: num / den, d: 1n };
}
