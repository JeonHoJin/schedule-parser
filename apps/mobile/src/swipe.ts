/**
 * 좌우 스와이프 감지. 세로 스크롤과 겹치지 않도록, 충분히 가로로 길고 빠른 움직임만 인정한다.
 */
import { useRef } from 'react'

export type SwipeDirection = 'left' | 'right'

interface Point { x: number; y: number; t: number }

export const MIN_DISTANCE = 56
const MAX_DURATION = 700

/** 손가락이 왼쪽으로 움직이면 'left'(다음), 오른쪽이면 'right'(이전). */
export function swipeDirection(start: Point, end: Point): SwipeDirection | null {
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (end.t - start.t > MAX_DURATION) return null
  if (Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return null
  return dx < 0 ? 'left' : 'right'
}

/** 입력칸·선택 상자 위에서 시작한 터치는 스와이프로 보지 않는다(글자 선택·커서 이동). */
function fromEditable(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable="true"]')
}

export function useSwipe(onSwipe: (dir: SwipeDirection) => void) {
  const start = useRef<Point | null>(null)
  return {
    onTouchStart(e: React.TouchEvent) {
      const t = e.touches[0]
      start.current = e.touches.length === 1 && !fromEditable(e.target)
        ? { x: t.clientX, y: t.clientY, t: e.timeStamp }
        : null
    },
    onTouchEnd(e: React.TouchEvent) {
      const s = start.current
      start.current = null
      const t = e.changedTouches[0]
      if (!s || !t) return
      const dir = swipeDirection(s, { x: t.clientX, y: t.clientY, t: e.timeStamp })
      if (dir) {
        e.stopPropagation()
        onSwipe(dir)
      }
    },
    onTouchCancel() { start.current = null },
  }
}
