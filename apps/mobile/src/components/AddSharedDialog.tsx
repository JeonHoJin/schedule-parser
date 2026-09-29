/**
 * 공유받은 근무표 추가: 카톡 등으로 받은 공유 링크를 붙여 넣으면 이 기기의 목록에 넣는다.
 */
import { useEffect, useState } from 'react'
import type { LocalRoster } from '../data'
import { received, type Received } from '../received'
import { ShareGone, tokenFromText } from '../server/share'

export function AddSharedDialog({ own, onAdded, onClose }: {
  own: LocalRoster[]
  onAdded: (r: Received) => void
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const canPaste = typeof navigator.clipboard?.readText === 'function'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  async function add(from = text) {
    const token = tokenFromText(from)
    if (!token) {
      setError('공유 링크를 찾지 못했어요. 받은 링크 전체를 붙여 넣어 주세요.')
      return
    }
    setBusy(true); setError('')
    try {
      onAdded(await received.add(token, own))
    } catch (e) {
      setError(e instanceof ShareGone ? e.message : '근무표를 받지 못했어요. 연결을 확인하고 다시 시도해 주세요.')
    } finally { setBusy(false) }
  }

  async function paste() {
    try {
      const clip = await navigator.clipboard.readText()
      setText(clip)
      if (tokenFromText(clip)) await add(clip)
      else setError('복사한 내용에 공유 링크가 없어요.')
    } catch {
      setError('붙여넣기를 허용하지 않았어요. 아래 칸에 직접 붙여 넣어 주세요.')
    }
  }

  return (
    <div className="day-backdrop" onClick={onClose}>
      <div className="day-sheet share-sheet" role="dialog" aria-modal="true" aria-label="공유받은 근무표 추가" onClick={e => e.stopPropagation()}>
        <div className="day-head">
          <h2>공유받은 근무표 추가</h2>
          <button type="button" className="day-close" aria-label="닫기" onClick={onClose}>✕</button>
        </div>
        <div className="day-body share-body">
          <p className="share-intro">
            받은 공유 링크를 붙여 넣으면 이 앱의 근무표 목록에 들어가요. 보낸 사람이 근무표를 고치면 여기에도 반영되고,
            로그인은 필요 없어요.
          </p>
          {canPaste && (
            <button type="button" className="primary" disabled={busy} onClick={() => void paste()}>
              {busy ? '받는 중…' : '복사한 링크 붙여넣기'}
            </button>
          )}
          <div className="share-link">
            <input value={text} onChange={e => { setText(e.target.value); setError('') }} placeholder="https://…#share=…"
              aria-label="공유 링크" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            <div className="share-buttons">
              <button type="button" className={canPaste ? '' : 'primary'} disabled={busy || !text.trim()} onClick={() => void add()}>
                {busy ? '받는 중…' : '추가'}
              </button>
            </div>
          </div>
          {error && <p className="local-error share-error" role="alert">{error}</p>}
          <p className="share-hint">이 기기에만 저장돼요. 다른 기기에서도 보려면 그 기기에서도 링크를 추가해 주세요.</p>
        </div>
      </div>
    </div>
  )
}
