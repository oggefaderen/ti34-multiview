import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as value from '../src/engine/value.js';
import { evaluate } from '../src/engine/eos.js';

const { CalcError } = value;

// ---- small Node-tree builders, matching the shapes documented at the top
// ---- of src/engine/eos.js (calculator.js doesn't exist yet — see
// ---- ARCHITECTURE.md "Since calculator.js doesn't exist yet...").
const num = (v) => ({ t: 'num', v: String(v) });
const opNode = (v) => ({ t: 'op', v });
const negNode = () => ({ t: 'neg' });
const pi = () => ({ t: 'const', v: 'pi' });
const eConst = () => ({ t: 'const', v: 'e' });
const paren = (...arg) => ({ t: 'paren', arg });
const frac = (n, d) => ({ t: 'frac', num: n, den: d });
const mixed = (whole, n, d) => ({ t: 'mixed', whole, num: n, den: d });
const sqrtNode = (...arg) => ({ t: 'sqrt', arg });
const rootNode = (idx, arg) => ({ t: 'root', idx, arg });
const powNode = (...exp) => ({ t: 'pow', exp });
const postfix = (v) => ({ t: 'postfix', v });
const func = (v, arg, arg2) => {
  const n = { t: 'func', v, arg };
  if (arg2) n.arg2 = arg2;
  return n;
};
const sci = (mant, exp) => ({ t: 'sci', v: mant, exp });
const varNode = (v) => ({ t: 'var', v });
const ansNode = () => ({ t: 'ans' });

function ctx(overrides = {}) {
  const zero = value.rat(0n, 1n);
  return {
    angle: 'DEG',
    classic: false,
    vars: { x: zero, y: zero, z: zero, t: zero, a: zero, b: zero, c: zero },
    ans: zero,
    stats: null,
    randSeed: 0n,
    ...overrides,
  };
}

function toSig(v, digits = 10) {
  return Number(value.toNumber(v).toPrecision(digits));
}

function throwsCode(fn, code) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof CalcError, `expected CalcError, got ${err}`);
    assert.equal(err.code, code);
    return true;
  });
}

describe('spec 5.1 — ^ associativity depends on mode', () => {
  test('Classic: 2^3^2 = (2^3)^2 = 64 (left-associative)', () => {
    const nodes = [num(2), powNode(num(3)), powNode(num(2))];
    const r = evaluate(nodes, ctx({ classic: true }));
    assert.equal(value.toNumber(r), 64);
  });

  test('MathPrint: 2^3^2 = 2^(3^2) = 512 (right-associative)', () => {
    const nodes = [num(2), powNode(num(3)), powNode(num(2))];
    const r = evaluate(nodes, ctx({ classic: false }));
    assert.equal(value.toNumber(r), 512);
  });
});

describe('spec 5.1 — x^2 is always left to right in BOTH modes', () => {
  for (const classic of [true, false]) {
    test(`3 x^2 x^2 = (3^2)^2 = 81 (classic=${classic})`, () => {
      const nodes = [num(3), postfix('square'), postfix('square')];
      const r = evaluate(nodes, ctx({ classic }));
      assert.equal(value.toNumber(r), 81);
    });
  }
});

describe('spec 5.2 — implicit multiplication has the SAME precedence as x and /', () => {
  test('8 / 2pi = (8/2)*pi = 12.56637061, not 8/(2pi)', () => {
    const nodes = [num(8), opNode('/'), num(2), pi()];
    const r = evaluate(nodes, ctx());
    assert.equal(toSig(r, 10), 12.56637061);
  });

  test('implicit multiplication between two variables: x y with x=3,y=4 -> 12', () => {
    const nodes = [varNode('x'), varNode('y')];
    const r = evaluate(nodes, ctx({ vars: { x: value.rat(3n, 1n), y: value.rat(4n, 1n) } }));
    assert.equal(value.toNumber(r), 12);
  });
});

describe('spec 5.3 — negation (-) is priority 6, BELOW exponentiation', () => {
  test('(-)3 x^2 = -9, not (-3)^2 = 9', () => {
    const nodes = [negNode(), num(3), postfix('square')];
    const r = evaluate(nodes, ctx());
    assert.equal(value.toNumber(r), -9);
  });

  test('(-)2^2 = -(2^2) = -4, negation applies after exponentiation', () => {
    const nodes = [negNode(), num(2), powNode(num(2))];
    const r = evaluate(nodes, ctx());
    assert.equal(value.toNumber(r), -4);
  });
});

describe('parentheses, fractions, roots as self-contained primaries', () => {
  test('(2+3)*4 = 20', () => {
    const nodes = [paren(num(2), opNode('+'), num(3)), opNode('*'), num(4)];
    assert.equal(value.toNumber(evaluate(nodes, ctx())), 20);
  });

  test('MathPrint fraction node: 1/2 + 1/4 = 3/4 as a value (unreduced fraction, spec 5.5)', () => {
    const nodes = [frac([num(1)], [num(2)]), opNode('+'), frac([num(1)], [num(4)])];
    const r = evaluate(nodes, ctx());
    assert.equal(r.k, 'rat');
    // lcm(2,4)=4: 1*2/4 + 1*1/4 = 3/4
    assert.equal(r.n, 3n);
    assert.equal(r.d, 4n);
  });

  test('spec 5.5 — 4 U 1/2 (mixed number) = 4.5, is additive not implicit-mult', () => {
    const nodes = [mixed([num(4)], [num(1)], [num(2)])];
    const r = evaluate(nodes, ctx());
    assert.equal(r.k, 'rat');
    assert.equal(value.toNumber(r), 4.5);
  });

  test('a negated mixed number: -(4 U 1/2) = -4.5', () => {
    const nodes = [negNode(), mixed([num(4)], [num(1)], [num(2)])];
    const r = evaluate(nodes, ctx());
    assert.equal(value.toNumber(r), -4.5);
  });

  test('sqrt(8) = 2.828427125 (spec 5.4), always a float', () => {
    const r = evaluate([sqrtNode(num(8))], ctx());
    assert.equal(r.k, 'float');
    assert.equal(toSig(r, 10), 2.828427125);
  });

  test('x-root: cube root of -8 is -2 (odd index, negative radicand allowed)', () => {
    const r = evaluate([rootNode([num(3)], [num(-8)])], ctx());
    assert.equal(Math.round(value.toNumber(r)), -2);
  });

  test('x-root DOMAIN: index 0 (spec 5.11)', () => {
    throwsCode(() => evaluate([rootNode([num(0)], [num(8)])], ctx()), 'DOMAIN');
  });

  test('x-root DOMAIN: negative radicand with even index', () => {
    throwsCode(() => evaluate([rootNode([num(2)], [num(-8)])], ctx()), 'DOMAIN');
  });
});

describe('spec 5.10 — trig honours ctx.angle, postfix angle-unit modifiers', () => {
  test('sin(30) = 0.5 in DEG mode', () => {
    const r = evaluate([func('sin', [num(30)])], ctx({ angle: 'DEG' }));
    assert.equal(toSig(r, 6), 0.5);
  });

  test('sin(30deg) = 0.5 in RAD mode (guidebook example, spec 5.10)', () => {
    const r = evaluate([func('sin', [num(30), postfix('deg')])], ctx({ angle: 'RAD' }));
    assert.equal(toSig(r, 6), 0.5);
  });

  test('same argument, different mode gives a different answer', () => {
    const nodes = [func('sin', [num(30)])];
    const deg = evaluate(nodes, ctx({ angle: 'DEG' }));
    const rad = evaluate(nodes, ctx({ angle: 'RAD' }));
    assert.notEqual(toSig(deg, 6), toSig(rad, 6));
  });

  test('2pi keyed as radians displays as 360 in DEG mode (guidebook example)', () => {
    const nodes = [num(2), pi(), postfix('rad')];
    const r = evaluate(nodes, ctx({ angle: 'DEG' }));
    assert.equal(r.k, 'rat');
    assert.equal(value.toNumber(r), 360);
  });

  test("30' (arcminutes) = 0.5 degrees", () => {
    const r = evaluate([num(30), postfix('min')], ctx({ angle: 'DEG' }));
    assert.equal(value.toNumber(r), 0.5);
  });

  test('tan DOMAIN at 90, -90, 270, -270, 450 degrees (spec 5.11)', () => {
    for (const deg of [90, -90, 270, -270, 450]) {
      throwsCode(() => evaluate([func('tan', [num(deg)])], ctx({ angle: 'DEG' })), 'DOMAIN');
    }
  });

  test('tan DOMAIN at the radian equivalent (pi/2) in RAD mode', () => {
    const nodes = [func('tan', [frac([pi()], [num(2)])])];
    throwsCode(() => evaluate(nodes, ctx({ angle: 'RAD' })), 'DOMAIN');
  });

  test('tan(45) = 1, no domain error nearby', () => {
    const r = evaluate([func('tan', [num(45)])], ctx({ angle: 'DEG' }));
    assert.equal(toSig(r, 6), 1);
  });

  test('asin/acos DOMAIN for |x|>1 (spec 5.11)', () => {
    throwsCode(() => evaluate([func('asin', [num(2)])], ctx()), 'DOMAIN');
    throwsCode(() => evaluate([func('acos', [num(-2)])], ctx()), 'DOMAIN');
  });
});

describe('spec 4.4 — log/ln/10^/e^', () => {
  test('log(100) = 2', () => {
    const r = evaluate([func('log', [num(100)])], ctx());
    assert.equal(toSig(r, 8), 2);
  });

  test('ln domain: x<=0 is DOMAIN', () => {
    throwsCode(() => evaluate([func('ln', [num(0)])], ctx()), 'DOMAIN');
    throwsCode(() => evaluate([func('ln', [num(-1)])], ctx()), 'DOMAIN');
  });

  test('log domain: x<=0 is DOMAIN', () => {
    throwsCode(() => evaluate([func('log', [num(0)])], ctx()), 'DOMAIN');
  });

  test('10^3 = 1000, stays an exact rat', () => {
    const r = evaluate([func('exp10', [num(3)])], ctx());
    assert.equal(r.k, 'rat');
    assert.equal(value.toNumber(r), 1000);
  });

  test('e^1 = 2.718281828 (e per spec 4.4)', () => {
    const r = evaluate([func('expE', [num(1)])], ctx());
    assert.equal(toSig(r, 10), 2.718281828);
  });
});

describe('spec 4.2 — nPr, nCr, factorial', () => {
  test('8 nPr 3 = 336', () => {
    const r = evaluate([num(8), opNode('nPr'), num(3)], ctx());
    assert.equal(value.toNumber(r), 336);
  });

  test('52 nCr 5 = 2598960', () => {
    const r = evaluate([num(52), opNode('nCr'), num(5)], ctx());
    assert.equal(value.toNumber(r), 2598960);
  });

  test('5! = 120', () => {
    const r = evaluate([num(5), postfix('factorial')], ctx());
    assert.equal(value.toNumber(r), 120);
  });

  test('69! is allowed', () => {
    const r = evaluate([num(69), postfix('factorial')], ctx());
    assert.equal(r.k, 'rat');
  });

  test('70! overflows (spec 4.2: whole number <= 69)', () => {
    throwsCode(() => evaluate([num(70), postfix('factorial')], ctx()), 'OVERFLOW');
  });

  test('nCr/nPr with a non-integer is DOMAIN (spec 5.11)', () => {
    throwsCode(() => evaluate([num(5), opNode('nCr'), num(0.5)], ctx()), 'DOMAIN');
  });

  test('nCr/nPr with a negative is DOMAIN', () => {
    throwsCode(() => evaluate([num(-5), opNode('nCr'), num(2)], ctx()), 'DOMAIN');
  });
});

describe('spec 4.6 — math menu functions', () => {
  test('lcm(12,18) = 36', () => {
    const r = evaluate([func('lcm', [num(12)], [num(18)])], ctx());
    assert.equal(value.toNumber(r), 36);
  });

  test('gcd(12,18) = 6', () => {
    const r = evaluate([func('gcd', [num(12)], [num(18)])], ctx());
    assert.equal(value.toNumber(r), 6);
  });

  test('cube: 3^3 (cube) = 27, exact', () => {
    const r = evaluate([func('cube', [num(3)])], ctx());
    assert.equal(r.k, 'rat');
    assert.equal(value.toNumber(r), 27);
  });

  test('cbrt(27) = 3', () => {
    const r = evaluate([func('cbrt', [num(27)])], ctx());
    assert.equal(Math.round(value.toNumber(r) * 1e6) / 1e6, 3);
  });

  test('abs(-5) = 5', () => {
    const r = evaluate([func('abs', [num(-5)])], ctx());
    assert.equal(value.toNumber(r), 5);
  });

  test('round(3.14159, 2) = 3.14', () => {
    const r = evaluate([func('round', [num('3.14159')], [num(2)])], ctx());
    assert.equal(value.toNumber(r), 3.14);
  });

  test('iPart(3.7) = 3, iPart(-3.7) = -3 (truncate toward zero)', () => {
    assert.equal(value.toNumber(evaluate([func('ipart', [num('3.7')])], ctx())), 3);
    assert.equal(value.toNumber(evaluate([func('ipart', [num('-3.7')])], ctx())), -3);
  });

  test('fPart(3.75) = 0.75, fPart(-3.7) is -0.7', () => {
    const a = evaluate([func('fpart', [num('3.75')])], ctx());
    assert.equal(Math.round(value.toNumber(a) * 100) / 100, 0.75);
    const b = evaluate([func('fpart', [num('-3.7')])], ctx());
    assert.equal(Math.round(value.toNumber(b) * 100) / 100, -0.7);
  });

  test('min(3,5) = 3, max(3,5) = 5', () => {
    assert.equal(value.toNumber(evaluate([func('min', [num(3)], [num(5)])], ctx())), 3);
    assert.equal(value.toNumber(evaluate([func('max', [num(3)], [num(5)])], ctx())), 5);
  });

  test('remainder(7,3) = 1, remainder(-7,3) = -1', () => {
    assert.equal(value.toNumber(evaluate([func('remainder', [num(7)], [num(3)])], ctx())), 1);
    assert.equal(value.toNumber(evaluate([func('remainder', [num(-7)], [num(3)])], ctx())), -1);
  });
});

describe('spec 5.8 — percent as /100', () => {
  test('2% x 150 = 3', () => {
    const nodes = [num(2), postfix('percent'), opNode('*'), num(150)];
    assert.equal(value.toNumber(evaluate(nodes, ctx())), 3);
  });

  test('3% x 5000 = 150', () => {
    const nodes = [num(3), postfix('percent'), opNode('*'), num(5000)];
    assert.equal(value.toNumber(evaluate(nodes, ctx())), 150);
  });
});

describe('spec 5.9 — integer divide returns quotient and remainder', () => {
  test('17 int/ 3 -> quotient 5 (only the quotient is the Value)', () => {
    const nodes = [num(17), opNode('intdiv'), num(3)];
    const r = evaluate(nodes, ctx());
    assert.equal(value.toNumber(r), 5);
    assert.equal(value.toNumber(r.remainder), 2);
  });
});

describe('spec 5.6/5.7 — ans and memory variables', () => {
  test('ans is recalled and used in an expression', () => {
    const nodes = [ansNode(), opNode('*'), num(2)];
    const r = evaluate(nodes, ctx({ ans: value.rat(3n, 1n) }));
    assert.equal(value.toNumber(r), 6);
  });

  test('a variable is looked up by name at evaluation time', () => {
    const nodes = [varNode('x'), opNode('+'), num(1)];
    const r = evaluate(nodes, ctx({ vars: { x: value.rat(5n, 1n) } }));
    assert.equal(value.toNumber(r), 6);
  });
});

describe('x10^n scientific literal shortcut', () => {
  test('2 x10^n 5 = 200000, exact', () => {
    const r = evaluate([sci('2', '5')], ctx());
    assert.equal(r.k, 'rat');
    assert.equal(value.toNumber(r), 200000);
  });
});

describe('malformed input', () => {
  test('empty entry is SYNTAX', () => {
    throwsCode(() => evaluate([], ctx()), 'SYNTAX');
  });

  test('a dangling operator is SYNTAX', () => {
    throwsCode(() => evaluate([num(2), opNode('+')], ctx()), 'SYNTAX');
  });

  test('an unbound variable reference is SYNTAX', () => {
    throwsCode(() => evaluate([varNode('x')], ctx({ vars: {} })), 'SYNTAX');
  });
});
