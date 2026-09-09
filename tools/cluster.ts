import { fileURLToPath } from 'node:url'
import { crop, detectGrid, locateBand, resampleNearest, type Rgba } from '@sp/vision'
import { cellFeature, clusterFeatures } from '@sp/recognize'
import { readJpeg, writePng, grayToRgba } from './io'

const THRESHOLD = Number(process.argv[2] ?? 0.85)
const FROM = Number(process.argv[3] ?? 0)
const COUNT = Number(process.argv[4] ?? 20)

const img = readJpeg(fileURLToPath(new URL('../fixtures/roster-2026-09.jpg', import.meta.url)))
const r = detectGrid(img)
const M = r.lattice.matrix
const weights = r.lattice.colAnchors.map((_, c) => M.filter(row => row[c].detected).length)
const band = locateBand(r.lattice.colAnchors, weights, 30)!

// 간호사 행(2..32) × 일자 열만 대상으로 한다
const targets: Array<{ row: number; day: number; col: number }> = []
for (let row = 2; row < r.lattice.rows; row++) {
  band.columns.forEach((col, i) => targets.push({ row, day: i + 1, col }))
}
const feats = targets.map(t => cellFeature(r.gray, M[t.row][t.col]))
const { clusters, empties } = clusterFeatures(feats, { threshold: THRESHOLD })

console.log(`대상 셀 ${targets.length}  빈 칸 ${empties.length}  클러스터 ${clusters.length}`)
console.log('크기 분포:', clusters.map(c => c.members.length).join(' '))

// 대표 이미지 몽타주 — 한 줄에 하나씩, 대표 + 무작위 샘플 8개
const CW = Math.round(46 * 1.4), CH = Math.round(38 * 1.4), GAP = 5, SAMPLES = 6
const W = GAP + (SAMPLES + 2) * (CW + GAP)
const shown = clusters.slice(FROM, FROM + COUNT)
const H = GAP + shown.length * (CH * 2 + 2 + GAP)
const out: Rgba = { width: W, height: H, data: new Uint8Array(W * H * 4).fill(25) }
for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255

const place = (tile: Rgba, ox: number, oy: number, tint?: [number, number, number]) => {
  for (let y = 0; y < tile.height; y++) for (let x = 0; x < tile.width; x++) {
    const s = (y * tile.width + x) * 4, o = ((oy + y) * W + ox + x) * 4
    if (o < 0 || o + 3 >= out.data.length) continue
    out.data[o] = tint ? Math.min(255, tile.data[s] * 0.6 + tint[0]) : tile.data[s]
    out.data[o + 1] = tint ? Math.min(255, tile.data[s + 1] * 0.6 + tint[1]) : tile.data[s + 1]
    out.data[o + 2] = tint ? Math.min(255, tile.data[s + 2] * 0.6 + tint[2]) : tile.data[s + 2]
    out.data[o + 3] = 255
  }
}

shown.forEach((cl, ci) => {
  const oy = GAP + ci * (CH * 2 + 2 + GAP)
  const rep = targets[cl.representative]
  place(resampleNearest(crop(r.work, M[rep.row][rep.col], 1), CW, CH), GAP, oy, [70, 0, 0])
  const step = Math.max(1, Math.floor(cl.members.length / SAMPLES))
  for (let k = 0; k < SAMPLES; k++) {
    const m = cl.members[Math.min(cl.members.length - 1, k * step)]
    const t = targets[m]
    // 위: 원본 크롭 / 아래 절반: 분류기가 실제로 보는 특징 패치
    const orig = resampleNearest(crop(r.work, M[t.row][t.col], 1), CW, CH)
    const feat = resampleNearest(grayToRgba(feats[m].patch), CW, CH)
    const ox = GAP + (k + 2) * (CW + GAP)
    place(orig, ox, oy)
    place(feat, ox, oy + CH + 2)
  }
})
writePng(fileURLToPath(new URL('../debug/8-clusters.png', import.meta.url)), out)
console.log(`클러스터 ${FROM}~${FROM + shown.length - 1} 표시 -> debug/8-clusters.png (${W}x${H})`)
