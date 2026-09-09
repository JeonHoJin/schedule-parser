import { fileURLToPath } from 'node:url'
import { crop, detectGrid, resampleNearest, type Rgba } from '@sp/vision'
import { readJpeg, writePng } from './io'

const [r0, r1, c0, c1, scale] = (process.argv.slice(2).length
  ? process.argv.slice(2).map(Number) : [0, 3, 24, 44, 3]) as number[]

const img = readJpeg(fileURLToPath(new URL('../fixtures/roster-2026-09.jpg', import.meta.url)))
const res = detectGrid(img)
const M = res.lattice.matrix
const CW = Math.round(46 * scale), CH = Math.round(38 * scale), GAP = 4
const R = r1 - r0 + 1, C = c1 - c0 + 1
const W = C * (CW + GAP) + GAP, H = R * (CH + GAP) + GAP
const out: Rgba = { width: W, height: H, data: new Uint8Array(W * H * 4).fill(30) }
for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255

for (let ri = r0; ri <= r1; ri++) for (let ci = c0; ci <= c1; ci++) {
  const cell = M[ri]?.[ci]; if (!cell) continue
  const tile = resampleNearest(crop(res.work, cell, 1), CW, CH)
  const ox = GAP + (ci - c0) * (CW + GAP), oy = GAP + (ri - r0) * (CH + GAP)
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    const s = (y * CW + x) * 4, o = ((oy + y) * W + ox + x) * 4
    out.data[o] = cell.detected ? tile.data[s] : Math.min(255, tile.data[s] + 70)
    out.data[o + 1] = cell.detected ? tile.data[s + 1] : tile.data[s + 1] * 0.5
    out.data[o + 2] = cell.detected ? tile.data[s + 2] : tile.data[s + 2] * 0.5
    out.data[o + 3] = 255
  }
}
writePng(fileURLToPath(new URL('../debug/6-zoom.png', import.meta.url)), out)
console.log(`zoom rows ${r0}-${r1} cols ${c0}-${c1} -> ${W}x${H}`)
