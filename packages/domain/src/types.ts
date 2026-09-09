import type { IsoDate } from './calendar'
import type { ShiftKind } from './codes'

export interface Nurse {
  id: string
  /** 사번 — 근무표가 바뀌어도 사람을 잇는 키. 인식 대상. */
  empNo: string
  /** 사용자가 최초 1회 등록. 인식하지 않는다. */
  name?: string
  /** 근무표에서의 행 순서 */
  order: number
}

export interface ShiftCell {
  nurseId: string
  date: IsoDate
  /** 인쇄된 글자 그대로. 의미를 모르는 코드도 버리지 않는다. */
  raw: string
  kind: ShiftKind
  flags: string[]
  /** 0~1. 낮으면 검수 대상 */
  confidence: number
  /** 사용자가 직접 고친 칸 */
  edited: boolean
}

export interface Roster {
  id: string
  ward?: string
  year: number
  month: number
  printedAt?: string
  nurses: Nurse[]
  cells: ShiftCell[]
  sourceImage?: string
}

export interface Settings {
  myNurseId?: string
  /** 이 값보다 신뢰도가 낮으면 검수 목록에 올린다 */
  reviewThreshold: number
}

export const DEFAULT_SETTINGS: Settings = { reviewThreshold: 0.8 }
