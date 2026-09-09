/** 특정 셀들을 크게 잘라 붙여서 보여준다. 사용: peek.ts row,day row,day ... */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { crop, detectGrid, locateBand, resampleNearest, type Rgba } from '@sp/vision'
import { cellFeature, classify, type Template } from '@sp/recognize'
import { readJpeg, writePng, grayToRgba } from './io'

const picks = process.argv.slice(2).map(a => {
  const [row, day] = a.split(',').map(Number); return { row, day }
})
const img = readJpeg(fileURLToPath(new URL('../fixtures/roster-2026-09.jpg', import.meta.url)))
const labels = JSON.parse(readFileSync(
  fileURLToPath(new URL('../fixtures/labels-2026-09.json', import.meta.url)), 'utf8'),
) as { labels: Array<{ row: number; day: number; raw: string }> }
const r = detectGrid(img)
const M = r.lattice.matrix
const weights = r.lattice.colAnchors.map((_, c) => M.filter(row => row[c].detected).length)
const band = locateBand(r.lattice.colAnchors, weights, 30)!
const boxOf = (row: number, day: number) => M[row][band.columns[day - 1]]
const templates: Template[] = labels.labels.map(l => ({
  raw: l.raw, vector: cellFeature(r.gray, boxOf(l.row, l.day)).vector,
}))

const S = 5, CW = 46 * S, CH = 38 * S, GAP = 8
const W = GAP + picks.length * (CW + GAP)
const H = GAP * 2 + CH * 2
const out: Rgba = { width: W, height: H, data: new Uint8Array(W * H * 4).fill(20) }
for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255
const place = (t: Rgba, ox: number, oy: number) => {
  for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) {
    const s = (y * t.width + x) * 4, o = ((oy + y) * W + ox + x) * 4
    if (o < 0 || o + 3 >= out.data.length) continue
    out.data[o] = t.data[s]; out.data[o + 1] = t.data[s + 1]
    out.data[o + 2] = t.data[s + 2]; out.data[o + 3] = 255
  }
}
picks.forEach((p, i) => {
  const box = boxOf(p.row, p.day)
  const f = cellFeature(r.gray, box)
  const c = classify(f, templates)
  console.log(`row${p.row} day${p.day}  detected=${box.detected}  -> "${c.raw}" score=${c.score.toFixed(3)} margin=${c.margin.toFixed(3)} vs "${c.runnerUp}"`)
  place(resampleNearest(crop(r.work, box, 2), CW, CH), GAP + i * (CW + GAP), GAP)
  place(resampleNearest(grayToRgba(f.patch), CW, CH), GAP + i * (CW + GAP), GAP + CH)
})
writePng(fileURLToPath(new URL('../debug/9-peek.png', import.meta.url)), out)
