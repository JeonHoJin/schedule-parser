import type { CellBox, Gray, Rgba } from './types'
import {
  bitwiseNot, bitwiseOr, dilateRect, openRect, resizeRgbaArea, toGrayMaxRgb,
} from './image'
import { normalizeBackground, otsuThreshold, thresholdInverse } from './binarize'
import { connectedComponents, filterCells } from './components'
import { buildLattice, type Lattice } from './lattice'

export interface DetectOptions {
  /** 내부 처리 해상도(가로). 기본 2400 */
  workWidth: number
  /** 격자선 추출 커널 길이를 셀 크기의 몇 배로 잡을지 */
  lineRatioH: number
  lineRatioV: number
  /** 셀 크기 추정 후 커널을 다시 맞춰 한 번 더 돌린다 */
  refine: boolean
}

export const DEFAULT_OPTIONS: DetectOptions = {
  workWidth: 2400,
  lineRatioH: 0.75,
  lineRatioV: 0.65,
  refine: true,
}

export interface DetectResult {
  lattice: Lattice
  cells: CellBox[]
  /** 내부 처리 좌표계의 작업 이미지 — 셀 크롭·디버그 렌더링에 사용 */
  work: Rgba
  gray: Gray
  /** 배경 정규화된 그레이스케일 — 종이는 255 근처, 잉크는 어둡다 */
  normalized: Gray
  binary: Gray
  gridMask: Gray
  cellW: number
  cellH: number
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** 표를 가로로 눕힌다(가로가 세로보다 길도록). */
export function ensureLandscape(img: Rgba): Rgba {
  if (img.width >= img.height) return img
  const { width: w, height: h, data: s } = img
  const d = new Uint8Array(s.length)
  // 시계방향 90도
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4
      const di = ((x * h) + (h - 1 - y)) * 4
      d[di] = s[si]; d[di + 1] = s[si + 1]; d[di + 2] = s[si + 2]; d[di + 3] = 255
    }
  }
  return { width: h, height: w, data: d }
}

function extractGrid(bw: Gray, kh: number, kv: number): Gray {
  const horizontal = openRect(bw, Math.max(3, kh | 1), 1)
  const vertical = openRect(bw, 1, Math.max(3, kv | 1))
  return dilateRect(bitwiseOr(horizontal, vertical), 3, 3)
}

function cellsFrom(gridMask: Gray, cw: number, ch: number): CellBox[] {
  const { stats } = connectedComponents(bitwiseNot(gridMask))
  return filterCells(stats, {
    minW: cw * 0.45, maxW: cw * 2.6,
    minH: ch * 0.5, maxH: ch * 2.2,
    minArea: cw * ch * 0.25,
    minFill: 0.62,
  })
}

/**
 * 사진 한 장에서 표 격자를 복원한다.
 *
 * 파이프라인
 *   1. 가로 방향 정렬 + 작업 해상도로 축소
 *   2. max(R,G,B) 그레이스케일 — 형광펜 억제
 *   3. 배경 정규화 + Otsu — 회색 음영과 조명 제거
 *   4. 모폴로지 열림으로 격자선만 남김
 *   5. 격자선 반전 → 연결요소 = 셀
 *   6. 국소 인접 union-find 로 행·열 복원 + 누락 셀 보간
 */
export function detectGrid(input: Rgba, opts: Partial<DetectOptions> = {}): DetectResult {
  const o = { ...DEFAULT_OPTIONS, ...opts }

  const landscape = ensureLandscape(input)
  const scale = Math.min(1, o.workWidth / landscape.width)
  const work = scale < 1
    ? resizeRgbaArea(landscape, Math.round(landscape.width * scale), Math.round(landscape.height * scale))
    : landscape

  const gray = toGrayMaxRgb(work)
  const normalized = normalizeBackground(gray)
  const binary = thresholdInverse(normalized, otsuThreshold(normalized))

  // 1차: 셀 크기를 모르므로 표가 40열 × 34행쯤 된다고 가정한 값으로 시작
  let cw = work.width / 45
  let ch = work.height / 38
  let gridMask = extractGrid(binary, cw * o.lineRatioH, ch * o.lineRatioV)
  let cells = cellsFrom(gridMask, cw, ch)

  if (o.refine && cells.length > 50) {
    cw = median(cells.map(c => c.w))
    ch = median(cells.map(c => c.h))
    gridMask = extractGrid(binary, cw * o.lineRatioH, ch * o.lineRatioV)
    cells = cellsFrom(gridMask, cw, ch)
    cw = median(cells.map(c => c.w))
    ch = median(cells.map(c => c.h))
  }

  return {
    lattice: buildLattice(cells), cells,
    work, gray, normalized, binary, gridMask,
    cellW: cw, cellH: ch,
  }
}
