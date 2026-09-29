import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import type { IsoDate } from '@sp/domain'
import { CalendarScreen } from './src/screens/CalendarScreen'
import { DayDialog, type EditCell } from './src/screens/DayDialog'
import { OcrTestScreen } from './src/screens/OcrTestScreen'
import { connectInBackground, ServerError } from './src/server'
import { displayName, RosterContext, type LocalRoster } from './src/data'
import { readCache } from './src/local-storage'
import { store, upsert } from './src/store'
import { editCell } from './src/roster-edit'
import { useSwipe, type SwipeDirection } from './src/swipe'
import { PickMe } from './src/components/PickMe'
import { ShareDialog } from './src/components/ShareDialog'
import { SharedApp } from './src/screens/SharedApp'
import { forget, tokenFromHash } from './src/server/share'
import { AccountDialog } from './src/components/AccountDialog'
import { passkeys } from './src/server/passkey'
import { server } from './src/server'
import './src/web.css'

/** `#share=<토큰>` 으로 열면 공유된 근무표를, 아니면 내 근무표를 보여 준다. */
export default function Root() {
  const [token, setToken] = useState(() => tokenFromHash(location.hash))
  useEffect(() => {
    const onHash = () => setToken(tokenFromHash(location.hash))
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])
  return token ? <SharedApp key={token} token={token} /> : <App />
}

const PASSKEY_KNOWN = 'schedule-parser:passkey'
const NUDGE_UNTIL = 'schedule-parser:passkey-nudge-until'
function passkeyKnown(): boolean {
  try { return localStorage.getItem(PASSKEY_KNOWN) === '1' } catch { return false }
}
function rememberPasskey() {
  try { localStorage.setItem(PASSKEY_KNOWN, '1') } catch { /* 다음에 다시 확인 */ }
}
function nudgeDismissed(): boolean {
  try { return Number(localStorage.getItem(NUDGE_UNTIL) ?? 0) > Date.now() } catch { return false }
}
/** "나중에"를 누르면 30일 동안 다시 권하지 않는다. */
function dismissNudge() {
  try { localStorage.setItem(NUDGE_UNTIL, String(Date.now() + 30 * 86400_000)) } catch { /* 이번만 숨김 */ }
}

/** 서버에 닿지 못한 실패는 사람이 읽을 말로 */
const friendly = (e: unknown) =>
  e instanceof ServerError || e instanceof TypeError
    ? '서버에 저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요.'
    : e instanceof Error ? e.message : '처리하지 못했습니다. 다시 시도해 주세요.'

function App() {
  const [items, setItems] = useState<LocalRoster[]>([])
  const [selected, setSelected] = useState('')
  const [date, setDate] = useState<IsoDate | null>(null)
  const [busy, setBusy] = useState(true)
  const [online, setOnline] = useState(true)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [slide, setSlide] = useState<SwipeDirection | null>(null)
  const [sharing, setSharing] = useState(false)
  const [account, setAccount] = useState(false)
  const [passkeyCount, setPasskeyCount] = useState<number | null>(null)
  const [nudgeHidden, setNudgeHidden] = useState(nudgeDismissed)
  const onlineRef = useRef(true)
  const current = items.find(i => i.roster.id === selected)
  const canWrite = online && !busy

  // 목록은 최근 달이 먼저다. 왼쪽으로 밀면 다음 달, 오른쪽으로 밀면 이전 달.
  const swipe = useSwipe(dir => {
    const at = items.findIndex(i => i.roster.id === selected)
    const next = items[dir === 'left' ? at - 1 : at + 1]
    if (at < 0 || !next) return
    setSlide(dir)
    setSelected(next.roster.id)
    setDate(null)
  })

  function show(next: LocalRoster[]) {
    setItems(next)
    setSelected(sel => next.some(i => i.roster.id === sel) ? sel : next[0]?.roster.id ?? '')
  }

  /** 서버와 맞춘다. 닿지 못하면 기기의 사본을 읽기 전용으로 보여 준다. */
  async function sync() {
    setBusy(true)
    try {
      const result = await store.sync()
      show(result.items)
      setOnline(result.online)
      onlineRef.current = result.online
    } catch (e) {
      setError(friendly(e))
    } finally { setBusy(false) }
  }

  useEffect(() => {
    // 사본을 먼저 보여 주고(빠르게), 서버와 맞춘 결과로 바꾼다.
    readCache().then(cached => { if (cached.length) show(cached) }).catch(() => {})
    void sync()
    const retry = () => { if (!onlineRef.current) void sync() }
    const onVisible = () => { if (!document.hidden) retry() }
    addEventListener('online', retry)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      removeEventListener('online', retry)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // 근무표가 생긴 계정에 패스키가 없으면 한 번 권한다. 등록된 걸 한 번 알면 다시 묻지 않는다.
  const hasItems = items.length > 0
  useEffect(() => {
    if (!online || !hasItems || passkeyKnown()) return
    server.hasIdentity()
      .then(has => (has ? passkeys() : null))
      .then(list => { if (list) { setPasskeyCount(list.length); if (list.length) rememberPasskey() } })
      .catch(() => {})
  }, [online, hasItems])

  /** 패스키로 다른 계정에 들어온 직후: 이 기기의 근무표 중 그 계정에 없는 달을 옮기고 다시 맞춘다. */
  async function switched() {
    const result = await store.adopt(items)
    show(result.items)
    setOnline(result.online)
    onlineRef.current = result.online
    setDate(null)
  }

  /** 서버에 먼저 쓰고, 성공하면 화면과 사본을 바꾼다. */
  async function persist(data: LocalRoster): Promise<LocalRoster> {
    const saved = await store.save(data)
    setItems(prev => upsert(prev, saved))
    return saved
  }

  if (adding) return (
    <OcrTestScreen existing={items} onClose={() => setAdding(false)} onSave={async data => {
      const saved = await persist(data)
      setSelected(saved.roster.id)
      setDate(null)
      setAdding(false)
    }} />
  )

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try { await action() } catch (e) {
      setError(friendly(e))
    } finally { setBusy(false) }
  }

  function setMe(myNurseId: string) {
    if (!current || !myNurseId) return
    setSlide(null)
    void run(async () => {
      await persist({ ...current, settings: { ...current.settings, myNurseId } })
      setDate(null)
    })
  }

  const edit: EditCell = async (nurseId, day, kind, label) => {
    if (!current) return
    try {
      await persist(editCell(current, nurseId, day, kind, label))
    } catch (e) { throw new Error(friendly(e)) }
  }

  const me = current?.roster.nurses.find(n => n.id === current.settings.myNurseId)

  return (
    <main className="local-app">
      <header className="local-header">
        <h1>근무표</h1>
        <div className="header-actions">
          {current && <button type="button" disabled={!canWrite} onClick={() => { connectInBackground(); setSharing(true) }}>공유</button>}
          {current && <button type="button" className="danger" disabled={!canWrite} onClick={() => {
            const label = `${current.roster.year}년 ${current.roster.month}월`
            if (window.confirm(`${label} 근무표를 삭제할까요? 삭제하면 되돌릴 수 없습니다.`)) {
              void run(async () => {
                const id = current.roster.id
                await store.remove(id)
                forget(id)
                show(items.filter(i => i.roster.id !== id))
                setDate(null)
              })
            }
          }}>이 근무표 삭제</button>}
          <button type="button" className="primary" disabled={!canWrite}
            onClick={() => { connectInBackground(); setAdding(true) }}>근무표 사진 추가</button>
        </div>
      </header>
      {online && hasItems && passkeyCount === 0 && !nudgeHidden && (
        <div className="passkey-nudge" role="status">
          <span>폰을 바꾸거나 브라우저 기록을 지워도 근무표를 잃지 않도록 패스키를 등록해 두세요.</span>
          <button type="button" className="primary" onClick={() => setAccount(true)}>등록</button>
          <button type="button" onClick={() => { dismissNudge(); setNudgeHidden(true) }}>나중에</button>
        </div>
      )}
      {!online && (
        <div className="offline-banner" role="status">
          <span>서버에 연결하지 못해 이 기기에 있는 사본을 보여 드리고 있어요. 연결되면 추가·수정할 수 있어요.</span>
          <button type="button" disabled={busy} onClick={() => void sync()}>{busy ? '연결 중…' : '다시 연결'}</button>
        </div>
      )}
      <section className="local-controls" aria-label="저장된 근무표">
        {items.length > 0 && <label>근무표
          <select aria-label="근무표" value={selected} onChange={e => { setSlide(null); setSelected(e.target.value); setDate(null) }}>
            {items.map(i => <option key={i.roster.id} value={i.roster.id}>
              {i.roster.year}년 {i.roster.month}월 {i.roster.ward}
            </option>)}
          </select>
        </label>}
        {current && me && <label>내 이름
          <select aria-label="내 이름" value={me.id} disabled={!canWrite} onChange={e => setMe(e.target.value)}>
            {current.roster.nurses.map(n => <option key={n.id} value={n.id}>{displayName(n)}</option>)}
          </select>
        </label>}
      </section>
      {error && <p className="local-error" role="alert">{error}</p>}
      {busy && !current && <p className="local-empty" role="status">불러오는 중...</p>}
      {!busy && !current && online && (
        <div className="empty-state">
          <p className="empty-title">저장된 근무표가 없습니다.</p>
          <p className="empty-body">위의 "근무표 사진 추가"로 근무표를 찍어 올리면 내 근무와 인수인계 상대를 달력으로 볼 수 있어요.</p>
          <p className="empty-body">다른 기기에서 쓰던 근무표가 있나요?</p>
          <button type="button" onClick={() => setAccount(true)}>패스키로 불러오기</button>
        </div>
      )}
      {current && !me && <PickMe roster={current} disabled={!canWrite} onPick={setMe} />}
      {current && me && <RosterContext.Provider value={current}>
        <View style={{ flex: 1 }} key={current.roster.id + me.id}>
          <div className={`swipe-area${slide ? ` slide-${slide}` : ''}`} {...swipe}>
            <CalendarScreen onPick={setDate} />
          </div>
          {date && <DayDialog date={date} onDate={setDate} onClose={() => setDate(null)} onEdit={online ? edit : undefined} />}
        </View>
      </RosterContext.Provider>}
      {sharing && current && <ShareDialog roster={current} onClose={() => setSharing(false)} />}
      <footer className="app-footer">
        <button type="button" className="link-button" onClick={() => setAccount(true)}>계정·패스키</button>
      </footer>
      {account && <AccountDialog online={online} rosterCount={items.length} onSwitched={switched}
        onRegistered={count => { setPasskeyCount(count); rememberPasskey() }} onClose={() => setAccount(false)} />}
    </main>
  )
}
