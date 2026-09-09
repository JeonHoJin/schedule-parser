import type { Box, Gray } from '@sp/vision'
import { boxBlur, cropGray } from '@sp/vision'
import { cellInk, featureFromInk, DEFAULT_FEATURE, type FeatureConfig, type InkMask } from './feature'
import { classify, type Template } from './template'

/**
 * 숫자 한 글자용 특징 설정 — 칸 전체가 아니라 글자 하나에 맞춘 좁은 창.
 *
 * 배경 추정 관련 값(`localRadius` 등)은 여기 없다. 잉크 마스크는 **사번 칸 전체에서**
 * 한 번 뽑고 조각만 잘라 쓰기 때문이다. 숫자 한 글자 폭(14px)에서 배경을 추정하면
 * 글자 자신이 추정치를 끌어내려 대비가 사라진다 — 실제로 이 실수 때문에
 * 아래쪽 행의 사번이 통째로 깨졌었다.
 */
export const DIGIT_FEATURE: Partial<FeatureConfig> = {
  winW: 20, winH: 30,
  featW: 12, featH: 16,
}

/**
 * 사번 칸의 위치를 만든다 — **가로는 일자 열에서, 세로는 사번 열에서** 가져온다.
 *
 * 두 축의 신뢰도가 다르기 때문이다.
 *
 * - 가로: 사번 열은 표의 왼쪽 끝이라 검출률이 낮고(31행 중 25행), 보간된 행은
 *   좌표가 밀려 옆의 성명 열 글자가 딸려 들어온다. 반면 일자 열은 모든 행에서
 *   안정적으로 잡히므로, 같은 행의 1일 칸에서 왼쪽으로 밀어내는 편이 정확하다.
 * - 세로: 종이가 휘어 있어서 표의 **왼쪽 끝과 가운데는 행의 높이가 다르다.**
 *   일자 열의 y 를 그대로 쓰면 사번 칸이 위아래로 어긋나 이웃 칸의 괘선이
 *   크롭 안으로 들어온다. 격자가 그 위치에서 추정한 행 높이를 쓰는 게 맞다.
 */
export function empnoBox(day1: Box, latticeCell: Box, width: number, gap = 6): Box {
  const right = day1.x - gap
  return { x: right - width, y: latticeCell.y, w: width, h: latticeCell.h }
}

/** 잉크가 놓인 가로 구간 [시작, 끝]. 없으면 null. */
function inkExtent(ink: InkMask): [number, number] | null {
  const { width: w, height: h, data } = ink.mask
  const floor = Math.max(2, Math.round(h * 0.12))
  let lo = -1, hi = -1
  for (let x = 0; x < w; x++) {
    let n = 0
    for (let y = 0; y < h; y++) if (data[y * w + x]) n++
    if (n <= floor) continue
    if (lo < 0) lo = x
    hi = x
  }
  return lo < 0 ? null : [lo, hi]
}

/** 이상치를 걸러내며 y = a + b·x 를 맞춘다 */
function robustFit(points: Array<[number, number]>): (x: number) => number {
  let pts = points
  let a = 0, b = 0
  for (let round = 0; round < 3; round++) {
    if (pts.length < 2) break
    let sx = 0, sy = 0, sxx = 0, sxy = 0
    for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y }
    const n = pts.length
    const den = n * sxx - sx * sx
    b = Math.abs(den) < 1e-9 ? 0 : (n * sxy - sx * sy) / den
    a = (sy - b * sx) / n
    const res = pts.map(([x, y]) => Math.abs(a + b * x - y)).sort((p, q) => p - q)
    const cut = Math.max(2, res[Math.floor(res.length * 0.7)] * 1.5)
    const kept = pts.filter(([x, y]) => Math.abs(a + b * x - y) <= cut)
    if (kept.length === pts.length || kept.length < 3) break
    pts = kept
  }
  return (x: number) => a + b * x
}

/**
 * 사번 열 전체를 숫자 칸으로 쪼갠다. **열 단위로 처리하는 것이 핵심이다.**
 *
 * 한 행만 보고 잉크 구간을 재면 흔들린다. 첫 숫자가 `1` 이면 획이 얇아 왼쪽 끝이
 * 안쪽으로 들어오고, 성명 열 경계선이 크롭에 걸린 행은 반대로 밖으로 튄다.
 *
 * 그런데 이 흔들림 아래에는 **일정한 추세**가 있다. 종이가 휘어 있어서 사번 글자의
 * 위치가 위에서 아래로 내려가며 조금씩(31행에 걸쳐 약 9px) 왼쪽으로 밀린다.
 * 그래서 행마다 따로 재는 대신, 행 번호에 대한 직선을 맞춘다.
 * 이상치를 걸러가며 맞추므로 몇 행이 오염돼도 나머지가 바로잡아 준다.
 *
 * 자릿수를 미리 안다는 점(사번은 6자리)이 마지막 한 조각을 채운다 —
 * 맞춘 구간을 자릿수만큼 균등 분할하면 끝이다. 인쇄된 표의 숫자는 폭이 일정하다.
 */
export function segmentDigitColumn(inks: InkMask[], count: number): Array<Box[] | null> {
  const extents = inks.map(inkExtent)
  const loPts: Array<[number, number]> = []
  const hiPts: Array<[number, number]> = []
  extents.forEach((e, i) => {
    if (!e) return
    loPts.push([i, e[0]])
    hiPts.push([i, e[1]])
  })
  if (loPts.length < 3) return inks.map(() => null)

  const loAt = robustFit(loPts)
  const hiAt = robustFit(hiPts)

  return inks.map((ink, i) => {
    if (!extents[i]) return null
    const lo = loAt(i)
    const step = (hiAt(i) - lo + 1) / count
    return Array.from({ length: count }, (_, k) => ({
      x: ink.x + Math.round(lo + k * step),
      y: ink.y,
      w: Math.max(4, Math.round(step)),
      h: ink.mask.height,
    }))
  })
}

export interface EmpnoResult {
  /** 읽어낸 사번. 자릿수가 맞지 않으면 null */
  value: string | null
  /** 자릿수별 신뢰도 */
  scores: number[]
  /** 가장 낮은 자릿수 신뢰도 — 검수 우선순위 */
  minScore: number
}

export function readEmpno(
  ink: InkMask,
  slices: Box[] | null,
  templates: Template[],
  config: Partial<FeatureConfig> = DIGIT_FEATURE,
): EmpnoResult {
  if (!slices) return { value: null, scores: [], minScore: 0 }
  const scores: number[] = []
  let text = ''
  for (const box of slices) {
    const c = classify(featureFromInk(ink, box, config), templates, 0)
    text += c.raw
    scores.push(c.score)
  }
  const valid = /^\d+$/.test(text) && text.length === slices.length
  return { value: valid ? text : null, scores, minScore: Math.min(...scores) }
}

/** 사번 칸 하나의 잉크 마스크. 조각별 특징은 여기서 잘라 쓴다. */
export function empnoInk(gray: Gray, box: Box): InkMask {
  return cellInk(gray, box, { inset: 2, stripRules: true })
}

/**
 * 읽어낸 사번을 **이미 알고 있는 명단에 맞춘다.**
 *
 * 이 앱은 매달 같은 병동의 근무표를 읽는다. 즉 두 번째 달부터는 사번 후보가
 * 30명 남짓으로 이미 정해져 있다. 그러면 문제가 "6자리를 정확히 읽기"에서
 * "아는 30개 중 어느 것인지 고르기"로 바뀌고, 훨씬 쉬워진다.
 * 숫자 한두 개를 잘못 읽어도 답은 하나로 좁혀진다.
 *
 * 후보가 둘 이상 비슷하게 가까우면 억지로 고르지 않고 `null` 을 돌려준다 —
 * 잘못 붙이느니 사용자에게 묻는 편이 낫다.
 */
export function matchKnownEmpno(
  read: string | null,
  known: readonly string[],
  maxDistance = 2,
): { value: string | null; distance: number; ambiguous: boolean } {
  if (!read) return { value: null, distance: Infinity, ambiguous: false }
  if (known.includes(read)) return { value: read, distance: 0, ambiguous: false }

  const scored = known
    .map(k => ({ k, d: hamming(read, k) }))
    .sort((a, b) => a.d - b.d)
  const best = scored[0]
  if (!best || best.d > maxDistance) return { value: null, distance: best?.d ?? Infinity, ambiguous: false }

  const ambiguous = scored.length > 1 && scored[1].d === best.d
  return { value: ambiguous ? null : best.k, distance: best.d, ambiguous }
}

function hamming(a: string, b: string): number {
  if (a.length !== b.length) return Infinity
  let d = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++
  return d
}
