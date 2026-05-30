import { state } from '../state.js';
import { PALETTES, NOISE_TYPES, SHAPES } from './presets.js';

function el(id) { return document.getElementById(id); }

function slider(id, valId, statePath, fmt = v => v) {
  const input = el(id);
  const disp  = el(valId);
  if (!input) return;
  const update = () => {
    const v = parseFloat(input.value);
    disp.textContent = fmt(v);
    state.set(statePath, v);
  };
  input.value = state.get(statePath);
  disp.textContent = fmt(parseFloat(input.value));
  input.addEventListener('input', update);
}

function colorPicker(id, statePath) {
  const input = el(id);
  input.value = state.get(statePath);
  input.addEventListener('input', () => state.set(statePath, input.value));
}

function checkbox(id, statePath) {
  const input = el(id);
  input.checked = state.get(statePath);
  input.addEventListener('change', () => state.set(statePath, input.checked));
}

export function initControls(onRebuild, onUniformChange, loadImageSrc) {
  // Shape buttons — clear first to handle HMR re-runs
  const shapeGrid = el('shape-grid');
  shapeGrid.innerHTML = '';
  SHAPES.forEach(({ id, label }) => {
    const btn = document.createElement('button');
    btn.className = 'shape-btn' + (state.config.shape === id ? ' active' : '');
    btn.textContent = label;
    btn.dataset.shape = id;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.set('shape', id);
      onUniformChange();
    });
    shapeGrid.appendChild(btn);
  });

  // Colours
  colorPicker('c-bg',    'colours.background');
  colorPicker('c-shape', 'colours.shape');
  colorPicker('c-accent','colours.accent');
  checkbox('colour-mod', 'colours.modulate');

  state.on('colours.background', onUniformChange);
  state.on('colours.shape',      onUniformChange);
  state.on('colours.accent',     onUniformChange);
  state.on('colours.modulate',   onUniformChange);

  // Palette presets — clear first
  const palSel = el('palette-select');
  palSel.innerHTML = '';
  PALETTES.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = p.name;
    palSel.appendChild(opt);
  });
  palSel.addEventListener('change', () => {
    const pal = PALETTES[+palSel.value];
    Object.entries(pal.colours).forEach(([k, v]) => state.set(`colours.${k}`, v));
    el('c-bg').value    = pal.colours.background;
    el('c-shape').value = pal.colours.shape;
    el('c-accent').value= pal.colours.accent;
    el('colour-mod').checked = pal.colours.modulate;
    onUniformChange();
  });

  // Grid
  slider('sp-size',   'sp-size-val',   'grid.superPixelSize', v => `${v}px`);
  slider('grid-gap',  'grid-gap-val',  'grid.gap',            v => `${v}px`);
  slider('fill-ratio','fill-ratio-val','grid.fillRatio',       v => v.toFixed(2));

  state.on('grid.superPixelSize', onRebuild);
  state.on('grid.gap',            onRebuild);
  state.on('grid.fillRatio',      onRebuild);

  // Tile sequence
  const tileSeqSel = el('tile-sequence');
  tileSeqSel.value = state.get('grid.tileSequence');
  tileSeqSel.addEventListener('change', () => {
    state.set('grid.tileSequence', tileSeqSel.value);
    onRebuild();
  });

  // Pixel source
  const srcSel = el('pixel-source');
  srcSel.value = state.get('grid.pixelSource');
  srcSel.addEventListener('change', () => state.set('grid.pixelSource', srcSel.value));

  const combineSel = el('combine-mode');
  combineSel.value = state.get('grid.combineMode');
  combineSel.addEventListener('change', () => state.set('grid.combineMode', combineSel.value));

  // Thresholds — enforce ascending order
  const THRESH_IDS = ['thresh-1','thresh-2','thresh-3','thresh-4'];
  THRESH_IDS.forEach((id, i) => {
    const input = el(id);
    const disp  = el(`${id}-val`);
    if (!input) return;
    input.value = state.config.thresholds[i + 1];
    disp.textContent = state.config.thresholds[i + 1].toFixed(2);
    input.addEventListener('input', () => {
      const t = state.config.thresholds.slice();
      let v = parseFloat(input.value);
      // Clamp to neighbours
      v = Math.max(t[i] + 0.01, Math.min(t[i + 2] !== undefined ? t[i + 2] - 0.01 : 1.0, v));
      input.value = v;
      t[i + 1] = v;
      disp.textContent = v.toFixed(2);
      state.config.thresholds = t;
      state._emit('thresholds', t);
    });
  });

  // Noise
  const noiseTypeSel = el('noise-type');
  noiseTypeSel.innerHTML = '';
  NOISE_TYPES.forEach(({ value, label }) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    noiseTypeSel.appendChild(opt);
  });
  noiseTypeSel.value = state.get('noise.type');
  noiseTypeSel.addEventListener('change', () => state.set('noise.type', noiseTypeSel.value));

  slider('noise-scale', 'noise-scale-val', 'noise.scale',       v => v.toFixed(1));
  slider('noise-speed', 'noise-speed-val', 'noise.speed',       v => v.toFixed(2));
  slider('scroll-x',    'scroll-x-val',    'noise.scrollX',     v => v.toFixed(2));
  slider('scroll-y',    'scroll-y-val',    'noise.scrollY',     v => v.toFixed(2));
  slider('octaves',     'octaves-val',     'noise.octaves',     v => Math.round(v));
  slider('persistence', 'persistence-val', 'noise.persistence', v => v.toFixed(2));
  slider('lacunarity',  'lacunarity-val',  'noise.lacunarity',  v => v.toFixed(1));
  checkbox('noise-invert', 'noise.invert');

  el('randomise-btn').addEventListener('click', () => {
    state.set('noise.seed', Math.random() * 1000);
  });

  // Image section
  const imageModeSel = el('image-mode');
  imageModeSel.value = state.get('image.mode');
  imageModeSel.addEventListener('change', () => state.set('image.mode', imageModeSel.value));

  const imageFile = el('image-file');
  el('image-upload-btn').addEventListener('click', () => imageFile.click());
  imageFile.addEventListener('change', () => {
    const file = imageFile.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    state.set('image.src', url);
    if (loadImageSrc) loadImageSrc(url);
    imageFile.value = '';
  });

  slider('image-scale',        'image-scale-val',        'image.scale',       v => v.toFixed(2));
  slider('image-scroll-speed', 'image-scroll-speed-val', 'image.scrollSpeed', v => v.toFixed(2));
  slider('image-scroll-angle', 'image-scroll-angle-val', 'image.scrollAngle', v => `${Math.round(v)}°`);
  slider('image-opacity',      'image-opacity-val',      'image.opacity',     v => v.toFixed(2));

  // Source view: cycle off → noise → image → combined
  const sourceViewBtn = el('debug-noise-btn');
  const SRC_VIEWS  = ['off', 'noise', 'image', 'combined'];
  const SRC_LABELS = {
    off:      'Review source…',
    noise:    'Reviewing: noise ✓',
    image:    'Reviewing: image ✓',
    combined: 'Reviewing: combined ✓',
  };
  const updateSourceBtn = () => {
    const v = state.sourceView;
    sourceViewBtn.textContent = SRC_LABELS[v];
    sourceViewBtn.classList.toggle('primary', v !== 'off');
  };
  sourceViewBtn.addEventListener('click', () => {
    const idx = SRC_VIEWS.indexOf(state.sourceView);
    state.sourceView = SRC_VIEWS[(idx + 1) % SRC_VIEWS.length];
    updateSourceBtn();
  });
  updateSourceBtn();

  // Animation
  slider('anim-dur', 'anim-dur-val', 'animation.duration', v =>
    v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`);

  // Play/Pause
  const ppBtn = el('play-pause-btn');
  ppBtn.addEventListener('click', () => {
    state.paused = !state.paused;
    ppBtn.textContent = state.paused ? '▶ Play' : '⏸ Pause';
  });

  // Fullscreen
  el('fullscreen-btn').addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  // Export/Import JSON
  el('export-btn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state.config, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: 'pixel-bg-preset.json',
    });
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const importFile = el('import-file');
  el('import-btn').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', () => {
    const file = importFile.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const cfg = JSON.parse(e.target.result);
        state.load(cfg);
        syncAllControls();
        if (cfg.image?.src && loadImageSrc) loadImageSrc(cfg.image.src);
        onRebuild();
      } catch (err) {
        console.error('Invalid preset JSON', err);
      }
    };
    reader.readAsText(file);
    importFile.value = '';
  });
}

function syncAllControls() {
  const cfg = state.config;
  el('c-bg').value    = cfg.colours.background;
  el('c-shape').value = cfg.colours.shape;
  el('c-accent').value= cfg.colours.accent;
  el('colour-mod').checked = cfg.colours.modulate;

  const spSize = el('sp-size');
  if (spSize) { spSize.value = cfg.grid.superPixelSize; el('sp-size-val').textContent = `${cfg.grid.superPixelSize}px`; }
  const gap = el('grid-gap');
  if (gap) { gap.value = cfg.grid.gap; el('grid-gap-val').textContent = `${cfg.grid.gap}px`; }
  const fr = el('fill-ratio');
  if (fr) { fr.value = cfg.grid.fillRatio; el('fill-ratio-val').textContent = cfg.grid.fillRatio.toFixed(2); }

  const tileSeq = el('tile-sequence');
  if (tileSeq) tileSeq.value = cfg.grid.tileSequence;

  el('noise-type').value = cfg.noise.type;
  el('noise-scale').value = cfg.noise.scale; el('noise-scale-val').textContent = cfg.noise.scale.toFixed(1);
  el('noise-speed').value = cfg.noise.speed; el('noise-speed-val').textContent = cfg.noise.speed.toFixed(2);
  el('scroll-x').value = cfg.noise.scrollX; el('scroll-x-val').textContent = cfg.noise.scrollX.toFixed(2);
  el('scroll-y').value = cfg.noise.scrollY; el('scroll-y-val').textContent = cfg.noise.scrollY.toFixed(2);
  el('octaves').value = cfg.noise.octaves; el('octaves-val').textContent = cfg.noise.octaves;
  el('persistence').value = cfg.noise.persistence; el('persistence-val').textContent = cfg.noise.persistence.toFixed(2);
  el('lacunarity').value = cfg.noise.lacunarity; el('lacunarity-val').textContent = cfg.noise.lacunarity.toFixed(1);
  el('noise-invert').checked = cfg.noise.invert;
  el('anim-dur').value = cfg.animation.duration;
  const d = cfg.animation.duration;
  el('anim-dur-val').textContent = d >= 1000 ? `${(d/1000).toFixed(1)}s` : `${Math.round(d)}ms`;

  ['thresh-1','thresh-2','thresh-3','thresh-4'].forEach((id, i) => {
    const inp = el(id); if (!inp) return;
    inp.value = cfg.thresholds[i + 1];
    el(`${id}-val`).textContent = cfg.thresholds[i + 1].toFixed(2);
  });
  document.querySelectorAll('.shape-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.shape === cfg.shape);
  });

  const imgMode = el('image-mode');
  if (imgMode) imgMode.value = cfg.image?.mode ?? 'none';
  const imgScale = el('image-scale');
  if (imgScale) { imgScale.value = cfg.image?.scale ?? 1; el('image-scale-val').textContent = (cfg.image?.scale ?? 1).toFixed(2); }
  const imgSpeed = el('image-scroll-speed');
  if (imgSpeed) { imgSpeed.value = cfg.image?.scrollSpeed ?? 0; el('image-scroll-speed-val').textContent = (cfg.image?.scrollSpeed ?? 0).toFixed(2); }
  const imgAngle = el('image-scroll-angle');
  if (imgAngle) { imgAngle.value = cfg.image?.scrollAngle ?? 0; el('image-scroll-angle-val').textContent = `${Math.round(cfg.image?.scrollAngle ?? 0)}°`; }
  const imgOpacity = el('image-opacity');
  if (imgOpacity) { imgOpacity.value = cfg.image?.opacity ?? 1; el('image-opacity-val').textContent = (cfg.image?.opacity ?? 1).toFixed(2); }
}
