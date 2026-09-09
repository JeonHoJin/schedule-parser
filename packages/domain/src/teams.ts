/**
 * 팀 배정.
 *
 * 병동 근무체계 문서의 순위→팀 매핑을 그대로 옮긴 것.
 * 호실 배정은 이 계산에 필요하지 않다 — 순위만으로 팀이 결정된다.
 *
 * 순위 = **그 날 그 시간대 근무자를 근무표 행 순서(=사번 순)로 세운 순번.**
 *
 * 같은 팀을 맡은 이전 근무자로부터 다음 근무자가 인계를 받는다.
 * 3팀 나이트→다음 데이 인계는 호실 단위로 갈라지지만, 현재는 호실 정보를
 * 다루지 않으므로 단순한 팀 이름 매칭으로 대신한다.
 */
import type { CycleSlot } from './codes'

export type Team = 'A' | 'B' | 'C' | 'D' | 'ACTING'

const RANK4: Record<CycleSlot, Team[]> = {
  D: ['A', 'B', 'C', 'D'],
  E: ['C', 'D', 'A', 'B'],
  N: ['B', 'A', 'D', 'C'],
}

const RANK3_NIGHT: Team[] = ['A', 'C', 'B']

/**
 * 순위와 근무자 수로 팀을 결정한다.
 *
 * - `rank` 는 1부터 시작한다. 0 이하이면 근무자가 아니라는 뜻이므로 액팅으로 본다.
 * - 나이트에서 근무자가 **정확히 3명**일 때만 3팀 체제가 적용된다.
 *   그 외에는 4팀 체제로, 5순위 이상은 액팅이다.
 */
export function teamFor(rank: number, slot: CycleSlot, workerCount: number): Team {
  if (rank <= 0) return 'ACTING'
  if (slot === 'N' && workerCount === 3) return RANK3_NIGHT[rank - 1] ?? 'ACTING'
  return RANK4[slot][rank - 1] ?? 'ACTING'
}

/**
 * 근무표 행 순서로 정렬된 근무자 배열을 받아 각자의 팀을 돌려준다.
 * 근무자 배열의 순서(=사번 순서)가 곧 순위다.
 */
export function assignTeams<T>(workersInOrder: T[], slot: CycleSlot): Team[] {
  return workersInOrder.map((_, i) => teamFor(i + 1, slot, workersInOrder.length))
}
