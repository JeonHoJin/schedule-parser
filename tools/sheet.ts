/** 도구들이 공통으로 쓰는 fixture 로딩 + 전체 파싱 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildRoster, RosterIndex } from '@sp/domain'
import { parseRoster, type CellLabel, type FeatureConfig } from '@sp/recognize'
import { readJpeg } from './io'

export const DAYS = 30
export const YEAR = 2026
export const MONTH = 9

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export interface Fixture {
  labels: CellLabel[]
  empnos: string[]
  names: string[]
  templateRows: number[]
  digits: number
}

export function fixture(): Fixture {
  const labelFile: { labels: CellLabel[] } =
    JSON.parse(readFileSync(at('../fixtures/labels-2026-09.json'), 'utf8'))
  const empnoFile: { digits: number; empnos: string[]; names: string[]; templateRows: number[] } =
    JSON.parse(readFileSync(at('../fixtures/empno-2026-09.json'), 'utf8'))
  return { labels: labelFile.labels, ...empnoFile }
}

export function load(featureConfig: Partial<FeatureConfig> = {}) {
  const img = readJpeg(at('../fixtures/roster-2026-09.jpg'))
  const fx = fixture()

  const parsed = parseRoster(img, {
    id: 'roster-2026-09', year: YEAR, month: MONTH,
    printedAt: '2026-08-24T13:01:58',
    cellLabels: fx.labels,
    // 실제 앱에서는 사용자가 확인해 주는 몇 개. 여기서는 fixture 의 정답을 쓴다.
    // fixture 의 empnos 는 간호사 행 순서이고 첫 간호사가 격자 행 2 이므로 row-2 로 찾는다.
    empnoLabels: fx.templateRows.map(row => ({ row, empNo: fx.empnos[row - 2] })),
    knownEmpnos: fx.empnos,
    digits: fx.digits,
    featureConfig,
  })

  return { img, fx, ...parsed }
}
