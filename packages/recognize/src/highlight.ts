import type { Box, Rgba } from '@sp/vision'

/**
 * 형광펜 표시 인식.
 *
 * 이 근무표에는 사용자가 손으로 칠한 형광펜이 있다 (설계 §2.3).
 *   주황 = 본인 근무 / 분홍 = 동시간 근무자 / 노랑 = 다음시간 근무자
 *
 * 파싱에는 쓰지 않지만 — 색은 원본 데이터가 아니라 사람의 메모다 —
 * **인수인계 체인 로직의 정답지**로는 더없이 좋다.
 * 손으로 칠한 결과와 계산 결과가 일치하면, 인식과 로직이 동시에 검증된다.
 */
export type Highlight = 'none' | 'orange' | 'pink' | 'yellow'

interface Hsv { h: number; s: number; v: number }

function toHsv(r: number, g: number, b: number): Hsv {
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  h *= 60
  if (h < 0) h += 360
  return { h, s: max === 0 ? 0 : d / max, v: max / 255 }
}

/**
 * 셀 배경의 형광펜 색을 판정한다.
 * 잉크(어두운 픽셀)와 무채색(종이·회색 음영)을 제외하고, 남은 채색 픽셀의
 * 색상 분포에서 최빈 구간을 고른다.
 */
export function cellHighlight(work: Rgba, box: Box, inset = 4): Highlight {
  const counts = { orange: 0, pink: 0, yellow: 0 }
  let total = 0

  for (let y = box.y + inset; y < box.y + box.h - inset; y++) {
    if (y < 0 || y >= work.height) continue
    for (let x = box.x + inset; x < box.x + box.w - inset; x++) {
      if (x < 0 || x >= work.width) continue
      const o = (y * work.width + x) * 4
      const { h, s, v } = toHsv(work.data[o], work.data[o + 1], work.data[o + 2])
      total++
      if (v < 0.35) continue      // 잉크
      if (s < 0.22) continue      // 종이 흰색 또는 회색 음영
      if (h >= 285 || h < 12) counts.pink++
      else if (h < 45) counts.orange++
      else if (h < 75) counts.yellow++
    }
  }
  if (total === 0) return 'none'

  const best = (Object.entries(counts) as Array<[Highlight, number]>)
    .sort((a, b) => b[1] - a[1])[0]
  // 셀 면적의 25% 이상이 같은 색일 때만 칠해진 것으로 본다
  return best[1] / total >= 0.25 ? best[0] : 'none'
}
