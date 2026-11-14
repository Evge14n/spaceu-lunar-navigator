// Sun, Earth and horizon for any point near the lunar south pole, computed without a server.
// A line-by-line port of backend/browser.py; the algorithm is described in docs/BROWSER_COMPUTE.md.
// No dependencies, works in a browser and in Node. `node data/ephem/check.mjs` compares it
// with data/ephem/test_vectors.json.
//
//   // the three JSON/binary pairs: parsed objects and ArrayBuffers
//   const computer = createComputer(yearJson, yearBin, sunDistanceBin, demJson, demBin);
//   const result = computer.compute(-89.45, 222.7);        // eye 2 m above the ground
//   result.year.lit_percent, result.mask[azimuthIndex], result.sun.el[hourIndex], ...

export const N_AZIMUTH = 720;
export const RAY_FIRST_M = 240;
export const RAY_STEP_M = 120;
export const RAY_MAX_M = 150000;
export const N_STRIPS = 24;

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

function localFrame(latDeg, lonDeg) {
  const lat = latDeg * RAD;
  const lon = lonDeg * RAD;
  return {
    east: [-Math.sin(lon), Math.cos(lon), 0],
    north: [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)],
    up: [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)],
  };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function createComputer(yearMeta, yearBuffer, sunDistanceBuffer, demMeta, demBuffer) {
  const c = yearMeta.constants;
  const moonRadiusM = c.moon_radius_km * 1000;
  const table = new Float32Array(yearBuffer); // per sample: Sun unit vector, Earth position in km
  const sunDistance = new Float32Array(sunDistanceBuffer); // km
  const count = yearMeta.n;
  const stride = yearMeta.stride;
  if (table.length !== count * stride) throw new Error("year.bin does not match year.json");
  if (sunDistance.length !== count) throw new Error("sun_distance.bin does not match year.json");
  const dem = new Int16Array(demBuffer);
  const cols = demMeta.width;
  const rows = demMeta.height;
  if (dem.length !== cols * rows) throw new Error("dem240.bin does not match dem240.json");
  const x0 = demMeta.first_pixel_centre_m[0];
  const y0 = demMeta.first_pixel_centre_m[1];
  const pixel = demMeta.pixel_m;

  // Bilinear height (m) at map coordinates x, y (m); NaN outside the model.
  function demHeight(x, y) {
    const fc = (x - x0) / pixel;
    const fr = (y0 - y) / pixel;
    if (!(fc >= 0 && fr >= 0 && fc <= cols - 1 && fr <= rows - 1)) return NaN;
    const col = Math.min(Math.floor(fc), cols - 2);
    const row = Math.min(Math.floor(fr), rows - 2);
    const tx = fc - col;
    const ty = fr - row;
    const i = row * cols + col;
    const top = dem[i] * (1 - tx) + dem[i + 1] * tx;
    const bottom = dem[i + cols] * (1 - tx) + dem[i + cols + 1] * tx;
    return top * (1 - ty) + bottom * ty;
  }

  function groundAt(latDeg, lonDeg) {
    const { up } = localFrame(latDeg, lonDeg);
    const k = (2 * moonRadiusM) / (1 - up[2]);
    return demHeight(k * up[1], k * up[0]);
  }

  // Elevation of the skyline (deg) in 720 azimuths: index 0 looks north, 180 east.
  function horizonMask(latDeg, lonDeg, heightM = 2) {
    const { east, north, up } = localFrame(latDeg, lonDeg);
    const ground = groundAt(latDeg, lonDeg);
    if (Number.isNaN(ground)) throw new Error("the point is outside the elevation model");
    const rObs = moonRadiusM + ground + heightM;
    const n = Math.floor((RAY_MAX_M - RAY_FIRST_M) / RAY_STEP_M + 0.5) + 1;
    const cg = new Float64Array(n);
    const sg = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      const g = (RAY_FIRST_M + RAY_STEP_M * j) / moonRadiusM;
      cg[j] = Math.cos(g);
      sg[j] = Math.sin(g);
    }
    const dip = -Math.acos((moonRadiusM + ground) / rObs);
    const mask = new Float64Array(N_AZIMUTH);
    let seen = 0;
    for (let a = 0; a < N_AZIMUTH; a++) {
      const az = (2 * Math.PI * a) / N_AZIMUTH;
      const sa = Math.sin(az);
      const ca = Math.cos(az);
      const dx = sa * east[0] + ca * north[0];
      const dy = sa * east[1] + ca * north[1];
      const dz = sa * east[2] + ca * north[2];
      let best = -Infinity;
      for (let j = 0; j < n; j++) {
        const ux = cg[j] * up[0] + sg[j] * dx;
        const uy = cg[j] * up[1] + sg[j] * dy;
        const uz = cg[j] * up[2] + sg[j] * dz;
        const k = (2 * moonRadiusM) / (1 - uz);
        const z = demHeight(k * uy, k * ux);
        if (Number.isNaN(z)) continue;
        seen++;
        const r = moonRadiusM + z;
        const t = (r * cg[j] - rObs) / (r * sg[j]);
        if (t > best) best = t;
      }
      mask[a] = (best === -Infinity ? dip : Math.atan(best)) * DEG;
    }
    return { mask, ground_m: ground, missing_fraction: 1 - seen / (n * N_AZIMUTH) };
  }

  function maskAt(mask, azDeg) {
    const pos = ((((azDeg % 360) + 360) % 360) / 360) * mask.length;
    const i0 = Math.floor(pos) % mask.length;
    const frac = pos - Math.floor(pos);
    return mask[i0] * (1 - frac) + mask[(i0 + 1) % mask.length] * frac;
  }

  // Azimuth, elevation, angular radius and visible share of the disc for every sample of the year.
  function bodySky(isSun, radiusKm, frame, elevationM, mask) {
    const { east, north, up } = frame;
    const site = c.moon_radius_km + elevationM / 1000;
    const out = {
      az: new Float64Array(count),
      el: new Float64Array(count),
      horizon_el: new Float64Array(count),
      distance_km: new Float64Array(count),
      angular_radius: new Float64Array(count),
      visible_fraction: new Float64Array(count),
    };
    const v = [0, 0, 0];
    for (let i = 0; i < count; i++) {
      const o = i * stride;
      for (let k = 0; k < 3; k++) {
        const p = isSun ? table[o + k] * sunDistance[i] : table[o + 3 + k];
        v[k] = p - site * up[k];
      }
      const dist = Math.hypot(v[0], v[1], v[2]);
      const el = Math.asin(Math.max(-1, Math.min(1, dot(v, up) / dist))) * DEG;
      const az = ((Math.atan2(dot(v, east), dot(v, north)) * DEG) % 360 + 360) % 360;
      const rad = Math.asin(radiusKm / dist) * DEG;
      const cosEl = Math.max(Math.cos(el * RAD), 1e-6);
      let seen = 0;
      let total = 0;
      for (let s = 0; s < N_STRIPS; s++) {
        const off = ((s + 0.5) / N_STRIPS) * 2 - 1;
        const half = rad * Math.sqrt(1 - off * off);
        const hor = maskAt(mask, az + (off * rad) / cosEl);
        seen += Math.max(0, Math.min(2 * half, el + half - hor));
        total += 2 * half;
      }
      out.az[i] = az;
      out.el[i] = el;
      out.horizon_el[i] = maskAt(mask, az);
      out.distance_km[i] = dist;
      out.angular_radius[i] = rad;
      out.visible_fraction[i] = seen / total;
    }
    return out;
  }

  function longestRunH(fraction, wantVisible, stepH) {
    let best = 0;
    let run = 0;
    for (let i = 0; i < fraction.length; i++) {
      run = fraction[i] > 0 === wantVisible ? run + 1 : 0;
      if (run > best) best = run;
    }
    return Math.min(best, fraction.length - 1) * stepH;
  }

  function compute(latDeg, lonDeg, heightM = 2) {
    const hor = horizonMask(latDeg, lonDeg, heightM);
    const frame = localFrame(latDeg, lonDeg);
    const elevation = hor.ground_m + heightM;
    const sun = bodySky(true, c.sun_radius_km, frame, elevation, hor.mask);
    const earth = bodySky(false, c.earth_radius_km, frame, elevation, hor.mask);
    sun.irradiance_w_m2 = new Float64Array(count);
    let lit = 0;
    let link = 0;
    let power = 0;
    for (let i = 0; i < count; i++) {
      const w = c.solar_constant_w_m2 * (c.au_km / sun.distance_km[i]) ** 2 * sun.visible_fraction[i];
      sun.irradiance_w_m2[i] = w;
      power += w;
      if (sun.visible_fraction[i] > 0) lit++;
      if (earth.visible_fraction[i] > 0) link++;
    }
    const stepH = yearMeta.step_h;
    const hours = (count - 1) * stepH;
    const meanW = power / count;
    return {
      ...hor,
      sun,
      earth,
      year: {
        lit_percent: (100 * lit) / count,
        longest_dark_h: longestRunH(sun.visible_fraction, false, stepH),
        longest_lit_h: longestRunH(sun.visible_fraction, true, stepH),
        mean_irradiance_w_m2: meanW,
        energy_kwh_m2: (meanW * hours) / 1000,
        earth_visible_percent: (100 * link) / count,
        longest_earth_hidden_h: longestRunH(earth.visible_fraction, false, stepH),
      },
    };
  }

  // UTC time of sample i, as a Date.
  const timeOf = (i) => new Date(Date.parse(yearMeta.start) + i * yearMeta.step_h * 3600000);

  return { compute, horizonMask, groundAt, timeOf, count };
}
