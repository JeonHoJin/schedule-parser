import type { Gray, Rgba } from './types'
import { grayOf } from './types'

/**
 * 형광펜 억제 그레이스케일.
 *
 * 일반적인 휘도 변환(0.299R+0.587G+0.114B) 대신 max(R,G,B)를 쓴다.
 * 형광펜(분홍·주황·노랑)은 최소 한 채널이 매우 밝으므로 흰색에 가깝게 밀려나고,
 * 검은 인쇄 잉크는 세 채널 모두 어두우므로 그대로 남는다.
 */
export function toGrayMaxRgb(src: Rgba): Gray {
  const out = grayOf(src.width, src.height)
  const s = src.data
  const d = out.data
  for (let i = 0, p = 0; i < d.length; i++, p += 4) {
    const r = s[p], g = s[p + 1], b = s[p + 2]
    d[i] = r > g ? (r > b ? r : b) : g > b ? g : b
  }
  return out
}

/** 면적 평균 축소. 확대는 지원하지 않는다(축소 전용). */
export function resizeRgbaArea(src: Rgba, dstW: number, dstH: number): Rgba {
  const { width: sw, height: sh, data: s } = src
  const d = new Uint8Array(dstW * dstH * 4)
  const xr = sw / dstW
  const yr = sh / dstH
  for (let y = 0; y < dstH; y++) {
    const y0 = Math.floor(y * yr)
    const y1 = Math.max(y0 + 1, Math.min(sh, Math.ceil((y + 1) * yr)))
    for (let x = 0; x < dstW; x++) {
      const x0 = Math.floor(x * xr)
      const x1 = Math.max(x0 + 1, Math.min(sw, Math.ceil((x + 1) * xr)))
      let r = 0, g = 0, b = 0, n = 0
      for (let yy = y0; yy < y1; yy++) {
        let p = (yy * sw + x0) * 4
        for (let xx = x0; xx < x1; xx++, p += 4) {
          r += s[p]; g += s[p + 1]; b += s[p + 2]; n++
        }
      }
      const o = (y * dstW + x) * 4
      d[o] = (r / n) | 0
      d[o + 1] = (g / n) | 0
      d[o + 2] = (b / n) | 0
      d[o + 3] = 255
    }
  }
  return { width: dstW, height: dstH, data: d }
}

/* ------------------------------------------------------------------ *
 * 1차원 슬라이딩 극값 필터 (monotonic deque, O(n))
 * 사각 구조요소 모폴로지는 가로/세로로 분리 가능하므로 이 하나로 전부 구성한다.
 * ------------------------------------------------------------------ */

function slide1d(
  src: Uint8Array, dst: Uint8Array,
  count: number, len: number, base: number, stride: number,
  k: number, isMax: boolean,
): void {
  const radius = k >> 1
  const dq = new Int32Array(len)
  for (let c = 0; c < count; c++) {
    const off = base * c
    let head = 0, tail = 0
    for (let i = 0; i < len + radius; i++) {
      if (i < len) {
        const v = src[off + i * stride]
        while (tail > head) {
          const w = src[off + dq[tail - 1] * stride]
          if (isMax ? w <= v : w >= v) tail--
          else break
        }
        dq[tail++] = i
      }
      const o = i - radius
      if (o >= 0) {
        while (head + 1 < tail && dq[head] < o - radius) head++
        dst[off + o * stride] = src[off + dq[head] * stride]
      }
    }
  }
}

const horiz = (g: Gray, k: number, isMax: boolean): Gray => {
  const out = grayOf(g.width, g.height)
  slide1d(g.data, out.data, g.height, g.width, g.width, 1, k, isMax)
  return out
}
const vert = (g: Gray, k: number, isMax: boolean): Gray => {
  const out = grayOf(g.width, g.height)
  slide1d(g.data, out.data, g.width, g.height, 1, g.width, k, isMax)
  return out
}

export const dilateH = (g: Gray, k: number) => horiz(g, k, true)
export const dilateV = (g: Gray, k: number) => vert(g, k, true)
export const erodeH = (g: Gray, k: number) => horiz(g, k, false)
export const erodeV = (g: Gray, k: number) => vert(g, k, false)

/** 사각 구조요소 팽창 */
export const dilateRect = (g: Gray, kw: number, kh: number) =>
  dilateV(dilateH(g, kw), kh)
/** 사각 구조요소 침식 */
export const erodeRect = (g: Gray, kw: number, kh: number) =>
  erodeV(erodeH(g, kw), kh)
/** 열림 = 침식 후 팽창. 구조요소보다 얇은 것을 지운다. */
export const openRect = (g: Gray, kw: number, kh: number) =>
  dilateRect(erodeRect(g, kw, kh), kw, kh)
/** 닫힘 = 팽창 후 침식. 구조요소보다 좁은 틈을 메운다. */
export const closeRect = (g: Gray, kw: number, kh: number) =>
  erodeRect(dilateRect(g, kw, kh), kw, kh)

/** 분리 가능 박스 블러 (이동 평균, O(n)) */
export function boxBlur(g: Gray, radius: number): Gray {
  const { width: w, height: h } = g
  const k = radius * 2 + 1
  const tmp = new Float32Array(w * h)
  const out = grayOf(w, h)

  for (let y = 0; y < h; y++) {
    const row = y * w
    let sum = 0
    for (let i = -radius; i <= radius; i++) sum += g.data[row + Math.min(w - 1, Math.max(0, i))]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / k
      const add = g.data[row + Math.min(w - 1, x + radius + 1)]
      const sub = g.data[row + Math.max(0, x - radius)]
      sum += add - sub
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let i = -radius; i <= radius; i++) sum += tmp[Math.min(h - 1, Math.max(0, i)) * w + x]
    for (let y = 0; y < h; y++) {
      out.data[y * w + x] = Math.min(255, Math.max(0, Math.round(sum / k)))
      const add = tmp[Math.min(h - 1, y + radius + 1) * w + x]
      const sub = tmp[Math.max(0, y - radius) * w + x]
      sum += add - sub
    }
  }
  return out
}

export function bitwiseOr(a: Gray, b: Gray): Gray {
  const out = grayOf(a.width, a.height)
  for (let i = 0; i < out.data.length; i++) out.data[i] = a.data[i] | b.data[i]
  return out
}

export function bitwiseNot(a: Gray): Gray {
  const out = grayOf(a.width, a.height)
  for (let i = 0; i < out.data.length; i++) out.data[i] = 255 - a.data[i]
  return out
}

/** 그레이스케일 면적 평균 축소 */
export function resizeGrayArea(src: Gray, dstW: number, dstH: number): Gray {
  const { width: sw, height: sh, data: s } = src
  const out = grayOf(dstW, dstH)
  const xr = sw / dstW, yr = sh / dstH
  for (let y = 0; y < dstH; y++) {
    const y0 = Math.floor(y * yr)
    const y1 = Math.max(y0 + 1, Math.min(sh, Math.ceil((y + 1) * yr)))
    for (let x = 0; x < dstW; x++) {
      const x0 = Math.floor(x * xr)
      const x1 = Math.max(x0 + 1, Math.min(sw, Math.ceil((x + 1) * xr)))
      let sum = 0, n = 0
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) { sum += s[yy * sw + xx]; n++ }
      }
      out.data[y * dstW + x] = n ? Math.round(sum / n) : 0
    }
  }
  return out
}

/** 그레이스케일 박스 잘라내기 (범위 밖은 0) */
export function cropGray(src: Gray, x0: number, y0: number, w: number, h: number): Gray {
  const out = grayOf(w, h)
  for (let y = 0; y < h; y++) {
    const sy = y0 + y
    if (sy < 0 || sy >= src.height) continue
    for (let x = 0; x < w; x++) {
      const sx = x0 + x
      if (sx < 0 || sx >= src.width) continue
      out.data[y * w + x] = src.data[sy * src.width + sx]
    }
  }
  return out
}

/**
 * 이진 이미지의 3×3 다수결 필터 (잡티 제거).
 *
 * 인쇄물의 회색 음영은 실제로는 **하프톤 점**의 집합이라, 이진화하면 고립된 점 잡티가 된다.
 * 3×3 이웃 9칸 중 5칸 이상이 잉크일 때만 잉크로 남기면, 점은 사라지고
 * 3px 안팎의 글자 획은 살아남는다.
 */
export function majority3x3(bin: Gray): Gray {
  const { width: w, height: h, data: s } = bin
  const out = grayOf(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          if (s[yy * w + xx] > 127) n++
        }
      }
      out.data[y * w + x] = n >= 5 ? 255 : 0
    }
  }
  return out
}
