import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../src/engine/value.js';
import * as S from '../src/engine/stats.js';

const { CalcError } = V;
const {
  emptyLists, setCell, clearList, getCell, listLength,
  oneVarStats, twoVarStats, statVarMenu, predictX, predictY,
  MAX_LIST_LEN, LIST_IDS,
} = S;

function throwsCode(fn, code) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof CalcError, `expected CalcError, got ${err}`);
    assert.equal(err.code, code);
    return true;
  });
}

/** Fill a list with plain-number values, cell 0 upward. */
function fill(lists, listId, values) {
  let next = lists;
  values.forEach((v, i) => {
    next = setCell(next, listId, i, v);
  });
  return next;
}

// Round to n significant digits, matching the 10-digit display (spec 7),
// so we can compare against hand-computed / guidebook decimal literals.
function toSig(x, digits = 10) {
  return Number(x.toPrecision(digits));
}

// --------------------------------------------------------------- Lists ---

describe('spec 6.1 / section 0 — list storage', () => {
  test('emptyLists() gives three empty lists', () => {
    const lists = emptyLists();
    assert.deepEqual(Object.keys(lists).sort(), ['L1', 'L2', 'L3']);
    for (const id of LIST_IDS) assert.equal(listLength(lists, id), 0);
  });

  test('setCell stores a plain number, readable back as a Value', () => {
    const lists = setCell(emptyLists(), 'L1', 0, 5);
    const cell = getCell(lists, 'L1', 0);
    assert.equal(cell.k, 'float');
    assert.equal(V.toNumber(cell), 5);
  });

  test('setCell accepts an existing Value (exact fraction) unchanged', () => {
    const half = V.rat(1n, 2n);
    const lists = setCell(emptyLists(), 'L2', 3, half);
    const cell = getCell(lists, 'L2', 3);
    assert.equal(cell.k, 'rat');
    assert.equal(cell.n, 1n);
    assert.equal(cell.d, 2n);
  });

  test('setCell does not mutate its input (pure, like the rest of the engine)', () => {
    const before = emptyLists();
    const after = setCell(before, 'L1', 0, 1);
    assert.equal(listLength(before, 'L1'), 0);
    assert.equal(listLength(after, 'L1'), 1);
  });

  test('setCell(..., null) clears a single cell', () => {
    let lists = setCell(emptyLists(), 'L1', 0, 1);
    lists = setCell(lists, 'L1', 1, 2);
    assert.equal(listLength(lists, 'L1'), 2);
    lists = setCell(lists, 'L1', 0, null);
    assert.equal(listLength(lists, 'L1'), 1);
    assert.equal(getCell(lists, 'L1', 0), undefined);
  });

  test('clearList empties a whole list', () => {
    let lists = fill(emptyLists(), 'L3', [1, 2, 3]);
    assert.equal(listLength(lists, 'L3'), 3);
    lists = clearList(lists, 'L3');
    assert.equal(listLength(lists, 'L3'), 0);
  });

  test('a list holds at most 42 items: index 41 is the last valid slot', () => {
    const lists = setCell(emptyLists(), 'L1', MAX_LIST_LEN - 1, 9);
    assert.equal(V.toNumber(getCell(lists, 'L1', MAX_LIST_LEN - 1)), 9);
  });

  test('index 42 (43rd slot) is out of range', () => {
    assert.throws(() => setCell(emptyLists(), 'L1', MAX_LIST_LEN, 9), RangeError);
  });
});

// -------------------------------------------------------------- 1-Var -----

describe('spec 6.3 — 1-Var Stats: Sx (sample) vs sigmax (population), not swapped', () => {
  // Hand-computed for [1,2,3,4,5]: sum=15, sumX2=55, xbar=3,
  // Sum(x-xbar)^2 = 55 - 5*3^2 = 10.
  // population variance = 10/5 = 2      -> sigmax = sqrt(2)  = 1.414213562
  // sample variance     = 10/4 = 2.5    -> Sx     = sqrt(2.5) = 1.581138830
  test('1,2,3,4,5 — hand-computed Sx and sigmax', () => {
    const lists = fill(emptyLists(), 'L1', [1, 2, 3, 4, 5]);
    const r = oneVarStats(lists, 'L1', 'ONE');
    assert.equal(r.n, 5);
    assert.equal(r.xbar, 3);
    assert.equal(r.sumX, 15);
    assert.equal(r.sumX2, 55);
    assert.equal(toSig(r.sigmax), 1.414213562);
    assert.equal(toSig(r.Sx), 1.58113883);
    // The classic swap bug: sample stdev (n-1 divisor) must be the LARGER one.
    assert.ok(r.Sx > r.sigmax);
  });

  test("header names the source, e.g. '1-Var:L1,ONE' (spec 6.2)", () => {
    const lists = fill(emptyLists(), 'L1', [1, 2, 3]);
    assert.equal(oneVarStats(lists, 'L1', 'ONE').header, '1-Var:L1,ONE');
  });
});

describe('spec 6.2/6.3 — 1-Var FRQ list (weighted data)', () => {
  // data=[10,20] each weighted by frq=[2,3]: n=5, sumX=80, sumX2=1400,
  // xbar=16, Sum(x-xbar)^2 = 1400 - 5*16^2 = 120.
  // sigmax = sqrt(120/5) = sqrt(24) = 4.898979486
  // Sx     = sqrt(120/4) = sqrt(30) = 5.477225575
  test('FRQ as a list weights each DATA point', () => {
    let lists = fill(emptyLists(), 'L1', [10, 20]);
    lists = fill(lists, 'L2', [2, 3]);
    const r = oneVarStats(lists, 'L1', 'L2');
    assert.equal(r.n, 5);
    assert.equal(r.xbar, 16);
    assert.equal(r.sumX, 80);
    assert.equal(r.sumX2, 1400);
    assert.equal(toSig(r.sigmax), 4.898979486);
    assert.equal(toSig(r.Sx), 5.477225575);
    assert.equal(r.frqList, 'L2');
  });

  test('FRQ: ONE is equivalent to a list of all 1s', () => {
    let withOne = fill(emptyLists(), 'L1', [3, 4, 5]);
    withOne = oneVarStats(withOne, 'L1', 'ONE');
    let withOnes = fill(emptyLists(), 'L1', [3, 4, 5]);
    withOnes = fill(withOnes, 'L3', [1, 1, 1]);
    const r2 = oneVarStats(withOnes, 'L1', 'L3');
    assert.equal(withOne.n, r2.n);
    assert.equal(withOne.xbar, r2.xbar);
  });
});

describe('spec 5.11 — FRQ DOMAIN: a negative frequency', () => {
  test('a negative entry in the FRQ list throws FRQ DOMAIN', () => {
    let lists = fill(emptyLists(), 'L1', [1, 2, 3]);
    lists = fill(lists, 'L2', [1, -1, 1]);
    throwsCode(() => oneVarStats(lists, 'L1', 'L2'), 'FRQ DOMAIN');
  });
});

describe('spec 5.11 — STAT: no data points', () => {
  test('1-Var Stats on an empty list throws STAT', () => {
    throwsCode(() => oneVarStats(emptyLists(), 'L1', 'ONE'), 'STAT');
  });

  test('2-Var Stats on empty lists throws STAT', () => {
    throwsCode(() => twoVarStats(emptyLists(), 'L1', 'L2'), 'STAT');
  });
});

describe('judgement call: 1-Var FRQ list length must match DATA length', () => {
  // Spec 5.11 states the STAT error explicitly only for "2-var with unequal
  // list lengths"; we generalise it here to the 1-Var FRQ-list case too,
  // since the pairing is equally undefined. Worth confirming on hardware.
  test('FRQ shorter than DATA throws STAT', () => {
    let lists = fill(emptyLists(), 'L1', [1, 2, 3]);
    lists = fill(lists, 'L2', [1, 1]);
    throwsCode(() => oneVarStats(lists, 'L1', 'L2'), 'STAT');
  });
});

describe('judgement call: n=1 makes the sample stdev divide by zero', () => {
  test('a single 1-Var data point throws DIVIDE BY 0, not a bogus Sx', () => {
    const lists = fill(emptyLists(), 'L1', [7]);
    throwsCode(() => oneVarStats(lists, 'L1', 'ONE'), 'DIVIDE BY 0');
  });
});

// -------------------------------------------------------------- 2-Var -----

describe('spec 5.11 — STAT: 2-Var unequal list lengths', () => {
  test('xList and yList of different lengths throws STAT', () => {
    let lists = fill(emptyLists(), 'L1', [1, 2, 3]);
    lists = fill(lists, 'L2', [1, 2]);
    throwsCode(() => twoVarStats(lists, 'L1', 'L2'), 'STAT');
  });
});

describe('spec 6.3 — least-squares regression: the guidebook braking-distance example', () => {
  // TI-34 MultiView Guidebook (education.ti.com), Statistics worked example:
  // a braking test with
  //   Speed (kph):    33     49     65     79
  //   Distance (m):   5.30   14.45  20.21  38.45
  // The guidebook gives the line of best fit as
  //   y' = 0.6773251896x' - 18.66637321
  // and estimates the stopping distance at 55 kph as y'(55) = 18.59 m; the
  // full 10-digit result quoted in spec 6.3 is y'(55) = 18.58651222.
  function brakingLists() {
    let lists = fill(emptyLists(), 'L1', [33, 49, 65, 79]);
    lists = fill(lists, 'L2', [5.3, 14.45, 20.21, 38.45]);
    return lists;
  }

  test('a (slope) and b (intercept) match the guidebook, in the guidebook naming', () => {
    const r = twoVarStats(brakingLists(), 'L1', 'L2');
    assert.equal(toSig(r.a), 0.6773251896);
    assert.equal(toSig(r.b), -18.66637321);
    assert.equal(r.header, '2-Var:L1,L2');
  });

  test("y'(55) reproduces the guidebook's 18.58651222", () => {
    const r = twoVarStats(brakingLists(), 'L1', 'L2');
    assert.equal(toSig(predictY(r, 55)), 18.58651222);
  });

  test("x' is the inverse of y' (round trip back to ~55)", () => {
    const r = twoVarStats(brakingLists(), 'L1', 'L2');
    const y = predictY(r, 55);
    assert.equal(toSig(predictX(r, y), 6), 55);
  });

  test('r (correlation coefficient) is strong and positive for this data', () => {
    const r = twoVarStats(brakingLists(), 'L1', 'L2');
    assert.equal(toSig(r.r), 0.9634117173);
  });
});

describe('spec 6.3 — 2-Var also reports the 1-Var-style fields for both x and y', () => {
  // x: [1,2,3,4,5] (same as the 1-Var hand check above)
  // y: [2,4,6,8,10] (exactly 2x, so correlation is perfect)
  test('xbar/Sx/sigmax and ybar/Sy/sigmay are computed independently per axis', () => {
    let lists = fill(emptyLists(), 'L1', [1, 2, 3, 4, 5]);
    lists = fill(lists, 'L2', [2, 4, 6, 8, 10]);
    const r = twoVarStats(lists, 'L1', 'L2');
    assert.equal(r.xbar, 3);
    assert.equal(r.ybar, 6);
    assert.equal(toSig(r.sigmax), 1.414213562);
    assert.equal(toSig(r.Sx), 1.58113883);
    assert.equal(toSig(r.sigmay), 2.828427125);
    assert.equal(toSig(r.Sy), 3.16227766);
    assert.equal(r.Sy > r.sigmay, true);
    // perfectly correlated, doubling line: y' = 2x' + 0
    assert.equal(toSig(r.a), 2);
    assert.equal(toSig(r.b, 6), 0);
    assert.equal(toSig(r.r), 1);
  });
});

describe('judgement call: a vertical scatter (constant x) makes the slope undefined', () => {
  test('identical x values throws DIVIDE BY 0 rather than a bogus regression', () => {
    let lists = fill(emptyLists(), 'L1', [5, 5, 5]);
    lists = fill(lists, 'L2', [1, 2, 3]);
    throwsCode(() => twoVarStats(lists, 'L1', 'L2'), 'DIVIDE BY 0');
  });
});

describe('predictX/predictY require a 2-Var result', () => {
  test('calling predictY on a 1-Var result is rejected (programming error, not a CalcError)', () => {
    const lists = fill(emptyLists(), 'L1', [1, 2, 3]);
    const r = oneVarStats(lists, 'L1', 'ONE');
    assert.throws(() => predictY(r, 5), TypeError);
  });
});

// ------------------------------------------------------------ StatVars ----

describe('spec 6.3 — StatVars menu: exact 1-Var ordering (6 items)', () => {
  test('1: n, 2: xbar, 3: Sx, 4: sigmax, 5: Sum x, 6: Sum x^2', () => {
    const lists = fill(emptyLists(), 'L1', [1, 2, 3, 4, 5]);
    const r = oneVarStats(lists, 'L1', 'ONE');
    const menu = statVarMenu(r);
    assert.deepEqual(
      menu.map((m) => [m.key, m.name]),
      [
        ['1', 'n'], ['2', 'xbar'], ['3', 'Sx'], ['4', 'sigmax'],
        ['5', 'Sum x'], ['6', 'Sum x^2'],
      ],
    );
    assert.equal(menu.find((m) => m.name === 'xbar').value, r.xbar);
    assert.equal(menu.find((m) => m.name === 'Sx').value, r.Sx);
  });
});

describe('spec 6.3 — StatVars menu: exact 2-Var ordering (17 items, 1-9 then A-H)', () => {
  test('full ordering, including the lettered tail C/D/E/F/G/H', () => {
    let lists = fill(emptyLists(), 'L1', [33, 49, 65, 79]);
    lists = fill(lists, 'L2', [5.3, 14.45, 20.21, 38.45]);
    const r = twoVarStats(lists, 'L1', 'L2');
    const menu = statVarMenu(r);
    assert.equal(menu.length, 17);
    assert.deepEqual(
      menu.map((m) => [m.key, m.name]),
      [
        ['1', 'n'], ['2', 'xbar'], ['3', 'Sx'], ['4', 'sigmax'],
        ['5', 'ybar'], ['6', 'Sy'], ['7', 'sigmay'],
        ['8', 'Sum x'], ['9', 'Sum x^2'],
        ['A', 'Sum y'], ['B', 'Sum y^2'], ['C', 'Sum xy'],
        ['D', 'a'], ['E', 'b'], ['F', 'r'], ['G', "x'"], ['H', "y'"],
      ],
    );
  });

  test("C: Sum xy, D: a, E: b, F: r carry their computed values", () => {
    let lists = fill(emptyLists(), 'L1', [33, 49, 65, 79]);
    lists = fill(lists, 'L2', [5.3, 14.45, 20.21, 38.45]);
    const r = twoVarStats(lists, 'L1', 'L2');
    const byKey = Object.fromEntries(statVarMenu(r).map((m) => [m.key, m]));
    assert.equal(byKey.C.name, 'Sum xy');
    assert.equal(byKey.C.value, r.sumXY);
    assert.equal(byKey.D.name, 'a');
    assert.equal(byKey.D.value, r.a);
    assert.equal(byKey.E.name, 'b');
    assert.equal(byKey.E.value, r.b);
    assert.equal(byKey.F.name, 'r');
    assert.equal(byKey.F.value, r.r);
  });

  test("G: x' and H: y' are pasted as functions, not values (spec 6.3)", () => {
    let lists = fill(emptyLists(), 'L1', [33, 49, 65, 79]);
    lists = fill(lists, 'L2', [5.3, 14.45, 20.21, 38.45]);
    const r = twoVarStats(lists, 'L1', 'L2');
    const byKey = Object.fromEntries(statVarMenu(r).map((m) => [m.key, m]));
    assert.equal(byKey.G.name, "x'");
    assert.equal(byKey.G.value, null);
    assert.equal(byKey.H.name, "y'");
    assert.equal(byKey.H.value, null);
  });
});
