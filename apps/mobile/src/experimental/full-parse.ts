/**
 * 앱에 번들된 템플릿으로 사진 한 장을 전부 파싱한다.
 *
 * 개인정보(사번·이름)는 템플릿에 없다 — D/E/N// 등의 코드와 0-9 숫자의
 * 시각적 특징 벡터만 들어 있다. 새 사용자 근무표에도 그대로 통한다.
 */
import { buildRoster, type Roster } from '@sp/domain'
import {
  prepareEmpnoColumn, prepareSheet, readEmpnoColumn, readSheet,
  toRosterInput, type Template, type EmpnoReading, type SheetCell,
} from '@sp/recognize'
import type { Rgba } from '@sp/vision'
import templatesJson from '../../assets/templates.json'

interface SerialTemplate {
  raw: string
  vector: number[]
}

interface TemplateFile {
  version: number
  source: string
  featureDim: number
  digitDim: number
  cells: SerialTemplate[]
  digits: SerialTemplate[]
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
}

export interface FullParseOptions {
  id: string
  year: number
  month: number
  ward?: string
  days: number
  digits?: number
}

export function fullParse(img: Rgba, opts: FullParseOptions): FullParseResult {
  const { cells: cellTpl, digits: digitTpl } = loadTemplates()
  const sheet = prepareSheet(img, opts.days)
  const cellsGrid = readSheet(sheet, cellTpl)
  const column = prepareEmpnoColumn(sheet, opts.digits ?? 6)
  const empnos = readEmpnoColumn(sheet, column, digitTpl)
  const rosterInput = toRosterInput(cellsGrid, empnos, {
    id: opts.id, year: opts.year, month: opts.month, ward: opts.ward,
  })
  const roster = buildRoster(rosterInput)
  return { roster, cells: cellsGrid, empnos }
}
