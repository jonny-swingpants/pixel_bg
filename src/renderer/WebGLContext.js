export class WebGLContext {
  constructor(canvas, onLost, onRestored) {
    this.canvas = canvas;
    this._onLost = onLost;
    this._onRestored = onRestored;

    canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      onLost?.();
    });
    canvas.addEventListener('webglcontextrestored', () => onRestored?.());

    this.gl = this._createContext();
  }

  _createContext() {
    const gl = this.canvas.getContext('webgl2', {
      antialias: false,
      powerPreference: 'high-performance',
      alpha: false,
    });
    if (!gl) throw new Error('WebGL 2 not available');
    return gl;
  }

  resize(width, height) {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width  = Math.round(width  * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    return { w: this.canvas.width, h: this.canvas.height };
  }

  compileShader(src, type) {
    const { gl } = this;
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const err = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(`Shader compile error:\n${err}`);
    }
    return s;
  }

  linkProgram(vertSrc, fragSrc) {
    const { gl } = this;
    const vert = this.compileShader(vertSrc, gl.VERTEX_SHADER);
    const frag = this.compileShader(fragSrc, gl.FRAGMENT_SHADER);
    const prog = gl.createProgram();
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const err = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new Error(`Program link error:\n${err}`);
    }
    return prog;
  }
}
