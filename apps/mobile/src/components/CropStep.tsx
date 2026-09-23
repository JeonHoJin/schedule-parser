/**
 * 인식 전에 사진에서 근무표 부분만 남기도록 자르는 단계.
 * 모서리·변을 끌어 영역을 조절하고, 안쪽을 끌면 영역이 이동한다.
 */
import { useMemo, useRef, useState } from 'react'
import type { Rgba } from '@sp/vision'
import { FULL_CROP, rgbaToDataUrl, type CropRect } from '../experimental/browser-image'

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move'
const HANDLES: Exclude<Handle, 'move'>[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const MIN = 0.08

interface Drag { handle: Handle; x: number; y: number; start: CropRect }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function applyDrag(start: CropRect, handle: Handle, dx: number, dy: number): CropRect {
  if (handle === 'move') {
    return { ...start, x: clamp(start.x + dx, 0, 1 - start.w), y: clamp(start.y + dy, 0, 1 - start.h) }
  }
  let left = start.x, top = start.y, right = start.x + start.w, bottom = start.y + start.h
  if (handle.includes('w')) left = clamp(left + dx, 0, right - MIN)
  if (handle.includes('e')) right = clamp(right + dx, left + MIN, 1)
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - MIN)
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + MIN, 1)
  return { x: left, y: top, w: right - left, h: bottom - top }
}

export function CropStep({ image, initial, onConfirm, onCancel }: {
  image: Rgba
  initial?: CropRect
  onConfirm: (rect: CropRect) => void
  onCancel: () => void
}) {
  const url = useMemo(() => rgbaToDataUrl(image, 1400), [image])
  const [rect, setRect] = useState<CropRect>(initial ?? FULL_CROP)
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)

  function down(handle: Handle, e: React.PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    drag.current = { handle, x: e.clientX, y: e.clientY, start: rect }
  }
  function move(e: React.PointerEvent) {
    const d = drag.current
    const b = box.current?.getBoundingClientRect()
    if (!d || !b) return
    setRect(applyDrag(d.start, d.handle, (e.clientX - d.x) / b.width, (e.clientY - d.y) / b.height))
  }
  function up() { drag.current = null }

  const pct = (v: number) => `${v * 100}%`
  const full = rect.x === 0 && rect.y === 0 && rect.w === 1 && rect.h === 1

  return (
    <div className="crop-step">
      <p className="crop-hint">표 밖의 필요 없는 부분은 모서리를 끌어 잘라 주세요.</p>
      <div className="crop-box" ref={box} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <img src={url} alt="선택한 근무표 사진" draggable={false} />
        <div className="crop-shade" style={{ left: 0, top: 0, width: '100%', height: pct(rect.y) }} />
        <div className="crop-shade" style={{ left: 0, top: pct(rect.y + rect.h), width: '100%', bottom: 0 }} />
        <div className="crop-shade" style={{ left: 0, top: pct(rect.y), width: pct(rect.x), height: pct(rect.h) }} />
        <div className="crop-shade" style={{ left: pct(rect.x + rect.w), top: pct(rect.y), right: 0, height: pct(rect.h) }} />
        <div className="crop-rect" style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h) }}
          onPointerDown={e => down('move', e)}>
          {HANDLES.map(h => (
            <span key={h} className={`crop-handle crop-${h}`} onPointerDown={e => down(h, e)} aria-hidden="true" />
          ))}
        </div>
      </div>
      <div className="crop-actions">
        <button type="button" onClick={onCancel}>다른 사진</button>
        <button type="button" disabled={full} onClick={() => setRect(FULL_CROP)}>처음대로</button>
        <button type="button" className="primary" onClick={() => onConfirm(rect)}>
          {full ? '자르지 않고 인식' : '이 영역으로 인식'}
        </button>
      </div>
    </div>
  )
}
