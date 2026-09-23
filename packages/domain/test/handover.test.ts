import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  addDays, buildRoster, daysInMonth, handover, isoDate, monthOf, onShift,
  parseCode, RosterIndex, summarize, weekdayKo,
  type RosterInput, type ShiftKind,
} from '../src/index'

/** D E N // 을 한 줄 문자열로 적어 근무표를 만든다 */
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

describe('parseCode — 근무 코드 해석', () => {
  test('3교대와 오프', () => {
    assert.equal(parseCode('D').kind, 'D')
    assert.equal(parseCode('E').kind, 'E')
    assert.equal(parseCode('N').kind, 'N')
    assert.equal(parseCode('//').kind, 'OFF')
  })

  test('휴가류는 전부 오프', () => {
    for (const raw of ['연', '건', '공', '감노', '술24']) {
      assert.equal(parseCode(raw).kind, 'OFF', raw)
    }
  })

  test('별표는 오프 — 단 D*·E*·N* 는 근무', () => {
    assert.equal(parseCode('//*').kind, 'OFF')
    assert.equal(parseCode('건*').kind, 'OFF')
    assert.equal(parseCode('83*').kind, 'OFF')
    assert.equal(parseCode('D*').kind, 'D')
    assert.equal(parseCode('E*').kind, 'E')
    assert.equal(parseCode('N*').kind, 'N')
  })

  test('별표는 지우지 않고 플래그로 남긴다', () => {
    assert.deepEqual(parseCode('D*').flags, ['ASTERISK'])
    assert.deepEqual(parseCode('D').flags, [])
  })

  test('모르는 코드는 버리지 않고 OTHER 로 둔다', () => {
    assert.equal(parseCode('83').kind, 'OTHER')
    assert.equal(parseCode('자1').kind, 'OTHER')
  })

  test('손으로 그은 사선은 취소 표시', () => {
    assert.deepEqual(parseCode('⟋'), { kind: 'OTHER', flags: ['STRUCK_OUT'] })
  })
})

describe('calendar', () => {
  test('2026년 9월은 30일까지이고 1일은 화요일', () => {
    assert.equal(daysInMonth(2026, 9), 30)
    assert.equal(weekdayKo('2026-09-01'), '화')
  })
  test('월 경계를 넘어 날짜를 더한다', () => {
    assert.equal(addDays('2026-09-30', 1), '2026-10-01')
    assert.equal(addDays('2026-09-01', -1), '2026-08-31')
  })
})

describe('handover — 인수인계 체인', () => {
  const index = roster({
    // 나: 1일 D, 2일 E, 3일 N
    '000001': `D E N ${repeat(['//'], 27)}`,
    // 전날 야간 → 1일 D 의 이전 근무자
    '000002': `N // // ${repeat(['//'], 27)}`,
    '000003': `D E N ${repeat(['//'], 27)}`,
    '000004': `E N D ${repeat(['//'], 27)}`,
    '000005': `N D E ${repeat(['//'], 27)}`,
  })

  test('Day 는 전날 Night 에게 인계받고 같은 날 Evening 에게 넘긴다', () => {
    const h = handover(index, '000001', '2026-09-01')!
    assert.equal(h.slot, 'D')
    assert.equal(h.previous.slot, 'N')
    assert.equal(h.previous.date, '2026-08-31')
    assert.equal(h.next.slot, 'E')
    assert.equal(h.next.date, '2026-09-01')
  })

  test('Evening 은 전후가 모두 같은 날이다', () => {
    const h = handover(index, '000001', '2026-09-02')!
    assert.equal(h.previous.date, '2026-09-02')
    assert.equal(h.previous.slot, 'D')
    assert.equal(h.next.date, '2026-09-02')
    assert.equal(h.next.slot, 'N')
  })

  test('Night 은 다음날 Day 에게 넘긴다', () => {
    const h = handover(index, '000001', '2026-09-03')!
    assert.equal(h.previous.date, '2026-09-03')
    assert.equal(h.previous.slot, 'E')
    assert.equal(h.next.date, '2026-09-04')
    assert.equal(h.next.slot, 'D')
  })

  test('동시간 근무자에 자기 자신은 넣지 않는다', () => {
    const h = handover(index, '000001', '2026-09-01')!
    assert.deepEqual(h.concurrent.workers.map(w => w.nurse.empNo), ['000003'])
  })

  test('오프인 날은 체인이 없다', () => {
    assert.equal(handover(index, '000001', '2026-09-10'), null)
  })

  test('달 밖으로 나가면 빈 목록과 함께 outOfRange 를 알린다', () => {
    const h = handover(index, '000001', '2026-09-01')!
    assert.equal(h.previous.outOfRange, true)
    assert.deepEqual(h.previous.workers, [])
    assert.equal(h.concurrent.outOfRange, false)
  })

  test('마지막날 Night 의 다음 근무자도 범위 밖이다', () => {
    const last = roster({ '000001': `${repeat(['//'], 29)} N` })
    const h = handover(last, '000001', '2026-09-30')!
    assert.equal(h.next.date, '2026-10-01')
    assert.equal(h.next.outOfRange, true)
  })

  test('근무자는 근무표 행 순서대로 정렬된다', () => {
    const h = handover(index, '000002', '2026-09-01')!
    assert.equal(h.slot, 'N')
    assert.deepEqual(h.concurrent.workers.map(w => w.nurse.order), [4])
  })
})

describe('요약', () => {
  test('한 사람의 한 달 근무를 세어 준다', () => {
    const index = roster({ '000001': `${repeat(['D', 'E', 'N', '//', '//'], 30)}` })
    const cells = monthOf(index, '000001')
    assert.equal(cells.length, 30)
    const s = summarize(cells)
    assert.equal(s.D, 6)
    assert.equal(s.OFF, 12)
  })
})

describe('onShift — 그 날 한 시간대의 팀 배치', () => {
  test('행 순서대로 팀을 붙이고, 5번째부터 액팅', () => {
    const idx = roster({
      '100001': repeat(['D'], 30), '100002': repeat(['D'], 30), '100003': repeat(['D'], 30),
      '100004': repeat(['D'], 30), '100005': repeat(['D'], 30), '100006': repeat(['E'], 30),
    })
    const d = onShift(idx, '2026-09-03', 'D')
    assert.deepEqual(d.workers.map(w => [w.nurse.empNo, w.team]), [
      ['100001', 'A'], ['100002', 'B'], ['100003', 'C'], ['100004', 'D'], ['100005', 'ACTING'],
    ])
    assert.deepEqual(onShift(idx, '2026-09-03', 'E').workers.map(w => w.team), ['C'])
    assert.equal(onShift(idx, '2026-09-03', 'N').workers.length, 0)
    assert.equal(onShift(idx, '2026-10-01', 'D').outOfRange, true)
  })
})
