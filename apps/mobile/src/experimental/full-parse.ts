/**
 * 앱에 번들된 템플릿으로 사진 한 장을 전부 파싱한다.
 *
 * 개인정보(사번·이름)는 템플릿에 없다 — D/E/N// 등의 코드와 0-9 숫자의
 * 시각적 특징 벡터만 들어 있다. 새 사용자 근무표에도 그대로 통한다.
 */
import { buildRoster, type Roster } from '@sp/domain'
import {
  prepareEmpnoColumn, prepareSheet, readEmpnoColumn, readSheet,
  toRosterInput, type PreparedSheet, type Template, type EmpnoReading, type SheetCell,
} from '@sp/recognize'
import type { Rgba } from '@sp/vision'
import templatesJson from '../../assets/templates.json'
import { rotateRgba } from './browser-image'

interface SerialTemplate { raw: string; vector: number[] }
interface TemplateFile {
  version: number; featureDim: number; digitDim: number
  cells: SerialTemplate[]; digits: SerialTemplate[]
}

let cached: { cells: Template[]; digits: Template[] } | null = null

function hydrate(list: SerialTemplate[]): Template[] {
  return list.map(t => ({ raw: t.raw, vector: new Float32Array(t.vector) }))
}

function loadTemplates() {
  if (cached) return cached
  const file = templatesJson as TemplateFile
  cached = { cells: hydrate(file.cells), digits: hydrate(file.digits) }
  return cached
}

export interface FullParseResult {
  roster: Roster
  cells: SheetCell[][]
  empnos: EmpnoReading[]
  sheet: PreparedSheet
  rotatedImage: Rgba
  rotationUsed: 0 | 90 | 180 | 270
  score: number
}

export interface FullParseOptions {
  id: string
  year: number
  month: number
  ward?: string
  days: number
  digits?: number
  /** 지정하면 그 회전만 시도. 미지정이면 자동 감지 (0, 180 → 필요시 90, 270) */
  rotation?: 0 | 90 | 180 | 270
}

function parseOne(rotated: Rgba, opts: FullParseOptions, rotation: 0 | 90 | 180 | 270): FullParseResult {
  const { cells: cellTpl, digits: digitTpl } = loadTemplates()
  const sheet = prepareSheet(rotated, opts.days)
  const cellsGrid = readSheet(sheet, cellTpl)
  const column = prepareEmpnoColumn(sheet, opts.digits ?? 6)
  const empnos = readEmpnoColumn(sheet, column, digitTpl)
  const rosterInput = toRosterInput(cellsGrid, empnos, {
    id: opts.id, year: opts.year, month: opts.month, ward: opts.ward,
  })
  const roster = buildRoster(rosterInput)

  // 채점: 신뢰도 높은 D/E/N/OFF 셀 수 + 성공 사번 수.
  // 뒤집힌 이미지는 템플릿과 유사도가 급락하므로 이 값이 크게 낮게 나온다.
  let good = 0
  for (const row of cellsGrid) for (const c of row) {
    if (c.score > 0.7 && (c.kind === 'D' || c.kind === 'E' || c.kind === 'N' || c.kind === 'OFF')) good++
  }
  const empnoOk = empnos.filter(e => e.value).length
  const score = good + empnoOk * 5   // 사번 하나가 셀 5개 값

  return {
    roster, cells: cellsGrid, empnos, sheet,
    rotatedImage: rotated, rotationUsed: rotation, score,
  }
}

export function fullParse(img: Rgba, opts: FullParseOptions): FullParseResult {
  if (opts.rotation !== undefined) {
    return parseOne(rotateRgba(img, opts.rotation), opts, opts.rotation)
  }

  // 자동 감지: 0° 와 180° 를 시도 (ensureLandscape 가 90°/270° 는 대부분 흡수함).
  // 실패하면 90/270 도 시도.
  const candidates: Array<0 | 90 | 180 | 270> = [0, 180, 90, 270]
  let best: FullParseResult | null = null
  for (const r of candidates) {
    try {
      const one = parseOne(rotateRgba(img, r), opts, r)
      if (!best || one.score > best.score) best = one
      // 첫 두 시도(0/180)에서 이미 충분히 좋으면 90/270 은 건너뜀
      if (best.score > 400 && r === 180) return best
    } catch {
      // 회전한 이미지에서 격자 검출이 실패할 수 있다 — 다음 후보로
    }
  }
  if (!best) throw new Error('4가지 회전 모두 격자 검출 실패')
  return best
}
