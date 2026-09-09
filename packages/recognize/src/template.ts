import type { CellFeature } from './feature'
import { similarity } from './feature'

export interface Template {
  raw: string
  vector: Float32Array
  /** 이 템플릿을 만든 셀 (디버그·추적용) */
  origin?: { row: number; day: number }
}

export interface Classification {
  raw: string
  /** 최고 유사도 (0~1 근처) */
  score: number
  /** 2등 라벨과의 점수 차이 — 작을수록 헷갈린 것 */
  margin: number
  runnerUp: string
}

/** 같은 라벨의 템플릿이 여러 개면 평균 내어 하나로 합친다(옵션). */
export function mergeByLabel(templates: Template[]): Template[] {
  const byLabel = new Map<string, Template[]>()
  for (const t of templates) {
    const g = byLabel.get(t.raw)
    if (g) g.push(t)
    else byLabel.set(t.raw, [t])
  }
  const out: Template[] = []
  for (const [raw, group] of byLabel) {
    const len = group[0].vector.length
    const v = new Float32Array(len)
    for (const t of group) for (let i = 0; i < len; i++) v[i] += t.vector[i]
    let n = 0
    for (let i = 0; i < len; i++) n += v[i] * v[i]
    n = Math.sqrt(n)
    if (n > 1e-6) for (let i = 0; i < len; i++) v[i] /= n
    out.push({ raw, vector: v })
  }
  return out
}

/**
 * 최근접 템플릿으로 셀을 분류한다.
 *
 * 같은 라벨에 여러 템플릿을 두는 것을 허용한다 (예: 흰 칸의 `D` 와 회색 칸의 `D`).
 * 그래서 `margin` 은 2등 템플릿이 아니라 **2등 라벨**과의 차이로 계산한다.
 * 같은 글자의 변형끼리 경쟁한 것을 "헷갈렸다"고 보면 안 되기 때문이다.
 */
export function classify(
  feat: CellFeature,
  templates: Template[],
  emptyInk = 0.02,
): Classification {
  // 잉크가 없는 칸은 특징 벡터가 0벡터라 어떤 템플릿과도 유사도가 0이 된다.
  // 그대로 최근접 탐색에 넘기면 아무 템플릿이나 걸리므로 여기서 먼저 걸러낸다.
  if (feat.ink < emptyInk) return { raw: '', score: 1, margin: 1, runnerUp: '' }

  let best: Template | null = null
  let bestScore = -2
  for (const t of templates) {
    const s = similarity(feat.vector, t.vector)
    if (s > bestScore) { bestScore = s; best = t }
  }
  if (!best) return { raw: '', score: 0, margin: 0, runnerUp: '' }

  let runnerUp = ''
  let runnerScore = -2
  for (const t of templates) {
    if (t.raw === best.raw) continue
    const s = similarity(feat.vector, t.vector)
    if (s > runnerScore) { runnerScore = s; runnerUp = t.raw }
  }
  return {
    raw: best.raw,
    score: bestScore,
    margin: runnerScore > -2 ? bestScore - runnerScore : bestScore,
    runnerUp,
  }
}
