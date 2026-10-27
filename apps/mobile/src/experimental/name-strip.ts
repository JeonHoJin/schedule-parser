/**
 * 검출된 격자에서 각 간호사 행의 이름 칸과 사번 칸을 각각 잘라 <canvas> 로 만든다.
 *
 * 이름·사번 위치는 공통 격자 해석 결과를 사용한다.
 * 사번이 없는 양식은 빈 조각을 보내 근무 칸을 사번으로 읽지 않게 한다.
 */
import type { PreparedSheet } from '@sp/recognize'
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

/** Shared identity boxes keep name-only layouts from treating day 1 as an employee ID. */
export function rowStrips(sheet: PreparedSheet): RowStrips[] {
  const work = sheet.detect.work
  const padded = (box: Box): Box => {
    const x = Math.max(0, Math.round(box.x - 3))
    const y = Math.max(0, Math.round(box.y - 3))
    return {
      x, y,
      w: Math.max(1, Math.min(work.width - x, Math.round(box.x + box.w + 3) - x)),
      h: Math.max(1, Math.min(work.height - y, Math.round(box.y + box.h + 3) - y)),
    }
  }

  return sheet.nurseRows.map(row => {
    const identity = sheet.identityBoxOf(row)
    const nameBox = padded(identity.name)
    const empnoBox = identity.empno ? padded(identity.empno) : { x: 0, y: 0, w: 1, h: 1 }
    const empnoCanvas = identity.empno
      ? cropToCanvas(work, empnoBox.x, empnoBox.y, empnoBox.w, empnoBox.h)
      : document.createElement('canvas')
    if (!identity.empno) {
      empnoCanvas.width = 1
      empnoCanvas.height = 1
      const ctx = empnoCanvas.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, 1, 1)
    }
    return {
      row,
      nameCanvas: cropToCanvas(work, nameBox.x, nameBox.y, nameBox.w, nameBox.h),
      empnoCanvas, nameBox, empnoBox,
    }
  })
}

function rotate180(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = src.width
  out.height = src.height
  const ctx = out.getContext('2d')!
  ctx.translate(src.width, src.height)
  ctx.rotate(Math.PI)
  ctx.drawImage(src, 0, 0)
  return out
}

/** 흰 여백을 두른다. 가장자리에 붙은 글자는 Vision 이 통째로 빠뜨리는 일이 있었다. */
function padWhite(src: HTMLCanvasElement, margin: number): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = src.width + margin * 2
  out.height = src.height + margin * 2
  const ctx = out.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(src, margin, margin)
  return out
}

export interface TitleStrips {
  /** 격자 위쪽 — 방향이 맞으면 여기 제목이 있다 */
  above: HTMLCanvasElement[]
  /** 격자 아래쪽을 180° 돌린 것 — 사진이 뒤집혀 파싱됐다면 제목이 여기 있다 */
  below: HTMLCanvasElement[]
}

/**
 * 표 제목 줄("OO병동 2026 년 10 월 근무표")을 서버 OCR 로 보낼 조각.
 * 띠 전체와 가운데 60% 를 함께 보낸다: 넓은 띠만으로는 가장자리 글자·그림자 때문에
 * 제목을 놓치는 사진이 있었다. 정/역방향 자동 판별은 D·N·// 처럼 뒤집어도 비슷한 글자
 * 때문에 거의 동점이 나므로, 제목이 어느 쪽에 있는지로 방향을 확정한다.
 */
export function titleStrips(sheet: PreparedSheet): TitleStrips {
  const work = sheet.detect.work
  const cells = sheet.detect.lattice.matrix.flat()
  const top = Math.floor(Math.min(...cells.map(c => c.y)))
  const bottom = Math.ceil(Math.max(...cells.map(c => c.y + c.h)))
  const midX = Math.round(work.width * 0.2), midW = Math.round(work.width * 0.6)
  const band = (y: number, h: number) => [cropToCanvas(work, 0, y, work.width, h), cropToCanvas(work, midX, y, midW, h)]
  return {
    above: Number.isFinite(top) && top >= 16 ? band(0, top).map(c => padWhite(c, 40)) : [],
    below: Number.isFinite(bottom) && work.height - bottom >= 16
      ? band(bottom, work.height - bottom).map(c => padWhite(rotate180(c), 40)) : [],
  }
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
