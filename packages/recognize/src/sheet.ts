import {
  detectGrid, locateBand,
  type BandResult, type Box, type DetectResult, type LatticeCell, type Rgba,
} from '@sp/vision'
import { daysInMonth, parseCode, type RosterInput, type ShiftKind } from '@sp/domain'
import {
  DIGIT_FEATURE, empnoBox, empnoInk, matchKnownEmpno, readEmpno, segmentDigitColumn,
} from './digits'
import { featureFromInk, type InkMask } from './feature'
import { cellFeature, type FeatureConfig } from './feature'
import { cellHighlight, type Highlight } from './highlight'
import { classify, type Template } from './template'

/** 라벨 한 건 — 사람이 셀 하나에 붙인 정답 */
export interface CellLabel {
  row: number
  day: number
  raw: string
}

export interface PreparedSheet {
  detect: DetectResult
  band: BandResult
  /** 격자 행 개수 (헤더 2행 포함) */
  rows: number
  /** 그 달의 일수 */
  days: number
  /** 간호사 행 인덱스 (헤더 2행을 제외한 나머지) */
  nurseRows: number[]
  boxOf(row: number, day: number): LatticeCell
}

export interface SheetCell {
  row: number
  day: number
  /** 인쇄된 글자 그대로 */
  raw: string
  kind: ShiftKind
  flags: string[]
  /** 템플릿 유사도 */
  score: number
  /** 2등 라벨과의 차이 */
  margin: number
  /** 사람이 칠한 형광펜 (데이터가 아니라 메모) */
  highlight: Highlight
  /** 격자에서 실제로 검출된 셀인지, 보간된 위치인지 */
  detected: boolean
}

/** 사진에서 격자를 복원하고 일자 열을 확정한다. */
export function prepareSheet(img: Rgba, days: number): PreparedSheet {
  const detect = detectGrid(img)
  const { lattice } = detect
  const weights = lattice.colAnchors.map(
    (_, c) => lattice.matrix.filter(row => row[c].detected).length)
  const band = locateBand(lattice.colAnchors, weights, days)
  if (!band) throw new Error('일자 열을 찾지 못했습니다')

  return {
    detect,
    band,
    rows: lattice.rows,
    days,
    nurseRows: Array.from({ length: lattice.rows - 2 }, (_, i) => i + 2),
    boxOf: (row, day) => lattice.matrix[row][band.columns[day - 1]],
  }
}

/** 사람이 라벨을 붙인 셀들로 템플릿 사전을 만든다. */
export function buildTemplates(
  sheet: PreparedSheet,
  labels: CellLabel[],
  config?: Partial<FeatureConfig>,
): Template[] {
  return labels.map(l => ({
    raw: l.raw,
    vector: cellFeature(sheet.detect.gray, sheet.boxOf(l.row, l.day), config).vector,
    origin: { row: l.row, day: l.day },
  }))
}

/** 모든 간호사 행 × 일자를 분류한다. */
export function readSheet(
  sheet: PreparedSheet,
  templates: Template[],
  config?: Partial<FeatureConfig>,
): SheetCell[][] {
  return sheet.nurseRows.map(row =>
    Array.from({ length: sheet.days }, (_, i) => {
      const day = i + 1
      const box = sheet.boxOf(row, day)
      const feat = cellFeature(sheet.detect.gray, box, config)
      const c = classify(feat, templates)
      const parsed = parseCode(c.raw)
      return {
        row, day,
        raw: c.raw,
        kind: parsed.kind,
        flags: parsed.flags,
        score: c.score,
        margin: c.margin,
        highlight: cellHighlight(sheet.detect.work, box),
        detected: box.detected,
      }
    }))
}

/* ------------------------------------------------------------------ *
 * 사번 열
 * ------------------------------------------------------------------ */

/** 사번 열의 잉크 마스크와 숫자 조각. 두 단계 모두 열 전체를 보고 정해진다. */
export interface EmpnoColumn {
  inks: InkMask[]
  slices: Array<Box[] | null>
}

export function prepareEmpnoColumn(sheet: PreparedSheet, digits: number): EmpnoColumn {
  const matrix = sheet.detect.lattice.matrix
  const detected = sheet.nurseRows.map(r => matrix[r][0]).filter(b => b.detected).map(b => b.w)
  const width = detected.length
    ? [...detected].sort((a, b) => a - b)[detected.length >> 1]
    : matrix[sheet.nurseRows[0]][0].w

  const inks = sheet.nurseRows.map(r =>
    empnoInk(sheet.detect.gray, empnoBox(sheet.boxOf(r, 1), matrix[r][0], width)))
  return { inks, slices: segmentDigitColumn(inks, digits) }
}

/**
 * 알고 있는 사번에서 숫자 템플릿을 만든다.
 *
 * 조각마다 사람이 라벨을 붙일 필요가 없다 — 사번 하나를 알면 숫자 6개를 한꺼번에 얻는다.
 * 표 **위아래에 걸쳐 고르게** 고르는 것이 중요하다. 아래로 갈수록 인쇄가 흐려져서
 * 위쪽 행만으로 만든 템플릿은 아래쪽 행을 못 읽는다.
 */
export function buildDigitTemplates(
  sheet: PreparedSheet,
  column: EmpnoColumn,
  labeled: Array<{ row: number; empNo: string }>,
): Template[] {
  const out: Template[] = []
  for (const { row, empNo } of labeled) {
    const i = sheet.nurseRows.indexOf(row)
    const slices = column.slices[i]
    if (!slices || slices.length !== empNo.length) continue
    slices.forEach((box, pos) => out.push({
      raw: empNo[pos],
      vector: featureFromInk(column.inks[i], box, DIGIT_FEATURE).vector,
      origin: { row, day: pos },
    }))
  }
  return out
}

export interface EmpnoReading {
  row: number
  /** 그대로 읽은 값 */
  read: string | null
  /** 명단 대조까지 마친 최종 값. 확신이 없으면 null → 사용자 확인 */
  value: string | null
  minScore: number
  /** 명단의 어느 값과도 충분히 가깝지 않거나, 후보가 둘 이상이었다 */
  needsReview: boolean
}

export function readEmpnoColumn(
  sheet: PreparedSheet,
  column: EmpnoColumn,
  templates: Template[],
  known?: readonly string[],
): EmpnoReading[] {
  return sheet.nurseRows.map((row, i) => {
    const r = readEmpno(column.inks[i], column.slices[i], templates)
    if (!known?.length) {
      return { row, read: r.value, value: r.value, minScore: r.minScore, needsReview: !r.value }
    }
    const m = matchKnownEmpno(r.value, known)
    return {
      row, read: r.value, value: m.value,
      minScore: r.minScore,
      needsReview: m.value === null,
    }
  })
}

/** 인식 결과를 도메인 모델 입력으로 옮긴다 */
export function toRosterInput(
  cells: SheetCell[][],
  empnos: EmpnoReading[],
  meta: { id: string; year: number; month: number; ward?: string; printedAt?: string },
): RosterInput {
  return {
    ...meta,
    people: empnos.map(e => ({ empNo: e.value ?? '' })),
    grid: cells.map(row => row.map(c => ({
      raw: c.raw,
      kind: c.kind,
      flags: c.flags,
      confidence: Math.min(c.score, 0.5 + c.margin),
    }))),
  }
}

/* ------------------------------------------------------------------ *
 * 조립
 * ------------------------------------------------------------------ */

export interface ParseOptions {
  id: string
  year: number
  month: number
  ward?: string
  printedAt?: string
  /** 사람이 라벨을 붙인 근무 코드 셀들 */
  cellLabels: CellLabel[]
  /** 사람이 확인한 사번 몇 개 — 여기서 숫자 템플릿을 만든다 */
  empnoLabels: Array<{ row: number; empNo: string }>
  /** 이미 알고 있는 사번 명단. 있으면 읽은 값을 여기에 맞춘다. */
  knownEmpnos?: readonly string[]
  digits?: number
  featureConfig?: Partial<FeatureConfig>
}

export interface ParseResult {
  sheet: PreparedSheet
  cells: SheetCell[][]
  empnos: EmpnoReading[]
  rosterInput: RosterInput
}

/**
 * 사진 한 장을 근무표 데이터로 바꾸는 전 과정.
 *
 * 격자 복원 → 근무 코드 인식 → 사번 인식 → 도메인 모델 입력.
 * 앱도, 개발 도구도, 테스트도 전부 이 함수 하나를 지난다.
 */
export function parseRoster(img: Rgba, opts: ParseOptions): ParseResult {
  const days = daysInMonth(opts.year, opts.month)
  const sheet = prepareSheet(img, days)

  const templates = buildTemplates(sheet, opts.cellLabels, opts.featureConfig)
  const cells = readSheet(sheet, templates, opts.featureConfig)

  const column = prepareEmpnoColumn(sheet, opts.digits ?? 6)
  const digitTemplates = buildDigitTemplates(sheet, column, opts.empnoLabels)
  const empnos = readEmpnoColumn(sheet, column, digitTemplates, opts.knownEmpnos)

  return {
    sheet, cells, empnos,
    rosterInput: toRosterInput(cells, empnos, {
      id: opts.id, year: opts.year, month: opts.month,
      ward: opts.ward, printedAt: opts.printedAt,
    }),
  }
}
