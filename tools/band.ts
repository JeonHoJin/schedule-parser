import { fileURLToPath } from 'node:url'
import { detectGrid, locateBand } from '@sp/vision'
import { readJpeg } from './io'

const img = readJpeg(fileURLToPath(new URL('../fixtures/roster-2026-09.jpg', import.meta.url)))
const r = detectGrid(img)
const M = r.lattice.matrix
const centers: number[] = [], weights: number[] = []
for (let c = 0; c < r.lattice.cols; c++) {
  const col = M.map(row => row[c]).filter(x => x?.detected)
  centers.push(r.lattice.colAnchors[c])
  weights.push(col.length)
}
const band = locateBand(centers, weights, 30)
console.log('seed  ', band?.seed, 'pitch', band?.pitch.toFixed(2))
console.log('day -> col index')
console.log(band?.columns.map((c, i) => `${i + 1}:${c}`).join(' '))
console.log('synthesized:', band?.synthesized.size)
