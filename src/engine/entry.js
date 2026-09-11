// The entry line: building and editing the expression the user is typing.
//
// See docs/TI-34-SPEC.md sections 2.1-2.4 (display, MathPrint), 5.5
// (fractions), 5.12 (clearing and correcting) and 5.3 (negation), and
// docs/ARCHITECTURE.md "The entry-line model".
//
// This module owns the SHAPE of what is being typed. It does not evaluate
// (eos.js) and does not lay anything out (format.js). Its output is exactly
// the Node array that `evaluate()` consumes — the Node shapes are pinned in
// the header comment of eos.js, and this file must not invent new ones.
//
// ---------------------------------------------------------------------------
// The cursor
//
// The entry is a tree, because MathPrint fractions, radicals and exponents
// nest. So the cursor cannot be a single integer: it has to say *which list*
// it is in as well as where in that list.
//
//   cursor = { path: [{ index, slot }, ...], offset }
//
// `path` walks down from the root: each step selects the node at `index` in
// the current list, then descends into that node's `slot` (a named child
// list, e.g. 'num' or 'den'). `offset` is the insertion point within the list
// the path lands on, in [0, list.length].
//
// ARCHITECTURE.md originally sketched `path` as `number[]`. That is not
// enough — a fraction has two child lists, so an index alone cannot say
// whether you are in the numerator or the denominator. The doc has been
// updated to match this shape.
//
// Every exported function is pure: it returns a new entry and never mutates
// its argument.

import { CalcError } from './value.js';

/** Named child lists for each container node type, in cursor-visit order. */
const SLOTS = {
  paren: ['arg'],
  frac: ['num', 'den'],
  mixed: ['whole', 'num', 'den'],
  sqrt: ['arg'],
  root: ['idx', 'arg'],
  pow: ['exp'],
  func: ['arg', 'arg2'],
};

/**
 * Node types that count toward the MathPrint nesting limit: at most four
 * levels of consecutive fractions, radicals, powers and squares (spec 2.1,
 * and MEMORY LIMIT in 5.11).
 */
const NESTING_TYPES = new Set(['frac', 'mixed', 'sqrt', 'root', 'pow']);

const MAX_NESTING = 4;

/** Entry-line character budget (spec 5.11, EQUATION LENGTH). */
export const MAX_ENTRY_LENGTH = 88;

/** @returns {object} a fresh, empty entry with the cursor at the start. */
export function emptyEntry() {
  return { nodes: [], cursor: { path: [], offset: 0 }, insertMode: false };
}

/** The Node array for eos.js, with digit runs merged back together. */
export function toNodes(entry) {
  return mergeNums(entry.nodes);
}

/**
 * The same nodes with a marker character spliced in at the cursor position.
 *
 * The renderer needs to know where the cursor falls *within* the rendered
 * text — including inside a fraction, where no column number would mean
 * anything. Splicing the marker in before merging puts it at exactly the
 * right character offset, and the renderer swaps it for the cursor element.
 */
export function toNodesWithMarker(entry, mark) {
  const nodes = structuredClone(entry.nodes);
  let list = nodes;
  for (const step of entry.cursor.path) {
    const node = list[step.index];
    if (!node || !Array.isArray(node[step.slot])) return mergeNums(nodes);
    list = node[step.slot];
  }
  const at = Math.min(Math.max(entry.cursor.offset, 0), list.length);
  list.splice(at, 0, { t: 'num', v: mark });
  return mergeNums(nodes);
}

export function isEmpty(entry) {
  return entry.nodes.length === 0;
}

export function clearEntry() {
  return emptyEntry();
}

export function setInsertMode(entry, on) {
  return { ...clone(entry), insertMode: !!on };
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

function clone(entry) {
  return {
    nodes: structuredClone(entry.nodes),
    cursor: structuredClone(entry.cursor),
    insertMode: entry.insertMode,
  };
}

function slotsOf(node) {
  const names = SLOTS[node.t];
  if (!names) return [];
  // func's arg2 exists only for the two-argument functions.
  return names.filter((s) => Array.isArray(node[s]));
}

function isContainer(node) {
  return node != null && slotsOf(node).length > 0;
}

/** The list the cursor is currently inside, within `entry` (live reference). */
function listAt(entry, path = entry.cursor.path) {
  let list = entry.nodes;
  for (const step of path) {
    list = list[step.index][step.slot];
  }
  return list;
}

/** The container node that owns the list at `path`, or null at the root. */
function ownerAt(entry, path) {
  if (path.length === 0) return null;
  const parentList = listAt(entry, path.slice(0, -1));
  return parentList[path[path.length - 1].index];
}

/** Deepest chain of nesting-relevant containers along the cursor path. */
function nestingDepthAt(entry) {
  let depth = 0;
  let list = entry.nodes;
  for (const step of entry.cursor.path) {
    const node = list[step.index];
    if (NESTING_TYPES.has(node.t)) depth++;
    list = node[step.slot];
  }
  return depth;
}

/** Rough printed length, used only for the EQUATION LENGTH check. */
function measure(nodes) {
  let n = 0;
  for (const node of nodes) {
    switch (node.t) {
      case 'num':
        n += String(node.v).length;
        break;
      case 'const':
      case 'var':
        n += 1;
        break;
      case 'ans':
        n += 3;
        break;
      case 'op':
        n += node.v.length > 1 ? node.v.length : 1;
        break;
      case 'neg':
        n += 1;
        break;
      case 'postfix':
        n += String(node.v).length;
        break;
      case 'sci':
        n += String(node.v).length + String(node.exp).length + 4;
        break;
      case 'func':
        n += String(node.v).length + 2;
        break;
      default:
        n += 1;
    }
    for (const slot of slotsOf(node)) n += measure(node[slot]);
  }
  return n;
}

export function entryLength(entry) {
  return measure(entry.nodes);
}

export function nodeCount(entry) {
  let n = 0;
  const walk = (nodes) => {
    for (const node of nodes) {
      n++;
      for (const slot of slotsOf(node)) walk(node[slot]);
    }
  };
  walk(toNodes(entry));
  return n;
}

/**
 * Classic mode forbids operators, functions and nested fractions *inside* a
 * fraction (spec 5.5) — the guidebook's advice there is to use `÷` instead.
 */
function assertClassicFractionContent(entry, node, classic) {
  if (!classic) return;
  const inFraction = entry.cursor.path.some((step, i) => {
    const owner = ownerAt(entry, entry.cursor.path.slice(0, i + 1));
    return owner && (owner.t === 'frac' || owner.t === 'mixed');
  });
  if (!inFraction) return;
  if (node.t === 'op' || node.t === 'func' || node.t === 'frac' || node.t === 'mixed') {
    throw new CalcError('SYNTAX');
  }
}

/* -------------------------------------------------------------------------- */
/* Editing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Insert a node at the cursor. If it is a container (fraction, radical,
 * parentheses, power), the cursor moves *into* its first slot — which is what
 * the hardware does, so you can immediately type the numerator or radicand.
 */
export function insertNode(entry, node, { classic = false } = {}) {
  assertClassicFractionContent(entry, node, classic);

  if (NESTING_TYPES.has(node.t) && nestingDepthAt(entry) >= MAX_NESTING) {
    throw new CalcError('MEMORY LIMIT');
  }

  const next = clone(entry);
  const list = listAt(next);
  list.splice(next.cursor.offset, 0, structuredClone(node));

  if (measure(next.nodes) > MAX_ENTRY_LENGTH) {
    throw new CalcError('EQUATION LENGTH');
  }

  const slots = slotsOf(node);
  if (slots.length > 0) {
    next.cursor.path.push({ index: next.cursor.offset, slot: slots[0] });
    next.cursor.offset = 0;
  } else {
    next.cursor.offset += 1;
  }
  return next;
}

/**
 * Type a digit or decimal point. Consecutive digits extend the number node
 * immediately before the cursor rather than creating a new one, so "3", "2",
 * "5" builds one `{t:'num', v:'325'}`.
 */
export function insertDigit(entry, ch) {
  if (!/^[0-9.]$/.test(ch)) throw new CalcError('SYNTAX');

  const next = clone(entry);
  const list = listAt(next);

  // Each typed character is its own node, so the cursor can move through a
  // number one digit at a time — pressing LEFT inside "2323" must land
  // between digits, not skip the whole number. `toNodes` merges the runs back
  // into the single {t:'num'} node eos.js expects.
  if (ch === '.' && runHasDecimalPoint(list, next.cursor.offset)) return entry;

  list.splice(next.cursor.offset, 0, { t: 'num', v: ch });
  next.cursor.offset += 1;

  if (measure(next.nodes) > MAX_ENTRY_LENGTH) {
    throw new CalcError('EQUATION LENGTH');
  }
  return next;
}

/** Does the contiguous run of digit nodes around `at` already hold a '.'? */
function runHasDecimalPoint(list, at) {
  for (let i = at - 1; i >= 0 && list[i] && list[i].t === 'num'; i--) {
    if (list[i].v.includes('.')) return true;
  }
  for (let i = at; i < list.length && list[i] && list[i].t === 'num'; i++) {
    if (list[i].v.includes('.')) return true;
  }
  return false;
}

/**
 * Merge runs of adjacent digit nodes into the single number node eos.js
 * expects. Editing keeps them separate (one per character) so the cursor can
 * sit between digits; evaluation and formatting want them joined.
 */
function mergeNums(nodes) {
  const out = [];
  for (const node of nodes) {
    const merged = { ...node };
    for (const slot of slotsOf(node)) merged[slot] = mergeNums(node[slot]);
    const prev = out[out.length - 1];
    if (prev && prev.t === 'num' && merged.t === 'num') {
      out[out.length - 1] = { t: 'num', v: prev.v + merged.v };
    } else {
      out.push(merged);
    }
  }
  return out;
}

/**
 * Start a fraction (spec 5.5).
 *
 * Pressed straight after a number, that number becomes the numerator — the
 * guidebook's "press n/d after a value" behaviour. Pressed on an empty entry
 * (or after an operator) it lays down an empty template instead.
 *
 * `mixed` builds a `U n/d` mixed number, whose parts are additive; eos.js has
 * a dedicated node type for that, because juxtaposing 4 and 1/2 as implicit
 * multiplication would give 2 rather than 4.5.
 */
export function startFraction(entry, { mixed = false, classic = false } = {}) {
  const next = clone(entry);
  const list = listAt(next);
  const prev = next.cursor.offset > 0 ? list[next.cursor.offset - 1] : null;

  if (NESTING_TYPES.has('frac') && nestingDepthAt(next) >= MAX_NESTING) {
    throw new CalcError('MEMORY LIMIT');
  }
  assertClassicFractionContent(next, { t: mixed ? 'mixed' : 'frac' }, classic);

  // Adopt a preceding number as the numerator (or as the whole part).
  // Adopt the whole contiguous number, not just its last digit.
  let adopted = null;
  if (prev && prev.t === 'num') {
    let start = next.cursor.offset;
    while (start > 0 && list[start - 1] && list[start - 1].t === 'num') start--;
    const run = list.splice(start, next.cursor.offset - start);
    next.cursor.offset = start;
    adopted = run;
  }

  const node = mixed
    ? { t: 'mixed', whole: adopted ?? [], num: [], den: [] }
    : { t: 'frac', num: adopted ?? [], den: [] };

  list.splice(next.cursor.offset, 0, node);

  // Land where the user will type next: the denominator if a numerator was
  // adopted, otherwise the first empty slot.
  const firstSlot = mixed ? (adopted ? 'num' : 'whole') : adopted ? 'den' : 'num';
  next.cursor.path.push({ index: next.cursor.offset, slot: firstSlot });
  next.cursor.offset = 0;

  if (measure(next.nodes) > MAX_ENTRY_LENGTH) {
    throw new CalcError('EQUATION LENGTH');
  }
  return next;
}

/**
 * In Classic mode there is no DOWN-into-the-denominator: pressing `n/d` again
 * moves from numerator to denominator (spec 5.5).
 */
export function advanceFractionSlot(entry) {
  const path = entry.cursor.path;
  if (path.length === 0) return entry;
  const owner = ownerAt(entry, path);
  if (!owner || (owner.t !== 'frac' && owner.t !== 'mixed')) return entry;

  const slots = slotsOf(owner);
  const here = slots.indexOf(path[path.length - 1].slot);
  if (here < 0 || here === slots.length - 1) return entry;

  const next = clone(entry);
  next.cursor.path[next.cursor.path.length - 1].slot = slots[here + 1];
  next.cursor.offset = listAt(next).length;
  return next;
}

/**
 * The `delete` key: remove the character at the cursor (spec 5.12).
 *
 * Digits are removed one at a time from a multi-digit number. Deleting into
 * an empty fraction part removes the whole fraction rather than stranding the
 * user inside an empty box with nothing to delete.
 */
export function backspace(entry) {
  const next = clone(entry);
  const list = listAt(next);

  if (next.cursor.offset > 0) {
    // One node is one typed character now, so this deletes exactly one.
    list.splice(next.cursor.offset - 1, 1);
    next.cursor.offset -= 1;
    return next;
  }

  // At the start of a nested list: step out, removing the container if every
  // one of its slots is empty.
  if (next.cursor.path.length > 0) {
    const step = next.cursor.path.pop();
    const parent = listAt(next);
    const container = parent[step.index];
    const allEmpty = slotsOf(container).every((s) => container[s].length === 0);
    if (allEmpty) {
      parent.splice(step.index, 1);
      next.cursor.offset = step.index;
    } else {
      next.cursor.offset = step.index;
    }
    return next;
  }

  return entry; // nothing to delete
}

/* -------------------------------------------------------------------------- */
/* Cursor movement                                                             */
/* -------------------------------------------------------------------------- */

function moveRight(entry) {
  const next = clone(entry);
  const list = listAt(next);
  const node = list[next.cursor.offset];

  if (isContainer(node)) {
    next.cursor.path.push({ index: next.cursor.offset, slot: slotsOf(node)[0] });
    next.cursor.offset = 0;
    return next;
  }
  if (next.cursor.offset < list.length) {
    next.cursor.offset += 1;
    return next;
  }
  // End of this list: move to the container's next slot, else out of it.
  if (next.cursor.path.length > 0) {
    const step = next.cursor.path[next.cursor.path.length - 1];
    const owner = ownerAt(next, next.cursor.path);
    const slots = slotsOf(owner);
    const here = slots.indexOf(step.slot);
    if (here < slots.length - 1) {
      step.slot = slots[here + 1];
      next.cursor.offset = 0;
    } else {
      next.cursor.path.pop();
      next.cursor.offset = step.index + 1;
    }
    return next;
  }
  return entry;
}

function moveLeft(entry) {
  const next = clone(entry);

  if (next.cursor.offset > 0) {
    const list = listAt(next);
    const node = list[next.cursor.offset - 1];
    if (isContainer(node)) {
      const slots = slotsOf(node);
      next.cursor.path.push({ index: next.cursor.offset - 1, slot: slots[slots.length - 1] });
      next.cursor.offset = listAt(next).length;
      return next;
    }
    next.cursor.offset -= 1;
    return next;
  }
  if (next.cursor.path.length > 0) {
    const step = next.cursor.path[next.cursor.path.length - 1];
    const owner = ownerAt(next, next.cursor.path);
    const slots = slotsOf(owner);
    const here = slots.indexOf(step.slot);
    if (here > 0) {
      step.slot = slots[here - 1];
      next.cursor.offset = listAt(next).length;
    } else {
      next.cursor.path.pop();
      next.cursor.offset = step.index;
    }
    return next;
  }
  return entry;
}

/** UP/DOWN step between the stacked parts of a fraction (spec 5.5). */
function moveVertical(entry, dir) {
  const path = entry.cursor.path;
  if (path.length === 0) return entry;
  const owner = ownerAt(entry, path);
  if (!owner || (owner.t !== 'frac' && owner.t !== 'mixed')) return entry;

  const slots = slotsOf(owner);
  const here = slots.indexOf(path[path.length - 1].slot);
  const target = dir === 'down' ? here + 1 : here - 1;
  if (target < 0 || target >= slots.length) return entry;

  const next = clone(entry);
  next.cursor.path[next.cursor.path.length - 1].slot = slots[target];
  next.cursor.offset = listAt(next).length;
  return next;
}

/** @param {'left'|'right'|'up'|'down'} dir */
export function moveCursor(entry, dir) {
  switch (dir) {
    case 'right':
      return moveRight(entry);
    case 'left':
      return moveLeft(entry);
    case 'up':
    case 'down':
      return moveVertical(entry, dir);
    default:
      return entry;
  }
}
