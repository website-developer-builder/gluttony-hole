// Real-time ray-traced Schwarzschild black hole.
// Each pixel fires a photon that is bent by gravity (geodesic integration),
// so the accretion disk, its lensed back side and the photon ring all emerge from the physics.
window.HOLE_VERT = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

window.HOLE_FRAG = `#version 300 es
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform float uHunger;   // 0..1 rises while something is dragged over the hole
uniform float uGulp;     // 1 -> 0 pulse after swallowing
uniform float uIncl;     // camera elevation above the disk plane (radians)
uniform float uRoll;     // screen roll (radians)
uniform float uFaceTint; // artistic blue-top / red-bottom face colouring
uniform float uFrontDim; // brightness of the direct (unlensed) image of the disk
uniform float uWarm;     // 0 = cool blue/red Doppler palette, 1 = warm amber palette
uniform int   uSteps;

out vec4 outColor;

const float RIN  = 2.4;   // inner disk edge (Schwarzschild radius = 1)
const float ROUT = 9.5;   // outer disk edge

float hash13(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3  hash33(vec3 p){ p = fract(p*vec3(.1031,.1030,.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }

float noise(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f*f*(3.0 - 2.0*f);
  return mix(mix(mix(hash13(i),               hash13(i+vec3(1,0,0)), f.x),
                 mix(hash13(i+vec3(0,1,0)),   hash13(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i+vec3(0,0,1)),   hash13(i+vec3(1,0,1)), f.x),
                 mix(hash13(i+vec3(0,1,1)),   hash13(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++){ s += a*noise(p); p = p*2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s;
}

vec3 stars(vec3 d){
  vec3 col = vec3(0.0);
  for (int l = 0; l < 2; l++){
    float sc = (l == 0) ? 55.0 : 130.0;
    vec3 p = d*sc;
    vec3 c = floor(p);
    vec3 h = hash33(c);
    if (h.x > 0.955){
      vec3 sp = c + 0.25 + 0.5*hash33(c + 7.0);
      float dist = length(p - sp);
      float b = smoothstep(0.32, 0.0, dist) * (0.35 + 1.8*h.y*h.y) * ((l == 0) ? 1.0 : 0.55);
      col += mix(vec3(1.0, 0.82, 0.62), vec3(0.62, 0.76, 1.0), h.z) * b;
    }
  }
  float neb = fbm(d*2.6 + vec3(3.0));
  col += vec3(0.05, 0.035, 0.11) * pow(neb, 3.0) * 1.6;
  return col;
}

// Emission + opacity of the disk where the photon crossed the equatorial plane.
vec4 diskSample(vec3 pos, vec3 rayDir, float side, int order){
  float r = length(pos.xz);
  if (r < RIN || r > ROUT) return vec4(0.0);

  float phi   = atan(pos.z, pos.x);
  float omega = 1.7 * pow(r, -1.5);                 // Keplerian
  float pr    = phi - uTime * omega * (1.0 + 1.8*uHunger);

  vec3 q  = vec3(r*1.3, cos(pr)*2.4, sin(pr)*2.4);
  float n  = fbm(q*vec3(2.2, 1.0, 1.0));
  float n2 = fbm(vec3(r*5.5, cos(pr)*7.0, sin(pr)*7.0));
  float lanes = 0.35 + 1.25*n*(0.45 + 0.9*n2);

  float dens = smoothstep(RIN, RIN + 0.5, r) * smoothstep(ROUT, ROUT - 4.5, r);
  float T = pow(RIN / r, 1.15);

  // relativistic Doppler + gravitational redshift
  float b = min(sqrt(0.5 / r), 0.62);
  vec3  vel  = normalize(vec3(-pos.z, 0.0, pos.x));
  float cosT = dot(vel, -rayDir);
  float D    = sqrt(1.0 - b*b) / (1.0 - b*cosT);
  float g    = D * sqrt(max(1.0 - 1.0/r, 0.0));
  float I    = T * lanes * pow(g, 2.5) * 6.5 * (1.0 + 0.6*uHunger);

  vec3 warm = mix(vec3(1.0, 0.30, 0.07), vec3(1.0, 0.78, 0.45), clamp(T*g, 0.0, 1.0));
  vec3 dop  = mix(vec3(1.0, 0.20, 0.12), vec3(0.42, 0.66, 1.0), smoothstep(0.7, 1.35, g));
  vec3 c    = mix(dop, warm, uWarm);
  vec3 face = side < 0.0 ? vec3(0.18, 0.42, 1.0) : vec3(1.0, 0.18, 0.10);
  c = mix(c, face, uFaceTint);
  c = mix(c, vec3(0.92, 0.96, 1.0), smoothstep(3.0, 7.0, I) * 0.3);
  if (order == 0) c = mix(c, vec3(0.45, 0.16, 0.22), uFaceTint * 0.5);

  if (order == 0) I *= uFrontDim;
  float a = clamp(dens * (0.25 + lanes*0.85), 0.0, 1.0);
  return vec4(c * I * dens, a);
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*uRes) / min(uRes.x, uRes.y);
  float rScreen = length(uv);
  float cr = cos(uRoll), sr = sin(uRoll);
  vec2 ruv = mat2(cr, -sr, sr, cr) * uv;

  float dist = 26.0;
  vec3 cam = vec3(0.0, sin(uIncl)*dist, -cos(uIncl)*dist);
  vec3 fw = normalize(-cam);
  vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), fw));
  vec3 up = cross(fw, rt);
  float fl = 1.3 + 0.18*uHunger - 0.06*uGulp;

  vec3 v = normalize(fw*fl + rt*ruv.x + up*ruv.y);
  vec3 p = cam;
  vec3 hv = cross(p, v);
  float h2 = dot(hv, hv);

  vec3 col = vec3(0.0);
  float alpha = 0.0;
  float minR = 1e9;
  int order = 0;
  bool horizon = false;
  vec3 glow = vec3(0.0);

  for (int i = 0; i < 400; i++){
    if (i >= uSteps) break;
    float r = length(p);
    minR = min(minR, r);
    if (r < 1.0){ horizon = true; break; }
    if (r > 34.0 && dot(p, v) > 0.0) break;

    float dt = clamp(0.075*r, 0.02, 1.1);
    vec3 acc = -1.5 * h2 * p / pow(r, 5.0);   // photon geodesic in Schwarzschild space
    vec3 pp = p;
    v += acc*dt;
    p += v*dt;

    float rd = length(p.xz);
    float gd = exp(-abs(p.y)*3.0) * smoothstep(RIN - 1.0, RIN + 0.4, rd) * smoothstep(ROUT + 3.0, RIN, rd);
    vec3 gc = mix(mix(vec3(1.0, 0.45, 0.2), vec3(0.4, 0.62, 1.0), 0.5),
                  p.y < 0.0 ? vec3(0.25, 0.5, 1.0) * 1.4 : vec3(1.0, 0.18, 0.15) * 1.1, uFaceTint);
    gc = mix(gc, vec3(1.0, 0.55, 0.25), uWarm);
    glow += gc * gd * dt * (1.0 - alpha) * pow(RIN / max(rd, RIN), 0.8);

    if (pp.y * p.y < 0.0){
      float t = pp.y / (pp.y - p.y);
      vec3 hit = mix(pp, p, t);
      vec4 d = diskSample(hit, normalize(v), v.y < 0.0 ? 1.0 : -1.0, order);
      col   += (1.0 - alpha) * d.rgb;
      alpha += (1.0 - alpha) * d.a;
      order++;
      if (alpha > 0.995) break;
    }
  }

  float bgMask = smoothstep(0.5, 0.28, rScreen);
  if (!horizon){
    col += (1.0 - alpha) * (stars(normalize(v)) + vec3(0.006, 0.010, 0.026)) * bgMask;
    float ring = exp(-pow((minR - 1.53)*16.0, 2.0));
    col += (1.0 - alpha) * ring * vec3(0.78, 0.88, 1.0) * (1.1 + 1.5*uGulp);
  }
  col += glow * 0.11 * (1.0 + 1.2*uHunger + 2.0*uGulp);

  alpha += (1.0 - alpha) * (horizon ? 1.0 : 0.88*bgMask);

  col = vec3(1.0) - exp(-col*1.35);          // filmic exposure
  float edge = smoothstep(0.5, 0.41, rScreen);
  float lum = max(col.r, max(col.g, col.b));
  float a = clamp(max(alpha, lum), 0.0, 1.0) * edge;
  outColor = vec4(col*edge, a);              // premultiplied alpha
}`;
