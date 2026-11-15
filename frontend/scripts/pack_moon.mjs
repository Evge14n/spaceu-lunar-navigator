// moon.glb 81.5 MB -> a few MB for the web (15.11.2026).
// Usage: node frontend/scripts/pack_moon.mjs in.glb out.glb [ratio=0.12] [texture=4096]
// Needs: npm i @gltf-transform/core@4.1.1 @gltf-transform/extensions@4.1.1 @gltf-transform/functions@4.1.1 meshoptimizer@0.22.0 sharp@0.33.5 (in a scratch folder)
// 1. drop the per-face normals and weld by position + UV (2.02 M -> 0.62 M vertices),
// 2. simplify with meshoptimizer to `ratio` of the triangles (UV seam and borders kept),
// 3. smooth normals again, 4. colour map 8192 -> `texture` px wide JPEG,
// 5. quantise + EXT_meshopt_compression (three's GLTFLoader decodes it with MeshoptDecoder).
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { weld, simplify, textureCompress, quantize, meshopt, prune, dedup } from '@gltf-transform/functions'
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer'
import sharp from 'sharp'

const [, , inp, out, ratioArg, texArg] = process.argv
const ratio = Number(ratioArg ?? 0.12)
const tex = Number(texArg ?? 4096)
await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready, MeshoptDecoder.ready])
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })
const doc = await io.read(inp)
const count = () => {
  let v = 0, t = 0
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    v += p.getAttribute('POSITION').getCount()
    t += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3
  }
  return `${v} vertices, ${t} triangles`
}
console.log('in ', count())
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
  const n = p.getAttribute('NORMAL')
  if (n) { p.setAttribute('NORMAL', null); n.dispose() }
}
await doc.transform(weld())
console.log('weld', count())
await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: Number(process.env.SIMPLIFY_ERROR ?? 0.01), lockBorder: false }))
console.log('simp', count())
// smooth normals: area-weighted face normals summed per (welded) vertex
const buffer = doc.getRoot().listBuffers()[0]
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
  const pos = p.getAttribute('POSITION').getArray()
  const idx = p.getIndices().getArray()
  const nrm = new Float32Array(pos.length)
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2]
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    for (const k of [a, b, c]) { nrm[k] += nx; nrm[k + 1] += ny; nrm[k + 2] += nz }
  }
  for (let k = 0; k < nrm.length; k += 3) {
    const l = Math.hypot(nrm[k], nrm[k + 1], nrm[k + 2]) || 1
    nrm[k] /= l; nrm[k + 1] /= l; nrm[k + 2] /= l
  }
  p.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buffer))
}
await doc.transform(
  textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [tex, tex / 2], quality: 85 }),
  prune(), dedup(),
  quantize({ quantizePosition: 16, quantizeNormal: 10, quantizeTexcoord: 14 }),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
)
await io.write(out, doc)
console.log('out', count())
