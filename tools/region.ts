import { fileURLToPath } from 'node:url'
import { crop, detectGrid, resampleNearest } from '@sp/vision'
import { readJpeg, writePng } from './io'
const [x, y, w, h, s] = process.argv.slice(2).map(Number)
const img = readJpeg(fileURLToPath(new URL('../fixtures/roster-2026-09.jpg', import.meta.url)))
const r = detectGrid(img)
const region = crop(r.work, { x, y, w, h })
// 이 구역에 중심이 걸친 열들의 경계를 표시
for (let c = 0; c < r.lattice.cols; c++) {
  for (let ri = 0; ri < r.lattice.rows; ri++) {
    const k = r.lattice.matrix[ri][c]
    if (k.cx < x || k.cx > x + w || k.cy < y || k.cy > y + h) continue
    const px = Math.round(k.cx - x)
    for (let yy = 0; yy < h; yy++) {
      const o = (yy * w + px) * 4
      if (o < 0 || o + 3 >= region.data.length) continue
      region.data[o] = k.detected ? 0 : 255
      region.data[o + 1] = k.detected ? 200 : 0
      region.data[o + 2] = k.detected ? 255 : 0
    }
  }
}
writePng(fileURLToPath(new URL('../debug/7-region.png', import.meta.url)),
  resampleNearest(region, w * s, h * s))
console.log(`region ${x},${y} ${w}x${h} @${s}x`)
