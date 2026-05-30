import { WebGLContext } from './renderer/WebGLContext.js';
import { NoiseLayer }   from './renderer/NoiseLayer.js';
import { GridLayer }    from './renderer/GridLayer.js';
import { ImageLayer }   from './renderer/ImageLayer.js';
import { Panel }        from './ui/Panel.js';
import { initControls } from './ui/controls.js';
import { state }        from './state.js';

let ctx, noiseLayer, gridLayer, imageLayer;
let canvasW = 0, canvasH = 0;
let rafId = null;
let startTime = null;
let needRebuild = false;

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function loadImageSrc(src) {
  if (!src) return;
  const img = new Image();
  img.onload = () => { if (imageLayer) imageLayer.setImage(img); };
  img.src = src;
}

let gridW = 0, gridH = 0;

function rebuild() {
  const cfg = state.config;
  const { superPixelSize, gap, fillRatio } = cfg.grid;
  const step = superPixelSize + gap;
  gridW = Math.ceil(canvasW / step);
  gridH = Math.ceil(canvasH / step);

  gridLayer.setTileSequence(cfg.grid.tileSequence);
  noiseLayer.resize(gridW, gridH);
  gridLayer.resize(canvasW, canvasH, superPixelSize, gap, fillRatio);
  needRebuild = false;
}

function frame(ts) {
  rafId = requestAnimationFrame(frame);
  if (state.paused) return;

  if (startTime === null) startTime = ts;
  const time = (ts - startTime) / 1000;

  if (needRebuild) rebuild();

  const { gl } = ctx;
  const cfg = state.config;
  const { pixelSource, combineMode } = cfg.grid;
  const useNoise = pixelSource !== 'image';
  const useImage = pixelSource !== 'noise' && imageLayer.ready;
  const step = cfg.grid.superPixelSize + cfg.grid.gap;

  // ── Render sources to their FBOs ─────────────────────────────────────────
  if (useNoise) noiseLayer.render(time * cfg.noise.speed, cfg.noise);
  if (useImage) imageLayer.renderToGrid(gridW, gridH, step, time, cfg.image);

  // ── Solo source-review views (grid hidden) ────────────────────────────────
  const sv = state.sourceView;
  if (sv !== 'off') {
    const bg = hexToRgb(cfg.colours.background);
    gl.clearColor(bg[0], bg[1], bg[2], 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    if (sv === 'noise' && useNoise) {
      noiseLayer.renderDebug(canvasW, canvasH, { alpha: 1.0, greyscale: true });
    } else if (sv === 'image') {
      imageLayer.readGridPixels(); // ensure FBO is current
      imageLayer.renderDebug(canvasW, canvasH, { alpha: 1.0, greyscale: true });
    } else if (sv === 'combined') {
      // Show noise as base, green image tint on top — so both layers are visible
      if (useNoise) noiseLayer.renderDebug(canvasW, canvasH, { alpha: 1.0, greyscale: true });
      if (useImage) imageLayer.renderDebug(canvasW, canvasH, { alpha: 0.5, greyscale: false });
    }
    return;
  }

  // ── Normal rendering ──────────────────────────────────────────────────────
  const bg = hexToRgb(cfg.colours.background);
  gl.clearColor(bg[0], bg[1], bg[2], 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // Read pixel classification sources
  let noisePx = null, imagePx = null;
  if (useNoise) noiseLayer.readPixels(gridLayer._noisePixels);
  if (useImage) imagePx = imageLayer.readGridPixels();
  noisePx = useNoise ? gridLayer._noisePixels : null;

  // Image background behind shapes
  if (cfg.image.mode === 'background') {
    imageLayer.render(canvasW, canvasH, time, cfg.image, 1.0);
  }

  gridLayer.updateFromSource(noisePx, imagePx, time, cfg.thresholds, cfg.grid.fillRatio, combineMode, cfg.animation.duration / 1000);
  gridLayer.render(canvasW, canvasH, time, cfg, cfg.colours);

  // Image overlay above shapes
  if (cfg.image.mode === 'overlay') {
    imageLayer.render(canvasW, canvasH, time, cfg.image, cfg.image.opacity);
  }
}

function startLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  startTime = null;
  rafId = requestAnimationFrame(frame);
}

function onResize() {
  const container = document.getElementById('canvas-container');
  const { w, h } = ctx.resize(container.clientWidth, container.clientHeight);
  canvasW = w;
  canvasH = h;
  needRebuild = true;
}

function init() {
  const canvas = document.getElementById('bg');
  ctx = new WebGLContext(
    canvas,
    () => {},
    () => {
      noiseLayer = new NoiseLayer(ctx);
      gridLayer  = new GridLayer(ctx);
      imageLayer = new ImageLayer(ctx);
      if (state.config.image.src) loadImageSrc(state.config.image.src);
      onResize();
      startLoop();
    }
  );

  noiseLayer = new NoiseLayer(ctx);
  gridLayer  = new GridLayer(ctx);
  imageLayer = new ImageLayer(ctx);

  new Panel();
  initControls(
    () => { needRebuild = true; },
    () => {},
    loadImageSrc
  );

  const ro = new ResizeObserver(() => onResize());
  ro.observe(document.getElementById('canvas-container'));
  onResize();
  startLoop();
}

init();
