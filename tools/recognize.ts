/** 인식 결과 전체를 표로 출력한다. */
import { load, DAYS } from './sheet'

const { sheet, cells } = load()

console.log('\n일자   ' + Array.from({ length: DAYS }, (_, i) => String(i + 1).padStart(5)).join(''))
for (const row of cells) {
  console.log(`row${String(row[0].row).padStart(2)}  ` +
    row.map(c => (c.raw || '·').padStart(5)).join(''))
}

const tally = new Map<string, number>()
for (const c of cells.flat()) tally.set(c.kind, (tally.get(c.kind) ?? 0) + 1)
console.log('\n근무 종류:', [...tally].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  '))

const low = cells.flat().filter(c => c.kind !== 'EMPTY' && (c.score < 0.8 || c.margin < 0.06))
console.log(`\n검수 필요 ${low.length}칸 / ${sheet.nurseRows.length * DAYS}`)
for (const c of low) {
  console.log(`  row${c.row} day${c.day}  "${c.raw}"  score=${c.score.toFixed(3)} margin=${c.margin.toFixed(3)}`)
}
