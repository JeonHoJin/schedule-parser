/** 인식 품질 지표. 특징 파라미터 튜닝용 — `npx tsx tools/metrics.ts delta=16 blur=2` */
import type { FeatureConfig, Highlight, ShiftKind } from '@sp/recognize'
import { load, DAYS } from './sheet'

const cfg: Partial<FeatureConfig> = {}
for (const a of process.argv.slice(2)) {
  const [k, v] = a.split('=')
  ;(cfg as Record<string, unknown>)[k] = Number.isNaN(Number(v)) ? v : Number(v)
}

const { sheet, cells } = load(cfg)
const at = (row: number, day: number) => cells[row - 2][day - 1]
const all = cells.flat()

const orange = new Map<number, number>()
for (const c of all) if (c.highlight === 'orange') orange.set(c.row, (orange.get(c.row) ?? 0) + 1)
const me = [...orange.entries()].sort((a, b) => b[1] - a[1])[0][0]

const CYCLE: ShiftKind[] = ['D', 'E', 'N']
const expC = new Set<string>(), expN = new Set<string>()
for (let day = 1; day <= DAYS; day++) {
  const i = CYCLE.indexOf(at(me, day).kind)
  if (i < 0) continue
  for (const row of sheet.nurseRows) {
    if (row !== me && at(row, day).kind === at(me, day).kind) expC.add(`${row}:${day}`)
  }
  const nd = i === 2 ? day + 1 : day
  if (nd > DAYS) continue
  for (const row of sheet.nurseRows) {
    if (row === me && nd === day) continue
    if (at(row, nd).kind === CYCLE[(i + 1) % 3]) expN.add(`${row}:${nd}`)
  }
}
const marked = (c: Highlight) =>
  new Set(all.filter(x => x.highlight === c && x.row !== me).map(x => `${x.row}:${x.day}`))
const cmp = (exp: Set<string>, act: Set<string>) => ({
  marked: act.size,
  computed: exp.size,
  /** 칠한 칸 중 계산에 포함된 비율 */
  recall: act.size ? +((1 - [...act].filter(k => !exp.has(k)).length / act.size) * 100).toFixed(1) : 0,
  /** 계산했는데 칠하지 않은 칸 */
  extra: [...exp].filter(k => !act.has(k)).length,
})

const low = all.filter(c => c.kind !== 'EMPTY' && (c.score < 0.8 || c.margin < 0.06))
console.log(JSON.stringify({
  cfg: Object.keys(cfg).length ? cfg : 'default',
  empty: all.filter(c => c.kind === 'EMPTY').length,
  low: low.length,
  lowPct: +(low.length / all.length * 100).toFixed(1),
  concurrent: cmp(expC, marked('pink')),
  next: cmp(expN, marked('yellow')),
}))
