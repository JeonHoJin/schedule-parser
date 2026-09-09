/** 사번 인식 정확도 측정. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Template } from '@sp/recognize'
import { empnoBox, empnoInk, featureFromInk, matchKnownEmpno, readEmpno, segmentDigitColumn, DIGIT_FEATURE } from '@sp/recognize'
import { load } from './sheet'

const truth = JSON.parse(readFileSync(
  fileURLToPath(new URL('../fixtures/empno-2026-09.json', import.meta.url)), 'utf8'),
) as { digits: number; empnos: string[]; templateRows: number[] }

const cfg: Record<string, number> = {}
for (const a of process.argv.slice(2)) { const [k, v] = a.split('='); cfg[k] = Number(v) }
const DF = { ...DIGIT_FEATURE, ...cfg }

const { sheet } = load()
const M = sheet.detect.lattice.matrix
const boxes = sheet.nurseRows.map(r => empnoBox(sheet.boxOf(r, 1), M[r][0], 113))
const inks = boxes.map(b => empnoInk(sheet.detect.gray, b))
const segs = segmentDigitColumn(inks, truth.digits)

// 알려진 사번에서 숫자 템플릿을 자동 생성한다 — 조각마다 라벨을 붙일 필요가 없다
const templates: Template[] = []
for (const row of truth.templateRows) {
  const i = sheet.nurseRows.indexOf(row)
  const slices = segs[i]
  if (!slices) continue
  const known = truth.empnos[i]
  slices.forEach((box, pos) => templates.push({
    raw: known[pos],
    vector: featureFromInk(inks[i], box, DF).vector,
    origin: { row, day: pos },
  }))
}
const covered = new Set(templates.map(t => t.raw))
console.log(`템플릿 ${templates.length}개, 숫자 종류 ${covered.size}/10  [${[...covered].sort().join('')}]`)

let ok = 0, digitOk = 0, digitTotal = 0, matched = 0, wrongMatch = 0, unresolved = 0
segs.forEach((slices, i) => {
  const row = sheet.nurseRows[i]
  const expected = truth.empnos[i]
  const r = readEmpno(inks[i], slices, templates, DF)
  const got = r.value ?? '(실패)'
  const raw = got === expected
  if (raw) ok++
  for (let k = 0; k < expected.length; k++) {
    digitTotal++
    if (got[k] === expected[k]) digitOk++
  }
  const m = matchKnownEmpno(r.value, truth.empnos)
  if (m.value === expected) matched++
  else if (m.value === null) unresolved++
  else wrongMatch++
  if (!raw) {
    console.log(`row${String(row).padStart(2)} 읽음 ${got}  기대 ${expected}` +
      `  → 명단대조 ${m.value ?? (m.ambiguous ? '모호' : '없음')} (거리 ${m.distance})`)
  }
})
console.log(`\ncfg ${JSON.stringify(cfg)}`)
console.log(`그대로 읽어 맞은 사번   ${ok}/${segs.length}`)
console.log(`자릿수 정확도          ${digitOk}/${digitTotal} (${(digitOk / digitTotal * 100).toFixed(1)}%)`)
console.log(`명단 대조 후 정답      ${matched}/${segs.length}`)
console.log(`  잘못 붙임            ${wrongMatch}`)
console.log(`  판단 보류(사용자 확인) ${unresolved}`)
