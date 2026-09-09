/** 파싱 결과를 앱이 그대로 읽을 수 있는 JSON 으로 내보낸다. */
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildRoster } from '@sp/domain'
import { load } from './sheet'

const { rosterInput, empnos, cells, fx } = load()
const roster = buildRoster(rosterInput)

// 이름은 인식하지 않는다 — 사용자가 최초 1회 등록하는 값이다.
// fixture 에 그 등록을 미리 해 두었으므로 여기서 붙인다.
roster.nurses.forEach((n, i) => { n.name = fx.names[i] })

const meRow = (() => {
  const c = new Map<number, number>()
  for (const x of cells.flat()) if (x.highlight === 'orange') c.set(x.row, (c.get(x.row) ?? 0) + 1)
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0]
})()

const out = {
  roster,
  settings: { myNurseId: roster.nurses[meRow - 2].id, reviewThreshold: 0.8 },
  review: {
    empnos: empnos.filter(e => e.needsReview).map(e => ({ row: e.row, read: e.read })),
    cells: cells.flat()
      .filter(c => c.kind !== 'EMPTY' && (c.score < 0.8 || c.margin < 0.06))
      .map(c => ({ row: c.row, day: c.day, raw: c.raw, score: +c.score.toFixed(3) })),
  },
}

const path = fileURLToPath(new URL('../apps/mobile/assets/roster-2026-09.json', import.meta.url))
mkdirSync(fileURLToPath(new URL('../apps/mobile/assets/', import.meta.url)), { recursive: true })
writeFileSync(path, JSON.stringify(out, null, 2))
console.log(`간호사 ${out.roster.nurses.length}명 · 셀 ${out.roster.cells.length}칸`)
console.log(`검수 필요: 사번 ${out.review.empnos.length}건, 근무 ${out.review.cells.length}건`)
console.log(`-> apps/mobile/assets/roster-2026-09.json`)
