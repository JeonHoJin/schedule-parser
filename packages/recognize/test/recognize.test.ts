import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import type { Rgba } from '@sp/vision'
import {
  buildTemplates, prepareSheet, readSheet,
  type CellLabel, type PreparedSheet, type SheetCell,
} from '../src/index'

const FIXTURE = fileURLToPath(new URL('../../../fixtures/roster-2026-09.jpg', import.meta.url))
const LABELS = fileURLToPath(new URL('../../../fixtures/labels-2026-09.json', import.meta.url))

const EXPECTED = {
  days: 30,
  nurses: 31,
  /** 근무 셀이 전부 비어 있는 간호사 (휴직·미배치로 추정) */
  inactiveNurses: 5,
  /** 본인: 격자에서 위에서 7번째 간호사 = 행 8 */
  meRow: 8,
} as const

let sheet: PreparedSheet
let cells: SheetCell[][]

before(() => {
  const raw = jpeg.decode(readFileSync(FIXTURE), { useTArray: true, formatAsRGBA: true })
  const img: Rgba = { width: raw.width, height: raw.height, data: new Uint8Array(raw.data) }
  const labels = (JSON.parse(readFileSync(LABELS, 'utf8')) as { labels: CellLabel[] }).labels
  sheet = prepareSheet(img, EXPECTED.days)
  cells = readSheet(sheet, buildTemplates(sheet, labels))
})

describe('readSheet — 셀 인식', () => {
  test('간호사 31명 × 30일을 모두 읽는다', () => {
    assert.equal(cells.length, EXPECTED.nurses)
    for (const row of cells) assert.equal(row.length, EXPECTED.days)
  })

  test('빈 칸은 정확히 휴직자 5명 × 30일이다', () => {
    const empty = cells.flat().filter(c => c.kind === 'EMPTY')
    assert.equal(empty.length, EXPECTED.inactiveNurses * EXPECTED.days)
    // 그리고 그 빈 칸들은 마지막 5개 행에 몰려 있어야 한다
    const rows = new Set(empty.map(c => c.row))
    assert.equal(rows.size, EXPECTED.inactiveNurses)
  })

  test('저신뢰 셀이 5% 미만이다', () => {
    const low = cells.flat().filter(c => c.kind !== 'EMPTY' && (c.score < 0.8 || c.margin < 0.06))
    const pct = low.length / (EXPECTED.nurses * EXPECTED.days)
    assert.ok(pct < 0.05, `저신뢰 ${low.length}개 (${(pct * 100).toFixed(1)}%)`)
  })

  test('D·E·N·OFF 가 근무 셀의 대부분을 차지한다', () => {
    const active = cells.flat().filter(c => c.kind !== 'EMPTY')
    const core = active.filter(c => ['D', 'E', 'N', 'OFF'].includes(c.kind))
    assert.ok(core.length / active.length > 0.9,
      `핵심 코드 비율 ${(core.length / active.length * 100).toFixed(1)}%`)
  })

  test('원문(raw)을 보존한다 — 의미를 모르는 코드도 버리지 않는다', () => {
    const others = cells.flat().filter(c => c.kind === 'OTHER')
    assert.ok(others.length > 0)
    for (const c of others) assert.ok(c.raw.length > 0, `row${c.row} day${c.day} 원문 유실`)
  })
})

// 인수인계 체인의 형광펜 교차검증은 pipeline.test.ts 에서 도메인 API 를 통해 수행한다.
