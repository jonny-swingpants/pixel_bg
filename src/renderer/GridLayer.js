import gridVert from '../shaders/grid.vert.glsl';
import gridFrag from '../shaders/grid.frag.glsl';

// floats per instance: prevCX, prevCY, targetCX, targetCY, prevHalf, targetHalf,
//                      animStart, sizeClass, prevAlpha, targetAlpha, stepDuration
const FLOATS_PER_INSTANCE = 11;
const MAX_N   = 16;
const MAX_N2  = MAX_N * MAX_N; // 256 — slots for one generation
// Each super-pixel uses MAX_N2 BIRTH slots followed by MAX_N2 DEATH slots = 512 total
const SLOTS_PER_SP = MAX_N2 * 2;

// Each preset is a 5-entry class→N map (0 = blank). All presets share the same
// length so the threshold UI (4 sliders) stays valid across modes.
const TILE_SEQUENCES = {
  blankToDense:  [0, 8, 4, 2, 1], // low noise = blank, high = densest
  denseToBlank:  [1, 2, 4, 8, 0], // low noise = densest, high = blank
  blankBothEnds: [0, 2, 1, 2, 0], // blank at both ends, densest in the middle
};
const NUM_CLASSES = 5;

const SHAPE_MAP = { circle: 0, square: 1, diamond: 2, cross: 3, ring: 4, triangle: 5 };

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export class GridLayer {
  constructor(ctx) {
    this.ctx  = ctx;
    this.program = null;
    this.vao  = null;
    this.quadVbo = null;
    this.instanceVbo = null;
    this.instanceData  = null;
    // Per-super-pixel animation state:
    this._displayClass  = null; // class currently animating toward
    this._targetClass   = null; // noise/image-driven desired class
    this._stepStart     = null; // Float32Array — when the current step began (seconds)
    this._stepDuration  = null; // Float32Array — how long each step lasts (animDuration/numSteps)
    this._noisePixels   = null; // exposed so main.js can pass it to NoiseLayer.readPixels
    this.gridW = 0;
    this.gridH = 0;
    this.superPixelSize = 64;
    this._gap = 0;
    this._animDuration = 1.0;
    this._classToN = TILE_SEQUENCES.blankToDense;
    this._nLadder  = [];  // sorted unique N values, built from _classToN
    this._nToClass = new Map(); // N value → first class index with that N
    this.u = {};
    this._buildProgram();
    this._buildNLadder();
  }

  _buildProgram() {
    const { gl } = this.ctx;
    if (this.program) gl.deleteProgram(this.program);
    this.program = this.ctx.linkProgram(gridVert, gridFrag);
    this._cacheUniforms();
  }

  setTileSequence(mode) {
    this._classToN = TILE_SEQUENCES[mode] ?? TILE_SEQUENCES.blankToDense;
    this._buildNLadder();
  }

  // Build the sorted N ladder and N→class reverse map from the current _classToN.
  _buildNLadder() {
    this._nLadder = [...new Set(this._classToN)].sort((a, b) => a - b);
    this._nToClass = new Map();
    for (let i = 0; i < this._classToN.length; i++) {
      const n = this._classToN[i];
      if (!this._nToClass.has(n)) this._nToClass.set(n, i);
    }
  }

  // Return the class one step closer to toClass from fromClass, walking the N ladder.
  // The ladder is always walked in the direction that decreases the N distance.
  _nextStep(fromClass, toClass) {
    const fromN = this._classToN[fromClass] ?? 0;
    const toN   = this._classToN[toClass]   ?? 0;
    if (fromN === toN) return toClass;
    let nextN;
    if (toN > fromN) nextN = this._nLadder.find(n => n > fromN) ?? toN;
    else             nextN = [...this._nLadder].reverse().find(n => n < fromN) ?? toN;
    return this._nToClass.get(nextN) ?? toClass;
  }

  // Count how many single-step transitions are needed to get from fromClass to toClass.
  _countSteps(fromClass, toClass) {
    const fromN = this._classToN[fromClass] ?? 0;
    const toN   = this._classToN[toClass]   ?? 0;
    if (fromN === toN) return 0;
    let cur = fromN, count = 0;
    while (cur !== toN && count < 20) {
      if (toN > cur) cur = this._nLadder.find(n => n > cur) ?? toN;
      else           cur = [...this._nLadder].reverse().find(n => n < cur) ?? toN;
      count++;
    }
    return count;
  }

  _cacheUniforms() {
    const { gl } = this.ctx;
    const { program } = this;
    gl.useProgram(program);
    const loc = n => gl.getUniformLocation(program, n);
    this.u = {
      canvasSize:  loc('uCanvasSize'),
      time:        loc('uTime'),
      shape:       loc('uShape'),
      shapeColour:  loc('uShapeColour'),
      accentColour: loc('uAccentColour'),
      modulate:  loc('uModulate'),
    };
  }

  resize(canvasW, canvasH, superPixelSize, gap, fillRatio) {
    const { gl } = this.ctx;
    this.superPixelSize = superPixelSize;
    this._gap = gap;

    const step = superPixelSize + gap;
    const gridW = Math.ceil(canvasW / step);
    const gridH = Math.ceil(canvasH / step);
    this.gridW = gridW;
    this.gridH = gridH;

    const numSP = gridW * gridH;
    this.instanceData  = new Float32Array(numSP * SLOTS_PER_SP * FLOATS_PER_INSTANCE);
    this._noisePixels  = new Uint8Array(gridW * gridH * 4);
    this._displayClass  = new Uint8Array(numSP);   // class currently animating toward
    this._targetClass   = new Uint8Array(numSP);   // pixel-source desired class
    // stepStart initialised far in the past so the first frame fires immediately.
    this._stepStart     = new Float32Array(numSP).fill(-1e9);
    this._stepDuration  = new Float32Array(numSP).fill(this._animDuration);
    // Instance data is all-zero — all slots inactive; first updateFromSource fades in.

    if (!this.vao) {
      this.vao = gl.createVertexArray();
      this.quadVbo = gl.createBuffer();
      this.instanceVbo = gl.createBuffer();
    }

    const quad = new Float32Array([0,0, 1,0, 0,1, 1,0, 1,1, 0,1]);
    gl.bindVertexArray(this.vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    const qLoc = gl.getAttribLocation(this.program, 'aQuad');
    gl.enableVertexAttribArray(qLoc);
    gl.vertexAttribPointer(qLoc, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(qLoc, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData, gl.DYNAMIC_DRAW);

    const stride = FLOATS_PER_INSTANCE * 4;
    const bind = (name, offset) => {
      const l = gl.getAttribLocation(this.program, name);
      if (l < 0) return;
      gl.enableVertexAttribArray(l);
      gl.vertexAttribPointer(l, 1, gl.FLOAT, false, stride, offset * 4);
      gl.vertexAttribDivisor(l, 1);
    };
    bind('aPrevCX',        0);
    bind('aPrevCY',        1);
    bind('aTargetCX',      2);
    bind('aTargetCY',      3);
    bind('aPrevHalfExt',   4);
    bind('aTargetHalfExt', 5);
    bind('aAnimStart',     6);
    bind('aSizeClass',     7);
    bind('aPrevAlpha',     8);
    bind('aTargetAlpha',   9);
    bind('aStepDuration', 10);

    gl.bindVertexArray(null);
  }

  _initBirthOnly(spIdx, spCol, spRow, step, cls, fillRatio) {
    const N    = this._classToN[cls] ?? 1;
    const sp   = this.superPixelSize;
    const ox   = spCol * step;
    const oy   = spRow * step;
    const half = (sp / N) * fillRatio * 0.5;

    for (let row = 0; row < MAX_N; row++) {
      for (let col = 0; col < MAX_N; col++) {
        const off = (spIdx * SLOTS_PER_SP + row * MAX_N + col) * FLOATS_PER_INSTANCE;
        if (col < N && row < N) {
          const cx = ox + (col + 0.5) * (sp / N);
          const cy = oy + (row + 0.5) * (sp / N);
          this.instanceData[off + 0] = cx;
          this.instanceData[off + 1] = cy;
          this.instanceData[off + 2] = cx;
          this.instanceData[off + 3] = cy;
          this.instanceData[off + 4] = half;
          this.instanceData[off + 5] = half;
          this.instanceData[off + 6] = -1e6;
          this.instanceData[off + 7] = (cls - 1) / (NUM_CLASSES - 2);
          this.instanceData[off + 8] = 1; // prevAlpha
          this.instanceData[off + 9] = 1; // targetAlpha
        } else {
          this.instanceData[off + 4] = 0;
          this.instanceData[off + 5] = 0;
          this.instanceData[off + 8] = 0;
          this.instanceData[off + 9] = 0;
        }
      }
    }
  }

  _writeSlots(spIdx, spCol, spRow, step, prevClass, newClass, time, fillRatio) {
    const targetN    = this._classToN[newClass]  ?? 0;
    const prevN      = this._classToN[prevClass] ?? 0;
    const sp         = this.superPixelSize;
    const ox         = spCol * step;
    const oy         = spRow * step;
    const targetHalf = targetN > 0 ? (sp / targetN) * fillRatio * 0.5 : 0;
    const prevHalf   = prevN   > 0 ? (sp / prevN)   * fillRatio * 0.5 : 0;
    const sizeClass  = Math.max(0, Math.min(1, (newClass - 1) / (NUM_CLASSES - 2)));

    const fromBlank = prevClass === 0;
    const toBlank   = newClass  === 0;
    // Splitting = more circles than before (new ones fan out from parent positions).
    // Merging   = fewer circles (old ones converge toward parent in new grid).
    // Independent of class ordering — driven purely by the actual N values.
    const isSplitting = !fromBlank && !toBlank && targetN > prevN;
    // Step duration for this transition (set by updateFromSource before calling here).
    const stepDur = this._stepDuration[spIdx];

    // ── DEATH slots FIRST ────────────────────────────────────────────────────
    // CRITICAL: death must read birth slots BEFORE birth overwrites them.
    // For toBlank, the birth loop clears all birth slots to zero — if death ran
    // second, curH would be 0 everywhere and all circles would vanish instantly.
    for (let row = 0; row < MAX_N; row++) {
      for (let col = 0; col < MAX_N; col++) {
        const bOff = (spIdx * SLOTS_PER_SP +        row * MAX_N + col) * FLOATS_PER_INSTANCE;
        const dOff = (spIdx * SLOTS_PER_SP + MAX_N2 + row * MAX_N + col) * FLOATS_PER_INSTANCE;

        if (prevN > 0 && col < prevN && row < prevN) {
          // Read current animated state from the EXISTING birth slot.
          const bStart   = this.instanceData[bOff + 6];
          const bStepDur = this.instanceData[bOff + 10];
          const rawT = bStepDur > 0 ? (time - bStart) / bStepDur : 1.0;
          const t    = Math.max(0, Math.min(1, rawT));
          const ease = t * t * (3 - 2 * t);

          const curCX = this.instanceData[bOff + 0] + (this.instanceData[bOff + 2] - this.instanceData[bOff + 0]) * ease;
          const curCY = this.instanceData[bOff + 1] + (this.instanceData[bOff + 3] - this.instanceData[bOff + 1]) * ease;
          const curH  = this.instanceData[bOff + 4] + (this.instanceData[bOff + 5] - this.instanceData[bOff + 4]) * ease;
          const curA  = this.instanceData[bOff + 8] + (this.instanceData[bOff + 9] - this.instanceData[bOff + 8]) * ease;

          if (isSplitting) {
            // Birth circles start at the parent's size/position, visually
            // replacing the old circle at t=0 — no separate death needed.
            this.instanceData[dOff + 4]  = 0;
            this.instanceData[dOff + 5]  = 0;
            this.instanceData[dOff + 8]  = 0;
            this.instanceData[dOff + 9]  = 0;
            this.instanceData[dOff + 10] = stepDur;
            this.instanceData[dOff + 6]  = time;
          } else if (curH * curA < 0.5 && curA < 0.05) {
            // Already invisible — nothing to animate away
            this.instanceData[dOff + 4]  = 0;
            this.instanceData[dOff + 5]  = 0;
            this.instanceData[dOff + 8]  = 0;
            this.instanceData[dOff + 9]  = 0;
            this.instanceData[dOff + 10] = stepDur;
            this.instanceData[dOff + 6]  = time;
          } else {
            let tCX, tCY;
            if (toBlank) {
              tCX = curCX; tCY = curCY;              // fade in place
            } else {
              const cCol = Math.floor(col * targetN / prevN);
              const cRow = Math.floor(row * targetN / prevN);
              tCX = ox + (cCol + 0.5) * (sp / targetN);
              tCY = oy + (cRow + 0.5) * (sp / targetN); // converge to parent
            }
            this.instanceData[dOff + 0]  = curCX;
            this.instanceData[dOff + 1]  = curCY;
            this.instanceData[dOff + 2]  = tCX;
            this.instanceData[dOff + 3]  = tCY;
            this.instanceData[dOff + 4]  = curH;
            this.instanceData[dOff + 5]  = curH; // keep size — only alpha fades
            this.instanceData[dOff + 6]  = time;
            this.instanceData[dOff + 7]  = (prevClass - 1) / (NUM_CLASSES - 2);
            this.instanceData[dOff + 8]  = curA;
            this.instanceData[dOff + 9]  = 0;    // fade to invisible
            this.instanceData[dOff + 10] = stepDur;
          }
        } else if (prevN > 0) {
          // Outside current prevN range — clear ghosts from earlier larger-N steps.
          // When prevN==0 (fromBlank) we leave existing death slots alone so any
          // in-progress fade-out can complete naturally.
          this.instanceData[dOff + 4]  = 0;
          this.instanceData[dOff + 5]  = 0;
          this.instanceData[dOff + 8]  = 0;
          this.instanceData[dOff + 9]  = 0;
          this.instanceData[dOff + 10] = stepDur;
          this.instanceData[dOff + 6]  = time;
        }
        // prevN == 0: leave existing death slot alone so it can complete.
      }
    }

    // ── BIRTH slots SECOND ───────────────────────────────────────────────────
    // Runs after death so death can read the old birth state before it's overwritten.
    for (let row = 0; row < MAX_N; row++) {
      for (let col = 0; col < MAX_N; col++) {
        const off = (spIdx * SLOTS_PER_SP + row * MAX_N + col) * FLOATS_PER_INSTANCE;

        if (targetN > 0 && col < targetN && row < targetN) {
          const cx = ox + (col + 0.5) * (sp / targetN);
          const cy = oy + (row + 0.5) * (sp / targetN);

          let fromCX, fromCY, prevH, prevA;
          if (fromBlank) {
            fromCX = cx; fromCY = cy;
            prevH  = 0; prevA = 0;  // fade and grow from nothing
          } else if (isSplitting) {
            // Start at the parent circle's position AND size, then shrink
            // outward to the child position/size. No blank gap.
            const pCol = Math.floor(col * prevN / targetN);
            const pRow = Math.floor(row * prevN / targetN);
            fromCX = ox + (pCol + 0.5) * (sp / prevN);
            fromCY = oy + (pRow + 0.5) * (sp / prevN);
            prevH  = prevHalf; prevA = 1;  // start at parent size
          } else {
            // Merging: appear at child position, grow from nothing.
            // (Death circles converge and fade simultaneously.)
            fromCX = cx; fromCY = cy;
            prevH  = 0; prevA = 1;
          }

          this.instanceData[off + 0]  = fromCX;
          this.instanceData[off + 1]  = fromCY;
          this.instanceData[off + 2]  = cx;
          this.instanceData[off + 3]  = cy;
          this.instanceData[off + 4]  = prevH;
          this.instanceData[off + 5]  = targetHalf;
          this.instanceData[off + 6]  = time;
          this.instanceData[off + 7]  = sizeClass;
          this.instanceData[off + 8]  = prevA;
          this.instanceData[off + 9]  = 1;
          this.instanceData[off + 10] = stepDur;
        } else {
          // Inactive slot — zero it out
          this.instanceData[off + 4]  = 0;
          this.instanceData[off + 5]  = 0;
          this.instanceData[off + 8]  = 0;
          this.instanceData[off + 9]  = 0;
          this.instanceData[off + 10] = stepDur;
          this.instanceData[off + 6]  = time;
        }
      }
    }
  }

  // noisePx and imagePx are Uint8Array RGBA buffers (gridW*gridH*4).
  // Pass null for either to exclude that source.
  // combineMode: 'multiply' | 'average' | 'add' | 'min' | 'max'
  //
  // Transitions step through every intermediate class on the N ladder so that
  // e.g. 8×8 → 1×1 animates as 8×8 → 4×4 → 2×2 → 1×1, spreading animDuration
  // equally across all required steps.
  updateFromSource(noisePx, imagePx, time, thresholds, fillRatio, combineMode = 'multiply', animDuration = 1.0) {
    this._animDuration = animDuration; // keep in sync for step-duration calculations
    const { gl } = this.ctx;
    const step = this.superPixelSize + this._gap;
    let dirty = false;

    for (let spRow = 0; spRow < this.gridH; spRow++) {
      for (let spCol = 0; spCol < this.gridW; spCol++) {
        const spIdx = spRow * this.gridW + spCol;
        const i4    = spIdx * 4;

        // ── Combine pixel sources ────────────────────────────────────────────
        const nv = noisePx ? noisePx[i4] / 255 : 0;
        const iv = imagePx ? imagePx[i4] / 255 : 0;
        let raw;
        if (noisePx && imagePx) {
          switch (combineMode) {
            case 'multiply': raw = nv * iv; break;
            case 'average':  raw = (nv + iv) * 0.5; break;
            case 'add':      raw = Math.min(1, nv + iv); break;
            case 'min':      raw = Math.min(nv, iv); break;
            case 'max':      raw = Math.max(nv, iv); break;
            default:         raw = nv * iv;
          }
        } else {
          raw = noisePx ? nv : iv;
        }

        const noiseTarget = this._classify(raw, thresholds);
        const prevTarget  = this._targetClass[spIdx];
        const displayCls  = this._displayClass[spIdx];

        // ── Update target and recalculate step duration if target changed ────
        if (noiseTarget !== prevTarget) {
          this._targetClass[spIdx] = noiseTarget;
          if (noiseTarget !== displayCls) {
            const numSteps = this._countSteps(displayCls, noiseTarget);
            this._stepDuration[spIdx] = numSteps > 0
              ? this._animDuration / numSteps
              : this._animDuration;

            if (displayCls === prevTarget) {
              // At rest — kick off immediately
              this._stepStart[spIdx] = time - this._stepDuration[spIdx];
            } else {
              // Mid-animation — reset the step clock so the current step gets
              // its full duration and nothing fires early due to a stale elapsed.
              this._stepStart[spIdx] = time;
            }
          }
        }

        // ── Advance one step if the current step's animation has completed ───
        const targetCls = this._targetClass[spIdx];
        if (displayCls !== targetCls) {
          const elapsed = time - this._stepStart[spIdx];
          if (elapsed >= this._stepDuration[spIdx]) {
            const nextCls = this._nextStep(displayCls, targetCls);
            this._writeSlots(spIdx, spCol, spRow, step, displayCls, nextCls, time, fillRatio);
            this._displayClass[spIdx] = nextCls;
            this._stepStart[spIdx]    = time;
            dirty = true;
          }
        }
      }
    }

    if (dirty) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData);
    }
  }

  _classify(v, thresholds) {
    for (let i = thresholds.length - 1; i >= 0; i--) {
      if (v >= thresholds[i]) return i;
    }
    return 0;
  }

  render(canvasW, canvasH, time, cfg, colours) {
    const { gl } = this.ctx;
    this._gap = cfg.grid.gap;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.viewport(0, 0, canvasW, canvasH);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.uniform2f(this.u.canvasSize, canvasW, canvasH);
    gl.uniform1f(this.u.time, time);
    gl.uniform1i(this.u.shape, SHAPE_MAP[cfg.shape] ?? 0);
    gl.uniform3fv(this.u.shapeColour,  hexToRgb(colours.shape));
    gl.uniform3fv(this.u.accentColour, hexToRgb(colours.accent));
    gl.uniform1i(this.u.modulate, colours.modulate ? 1 : 0);

    const totalInstances = this.gridW * this.gridH * SLOTS_PER_SP;
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, totalInstances);
    gl.bindVertexArray(null);
  }
}
