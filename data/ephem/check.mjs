// node data/ephem/check.mjs
// Runs compute.mjs on the points of test_vectors.json and reports the largest differences.
// Exit code 0 when everything is inside the tolerance written in test_vectors.json.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createComputer } from "./compute.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const json = (path) => JSON.parse(readFileSync(path, "utf-8"));
const binary = (path) => {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

const computer = createComputer(
  json(join(here, "year.json")),
  binary(join(here, "year.bin")),
  binary(join(here, "sun_distance.bin")),
  json(join(here, "..", "dem240.json")),
  binary(join(here, "..", "dem240.bin")),
);
const vectors = json(join(here, "test_vectors.json"));
const worst = { angle_deg: 0, visible_fraction: 0, percent: 0, hours: 0, mask_deg: 0, irradiance_w_m2: 0 };
const note = (key, a, b) => {
  worst[key] = Math.max(worst[key], Math.abs(a - b));
};
const circular = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

const started = Date.now();
for (const point of vectors.points) {
  const got = computer.compute(point.lat, point.lon, point.height_m);
  note("mask_deg", got.ground_m / 1000, point.ground_m / 1000);
  note("visible_fraction", got.missing_fraction, point.missing_fraction);
  point.mask_deg.forEach((v, a) => note("mask_deg", got.mask[a], v));
  for (const m of point.moments) {
    for (const body of ["sun", "earth"]) {
      worst.angle_deg = Math.max(worst.angle_deg, circular(got[body].az[m.index], m[body].az));
      note("angle_deg", got[body].el[m.index], m[body].el);
      note("angle_deg", got[body].horizon_el[m.index], m[body].horizon_el);
      note("angle_deg", got[body].angular_radius[m.index], m[body].angular_radius_deg);
      note("visible_fraction", got[body].visible_fraction[m.index], m[body].visible_fraction);
    }
    note("irradiance_w_m2", got.sun.irradiance_w_m2[m.index], m.sun.irradiance_w_m2);
  }
  note("percent", got.year.lit_percent, point.year.lit_percent);
  note("percent", got.year.earth_visible_percent, point.year.earth_visible_percent);
  note("hours", got.year.longest_dark_h, point.year.longest_dark_h);
  note("hours", got.year.longest_lit_h, point.year.longest_lit_h);
  note("hours", got.year.longest_earth_hidden_h, point.year.longest_earth_hidden_h);
  note("irradiance_w_m2", got.year.mean_irradiance_w_m2, point.year.mean_irradiance_w_m2);
}
const ms = (Date.now() - started) / vectors.points.length;

const limit = { ...vectors.tolerance, mask_deg: vectors.tolerance.angle_deg };
const failed = Object.keys(worst).filter((key) => worst[key] > limit[key]);
console.log(JSON.stringify({ points: vectors.points.length, ms_per_point: Math.round(ms), worst, limit, failed }));
process.exit(failed.length ? 1 : 0);
