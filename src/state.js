export const defaultConfig = {
  shape: 'circle',
  colours: {
    background: '#0a0a0f',
    shape: '#ffffff',
    accent: '#7c6ff7',
    modulate: false,
  },
  grid: {
    superPixelSize: 48,
    gap: 0,
    fillRatio: 1.0,
    tileSequence: 'blankToDense', // blankToDense | denseToBlank | blankBothEnds
    pixelSource: 'noise',         // noise | image | both
    combineMode: 'multiply',      // multiply | average | add | min | max
  },
  image: {
    mode: 'none',      // none | background | shapes | overlay
    scale: 1.0,        // 1.0 = native pixels; <1 tiles more, >1 zooms in
    scrollSpeed: 0.0,  // tiles/sec along the scroll direction
    scrollAngle: 0.0,  // degrees
    opacity: 1.0,      // used by overlay mode
    src: null,         // data URL of the loaded image (for export/import)
  },
  noise: {
    type: 'perlin',
    scale: 4.0,
    speed: 0.3,
    scrollX: 0.0,
    scrollY: 0.0,
    octaves: 4,
    persistence: 0.5,
    lacunarity: 2.0,
    seed: Math.random() * 1000,
    invert: false,
  },
  animation: {
    duration: 1000,
  },
  // 5 classes: 0=blank, then ordered by tile-sequence preset.
  // thresholds[i] = lower noise bound for class i
  thresholds: [0.0, 0.15, 0.35, 0.55, 0.75],
};

export const state = {
  config: structuredClone(defaultConfig),
  paused: false,
  sourceView: 'off', // off | noise | image | combined
  listeners: new Map(),

  get(path) {
    return path.split('.').reduce((o, k) => o?.[k], this.config);
  },

  set(path, value) {
    const keys = path.split('.');
    let obj = this.config;
    for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
    obj[keys[keys.length - 1]] = value;
    this._emit(path, value);
  },

  on(path, fn) {
    if (!this.listeners.has(path)) this.listeners.set(path, new Set());
    this.listeners.get(path).add(fn);
  },

  _emit(path, value) {
    this.listeners.get(path)?.forEach(fn => fn(value));
    this.listeners.get('*')?.forEach(fn => fn(path, value));
  },

  load(cfg) {
    this.config = structuredClone(cfg);
    this._emit('*', null);
  },
};
