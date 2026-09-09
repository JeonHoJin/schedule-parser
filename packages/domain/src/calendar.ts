/** 달력 유틸 — 타임존에 휘둘리지 않도록 전부 UTC 로 계산한다 */

export type IsoDate = string // yyyy-mm-dd

export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate()

export const isoDate = (year: number, month: number, day: number): IsoDate =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

export function addDays(date: IsoDate, delta: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + delta))
  return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

/** 0 = 월요일 … 6 = 일요일 (근무표의 요일 행과 같은 순서) */
export function weekdayIndex(date: IsoDate): number {
  const [y, m, d] = date.split('-').map(Number)
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

export const WEEKDAY_KO = ['월', '화', '수', '목', '금', '토', '일'] as const

export const weekdayKo = (date: IsoDate): string => WEEKDAY_KO[weekdayIndex(date)]
