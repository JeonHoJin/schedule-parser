import type { ShiftKind } from '@sp/domain'

export const color = {
  bg: '#F7F7F8',
  card: '#FFFFFF',
  line: '#E6E6EA',
  text: '#17171A',
  muted: '#8A8A91',
  faint: '#B9B9C0',
  accent: '#2C6BED',
} as const

/** 근무 종류별 색. 달력 배지와 상세 화면이 같은 색을 쓴다. */
export const shiftColor: Record<ShiftKind, { fg: string; bg: string }> = {
  D: { fg: '#0B5CC4', bg: '#DCEBFF' },   // Day — 파랑
  E: { fg: '#B4560A', bg: '#FFE9D2' },   // Evening — 주황
  N: { fg: '#3B2C86', bg: '#E4E0FA' },   // Night — 남색
  OFF: { fg: '#8A8A91', bg: '#F0F0F2' },
  OTHER: { fg: '#5C5C63', bg: '#EDEDEF' },
  EMPTY: { fg: '#C9C9CE', bg: 'transparent' },
}

export const space = (n: number) => n * 4
