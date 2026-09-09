import { RosterIndex, type Roster, type Settings } from '@sp/domain'
import { createContext, useContext } from 'react'

export interface ReviewItem {
  empnos: Array<{ row: number; read: string | null }>
  cells: Array<{ row: number; day: number; raw: string; score: number }>
}

export interface LocalRoster {
  roster: Roster
  settings: Settings
  review: ReviewItem
}

export const RosterContext = createContext<LocalRoster | null>(null)

export function useRoster() {
  const data = useContext(RosterContext)
  if (!data) throw new Error('No roster selected')
  const me = data.roster.nurses.find(n => n.id === data.settings.myNurseId)
  if (!me) throw new Error('No nurse selected')
  return { ...data, index: new RosterIndex(data.roster), me }
}

/** 사람을 화면에 표시할 이름. 이름을 아직 등록하지 않았으면 사번으로 보여준다. */
export const displayName = (n: { name?: string; empNo: string }): string =>
  n.name?.trim() || (n.empNo ? `사번 ${n.empNo}` : '(미확인)')
