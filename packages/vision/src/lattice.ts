import type { Box, CellBox } from './types'

export interface LatticeCell extends Box {
  cx: number
  cy: number
  /** true 면 실제 검출된 셀, false 면 격자로부터 보간된 위치 */
  detected: boolean
}

export interface Lattice {
  rows: number
  cols: number
  /** [row][col] */
  matrix: LatticeCell[][]
  /**
   * 각 열을 **공통 기준선(표 중앙 높이)** 에서 평가한 x 좌표.
   * 곡면 때문에 열마다 평균 x 가 다른 편향을 갖기 때문에, 열끼리 비교할 때는
   * 반드시 이 값을 쓴다.
   */
  colAnchors: number[]
  /** 각 행을 공통 기준선(표 중앙 폭)에서 평가한 y 좌표 */
  rowAnchors: number[]
}

/* ------------------------------------------------------------------ */

class DisjointSet {
  private p: Int32Array
  constructor(n: number) {
    this.p = new Int32Array(n)
    for (let i = 0; i < n; i++) this.p[i] = i
  }
  find(a: number): number {
    let r = a
    while (this.p[r] !== r) r = this.p[r]
    while (this.p[a] !== r) { const n = this.p[a]; this.p[a] = r; a = n }
    return r
  }
  union(a: number, b: number): void {
    const ra = this.find(a), rb = this.find(b)
    if (ra !== rb) this.p[rb] = ra
  }
  groups(): number[][] {
    const m = new Map<number, number[]>()
    for (let i = 0; i < this.p.length; i++) {
      const r = this.find(i)
      const g = m.get(r)
      if (g) g.push(i)
      else m.set(r, [i])
    }
    return [...m.values()]
  }
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / (xs.length || 1)

const median = (xs: number[]): number => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const overlap1d = (a0: number, a1: number, b0: number, b1: number): number =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))

/** 최소자승 직선. 점이 부족하면 평균값을 주는 수평선. */
function fitLine(pts: Array<[number, number]>): (x: number) => number {
  if (pts.length === 0) return () => 0
  if (pts.length === 1) return () => pts[0][1]
  let sx = 0, sy = 0, sxx = 0, sxy = 0
  for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y }
  const n = pts.length
  const den = n * sxx - sx * sx
  if (Math.abs(den) < 1e-9) return () => sy / n
  const a = (n * sxy - sx * sy) / den
  const b = (sy - a * sx) / n
  return (x: number) => a * x + b
}

/* ------------------------------------------------------------------ *
 * 축 하나에 대한 줄 복원
 * ------------------------------------------------------------------ */

interface AxisView {
  /** 줄이 뻗어나가는 방향의 좌표 (행이면 x) */
  primary: (c: CellBox) => number
  /** 줄을 가로지르는 방향의 좌표 (행이면 y) */
  secondary: (c: CellBox) => number
  /** primary 방향 구간 */
  pSpan: (c: CellBox) => [number, number]
  /** secondary 방향 구간 */
  sSpan: (c: CellBox) => [number, number]
  pSize: number
  sSize: number
}

/**
 * 한 축의 줄(행 또는 열)을 복원한다.
 *
 * 1단계 — 엄격한 인접 union
 *   바로 옆에 붙어 있고 수직 구간이 절반 이상 겹치는 셀만 잇는다.
 *   허용 간격을 넓히면 종이가 휜 구간에서 옆 줄과 붙어버리므로 여기서는 욕심내지 않는다.
 *
 * 2단계 — 기울기 외삽으로 조각 잇기
 *   셀이 여러 개 연속 누락되면 한 줄이 여러 조각으로 끊긴다. 조각 A의 끝부분 기울기를
 *   외삽해 조각 B의 시작점 좌표를 예측하고, 양쪽에서 서로를 맞게 예측하면 같은 줄로 본다.
 *   전역 기울기를 쓰지 않으므로 곡면에서도 성립한다.
 */
function buildAxis(cells: CellBox[], v: AxisView): number[][] {
  const n = cells.length
  const ds = new DisjointSet(n)
  const order = [...cells.keys()].sort((i, j) => v.primary(cells[i]) - v.primary(cells[j]))

  // --- 1단계
  for (let a = 0; a < order.length; a++) {
    const i = order[a], A = cells[i]
    const [, aEnd] = v.pSpan(A)
    const [as0, as1] = v.sSpan(A)
    for (let b = a + 1; b < order.length; b++) {
      const j = order[b], B = cells[j]
      if (v.primary(B) - v.primary(A) > v.pSize * 1.9) break
      const [bStart] = v.pSpan(B)
      const gap = bStart - aEnd
      if (gap < -v.pSize * 0.35 || gap > v.pSize * 0.6) continue
      const [bs0, bs1] = v.sSpan(B)
      const ov = overlap1d(as0, as1, bs0, bs1)
      // min 이 아니라 max 로 나눈다 = 양쪽 모두 절반 넘게 겹쳐야 한다.
      // 인쇄상 두 줄을 합쳐놓은 셀(예: "성명" 헤더)이 이웃한 두 줄을 이어붙이는 것을 막는다.
      if (ov / Math.max(as1 - as0, bs1 - bs0) > 0.5) ds.union(i, j)
    }
  }

  let chains = ds.groups().map(g =>
    [...g].sort((i, j) => v.primary(cells[i]) - v.primary(cells[j])))

  // --- 2단계
  chains = joinChains(chains, cells, v)

  // 남은 파편 제거 (자리는 fillGaps 가 복원한다)
  const med = median(chains.map(c => c.length))
  const floor = Math.max(2, Math.round(med * 0.25))
  chains = chains.filter(c => c.length >= floor)

  // 종이가 휘어 있으면 줄마다 걸치는 구간이 달라서, 좌표의 단순 평균으로는
  // 서로 다른 줄을 비교할 수 없다(많이 걸친 줄과 조금 걸친 줄의 평균이 다른 곳을 가리킨다).
  // 그래서 모든 줄을 **같은 기준선**에서 평가한 위치로 비교한다.
  const anchor = median(cells.map(c => v.primary(c)))
  const centerAt = (chain: number[]): number =>
    fitLine(chain.map(i => [v.primary(cells[i]), v.secondary(cells[i])] as [number, number]))(anchor)

  chains.sort((p, q) => centerAt(p) - centerAt(q))
  return absorbWeakLines(chains, cells, v, centerAt)
}


/**
 * 빈약한 줄을 이웃에 흡수시킨다.
 *
 * 진짜 줄은 표의 거의 모든 칸을 채운다. 이웃의 절반도 안 되는 셀만 가진 줄이
 * 이웃과 한 칸 간격보다 가까이 붙어 있다면, 그것은 별개의 줄이 아니라
 * 잘못 갈라져 나온 조각이다. 가까운 쪽으로 합친다.
 *
 * (근무표의 집계 컬럼처럼 원래부터 좁은 진짜 열까지 합쳐버리지 않도록,
 *  "셀 수가 현저히 적다"와 "간격이 현저히 좁다"를 모두 만족할 때만 흡수한다.)
 */
function absorbWeakLines(
  chains: number[][],
  cells: CellBox[],
  v: AxisView,
  centerOf: (chain: number[]) => number,
): number[][] {
  if (chains.length < 3) return chains

  const centers = chains.map(centerOf)
  const pitch = median(centers.slice(1).map((c, i) => c - centers[i]))
  const strength = chains.map(c => c.length)
  const med = median(strength)
  if (pitch <= 0 || med <= 0) return chains

  const alive = chains.map(c => [...c])
  for (let i = 0; i < alive.length; i++) {
    if (!alive[i].length) continue
    if (strength[i] >= med * 0.4) continue

    let target = -1
    let bestDist = pitch * 0.8
    for (let j = 0; j < alive.length; j++) {
      if (j === i || !alive[j].length || strength[j] < strength[i]) continue
      const d = Math.abs(centers[j] - centers[i])
      if (d < bestDist) { bestDist = d; target = j }
    }
    if (target >= 0) {
      alive[target] = alive[target].concat(alive[i])
      alive[i] = []
    }
  }

  return alive.filter(c => c.length > 0).sort((p, q) => centerOf(p) - centerOf(q))
}

function joinChains(chains: number[][], cells: CellBox[], v: AxisView): number[][] {
  const EDGE = 5 // 외삽에 쓸 끝부분 셀 개수

  for (let pass = 0; pass < 4; pass++) {
    const live = chains.filter(c => c.length > 0)
    live.sort((a, b) => v.primary(cells[a[0]]) - v.primary(cells[b[0]]))

    const candidates: Array<{ gap: number; a: number; b: number }> = []
    for (let a = 0; a < live.length; a++) {
      const A = live[a]
      const aLast = A[A.length - 1]
      const aEnd = v.pSpan(cells[aLast])[1]
      const fwd = fitLine(A.slice(-EDGE).map(i =>
        [v.primary(cells[i]), v.secondary(cells[i])] as [number, number]))

      for (let b = 0; b < live.length; b++) {
        if (a === b) continue
        const B = live[b]
        const bFirst = B[0]
        const bStart = v.pSpan(cells[bFirst])[0]
        const gap = bStart - aEnd
        if (gap <= 0 || gap > v.pSize * 5) continue

        const back = fitLine(B.slice(0, EDGE).map(i =>
          [v.primary(cells[i]), v.secondary(cells[i])] as [number, number]))

        const errFwd = Math.abs(fwd(v.primary(cells[bFirst])) - v.secondary(cells[bFirst]))
        const errBack = Math.abs(back(v.primary(cells[aLast])) - v.secondary(cells[aLast]))
        // 양방향 예측이 모두 맞아야 같은 줄로 인정한다
        if (errFwd < v.sSize * 0.5 && errBack < v.sSize * 0.5) {
          candidates.push({ gap, a, b })
        }
      }
    }
    if (!candidates.length) break

    // 가까운 것부터 이어붙이되, 한 조각이 두 번 쓰이지 않게 한다
    candidates.sort((x, y) => x.gap - y.gap)
    const usedTail = new Set<number>()
    const usedHead = new Set<number>()
    let joined = false
    for (const { a, b } of candidates) {
      if (usedTail.has(a) || usedHead.has(b) || a === b) continue
      if (!live[a].length || !live[b].length) continue
      usedTail.add(a); usedHead.add(b)
      live[a] = live[a].concat(live[b])
      live[b] = []
      joined = true
    }
    chains = live.filter(c => c.length > 0)
      .map(c => [...c].sort((i, j) => v.primary(cells[i]) - v.primary(cells[j])))
    if (!joined) break
  }
  return chains
}

/* ------------------------------------------------------------------ */

export function buildLattice(cells: CellBox[]): Lattice {
  if (cells.length === 0) return { rows: 0, cols: 0, matrix: [], colAnchors: [], rowAnchors: [] }

  const cw = median(cells.map(c => c.w))
  const ch = median(cells.map(c => c.h))

  const rowGroups = buildAxis(cells, {
    primary: c => c.cx, secondary: c => c.cy,
    pSpan: c => [c.x, c.x + c.w], sSpan: c => [c.y, c.y + c.h],
    pSize: cw, sSize: ch,
  })
  const colGroups = buildAxis(cells, {
    primary: c => c.cy, secondary: c => c.cx,
    pSpan: c => [c.y, c.y + c.h], sSpan: c => [c.x, c.x + c.w],
    pSize: ch, sSize: cw,
  })

  const rowOf = new Map<number, number>()
  rowGroups.forEach((g, r) => g.forEach(i => rowOf.set(i, r)))
  const colOf = new Map<number, number>()
  colGroups.forEach((g, c) => g.forEach(i => colOf.set(i, c)))

  const R = rowGroups.length
  const C = colGroups.length
  const matrix: LatticeCell[][] = Array.from({ length: R }, () => Array<LatticeCell>(C))

  const placed: Array<[number, number]> = []
  for (let i = 0; i < cells.length; i++) {
    const r = rowOf.get(i), c = colOf.get(i)
    if (r === undefined || c === undefined) continue
    const k = cells[i]
    matrix[r][c] = { x: k.x, y: k.y, w: k.w, h: k.h, cx: k.cx, cy: k.cy, detected: true }
    placed.push([r, c])
  }

  fillGaps(matrix, rowGroups, colGroups, cells, R, C)

  const anchorX = median(cells.map(c => c.cx))
  const anchorY = median(cells.map(c => c.cy))
  const colAnchors = colGroups.map(g =>
    fitLine(g.map(i => [cells[i].cy, cells[i].cx] as [number, number]))(anchorY))
  const rowAnchors = rowGroups.map(g =>
    fitLine(g.map(i => [cells[i].cx, cells[i].cy] as [number, number]))(anchorX))

  return { rows: R, cols: C, matrix, colAnchors, rowAnchors }
}

function fillGaps(
  matrix: LatticeCell[][],
  rowGroups: number[][],
  colGroups: number[][],
  cells: CellBox[],
  R: number, C: number,
): void {
  const rowY = rowGroups.map(g => fitLine(g.map(i => [cells[i].cx, cells[i].cy] as [number, number])))
  const colX = colGroups.map(g => fitLine(g.map(i => [cells[i].cy, cells[i].cx] as [number, number])))
  const rowH = rowGroups.map(g => median(g.map(i => cells[i].h)))
  const colW = colGroups.map(g => median(g.map(i => cells[i].w)))
  const anchorY = median(cells.map(c => c.cy))
  const colCx = colGroups.map((g, i) => colX[i](anchorY))

  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      if (matrix[r][c]) continue
      let x = colCx[c]
      let y = rowY[r](x)
      for (let k = 0; k < 2; k++) { x = colX[c](y); y = rowY[r](x) }
      const w = colW[c], h = rowH[r]
      matrix[r][c] = {
        x: Math.round(x - w / 2), y: Math.round(y - h / 2),
        w: Math.round(w), h: Math.round(h),
        cx: x, cy: y, detected: false,
      }
    }
  }
}
