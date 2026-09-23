import { addDays, type IsoDate } from './calendar'
import { CYCLE, isCycleSlot, type CycleSlot } from './codes'
import type { RosterIndex } from './roster'
import { assignTeams, teamFor, type Team } from './teams'
import type { Nurse, ShiftCell } from './types'

export interface ShiftWorker {
  nurse: Nurse
  cell: ShiftCell
  team: Team
  /** 근무표 행 순서 기준 이 시간대 근무자 중 몇 번째인지 (1-based) */
  rank: number
}

export interface ShiftGroup {
  date: IsoDate
  slot: CycleSlot
  workers: ShiftWorker[]
  /**
   * 이 날짜가 지금 근무표의 범위 밖일 때 true.
   * 달의 첫날 Day 의 이전 근무자, 마지막날 Night 의 다음 근무자가 여기 해당한다.
   * 화면에서는 "이전(다음) 달 근무표를 추가하면 볼 수 있어요" 로 안내한다.
   */
  outOfRange: boolean
}

export interface Handover {
  date: IsoDate
  slot: CycleSlot
  /** 그 날 그 시간대 나 자신의 팀 (없으면 null — 오프/기타) */
  myTeam: Team | null
  /** 나에게 인계하는 사람들 */
  previous: ShiftGroup
  /** 나와 같은 시간대에 함께 일하는 사람들 */
  concurrent: ShiftGroup
  /** 내가 인계하는 사람들 */
  next: ShiftGroup
}

/**
 * 그 날 그 시간대 근무자 전원을 행 순서로 세워 팀·순위를 붙인 뒤,
 * 필요하면 특정 인원을 제외한 목록을 돌려준다.
 * 팀 계산은 제외 전 인원 기준이어야 하므로 순서가 중요하다.
 */
function group(
  index: RosterIndex,
  date: IsoDate,
  slot: CycleSlot,
  excludeNurseId?: string,
): ShiftGroup {
  if (!index.covers(date)) return { date, slot, workers: [], outOfRange: true }
  const all = index.onDate(date)
    .filter(c => c.kind === slot)
    .map(c => ({ nurse: index.nurse(c.nurseId)!, cell: c }))
    .filter(w => w.nurse)
    .sort((a, b) => a.nurse.order - b.nurse.order)
  const teams = assignTeams(all, slot)
  const workers: ShiftWorker[] = all
    .map((w, i) => ({ nurse: w.nurse, cell: w.cell, team: teams[i], rank: i + 1 }))
    .filter(w => w.nurse.id !== excludeNurseId)
  return { date, slot, workers, outOfRange: false }
}

/**
 * 인수인계 체인.
 *
 * 3교대는 `D → E → N → (익일) D` 로 순환한다. 내 근무가 그 순환의 어디인지에 따라
 * 이전·다음이 **같은 날인지 옆 날인지** 달라지는 것이 이 계산의 전부다.
 *
 * | 내 근무 | 이전 | 동시간 | 다음 |
 * |---|---|---|---|
 * | D | 전날 N | 그날 D | 그날 E |
 * | E | 그날 D | 그날 E | 그날 N |
 * | N | 그날 E | 그날 N | 다음날 D |
 *
 * 오프·기타 근무는 체인에 참여하지 않으므로 `null` 을 돌려준다.
 */
export function handover(
  index: RosterIndex,
  nurseId: string,
  date: IsoDate,
): Handover | null {
  const mine = index.cell(nurseId, date)
  if (!mine || !isCycleSlot(mine.kind)) return null

  const i = CYCLE.indexOf(mine.kind)
  const prevSlot = CYCLE[(i + 2) % 3]
  const nextSlot = CYCLE[(i + 1) % 3]
  // D 의 이전(N)은 전날, N 의 다음(D)은 다음날. 나머지는 같은 날이다.
  const prevDate = i === 0 ? addDays(date, -1) : date
  const nextDate = i === 2 ? addDays(date, +1) : date

  // 내 팀은 나를 포함한 전체 근무자 순서로 계산해야 한다.
  const concurrent = group(index, date, mine.kind, nurseId)
  const myRank = index.onDate(date)
    .filter(c => c.kind === mine.kind)
    .map(c => index.nurse(c.nurseId))
    .filter((n): n is NonNullable<typeof n> => Boolean(n))
    .sort((a, b) => a.order - b.order)
    .findIndex(n => n.id === nurseId) + 1
  const myTeam = myRank > 0
    ? teamFor(myRank, mine.kind, concurrent.workers.length + 1)
    : null

  return {
    date,
    slot: mine.kind,
    myTeam,
    previous: group(index, prevDate, prevSlot),
    concurrent,
    next: group(index, nextDate, nextSlot, i === 2 ? undefined : nurseId),
  }
}

/**
 * 그 날 한 시간대의 근무자 전원과 각자의 팀. 날짜 상세의 "근무 × 팀" 표에 쓴다.
 * 근무표 범위 밖 날짜면 `outOfRange` 가 true 인 빈 목록이다.
 */
export function onShift(index: RosterIndex, date: IsoDate, slot: CycleSlot): ShiftGroup {
  return group(index, date, slot)
}

/** 한 사람의 한 달 근무를 날짜순으로 */
export function monthOf(index: RosterIndex, nurseId: string): ShiftCell[] {
  return index.roster.cells
    .filter(c => c.nurseId === nurseId)
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** 근무 종류별 개수 — 달력 화면 상단 요약 */
export function summarize(cells: ShiftCell[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of cells) out[c.kind] = (out[c.kind] ?? 0) + 1
  return out
}
