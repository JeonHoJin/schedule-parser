/**
 * 검출된 격자에서 각 간호사 행의 왼쪽(이름·사번이 인쇄된 영역)을
 * 잘라 <canvas> 로 만들어 OCR 에 넘긴다.
 *
 * 사번이 있는 근무표에서는 이 영역에 이름+사번이 함께 들어 있고,
 * 사번이 없는 과거 근무표에서는 이름만 들어 있다. Tesseract 는
 * 어느 쪽이든 인쇄된 문자를 그대로 뽑아 준다.
 */
import type { PreparedSheet } from '@sp/recognize'
import type { Rgba } from '@sp/vision'

export interface NameStrip {
  row: number
  canvas: HTMLCanvasElement
  /** 디버그용: 원본 work 이미지 좌표계에서의 크롭 박스 */
  box: { x: number; y: number; w: number; h: number }
}

export interface StripOptions {
  /** 크롭 여백 (px) */
  pad?: number
}

/** work 이미지에서 [x, y, w, h] 를 잘라 새 canvas 로 돌려준다 */
function cropToCanvas(src: Rgba, x: number, y: number, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const out = ctx.createImageData(w, h)
  const dst = out.data
  const s = src.data
  for (let yy = 0; yy < h; yy++) {
    const sy = y + yy
    if (sy < 0 || sy >= src.height) continue
    for (let xx = 0; xx < w; xx++) {
      const sx = x + xx
      if (sx < 0 || sx >= src.width) continue
      const so = (sy * src.width + sx) * 4
      const di = (yy * w + xx) * 4
      dst[di] = s[so]
      dst[di + 1] = s[so + 1]
      dst[di + 2] = s[so + 2]
      dst[di + 3] = 255
    }
  }
  ctx.putImageData(out, 0, 0)
  return canvas
}

/**
 * 각 행에서 x=0 부터 day1 셀 바로 앞까지를 크롭한다.
 * matrix[row][0] 이 시각적 최좌측 열이 아닐 수 있으므로 무조건 이미지 왼쪽 끝(0)부터.
 */
export function nameStrips(sheet: PreparedSheet, opts: StripOptions = {}): NameStrip[] {
  const pad = opts.pad ?? 2
  const work = sheet.detect.work
  return sheet.nurseRows.map(row => {
    const day1 = sheet.boxOf(row, 1)
    const x0 = 0
    const y0 = Math.max(0, Math.round(day1.y - pad))
    const w = Math.max(1, Math.min(work.width - x0, Math.round(day1.x - pad)))
    const h = Math.max(1, Math.min(work.height - y0, Math.round(day1.h + pad * 2)))
    return { row, canvas: cropToCanvas(work, x0, y0, w, h), box: { x: x0, y: y0, w, h } }
  })
}

/** 전체 work 이미지를 canvas 로 (디버그 오버레이용) */
export function workToCanvas(sheet: PreparedSheet, maxWidth = 800): HTMLCanvasElement {
  const work = sheet.detect.work
  const scale = Math.min(1, maxWidth / work.width)
  const w = Math.round(work.width * scale)
  const h = Math.round(work.height * scale)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  // 축소가 필요하면 원본을 그린 뒤 scale 로 다시 그리기가 정확하지만
  // 여기서는 시각 확인용이라 nearest-neighbor 로 충분
  const full = cropToCanvas(work, 0, 0, work.width, work.height)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(full, 0, 0, w, h)
  return c
}
