// Display formatting: Value / entry-line Node[] -> Layout.
//
// See docs/TI-34-SPEC.md section 7 (number formatting), section 2 (display,
// MathPrint rendering), section 3 (the MODE menu) and sections 5.4/5.5 (the
// exact-decimal toggle and fractions), and docs/ARCHITECTURE.md's
// "format.js", "Layout" and "ModeState" for the contract this file
// implements.
//
// A Layout is a small renderable tree — see ARCHITECTURE.md:
//   { t: 'text',    text }
//   { t: 'row',     items: Layout[] }
//   { t: 'frac',    num, den: Layout }
//   { t: 'sup',     base, sup: Layout }
//   { t: 'radical', arg: Layout, index?: Layout }
// It contains NO math and NO calculator state — calculator.js/the renderer
// draw it blindly.
//
// ModeState (spec section 3):
//   { angle: 'DEG'|'RAD', notation: 'NORM'|'SCI', decimals: 'FLOAT'|0..9,
//     entry: 'CLASSIC'|'MATHPRINT', fracStyle: 'Un/d'|'n/d',
//     simp: 'MANSIMP'|'AUTOSIMP' }
// `angle` is accepted for shape-completeness but unused here — DEG/RAD only
// changes how eos.js *computes* trig results; it does not change how a
// number is *displayed*.
//
// Design notes / judgement calls (also called out where they apply below,
// and repeated in the handoff report):
//
// - Negative numbers and the `neg` entry node both render with a dedicated
//   "raised minus" glyph (U+207B, ⁻), textually distinct from the ordinary
//   binary-subtraction glyph (U+2212, −) used for the `-` op node. This
//   matches real TI hardware, which has a physically separate glyph for the
//   negative sign vs. subtraction (spec 5.3), and gives the renderer a plain
//   text distinction without inventing a new Layout node type.
// - CLASSIC entry/value rendering never emits 'frac'/'sup'/'radical' Layout
//   nodes — it only ever emits 'text'/'row', so everything reads on one
//   line, per spec 2.4. MATHPRINT uses the structured node types.
// - format.js never truncates or elides content for line width — the 4x16
//   overflow/scroll-arrow decision (spec 0, 2.1) is made by whatever measures
//   the rendered Layout (calculator.js / the renderer), not here.
// - format.js does not implement the `<->` toggle itself (that needs
//   per-answer history state, which lives in calculator.js). It exposes
//   `formatDecimal(v, mode)` as the "always decimal" half of that toggle;
//   `formatValue` is the "prefer exact" half calculator.js can pair it with.
// - eos.js's `evalIntDiv` attaches a non-Value `.remainder` property to the
//   quotient for `int/` (spec 5.9) and explicitly hands the `5r2` rendering
//   to format.js; `formatValue` special-cases that here.
// - The `E` substitution (spec 7, "Data editor and 2nd[recall] menu") is
//   exposed as an `{ eNotation: true }` third argument to `formatValue`,
//   additive to the pinned two-argument signature.
// - eos.js's single `frac_convert` postfix node covers both `n/d<->Un/d` and
//   `f<->d` (two distinct keys in the spec); since the entry-line tree
//   doesn't distinguish them, the pending-entry marker rendered for it here
//   is necessarily a generic placeholder. See PROJECT_STATE-facing report.

import * as value from './value.js';

// ------------------------------------------------------------- glyphs -----

const NEG_GLYPH = '⁻'; // U+207B SUPERSCRIPT MINUS — negation / negative sign
const SUB_GLYPH = '−'; // U+2212 MINUS SIGN — binary subtraction
const MUL_GLYPH = '×';
const DIV_GLYPH = '÷';
const PI_GLYPH = 'π';
const MANSIMP_MARKER = '↓'; // "not in lowest terms" (spec 3, 5.5)
const SIG_DIGITS = 10; // spec 7: 13 carried internally, 10 displayed

// --------------------------------------------------------- Layout builders

const text = (s) => ({ t: 'text', text: s });
const row = (...items) => ({ t: 'row', items });
const fracLayout = (num, den) => ({ t: 'frac', num, den });
const supLayout = (base, sup) => ({ t: 'sup', base, sup });
const radicalLayout = (arg, index) =>
  index !== undefined && index !== null ? { t: 'radical', arg, index } : { t: 'radical', arg };

function singleOrRow(items) {
  return items.length === 1 ? items[0] : row(...items);
}

// ======================================================================= //
//  Number formatting (shared by formatValue's decimal path, formatDecimal, //
//  formatPercent, and the SCI mantissa)                                    //
// ======================================================================= //

/** Round `ax` (>=0) to `n` significant digits and return a plain decimal
 * string with no exponential notation, whatever the magnitude. */
function roundToSignificantString(ax, n) {
  let s = ax.toPrecision(n);
  if (/e/i.test(s)) s = expandExponential(s);
  return s;
}

// Converts a JS toPrecision exponential string ("1.234000000e+21") into a
// full plain-decimal string, preserving magnitude (padding with zeros as
// needed) rather than just chopping digits off.
function expandExponential(str) {
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/i.exec(str);
  if (!m) return str;
  const [, sign, leadDigit, fracDigits = '', expStr] = m;
  const exp = parseInt(expStr, 10);
  const digits = leadDigit + fracDigits;
  if (exp >= 0) {
    if (exp + 1 >= digits.length) {
      return sign + digits + '0'.repeat(exp + 1 - digits.length);
    }
    return sign + digits.slice(0, exp + 1) + '.' + digits.slice(exp + 1);
  }
  return sign + '0.' + '0'.repeat(-exp - 1) + digits;
}

function trimTrailingFractionZeros(str) {
  if (!str.includes('.')) return str;
  str = str.replace(/0+$/, '');
  str = str.replace(/\.$/, '');
  return str;
}

/** FLOAT: up to SIG_DIGITS significant digits, no trailing zeros (spec 3/7). */
function formatFloatMagnitude(ax) {
  if (ax === 0) return '0';
  return trimTrailingFractionZeros(roundToSignificantString(ax, SIG_DIGITS));
}

/** The unsigned digit string for a non-negative magnitude, per FIX n / FLOAT
 * (spec 3: "FIX 0-9 — fixes decimal places"; "FLOAT — up to 10 digits ...
 * with no trailing zeros"). Shared between plain and SCI-mantissa display. */
function magnitudeToString(ax, mode) {
  if (ax === 0) return typeof mode.decimals === 'number' ? (0).toFixed(mode.decimals) : '0';
  if (typeof mode.decimals === 'number') return ax.toFixed(mode.decimals);
  return formatFloatMagnitude(ax);
}

function numToSignedStr(n) {
  return n < 0 ? NEG_GLYPH + String(-n) : String(n);
}

function splitSci(ax) {
  let exp = Math.floor(Math.log10(ax));
  let mantissa = ax / Math.pow(10, exp);
  if (mantissa >= 10) {
    mantissa /= 10;
    exp += 1;
  } else if (mantissa < 1) {
    mantissa *= 10;
    exp -= 1;
  }
  return { mantissa, exp };
}

// Builds the "<mantissa> x10^<exp>" presentation: literal text in Classic,
// literal text with `E` in Data-editor/recall-menu contexts (spec 7's "E
// substitution", opts.eNotation), or mantissa + true-superscript exponent
// in MathPrint (spec 7's SCI description).
function sciLayout(mantissaText, expText, mode, opts) {
  if (opts && opts.eNotation) return text(`${mantissaText}E${expText}`);
  if (mode.entry === 'CLASSIC') return text(`${mantissaText}x10^${expText}`);
  return row(text(mantissaText), supLayout(text(`${MUL_GLYPH}10`), text(expText)));
}

function formatSci(x, mode, opts) {
  const neg = x < 0;
  const ax = Math.abs(x);
  let { mantissa, exp } = splitSci(ax);
  let mantissaText = magnitudeToString(mantissa, mode);
  // guard rounding carrying the mantissa up to 10 (e.g. 9.9999999996 -> 10.0)
  if (parseFloat(mantissaText) >= 10) {
    exp += 1;
    mantissa = parseFloat(mantissaText) / 10;
    mantissaText = magnitudeToString(mantissa, mode);
  }
  const signedMantissaText = (neg ? NEG_GLYPH : '') + mantissaText;
  return sciLayout(signedMantissaText, numToSignedStr(exp), mode, opts);
}

/** Renders a plain JS number per NORM/SCI and FIX/FLOAT (spec 3, 7). This is
 * the terminal case for any Value that has collapsed to (or always was) a
 * plain decimal: Flt, an integer Rat, a fraction/pi-multiple forced to
 * decimal (formatDecimal), or a Classic-mode pi-multiple (spec 5.4). */
function formatPlainNumber(x, mode, opts) {
  if (x === 0 || Object.is(x, -0)) {
    const zeroStr = typeof mode.decimals === 'number' ? (0).toFixed(mode.decimals) : '0';
    return text(zeroStr);
  }
  if (mode.notation === 'SCI') return formatSci(x, mode, opts);
  const neg = x < 0;
  const ax = Math.abs(x);
  const digitsStr = magnitudeToString(ax, mode);
  const isZeroDisplay = parseFloat(digitsStr) === 0;
  const out = neg && !isZeroDisplay ? NEG_GLYPH + digitsStr : digitsStr;
  return text(out);
}

// ======================================================================= //
//  Fractions (spec 3, 5.5)                                                //
// ======================================================================= //

function buildSimpleFrac(n, d, mode) {
  return mode.entry === 'CLASSIC' ? text(`${n}/${d}`) : fracLayout(text(String(n)), text(String(d)));
}

/** n/d with n,d BigInt, d>1 (a "needs a fraction" magnitude — sign and any
 * not-in-lowest-terms marker are applied by the caller). Honours fracStyle
 * (Un/d mixed vs n/d simple) and entry (MathPrint stacked vs Classic inline). */
function buildFractionCore(absN, d, mode) {
  if (mode.fracStyle === 'Un/d' && absN > d) {
    const whole = absN / d;
    const rem = absN % d;
    if (rem === 0n) return text(String(whole));
    if (mode.entry === 'CLASSIC') return text(`${whole} ${rem}/${d}`);
    return row(text(`${whole} `), buildSimpleFrac(rem, d, mode));
  }
  return buildSimpleFrac(absN, d, mode);
}

/** Rat with d != 1n. */
function formatFraction(v, mode, opts) {
  let display = v;
  let showMarker = false;
  if (mode.simp === 'AUTOSIMP') {
    display = value.reduce(v);
  } else {
    const red = value.reduce(v);
    showMarker = red.n !== v.n || red.d !== v.d;
  }
  if (display.d === 1n) {
    // AUTOSIMP fully reduced this to a whole number — display as a plain
    // integer, not "n/1".
    return formatPlainNumber(value.toNumber(display), mode, opts);
  }
  const neg = display.n < 0n;
  const absN = neg ? -display.n : display.n;
  let core = buildFractionCore(absN, display.d, mode);
  if (neg) core = row(text(NEG_GLYPH), core);
  if (showMarker) core = row(core, text(MANSIMP_MARKER));
  return core;
}

// ======================================================================= //
//  Exact pi multiples (spec 5.4)                                          //
// ======================================================================= //

function formatPiRat(v, mode, opts) {
  if (v.n === 0n) return formatPlainNumber(0, mode, opts);
  if (mode.entry === 'CLASSIC') {
    // spec 5.4: "In Classic mode, pi expressions display as decimal
    // approximations instead" of exact pi-multiples.
    return formatPlainNumber(value.toNumber(v), mode, opts);
  }
  const neg = v.n < 0n;
  const absN = neg ? -v.n : v.n;
  const d = v.d;
  let coeffN = absN;
  let coeffD = d;
  let showMarker = false;
  if (mode.simp === 'AUTOSIMP') {
    const red = value.reduce({ k: 'rat', n: absN, d });
    coeffN = red.n;
    coeffD = red.d;
  } else {
    const red = value.reduce({ k: 'rat', n: absN, d });
    showMarker = red.n !== absN || red.d !== d;
  }
  let core;
  if (coeffD === 1n) {
    core = text(coeffN === 1n ? PI_GLYPH : `${coeffN}${PI_GLYPH}`);
  } else {
    core = row(buildFractionCore(coeffN, coeffD, mode), text(PI_GLYPH));
  }
  if (neg) core = row(text(NEG_GLYPH), core);
  if (showMarker) core = row(core, text(MANSIMP_MARKER));
  return core;
}

// ======================================================================= //
//  formatValue                                                             //
// ======================================================================= //

/**
 * @param {import('./value.js').Value} v
 * @param {object} mode ModeState (see file header)
 * @param {{eNotation?: boolean}} [opts] eNotation: render SCI as "1.2E5"
 *   (spec 7's Data-editor / 2nd[recall]-menu substitution) instead of the
 *   ×10ⁿ / x10^n glyph.
 * @returns {object} Layout
 */
export function formatValue(v, mode, opts = {}) {
  if (v == null || typeof v !== 'object') throw new TypeError(`not a Value: ${JSON.stringify(v)}`);
  // spec 5.9 / eos.js `evalIntDiv`: int/ attaches a non-Value `.remainder` to
  // the quotient; eos.js explicitly hands the `5r2` rendering to format.js.
  if (v.remainder !== undefined) {
    const q = { k: v.k, n: v.n, d: v.d };
    return row(formatValue(q, mode, opts), text('r'), formatValue(v.remainder, mode, opts));
  }
  switch (v.k) {
    case 'rat':
      return v.d === 1n ? formatPlainNumber(value.toNumber(v), mode, opts) : formatFraction(v, mode, opts);
    case 'pirat':
      return formatPiRat(v, mode, opts);
    case 'float':
      return formatPlainNumber(v.v, mode, opts);
    default:
      throw new TypeError(`not a Value: ${JSON.stringify(v)}`);
  }
}

/** Forces the decimal presentation of any Value, ignoring exactness — the
 * "always decimal" half of the `<->` toggle (spec 5.4). calculator.js pairs
 * this with `formatValue` and its own per-answer toggle state; format.js
 * does not track which half is currently shown. */
export function formatDecimal(v, mode, opts = {}) {
  return formatPlainNumber(value.toNumber(v), mode, opts);
}

/** `2nd [>%]` (spec 5.8): express a value as a percentage, e.g. `1/5` -> `20%`. */
export function formatPercent(v, mode, opts = {}) {
  const pct = value.toNumber(v) * 100;
  return row(formatPlainNumber(pct, mode, opts), text('%'));
}

/** `2nd [angle] >DMS` (spec 4.3): decimal degrees -> degrees-minutes-seconds,
 * e.g. `1.5` -> `1°30'0"`. */
export function formatDms(v) {
  const x = value.toNumber(v);
  const neg = x < 0;
  const ax = Math.abs(x);
  let deg = Math.floor(ax);
  let remMin = (ax - deg) * 60;
  let min = Math.floor(remMin + 1e-9);
  let sec = (remMin - min) * 60;
  let secRounded = Math.round(sec * 1000) / 1000;
  if (secRounded >= 60) {
    secRounded -= 60;
    min += 1;
  }
  if (min >= 60) {
    min -= 60;
    deg += 1;
  }
  const secText = trimTrailingFractionZeros(secRounded.toFixed(3));
  const sign = neg ? NEG_GLYPH : '';
  return text(`${sign}${deg}°${min}'${secText}"`);
}

// ======================================================================= //
//  formatEntry — the entry-line Node[] tree (see eos.js header)           //
// ======================================================================= //

const OP_TEXT = {
  '+': '+',
  '-': SUB_GLYPH,
  '*': MUL_GLYPH,
  '/': DIV_GLYPH,
  intdiv: 'int÷',
  nPr: 'nPr',
  nCr: 'nCr',
};

const FUNC_LABELS = {
  sin: 'sin',
  cos: 'cos',
  tan: 'tan',
  asin: 'sin⁻¹',
  acos: 'cos⁻¹',
  atan: 'tan⁻¹',
  log: 'log',
  ln: 'ln',
  exp10: '10^',
  expE: 'e^',
  lcm: 'lcm',
  gcd: 'gcd',
  cube: 'cube',
  cbrt: 'cbrt',
  abs: 'abs',
  round: 'round',
  ipart: 'iPart',
  fpart: 'fPart',
  min: 'min',
  max: 'max',
  remainder: 'remainder',
  r2pr: 'R►Pr',
  r2ptheta: 'R►Pθ',
  p2rx: 'P►Rx',
  p2ry: 'P►Ry',
};

/**
 * @param {Array} nodes entry-line Node[] (see src/engine/eos.js header)
 * @param {object} mode ModeState
 * @returns {object} Layout, always `{t:'row', items:[...]}`
 */
export function formatEntry(nodes, mode) {
  return row(...renderSequence(nodes || [], mode));
}

// Renders a flat sibling Node[] into an array of Layouts. Mirrors eos.js's
// own scanning: 'pow' and 'postfix' nodes attach to whatever was rendered
// immediately before them (they are markers in the flat array, not wrapping
// nodes — see eos.js's header comment), and 'neg' is a prefix marker that
// wraps the *entire* following base+postfix/pow chain (matching parseNeg /
// parsePow's precedence: neg is priority 6, below pow's priority 5, so
// `(-)3 x^2` = -(3^2), not (-3)^2).
function renderSequence(nodes, mode) {
  const items = [];
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i];
    if (node.t === 'neg') {
      const { layout, consumed } = renderNegChain(nodes, i, mode);
      items.push(layout);
      i += consumed;
      continue;
    }
    if (node.t === 'pow') {
      const base = items.pop() ?? text('');
      items.push(attachPow(base, node, mode));
      i += 1;
      continue;
    }
    if (node.t === 'postfix') {
      const base = items.pop() ?? text('');
      items.push(renderPostfix(node.v, base, mode));
      i += 1;
      continue;
    }
    items.push(renderPrimary(node, mode));
    i += 1;
  }
  return items;
}

function attachPow(base, node, mode) {
  const expLayout = singleOrRow(renderSequence(node.exp || [], mode));
  return mode.entry === 'CLASSIC' ? row(base, text('^'), expLayout) : supLayout(base, expLayout);
}

function renderNegChain(nodes, i, mode) {
  if (nodes[i] && nodes[i].t === 'neg') {
    const inner = renderNegChain(nodes, i + 1, mode);
    return { layout: row(text(NEG_GLYPH), inner.layout), consumed: inner.consumed + 1 };
  }
  let j = i;
  let base = renderPrimary(nodes[j], mode);
  j += 1;
  for (;;) {
    if (nodes[j] && nodes[j].t === 'pow') {
      base = attachPow(base, nodes[j], mode);
      j += 1;
      continue;
    }
    if (nodes[j] && nodes[j].t === 'postfix') {
      base = renderPostfix(nodes[j].v, base, mode);
      j += 1;
      continue;
    }
    break;
  }
  return { layout: base, consumed: j - i };
}

function renderPostfix(op, base, mode) {
  switch (op) {
    case 'square':
      return mode.entry === 'CLASSIC' ? row(base, text('^2')) : supLayout(base, text('2'));
    case 'factorial':
      return row(base, text('!'));
    case 'percent':
      return row(base, text('%'));
    case 'deg':
      return row(base, text('°'));
    case 'min':
      return row(base, text("'"));
    case 'sec':
      return row(base, text('"'));
    case 'rad':
      return row(base, text('r'));
    case 'pct_convert':
      return row(base, text(' ►%'));
    case 'dms_convert':
      return row(base, text(' ►DMS'));
    case 'frac_convert':
      // eos.js's single `frac_convert` postfix tag covers two distinct keys
      // (`2nd[n/d<->Un/d]` and `2nd[f<->d]`) — see file header. Generic
      // placeholder pending a richer node shape from calculator.js.
      return row(base, text(' ►n/d'));
    default:
      return base;
  }
}

function wrapClassicGroup(items) {
  if (items.length === 1) return items[0];
  return row(text('('), ...items, text(')'));
}

function renderFracNode(node, mode) {
  const numItems = renderSequence(node.num || [], mode);
  const denItems = renderSequence(node.den || [], mode);
  if (mode.entry === 'CLASSIC') {
    return row(wrapClassicGroup(numItems), text('/'), wrapClassicGroup(denItems));
  }
  return fracLayout(singleOrRow(numItems), singleOrRow(denItems));
}

function renderMixedNode(node, mode) {
  const wholeItems = renderSequence(node.whole || [], mode);
  const numItems = renderSequence(node.num || [], mode);
  const denItems = renderSequence(node.den || [], mode);
  const wholeLayout = singleOrRow(wholeItems);
  if (mode.entry === 'CLASSIC') {
    return row(wholeLayout, text(' '), wrapClassicGroup(numItems), text('/'), wrapClassicGroup(denItems));
  }
  return row(row(wholeLayout, text(' ')), fracLayout(singleOrRow(numItems), singleOrRow(denItems)));
}

function renderRadicalNode(node, idxNodes, mode) {
  const argItems = renderSequence(node.arg || [], mode);
  if (mode.entry === 'CLASSIC') {
    const body = row(text('√('), ...argItems, text(')'));
    if (!idxNodes) return body;
    const idxLayout = wrapClassicGroup(renderSequence(idxNodes, mode));
    return row(idxLayout, body);
  }
  const argLayout = singleOrRow(argItems);
  if (!idxNodes) return radicalLayout(argLayout);
  const idxLayout = singleOrRow(renderSequence(idxNodes, mode));
  return radicalLayout(argLayout, idxLayout);
}

function renderFuncNode(node, mode) {
  const label = FUNC_LABELS[node.v] ?? node.v;
  const argItems = renderSequence(node.arg || [], mode);
  if (node.arg2 === undefined) {
    return row(text(`${label}(`), ...argItems, text(')'));
  }
  const arg2Items = renderSequence(node.arg2 || [], mode);
  return row(text(`${label}(`), ...argItems, text(','), ...arg2Items, text(')'));
}

function renderSciNode(node, mode) {
  return sciLayout(String(node.v), String(node.exp), mode, undefined);
}

function renderPrimary(node, mode) {
  switch (node.t) {
    case 'num':
      return text(node.v);
    case 'const':
      return text(node.v === 'pi' ? PI_GLYPH : 'e');
    case 'var':
      return text(node.v);
    case 'ans':
      return text('Ans');
    case 'op':
      return text(OP_TEXT[node.v] ?? node.v);
    case 'paren': {
      const inner = renderSequence(node.arg || [], mode);
      return row(text('('), ...inner, text(')'));
    }
    case 'frac':
      return renderFracNode(node, mode);
    case 'mixed':
      return renderMixedNode(node, mode);
    case 'sqrt':
      return renderRadicalNode(node, null, mode);
    case 'root':
      return renderRadicalNode(node, node.idx, mode);
    case 'func':
      return renderFuncNode(node, mode);
    case 'sci':
      return renderSciNode(node, mode);
    default:
      return text('');
  }
}
