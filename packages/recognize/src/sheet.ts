import {
  detectGrid, locateBand,
  type BandResult, type Box, type DetectResult, type LatticeCell, type Rgba,
} from '@sp/vision'
import { daysInMonth, parseCode, type RosterInput, type ShiftKind } from '@sp/domain'
import {
  DIGIT_FEATURE, empnoBox, empnoInk, matchKnownEmpno, readEmpno, segmentDigitColumn,
} from './digits'
import { featureFromInk, type InkMask } from './feature'
import { cellFeature, cellInk, type FeatureConfig } from './feature'
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
  /** 사번 열이 없는 신청표에서는 숫자를 억지로 읽지 않는다. */
  hasEmpno: boolean
  dateHeaderConfirmed: boolean
  identityBoxOf(row: number): { name: Box; empno: Box | null }
  boxOf(row: number, day: number): LatticeCell
}

export class DateHeaderError extends Error {}

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
  let band = locateBand(lattice.colAnchors, weights, days)
  // 이전 달 칸은 날짜·요일 헤더가 비어 있다. 날짜 또는 요일이 인쇄된
  // 연속 N칸을 우선하여, 이전 달/마지막 여백 칸을 일자로 읽지 않는다.
  const printed = lattice.colAnchors.map((_, c) =>
    [0, 1].some(r => lattice.matrix[r]?.[c]
      && cellInk(detect.gray, lattice.matrix[r][c]).ink >= 0.02))
  // 내부 헤더 한 칸이 흐려져도 양쪽 헤더와 월의 일수로 그 위치를 유지한다.
  const header = printed.map((ink, c) => ink || !!(printed[c - 1] && printed[c + 1]))
  let headerMatched = false
  let sheetDays = days
  let partialHeaderStart: number | undefined
  for (let start = 0; start < header.length; start++) {
    if (!header[start] || (start > 0 && header[start - 1])) continue
    let end = start
    while (header[end]) end++
    if (start >= 2 && end < header.length && end - start >= days - 2 && end - start < days) {
      partialHeaderStart = start
    }
    const headerDays = end - start
    // 최초 월 추정이 31일이어도, 온전한 30일 헤더는 제목 OCR 까지 진행한다.
    // 마지막 여백이 한 칸이고 그 앞의 이전 달 칸이 좁아야 경계가 온전하다.
    const width = (c: number) => lattice.matrix[Math.min(2, lattice.rows - 1)]?.[c]?.w ?? 0
    const shorterMonth = headerDays >= 28 && headerDays < days && end === header.length - 1
      && (start < 2 || width(start - 1) < width(start) * 0.85)
    if (headerDays !== days && !shorterMonth) continue
    const headerBand = locateBand(lattice.colAnchors.slice(start, end), weights.slice(start, end), headerDays)
    if (headerBand && !headerBand.synthesized.size) {
      band = { ...headerBand, columns: headerBand.columns.map(c => c + start), seed: [start, end - 1] }
      headerMatched = true
      sheetDays = headerDays
      break
    }
  }
  if (!headerMatched && partialHeaderStart !== undefined && band?.columns[0] !== partialHeaderStart) {
    throw new DateHeaderError('날짜 헤더가 흐려 일자 시작점을 확정하지 못했습니다. 날짜·요일 줄이 보이도록 다시 잘라 주세요.')
  }
  if (!band) throw new Error('일자 열을 찾지 못했습니다')

  const firstDay = band.columns[0]
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? 0
  const body = lattice.matrix.slice(2)
  const empnoCol = firstDay - 1
  const dayWidth = median(body.map(r => r[firstDay]?.w ?? 0))
  const empnoWidth = median(body.map(r => r[empnoCol]?.w ?? 0))
  // 6자리 사번 칸은 날짜 칸보다 넓고, 이전 달의 근무 칸은 날짜 칸과 비슷하다.
  const hasEmpno = empnoCol >= 0 && empnoWidth > dayWidth * 1.4
  const boxOf = (row: number, day: number) => lattice.matrix[row][band!.columns[day - 1]]
  const rawIdentityBoxOf = (row: number): { name: Box; empno: Box | null } => {
    const left = lattice.matrix[row][hasEmpno ? empnoCol : 0]
    const empno = hasEmpno ? empnoBox(boxOf(row, 1), left, empnoWidth) : null
    const right = Math.max(1, Math.round((empno?.x ?? left.x) - 2))
    // 이름 왼쪽의 세로 괘선을 찾아 순번이 이름 OCR 에 섞이지 않게 한다.
    const y0 = Math.max(0, Math.round(left.y - left.h))
    const y1 = Math.min(detect.work.height, Math.round(left.y + left.h * 2))
    let x0 = 0
    for (let x = 0; x < right - 8; x++) {
      let ink = 0
      for (let y = y0; y < y1; y++) if (detect.gridMask.data[y * detect.work.width + x]) ink++
      if (ink > (y1 - y0) * 0.7) x0 = x + 2
    }
    return { name: { x: x0, y: left.y, w: Math.max(1, right - x0), h: left.h }, empno }
  }
  const identities = new Map(body.map((_, i) => [i + 2, rawIdentityBoxOf(i + 2)]))
  const nameWidth = median([...identities.values()].map(b => b.name.w))
  const identityBoxOf = (row: number) => {
    const identity = identities.get(row)!
    // 빈 구분 행 뒤에서 괘선이 끊겨도 이름 칸에 순번 열까지 포함하지 않는다.
    if (!hasEmpno && identity.name.w > nameWidth * 1.15) {
      const right = identity.name.x + identity.name.w
      return { ...identity, name: { ...identity.name, x: right - nameWidth, w: nameWidth } }
    }
    return identity
  }
  const nurseRows = Array.from({ length: Math.max(0, lattice.rows - 2) }, (_, i) => i + 2)
    .filter(row => hasEmpno || cellInk(detect.gray, identityBoxOf(row).name).ink >= 0.015
      || band!.columns.some(c => cellInk(detect.gray, lattice.matrix[row][c]).ink >= 0.02))

  return {
    detect,
    band,
    rows: lattice.rows,
    days: sheetDays,
    nurseRows, hasEmpno, dateHeaderConfirmed: headerMatched, identityBoxOf, boxOf,
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
  if (!sheet.hasEmpno) return { inks: [], slices: [] }
  const inks = sheet.nurseRows.map(r =>
    empnoInk(sheet.detect.gray, sheet.identityBoxOf(r).empno!))
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
  if (!sheet.hasEmpno) return sheet.nurseRows.map(row => ({
    row, read: null, value: null, minScore: 0, needsReview: false,
  }))
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
