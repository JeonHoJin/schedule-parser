/**
 * 계정·패스키: 이 계정에 패스키를 등록하거나, 다른 기기에서 쓰던 계정을 패스키로 불러온다.
 */
import { useEffect, useState } from 'react'
import { server, ServerError } from '../server'
import {
  PasskeyCancelled, passkeys, passkeySupported, registerPasskey, signInWithPasskey,
} from '../server/passkey'

const day = (iso: string) => {
  const d = new Date(iso)
  return `${d.getMonth() + 1}월 ${d.getDate()}일`
}

function message(e: unknown): string {
  if (e instanceof PasskeyCancelled) return e.message
  if (e instanceof ServerError && e.status === 401) return '이 패스키로는 계정을 찾지 못했어요. 이 근무표 앱에서 등록한 패스키인지 확인해 주세요.'
  if (e instanceof ServerError || e instanceof TypeError) return '서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'
  return e instanceof Error ? e.message : '처리하지 못했어요.'
}

export function AccountDialog({ online, rosterCount, onRegistered, onSwitched, onClose }: {
  online: boolean
  /** 이 기기에 있는 근무표 수(다른 계정으로 바꿀 때 안내용) */
  rosterCount: number
  onRegistered: (count: number) => void
  /** 패스키 계정으로 바뀐 뒤: 근무표를 옮기고 다시 맞춘다 */
  onSwitched: () => Promise<void>
  onClose: () => void
}) {
  const [list, setList] = useState<Array<{ createdAt: string; lastUsedAt: string }> | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const supported = passkeySupported()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    addEventListener('keydown', onKey)
    // 로그인한 적 없는 기기는 계정이 없으니 물어볼 것도 없다.
    server.hasIdentity()
      .then(has => has && online ? passkeys() : [])
      .then(setList)
      .catch(() => setList(null))
    return () => removeEventListener('keydown', onKey)
  }, [online])

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setDone('')
    try { await action() } catch (e) { setError(message(e)) } finally { setBusy(false) }
  }

  const register = () => run(async () => {
    const count = await registerPasskey()
    setList(await passkeys().catch(() => list ?? []))
    onRegistered(count)
    setDone('패스키를 등록했어요. 이제 폰을 바꾸거나 브라우저 기록을 지워도 이 패스키로 근무표를 되찾을 수 있어요.')
  })

  const signIn = () => {
    if (rosterCount > 0 && !window.confirm(
      `패스키 계정으로 바꿀까요? 이 기기의 근무표 ${rosterCount}개 중 그 계정에 없는 달은 함께 옮기고, 같은 달은 그 계정 것을 남겨요.`)) return
    void run(async () => {
      await signInWithPasskey()
      await onSwitched()
      setList(await passkeys().catch(() => []))
      setDone('패스키 계정으로 들어왔어요. 다음부터는 이 기기에서 Face ID 없이 바로 열려요.')
    })
  }

  const count = list?.length ?? 0

  return (
    <div className="day-backdrop" onClick={onClose}>
      <div className="day-sheet share-sheet" role="dialog" aria-modal="true" aria-label="계정·패스키" onClick={e => e.stopPropagation()}>
        <div className="day-head">
          <h2>계정·패스키</h2>
          <button type="button" className="day-close" aria-label="닫기" onClick={onClose}>✕</button>
        </div>
        <div className="day-body share-body">
          {!supported && <p className="local-error share-error">이 브라우저에서는 패스키를 쓸 수 없어요. Safari 나 Chrome, 또는 홈 화면에 설치한 앱에서 열어 주세요.</p>}
          {!online && <p className="share-hint">서버에 연결되면 패스키를 쓸 수 있어요.</p>}

          <section className="account-block">
            <h3>이 계정의 패스키</h3>
            {list === undefined && <p className="share-status">확인하는 중…</p>}
            {list === null && <p className="share-status">서버에 연결하지 못해 확인하지 못했어요.</p>}
            {list && count > 0 && (
              <p className="share-status on">
                {count}개 등록됨 · 마지막 사용 {day(list.reduce((a, b) => (a.lastUsedAt > b.lastUsedAt ? a : b)).lastUsedAt)}
              </p>
            )}
            {list && count === 0 && <p className="share-status">아직 패스키가 없어요.</p>}
            <p className="share-intro">
              패스키를 등록해 두면 폰을 바꾸거나 브라우저 기록을 지워도 Face ID·지문으로 근무표를 되찾을 수 있어요.
              비밀번호나 이메일은 필요 없어요.
            </p>
            <div className="share-actions">
              <button type="button" className={count === 0 && rosterCount > 0 ? 'primary' : ''} disabled={busy || !online || !supported} onClick={() => void register()}>
                {busy ? '진행 중…' : count ? '패스키 하나 더 등록' : '패스키 등록'}
              </button>
            </div>
          </section>

          <section className="account-block">
            <h3>다른 기기에서 쓰던 근무표가 있나요?</h3>
            <p className="share-intro">그 기기에서 등록한 패스키로 로그인하면 그 계정의 근무표를 이 기기에서도 볼 수 있어요.</p>
            <div className="share-actions">
              <button type="button" className={rosterCount === 0 ? 'primary' : ''} disabled={busy || !online || !supported} onClick={signIn}>패스키로 로그인</button>
            </div>
          </section>

          {done && <p className="local-notice share-error" role="status">{done}</p>}
          {error && <p className="local-error share-error" role="alert">{error}</p>}
        </div>
      </div>
    </div>
  )
}
