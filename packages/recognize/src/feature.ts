import type { Box, Gray } from '@sp/vision'
import { boxBlur, cropGray, resizeGrayArea } from '@sp/vision'

export interface FeatureConfig {
  /** 특징 창의 원본 픽셀 크기 — 셀(약 46×38)보다 조금 작게 잡아 격자선을 배제한다 */
  winW: number
  winH: number
  /** 특징 벡터 해상도 */
  featW: number
  featH: number
  /** 하프톤을 평탄화하는 흐림 반경 */
  blur: number
  /** 국소 배경을 추정할 반경 — 글자보다 크고 형광펜 경계보다는 작아야 한다 */
  localRadius: number
  /** 국소 배경보다 이만큼 어두우면 잉크 */
  delta: number
  /** 셀 전체에서 최소 이만큼의 대비가 없으면 빈 칸으로 본다 */
  minContrast: number
  /** 셀 경계에서 안쪽으로 파고들 픽셀 (격자선 배제) */
  inset: number
  /** 창 정렬 기준: 잉크 경계상자 중심 vs 잉크 무게중심 */
  center: 'bbox' | 'centroid'
  /** 마스크에서 표의 괘선(거의 전체를 채우는 행·열)을 지운다 */
  stripRules: boolean
}

export const DEFAULT_FEATURE: FeatureConfig = {
  winW: 38, winH: 32,
  featW: 19, featH: 16,
  blur: 2,
  localRadius: 14,
  delta: 16,
  minContrast: 18,
  inset: 3,
  center: 'centroid',
  stripRules: false,
}


export interface CellFeature {
  /** 평균 0, 노름 1 로 정규화된 벡터 (코사인 유사도용) */
  vector: Float32Array
  /** 잉크 비율 0~1 — 빈 칸 판정용 */
  ink: number
  inkW: number
  inkH: number
  /** 축소된 특징 이미지 (디버그용, 잉크가 밝게 보이도록 반전) */
  patch: Gray
}

/**
 * 셀 하나를 비교 가능한 특징 벡터로 만든다.
 *
 * ## 왜 이진화 이미지를 쓰지 않는가
 *
 * 근무표의 회색 음영(주말 컬럼)은 균일한 회색이 아니라 **하프톤 점의 격자**다.
 * 이걸 그대로 이진화하면 점들이 잉크로 살아남아, 같은 글자라도 흰 칸에 있느냐
 * 회색 칸에 있느냐에 따라 완전히 다른 벡터가 된다. 실제로 클러스터가 190개로 쪼개졌다.
 *
 * 그래서 **먼저 흐리게 만든다.** 하프톤 점은 서로 뭉개져 평탄한 중간 회색이 되고,
 * 속이 꽉 찬 글자 획은 여전히 어둡게 남는다. 이 상태에서 고정 임계값으로 자르면
 * 배경색과 무관하게 글자만 남는다.
 *
 * ## 왜 잉크 중심에 창을 맞추는가
 *
 * 셀 박스는 검출이든 보간이든 1~3px 흔들린다. 셀 전체를 그대로 축소하면 같은 글자가
 * 서로 다른 벡터가 되므로, 잉크 경계상자의 중심에 창을 맞춰 잘라낸다.
 * 축소 배율은 고정이라 글자 **크기**는 정보로 남는다 (`//` 와 `//*` 는 폭이 다르다).
 */
/** 셀에서 뽑아낸 잉크 마스크 — 배경(회색 음영·형광펜)을 걷어낸 글자만 남는다 */
export interface InkMask {
  /** 0 또는 255 의 이진 마스크 — 모양 비교에 쓴다 */
  mask: Gray
  /** 화소별 잉크 진하기(배경 대비 낙차). 무게중심 계산에 쓴다 — 진한 획이 더 무겁다. */
  weight: Uint8Array
  /** 마스크 좌상단의 원본 좌표 */
  x: number
  y: number
  /** 배경 대비가 없으면 false — 빈 칸 */
  hasContrast: boolean
  /** 잉크 화소 비율 */
  ink: number
}

/**
 * 셀에서 잉크만 뽑아낸다.
 *
 * ## 국소 적응 임계값을 쓰는 이유
 *
 * 한 칸의 배경이 늘 균일하지 않다. 주말 컬럼은 회색이고, 형광펜이 칸을 반만 덮으면
 * 배경이 두 단계가 된다. 고정 임계값은 회색 칸의 글자를 통째로 놓치고,
 * 칸 단위 임계값은 형광펜 경계를 잉크로 오인한다.
 * **국소 평균보다 delta 만큼 어두운 곳**만 잉크로 보면 배경이 몇 단계든 무관해진다.
 *
 * ## 반드시 흐리게 만든 뒤에 자를 것
 *
 * 인쇄물의 회색 음영은 균일한 회색이 아니라 하프톤 점의 격자다. 그대로 자르면
 * 점들이 잉크로 살아남아 글자를 뒤덮는다. 먼저 흐리게 만들면 점은 뭉개져 평탄해지고
 * 속이 찬 글자 획만 어둡게 남는다.
 *
 * ## 왜 칸 단위로 뽑는가
 *
 * 국소 배경 반경은 글자보다 넉넉히 커야 한다. 글자보다 좁은 영역에서 배경을 추정하면
 * 글자 자신이 배경 추정치를 끌어내려 대비가 사라진다. 그래서 사번처럼 여러 글자를
 * 쪼개 쓸 때도 **마스크는 칸 전체에서 한 번 뽑고 나중에 조각낸다.**
 */
export function cellInk(
  gray: Gray,
  box: Box,
  config: Partial<FeatureConfig> = {},
): InkMask {
  const { blur, localRadius, delta, minContrast, inset, stripRules } =
    { ...DEFAULT_FEATURE, ...config }
  const w = Math.max(6, box.w - inset * 2)
  const h = Math.max(6, box.h - inset * 2)
  const x = box.x + inset
  const y = box.y + inset

  const cell = boxBlur(cropGray(gray, x, y, w, h), blur)
  const local = boxBlur(cell, localRadius)

  const mask: Gray = { width: w, height: h, data: new Uint8Array(w * h) }
  const weight = new Uint8Array(w * h)
  let maxDrop = 0
  let count = 0
  for (let i = 0; i < mask.data.length; i++) {
    const drop = local.data[i] - cell.data[i]
    if (drop > maxDrop) maxDrop = drop
    if (drop >= delta) { mask.data[i] = 255; weight[i] = Math.min(255, drop); count++ }
  }
  const hasContrast = maxDrop >= minContrast
  if (!hasContrast) { mask.data.fill(0); weight.fill(0) }
  else if (stripRules) count = eraseRuledLines(mask, weight)

  return { mask, weight, x, y, hasContrast, ink: hasContrast ? count / (w * h) : 0 }
}

/**
 * 마스크에서 표의 괘선을 지운다.
 *
 * 셀 박스가 조금만 밀려도 이웃 칸과의 경계선이 크롭 안으로 들어온다. 이 선은
 * 가로(또는 세로) 전체를 관통하는 잉크라서 무게중심을 통째로 끌고 가고,
 * 그러면 창이 밀려 글자가 잘려 나간다. 실제로 사번 열 아래쪽 행들이 이 때문에 깨졌다.
 *
 * 글자는 어떤 행도 폭 전체를 채우지 않는다. 그러니 **거의 다 찬 행·열은 선**이다.
 */
function eraseRuledLines(mask: Gray, weight: Uint8Array, fill = 0.6): number {
  const { width: w, height: h, data } = mask
  for (let y = 0; y < h; y++) {
    let n = 0
    for (let x = 0; x < w; x++) if (data[y * w + x]) n++
    if (n > w * fill) {
      for (let x = 0; x < w; x++) { data[y * w + x] = 0; weight[y * w + x] = 0 }
    }
  }
  for (let x = 0; x < w; x++) {
    let n = 0
    for (let y = 0; y < h; y++) if (data[y * w + x]) n++
    if (n > h * fill) {
      for (let y = 0; y < h; y++) { data[y * w + x] = 0; weight[y * w + x] = 0 }
    }
  }
  let count = 0
  for (let i = 0; i < data.length; i++) if (data[i]) count++
  return count
}

/**
 * 잉크 마스크의 한 영역을 비교 가능한 특징 벡터로 만든다.
 *
 * ## 왜 잉크 무게중심에 창을 맞추는가
 *
 * 셀 박스는 검출이든 보간이든 1~3px 흔들린다. 그 상태로 영역 전체를 축소하면
 * 같은 글자가 서로 다른 벡터가 된다. 그래서 잉크 위치에 창을 맞춰 잘라낸다.
 *
 * 기준은 경계상자 중심이 아니라 **무게중심**이다. 셀 박스가 조금 밀려 이웃 칸의
 * 테두리가 딸려 들어오면, 경계상자 중심은 그 작은 잡티 하나에 통째로 끌려가
 * 글자가 창 밖으로 잘려 나간다. 무게중심은 잉크 양으로 가중되므로 거의 움직이지 않는다.
 *
 * 축소 배율은 고정이라 글자 **크기**는 정보로 남는다 — `//` 와 `//*` 는 폭이 다르다.
 */
export function featureFromInk(
  ink: InkMask,
  region: Box,
  config: Partial<FeatureConfig> = {},
): CellFeature {
  const { winW: WIN_W, winH: WIN_H, featW: FEAT_W, featH: FEAT_H, center } =
    { ...DEFAULT_FEATURE, ...config }
  const FEAT_LEN = FEAT_W * FEAT_H

  // region 을 마스크 좌표계로 옮긴다
  const rx = region.x - ink.x
  const ry = region.y - ink.y
  const rw = Math.max(2, region.w)
  const rh = Math.max(2, region.h)

  let x0 = rw, y0 = rh, x1 = -1, y1 = -1, inkPixels = 0
  let sumX = 0, sumY = 0, sumW = 0
  for (let y = 0; y < rh; y++) {
    const my = ry + y
    if (my < 0 || my >= ink.mask.height) continue
    for (let x = 0; x < rw; x++) {
      const mx = rx + x
      if (mx < 0 || mx >= ink.mask.width) continue
      const mi = my * ink.mask.width + mx
      if (ink.mask.data[mi] === 0) continue
      const wgt = ink.weight[mi]
      inkPixels++
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      sumX += x * wgt
      sumY += y * wgt
      sumW += wgt
    }
  }
  const hasInk = x1 >= 0
  const useCentroid = center === 'centroid' && sumW > 0
  const cx = useCentroid ? sumX / sumW : hasInk ? (x0 + x1) / 2 : rw / 2
  const cy = useCentroid ? sumY / sumW : hasInk ? (y0 + y1) / 2 : rh / 2

  const win = cropGray(
    { width: rw, height: rh, data: sliceMask(ink, rx, ry, rw, rh) },
    Math.round(cx - WIN_W / 2), Math.round(cy - WIN_H / 2), WIN_W, WIN_H,
  )
  const patch = boxBlur(resizeGrayArea(win, FEAT_W, FEAT_H), 1)

  let sum = 0
  for (let i = 0; i < FEAT_LEN; i++) sum += patch.data[i]
  const mean = sum / FEAT_LEN

  const vector = new Float32Array(FEAT_LEN)
  let norm = 0
  for (let i = 0; i < FEAT_LEN; i++) {
    const v = patch.data[i] - mean
    vector[i] = v
    norm += v * v
  }
  norm = Math.sqrt(norm)
  if (norm > 1e-6) for (let i = 0; i < FEAT_LEN; i++) vector[i] /= norm

  return {
    vector, patch,
    ink: inkPixels / (rw * rh),
    inkW: hasInk ? x1 - x0 + 1 : 0,
    inkH: hasInk ? y1 - y0 + 1 : 0,
  }
}

function sliceMask(ink: InkMask, rx: number, ry: number, rw: number, rh: number): Uint8Array {
  const out = new Uint8Array(rw * rh)
  for (let y = 0; y < rh; y++) {
    const my = ry + y
    if (my < 0 || my >= ink.mask.height) continue
    for (let x = 0; x < rw; x++) {
      const mx = rx + x
      if (mx < 0 || mx >= ink.mask.width) continue
      out[y * rw + x] = ink.mask.data[my * ink.mask.width + mx]
    }
  }
  return out
}

/** 셀 하나 = 잉크 추출 + 특징 생성 */
export function cellFeature(
  gray: Gray,
  box: Box,
  config: Partial<FeatureConfig> = {},
): CellFeature {
  const ink = cellInk(gray, box, config)
  return featureFromInk(ink, { x: ink.x, y: ink.y, w: ink.mask.width, h: ink.mask.height }, config)
}

/** 코사인 유사도 (-1 ~ 1). 두 벡터 모두 정규화되어 있다고 가정한다. */
export function similarity(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}
