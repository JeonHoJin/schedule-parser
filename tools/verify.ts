/**
 * 형광펜 교차검증.
 * 사용자가 손으로 칠한 표시(주황=본인, 분홍=동시간, 노랑=다음시간)를
 * 인식 결과로 계산한 인수인계 체인과 대조한다.
 */
import type { Highlight, ShiftKind } from '@sp/recognize'
import { load, DAYS } from './sheet'

const { sheet, cells } = load()
const at = (row: number, day: number) => cells[row - 2][day - 1]

const orange = new Map<number, number>()
for (const c of cells.flat()) {
  if (c.highlight === 'orange') orange.set(c.row, (orange.get(c.row) ?? 0) + 1)
}
const me = [...orange.entries()].sort((a, b) => b[1] - a[1])[0][0]
console.log(`본인 = row${me} (주황 ${orange.get(me)}칸, 다른 행은 ${orange.size - 1}개)`)
console.log('근무:', Array.from({ length: DAYS }, (_, i) => at(me, i + 1).kind).join(' '))

const CYCLE: ShiftKind[] = ['D', 'E', 'N']
const concurrent = new Set<string>()
const next = new Set<string>()
for (let day = 1; day <= DAYS; day++) {
  const i = CYCLE.indexOf(at(me, day).kind)
  if (i < 0) continue
  for (const row of sheet.nurseRows) {
    if (row !== me && at(row, day).kind === at(me, day).kind) concurrent.add(`${row}:${day}`)
  }
  const nd = i === 2 ? day + 1 : day
  if (nd > DAYS) continue
  for (const row of sheet.nurseRows) {
    if (row === me && nd === day) continue
    if (at(row, nd).kind === CYCLE[(i + 1) % 3]) next.add(`${row}:${nd}`)
  }
}

const marked = (c: Highlight) =>
  new Set(cells.flat().filter(x => x.highlight === c && x.row !== me).map(x => `${x.row}:${x.day}`))

for (const [name, expected, color] of [
  ['동시간 근무자', concurrent, 'pink'],
  ['다음시간 근무자', next, 'yellow'],
] as Array<[string, Set<string>, Highlight]>) {
  const actual = marked(color)
  const missed = [...actual].filter(k => !expected.has(k))
  console.log(`\n${name} (${color})`)
  console.log(`  손으로 칠한 ${actual.size}칸 중 ${actual.size - missed.length}칸 일치` +
    `  (재현율 ${((1 - missed.length / actual.size) * 100).toFixed(1)}%)`)
  if (missed.length) {
    console.log('  불일치:', missed.map(k => {
      const [row, day] = k.split(':').map(Number)
      return `row${row}/${day}일(${at(row, day).kind})`
    }).join('  '))
  }
}
