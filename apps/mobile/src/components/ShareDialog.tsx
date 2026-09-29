/**
 * 근무표를 읽기 전용 링크로 공유한다. 링크를 만들고, 복사·보내기, 새로 만들기, 중지.
 */
import { useEffect, useState } from 'react'
import type { LocalRoster } from '../data'
import { createShare, forget, remembered, shareUrl, sharedUntil, stopShare, type ShareLink } from '../server/share'

const fmt = (iso: string) => {
  const d = new Date(iso)
  return `${d.getMonth() + 1}월 ${d.getDate()}일`
}

export function ShareDialog({ roster, onClose }: { roster: LocalRoster; onClose: () => void }) {
  const id = roster.roster.id
  const [until, setUntil] = useState<string | null | undefined>(undefined)
  const [link, setLink] = useState<ShareLink | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    addEventListener('keydown', onKey)
    sharedUntil(id)
      .then(u => {
        setUntil(u)
        const saved = remembered(id)
        if (u && saved && saved.expiresAt === u) setLink(saved)
        if (!u) forget(id)
      })
      .catch(() => { setUntil(null); setError('서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.') })
    return () => removeEventListener('keydown', onKey)
  }, [id])

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setCopied(false)
    try { await action() } catch {
      setError('서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally { setBusy(false) }
  }

  const make = () => {
    if (until && !window.confirm('새 링크를 만들면 이전 링크는 더 이상 열리지 않아요. 만들까요?')) return
    void create()
  }
  const create = () => run(async () => {
    const made = await createShare(roster)
    setLink(made)
    setUntil(made.expiresAt)
  })
  const stop = () => {
    if (!window.confirm('공유를 중지할까요? 보낸 링크로는 더 이상 볼 수 없어요.')) return
    void run(async () => { await stopShare(id); setLink(null); setUntil(null) })
  }
  const url = link ? shareUrl(link.token) : ''
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true) } catch { setError('복사하지 못했어요. 링크를 길게 눌러 복사해 주세요.') }
  }
  const title = `${roster.roster.year}년 ${roster.roster.month}월 근무표`

  return (
    <div className="day-backdrop" onClick={onClose}>
      <div className="day-sheet share-sheet" role="dialog" aria-modal="true" aria-label="근무표 공유" onClick={e => e.stopPropagation()}>
        <div className="day-head">
          <h2>근무표 공유</h2>
          <button type="button" className="day-close" aria-label="닫기" onClick={onClose}>✕</button>
        </div>
        <div className="day-body share-body">
          <p className="share-intro">
            링크를 받은 사람은 로그인 없이 <b>{title}</b>를 볼 수만 있어요.
            이름과 근무만 보이고 사번은 보이지 않아요.
          </p>

          {until === undefined && <p className="share-status">확인하는 중…</p>}
          {until && <p className="share-status on">공유 중 · {fmt(until)}까지</p>}

          {link && (
            <div className="share-link">
              <input readOnly value={url} aria-label="공유 링크" onFocus={e => e.currentTarget.select()} />
              <div className="share-buttons">
                <button type="button" className="primary" onClick={() => void copy()}>{copied ? '복사했어요' : '링크 복사'}</button>
                {typeof navigator.share === 'function' && (
                  <button type="button" onClick={() => void navigator.share({ title, url }).catch(() => {})}>보내기</button>
                )}
              </div>
            </div>
          )}
          {until && !link && (
            <p className="share-hint">이 기기에서 만든 링크가 아니라 다시 보여 드릴 수 없어요. 새 링크를 만들면 이전 링크는 막혀요.</p>
          )}

          {error && <p className="local-error share-error" role="alert">{error}</p>}

          <div className="share-actions">
            {!until && until !== undefined && (
              <button type="button" className="primary" disabled={busy} onClick={() => void make()}>
                {busy ? '만드는 중…' : '공유 링크 만들기 (30일)'}
              </button>
            )}
            {until && <>
              <button type="button" disabled={busy} onClick={() => void make()}>새 링크 만들기</button>
              <button type="button" className="danger" disabled={busy} onClick={stop}>공유 중지</button>
            </>}
          </div>
          {until && <p className="share-hint">근무표를 고치면 공유한 링크에도 바로 반영돼요.</p>}
        </div>
      </div>
    </div>
  )
}
