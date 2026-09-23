/**
 * 저장된 근무표를 고치는 순수 함수들. 화면은 결과를 saveRoster 로 저장만 한다.
 */
import type { IsoDate, Nurse, Roster, ShiftKind } from '@sp/domain'
import type { LocalRoster } from './data'

export const MAX_OTHER_LABEL = 10

/** 한 사람의 하루 근무를 바꾼다. 직접 고친 칸은 신뢰도 1, `edited` 로 표시한다. */
export function editCell(data: LocalRoster, nurseId: string, date: IsoDate, kind: ShiftKind, label = ''): LocalRoster {
  const text = label.trim().slice(0, MAX_OTHER_LABEL)
  if (kind === 'OTHER' && !text) throw new Error('기타 근무의 표기를 입력해 주세요.')
  const raw = kind === 'OTHER' ? text : kind === 'EMPTY' ? '' : kind
  let found = false
  const cells = data.roster.cells.map(c => {
    if (c.nurseId !== nurseId || c.date !== date) return c
    found = true
    return { ...c, kind, raw, edited: true, confidence: 1 }
  })
  if (!found) throw new Error('해당 근무 칸을 찾지 못했습니다.')
  return { ...data, roster: { ...data.roster, cells } }
}

function sameNurse(me: Nurse, candidates: Nurse[]): Nurse | undefined {
  const empNo = me.empNo.trim()
  if (empNo) {
    const byEmpNo = candidates.find(n => n.empNo.trim() === empNo)
    if (byEmpNo) return byEmpNo
  }
  const name = me.name?.trim()
  if (!name) return undefined
  const byName = candidates.filter(n => n.name?.trim() === name)
  return byName.length === 1 ? byName[0] : undefined
}

/**
 * 새 근무표에서 "내 이름"을 이전 근무표와 같은 사람으로 맞춘다.
 * 같은 달을 덮어쓰는 경우 그 근무표의 설정을 먼저 보고, 그다음 최근 달부터 본다.
 * 사번이 같으면 같은 사람, 사번이 없으면 이름이 딱 한 명과 같을 때만 같은 사람으로 본다.
 */
export function carryMyNurse(next: Roster, saved: LocalRoster[]): string | undefined {
  const ordered = [...saved].sort((a, b) =>
    Number(b.roster.id === next.id) - Number(a.roster.id === next.id)
    || b.roster.year - a.roster.year || b.roster.month - a.roster.month)
  for (const item of ordered) {
    const me = item.roster.nurses.find(n => n.id === item.settings.myNurseId)
    if (!me) continue
    const match = sameNurse(me, next.nurses)
    if (match) return match.id
  }
  return undefined
}
