/**
 * 계산한 인수인계 체인을 형광펜과 같은 색으로 칠해 렌더링한다.
 * 사용자가 손으로 칠한 종이와 나란히 놓고 비교하기 위한 것.
 */
import { fileURLToPath } from 'node:url'
import { crop, resampleNearest, type Rgba } from '@sp/vision'
import type { ShiftKind } from '@sp/recognize'
import { writePng } from './io'
import { load, DAYS } from './sheet'

const { sheet, cells } = load()
const at = (row: number, day: number) => cells[row - 2][day - 1]

const orange = new Map<number, number>()
for (const c of cells.flat()) if (c.highlight === 'orange') orange.set(c.row, (orange.get(c.row) ?? 0) + 1)
const me = [...orange.entries()].sort((a, b) => b[1] - a[1])[0][0]

const CYCLE: ShiftKind[] = ['D', 'E', 'N']
type Role = 'me' | 'concurrent' | 'next' | 'none'
const role = new Map<string, Role>()
for (let day = 1; day <= DAYS; day++) {
  const i = CYCLE.indexOf(at(me, day).kind)
  role.set(`${me}:${day}`, i >= 0 ? 'me' : 'none')
  if (i < 0) continue
  for (const row of sheet.nurseRows) {
    if (row !== me && at(row, day).kind === at(me, day).kind) role.set(`${row}:${day}`, 'concurrent')
  }
  const nd = i === 2 ? day + 1 : day
  if (nd > DAYS) continue
  for (const row of sheet.nurseRows) {
    if (row === me && nd === day) continue
    if (at(row, nd).kind === CYCLE[(i + 1) % 3] && !role.has(`${row}:${nd}`)) {
      role.set(`${row}:${nd}`, 'next')
    }
  }
}

const TINT: Record<Role, [number, number, number] | null> = {
  me: [255, 168, 60],
  concurrent: [255, 105, 170],
  next: [225, 225, 60],
  none: null,
}

const CW = 46, CH = 38, GAP = 2
const W = GAP + DAYS * (CW + GAP)
const H = GAP + cells.length * (CH + GAP)
const out: Rgba = { width: W, height: H, data: new Uint8Array(W * H * 4).fill(30) }
for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255

cells.forEach((line, ri) => {
  line.forEach((c, ci) => {
    const tile = resampleNearest(crop(sheet.detect.work, sheet.boxOf(c.row, c.day), 0), CW, CH)
    const tint = TINT[role.get(`${c.row}:${c.day}`) ?? 'none']
    const ox = GAP + ci * (CW + GAP), oy = GAP + ri * (CH + GAP)
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
      const s = (y * CW + x) * 4, o = ((oy + y) * W + ox + x) * 4
      // 글자는 남기고 배경만 칠한다: 밝을수록 색을 세게 입힌다
      const lum = (tile.data[s] + tile.data[s + 1] + tile.data[s + 2]) / 3 / 255
      for (let k = 0; k < 3; k++) {
        const base = tile.data[s + k]
        out.data[o + k] = tint ? Math.round(base * (1 - 0.55 * lum) + tint[k] * 0.55 * lum) : base
      }
      out.data[o + 3] = 255
    }
  })
})
writePng(fileURLToPath(new URL('../debug/10-chain.png', import.meta.url)), out)
const n = (r: Role) => [...role.values()].filter(v => v === r).length
console.log(`본인 row${me}: 근무 ${n('me')}칸 / 동시간 ${n('concurrent')}칸 / 다음 ${n('next')}칸`)
console.log(`-> debug/10-chain.png (${W}x${H})`)
