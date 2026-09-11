import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../src/engine/value.js';

const { rat, pirat, flt, fromDigits, add, sub, mul, div, neg, abs, pow, root,
  toNumber, isExact, reduce, simpBy, lowestPrimeFactor, cmp, round13,
  ROUND_DIGITS, CalcError } = V;

/** Round a Value to n significant digits the way the 4-line display would,
 * so we can compare directly against the literal strings TI's guidebook
 * prints (spec 5.4, 7). */
function toSig(v, digits = 10) {
  return Number(toNumber(v).toPrecision(digits));
}

function throwsCode(fn, code) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof CalcError, `expected CalcError, got ${err}`);
    assert.equal(err.code, code);
    return true;
  });
}

describe('rat() / pirat() — constructors (ARCHITECTURE value.js)', () => {
  test('normalises a negative denominator, sign lands in n', () => {
    const r = rat(3n, -4n);
    assert.equal(r.n, -3n);
    assert.equal(r.d, 4n);
  });

  test('rat(n, 0) throws DIVIDE BY 0', () => {
    throwsCode(() => rat(1n, 0n), 'DIVIDE BY 0');
  });

  test('pirat(n, 0) throws DIVIDE BY 0', () => {
    throwsCode(() => pirat(1n, 0n), 'DIVIDE BY 0');
  });

  test('does not reduce on construction', () => {
    const r = rat(6n, 12n);
    assert.equal(r.n, 6n);
    assert.equal(r.d, 12n);
  });
});

describe('fromDigits — literal parsing', () => {
  test("'3.25' -> rat(325n, 100n) (ARCHITECTURE example)", () => {
    const r = fromDigits('3.25');
    assert.equal(r.k, 'rat');
    assert.equal(r.n, 325n);
    assert.equal(r.d, 100n);
  });

  test("'5' -> rat(5n, 1n)", () => {
    const r = fromDigits('5');
    assert.equal(r.n, 5n);
    assert.equal(r.d, 1n);
  });

  test("'0.1' -> rat(1n, 10n)", () => {
    const r = fromDigits('0.1');
    assert.equal(r.n, 1n);
    assert.equal(r.d, 10n);
  });
});

describe('spec 3 / 5.5 — MANSIMP: fractions are not auto-reduced', () => {
  test('1/4 + 3/12 produces 6/12, not 1/2', () => {
    const sum = add(rat(1n, 4n), rat(3n, 12n));
    assert.equal(sum.k, 'rat');
    assert.equal(sum.n, 6n);
    assert.equal(sum.d, 12n);
  });

  test('multiplication multiplies straight through, unreduced', () => {
    const prod = mul(rat(2n, 4n), rat(3n, 6n));
    assert.equal(prod.n, 6n);
    assert.equal(prod.d, 24n);
  });

  test('reduce() lowers 6/12 to 1/2 only when called explicitly', () => {
    const r = reduce(rat(6n, 12n));
    assert.equal(r.n, 1n);
    assert.equal(r.d, 2n);
  });

  test('simpBy(6/12, 6) -> 1/2 (>simp 6 enter)', () => {
    const r = simpBy(rat(6n, 12n), 6n);
    assert.equal(r.n, 1n);
    assert.equal(r.d, 2n);
  });

  test('simpBy with factor 0 is DOMAIN (spec 5.11)', () => {
    throwsCode(() => simpBy(rat(1n, 2n), 0n), 'DOMAIN');
  });

  test('simpBy with factor >= 1e10 is DOMAIN', () => {
    throwsCode(() => simpBy(rat(1n, 2n), 10000000000n), 'DOMAIN');
  });

  test('simpBy applied to a non-fraction (pirat) is DOMAIN', () => {
    throwsCode(() => simpBy(pirat(1n, 2n), 2n), 'DOMAIN');
  });

  test('simpBy applied to a non-fraction (float) is DOMAIN', () => {
    throwsCode(() => simpBy(flt(1.5), 2n), 'DOMAIN');
  });

  test('simpBy with a factor that does not evenly divide is DOMAIN', () => {
    throwsCode(() => simpBy(rat(6n, 12n), 4n), 'DOMAIN');
  });

  test('lowestPrimeFactor(6/12) is 2 (smallest common prime of gcd 6)', () => {
    assert.equal(lowestPrimeFactor(rat(6n, 12n)), 2n);
  });

  test('lowestPrimeFactor already-lowest-terms fraction is 1', () => {
    assert.equal(lowestPrimeFactor(rat(1n, 2n)), 1n);
  });

  test('lowestPrimeFactor on a non-fraction is DOMAIN', () => {
    throwsCode(() => lowestPrimeFactor(flt(1.5)), 'DOMAIN');
  });

  test('cmp treats unreduced fractions as exactly equal', () => {
    assert.equal(cmp(rat(1n, 2n), rat(2n, 4n)), 0);
  });
});

describe('spec 5.4 — PiRat: exact pi multiples', () => {
  test('2 * pi stays an exact pi-multiple', () => {
    const twoPi = mul(rat(2n, 1n), pirat(1n, 1n));
    assert.equal(twoPi.k, 'pirat');
    assert.equal(twoPi.n, 2n);
    assert.equal(twoPi.d, 1n);
  });

  test('2pi toggled to decimal is 6.283185307 (guidebook example)', () => {
    const twoPi = mul(rat(2n, 1n), pirat(1n, 1n));
    assert.equal(toSig(twoPi, 10), 6.283185307);
  });

  test('pi * 12^2 = 144pi, toggled is 452.3893421 (guidebook example)', () => {
    const oneFortyFourPi = mul(pirat(1n, 1n), pow(rat(12n, 1n), rat(2n, 1n)));
    assert.equal(oneFortyFourPi.k, 'pirat');
    assert.equal(oneFortyFourPi.n, 144n);
    assert.equal(toSig(oneFortyFourPi, 10), 452.3893421);
  });

  test('pirat + pirat combines via lcm, stays exact', () => {
    const sum = add(pirat(1n, 2n), pirat(1n, 3n)); // pi/2 + pi/3
    assert.equal(sum.k, 'pirat');
    // lcm(2,3) = 6: 1*3 + 1*2 = 5 -> 5/6 pi
    assert.equal(sum.n, 5n);
    assert.equal(sum.d, 6n);
  });

  test('0 + 2pi stays an exact pi-multiple (zero rat vanishes)', () => {
    const r = add(rat(0n, 1n), pirat(2n, 1n));
    assert.equal(r.k, 'pirat');
    assert.equal(r.n, 2n);
  });

  test('2pi + 0 stays an exact pi-multiple', () => {
    const r = add(pirat(2n, 1n), rat(0n, 1n));
    assert.equal(r.k, 'pirat');
    assert.equal(r.n, 2n);
  });

  test('nonzero rat + pirat collapses to float (not representable exactly)', () => {
    const r = add(rat(3n, 1n), pirat(1n, 1n));
    assert.equal(r.k, 'float');
    assert.ok(isExact(r) === false);
  });

  test('pirat * pirat collapses to float (pi^2 not representable)', () => {
    const r = mul(pirat(2n, 1n), pirat(3n, 1n));
    assert.equal(r.k, 'float');
  });

  test('pirat / pirat cancels pi exactly, producing a plain Rat (unreduced)', () => {
    const r = div(pirat(4n, 1n), pirat(2n, 1n));
    assert.equal(r.k, 'rat');
    assert.equal(cmp(r, rat(2n, 1n)), 0);
    // MANSIMP: division multiplies/divides straight through, no auto-reduce.
    assert.equal(r.n, 4n);
    assert.equal(r.d, 2n);
  });

  test('isExact is true for rat and pirat, false for float', () => {
    assert.equal(isExact(rat(1n, 2n)), true);
    assert.equal(isExact(pirat(1n, 2n)), true);
    assert.equal(isExact(flt(1.5)), false);
  });
});

describe('spec 5.4 — no exact-radical form', () => {
  test('sqrt(8) is a float, 2.828427125 (guidebook example)', () => {
    const r = root(rat(2n, 1n), rat(8n, 1n));
    assert.equal(r.k, 'float');
    assert.equal(toSig(r, 10), 2.828427125);
  });

  test('sqrt of a perfect square is still a float, not an exact rat', () => {
    const r = root(rat(2n, 1n), rat(4n, 1n));
    assert.equal(r.k, 'float');
    assert.equal(toNumber(r), 2);
  });
});

describe('spec 5.11 — DOMAIN conditions', () => {
  test('x-root y with index 0 is DOMAIN', () => {
    throwsCode(() => root(rat(0n, 1n), rat(8n, 1n)), 'DOMAIN');
  });

  test('y<0 with a non-odd-integer index is DOMAIN', () => {
    throwsCode(() => root(rat(2n, 1n), rat(-8n, 1n)), 'DOMAIN');
  });

  test('y<0 with an odd-integer index is fine (real odd root)', () => {
    const r = root(rat(3n, 1n), rat(-8n, 1n));
    assert.equal(r.k, 'float');
    assert.equal(Math.round(toNumber(r) * 1e6) / 1e6, -2);
  });

  test('sqrt of a negative number is DOMAIN', () => {
    throwsCode(() => root(rat(2n, 1n), rat(-4n, 1n)), 'DOMAIN');
  });

  test('root radicand 0 with positive index is 0, not an error', () => {
    const r = root(rat(2n, 1n), rat(0n, 1n));
    assert.equal(toNumber(r), 0);
  });

  test('root radicand 0 with negative index is DIVIDE BY 0', () => {
    throwsCode(() => root(rat(-2n, 1n), rat(0n, 1n)), 'DIVIDE BY 0');
  });

  test('negative base with a non-integer exponent is DOMAIN', () => {
    throwsCode(() => pow(rat(-8n, 1n), rat(1n, 3n)), 'DOMAIN');
  });

  test('0 raised to a negative integer exponent is DIVIDE BY 0', () => {
    throwsCode(() => pow(rat(0n, 1n), rat(-2n, 1n)), 'DIVIDE BY 0');
  });

  test('0 raised to a negative non-integer exponent is DIVIDE BY 0', () => {
    throwsCode(() => pow(rat(0n, 1n), rat(-1n, 2n)), 'DIVIDE BY 0');
  });

  test('0 raised to a positive non-integer exponent is 0, not an error', () => {
    assert.equal(toNumber(pow(rat(0n, 1n), rat(1n, 2n))), 0);
  });

  test('division by zero (rat) throws DIVIDE BY 0', () => {
    throwsCode(() => div(rat(1n, 1n), rat(0n, 1n)), 'DIVIDE BY 0');
  });

  test('division by zero (pirat) throws DIVIDE BY 0', () => {
    throwsCode(() => div(rat(1n, 1n), pirat(0n, 1n)), 'DIVIDE BY 0');
  });

  test('division by zero (float) throws DIVIDE BY 0', () => {
    throwsCode(() => div(flt(1), flt(0)), 'DIVIDE BY 0');
  });
});

describe('pow — exactness preserved for integer exponents', () => {
  test('2^10 = 1024, stays exact rat', () => {
    const r = pow(rat(2n, 1n), rat(10n, 1n));
    assert.equal(r.k, 'rat');
    assert.equal(r.n, 1024n);
    assert.equal(r.d, 1n);
  });

  test('2^-1 = 1/2, stays exact rat', () => {
    const r = pow(rat(2n, 1n), rat(-1n, 1n));
    assert.equal(r.k, 'rat');
    assert.equal(r.n, 1n);
    assert.equal(r.d, 2n);
  });

  test('(-2)^3 = -8, sign handled correctly', () => {
    const r = pow(rat(-2n, 1n), rat(3n, 1n));
    assert.equal(r.n, -8n);
    assert.equal(r.d, 1n);
  });

  test('(-2)^-3 = -1/8', () => {
    const r = pow(rat(-2n, 1n), rat(-3n, 1n));
    assert.equal(r.n, -1n);
    assert.equal(r.d, 8n);
  });

  test('x^0 = 1 exactly, including 0^0', () => {
    assert.equal(pow(rat(5n, 1n), rat(0n, 1n)).n, 1n);
    assert.equal(pow(rat(0n, 1n), rat(0n, 1n)).n, 1n);
  });

  test('pirat^1 returns the same pi-multiple unchanged', () => {
    const p = pirat(3n, 2n);
    assert.deepEqual(pow(p, rat(1n, 1n)), p);
  });

  test('pirat^0 = 1', () => {
    assert.equal(pow(pirat(3n, 1n), rat(0n, 1n)).n, 1n);
  });

  test('pirat^2 collapses to float', () => {
    const r = pow(pirat(2n, 1n), rat(2n, 1n));
    assert.equal(r.k, 'float');
  });
});

describe('neg / abs', () => {
  test('neg(rat) flips sign, keeps d>0', () => {
    const r = neg(rat(3n, 4n));
    assert.equal(r.n, -3n);
    assert.equal(r.d, 4n);
  });

  test('neg(pirat) flips sign', () => {
    const r = neg(pirat(3n, 4n));
    assert.equal(r.n, -3n);
  });

  test('abs(rat) drops the sign', () => {
    assert.equal(abs(rat(-3n, 4n)).n, 3n);
  });

  test('abs(float)', () => {
    assert.equal(abs(flt(-2.5)).v, 2.5);
  });
});

describe('round13 / ROUND_DIGITS — spec section 7 (13 carried, 10 shown)', () => {
  test('ROUND_DIGITS is 13', () => {
    assert.equal(ROUND_DIGITS, 13);
  });

  test('rounds to 13 significant digits', () => {
    const r = round13(1 / 3);
    assert.equal(r, Number((1 / 3).toPrecision(13)));
  });

  test('pi carried to 13 sig figs matches spec section 7 (3.141592653590)', () => {
    const r = round13(Math.PI);
    assert.equal(r, 3.14159265359);
  });

  test('every float-producing op applies round13 (flt() invariant)', () => {
    const r = flt(1 / 3);
    assert.equal(r.v, Number((1 / 3).toPrecision(13)));
  });

  test('a huge computed number overflows', () => {
    throwsCode(() => round13(1e101), 'OVERFLOW');
  });

  test('toNumber() on a value beyond range overflows', () => {
    throwsCode(() => toNumber(rat(10n ** 120n, 1n)), 'OVERFLOW');
  });
});

describe('sub()', () => {
  test('a - b === a + (-b)', () => {
    const r = sub(rat(1n, 2n), rat(1n, 3n));
    assert.equal(r.n, 1n); // (3-2)/6
    assert.equal(r.d, 6n);
  });

  test('pirat - pirat stays exact', () => {
    const r = sub(pirat(5n, 1n), pirat(2n, 1n));
    assert.equal(r.k, 'pirat');
    assert.equal(r.n, 3n);
  });
});

describe('div() exactness table', () => {
  test('rat / rat stays exact rat', () => {
    const r = div(rat(1n, 2n), rat(3n, 4n));
    assert.equal(r.k, 'rat');
    assert.equal(r.n, 4n);
    assert.equal(r.d, 6n);
  });

  test('pirat / rat stays exact pirat', () => {
    const r = div(pirat(3n, 1n), rat(2n, 1n));
    assert.equal(r.k, 'pirat');
    assert.equal(r.n, 3n);
    assert.equal(r.d, 2n);
  });

  test('0 / pirat is exact 0', () => {
    const r = div(rat(0n, 1n), pirat(3n, 1n));
    assert.equal(r.k, 'rat');
    assert.equal(r.n, 0n);
  });

  test('nonzero rat / pirat collapses to float', () => {
    const r = div(rat(1n, 1n), pirat(1n, 1n));
    assert.equal(r.k, 'float');
  });
});
