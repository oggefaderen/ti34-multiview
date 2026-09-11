import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as value from '../src/engine/value.js';
import {
  formatValue,
  formatEntry,
  formatPercent,
  formatDms,
  formatDecimal,
} from '../src/engine/format.js';

// ---- Value builders -------------------------------------------------------
const rat = (n, d = 1) => value.rat(BigInt(n), BigInt(d));
const pirat = (n, d = 1) => value.pirat(BigInt(n), BigInt(d));
const flt = (v) => value.flt(v);

// ---- Node builders, matching the shapes pinned in src/engine/eos.js -------
const num = (v) => ({ t: 'num', v: String(v) });
const opNode = (v) => ({ t: 'op', v });
const negNode = () => ({ t: 'neg' });
const pi = () => ({ t: 'const', v: 'pi' });
const eConst = () => ({ t: 'const', v: 'e' });
const varNode = (v) => ({ t: 'var', v });
const ansNode = () => ({ t: 'ans' });
const paren = (...arg) => ({ t: 'paren', arg });
const frac = (n, d) => ({ t: 'frac', num: n, den: d });
const mixed = (whole, n, d) => ({ t: 'mixed', whole, num: n, den: d });
const sqrtNode = (...arg) => ({ t: 'sqrt', arg });
const rootNode = (idx, arg) => ({ t: 'root', idx, arg });
const powNode = (...exp) => ({ t: 'pow', exp });
const postfix = (v) => ({ t: 'postfix', v });
const sci = (mant, exp) => ({ t: 'sci', v: mant, exp });
const func = (v, arg, arg2) => {
  const n = { t: 'func', v, arg };
  if (arg2) n.arg2 = arg2;
  return n;
};

// ---- ModeState builder — defaults are spec section 3's defaults ----------
function mode(overrides = {}) {
  return {
    angle: 'DEG',
    notation: 'NORM',
    decimals: 'FLOAT',
    entry: 'MATHPRINT',
    fracStyle: 'Un/d',
    simp: 'MANSIMP',
    ...overrides,
  };
}

// ---- Layout -> plain string, for content-only assertions ------------------
// (Structural assertions, where they matter, inspect `.t`/`.num`/`.den`/etc
// directly instead of going through this.)
function flatten(layout) {
  if (!layout) return '';
  switch (layout.t) {
    case 'text':
      return layout.text;
    case 'row':
      return layout.items.map(flatten).join('');
    case 'frac':
      return `${flatten(layout.num)}/${flatten(layout.den)}`;
    case 'sup':
      return `${flatten(layout.base)}^${flatten(layout.sup)}`;
    case 'radical':
      return layout.index ? `${flatten(layout.index)}√(${flatten(layout.arg)})` : `√(${flatten(layout.arg)})`;
    default:
      throw new Error(`unknown layout node: ${JSON.stringify(layout)}`);
  }
}

// ============================================================ section 7 ===
describe('spec 7 — 13 carried, 10 displayed', () => {
  test('pi computes as 3.141592653590 internally, displays as 3.141592654', () => {
    const p = pirat(1, 1);
    // Classic collapses pi expressions to decimal (spec 5.4) — use that to
    // exercise the 13-carried/10-displayed rounding path directly.
    const out = formatValue(p, mode({ entry: 'CLASSIC' }));
    assert.equal(flatten(out), '3.141592654');
  });

  test('a float already rounded to 13 sig figs displays rounded to 10', () => {
    const v = flt(1 / 3); // 0.3333333333333 (13 sig figs) -> 0.3333333333 (10)
    const out = formatValue(v, mode());
    assert.equal(flatten(out), '0.3333333333');
  });
});

// ============================================================ section 3/7 =
describe('spec 3/7 — FLOAT vs FIX 0-9', () => {
  test('FLOAT shows up to 10 digits with no trailing zeros', () => {
    const out = formatValue(rat(1, 2), mode({ simp: 'AUTOSIMP' })); // -> 0.5, no fraction
    // force decimal to check trailing-zero trimming instead of fraction path
    const dec = formatDecimal(rat(5, 2), mode());
    assert.equal(flatten(dec), '2.5');
  });

  test('FLOAT trims trailing zeros: 4/2 -> 2 (not 2.0000000000)', () => {
    const out = formatDecimal(rat(4, 2), mode());
    assert.equal(flatten(out), '2');
  });

  for (const n of [0, 2, 4]) {
    test(`FIX ${n} fixes exactly ${n} decimal places`, () => {
      const out = formatDecimal(rat(52, 10), mode({ decimals: n })); // 5.2
      assert.equal(flatten(out), (5.2).toFixed(n));
    });
  }

  test('FIX 2 pads integers with trailing zero decimals', () => {
    const out = formatDecimal(rat(5, 1), mode({ decimals: 2 }));
    assert.equal(flatten(out), '5.00');
  });

  test('FIX lights independent of NORM/SCI — FIX 3 in SCI fixes the mantissa', () => {
    const out = formatDecimal(rat(123456, 1), mode({ decimals: 3, notation: 'SCI' }));
    assert.equal(flatten(out), '1.235×10^5');
  });
});

// ============================================================ section 7 ===
describe('spec 7 — NORM vs SCI', () => {
  test('SCI is one digit before the point plus a power of ten', () => {
    const out = formatDecimal(rat(12345678, 100), mode({ notation: 'SCI' })); // 123456.78
    // FLOAT trims trailing zeros (spec 3/7), so an 8-sig-fig value stays at
    // 8 sig figs rather than being padded out to 10.
    assert.equal(flatten(out), '1.2345678×10^5');
  });

  test('SCI in MathPrint uses a true superscript exponent', () => {
    const out = formatDecimal(rat(200000, 1), mode({ notation: 'SCI', entry: 'MATHPRINT' }));
    assert.equal(out.t, 'row');
    const supNode = out.items[1];
    assert.equal(supNode.t, 'sup');
    assert.equal(supNode.base.text, '×10');
    assert.equal(supNode.sup.text, '5');
  });

  test('SCI in Classic renders the exponent as literal text x10^n', () => {
    const out = formatDecimal(rat(200000, 1), mode({ notation: 'SCI', entry: 'CLASSIC' }));
    assert.equal(out.t, 'text');
    assert.equal(out.text, '2x10^5');
  });

  test('negative SCI exponent', () => {
    const out = formatDecimal(rat(1, 100000), mode({ notation: 'SCI', entry: 'CLASSIC' }));
    assert.match(out.text, /^1x10\^/);
  });

  test('x10^n entry shortcut: 2 x10^n 5 renders as 2x10^5 (classic)', () => {
    const nodes = [sci('2', '5')];
    const out = formatEntry(nodes, mode({ entry: 'CLASSIC' }));
    assert.equal(flatten(out), '2x10^5');
  });

  test('x10^n entry shortcut renders with true superscript in MathPrint', () => {
    const nodes = [sci('2', '5')];
    const out = formatEntry(nodes, mode({ entry: 'MATHPRINT' }));
    assert.equal(flatten(out), '2×10^5');
  });

  test('the result of x10^n still displays per the notation mode (NORM -> plain)', () => {
    // 2 x10^5 evaluated is 200000; under NORM it just shows 200000.
    const out = formatValue(rat(200000, 1), mode({ notation: 'NORM' }));
    assert.equal(flatten(out), '200000');
  });

  test('E substitution: Data editor / recall menu print E instead of x10^n', () => {
    const out = formatValue(rat(200000, 1), mode({ notation: 'SCI' }), { eNotation: true });
    assert.equal(flatten(out), '2E5');
  });
});

// ============================================================ section 5.5 =
describe('spec 5.5/3 — fractions', () => {
  test('Un/d (mixed, default) style: 5/4 -> 1 1/4', () => {
    const out = formatValue(rat(5, 4), mode({ fracStyle: 'Un/d' }));
    assert.equal(out.t, 'row');
    assert.equal(out.items[0].text.trim(), '1');
    assert.equal(out.items[1].t, 'frac');
    assert.equal(out.items[1].num.text, '1');
    assert.equal(out.items[1].den.text, '4');
  });

  test('n/d (simple) style keeps 5/4 improper', () => {
    const out = formatValue(rat(5, 4), mode({ fracStyle: 'n/d' }));
    assert.equal(out.t, 'frac');
    assert.equal(out.num.text, '5');
    assert.equal(out.den.text, '4');
  });

  test('MathPrint fractions are stacked frac Layouts', () => {
    const out = formatValue(rat(1, 8), mode({ entry: 'MATHPRINT' }));
    assert.equal(out.t, 'frac');
  });

  test('Classic fractions are on one line: 1/8', () => {
    const out = formatValue(rat(1, 8), mode({ entry: 'CLASSIC' }));
    assert.equal(out.t, 'text');
    assert.equal(out.text, '1/8');
  });

  test('MANSIMP: unreduced result (6/12) carries the not-in-lowest-terms marker', () => {
    const out = formatValue(rat(6, 12), mode({ simp: 'MANSIMP', fracStyle: 'n/d' }));
    assert.equal(out.t, 'row');
    assert.equal(out.items[0].t, 'frac');
    assert.equal(out.items[0].num.text, '6');
    assert.equal(out.items[0].den.text, '12');
    assert.equal(out.items[1].text, '↓'); // down-arrow marker
  });

  test('MANSIMP: already-reduced fraction carries NO marker', () => {
    const out = formatValue(rat(1, 2), mode({ simp: 'MANSIMP', fracStyle: 'n/d' }));
    assert.equal(out.t, 'frac');
  });

  test('AUTOSIMP: 1/4 + 3/12 (represented as 6/12) reduces to 1/2, no marker', () => {
    const sum = rat(6, 12);
    const out = formatValue(sum, mode({ simp: 'AUTOSIMP', fracStyle: 'n/d' }));
    assert.equal(out.t, 'frac');
    assert.equal(out.num.text, '1');
    assert.equal(out.den.text, '2');
  });

  test('AUTOSIMP fully reducing to a whole number displays as an integer, not n/1', () => {
    const out = formatValue(rat(4, 2), mode({ simp: 'AUTOSIMP' }));
    assert.equal(out.t, 'text');
    assert.equal(out.text, '2');
  });

  test('negative fraction carries the raised-minus glyph, not binary minus', () => {
    const out = formatValue(rat(-1, 2), mode({ fracStyle: 'n/d' }));
    assert.equal(out.t, 'row');
    assert.equal(out.items[0].text, '⁻'); // raised minus
    assert.equal(out.items[1].t, 'frac');
  });
});

// ============================================================ section 5.4 =
describe('spec 5.4 — exact pi multiples', () => {
  test('2 x pi -> 2π in MathPrint', () => {
    const out = formatValue(pirat(2, 1), mode({ entry: 'MATHPRINT' }));
    assert.equal(flatten(out), '2π');
  });

  test('pi x 12^2 -> 144π in MathPrint', () => {
    const out = formatValue(pirat(144, 1), mode({ entry: 'MATHPRINT' }));
    assert.equal(flatten(out), '144π');
  });

  test('bare pi -> π, not 1π', () => {
    const out = formatValue(pirat(1, 1), mode({ entry: 'MATHPRINT' }));
    assert.equal(flatten(out), 'π');
  });

  test('Classic mode: pi expressions display as decimal approximations', () => {
    const out2pi = formatValue(pirat(2, 1), mode({ entry: 'CLASSIC' }));
    assert.equal(flatten(out2pi), '6.283185307');
    const out144pi = formatValue(pirat(144, 1), mode({ entry: 'CLASSIC' }));
    assert.equal(flatten(out144pi), '452.3893421');
  });

  test('<->  toggle equivalent: formatDecimal forces the decimal form regardless of mode', () => {
    const out = formatDecimal(pirat(2, 1), mode({ entry: 'MATHPRINT' }));
    assert.equal(flatten(out), '6.283185307');
  });
});

// ======================================================== section 2.4/5.5 =
describe('spec 2.4 — MathPrint vs Classic entry rendering', () => {
  test('MathPrint: fraction entry is a stacked frac Layout', () => {
    const nodes = [frac([num(1)], [num(8)])];
    const out = formatEntry(nodes, mode({ entry: 'MATHPRINT' }));
    assert.equal(out.t, 'row');
    assert.equal(out.items[0].t, 'frac');
    assert.equal(out.items[0].num.text, '1');
    assert.equal(out.items[0].den.text, '8');
  });

  test('Classic: fraction entry renders as 1/8 on one line', () => {
    const nodes = [frac([num(1)], [num(8)])];
    const out = formatEntry(nodes, mode({ entry: 'CLASSIC' }));
    assert.equal(flatten(out), '1/8');
  });

  test('MathPrint: 2^5 uses a true superscript sup Layout', () => {
    const nodes = [num(2), powNode(num(5))];
    const out = formatEntry(nodes, mode({ entry: 'MATHPRINT' }));
    assert.equal(out.items[0].t, 'sup');
    assert.equal(out.items[0].base.text, '2');
    assert.equal(out.items[0].sup.text, '5');
  });

  test('Classic: 2^5 renders as literal text on one line', () => {
    const nodes = [num(2), powNode(num(5))];
    const out = formatEntry(nodes, mode({ entry: 'CLASSIC' }));
    assert.equal(flatten(out), '2^5');
  });

  test('Classic: cube root of 64 (x-root) renders as "3√(64)" on one line', () => {
    const nodes = [rootNode([num(3)], [num(64)])];
    const out = formatEntry(nodes, mode({ entry: 'CLASSIC' }));
    assert.equal(flatten(out), '3√(64)');
  });

  test('MathPrint: radical has a vinculum (radical Layout) and a pre-superscript index for x-root', () => {
    const nodes = [rootNode([num(3)], [num(64)])];
    const out = formatEntry(nodes, mode({ entry: 'MATHPRINT' }));
    assert.equal(out.items[0].t, 'radical');
    assert.equal(flatten(out.items[0].index), '3');
    assert.equal(flatten(out.items[0].arg), '64');
  });

  test('MathPrint: plain sqrt has no index', () => {
    const nodes = [sqrtNode(num(64))];
    const out = formatEntry(nodes, mode({ entry: 'MATHPRINT' }));
    assert.equal(out.items[0].t, 'radical');
    assert.equal(out.items[0].index, undefined);
  });

  test('mixed number Un/d entry: MathPrint stacks whole + frac', () => {
    const nodes = [mixed([num(4)], [num(1)], [num(2)])];
    const out = formatEntry(nodes, mode({ entry: 'MATHPRINT' }));
    assert.equal(out.items[0].t, 'row');
    assert.equal(out.items[0].items[1].t, 'frac');
  });

  test('mixed number Un/d entry: Classic renders on one line', () => {
    const nodes = [mixed([num(4)], [num(1)], [num(2)])];
    const out = formatEntry(nodes, mode({ entry: 'CLASSIC' }));
    assert.equal(flatten(out), '4 1/2');
  });
});

// ============================================================ section 5.3 =
describe('spec 5.3 — negation vs subtraction', () => {
  test('(-)3 renders with a raised minus, distinct from the binary minus glyph', () => {
    const negOut = formatEntry([negNode(), num(3)], mode());
    const subOut = formatEntry([num(1), opNode('-'), num(3)], mode());
    const negGlyph = negOut.items[0].items[0].text;
    const subGlyph = subOut.items[1].text;
    assert.notEqual(negGlyph, subGlyph);
    assert.equal(negGlyph, '⁻');
  });

  test('(-)3 x^2 = raised-minus wraps the WHOLE base+postfix chain (matches eos precedence)', () => {
    const nodes = [negNode(), num(3), postfix('square')];
    const out = formatEntry(nodes, mode({ entry: 'MATHPRINT' }));
    // rendered as: ⁻(3²) — the neg wraps the sup, not just the "3"
    assert.equal(out.items[0].t, 'row');
    assert.equal(out.items[0].items[0].text, '⁻');
    assert.equal(out.items[0].items[1].t, 'sup');
  });

  test('chained negation (-)(-)3 nests the glyph twice', () => {
    const nodes = [negNode(), negNode(), num(3)];
    const out = formatEntry(nodes, mode());
    assert.equal(flatten(out), '⁻⁻3');
  });
});

// ======================================================== section 5.8/4.3 =
describe('spec 5.8/4.3 — percent and DMS presentation', () => {
  test('1/5 ►% -> 20%', () => {
    const out = formatPercent(rat(1, 5), mode());
    assert.equal(flatten(out), '20%');
  });

  test('3% x 5000 evaluates to 150 (sanity: eos handles the math; format just needs 20% style)', () => {
    // Not a format.js concern per se, but confirms percent conversion math
    // lines up with what formatPercent renders for other values too.
    const out = formatPercent(rat(3, 4), mode());
    assert.equal(flatten(out), '75%');
  });

  test('1.5 ►DMS -> 1°30\'0"', () => {
    const out = formatDms(rat(3, 2), mode());
    assert.equal(flatten(out), '1°30\'0"');
  });

  test('negative angle DMS carries the raised-minus glyph', () => {
    const out = formatDms(rat(-3, 2), mode());
    assert.equal(flatten(out).startsWith('⁻'), true);
  });
});

// ==================================================== spec 5.9 (eos note) =
describe('spec 5.9 — int/ remainder display (flagged in eos.js for format.js)', () => {
  test('17 int/ 3 -> 5r2', () => {
    const q = rat(5, 1);
    q.remainder = rat(2, 1);
    const out = formatValue(q, mode());
    assert.equal(flatten(out), '5r2');
  });
});

// ==================================================== section 0/2.1 note ==
describe('spec 0/2.1 — Layout never truncates; overflow is the renderer\'s job', () => {
  test('a long fraction is rendered in full, not elided', () => {
    // coprime — already in lowest terms, so no MANSIMP marker complicates
    // the assertion (this test is about NOT truncating for width, not
    // about simplification).
    const out = formatValue(rat(99999989, 100000007), mode({ fracStyle: 'n/d' }));
    assert.equal(flatten(out), '99999989/100000007');
  });

  test('a very large magnitude renders in full under NORM (no digit loss)', () => {
    const out = formatDecimal(rat(123400000000n, 1n), mode({ notation: 'NORM' }));
    assert.equal(flatten(out), '123400000000');
  });

  test('a very small magnitude renders in full under NORM', () => {
    const out = formatValue(flt(1.234e-8), mode({ notation: 'NORM' }));
    assert.equal(flatten(out), '0.00000001234');
  });
});

// =============================================== edge cases / zero / sign ==
describe('zero and sign edge cases', () => {
  test('zero displays as plain "0", never "-0"', () => {
    assert.equal(flatten(formatValue(rat(0, 1), mode())), '0');
    assert.equal(flatten(formatValue(flt(-0), mode())), '0');
  });

  test('FIX rounds a tiny negative number to a zero display without a sign', () => {
    const out = formatDecimal(flt(-0.0001), mode({ decimals: 2 }));
    assert.equal(flatten(out), '0.00');
  });

  test('zero in SCI mode shows "0", not "0×10^0"', () => {
    const out = formatValue(rat(0, 1), mode({ notation: 'SCI' }));
    assert.equal(flatten(out), '0');
  });

  test('a whole-number Rat (d===1n) is a plain integer, not a fraction', () => {
    const out = formatValue(rat(7, 1), mode());
    assert.equal(out.t, 'text');
    assert.equal(out.text, '7');
  });
});

// ======================================================== pi + fractions ==
describe('spec 5.4/5.5 interplay — fractional pi coefficients', () => {
  test('pi/2 (MathPrint, AUTOSIMP) renders as a fraction of pi', () => {
    const out = formatValue(pirat(1, 2), mode({ entry: 'MATHPRINT', simp: 'AUTOSIMP', fracStyle: 'n/d' }));
    assert.equal(out.t, 'row');
    assert.equal(out.items[0].t, 'frac');
    assert.equal(out.items[0].num.text, '1');
    assert.equal(out.items[0].den.text, '2');
    assert.equal(out.items[1].text, 'π');
  });

  test('an unreduced pi coefficient carries the MANSIMP marker too', () => {
    const out = formatValue(pirat(2, 4), mode({ entry: 'MATHPRINT', simp: 'MANSIMP', fracStyle: 'n/d' }));
    assert.equal(flatten(out).endsWith('↓'), true);
  });
});

// ============================================================ FIX + fracs =
describe('formatEntry: operators between operands render inline, unchanged', () => {
  test('1 + 2 renders as three inline tokens', () => {
    const out = formatEntry([num(1), opNode('+'), num(2)], mode());
    assert.equal(flatten(out), '1+2');
  });

  test('1 - 2 uses the binary minus glyph (distinct from raised minus)', () => {
    const out = formatEntry([num(1), opNode('-'), num(2)], mode());
    assert.equal(flatten(out), '1−2');
  });

  test('paren wraps its contents literally', () => {
    const out = formatEntry([paren(num(3), opNode('+'), num(4))], mode());
    assert.equal(flatten(out), '(3+4)');
  });

  test('trig function renders as a prefix call needing a closing paren', () => {
    const out = formatEntry([func('sin', [num(30)])], mode());
    assert.equal(flatten(out), 'sin(30)');
  });

  test('two-argument function separates args with a comma', () => {
    const out = formatEntry([func('round', [num('3.456')], [num(2)])], mode());
    assert.equal(flatten(out), 'round(3.456,2)');
  });

  test('var and ans render as their literal names', () => {
    assert.equal(flatten(formatEntry([varNode('x')], mode())), 'x');
    assert.equal(flatten(formatEntry([ansNode()], mode())), 'Ans');
  });
});
