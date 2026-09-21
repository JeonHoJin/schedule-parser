/**
 * fixture 근무표에서 셀·숫자 템플릿을 뽑아 앱에 넣을 static JSON 을 만든다.
 *
 * 출력 파일에는 D/E/N/// 등의 코드와 0-9 숫자의 시각적 특징 벡터만 담긴다.
 * 이름·사번 같은 개인정보는 없으므로 공개 저장소에 커밋해도 안전하다.
 *
 * 사용법:
 *   npx tsx tools/export-templates.ts
 *   → apps/mobile/assets/templates.json 갱신
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  buildDigitTemplates, buildTemplates,
  prepareEmpnoColumn, prepareSheet, type Template,
} from '@sp/recognize'
import { fixture, DAYS } from './sheet'
import { readJpeg } from './io'

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const OUT = at('../apps/mobile/assets/templates.json')

interface SerialTemplate {
  raw: string
  vector: number[]
}

function serialize(t: Template): SerialTemplate {
  // 6 자리 정밀도로 JSON 크기를 줄인다. 코사인 유사도 계산에 충분하다.
  return { raw: t.raw, vector: Array.from(t.vector).map(v => Number(v.toFixed(6))) }
}

const img = readJpeg(at('../fixtures/roster-2026-09.jpg'))
const fx = fixture()

const sheet = prepareSheet(img, DAYS)
const cells = buildTemplates(sheet, fx.labels)
const column = prepareEmpnoColumn(sheet, fx.digits)
const empnoLabels = fx.templateRows.map(row => ({ row, empNo: fx.empnos[row - 2] }))
const digits = buildDigitTemplates(sheet, column, empnoLabels)

const out = {
  version: 1,
  source: 'roster-2026-09.jpg',
  featureDim: cells[0]?.vector.length ?? 0,
  digitDim: digits[0]?.vector.length ?? 0,
  cells: cells.map(serialize),
  digits: digits.map(serialize),
}

mkdirSync(at('../apps/mobile/assets'), { recursive: true })
writeFileSync(OUT, JSON.stringify(out))
const size = (JSON.stringify(out).length / 1024).toFixed(0)
console.log(`템플릿 저장: ${OUT}`)
console.log(`  셀: ${out.cells.length}개 (${out.featureDim} 차원)`)
console.log(`  숫자: ${out.digits.length}개 (${out.digitDim} 차원)`)
console.log(`  크기: ${size} KB`)
