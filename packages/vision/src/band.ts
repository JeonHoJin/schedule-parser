/**
 * 등간격 열 밴드 탐지.
 *
 * 근무표의 일자 열은 반드시 **일정한 간격으로 N개**(그 달의 일수) 나열된다.
 * 이 구조적 제약은 격자 복원이 한두 열 틀렸을 때 그것을 바로잡는 강력한 근거가 된다.
 * 순수한 기하 정보만으로는 애매한 경계를, "30일치가 등간격으로 있어야 한다"는
 * 사실이 확정해준다.
 */

export interface BandResult {
  /** 일자 1..N 에 대응하는 열 인덱스 (합성된 열은 -1) */
  columns: number[]
  /** 합성된 열의 예측 중심 좌표 (columns 가 -1 인 자리) */
  synthesized: Map<number, number>
  pitch: number
  /** 밴드의 기준이 된 연속 구간 [시작, 끝] 인덱스 */
  seed: [number, number]
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** 간격이 일정하게 유지되는 가장 긴 연속 구간을 찾는다. */
export function findUniformSeed(centers: number[], tol = 0.15): [number, number] | null {
  if (centers.length < 3) return null
  const gaps = centers.slice(1).map((c, i) => c - centers[i])
  const pitch = median(gaps)
  if (pitch <= 0) return null

  let best: [number, number] | null = null
  let start = 0
  for (let i = 0; i <= gaps.length; i++) {
    const ok = i < gaps.length && Math.abs(gaps[i] - pitch) <= pitch * tol
    if (!ok) {
      const end = i // centers[start..end] 가 연속 구간
      if (end - start >= 2 && (!best || end - start > best[1] - best[0])) best = [start, end]
      start = i + 1
    }
  }
  return best
}

/**
 * 등간격 밴드를 정확히 `expected` 개로 확정한다.
 *
 * 씨앗 구간의 직선 모델(x = a + b·k)을 양쪽으로 늘려가며,
 * 예측 위치 근처에 있는 실제 열을 흡수한다. 후보가 여럿이면 검출 셀이 많은 쪽을 택한다.
 * 근처에 아무것도 없으면 예측 위치를 그대로 쓴다(합성 열).
 */
export function locateBand(
  centers: number[],
  weights: number[],
  expected: number,
  snapRatio = 0.45,
): BandResult | null {
  const seed = findUniformSeed(centers)
  if (!seed) return null

  const [s0, s1] = seed
  const n = s1 - s0 + 1
  // 씨앗 구간에 최소자승 직선을 맞춘다
  let sk = 0, sx = 0, skk = 0, skx = 0
  for (let k = 0; k < n; k++) {
    const x = centers[s0 + k]
    sk += k; sx += x; skk += k * k; skx += k * x
  }
  const pitch = (n * skx - sk * sx) / (n * skk - sk * sk)
  const base = (sx - pitch * sk) / n
  const predict = (k: number) => base + pitch * k

  const taken = new Set<number>()
  const pick = (k: number): number => {
    const px = predict(k)
    let bestIdx = -1, bestScore = -1
    for (let i = 0; i < centers.length; i++) {
      if (taken.has(i)) continue
      if (Math.abs(centers[i] - px) > pitch * snapRatio) continue
      // 거리보다 검출 셀 수를 우선한다 — 파편 열이 진짜 열을 밀어내지 않도록
      const score = weights[i] * 1000 - Math.abs(centers[i] - px)
      if (score > bestScore) { bestScore = score; bestIdx = i }
    }
    if (bestIdx >= 0) taken.add(bestIdx)
    return bestIdx
  }

  // 씨앗 구간을 먼저 확보
  const slots = new Map<number, number>()
  for (let k = 0; k < n; k++) { taken.add(s0 + k); slots.set(k, s0 + k) }

  // 왼쪽으로 확장 — 예측 위치에 실제 열이 있는 동안만
  let lo = 0
  while (slots.size < expected) {
    const k = lo - 1
    if (predict(k) < Math.min(...centers) - pitch * snapRatio) break
    const idx = pick(k)
    if (idx < 0) break
    slots.set(k, idx); lo = k
  }
  // 오른쪽으로 확장 — 부족한 만큼 채우되, 없으면 합성
  let hi = n - 1
  while (slots.size < expected) {
    const k = hi + 1
    const idx = pick(k)
    slots.set(k, idx) // 없으면 -1 (합성)
    hi = k
    if (k - lo + 1 > expected * 2) break
  }
  // 그래도 모자라면 왼쪽을 합성으로 채운다
  while (slots.size < expected) {
    const k = lo - 1
    slots.set(k, -1); lo = k
  }

  const keys = [...slots.keys()].sort((a, b) => a - b)
  const columns = keys.map(k => slots.get(k)!)
  const synthesized = new Map<number, number>()
  keys.forEach((k, i) => { if (slots.get(k) === -1) synthesized.set(i, predict(k)) })

  return { columns, synthesized, pitch, seed }
}
