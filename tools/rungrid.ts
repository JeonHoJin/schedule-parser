import { detectGrid, resizeRgbaArea } from '@sp/vision'
import { fileURLToPath } from 'node:url'
import { readJpeg, writePng, grayToRgba, drawRect, hsv } from './io'

const FIXTURE = fileURLToPath(new URL('../fixtures/roster-2026-09.jpg', import.meta.url))
const OUT = fileURLToPath(new URL('../debug/', import.meta.url))

const t0 = Date.now()
const img = readJpeg(FIXTURE)
console.log(`decoded ${img.width}x${img.height} in ${Date.now() - t0}ms`)

const t1 = Date.now()
const r = detectGrid(img)
console.log(`detect: ${Date.now() - t1}ms`)
console.log(`work        ${r.work.width}x${r.work.height}`)
console.log(`cell size   ${r.cellW.toFixed(1)} x ${r.cellH.toFixed(1)}`)
console.log(`cells       ${r.cells.length}`)
console.log(`lattice     ${r.lattice.rows} rows x ${r.lattice.cols} cols`)

let detected = 0, total = 0
for (const row of r.lattice.matrix) for (const c of row) { total++; if (c?.detected) detected++ }
console.log(`filled      ${detected}/${total} detected, ${total - detected} interpolated`)
console.log(`row sizes   ${r.lattice.matrix.map(row => row.filter(c => c?.detected).length).join(' ')}`)

writePng(OUT + '1-gray.png', grayToRgba(r.gray))
writePng(OUT + '2-binary.png', grayToRgba(r.binary))
writePng(OUT + '3-gridmask.png', grayToRgba(r.gridMask))

const vis = { ...r.work, data: new Uint8Array(r.work.data) }
r.lattice.matrix.forEach((row, ri) =>
  row.forEach(c => {
    if (!c) return
    drawRect(vis, c.x, c.y, c.w, c.h, c.detected ? hsv((ri * 0.17) % 1, 0.95, 1) : [255, 0, 0], 2)
  }))
writePng(OUT + '4-lattice.png', vis)
writePng(OUT + '4-lattice-small.png', resizeRgbaArea(vis, 1600, Math.round((1600 * vis.height) / vis.width)))
console.log('debug images -> debug/')
