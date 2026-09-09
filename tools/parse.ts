/** 사진 한 장 → 도메인 모델 전체를 찍어 본다. */
import { buildRoster, handover, monthOf, RosterIndex, summarize, weekdayKo } from '@sp/domain'
import { load, DAYS } from './sheet'

const { rosterInput, empnos, cells } = load()
const roster = buildRoster(rosterInput)
const index = new RosterIndex(roster)
console.log(`${roster.ward} ${roster.year}년 ${roster.month}월  ·  간호사 ${roster.nurses.length}명  ·  셀 ${roster.cells.length}칸`)

const unresolved = empnos.filter(e => e.needsReview)
console.log(`사번 확인 필요 ${unresolved.length}명: ${unresolved.map(e => `row${e.row}(${e.read ?? '?'})`).join(' ') || '없음'}`)

// 형광펜으로 본인 특정
const orange = new Map<number, number>()
cells.flat().forEach(c => { if (c.highlight === 'orange') orange.set(c.row, (orange.get(c.row) ?? 0) + 1) })
const meRow = [...orange.entries()].sort((a, b) => b[1] - a[1])[0][0]
const me = roster.nurses[meRow - 2]
console.log(`\n본인: 사번 ${me.empNo} (row${meRow})`)

const mine = monthOf(index, me.id)
console.log('요약:', Object.entries(summarize(mine)).map(([k, v]) => `${k} ${v}`).join(' · '))

for (const cell of mine) {
  const h = handover(index, me.id, cell.date)
  const day = Number(cell.date.slice(-2))
  const head = `${String(day).padStart(2)}일(${weekdayKo(cell.date)}) ${cell.kind.padEnd(5)}`
  if (!h) { console.log(`${head} —`); continue }
  const fmt = (g: typeof h.previous) =>
    g.outOfRange ? '(이전/다음 달 근무표 필요)'
      : g.workers.map(w => w.nurse.empNo).join(',') || '없음'
  console.log(`${head} 이전[${h.previous.slot}] ${fmt(h.previous)}`)
  console.log(`${' '.repeat(head.length)} 동시[${h.concurrent.slot}] ${fmt(h.concurrent)}`)
  console.log(`${' '.repeat(head.length)} 다음[${h.next.slot}] ${fmt(h.next)}`)
}
