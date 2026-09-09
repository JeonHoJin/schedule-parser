import { daysInMonth, isoDate, type IsoDate } from './calendar'
import type { Nurse, Roster, ShiftCell } from './types'

/** 조회를 빠르게 하기 위한 색인. 근무표는 한 번 만들면 잘 바뀌지 않으므로 미리 만들어 둔다. */
export class RosterIndex {
  private byNurseDate = new Map<string, ShiftCell>()
  private byDate = new Map<IsoDate, ShiftCell[]>()
  private nurseById = new Map<string, Nurse>()

  constructor(readonly roster: Roster) {
    for (const n of roster.nurses) this.nurseById.set(n.id, n)
    for (const c of roster.cells) {
      this.byNurseDate.set(`${c.nurseId}|${c.date}`, c)
      const list = this.byDate.get(c.date)
      if (list) list.push(c)
      else this.byDate.set(c.date, [c])
    }
  }

  get firstDate(): IsoDate { return isoDate(this.roster.year, this.roster.month, 1) }
  get lastDate(): IsoDate {
    return isoDate(this.roster.year, this.roster.month,
      daysInMonth(this.roster.year, this.roster.month))
  }
  covers(date: IsoDate): boolean {
    return date >= this.firstDate && date <= this.lastDate
  }

  nurse(id: string): Nurse | undefined { return this.nurseById.get(id) }
  cell(nurseId: string, date: IsoDate): ShiftCell | undefined {
    return this.byNurseDate.get(`${nurseId}|${date}`)
  }
  onDate(date: IsoDate): ShiftCell[] { return this.byDate.get(date) ?? [] }

  /** 사번으로 사람 찾기 — 달이 바뀌어도 사람을 잇는 경로 */
  byEmpNo(empNo: string): Nurse | undefined {
    return this.roster.nurses.find(n => n.empNo === empNo)
  }
}

export interface RosterInput {
  id: string
  ward?: string
  year: number
  month: number
  printedAt?: string
  sourceImage?: string
  /** 행 순서대로. 사번을 못 읽었으면 empNo 를 비워 둔다. */
  people: Array<{ empNo: string; name?: string }>
  /** [행][일자-1] — 인식 결과 */
  grid: Array<Array<{
    raw: string
    kind: ShiftCell['kind']
    flags: string[]
    confidence: number
  }>>
}

export function buildRoster(input: RosterInput): Roster {
  const total = daysInMonth(input.year, input.month)
  const nurses: Nurse[] = input.people.map((p, i) => ({
    id: p.empNo || `row${i}`,
    empNo: p.empNo,
    name: p.name,
    order: i,
  }))

  const cells: ShiftCell[] = []
  nurses.forEach((nurse, i) => {
    const row = input.grid[i] ?? []
    for (let day = 1; day <= total; day++) {
      const c = row[day - 1]
      if (!c) continue
      cells.push({
        nurseId: nurse.id,
        date: isoDate(input.year, input.month, day),
        raw: c.raw,
        kind: c.kind,
        flags: c.flags,
        confidence: c.confidence,
        edited: false,
      })
    }
  })

  return {
    id: input.id, ward: input.ward,
    year: input.year, month: input.month,
    printedAt: input.printedAt, sourceImage: input.sourceImage,
    nurses, cells,
  }
}
