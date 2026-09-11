import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../src/engine/menus.js';
import * as S from '../src/engine/stats.js';

const {
  openMenu, closeMenu, popMenu, navigate, currentSelection, toMenuModel,
  MODE_LINES, MODE_DEFAULTS, MENU_IDS,
} = M;

/** Labels of the current tab/list's items, in order (e.g. ['1: nPr', ...]). */
function labels(stack) {
  return toMenuModel(stack).items.map((it) => it.label);
}

// A minimal fake 1-Var result, just enough to drive statVarMenu/StatVars.
const FAKE_1VAR = {
  type: '1-var', dataList: 'L1', frqList: 'ONE', header: '1-Var:L1,ONE',
  n: 5, xbar: 10, Sx: 2, sigmax: 1.8, sumX: 50, sumX2: 520,
};
const FAKE_2VAR = {
  type: '2-var', xList: 'L1', yList: 'L2', header: '2-Var:L1,L2',
  n: 5, xbar: 10, Sx: 2, sigmax: 1.8, ybar: 20, Sy: 3, sigmay: 2.7,
  sumX: 50, sumX2: 520, sumY: 100, sumY2: 2040, sumXY: 1010,
  a: 1.5, b: 5, r: 0.98,
};

// -------------------------------------------------------------- prb (4.2) --

describe('spec 4.2 — prb', () => {
  test('two tabs, PRB active by default', () => {
    const m = toMenuModel(openMenu('prb'));
    assert.deepEqual(m.tabs, ['PRB', 'RAND']);
    assert.equal(m.activeTab, 0);
  });

  test('PRB tab items verbatim', () => {
    const stack = openMenu('prb');
    assert.deepEqual(labels(stack), ['1: nPr', '2: nCr', '3: !']);
  });

  test('RIGHT switches to RAND tab, items verbatim', () => {
    const stack = navigate(openMenu('prb'), 'right');
    assert.equal(toMenuModel(stack).activeTab, 1);
    assert.deepEqual(labels(stack), ['1: rand', '2: randint(']);
  });

  test('LEFT from RAND switches back to PRB', () => {
    let stack = openMenu('prb');
    stack = navigate(stack, 'right');
    stack = navigate(stack, 'left');
    assert.equal(toMenuModel(stack).activeTab, 0);
    assert.deepEqual(labels(stack), ['1: nPr', '2: nCr', '3: !']);
  });
});

// -------------------------------------------------------- 2nd [angle] (4.3) --

describe('spec 4.3 — 2nd [angle]', () => {
  test('tabs are DMS / R◄►P', () => {
    const m = toMenuModel(openMenu('angle'));
    assert.deepEqual(m.tabs, ['DMS', 'R◄►P']);
  });

  test('DMS tab items verbatim', () => {
    const stack = openMenu('angle');
    assert.deepEqual(labels(stack), ['1: deg', "2: '", '3: "', '4: r', '5: ►DMS']);
  });

  test('R◄►P tab items verbatim', () => {
    const stack = navigate(openMenu('angle'), 'right');
    assert.deepEqual(labels(stack), ['1: R►Pr(', '2: R►Pθ(', '3: P►Rx(', '4: P►Ry(']);
  });
});

// ---------------------------------------------------------- 2nd [log] (4.4) --

describe('spec 4.4 — 2nd [log]', () => {
  test('tabs are LOG / LN with verbatim items', () => {
    const stack = openMenu('log');
    const m = toMenuModel(stack);
    assert.deepEqual(m.tabs, ['LOG', 'LN']);
    assert.deepEqual(labels(stack), ['1: log(', '2: 10^(']);
    assert.deepEqual(labels(navigate(stack, 'right')), ['1: ln(', '2: e^(']);
  });
});

// --------------------------------------------------------- 2nd [trig] (4.5) --

describe('spec 4.5 — 2nd [trig]', () => {
  test('single panel, title TRIG, six items in order', () => {
    const stack = openMenu('trig');
    const m = toMenuModel(stack);
    assert.deepEqual(m.tabs, []);
    assert.equal(m.title, 'TRIG');
    assert.deepEqual(labels(stack), [
      '1: sin(', '2: cos(', '3: tan(', '4: sin⁻¹(', '5: cos⁻¹(', '6: tan⁻¹(',
    ]);
  });
});

// --------------------------------------------------------------- math (4.6) --

describe('spec 4.6 — math', () => {
  test('MATH tab verbatim (including "^3 (cube)")', () => {
    const stack = openMenu('math');
    assert.deepEqual(toMenuModel(stack).tabs, ['MATH', 'NUM']);
    assert.deepEqual(labels(stack), ['1: lcm(', '2: gcd(', '3: ^3 (cube)', '4: cbrt(']);
  });

  test('NUM tab verbatim, seven items', () => {
    const stack = navigate(openMenu('math'), 'right');
    assert.deepEqual(labels(stack), [
      '1: abs(', '2: round(', '3: iPart(', '4: fPart(', '5: min(', '6: max(', '7: remainder(',
    ]);
  });
});

// ------------------------------------------------------------ data data (4.7) --

describe('spec 4.7 — data data (we implement CLEAR/CNVRSN, not CLR/FORMULA)', () => {
  test('tabs are CLEAR / CNVRSN', () => {
    assert.deepEqual(toMenuModel(openMenu('dataMenu')).tabs, ['CLEAR', 'CNVRSN']);
  });

  test('CLEAR tab verbatim', () => {
    const stack = openMenu('dataMenu');
    assert.deepEqual(labels(stack), ['1: Clear L1', '2: Clear L2', '3: Clear L3', '4: Clear ALL']);
  });

  test('CNVRSN tab verbatim', () => {
    const stack = navigate(openMenu('dataMenu'), 'right');
    assert.deepEqual(labels(stack), [
      '1: Add/Edit Cnvrs', '2: Clear L1 Cnvrs', '3: Clear L2 Cnvrs', '4: Clear L3 Cnvrs', '5: Clear ALL',
    ]);
  });

  test('the nested "Ls" list picker opened from inside Add/Edit Cnvrs', () => {
    const stack = openMenu('listPicker');
    const m = toMenuModel(stack);
    assert.equal(m.title, 'Ls');
    assert.deepEqual(labels(stack), ['1: L1', '2: L2', '3: L3']);
  });
});

// ------------------------------------------------------------- 2nd [stat] (4.8) --

describe('spec 4.8 — 2nd [stat]', () => {
  test('without a prior calculation, only 1-Var/2-Var Stats are offered', () => {
    const stack = openMenu('stat', {});
    assert.deepEqual(labels(stack), ['1: 1-Var Stats', '2: 2-Var Stats']);
  });

  test('StatVars appears as item 3 after a 1-Var calculation', () => {
    const stack = openMenu('stat', { statResult: FAKE_1VAR });
    assert.deepEqual(labels(stack), ['1: 1-Var Stats', '2: 2-Var Stats', '3: StatVars']);
  });

  test('StatVars appears as item 3 after a 2-Var calculation', () => {
    const stack = openMenu('stat', { statResult: FAKE_2VAR });
    assert.deepEqual(labels(stack), ['1: 1-Var Stats', '2: 2-Var Stats', '3: StatVars']);
  });

  test('StatVars menu reuses stats.js statVarMenu verbatim (1-Var, 6 items)', () => {
    const stack = openMenu('statVars', { statResult: FAKE_1VAR });
    const expected = S.statVarMenu(FAKE_1VAR).map((e) => `${e.key}: ${e.name}`);
    assert.deepEqual(labels(stack), expected);
    assert.equal(expected.length, 6);
  });

  test('StatVars menu reuses stats.js statVarMenu verbatim (2-Var, 17 items, keys 1-9 then A-H)', () => {
    const stack = openMenu('statVars', { statResult: FAKE_2VAR });
    const entries = S.statVarMenu(FAKE_2VAR);
    assert.deepEqual(labels(stack), entries.map((e) => `${e.key}: ${e.name}`));
    assert.deepEqual(entries.map((e) => e.key).slice(0, 9), ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    assert.deepEqual(entries.map((e) => e.key).slice(9), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    assert.equal(entries.length, 17);
  });

  test('opening statVars without a statResult is a caller bug, not a CalcError', () => {
    assert.throws(() => openMenu('statVars', {}), TypeError);
  });
});

// --------------------------------------------------- small confirmation menus (4.9) --

describe('spec 4.9 — 2nd [reset] / 2nd [recall] / 2nd [clear var]', () => {
  test('Reset lists No first, then Yes', () => {
    const stack = openMenu('reset');
    assert.equal(toMenuModel(stack).title, 'Reset');
    assert.deepEqual(labels(stack), ['1: No', '2: Yes']);
  });

  test('Clear Var lists Yes first, then No — the deliberate asymmetry with Reset', () => {
    const stack = openMenu('clearVar');
    assert.equal(toMenuModel(stack).title, 'Clear Var');
    assert.deepEqual(labels(stack), ['1: Yes', '2: No']);
  });

  test('Recall Var shows each variable with its current value inline', () => {
    const stack = openMenu('recall', {
      varValues: { x: '196000', y: '0', z: '0', t: '0', a: '0', b: '0', c: '0' },
    });
    assert.equal(toMenuModel(stack).title, 'Recall Var');
    assert.deepEqual(labels(stack), [
      '1: x=196000', '2: y=0', '3: z=0', '4: t=0', '5: a=0', '6: b=0', '7: c=0',
    ]);
  });

  test('Recall Var defaults an unspecified variable to 0', () => {
    const stack = openMenu('recall', { varValues: { x: '5' } });
    assert.equal(labels(stack)[0], '1: x=5');
    assert.equal(labels(stack)[1], '2: y=0');
  });
});

// -------------------------------------------------------------- navigation (4.1) --

describe('spec 4.1 — navigation model', () => {
  test('DOWN moves the highlight, UP moves it back', () => {
    let stack = openMenu('prb');
    assert.equal(toMenuModel(stack).selected, 0);
    stack = navigate(stack, 'down');
    assert.equal(toMenuModel(stack).selected, 1);
    stack = navigate(stack, 'down');
    assert.equal(toMenuModel(stack).selected, 2);
    stack = navigate(stack, 'up');
    assert.equal(toMenuModel(stack).selected, 1);
  });

  test('UP/DOWN clamp at the ends rather than wrapping', () => {
    let stack = openMenu('prb'); // 3 items
    stack = navigate(stack, 'up'); // already at 0
    assert.equal(toMenuModel(stack).selected, 0);
    stack = navigate(stack, 'down');
    stack = navigate(stack, 'down');
    stack = navigate(stack, 'down'); // past the end
    assert.equal(toMenuModel(stack).selected, 2);
  });

  test('pressing an item number directly moves the highlight to it', () => {
    const stack = navigate(openMenu('prb'), 'd3');
    assert.equal(toMenuModel(stack).selected, 2);
    assert.equal(currentSelection(stack).text, '!');
  });

  test('letters A-H select items in a long list (2-Var StatVars)', () => {
    const stack = navigate(openMenu('statVars', { statResult: FAKE_2VAR }), 'D');
    const sel = currentSelection(stack);
    assert.equal(sel.key, 'D');
    assert.equal(sel.name, 'a');
  });

  test('enter does not itself change the stack; currentSelection reports the highlighted item', () => {
    const before = navigate(openMenu('prb'), 'down');
    const after = navigate(before, 'enter');
    assert.deepEqual(after, before);
    assert.equal(currentSelection(after).text, 'nCr');
  });

  test('clear pops exactly one level of a nested stack', () => {
    let stack = openMenu('stat', { statResult: FAKE_1VAR });
    stack = navigate(stack, 'd3'); // highlight "3: StatVars"
    stack = openMenu('statVars', { statResult: FAKE_1VAR }, stack); // push
    assert.equal(toMenuModel(stack).title ?? null, null);
    assert.deepEqual(labels(stack)[0], '1: n');

    stack = navigate(stack, 'clear'); // pop back to the stat menu
    assert.deepEqual(labels(stack), ['1: 1-Var Stats', '2: 2-Var Stats', '3: StatVars']);

    stack = navigate(stack, 'clear'); // pop the last frame -> closed
    assert.equal(stack, null);
  });

  test('2nd [quit] (navigate with "quit") exits all the way to Home regardless of depth', () => {
    let stack = openMenu('stat', { statResult: FAKE_1VAR });
    stack = openMenu('statVars', { statResult: FAKE_1VAR }, stack);
    stack = navigate(stack, 'quit');
    assert.equal(stack, null);
  });

  test('closeMenu() always fully exits', () => {
    const stack = openMenu('prb');
    assert.equal(closeMenu(stack), null);
  });

  test('popMenu() on a single-frame stack closes it (returns null, not [])', () => {
    const stack = openMenu('prb');
    assert.equal(popMenu(stack), null);
  });

  test('navigate on an already-closed menu is a safe no-op', () => {
    assert.equal(navigate(null, 'down'), null);
    assert.equal(navigate(null, 'clear'), null);
  });

  test('LEFT/RIGHT are no-ops on a single-panel (non-tab) menu', () => {
    const stack = openMenu('trig');
    assert.deepEqual(navigate(stack, 'left'), stack);
    assert.deepEqual(navigate(stack, 'right'), stack);
  });
});

// ----------------------------------------------------------------- MODE (3) --

describe('spec 3 — MODE menu', () => {
  test('six lines, options and defaults verbatim', () => {
    assert.equal(MODE_LINES.length, 6);
    assert.deepEqual(MODE_LINES.map((l) => l.options), [
      ['DEG', 'RAD'],
      ['NORM', 'SCI'],
      ['FLOAT', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
      ['CLASSIC', 'MATHPRINT'],
      ['Un/d', 'n/d'],
      ['MANSIMP', 'AUTOSIMP'],
    ]);
    assert.deepEqual(MODE_DEFAULTS, {
      angle: 'DEG', notation: 'NORM', decimals: 'FLOAT',
      entry: 'MATHPRINT', fracStyle: 'Un/d', simp: 'MANSIMP',
    });
  });

  test('opening with no ctx uses the spec defaults, current option = index 0 on every default line except CLASSIC/MATHPRINT', () => {
    const stack = openMenu('mode');
    const m = toMenuModel(stack);
    assert.equal(m.items.length, 4); // 4 of 6 visible at a time
    assert.equal(m.items[0].currentOption, 0); // DEG
    assert.equal(m.items[1].currentOption, 0); // NORM
    assert.equal(m.items[2].currentOption, 0); // FLOAT
    assert.equal(m.items[3].currentOption, 1); // MATHPRINT is index 1 of CLASSIC/MATHPRINT
  });

  test('ctx.mode seeds the current settings (e.g. RAD, FIX 3, CLASSIC)', () => {
    const stack = openMenu('mode', {
      mode: { angle: 'RAD', notation: 'NORM', decimals: 3, entry: 'CLASSIC', fracStyle: 'Un/d', simp: 'MANSIMP' },
    });
    const m = toMenuModel(stack);
    assert.equal(m.items[0].currentOption, 1); // RAD
    assert.equal(m.items[2].currentOption, 4); // FLOAT,0,1,2,3 -> index 4
    assert.equal(m.items[3].currentOption, 0); // CLASSIC
  });

  test('scrolling: paging DOWN through all six lines eventually reveals the last line and clears scrollDown', () => {
    let stack = openMenu('mode');
    assert.equal(toMenuModel(stack).scrollUp, false);
    assert.equal(toMenuModel(stack).scrollDown, true);

    stack = navigate(stack, 'down'); // line index 1
    stack = navigate(stack, 'down'); // line index 2
    stack = navigate(stack, 'down'); // line index 3 (still within the first window, 0-3)
    let m = toMenuModel(stack);
    assert.equal(m.scrollDown, true);
    assert.equal(m.items.length, 4);

    stack = navigate(stack, 'down'); // line index 4 -> window slides to 1-4
    m = toMenuModel(stack);
    assert.equal(m.scrollUp, true); // line 1 (angle) has scrolled off
    assert.equal(m.scrollDown, true); // line 6 (simp) still not visible

    stack = navigate(stack, 'down'); // line index 5 (last) -> window slides to 2-5
    m = toMenuModel(stack);
    assert.equal(m.scrollUp, true);
    assert.equal(m.scrollDown, false);
    assert.equal(m.items[m.items.length - 1].key, 'simp'); // last line (MANSIMP/AUTOSIMP) now visible
  });

  test('LEFT/RIGHT move the option cursor within the highlighted line without committing', () => {
    let stack = openMenu('mode'); // line 0: DEG/RAD, cursor at DEG (index 0)
    stack = navigate(stack, 'right');
    let sel = currentSelection(stack);
    assert.equal(sel.option, 'RAD');
    // not yet committed: currentOption (inverse video) is still DEG
    assert.equal(toMenuModel(stack).items[0].currentOption, 0);
  });

  test('ENTER commits the highlighted option as the new current setting', () => {
    let stack = openMenu('mode');
    stack = navigate(stack, 'right'); // cursor -> RAD
    stack = navigate(stack, 'enter'); // commit
    assert.equal(toMenuModel(stack).items[0].currentOption, 1);
    assert.equal(currentSelection(stack).option, 'RAD');
  });

  test('moving to a different line and back resets the cursor to that line\'s committed value', () => {
    let stack = openMenu('mode');
    stack = navigate(stack, 'right'); // pending RAD, not committed
    stack = navigate(stack, 'down'); // move to NORM/SCI line
    stack = navigate(stack, 'up'); // back to DEG/RAD line
    assert.equal(currentSelection(stack).option, 'DEG'); // pending RAD was abandoned
  });

  test('leave with clear or 2nd [quit]', () => {
    assert.equal(navigate(openMenu('mode'), 'clear'), null);
    assert.equal(navigate(openMenu('mode'), 'quit'), null);
  });
});

// --------------------------------------------------------- stats setup (6.2) --

describe('spec 6.2 — 1-Var / 2-Var stats setup screens', () => {
  test('1-Var setup: title, DATA/FRQ rows with spec-verbatim option lists, CALC row', () => {
    const stack = openMenu('statSetup1Var');
    const m = toMenuModel(stack);
    assert.equal(m.title, '1-VAR STATS');
    assert.equal(m.items.length, 3);
    assert.equal(m.items[0].label, 'DATA: L1 L2 L3');
    assert.equal(m.items[1].label, 'FRQ: ONE L1 L2 L3');
    assert.equal(m.items[2].label, 'CALC');
    assert.equal(m.items[2].align, 'right');
  });

  test('2-Var setup: title, xDATA/yDATA rows, no FRQ, CALC row', () => {
    const stack = openMenu('statSetup2Var');
    const m = toMenuModel(stack);
    assert.equal(m.title, '2-VAR STATS');
    assert.equal(m.items.length, 3);
    assert.equal(m.items[0].label, 'xDATA: L1 L2 L3');
    assert.equal(m.items[1].label, 'yDATA: L1 L2 L3');
    assert.equal(m.items[2].label, 'CALC');
  });

  test('defaults: DATA=L1, FRQ=ONE', () => {
    const sel = currentSelection(openMenu('statSetup1Var'));
    assert.deepEqual(sel.values, { data: 'L1', frq: 'ONE' });
  });

  test('RIGHT cycles the highlighted field live (no separate commit step)', () => {
    let stack = openMenu('statSetup1Var'); // cursor on DATA row
    stack = navigate(stack, 'right');
    assert.equal(currentSelection(stack).values.data, 'L2');
    stack = navigate(stack, 'right');
    assert.equal(currentSelection(stack).values.data, 'L3');
    stack = navigate(stack, 'right'); // clamps, does not wrap
    assert.equal(currentSelection(stack).values.data, 'L3');
  });

  test('DOWN moves to FRQ, then to CALC; LEFT/RIGHT on CALC is a no-op', () => {
    let stack = openMenu('statSetup1Var');
    stack = navigate(stack, 'down'); // FRQ row
    assert.equal(currentSelection(stack).row, 'frq');
    stack = navigate(stack, 'right');
    assert.equal(currentSelection(stack).values.frq, 'L1');

    stack = navigate(stack, 'down'); // CALC row
    let sel = currentSelection(stack);
    assert.equal(sel.row, 'calc');
    assert.equal(sel.isCalc, true);

    const before = sel.values;
    stack = navigate(stack, 'right'); // no-op on CALC
    assert.deepEqual(currentSelection(stack).values, before);
  });

  test('ctx.fields seeds custom starting values', () => {
    const stack = openMenu('statSetup2Var', { fields: { xdata: 'L2', ydata: 'L3' } });
    assert.deepEqual(currentSelection(stack).values, { xdata: 'L2', ydata: 'L3' });
  });
});

// -------------------------------------------------------------- misc / API --

describe('menus.js — general API surface', () => {
  test('MENU_IDS lists every menu-opening key from spec 4.1 plus mode/statVars/listPicker/statSetup', () => {
    for (const id of [
      'mode', 'prb', 'angle', 'log', 'trig', 'math', 'dataMenu',
      'stat', 'reset', 'recall', 'clearVar', 'statVars', 'listPicker',
      'statSetup1Var', 'statSetup2Var',
    ]) {
      assert.ok(MENU_IDS.includes(id), `MENU_IDS missing ${id}`);
    }
  });

  test('openMenu throws on an unknown id (a caller bug)', () => {
    assert.throws(() => openMenu('not-a-menu'), TypeError);
  });

  test('toMenuModel(null) is null', () => {
    assert.equal(toMenuModel(null), null);
  });

  test('a tab menu\'s display shape matches DisplayModel.menu (title/tabs/activeTab/items/selected)', () => {
    const m = toMenuModel(openMenu('prb'));
    assert.ok(Array.isArray(m.tabs));
    assert.ok(Array.isArray(m.items));
    assert.equal(typeof m.selected, 'number');
    assert.equal(typeof m.activeTab, 'number');
    for (const item of m.items) assert.equal(typeof item.label, 'string');
  });

  test('openMenu never mutates a stack passed in as the push target', () => {
    const root = openMenu('stat', { statResult: FAKE_1VAR });
    const rootCopy = JSON.parse(JSON.stringify(root));
    openMenu('statVars', { statResult: FAKE_1VAR }, root);
    assert.deepEqual(root, rootCopy);
  });
});
