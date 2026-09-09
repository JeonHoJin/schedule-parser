/**
 * 근무 코드 체계.
 *
 * 표에 인쇄되는 원문(raw)과, 앱이 다루는 근무 종류(ShiftKind)를 분리한다.
 * 매핑은 아래 표 하나뿐이므로, 의미가 새로 확인되면 재인식 없이 여기만 고치면 된다.
 */
export type ShiftKind = 'D' | 'E' | 'N' | 'OFF' | 'OTHER' | 'EMPTY'

export const SHIFT_LABEL: Record<ShiftKind, string> = {
  D: 'Day',
  E: 'Evening',
  N: 'Night',
  OFF: 'Off',
  OTHER: '기타',
  EMPTY: '',
}

/** 인계 순환. 오프·기타는 체인에 참여하지 않는다. */
export const CYCLE = ['D', 'E', 'N'] as const
export type CycleSlot = (typeof CYCLE)[number]

export const isCycleSlot = (k: ShiftKind): k is CycleSlot =>
  (CYCLE as readonly string[]).includes(k)

/**
 * 원문 → 근무 종류.
 *
 * 여기에 없는 코드는 `OTHER` 가 되고 원문은 그대로 보존된다.
 * 미확정: `83`(8시–3시 상근), `자1`, `⟋`(손으로 그은 취소선)
 */
export const CODE_MAP: Record<string, ShiftKind> = {
  'D': 'D',
  'E': 'E',
  'N': 'N',
  '//': 'OFF',
  '연': 'OFF',    // 연차
  '건': 'OFF',    // 보건휴가
  '공': 'OFF',    // 공가
  '감노': 'OFF',
  '술24': 'OFF',  // 술기 교육
  '술7': 'OFF',
  '': 'EMPTY',
}

export interface ParsedCode {
  kind: ShiftKind
  /** 코드와 분리해 보존하는 표시 */
  flags: string[]
}

/**
 * 인쇄된 원문을 근무 종류로 해석한다.
 *
 * `*` 는 오프 표시다 — **단 `D*` `E*` `N*` 는 근무 그대로 취급한다.**
 * 그래서 별표를 떼고 기본 코드를 먼저 해석한 뒤, 3교대가 아니면 오프로 덮어쓴다.
 * 별표 자체는 플래그로 남겨 원본 정보를 잃지 않는다.
 */
export function parseCode(raw: string): ParsedCode {
  const text = raw.trim()
  if (text === '⟋') return { kind: 'OTHER', flags: ['STRUCK_OUT'] }

  const starred = text.endsWith('*')
  const base = starred ? text.slice(0, -1).trim() : text
  const flags = starred ? ['ASTERISK'] : []

  const kind = CODE_MAP[base] ?? 'OTHER'
  if (starred && kind !== 'EMPTY' && !isCycleSlot(kind)) {
    return { kind: 'OFF', flags }
  }
  return { kind, flags }
}
