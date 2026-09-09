import { fileURLToPath } from 'node:url'
import { crop, detectGrid, resampleNearest, type Rgba } from '@sp/vision'
import { readJpeg, writePng } from './io'

const CW = 46, CH = 38, GAP = 3

const img = readJpeg(fileURLToPath(new URL('../fixtures/roster-2026-09.jpg', import.meta.url)))
const r = detectGrid(img)
const M = r.lattice.matrix
const R = r.lattice.rows, C = r.lattice.cols

const W = C * (CW + GAP) + GAP
const H = R * (CH + GAP) + GAP
const out: Rgba = { width: W, height: H, data: new Uint8Array(W * H * 4).fill(40) }

for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const o = (y * W + x) * 4; out.data[o + 3] = 255
}

for (let ri = 0; ri < R; ri++) {
  for (let ci = 0; ci < C; ci++) {
    const cell = M[ri][ci]
    if (!cell) continue
    const tile = resampleNearest(crop(r.work, cell, 1), CW, CH)
    const ox = GAP + ci * (CW + GAP)
    const oy = GAP + ri * (CH + GAP)
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
      const s = (y * CW + x) * 4
      const o = ((oy + y) * W + ox + x) * 4
      // 보간된 셀은 붉게 틴트해서 구분
      out.data[o] = cell.detected ? tile.data[s] : Math.min(255, tile.data[s] + 60)
      out.data[o + 1] = cell.detected ? tile.data[s + 1] : tile.data[s + 1] * 0.6
      out.data[o + 2] = cell.detected ? tile.data[s + 2] : tile.data[s + 2] * 0.6
      out.data[o + 3] = 255
    }
  }
}
writePng(fileURLToPath(new URL('../debug/5-montage.png', import.meta.url)), out)
console.log(`montage ${R}x${C} -> ${W}x${H}`)
