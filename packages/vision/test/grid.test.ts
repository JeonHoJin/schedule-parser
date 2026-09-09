import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { detectGrid, locateBand, type DetectResult, type Rgba } from '../src/index'

const FIXTURE = fileURLToPath(new URL('../../../fixtures/roster-2026-09.jpg', import.meta.url))

/** 2026년 9월 근무표의 알려진 구조 */
const EXPECTED = {
  rows: 33,        // 일자 헤더 + 요일 헤더 + 간호사 31명
  cols: 43,        // 사번 1 + 일자 30 + 집계 12  (성명 열은 표 바깥 경계라 미검출)
  days: 30,        // 2026-09 는 30일까지
  nurses: 31,
} as const

let result: DetectResult
let columnCenters: number[]
let columnWeights: number[]

before(() => {
  const raw = jpeg.decode(readFileSync(FIXTURE), { useTArray: true, formatAsRGBA: true })
  const img: Rgba = { width: raw.width, height: raw.height, data: new Uint8Array(raw.data) }
  result = detectGrid(img)

  // 열끼리 비교할 때는 반드시 공통 기준선에서 평가한 colAnchors 를 쓴다
  columnCenters = result.lattice.colAnchors
  columnWeights = []
  for (let c = 0; c < result.lattice.cols; c++) {
    columnWeights.push(result.lattice.matrix.filter(row => row[c].detected).length)
  }
})

describe('detectGrid — 실제 근무표 사진', () => {
  test('표를 가로 방향으로 정렬한다', () => {
    assert.ok(result.work.width > result.work.height)
  })

  test('행과 열 개수를 정확히 복원한다', () => {
    assert.equal(result.lattice.rows, EXPECTED.rows)
    assert.equal(result.lattice.cols, EXPECTED.cols)
  })

  test('격자의 모든 칸이 채워진다 (검출 또는 보간)', () => {
    for (let r = 0; r < result.lattice.rows; r++) {
      for (let c = 0; c < result.lattice.cols; c++) {
        assert.ok(result.lattice.matrix[r][c], `빈 칸 (${r}, ${c})`)
      }
    }
  })

  test('검출 비율이 80% 이상이다', () => {
    const cells = result.lattice.matrix.flat()
    const ratio = cells.filter(c => c.detected).length / cells.length
    assert.ok(ratio > 0.8, `검출 비율 ${(ratio * 100).toFixed(1)}%`)
  })

  test('모든 셀 박스가 작업 이미지 안에 있고 크기가 유효하다', () => {
    for (const cell of result.lattice.matrix.flat()) {
      assert.ok(cell.w > 0 && cell.h > 0)
      assert.ok(cell.x > -cell.w && cell.y > -cell.h)
      assert.ok(cell.x < result.work.width && cell.y < result.work.height)
    }
  })

  test('행은 위에서 아래로, 열은 왼쪽에서 오른쪽으로 정렬된다', () => {
    const { rowAnchors, colAnchors } = result.lattice
    for (let i = 1; i < rowAnchors.length; i++) {
      assert.ok(rowAnchors[i] > rowAnchors[i - 1], `행 ${i}`)
    }
    for (let i = 1; i < colAnchors.length; i++) {
      assert.ok(colAnchors[i] > colAnchors[i - 1], `열 ${i}`)
    }
  })

  test('일자 열의 간격이 균일하다 (곡면 보정이 동작한다)', () => {
    const day = result.lattice.colAnchors.slice(1, 31)
    const gaps = day.slice(1).map((x, i) => x - day[i])
    const pitch = gaps.reduce((a, b) => a + b, 0) / gaps.length
    for (const g of gaps) {
      assert.ok(Math.abs(g - pitch) < pitch * 0.3, `간격 ${g.toFixed(1)} vs 평균 ${pitch.toFixed(1)}`)
    }
  })
})

describe('locateBand — 일자 열 확정', () => {
  test('그 달의 일수만큼 열을 찾는다', () => {
    const band = locateBand(columnCenters, columnWeights, EXPECTED.days)
    assert.ok(band)
    assert.equal(band.columns.length, EXPECTED.days)
  })

  test('합성 없이 실제 검출된 열만으로 채워진다', () => {
    const band = locateBand(columnCenters, columnWeights, EXPECTED.days)!
    assert.equal(band.synthesized.size, 0)
  })

  test('일자 열이 사번 열 바로 다음부터 연속으로 이어진다', () => {
    const band = locateBand(columnCenters, columnWeights, EXPECTED.days)!
    assert.deepEqual(band.columns, Array.from({ length: EXPECTED.days }, (_, i) => i + 1))
  })

  test('일자 열은 등간격이다', () => {
    const band = locateBand(columnCenters, columnWeights, EXPECTED.days)!
    const xs = band.columns.map(c => columnCenters[c])
    const gaps = xs.slice(1).map((x, i) => x - xs[i])
    for (const g of gaps) {
      assert.ok(Math.abs(g - band.pitch) < band.pitch * 0.35, `간격 ${g.toFixed(1)} vs 피치 ${band.pitch.toFixed(1)}`)
    }
  })
})
