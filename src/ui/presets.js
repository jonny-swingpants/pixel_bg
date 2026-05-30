export const PALETTES = [
  {
    name: 'Monochrome',
    colours: { background: '#000000', shape: '#ffffff', accent: '#aaaaaa', modulate: false },
  },
  {
    name: 'Warm',
    colours: { background: '#1a0a00', shape: '#f5c87a', accent: '#e8834a', modulate: true },
  },
  {
    name: 'Cool',
    colours: { background: '#020810', shape: '#4dd9f5', accent: '#5b7fff', modulate: true },
  },
  {
    name: 'High Contrast',
    colours: { background: '#ffffff', shape: '#000000', accent: '#111111', modulate: false },
  },
  {
    name: 'Neon on Black',
    colours: { background: '#020005', shape: '#ff2ddf', accent: '#00e5ff', modulate: true },
  },
  {
    name: 'Paper on Ink',
    colours: { background: '#2b2b2b', shape: '#f0ead6', accent: '#c8bea0', modulate: false },
  },
];

export const NOISE_TYPES = [
  { value: 'simplex', label: 'Simplex' },
  { value: 'perlin',  label: 'Perlin'  },
  { value: 'worley',  label: 'Worley'  },
];

export const SHAPES = [
  { id: 'circle',   label: '⬤ Circle'   },
  { id: 'square',   label: '■ Square'   },
  { id: 'diamond',  label: '◆ Diamond'  },
  { id: 'cross',    label: '✚ Cross'    },
  { id: 'ring',     label: '◯ Ring'     },
  { id: 'triangle', label: '▲ Triangle' },
];
