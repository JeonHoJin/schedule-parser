import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  assignTeams, buildRoster, daysInMonth, handover, parseCode, RosterIndex,
  teamFor, type RosterInput,
} from '../src/index'

describe('teamFor — 순위·인원수·근무 종류로 팀 결정', () => {
  test('4팀 데이 매핑', () => {
    assert.equal(teamFor(1, 'D', 4), 'A')
    assert.equal(teamFor(2, 'D', 4), 'B')
    assert.equal(teamFor(3, 'D', 4), 'C')
    assert.equal(teamFor(4, 'D', 4), 'D')
    assert.equal(teamFor(5, 'D', 5), 'ACTING')
  })

  test('4팀 이브닝은 C, D, A, B 순서', () => {
    assert.equal(teamFor(1, 'E', 4), 'C')
    assert.equal(teamFor(2, 'E', 4), 'D')
    assert.equal(teamFor(3, 'E', 4), 'A')
    assert.equal(teamFor(4, 'E', 4), 'B')
  })

  test('4팀 나이트는 B, A, D, C 순서', () => {
    assert.equal(teamFor(1, 'N', 4), 'B')
    assert.equal(teamFor(2, 'N', 4), 'A')
    assert.equal(teamFor(3, 'N', 4), 'D')
    assert.equal(teamFor(4, 'N', 4), 'C')
  })

  test('나이트가 정확히 3명이면 3팀 체제 — A, C, B', () => {
    assert.equal(teamFor(1, 'N', 3), 'A')
    assert.equal(teamFor(2, 'N', 3), 'C')
    assert.equal(teamFor(3, 'N', 3), 'B')
  })

  test('데이·이브닝이 3명이어도 4팀 체제를 유지한다', () => {
    // 3팀 체제는 나이트에만 적용된다
    assert.equal(teamFor(1, 'D', 3), 'A')
    assert.equal(teamFor(1, 'E', 3), 'C')
  })

  test('순위가 0 이하면 액팅', () => {
    assert.equal(teamFor(0, 'D', 5), 'ACTING')
    assert.equal(teamFor(-1, 'N', 4), 'ACTING')
  })
})

describe('assignTeams — 배열 매핑', () => {
  test('행 순서대로 팀을 붙인다', () => {
    assert.deepEqual(assignTeams([{}, {}, {}, {}], 'D'), ['A', 'B', 'C', 'D'])
    assert.deepEqual(assignTeams([{}, {}, {}], 'N'), ['A', 'C', 'B'])
    assert.deepEqual(
      assignTeams([{}, {}, {}, {}, {}], 'E'),
      ['C', 'D', 'A', 'B', 'ACTING'],
    )
  })
})

/** D/E/N/// 를 한 줄로 적어 근무표를 만드는 헬퍼. handover.test.ts 와 동일 형식. */
function roster(rows: Record<string, string>, year = 2026, month = 9) {
  const total = daysInMonth(year, month)
  const input: RosterInput = {
    id: 'test', year, month,
    people: Object.keys(rows).map(empNo => ({ empNo })),
    grid: Object.values(rows).map(line => {
      const codes = line.trim().split(/\s+/)
      assert.equal(codes.length, total, `근무 개수가 ${total}이어야 함`)
      return codes.map(raw => {
        const p = parseCode(raw)
        return { raw, kind: p.kind, flags: p.flags, confidence: 1 }
      })
    }),
  }
  return new RosterIndex(buildRoster(input))
}

const repeat = (pattern: string[], n: number) =>
  Array.from({ length: n }, (_, i) => pattern[i % pattern.length]).join(' ')

describe('handover — 팀·인계 상대', () => {
  // 데이 4명, 각자 A/B/C/D 팀이 되도록 사번(=행 순서) 배치
  const index = roster({
    '000001': `D ${repeat(['//'], 29)}`,   // D 1순위 → A팀
    '000002': `D ${repeat(['//'], 29)}`,   // D 2순위 → B팀
    '000003': `D ${repeat(['//'], 29)}`,   // D 3순위 → C팀
    '000004': `D E ${repeat(['//'], 28)}`, // D 4순위 → D팀, 다음날 이브닝
  })

  test('내 팀과 함께 근무자 팀이 계산된다', () => {
    const h = handover(index, '000001', '2026-09-01')!
    assert.equal(h.myTeam, 'A')
    // 동시간에는 나를 제외한 3명이 남고, 그들의 팀은 원래 순위에 따라 붙는다
    const teams = h.concurrent.workers.map(w => ({ id: w.nurse.empNo, team: w.team, rank: w.rank }))
    assert.deepEqual(teams, [
      { id: '000002', team: 'B', rank: 2 },
      { id: '000003', team: 'C', rank: 3 },
      { id: '000004', team: 'D', rank: 4 },
    ])
  })

  test('나 자신을 제외해도 남은 사람의 팀 순위는 원본 순서를 유지한다', () => {
    const h = handover(index, '000002', '2026-09-01')!
    assert.equal(h.myTeam, 'B')
    const ranks = h.concurrent.workers.map(w => w.rank)
    // 나(2순위)가 빠지고 1, 3, 4순위가 남는다
    assert.deepEqual(ranks, [1, 3, 4])
  })
})
