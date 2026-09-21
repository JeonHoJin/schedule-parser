/**
 * 검출된 격자에서 각 간호사 행의 이름 칸과 사번 칸을 각각 잘라 <canvas> 로 만든다.
 *
 * 이전 버전은 [이미지 왼쪽 끝 ~ day1] 전체를 한 조각으로 잘라 Tesseract 에 넘겼는데,
 * 그러면 이름과 사번이 뒤섞여 인식률이 크게 떨어졌다. 사번 열 위치는
 * `packages/recognize/src/digits.ts` 의 `empnoBox` 와 같은 규칙으로 계산해서
 * 그 왼쪽만 이름 칸으로 잡는다.
 */
import type { PreparedSheet } from '@sp/recognize'
import { empnoBox } from '@sp/recognize'
import type { Box, Rgba } from '@sp/vision'

export interface RowStrips {
  row: number
  nameCanvas: HTMLCanvasElement
  empnoCanvas: HTMLCanvasElement
  nameBox: Box
  empnoBox: Box
}

/** 이전 이름 OCR API 유지 — 이름 크롭만 반환. */
export interface NameStrip {
  row: number
  canvas: HTMLCanvasElement
  box: { x: number; y: number; w: number; h: number }
}

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
      dst[di] = s[so]; dst[di + 1] = s[so + 1]; dst[di + 2] = s[so + 2]; dst[di + 3] = 255
    }
  }
  ctx.putImageData(out, 0, 0)
  return canvas
}

/** prepareEmpnoColumn 과 동일 규칙으로 사번 열 픽셀 너비를 계산 */
function empnoWidth(sheet: PreparedSheet): number {
  const matrix = sheet.detect.lattice.matrix
  const detected = sheet.nurseRows.map(r => matrix[r][0]).filter(b => b.detected).map(b => b.w)
  if (detected.length) {
    const sorted = [...detected].sort((a, b) => a - b)
    return sorted[sorted.length >> 1]
  }
  return matrix[sheet.nurseRows[0]][0].w
}

export function rowStrips(sheet: PreparedSheet): RowStrips[] {
  const work = sheet.detect.work
  const matrix = sheet.detect.lattice.matrix
  const width = empnoWidth(sheet)
  const gap = 6

  return sheet.nurseRows.map(row => {
    const day1 = sheet.boxOf(row, 1)
    const latticeCell = matrix[row][0]
    const empno = empnoBox(day1, latticeCell, width, gap)

    const nameX = 0
    const nameY = Math.max(0, Math.round(empno.y - 2))
    const nameW = Math.max(1, Math.round(empno.x - nameX - 2))
    const nameH = Math.max(1, Math.min(work.height - nameY, Math.round(empno.h + 4)))

    const empX = Math.max(0, Math.round(empno.x))
    const empY = Math.max(0, Math.round(empno.y - 2))
    const empW = Math.max(1, Math.min(work.width - empX, Math.round(empno.w)))
    const empH = Math.max(1, Math.min(work.height - empY, Math.round(empno.h + 4)))

    return {
      row,
      nameCanvas: cropToCanvas(work, nameX, nameY, nameW, nameH),
      empnoCanvas: cropToCanvas(work, empX, empY, empW, empH),
      nameBox: { x: nameX, y: nameY, w: nameW, h: nameH },
      empnoBox: { x: empX, y: empY, w: empW, h: empH },
    }
  })
}

/** 이전 API — 이름 크롭만 반환 (기존 코드 호환) */
export function nameStrips(sheet: PreparedSheet): NameStrip[] {
  return rowStrips(sheet).map(r => ({ row: r.row, canvas: r.nameCanvas, box: r.nameBox }))
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
  const full = cropToCanvas(work, 0, 0, work.width, work.height)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(full, 0, 0, w, h)
  return c
}
