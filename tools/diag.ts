import { fileURLToPath } from 'node:url'
import { detectGrid } from '@sp/vision'
import { readJpeg } from './io'

const img = readJpeg(fileURLToPath(new URL('../fixtures/roster-2026-09.jpg', import.meta.url)))
const r = detectGrid(img)
const M = r.lattice.matrix

console.log('col  meanX  medW  detected')
for (let c = 0; c < r.lattice.cols; c++) {
  const cells = M.map(row => row[c]).filter(x => x?.detected)
  const xs = cells.map(x => x!.cx)
  const ws = cells.map(x => x!.w)
  const mx = r.lattice.colAnchors[c]
  const mw = ws.length ? [...ws].sort((a, b) => a - b)[ws.length >> 1] : NaN
  console.log(`${String(c).padStart(3)}  ${mx.toFixed(0).padStart(5)}  ${String(mw).padStart(4)}  ${cells.length}`)
}
console.log('\nrow  meanY  medH  detected')
for (let rr = 0; rr < r.lattice.rows; rr++) {
  const cells = M[rr].filter(x => x?.detected)
  const ys = cells.map(x => x!.cy)
  const hs = cells.map(x => x!.h)
  const my = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : NaN
  const mh = hs.length ? [...hs].sort((a, b) => a - b)[hs.length >> 1] : NaN
  console.log(`${String(rr).padStart(3)}  ${my.toFixed(0).padStart(5)}  ${String(mh).padStart(4)}  ${cells.length}`)
}
