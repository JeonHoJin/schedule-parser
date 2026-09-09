import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import type { Rgba } from '@sp/vision'
import {
  buildRoster, handover, isoDate, monthOf, RosterIndex,
  type Roster,
} from '@sp/domain'
import { parseRoster, type CellLabel, type EmpnoReading, type ParseResult } from '../src/index'

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url))

const EXPECTED = {
  year: 2026, month: 9, days: 30,
  nurses: 31,
  /** 주황 형광펜으로 표시된 간호사의 정답지 인덱스. */
  meIndex: 6,
} as const

let parsed: ParseResult
let roster: Roster
let index: RosterIndex
let truth: { digits: number; empnos: string[]; templateRows: number[] }

before(() => {
  const raw = jpeg.decode(readFileSync(at('../../../fixtures/roster-2026-09.jpg')),
    { useTArray: true, formatAsRGBA: true })
  const img: Rgba = { width: raw.width, height: raw.height, data: new Uint8Array(raw.data) }
  const labels: { labels: CellLabel[] } =
    JSON.parse(readFileSync(at('../../../fixtures/labels-2026-09.json'), 'utf8'))
  truth = JSON.parse(readFileSync(at('../../../fixtures/empno-2026-09.json'), 'utf8'))

  parsed = parseRoster(img, {
    id: 'test', year: EXPECTED.year, month: EXPECTED.month,
    cellLabels: labels.labels,
    empnoLabels: truth.templateRows.map(row => ({ row, empNo: truth.empnos[row - 2] })),
    knownEmpnos: truth.empnos,
    digits: truth.digits,
  })
  roster = buildRoster(parsed.rosterInput)
  index = new RosterIndex(roster)
})

describe('사번 인식', () => {
  const nonTemplate = (e: EmpnoReading) => !truth.templateRows.includes(e.row)

  test('모든 행에서 사번을 6자리로 분할한다', () => {
    assert.equal(parsed.empnos.length, EXPECTED.nurses)
    for (const e of parsed.empnos) {
      assert.ok(e.read === null || e.read.length === truth.digits, `row${e.row}: ${e.read}`)
    }
  })

  test('명단 대조 후 28명 이상을 정확히 붙인다', () => {
    const correct = parsed.empnos.filter((e, i) => e.value === truth.empnos[i]).length
    assert.ok(correct >= 28, `정확히 붙인 사번 ${correct}/${EXPECTED.nurses}`)
  })

  test('⭐ 사람을 잘못 붙이지 않는다 — 확신이 없으면 사용자에게 넘긴다', () => {
    const wrong = parsed.empnos.filter((e, i) => e.value !== null && e.value !== truth.empnos[i])
    assert.deepEqual(wrong.map(e => `row${e.row}: ${e.value}`), [],
      '잘못 붙인 사번이 있으면 다른 사람의 근무를 내 것으로 보여주게 된다')
  })

  test('템플릿을 만든 행은 당연히 맞는다 (자기 검증)', () => {
    for (const row of truth.templateRows) {
      const e = parsed.empnos.find(x => x.row === row)!
      assert.equal(e.value, truth.empnos[row - 2])
    }
  })

  test('템플릿을 만들지 않은 행도 대부분 맞는다', () => {
    const others = parsed.empnos.filter(nonTemplate)
    const correct = others.filter(e => e.value === truth.empnos[e.row - 2]).length
    assert.ok(correct / others.length > 0.85,
      `템플릿 외 정확도 ${correct}/${others.length}`)
  })
})

describe('Roster — 도메인 모델 조립', () => {
  test('간호사 31명 × 30일이 모두 들어간다', () => {
    assert.equal(roster.nurses.length, EXPECTED.nurses)
    assert.equal(roster.cells.length, EXPECTED.nurses * EXPECTED.days)
  })

  test('사번으로 사람을 찾을 수 있다', () => {
    const me = index.byEmpNo(truth.empnos[EXPECTED.meIndex])
    assert.ok(me, '본인을 사번으로 찾지 못함')
    assert.equal(monthOf(index, me.id).length, EXPECTED.days)
  })

  test('근무표가 덮는 날짜 범위가 그 달과 일치한다', () => {
    assert.equal(index.firstDate, '2026-09-01')
    assert.equal(index.lastDate, '2026-09-30')
    assert.ok(!index.covers('2026-08-31'))
    assert.ok(!index.covers('2026-10-01'))
  })
})

/**
 * 형광펜 교차검증 — 이번에는 **도메인 API 를 통해서** 한다.
 *
 * 앞선 테스트가 인식 결과를 직접 비교했다면, 여기서는 실제 앱이 호출할 `handover()` 의
 * 출력을 사용자가 종이에 칠해둔 표시와 대조한다. 사진 한 장에서 화면에 보여줄
 * 데이터까지, 전 구간이 한 번에 검증된다.
 */
describe('handover — 형광펜 정답지 대조 (전 구간)', () => {
  const marked = (color: 'pink' | 'yellow', meRow: number) =>
    new Set(parsed.cells.flat()
      .filter(c => c.highlight === color && c.row !== meRow)
      .map(c => `${c.row}:${c.day}`))

  const meRow = () => {
    const counts = new Map<number, number>()
    for (const c of parsed.cells.flat()) {
      if (c.highlight === 'orange') counts.set(c.row, (counts.get(c.row) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  }

  const key = (nurseId: string, date: string) => {
    const nurse = roster.nurses.find(n => n.id === nurseId)!
    return `${nurse.order + 2}:${Number(date.slice(-2))}`
  }

  test('주황 형광펜으로 본인을 특정하면 정답지 사번과 일치한다', () => {
    const me = roster.nurses[meRow() - 2]
    assert.equal(me.empNo, truth.empnos[EXPECTED.meIndex])
  })

  test('⭐ 동시간 근무자가 손으로 칠한 칸과 완전히 일치한다', () => {
    const row = meRow()
    const me = roster.nurses[row - 2]
    const computed = new Set<string>()
    for (let day = 1; day <= EXPECTED.days; day++) {
      const h = handover(index, me.id, isoDate(EXPECTED.year, EXPECTED.month, day))
      if (!h) continue
      for (const w of h.concurrent.workers) computed.add(key(w.nurse.id, h.concurrent.date))
    }
    const pink = marked('pink', row)
    assert.ok(pink.size > 50)
    assert.deepEqual([...pink].filter(k => !computed.has(k)), [], '칠했는데 계산에 없음')
    assert.deepEqual([...computed].filter(k => !pink.has(k)), [], '계산했는데 칠하지 않음')
  })

  test('다음시간 근무자가 손으로 칠한 칸을 모두 포함한다', () => {
    // 사용자는 하루에 한 명(실제 인계 담당)만 칠했다. 앱은 그 시간대 전원을 보여주므로
    // 계산 결과가 더 넓다 — 칠한 칸이 전부 포함되는지만 본다.
    const row = meRow()
    const me = roster.nurses[row - 2]
    const computed = new Set<string>()
    for (let day = 1; day <= EXPECTED.days; day++) {
      const h = handover(index, me.id, isoDate(EXPECTED.year, EXPECTED.month, day))
      if (!h || h.next.outOfRange) continue
      for (const w of h.next.workers) computed.add(key(w.nurse.id, h.next.date))
    }
    const yellow = marked('yellow', row)
    assert.ok(yellow.size > 10)
    assert.deepEqual([...yellow].filter(k => !computed.has(k)), [])
  })
})
