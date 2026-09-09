/**
 * 팀 배정 · 인계 상대 규칙 검증.
 *
 * 근무체계 문서의 규칙을 그대로 구현한 `packages/domain/src/teams.ts` 를 호출해,
 * 사용자가 근무표에 노랑 형광펜으로 칠해 둔 "내가 인계하는 사람" 과 대조한다.
 * 현재 18/18 일치. 이 값이 흔들리면 도메인 팀 로직이 회귀한 것.
 */
import type { ShiftKind } from '@sp/domain'
import { teamFor } from '@sp/domain'
import { load, DAYS } from './sheet'

const { sheet, cells } = load()
const at = (r: number, d: number) => cells[r - 2][d - 1]
const orange = new Map<number, number>()
for (const c of cells.flat()) if (c.highlight === 'orange') orange.set(c.row, (orange.get(c.row) ?? 0) + 1)
const me = [...orange.entries()].sort((a, b) => b[1] - a[1])[0][0]

const workers = (day: number, slot: ShiftKind) =>
  sheet.nurseRows.filter(r => at(r, day).kind === slot)   // 행 순서 = 사번 순서

function teamOf(day: number, slot: 'D' | 'E' | 'N', row: number) {
  const list = workers(day, slot)
  const rank = list.indexOf(row) + 1
  return teamFor(rank, slot, list.length)
}

const CYCLE: Array<'D' | 'E' | 'N'> = ['D', 'E', 'N']
let hit = 0, total = 0
console.log('일  내근무 인원 내순위 내팀 | 다음슬롯 인원 | 같은팀 예측 | 실제(노랑) | 결과')
for (let day = 1; day <= DAYS; day++) {
  const mineKind = at(me, day).kind
  const i = CYCLE.indexOf(mineKind as 'D' | 'E' | 'N')
  if (i < 0) continue
  const slot = CYCLE[i]
  const myList = workers(day, slot)
  const myRank = myList.indexOf(me) + 1
  const myTeam = teamOf(day, slot, me)

  const nd = i === 2 ? day + 1 : day
  if (nd > DAYS) continue
  const nextSlot = CYCLE[(i + 1) % 3]
  const nextList = workers(nd, nextSlot).filter(r => r !== me)
  const predicted = nextList.filter(r => teamOf(nd, nextSlot, r) === myTeam)
  const marked = sheet.nurseRows.filter(r => at(r, nd).highlight === 'yellow' && r !== me)
  if (!marked.length) continue
  total++
  const ok = predicted.length === 1 && predicted[0] === marked[0]
  if (ok) hit++
  console.log(
    `${String(day).padStart(2)}  ${slot}    ${String(myList.length).padStart(2)}  ${myRank}순위 ${myTeam.padEnd(6)}` +
    `| ${nextSlot} ${String(workers(nd, nextSlot).length).padStart(2)}명 ` +
    `| 예측 [${predicted.join(',')}] | 실제 [${marked.join(',')}] | ${ok ? '✓' : '✗'}`)
}
console.log(`\n일치 ${hit}/${total}`)
