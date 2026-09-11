// TI-34 MultiView — DisplayModel -> DOM renderer.
//
// Pure with respect to calculator state: this module reads a `DisplayModel`
// (see docs/ARCHITECTURE.md) and writes the DOM. It never computes anything
// about calculator behaviour and never calls back into the engine.
//
// DOM contract (see the comment block at the top of index.html):
//   #lcd, #lcd-lines, #annunciators, #ind-<name>, #display-menu (created
//   here on demand — it is absent from the static markup).
//
// Layout node shapes this module draws (mirrors format.js, per
// docs/ARCHITECTURE.md):
//   { t:'text', text }
//   { t:'row', items:[Layout] }
//   { t:'frac', num:Layout, den:Layout }
//   { t:'sup', base:Layout, sup:Layout }
//   { t:'radical', arg:Layout, index?:Layout }

const INDICATOR_IDS = {
  second: 'ind-second',
  fix: 'ind-fix',
  sci: 'ind-sci',
  deg: 'ind-deg',
  rad: 'ind-rad',
  L1: 'ind-l1',
  L2: 'ind-l2',
  L3: 'ind-l3',
  busy: 'ind-busy',
  scrollUp: 'ind-scroll-up',
  scrollDown: 'ind-scroll-down',
  scrollLeft: 'ind-scroll-left',
  scrollRight: 'ind-scroll-right',
};

const MAX_LINES = 4;
const MAX_COLS = 16;

// ---------------------------------------------------------------------
// Layout -> DOM
// ---------------------------------------------------------------------

/** @param {object|null|undefined} node a Layout node */
function renderLayout(node) {
  if (node == null) return document.createTextNode('');

  switch (node.t) {
    case 'text':
      return document.createTextNode(node.text ?? '');

    case 'row': {
      const span = document.createElement('span');
      for (const item of node.items || []) span.appendChild(renderLayout(item));
      return span;
    }

    case 'frac': {
      const wrap = document.createElement('span');
      wrap.className = 'frac';
      const num = document.createElement('span');
      num.className = 'num';
      num.appendChild(renderLayout(node.num));
      const den = document.createElement('span');
      den.className = 'den';
      den.appendChild(renderLayout(node.den));
      wrap.append(num, den);
      return wrap;
    }

    case 'sup': {
      // Layout property names are base/sup; the CSS classes for this
      // primitive are .pow > .base + .exp (see faceplate.css).
      const wrap = document.createElement('span');
      wrap.className = 'pow';
      const base = document.createElement('span');
      base.className = 'base';
      base.appendChild(renderLayout(node.base));
      const exp = document.createElement('span');
      exp.className = 'exp';
      exp.appendChild(renderLayout(node.sup));
      wrap.append(base, exp);
      return wrap;
    }

    case 'radical': {
      const wrap = document.createElement('span');
      wrap.className = 'radical';
      if (node.index) {
        // Pre-superscript root index (x-root). faceplate.css has no
        // dedicated class for this piece, so it is positioned with an
        // inline style rather than inventing an unstyled class name.
        const idx = document.createElement('span');
        idx.style.cssText =
          'font-size:0.55em;line-height:1;align-self:flex-start;' +
          'margin-right:-0.2em;transform:translate(0.05em,0.15em);';
        idx.appendChild(renderLayout(node.index));
        wrap.appendChild(idx);
      }
      const surd = document.createElement('span');
      surd.className = 'surd';
      surd.textContent = '√';
      const radicand = document.createElement('span');
      radicand.className = 'radicand';
      radicand.appendChild(renderLayout(node.arg));
      wrap.append(surd, radicand);
      return wrap;
    }

    default:
      // Unknown/future node type — degrade to its text if it has one
      // rather than throwing, so a format.js in flux doesn't blank the
      // screen.
      return document.createTextNode(node.text ?? '');
  }
}

/** True if a Layout node is plain text with no MathPrint nesting. */
function isFlatText(node) {
  if (node == null) return true;
  if (node.t === 'text') return true;
  if (node.t === 'row') return (node.items || []).every(isFlatText);
  return false;
}

/** Best-effort flattened text for a Layout node — used only for the
 * width/cursor heuristics below, never for the actual rendered DOM. */
function flattenText(node) {
  if (node == null) return '';
  if (node.t === 'text') return node.text ?? '';
  if (node.t === 'row') return (node.items || []).map(flattenText).join('');
  if (node.t === 'frac') return `${flattenText(node.num)}/${flattenText(node.den)}`;
  if (node.t === 'sup') return `${flattenText(node.base)}^${flattenText(node.sup)}`;
  if (node.t === 'radical') return `√${flattenText(node.arg)}`;
  return node.text ?? '';
}

// ---------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------

function makeCursorEl(style) {
  const cursor = document.createElement('span');
  cursor.className = 'cursor-block';
  if (style === 'underline') {
    // faceplate.css only ships one cursor look (.cursor-block, a solid
    // block). There is no underline variant class to reuse, so approximate
    // one with inline style instead of inventing an unstyled class name.
    cursor.style.cssText = 'height:0.14em;align-self:flex-end;transform:translateY(0.42em);';
  }
  return cursor;
}

/**
 * Insert a cursor element at character offset `col` inside `container`,
 * which must already contain the rendered Layout DOM. Walks the *rendered*
 * DOM's text nodes (not the Layout tree) so the offset lines up with what a
 * reader would count on screen.
 *
 * NOTE: `col` is a flat character offset. For a line built from nested
 * fractions/radicals/exponents this is inherently approximate — see the
 * "underspecified" note in the implementation report. It degrades
 * gracefully: an offset past the end of the line places the cursor at the
 * very end rather than throwing.
 */
function insertCursorAt(container, col, style) {
  let remaining = Math.max(0, col | 0);
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const len = node.nodeValue.length;
    if (remaining <= len) {
      const after = node.splitText(remaining);
      node.parentNode.insertBefore(makeCursorEl(style), after);
      return;
    }
    remaining -= len;
    node = walker.nextNode();
  }
  container.appendChild(makeCursorEl(style));
}

// ---------------------------------------------------------------------
// Indicators
// ---------------------------------------------------------------------

function setIndicator(root, id, lit) {
  const el = root.querySelector(`#${id}`);
  if (!el) return;
  el.classList.toggle('lit', !!lit);
}

// ---------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------

function renderMenu(lcdEl, menu) {
  let panel = lcdEl.querySelector('#display-menu');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'display-menu';
    lcdEl.appendChild(panel);
  }
  panel.hidden = false;
  panel.style.cssText = 'display:flex;flex-direction:column;flex:1 1 auto;gap:0.15em;overflow:hidden;';
  while (panel.firstChild) panel.removeChild(panel.firstChild);

  if (menu.tabs && menu.tabs.length) {
    const tabRow = document.createElement('div');
    tabRow.className = 'lcd-line two-part';
    const active = menu.activeTab ?? 0;
    menu.tabs.forEach((tab, i) => {
      const span = document.createElement('span');
      span.textContent = tab;
      if (i === active) {
        span.style.cssText = 'background:currentColor;color:var(--color-lcd-bg,#7f9686);padding:0 0.2em;border-radius:0.15em;';
      }
      tabRow.appendChild(span);
    });
    panel.appendChild(tabRow);
  } else if (menu.title) {
    const titleRow = document.createElement('div');
    titleRow.className = 'lcd-line align-left';
    titleRow.textContent = menu.title;
    panel.appendChild(titleRow);
  }

  (menu.items || []).forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'lcd-line align-left';
    row.textContent = typeof item === 'string' ? item : (item && item.label) || String(item);
    if (i === menu.selected) {
      row.style.cssText = 'background:currentColor;color:var(--color-lcd-bg,#7f9686);border-radius:0.1em;';
    }
    panel.appendChild(row);
  });
}

function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

/**
 * Render a DisplayModel into the faceplate DOM. Pure with respect to
 * calculator state: reads `model`, writes the DOM, nothing else.
 *
 * @param {object} model a DisplayModel (docs/ARCHITECTURE.md)
 * @param {Document|Element} root defaults to `document`
 */
export function render(model, root = document) {
  const lcd = root.querySelector('#lcd');
  const linesEl = root.querySelector('#lcd-lines');
  if (!lcd || !linesEl) return;

  const indicators = model.indicators || {};
  const allLines = model.lines || [];
  const overflowUp = allLines.length > MAX_LINES;

  // Indicators are always fully re-applied from the model so nothing
  // lingers from a previous render. scrollUp additionally reflects
  // render.js's own line-count clamp, in case the model didn't already
  // account for it (see report: this is a case worth pushing down into
  // calculator.js/format.js instead).
  for (const [key, id] of Object.entries(INDICATOR_IDS)) {
    const lit = key === 'scrollUp' ? indicators.scrollUp || overflowUp : indicators[key];
    setIndicator(root, id, lit);
  }

  const menuPanel = lcd.querySelector('#display-menu');

  if (model.error != null) {
    if (menuPanel) menuPanel.hidden = true;
    linesEl.style.display = '';
    clearChildren(linesEl);

    const header = document.createElement('div');
    header.className = 'lcd-line align-left';
    header.textContent = 'ERROR';
    const message = document.createElement('div');
    message.className = 'lcd-line align-left';
    message.textContent = model.error;
    linesEl.append(header, message);
    for (let i = 2; i < MAX_LINES; i++) {
      const blank = document.createElement('div');
      blank.className = 'lcd-line align-left';
      linesEl.appendChild(blank);
    }
    return;
  }

  if (model.menu) {
    linesEl.style.display = 'none';
    clearChildren(linesEl);
    renderMenu(lcd, model.menu);
    return;
  }

  if (menuPanel) menuPanel.hidden = true;
  linesEl.style.display = '';
  clearChildren(linesEl);

  // Top-anchored: the model may hand us more than MAX_LINES of
  // accumulated history. Older entries have scrolled off the top, so show
  // only the most recent MAX_LINES (spec 2.1) and light the up arrow.
  const visibleLines = overflowUp ? allLines.slice(allLines.length - MAX_LINES) : allLines;
  const sliceOffset = allLines.length - visibleLines.length;

  visibleLines.forEach((line, i) => {
    const div = document.createElement('div');
    div.classList.add('lcd-line');
    const modelIndex = i + sliceOffset;
    const hasCursorHere = !!(model.cursor && model.cursor.line === modelIndex);

    if (line.align === 'two-part') {
      // Entry+answer sharing one row. This is an extension beyond the
      // documented Line shape ({layout, align:'left'|'right'}) — see the
      // report for why it's needed.
      div.classList.add('two-part');
      const entry = document.createElement('span');
      entry.className = 'entry';
      entry.appendChild(renderLayout(line.entry));
      const answer = document.createElement('span');
      answer.className = 'answer';
      answer.appendChild(renderLayout(line.answer));
      div.append(entry, answer);
    } else {
      div.classList.add(line.align === 'right' ? 'align-right' : 'align-left');

      if (isFlatText(line.layout) && !hasCursorHere) {
        // Defensive width clamp for finished, cursor-less flat-text lines
        // (history/answers) so a line never exceeds 16 visible chars even
        // if the model forgot to. The *live* entry line (which carries the
        // cursor) is left untouched — only calculator.js knows the correct
        // scroll-to-cursor window for that one.
        const text = flattenText(line.layout);
        if (text.length > MAX_COLS) {
          div.textContent = text.slice(text.length - MAX_COLS);
          setIndicator(root, INDICATOR_IDS.scrollLeft, true);
        } else {
          div.appendChild(renderLayout(line.layout));
        }
      } else {
        div.appendChild(renderLayout(line.layout));
      }
    }

    linesEl.appendChild(div);

    if (hasCursorHere && line.align !== 'two-part') {
      insertCursorAt(div, model.cursor.col, model.cursor.style);
    }
  });

  // Pad remaining slots so content stays top-anchored: faceplate.css's
  // .lcd-lines uses `justify-content: flex-end`, which bottom-anchors
  // whatever is inside it. Always emitting exactly MAX_LINES rows (blank
  // ones after the real content) leaves no slack space for that rule to
  // act on, without touching the stylesheet.
  for (let i = visibleLines.length; i < MAX_LINES; i++) {
    const blank = document.createElement('div');
    blank.className = 'lcd-line align-left';
    linesEl.appendChild(blank);
  }
}
