import type { Box, Rgba } from './types'

/** 원본에서 박스 영역을 잘라낸다(범위 밖은 흰색). */
export function crop(src: Rgba, box: Box, pad = 0): Rgba {
  const w = box.w + pad * 2
  const h = box.h + pad * 2
  const d = new Uint8Array(w * h * 4).fill(255)
  for (let y = 0; y < h; y++) {
    const sy = box.y - pad + y
    if (sy < 0 || sy >= src.height) continue
    for (let x = 0; x < w; x++) {
      const sx = box.x - pad + x
      if (sx < 0 || sx >= src.width) continue
      const s = (sy * src.width + sx) * 4
      const o = (y * w + x) * 4
      d[o] = src.data[s]; d[o + 1] = src.data[s + 1]
      d[o + 2] = src.data[s + 2]; d[o + 3] = 255
    }
  }
  return { width: w, height: h, data: d }
}

/** 최근접 이웃 리샘플 — 셀처럼 작은 이미지를 고정 크기로 맞출 때 사용 */
export function resampleNearest(src: Rgba, w: number, h: number): Rgba {
  const d = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / h))
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / w))
      const s = (sy * src.width + sx) * 4
      const o = (y * w + x) * 4
      d[o] = src.data[s]; d[o + 1] = src.data[s + 1]
      d[o + 2] = src.data[s + 2]; d[o + 3] = 255
    }
  }
  return { width: w, height: h, data: d }
}
