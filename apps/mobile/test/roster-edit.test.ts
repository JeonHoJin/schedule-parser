import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import type { Nurse, Roster, ShiftKind } from '@sp/domain'
import { carryMyNurse, editCell } from '../src/roster-edit'
import type { LocalRoster } from '../src/data'

const nurse = (id: string, empNo: string, name: string, order: number): Nurse => ({ id, empNo, name, order })

function roster(id: string, year: number, month: number, nurses: Nurse[]): Roster {
  const cells = nurses.flatMap(n => [1, 2].map(d => ({
    nurseId: n.id, date: `${year}-${String(month).padStart(2, '0')}-0${d}`,
    raw: 'D', kind: 'D' as ShiftKind, flags: [], confidence: 0.5, edited: false,
  })))
  return { id, year, month, ward: '', nurses, cells }
}

const local = (r: Roster, myNurseId?: string): LocalRoster => ({
  roster: r, settings: { myNurseId, reviewThreshold: 0.8 }, review: { empnos: [], cells: [] },
})

describe('근무 수정', () => {
  const base = local(roster('r', 2026, 9, [nurse('111111', '111111', '가나다', 0), nurse('222222', '222222', '라마바', 1)]))

  test('한 사람의 하루만 바꾸고, 직접 고친 칸으로 표시한다', () => {
    const next = editCell(base, '222222', '2026-09-02', 'N')
    const changed = next.roster.cells.filter(c => c.edited)
    assert.equal(changed.length, 1)
    assert.deepEqual(changed[0], { nurseId: '222222', date: '2026-09-02', raw: 'N', kind: 'N', flags: [], confidence: 1, edited: true })
    assert.equal(base.roster.cells.some(c => c.edited), false, '원본은 그대로')
  })

  test('기타는 표기를 받고, 비움은 표기를 지운다', () => {
    assert.equal(editCell(base, '111111', '2026-09-01', 'OTHER', ' 교육 ').roster.cells[0].raw, '교육')
    assert.throws(() => editCell(base, '111111', '2026-09-01', 'OTHER', '  '))
    assert.equal(editCell(base, '111111', '2026-09-01', 'EMPTY').roster.cells[0].raw, '')
    assert.throws(() => editCell(base, 'nobody', '2026-09-01', 'D'))
  })
})

describe('내 이름 이어받기', () => {
  const sep = local(roster('2026-09', 2026, 9, [nurse('111111', '111111', '가나다', 0), nurse('222222', '222222', '라마바', 1)]), '222222')

  test('사번이 같은 사람을 찾는다', () => {
    const oct = roster('2026-10', 2026, 10, [nurse('222222', '222222', '', 0), nurse('333333', '333333', '사아자', 1)])
    assert.equal(carryMyNurse(oct, [sep]), '222222')
  })

  test('사번이 없으면 이름이 한 명과만 같을 때 고른다', () => {
    const noEmp = local(roster('2026-08', 2026, 8, [nurse('a', '', '라마바', 0)]), 'a')
    const oct = roster('2026-10', 2026, 10, [nurse('x', '', '라마바', 0), nurse('y', '', '사아자', 1)])
    assert.equal(carryMyNurse(oct, [noEmp]), 'x')
    const twins = roster('2026-10', 2026, 10, [nurse('x', '', '라마바', 0), nurse('y', '', '라마바', 1)])
    assert.equal(carryMyNurse(twins, [noEmp]), undefined)
  })

  test('최근 달을 먼저, 같은 달을 덮어쓰면 그 근무표를 먼저 본다', () => {
    const aug = local(roster('2026-08', 2026, 8, [nurse('111111', '111111', '가나다', 0)]), '111111')
    const oct = roster('2026-10', 2026, 10, [nurse('111111', '111111', '가나다', 0), nurse('222222', '222222', '라마바', 1)])
    assert.equal(carryMyNurse(oct, [aug, sep]), '222222', '9월이 8월보다 최근')
    const oldOct = local(roster('2026-10', 2026, 10, [nurse('111111', '111111', '가나다', 0)]), '111111')
    assert.equal(carryMyNurse(oct, [sep, oldOct]), '111111', '덮어쓰는 같은 달 설정 우선')
    assert.equal(carryMyNurse(oct, [local(sep.roster)]), undefined, '설정된 근무표가 없으면 비워 둔다')
  })
})
