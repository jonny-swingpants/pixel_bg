# Pixel BG

GPU-accelerated animated background generator. A noise field drives a pixel grid of primitive shapes — each cell samples the noise value and renders as a sized, animated shape.

## Quick start

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Architecture

### Layer 0 — Noise FBO
A full-screen quad renders noise into an off-screen framebuffer sized to the grid dimensions (one texel per cell). The GLSL shader supports Simplex, Perlin, and Worley noise with fractal octaves. The FBO texture is read back each frame to drive size-class changes.

### Layer 1 — Instanced Grid
One instanced draw call renders the entire grid. Per-instance attributes carry `cellX`, `cellY`, `targetSize`, `prevSize`, and `animStart`. The vertex shader computes the current interpolated fill ratio using ease-in-out cubic and the current time uniform — no CPU-side animation math.

## Configuration schema

```jsonc
{
  "shape": "circle",           // circle | square | diamond | cross | ring | triangle
  "colours": {
    "background": "#020005",
    "shape":      "#ff2ddf",
    "accent":     "#00e5ff",
    "modulate":   true         // tint shapes by noise value
  },
  "grid": {
    "cellSize": 16,            // px, 4–64
    "gap":      1              // px between cells, 0–8
  },
  "noise": {
    "type":        "simplex",  // simplex | perlin | worley
    "scale":       4.0,        // zoom level
    "speed":       0.3,        // animation rate multiplier
    "scrollX":     0.0,        // horizontal drift (units/sec)
    "scrollY":     0.0,
    "octaves":     4,          // fractal layers (1–8)
    "persistence": 0.5,        // amplitude decay per octave
    "lacunarity":  2.0,        // frequency growth per octave
    "seed":        42.0,
    "invert":      false
  },
  "animation": {
    "duration": 400            // ms per size transition
  },
  "thresholds": [0.0, 0.2, 0.4, 0.7, 0.9],  // noise → size class breakpoints
  "fillRatios": [0.08, 0.22, 0.44, 0.72, 0.92]  // fill fraction per class
}
```

Export/import presets via the **↑ Export JSON** / **↓ Import JSON** buttons.

## Built-in palettes

| Name | Background | Shape | Accent |
|---|---|---|---|
| Monochrome | #000 | #fff | #aaa |
| Warm | deep brown | amber | orange |
| Cool | near-black | cyan | blue |
| High Contrast | #fff | #000 | #111 |
| Neon on Black | #020005 | magenta | electric blue |
| Paper on Ink | charcoal | off-white | warm grey |

## Extensibility

**Shapes** — add a new entry to `src/ui/presets.js` `SHAPES` array and a corresponding SDF case in `src/shaders/grid.frag.glsl`.

**Noise types** — add a GLSL function in `src/shaders/noise.frag.glsl` and an entry in the `NOISE_TYPES` array in `src/ui/presets.js`.

**Post-processing** — `src/renderer/PostProcess.js` is a stub for a compositing pass (bloom, vignette, etc.).
