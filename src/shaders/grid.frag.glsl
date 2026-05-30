#version 300 es
precision highp float;

in vec2  vUV;
in float vSizeClass;
in float vAlpha;
in vec2  vScreenPx;

uniform int   uShape;         // 0=circle 1=square 2=diamond 3=cross 4=ring 5=triangle
uniform vec3  uShapeColour;
uniform vec3  uAccentColour;
uniform vec3  uBgColour;
uniform bool  uModulate;


out vec4 fragColor;

// ── SDFs ──────────────────────────────────────────────────────────────────

float sdfCircle(vec2 p) {
  return length(p) - 0.5;
}

float sdfSquare(vec2 p) {
  vec2 d = abs(p) - 0.5;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdfDiamond(vec2 p) {
  return (abs(p.x) + abs(p.y)) - 0.5;
}

float sdfCross(vec2 p) {
  float arm = 0.18;
  vec2 d1 = abs(p) - vec2(0.5, arm);
  vec2 d2 = abs(p) - vec2(arm, 0.5);
  float s1 = length(max(d1, 0.0)) + min(max(d1.x, d1.y), 0.0);
  float s2 = length(max(d2, 0.0)) + min(max(d2.x, d2.y), 0.0);
  return min(s1, s2);
}

float sdfRing(vec2 p) {
  return abs(length(p) - 0.35) - 0.08;
}

float sdfTriangle(vec2 p) {
  // Equilateral triangle centred at origin
  const float k = 1.732050808;
  p.x = abs(p.x) - 0.5;
  p.y = p.y + 0.5 / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) * 0.5;
  p.x -= clamp(p.x, -1.0, 0.0);
  return -length(p) * sign(p.y);
}

float getSDF(vec2 uv) {
  if (uShape == 0) return sdfCircle(uv);
  if (uShape == 1) return sdfSquare(uv);
  if (uShape == 2) return sdfDiamond(uv);
  if (uShape == 3) return sdfCross(uv);
  if (uShape == 4) return sdfRing(uv);
  if (uShape == 5) return sdfTriangle(uv);
  return sdfCircle(uv);
}

void main() {
  float d = getSDF(vUV);

  // Anti-aliased edge
  float aa = fwidth(d);
  float alpha = 1.0 - smoothstep(-aa, aa, d);

  if (alpha < 0.001) discard;

  // Colour: blend shape/accent by size class
  float t = clamp(vSizeClass / 4.0, 0.0, 1.0);
  vec3 col = mix(uShapeColour, uAccentColour, t * t);

  if (uModulate) {
    col = mix(col * 0.6, col, t);
  }

  fragColor = vec4(col, alpha * vAlpha);
}
