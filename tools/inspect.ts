/** 특정 행·열 범위의 셀 기하 정보를 표로 출력한다. 사용: inspect.ts <r0> <r1> <c0> <c1> */
import { fileURLToPath } from 'node:url'
import { detectGrid } from '@sp/vision'
import { readJpeg } from './io'

const [r0 = 0, r1 = 3, c0 = 0, c1 = 8] = process.argv.slice(2).map(Number)
const img = readJpeg(fileURLToPath(new URL('../fixtures/roster-2026-09.jpg', import.meta.url)))
const r = detectGrid(img)

console.log(`lattice ${r.lattice.rows} x ${r.lattice.cols}`)
console.log('anchors:', r.lattice.colAnchors.slice(c0, c1 + 1).map(x => Math.round(x)).join(' '))
for (let row = r0; row <= r1 && row < r.lattice.rows; row++) {
  const parts = []
  for (let c = c0; c <= c1 && c < r.lattice.cols; c++) {
    const k = r.lattice.matrix[row][c]
    parts.push(`c${c}:${k.detected ? '●' : '○'}${Math.round(k.x)}+${k.w}`)
  }
  console.log(`row ${String(row).padStart(2)}  ${parts.join('  ')}`)
}
