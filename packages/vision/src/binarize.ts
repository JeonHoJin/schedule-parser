import type { Gray } from './types'
import { boxBlur, closeRect } from './image'
import { grayOf } from './types'

/**
 * 배경 정규화.
 *
 * 닫힘 연산으로 글자를 지운 "배경만 있는 이미지"를 만들고, 원본을 그 배경으로 나눈다.
 * 근무표의 회색 음영 컬럼(주말)과 촬영 시 조명 그라데이션이 함께 제거되어,
 * 전역 임계값(Otsu) 하나로 전체 이미지를 이진화할 수 있게 된다.
 */
export function normalizeBackground(g: Gray, structure = 31, blur = 30): Gray {
  const bg = boxBlur(closeRect(g, structure, structure), blur)
  const out = grayOf(g.width, g.height)
  for (let i = 0; i < out.data.length; i++) {
    const b = bg.data[i]
    out.data[i] = b === 0 ? 255 : Math.min(255, Math.round((g.data[i] * 255) / b))
  }
  return out
}

/** Otsu 임계값 (0~255) */
export function otsuThreshold(g: Gray): number {
  const hist = new Float64Array(256)
  for (let i = 0; i < g.data.length; i++) hist[g.data[i]]++
  const total = g.data.length
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]

  let sumB = 0, wB = 0, best = 0, bestVar = -1
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > bestVar) { bestVar = between; best = t }
  }
  return best
}

/** 임계값 이하를 전경(255)으로 하는 반전 이진화 — 어두운 잉크가 전경이 된다. */
export function thresholdInverse(g: Gray, t: number): Gray {
  const out = grayOf(g.width, g.height)
  for (let i = 0; i < out.data.length; i++) out.data[i] = g.data[i] <= t ? 255 : 0
  return out
}
