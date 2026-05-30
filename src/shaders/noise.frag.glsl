#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform float uTime;
uniform float uScale;
uniform float uScrollX;
uniform float uScrollY;
uniform int   uOctaves;
uniform float uPersistence;
uniform float uLacunarity;
uniform float uSeed;
uniform int   uNoiseType; // 0=simplex 1=perlin 2=worley
uniform bool  uInvert;

// ── Simplex 2D (Ashima Arts, public domain) ───────────────────────────────
vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }

float simplex2D(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                     -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                 + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x  = a0.x  * x0.x   + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

// ── Perlin 2D (classic value-gradient) ────────────────────────────────────
float fade(float t) { return t*t*t*(t*(t*6.0-15.0)+10.0); }

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345) + uSeed * 0.01);
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

vec2 grad2(vec2 p) {
  float h = hash21(p);
  float angle = h * 6.283185;
  return vec2(cos(angle), sin(angle));
}

float perlin2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = vec2(fade(f.x), fade(f.y));
  float a = dot(grad2(i + vec2(0,0)), f - vec2(0,0));
  float b = dot(grad2(i + vec2(1,0)), f - vec2(1,0));
  float c = dot(grad2(i + vec2(0,1)), f - vec2(0,1));
  float d = dot(grad2(i + vec2(1,1)), f - vec2(1,1));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}

// ── Worley (cellular) 2D ─────────────────────────────────────────────────
float worley2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float minDist = 1e9;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 neighbor = vec2(float(x), float(y));
      vec2 cellCenter = vec2(hash21(i + neighbor + uSeed * 0.01),
                             hash21(i + neighbor + uSeed * 0.01 + 17.3));
      vec2 diff = neighbor + cellCenter - f;
      minDist = min(minDist, dot(diff, diff));
    }
  }
  return 1.0 - sqrt(minDist);
}

// ── Fractal helper ────────────────────────────────────────────────────────
float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 1.0;
  float frequency = 1.0;
  float maxVal = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uOctaves) break;
    vec2 sp = p * frequency + uSeed * 0.01;
    float n;
    if (uNoiseType == 0)      n = simplex2D(sp) * 0.5 + 0.5;
    else if (uNoiseType == 1) n = perlin2D(sp)  * 0.5 + 0.5;
    else                      n = worley2D(sp);
    value += n * amplitude;
    maxVal += amplitude;
    amplitude *= uPersistence;
    frequency *= uLacunarity;
  }
  return value / maxVal;
}

void main() {
  vec2 scrollUV = vUV * uScale + vec2(uScrollX, uScrollY) * uTime;
  float animOffset = uTime * 0.1;
  vec2 p = scrollUV + animOffset;

  float n = fbm(p);
  n = clamp(n, 0.0, 1.0);
  if (uInvert) n = 1.0 - n;

  fragColor = vec4(n, n, n, 1.0);
}
