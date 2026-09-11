// Application entry point: wires the engine to the faceplate.
//
// This is the whole app, and it is deliberately tiny. All the behaviour lives
// behind `press`/`render` in the engine, and all the drawing lives in
// render.js, so the only job here is to hold the current state and repaint
// after every key.
//
// Layering (docs/ARCHITECTURE.md): this file is the one place allowed to know
// about both sides. render.js and input.js never import the engine, and the
// engine never touches the DOM.

import { initialState, press, render as toDisplayModel } from '../engine/calculator.js';
import { render as paint } from './render.js';
import { attachInput } from './input.js';

let state = initialState();

function repaint() {
  paint(toDisplayModel(state));
}

attachInput({
  onKey(keyId) {
    // The engine turns calculator-visible problems (DIVIDE BY 0, DOMAIN, ...)
    // into an error on the display itself, so anything thrown here is a real
    // defect. Let it reach window.onerror, which mac/main.swift forwards to
    // the system log — otherwise a bug in the app is completely invisible.
    state = press(state, keyId);
    repaint();
  },
});

repaint();
