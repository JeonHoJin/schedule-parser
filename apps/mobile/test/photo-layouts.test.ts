import { before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { prepareSheet } from '@sp/recognize'
import type { Rgba } from '@sp/vision'
import { fullParse, type FullParseResult } from '../src/experimental/full-parse'
import { rotateRgba } from '../src/experimental/browser-image'

const fixture = (name: string) => fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url))
const november = fixture('roster-2026-11.jpg')
const september = fixture('roster-2026-09.jpg')
const read = (path: string): Rgba => {
  const decoded = jpeg.decode(readFileSync(path), { useTArray: true, formatAsRGBA: true })
  return { ...decoded, data: new Uint8Array(decoded.data) }
}

describe('11월 신청표 — 이전 달 3칸·사번 없음·빈 구분 행', { skip: !existsSync(november) }, () => {
  let parsed: FullParseResult
  before(() => { parsed = fullParse(read(november), { id: 'nov', year: 2026, month: 11, days: 30 }) })

  test('실제 근무자 25명과 정확한 30일을 복원한다', () => {
    assert.equal(parsed.roster.nurses.length, 25)
    assert.equal(parsed.roster.cells.length, 750)
    assert.deepEqual(parsed.sheet.band.columns, Array.from({ length: 30 }, (_, i) => i + 3))
    assert.deepEqual(parsed.sheet.nurseRows, [...Array.from({ length: 24 }, (_, i) => i + 2), 29])
    assert.ok(parsed.cells.every(row => row.length === 30))
    assert.equal(parsed.cells[24][29].raw, 'D')
  })

  test('사번을 만들지 않고, 순번·이전 달 근무가 이름 조각에 섞이지 않는다', () => {
    assert.equal(parsed.sheet.hasEmpno, false)
    assert.ok(parsed.empnos.every(e => e.value === null && !e.needsReview))
    const boxes = parsed.sheet.nurseRows.map(row => parsed.sheet.identityBoxOf(row))
    assert.ok(boxes.every(b => b.empno === null))
    assert.ok(boxes.every(b => b.name.w > 150 && b.name.w < 210))
    assert.ok(boxes.every((b, i) => b.name.x + b.name.w < parsed.sheet.detect.lattice.matrix[parsed.sheet.nurseRows[i]][0].x))
  })

  test('새 템플릿을 만들지 않은 위치에서도 특수 코드와 별표를 보존한다', () => {
    const samples: Array<[number, number, string]> = [
      [3, 2, '연*'], [4, 3, '연*'], [4, 17, '연*'], [4, 10, '//*'],
      [8, 22, '연*'], [8, 23, '연*'], [9, 20, '연*'], [9, 21, '//*'],
      [9, 22, '건*'], [9, 30, '//*'], [11, 9, '건*'], [11, 10, '연*'],
      [11, 11, '연*'], [11, 29, 'D*'], [11, 30, '//*'],
      [13, 7, 'D*'], [13, 8, '연*'], [13, 9, '연*'], [13, 23, '//*'], [13, 25, '연*'],
      [14, 10, 'D*'], [14, 11, '//*'], [18, 2, '건*'], [18, 3, '술24*'],
      [18, 26, '83*'], [18, 30, 'N*'], [19, 14, '건*'], [19, 26, '83*'],
      [20, 20, '술24*'], [20, 26, '83*'], [23, 21, '건*'],
    ]
    for (const [row, day, raw] of samples) {
      const index = parsed.sheet.nurseRows.indexOf(row)
      assert.equal(parsed.cells[index][day - 1].raw, raw, `row ${row}, day ${day}`)
    }
  })

  test('날짜와 요일 헤더 한 칸이 모두 흐려져도 날짜를 옮기지 않는다', () => {
    const image = { ...parsed.sheet.detect.work, data: new Uint8Array(parsed.sheet.detect.work.data) }
    for (const row of [0, 1]) {
      const box = parsed.sheet.detect.lattice.matrix[row][12] // 10일
      for (let y = box.y + 5; y < box.y + box.h - 5; y++) {
        for (let x = box.x + 5; x < box.x + box.w - 5; x++) {
          image.data.fill(255, (y * image.width + x) * 4, (y * image.width + x) * 4 + 4)
        }
      }
    }
    assert.deepEqual(prepareSheet(image, 30).band.columns, parsed.sheet.band.columns)
  })

  test('뒤집힌 사진에서도 같은 날짜와 근무 순서를 유지한다', () => {
    const rotated = fullParse(rotateRgba(read(november), 180), { id: 'nov', year: 2026, month: 11, days: 30 })
    assert.deepEqual(rotated.cells.map(r => r.map(c => c.raw)), parsed.cells.map(r => r.map(c => c.raw)))
  })

  test('끝 날짜의 헤더가 사라져 경계가 모호하면 날짜를 밀지 않고 재확인을 요청한다', () => {
    const image = { ...parsed.sheet.detect.work, data: new Uint8Array(parsed.sheet.detect.work.data) }
    for (const row of [0, 1]) {
      const box = parsed.sheet.detect.lattice.matrix[row][32] // 30일
      for (let y = box.y + 5; y < box.y + box.h - 5; y++) {
        for (let x = box.x + 5; x < box.x + box.w - 5; x++) {
          image.data.fill(255, (y * image.width + x) * 4, (y * image.width + x) * 4 + 4)
        }
      }
    }
    assert.throws(() => prepareSheet(image, 30), /날짜 헤더/)
    assert.throws(() => fullParse(image, { id: 'nov', year: 2026, month: 11, days: 30 }), /날짜 헤더/)
  })

  test('처음에 31일인 달로 추정해도 제목 OCR 에 필요한 정상 격자는 복원한다', () => {
    const guessed = fullParse(read(november), { id: 'guess', year: 2026, month: 10, days: 31 })
    assert.equal(guessed.sheet.days, 30)
    assert.equal(guessed.sheet.dateHeaderConfirmed, true)
    assert.deepEqual(guessed.sheet.band.columns, parsed.sheet.band.columns)
    assert.equal(guessed.sheet.nurseRows.length, 25)
  })
})

test('9월 기존 사번 양식과 기존 라벨은 새 글자 템플릿을 추가해도 유지된다', {
  skip: !existsSync(september) || !existsSync(fixture('labels-2026-09.json')),
}, () => {
  const parsed = fullParse(read(september), { id: 'sep', year: 2026, month: 9, days: 30 })
  assert.equal(parsed.sheet.hasEmpno, true)
  assert.equal(parsed.roster.nurses.length, 31)
  assert.deepEqual(parsed.sheet.band.columns, Array.from({ length: 30 }, (_, i) => i + 1))
  const { labels } = JSON.parse(readFileSync(fixture('labels-2026-09.json'), 'utf8'))
  for (const label of labels) assert.equal(parsed.cells[label.row - 2][label.day - 1].raw, label.raw)
})
