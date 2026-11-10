/* PER-PART PROCEDURAL TEXTURE BAKER (CPU → DataTexture), cached by parameter hash.
 *
 * Each operculum piece gets its OWN UV island (u = front→rear across the plate, v = top→bottom) and two textures:
 *   mapA = albedo.rgb  + height.a
 *   mapB = normal.xy (encoded) + roughness.b + metalness.a          (AO is derived from the height in the shader)
 * Variants (seeded, palette driven):  chrome  = crinkled foil, radial striae
 *                                     reticulate = engraved diamond / honeycomb relief, gold-silver
 *                                     rust    = bumpy cell skin with mottling and small pale spine bases
 *                                     plain   = fine hammered silver-grey
 * Sizes: HYPER_TEX.size (default 512; the brief's hero size is 2048 — raise it for stills, it only costs bake time). */
import { R } from './genome.js';

export const HYPER_TEX = { size: 512 };
const cache = new Map();

/* value-noise toolkit (non-tiling, deterministic from a per-bake seed) */
function makeNoise(seed) {
  const r = new R(seed), perm = new Uint8Array(512), vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = r.next(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const h = (x, y) => vals[perm[(perm[x & 255] + y) & 255]];
  const vn = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); return h(xi, yi) * (1 - u) * (1 - v) + h(xi + 1, yi) * u * (1 - v) + h(xi, yi + 1) * (1 - u) * v + h(xi + 1, yi + 1) * u * v; };
  const fbm = (x, y, o = 4) => { let s = 0, a = .5; for (let i = 0; i < o; i++) { s += a * vn(x, y); x = x * 2.03 + 17.1; y = y * 2.03 + 9.3; a *= .5; } return s; };
  /* voronoi: returns [F1, F2-F1 (edge), cellId] */
  const vor = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y); let f1 = 9, f2 = 9, id = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const cx = xi + i, cy = yi + j, px = cx + h(cx, cy * 3 + 7), py = cy + h(cx * 5 + 3, cy); const d = Math.hypot(px - x, py - y); if (d < f1) { f2 = f1; f1 = d; id = h(cx + 11, cy + 5); } else if (d < f2) f2 = d; } return [f1, f2 - f1, id]; };
  return { vn, fbm, vor };
}
const mix = (a, b, t) => a + (b - a) * t, cl = (x, a, b) => x < a ? a : x > b ? b : x;
const sm = (a, b, x) => { const t = cl((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const lin2srgb = c => c; // palette colours are already sRGB

/** bake one texture set. P = { variant, seed, size, base:[r,g,b], flank, belly, accent, cream, gold, striae, crinkle, cracks, spineBases:boolean } */
export function bakeOperculum(THREE, P) {
  const size = P.size || HYPER_TEX.size, key = JSON.stringify([P.variant, P.seed, size, P.base.map(x => +x.toFixed(2)), P.flank.map(x => +x.toFixed(2)), P.accent.map(x => +x.toFixed(2)), +P.striae.toFixed(0), +P.crinkle.toFixed(2), +P.cracks.toFixed(2)]);
  if (cache.has(key)) { const c = cache.get(key); cache.delete(key); cache.set(key, c); return c; }
  const N = makeNoise(P.seed), W = size, Hh = size, A = new Uint8Array(W * Hh * 4), B = new Uint8Array(W * Hh * 4), ht = new Float32Array(W * Hh);
  const alb = new Float32Array(W * Hh * 3), rgh = new Float32Array(W * Hh), met = new Float32Array(W * Hh);
   const v = P.variant;
   const hx = 0.0, hy = 0.22;
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const u = x / W, w = y / Hh, i = y * W + x;
     const low = N.fbm(u * 3 + 4, w * 3 + 1, 3) - .5;
     const fine = N.fbm(u * 32 + 7, w * 29 + 9, 3) - .5;
     const ang = Math.atan2(w - hy, (u - hx) * .8 + 1e-4);
     const radial = Math.sin(ang * P.striae * .26 + low * 1.4) * sm(.1, .7, u);
     const dermal = v === 'rust' ? .12 : v === 'reticulate' ? .08 : .045;
     let h = .48 + radial * .038 + low * dermal + fine * .1;
     let c = mix3(P.base, P.flank, sm(.04, .85, w) * .8);
     c = mix3(c, P.belly, sm(.64, 1, w) * .25);
     const mottling = 1 + low * (v === 'rust' ? .18 : .10) + fine * .075;
     c = c.map(q => cl(q * mottling, 0, 1));
     const ro = cl(.48 + fine * .10 + (v === 'rust' ? .08 : 0), .38, .66);
     const me = v === 'chrome' ? .035 : .012;
    ht[i] = h; alb[i * 3] = c[0]; alb[i * 3 + 1] = c[1]; alb[i * 3 + 2] = c[2]; rgh[i] = ro; met[i] = me;
  }
  // normals from the height field + pack
   const sc = 1.2 * W / 512;
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, xl = ht[y * W + Math.max(0, x - 1)], xr = ht[y * W + Math.min(W - 1, x + 1)], yu = ht[Math.max(0, y - 1) * W + x], yd = ht[Math.min(Hh - 1, y + 1) * W + x];
    const dx = (xr - xl) * sc, dy = (yd - yu) * sc, il = 1 / Math.hypot(dx, dy, 1);
    A[i * 4] = cl(alb[i * 3] * 255, 0, 255); A[i * 4 + 1] = cl(alb[i * 3 + 1] * 255, 0, 255); A[i * 4 + 2] = cl(alb[i * 3 + 2] * 255, 0, 255); A[i * 4 + 3] = cl(ht[i] * 255, 0, 255);
    B[i * 4] = (-dx * il * .5 + .5) * 255; B[i * 4 + 1] = (-dy * il * .5 + .5) * 255; B[i * 4 + 2] = cl(rgh[i] * 255, 0, 255); B[i * 4 + 3] = cl(met[i] * 255, 0, 255);
  }
  const mk = (data, srgb) => { const t = new THREE.DataTexture(data, W, Hh, THREE.RGBAFormat); t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 16; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 4; t.needsUpdate = true; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  const out = { mapA: mk(A, false), mapB: mk(B, false), variant: v, size };
  cache.set(key, out);
  if (cache.size > 24) { const k0 = cache.keys().next().value; const o = cache.get(k0); o.mapA.dispose(); o.mapB.dispose(); cache.delete(k0); }
  return out;
}
export const textureCacheSize = () => cache.size;
