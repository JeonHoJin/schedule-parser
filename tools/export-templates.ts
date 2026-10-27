/**
 * fixture 근무표에서 셀·숫자 템플릿을 뽑아 앱에 넣을 static JSON 을 만든다.
 *
 * 출력 파일에는 D/E/N/// 등의 코드와 0-9 숫자의 시각적 특징 벡터만 담긴다.
 * 공개 저장소에 커밋되므로 원본 표의 행·열 순서가 남으면 안 된다 — 숫자 템플릿을
 * 추출 순서대로 두면 라벨을 이어 붙이는 것만으로 사번이 복원된다. 그래서 라벨순으로
 * 정렬하고, 같은 라벨 안에서는 벡터 값으로 다시 정렬해 행 순서를 지운다.
 * 라벨별 평균으로 합치면 더 안전하지만 사번 정확도가 크게 떨어져 쓰지 않는다.
 *
 * 사용법:
 *   npx tsx tools/export-templates.ts
 *   → apps/mobile/assets/templates.json 갱신
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  buildDigitTemplates, buildTemplates,
  prepareEmpnoColumn, prepareSheet, type CellLabel, type Template,
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

const weight = (t: Template) => t.vector.reduce((s, v, i) => s + v * ((i * 2654435761) % 997), 0)

function anonymize(list: Template[]): SerialTemplate[] {
  return [...list]
    .sort((a, b) => a.raw.localeCompare(b.raw) || weight(a) - weight(b))
    .map(serialize)
}

const img = readJpeg(at('../fixtures/roster-2026-09.jpg'))
const fx = fixture()

const sheet = prepareSheet(img, DAYS)
const cells = buildTemplates(sheet, fx.labels)
// 다른 양식의 글자도 추가할 수 있다. 이미지·정답은 비공개 fixture 로만 둔다.
// 예: ... export-templates.ts fixtures/roster-2026-11.jpg fixtures/labels-2026-11.json
const extras = process.argv.slice(2)
if (extras.length % 2) throw new Error('추가 템플릿은 이미지 경로와 정답 JSON 경로를 쌍으로 지정하세요.')
for (let i = 0; i < extras.length; i += 2) {
  const labels: { days: number; labels: CellLabel[] } = JSON.parse(readFileSync(extras[i + 1], 'utf8'))
  if (!Number.isInteger(labels.days) || labels.days < 28 || labels.days > 31) throw new Error('정답 JSON 의 days 는 28~31이어야 합니다.')
  cells.push(...buildTemplates(prepareSheet(readJpeg(extras[i]), labels.days), labels.labels))
}
const column = prepareEmpnoColumn(sheet, fx.digits)
const empnoLabels = fx.templateRows.map(row => ({ row, empNo: fx.empnos[row - 2] }))
const digits = buildDigitTemplates(sheet, column, empnoLabels)

const out = {
  version: 1,
  featureDim: cells[0]?.vector.length ?? 0,
  digitDim: digits[0]?.vector.length ?? 0,
  cells: anonymize(cells),
  digits: anonymize(digits),
}

mkdirSync(at('../apps/mobile/assets'), { recursive: true })
writeFileSync(OUT, JSON.stringify(out))
const size = (JSON.stringify(out).length / 1024).toFixed(0)
console.log(`템플릿 저장: ${OUT}`)
console.log(`  셀: ${out.cells.length}개 (${out.featureDim} 차원)`)
console.log(`  숫자: ${out.digits.length}개 (${out.digitDim} 차원)`)
console.log(`  크기: ${size} KB`)
