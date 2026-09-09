import type { CellBox, Gray } from './types'

export interface ComponentStats {
  x: number; y: number; w: number; h: number
  area: number; cx: number; cy: number
}

/**
 * 4-연결 연결요소 라벨링 (2-pass + union-find).
 * value > 0 인 픽셀을 전경으로 본다.
 */
export function connectedComponents(bin: Gray): {
  labels: Int32Array
  stats: ComponentStats[]
} {
  const { width: w, height: h, data } = bin
  const labels = new Int32Array(w * h)
  const parent: number[] = [0]

  const find = (a: number): number => {
    let r = a
    while (parent[r] !== r) r = parent[r]
    while (parent[a] !== r) { const n = parent[a]; parent[a] = r; a = n }
    return r
  }
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb)
  }

  let next = 1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (data[i] === 0) continue
      const up = y > 0 && data[i - w] > 0 ? labels[i - w] : 0
      const left = x > 0 && data[i - 1] > 0 ? labels[i - 1] : 0
      if (up && left) { labels[i] = Math.min(up, left); union(up, left) }
      else if (up) labels[i] = up
      else if (left) labels[i] = left
      else { labels[i] = next; parent[next] = next; next++ }
    }
  }

  const remap = new Int32Array(next)
  let count = 0
  for (let l = 1; l < next; l++) if (find(l) === l) remap[l] = ++count

  const stats: ComponentStats[] = Array.from({ length: count }, () => ({
    x: Infinity, y: Infinity, w: 0, h: 0, area: 0, cx: 0, cy: 0,
  }))
  const x1 = new Int32Array(count).fill(-1)
  const y1 = new Int32Array(count).fill(-1)
  const sx = new Float64Array(count)
  const sy = new Float64Array(count)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (labels[i] === 0) continue
      const id = remap[find(labels[i])]
      labels[i] = id
      const s = stats[id - 1]
      if (x < s.x) s.x = x
      if (y < s.y) s.y = y
      if (x > x1[id - 1]) x1[id - 1] = x
      if (y > y1[id - 1]) y1[id - 1] = y
      s.area++
      sx[id - 1] += x
      sy[id - 1] += y
    }
  }
  for (let k = 0; k < count; k++) {
    const s = stats[k]
    s.w = x1[k] - s.x + 1
    s.h = y1[k] - s.y + 1
    s.cx = sx[k] / s.area
    s.cy = sy[k] / s.area
  }
  return { labels, stats }
}

export interface CellFilter {
  minW: number; maxW: number
  minH: number; maxH: number
  minArea: number
  /** 채움률 하한 — 셀은 사각형이므로 bbox 대비 면적 비율이 높아야 한다 */
  minFill: number
}

export function filterCells(stats: ComponentStats[], f: CellFilter): CellBox[] {
  const out: CellBox[] = []
  for (const s of stats) {
    if (s.w < f.minW || s.w > f.maxW) continue
    if (s.h < f.minH || s.h > f.maxH) continue
    if (s.area < f.minArea) continue
    if (s.area / (s.w * s.h) < f.minFill) continue
    out.push({ x: s.x, y: s.y, w: s.w, h: s.h, cx: s.cx, cy: s.cy, area: s.area })
  }
  return out
}
