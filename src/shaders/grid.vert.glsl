#version 300 es
precision highp float;

in vec2 aQuad; // 0..1 unit quad

// Per-instance (8 floats, all pre-computed CPU-side)
in float aPrevCX;        // previous sub-circle centre X (screen px)
in float aPrevCY;
in float aTargetCX;      // target sub-circle centre X
in float aTargetCY;
in float aPrevHalfExt;   // previous half-size (0 = was invisible)
in float aTargetHalfExt; // target half-size  (0 = becomes invisible)
in float aAnimStart;     // time (s) when transition began
in float aSizeClass;     // 0..1 for colour blending
in float aPrevAlpha;
in float aTargetAlpha;
in float aStepDuration;  // how long this individual step's animation lasts (seconds)

uniform vec2  uCanvasSize;
uniform float uTime;

out vec2  vUV;
out float vSizeClass;
out float vAlpha;

void main() {
  // Both zero → definitively inactive
  if (aTargetHalfExt <= 0.0 && aPrevHalfExt <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    return;
  }

  float t    = clamp((uTime - aAnimStart) / max(aStepDuration, 0.001), 0.0, 1.0);
  float ease = t * t * (3.0 - 2.0 * t); // smoothstep

  // Lerp both position and size
  vec2  centre  = mix(vec2(aPrevCX, aPrevCY), vec2(aTargetCX, aTargetCY), ease);
  float halfExt = mix(aPrevHalfExt, aTargetHalfExt, ease);

  float alpha = mix(aPrevAlpha, aTargetAlpha, ease);
  if (halfExt < 0.5 || alpha < 0.004) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    return;
  }

  vec2 pos = centre + (aQuad * 2.0 - 1.0) * halfExt;
  vec2 ndc = (pos / uCanvasSize) * 2.0 - 1.0;
  ndc.y = -ndc.y;

  vUV        = aQuad * 2.0 - 1.0;
  vSizeClass = aSizeClass;
  vAlpha     = alpha;

  gl_Position = vec4(ndc, 0.0, 1.0);
}
