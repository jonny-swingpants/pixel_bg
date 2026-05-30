import noiseVert from '../shaders/noise.vert.glsl';
import noiseFrag from '../shaders/noise.frag.glsl';

export class NoiseLayer {
  constructor(ctx) {
    this.ctx = ctx;
    const { gl } = ctx;

    this.program = ctx.linkProgram(noiseVert, noiseFrag);
    this._cacheUniforms();

    // Full-screen quad
    const verts = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
    this.vao = gl.createVertexArray();
    this.vbo = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.program, 'aPosition');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.fbo = null;
    this.texture = null;
    this.fboW = 0;
    this.fboH = 0;
  }

  _cacheUniforms() {
    const { gl } = this.ctx;
    const { program } = this;
    gl.useProgram(program);
    this.u = {
      time:        gl.getUniformLocation(program, 'uTime'),
      scale:       gl.getUniformLocation(program, 'uScale'),
      scrollX:     gl.getUniformLocation(program, 'uScrollX'),
      scrollY:     gl.getUniformLocation(program, 'uScrollY'),
      octaves:     gl.getUniformLocation(program, 'uOctaves'),
      persistence: gl.getUniformLocation(program, 'uPersistence'),
      lacunarity:  gl.getUniformLocation(program, 'uLacunarity'),
      seed:        gl.getUniformLocation(program, 'uSeed'),
      noiseType:   gl.getUniformLocation(program, 'uNoiseType'),
      invert:      gl.getUniformLocation(program, 'uInvert'),
    };
  }

  resize(gridW, gridH) {
    const { gl } = this.ctx;
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    if (this.texture) gl.deleteTexture(this.texture);

    this.fboW = gridW;
    this.fboH = gridH;

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gridW, gridH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  render(time, cfg) {
    const { gl } = this.ctx;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.fboW, this.fboH);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    const noiseTypeMap = { simplex: 0, perlin: 1, worley: 2 };

    gl.uniform1f(this.u.time,        time);
    gl.uniform1f(this.u.scale,       cfg.scale);
    gl.uniform1f(this.u.scrollX,     cfg.scrollX);
    gl.uniform1f(this.u.scrollY,     cfg.scrollY);
    gl.uniform1i(this.u.octaves,     cfg.octaves);
    gl.uniform1f(this.u.persistence, cfg.persistence);
    gl.uniform1f(this.u.lacunarity,  cfg.lacunarity);
    gl.uniform1f(this.u.seed,        cfg.seed);
    gl.uniform1i(this.u.noiseType,   noiseTypeMap[cfg.type] ?? 0);
    gl.uniform1i(this.u.invert,      cfg.invert ? 1 : 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  readPixels(buf) {
    const { gl } = this.ctx;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.readPixels(0, 0, this.fboW, this.fboH, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // Draw the noise texture onto the main framebuffer for analysis.
  //   greyscale=false → translucent orange overlay (on top of the grid)
  //   greyscale=true  → opaque greyscale (solo view, grid hidden)
  // Nearest-neighbour sampling keeps texels aligned to super-pixels.
  renderDebug(canvasW, canvasH, { alpha = 0.55, greyscale = false } = {}) {
    const { gl } = this.ctx;

    if (!this._debugProgram) {
      const vert = `#version 300 es
in vec2 aPosition;
out vec2 vUV;
void main() {
  vUV = aPosition * 0.5 + 0.5;
  vUV.y = 1.0 - vUV.y;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;
      const frag = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform float uAlpha;
uniform int uGrey;
out vec4 fragColor;
void main() {
  float n = texture(uTex, vUV).r;
  vec3 col = uGrey == 1 ? vec3(n) : vec3(n, n * 0.6, 0.0);
  fragColor = vec4(col, uAlpha);
}`;
      this._debugProgram = this.ctx.linkProgram(vert, frag);
      this._debugAlphaLoc = gl.getUniformLocation(this._debugProgram, 'uAlpha');
      this._debugTexLoc   = gl.getUniformLocation(this._debugProgram, 'uTex');
      this._debugGreyLoc  = gl.getUniformLocation(this._debugProgram, 'uGrey');
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, canvasW, canvasH);
    gl.useProgram(this._debugProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this._debugTexLoc, 0);
    gl.uniform1f(this._debugAlphaLoc, alpha);
    gl.uniform1i(this._debugGreyLoc, greyscale ? 1 : 0);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }
}
