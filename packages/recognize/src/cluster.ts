import type { CellFeature } from './feature'
import { similarity } from './feature'

export interface Cluster {
  centroid: Float32Array
  members: number[]
  /** 중심에 가장 가까운 구성원 — 사람에게 보여줄 대표 이미지 */
  representative: number
}

export interface ClusterOptions {
  /** 같은 모양으로 볼 코사인 유사도 하한 */
  threshold: number
  /** 이 잉크 비율 미만이면 빈 칸으로 본다 */
  emptyInk: number
}

export const DEFAULT_CLUSTER: ClusterOptions = { threshold: 0.8, emptyInk: 0.02 }

const normalize = (v: Float32Array): void => {
  let n = 0
  for (let i = 0; i < v.length; i++) n += v[i] * v[i]
  n = Math.sqrt(n)
  if (n > 1e-6) for (let i = 0; i < v.length; i++) v[i] /= n
}

/**
 * 셀 모양을 자동으로 묶는다.
 *
 * 근무표는 같은 프로그램이 같은 폰트로 찍어내므로, 같은 글자는 거의 같은 픽셀 배치를 갖는다.
 * 따라서 단순한 리더 클러스터링으로도 잘 뭉친다. 순서 의존성을 줄이기 위해
 * 잉크가 많은(=또렷한) 셀부터 처리하고, 마지막에 중심끼리 병합하는 패스를 돈다.
 *
 * 목적은 자동 인식이 아니라 **사람이 라벨을 붙일 대표 20여 개를 뽑는 것**이다.
 */
export function clusterFeatures(
  feats: CellFeature[],
  opts: Partial<ClusterOptions> = {},
): { clusters: Cluster[]; empties: number[] } {
  const o = { ...DEFAULT_CLUSTER, ...opts }
  const empties: number[] = []
  const live: number[] = []
  for (let i = 0; i < feats.length; i++) {
    if (feats[i].ink < o.emptyInk) empties.push(i)
    else live.push(i)
  }
  live.sort((a, b) => feats[b].ink - feats[a].ink)

  const clusters: Cluster[] = []
  for (const i of live) {
    let best = -1, bestSim = o.threshold
    for (let c = 0; c < clusters.length; c++) {
      const s = similarity(feats[i].vector, clusters[c].centroid)
      if (s > bestSim) { bestSim = s; best = c }
    }
    if (best < 0) {
      clusters.push({
        centroid: Float32Array.from(feats[i].vector),
        members: [i],
        representative: i,
      })
    } else {
      const cl = clusters[best]
      const n = cl.members.length
      for (let k = 0; k < cl.centroid.length; k++) {
        cl.centroid[k] = (cl.centroid[k] * n + feats[i].vector[k]) / (n + 1)
      }
      normalize(cl.centroid)
      cl.members.push(i)
    }
  }

  // 중심끼리 가까워진 클러스터를 합친다
  for (let pass = 0; pass < 3; pass++) {
    let merged = false
    for (let a = 0; a < clusters.length; a++) {
      for (let b = a + 1; b < clusters.length; b++) {
        if (similarity(clusters[a].centroid, clusters[b].centroid) < o.threshold) continue
        const na = clusters[a].members.length, nb = clusters[b].members.length
        for (let k = 0; k < clusters[a].centroid.length; k++) {
          clusters[a].centroid[k] =
            (clusters[a].centroid[k] * na + clusters[b].centroid[k] * nb) / (na + nb)
        }
        normalize(clusters[a].centroid)
        clusters[a].members.push(...clusters[b].members)
        clusters.splice(b, 1)
        b--
        merged = true
      }
    }
    if (!merged) break
  }

  for (const cl of clusters) {
    let best = cl.members[0], bestSim = -2
    for (const m of cl.members) {
      const s = similarity(feats[m].vector, cl.centroid)
      if (s > bestSim) { bestSim = s; best = m }
    }
    cl.representative = best
  }
  clusters.sort((a, b) => b.members.length - a.members.length)
  return { clusters, empties }
}
