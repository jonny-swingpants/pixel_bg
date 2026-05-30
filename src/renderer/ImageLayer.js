// Tiled, scrollable, scaled image layer.
// Owns two GL resources:
//   1. `texture`  — the uploaded image (REPEAT, LINEAR) used for display.
//   2. grid FBO   — gridW×gridH RGBA8 texture where each texel holds the
//                   luminance of the image at that super-pixel's canvas centre.
//                   Used as a pixel-classification source alongside NoiseLayer.

// ── Full-canvas display shader ──────────────────────────────────────────────
const DISPLAY_VERT = `#version 300 es
in vec2 aPosition;
out vec2 vScreenUV;
void main() {
  vScreenUV = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 vScreenUV;
uniform sampler2D uTex;
uniform vec2  uCanvasSize;
uniform vec2  uPxPerTile;
uniform vec2  uScroll;
uniform float uOpacity;
out vec4 fragColor;
void main() {
  vec2 px  = vec2(vScreenUV.x, 1.0 - vScreenUV.y) * uCanvasSize;
  vec2 iuv = px / uPxPerTile + uScroll;
  vec4 c = texture(uTex, iuv);
  fragColor = vec4(c.rgb, c.a * uOpacity);
}`;

// ── Grid-FBO sampling shader ─────────────────────────────────────────────────
// Renders to the gridW×gridH FBO. Each fragment = one super-pixel.
// FBO convention: row 0 (gl_FragCoord.y ≈ 0.5) = top of canvas,
// matching NoiseLayer so GridLayer can read both buffers identically.
const GRID_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uStep;        // (superPixelSize + gap) in canvas px
uniform vec2 uPxPerTile;
uniform vec2 uScroll;
out vec4 fragColor;
void main() {
  // gl_FragCoord.xy maps (col+0.5, row_from_top+0.5) → canvas px centre
  vec2 canvasPx = gl_FragCoord.xy * uStep;
  vec2 iuv = canvasPx / uPxPerTile + uScroll;
  vec3 col = texture(uTex, iuv).rgb;
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  fragColor = vec4(luma, luma, luma, 1.0);
}`;

// ── Debug-blit shader (greyscale or tinted) ──────────────────────────────────
const DEBUG_VERT = `#version 300 es
in vec2 aPosition;
out vec2 vUV;
void main() {
  vUV = aPosition * 0.5 + 0.5;
  vUV.y = 1.0 - vUV.y;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const DEBUG_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform float uAlpha;
uniform vec3  uTint;   // (1,1,1) for grey, custom for tinted overlay
out vec4 fragColor;
void main() {
  float n = texture(uTex, vUV).r;
  fragColor = vec4(n * uTint, uAlpha);
}`;

export class ImageLayer {
  constructor(ctx) {
    this.ctx    = ctx;
    this.ready  = false;
    this.texture = null;
    this.imgW   = 1;
    this.imgH   = 1;

    // Grid-FBO for pixel classification
    this._gFbo  = null;
    this._gTex  = null;
    this._gW    = 0;
    this._gH    = 0;
    this._gPx   = null; // Uint8Array readback buffer

    const { gl } = ctx;

    // Display program
    this._dispProg = ctx.linkProgram(DISPLAY_VERT, DISPLAY_FRAG);
    gl.useProgram(this._dispProg);
    this._dispU = {
      tex:        gl.getUniformLocation(this._dispProg, 'uTex'),
      canvasSize: gl.getUniformLocation(this._dispProg, 'uCanvasSize'),
      pxPerTile:  gl.getUniformLocation(this._dispProg, 'uPxPerTile'),
      scroll:     gl.getUniformLocation(this._dispProg, 'uScroll'),
      opacity:    gl.getUniformLocation(this._dispProg, 'uOpacity'),
    };

    // Grid-sample program (shares same vert shader inline — uses gl_FragCoord, no attributes)
    this._gridProg = ctx.linkProgram(DISPLAY_VERT, GRID_FRAG);
    gl.useProgram(this._gridProg);
    this._gridU = {
      tex:       gl.getUniformLocation(this._gridProg, 'uTex'),
      step:      gl.getUniformLocation(this._gridProg, 'uStep'),
      pxPerTile: gl.getUniformLocation(this._gridProg, 'uPxPerTile'),
      scroll:    gl.getUniformLocation(this._gridProg, 'uScroll'),
    };

    // Debug-blit program
    this._dbgProg = ctx.linkProgram(DEBUG_VERT, DEBUG_FRAG);
    gl.useProgram(this._dbgProg);
    this._dbgU = {
      tex:   gl.getUniformLocation(this._dbgProg, 'uTex'),
      alpha: gl.getUniformLocation(this._dbgProg, 'uAlpha'),
      tint:  gl.getUniformLocation(this._dbgProg, 'uTint'),
    };

    // Shared full-screen quad VAO
    const verts = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
    this.vao = gl.createVertexArray();
    this.vbo = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    // Wire position for all three programs (same attribute name)
    for (const prog of [this._dispProg, this._gridProg, this._dbgProg]) {
      const loc = gl.getAttribLocation(prog, 'aPosition');
      if (loc >= 0) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0); }
    }
    gl.bindVertexArray(null);
  }

  setImage(img) {
    const { gl } = this.ctx;
    if (this.texture) gl.deleteTexture(this.texture);

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    this.imgW = img.width  || img.naturalWidth  || 1;
    this.imgH = img.height || img.naturalHeight || 1;
    this.ready = true;
  }

  scrollVec(time, cfg) {
    const a = (cfg.scrollAngle || 0) * Math.PI / 180;
    const d = (cfg.scrollSpeed || 0) * time;
    return [Math.cos(a) * d, Math.sin(a) * d];
  }

  // ── Resize the grid FBO if dimensions changed ─────────────────────────────
  _resizeGrid(gridW, gridH) {
    if (gridW === this._gW && gridH === this._gH) return;
    const { gl } = this.ctx;

    if (this._gFbo) gl.deleteFramebuffer(this._gFbo);
    if (this._gTex) gl.deleteTexture(this._gTex);

    this._gW = gridW; this._gH = gridH;
    this._gPx = new Uint8Array(gridW * gridH * 4);

    this._gTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._gTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gridW, gridH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this._gFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._gFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._gTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ── Render image luminance into the grid FBO ──────────────────────────────
  // Must be called each frame before readGridPixels / renderDebug.
  renderToGrid(gridW, gridH, step, time, cfg) {
    if (!this.ready) return;
    this._resizeGrid(gridW, gridH);
    const { gl } = this.ctx;
    const [sx, sy] = this.scrollVec(time, cfg);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._gFbo);
    gl.viewport(0, 0, gridW, gridH);
    gl.useProgram(this._gridProg);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this._gridU.tex, 0);
    gl.uniform2f(this._gridU.step, step, step);
    gl.uniform2f(this._gridU.pxPerTile, this.imgW * cfg.scale, this.imgH * cfg.scale);
    gl.uniform2f(this._gridU.scroll, sx, sy);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ── Read luminance pixels back to CPU ────────────────────────────────────
  readGridPixels() {
    if (!this._gFbo) return null;
    const { gl } = this.ctx;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._gFbo);
    gl.readPixels(0, 0, this._gW, this._gH, gl.RGBA, gl.UNSIGNED_BYTE, this._gPx);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this._gPx;
  }

  // ── Full-canvas display (background / overlay mode) ───────────────────────
  render(canvasW, canvasH, time, cfg, opacity = 1.0) {
    if (!this.ready) return;
    const { gl } = this.ctx;
    const [sx, sy] = this.scrollVec(time, cfg);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, canvasW, canvasH);
    gl.useProgram(this._dispProg);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this._dispU.tex, 0);
    gl.uniform2f(this._dispU.canvasSize, canvasW, canvasH);
    gl.uniform2f(this._dispU.pxPerTile, this.imgW * cfg.scale, this.imgH * cfg.scale);
    gl.uniform2f(this._dispU.scroll, sx, sy);
    gl.uniform1f(this._dispU.opacity, opacity);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  // ── Debug blit: show grid FBO full-screen ─────────────────────────────────
  // greyscale=true → white luminance; false → green tint (distinguish from noise orange)
  renderDebug(canvasW, canvasH, { alpha = 1.0, greyscale = true } = {}) {
    if (!this._gTex) return;
    const { gl } = this.ctx;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, canvasW, canvasH);
    gl.useProgram(this._dbgProg);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._gTex);
    gl.uniform1i(this._dbgU.tex, 0);
    gl.uniform1f(this._dbgU.alpha, alpha);
    if (greyscale) gl.uniform3f(this._dbgU.tint, 1, 1, 1);
    else           gl.uniform3f(this._dbgU.tint, 0.4, 1.0, 0.4); // green overlay

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }
}
