import { useEffect, useState } from 'react'
import { View } from 'react-native'
import type { IsoDate } from '@sp/domain'
import { CalendarScreen } from './src/screens/CalendarScreen'
import { DayDialog, type EditCell } from './src/screens/DayDialog'
import { OcrTestScreen } from './src/screens/OcrTestScreen'
import { connectInBackground } from './src/server'
import { displayName, RosterContext, type LocalRoster } from './src/data'
import { listRosters, removeRoster, saveRoster } from './src/local-storage'
import { editCell } from './src/roster-edit'
import { useSwipe, type SwipeDirection } from './src/swipe'
import { PickMe } from './src/components/PickMe'
import { ShareDialog } from './src/components/ShareDialog'
import { SharedApp } from './src/screens/SharedApp'
import { forget, tokenFromHash } from './src/server/share'
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

function App() {
  const [items, setItems] = useState<LocalRoster[]>([])
  const [selected, setSelected] = useState('')
  const [date, setDate] = useState<IsoDate | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [adding, setAdding] = useState(false)
  const [slide, setSlide] = useState<SwipeDirection | null>(null)
  const [sharing, setSharing] = useState(false)
  const current = items.find(i => i.roster.id === selected)

  // 목록은 최근 달이 먼저다. 왼쪽으로 밀면 다음 달, 오른쪽으로 밀면 이전 달.
  const swipe = useSwipe(dir => {
    const at = items.findIndex(i => i.roster.id === selected)
    const next = items[dir === 'left' ? at - 1 : at + 1]
    if (at < 0 || !next) return
    setSlide(dir)
    setSelected(next.roster.id)
    setDate(null)
  })

  async function refresh() {
    const next = await listRosters()
    setItems(next)
    return next
  }

  useEffect(() => {
    refresh().then(next => setSelected(next[0]?.roster.id ?? ''))
      .catch(e => setError(e.message)).finally(() => setBusy(false))
  }, [])

  if (adding) return (
    <OcrTestScreen onClose={async saved => {
      if (saved) {
        const next = await refresh().catch(() => null)
        if (next?.some(i => i.roster.id === saved.id)) {
          setSelected(saved.id)
          setDate(null)
          setNotice('')
        }
      }
      setAdding(false)
    }} />
  )

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setNotice('')
    try { await action() } catch (e) {
      setError(e instanceof Error ? e.message : '처리하지 못했습니다. 다시 시도해 주세요.')
    } finally { setBusy(false) }
  }

  function setMe(myNurseId: string) {
    if (!current || !myNurseId) return
    setSlide(null)
    void run(async () => {
      await saveRoster({ ...current, settings: { ...current.settings, myNurseId } })
      await refresh()
      setDate(null)
    })
  }

  const edit: EditCell = async (nurseId, day, kind, label) => {
    if (!current) return
    const next = editCell(current, nurseId, day, kind, label)
    await saveRoster(next)
    setItems(prev => prev.map(i => i.roster.id === next.roster.id ? next : i))
  }

  const me = current?.roster.nurses.find(n => n.id === current.settings.myNurseId)

  return (
    <main className="local-app">
      <header className="local-header">
        <h1>근무표</h1>
        <div className="header-actions">
          {current && <button type="button" disabled={busy} onClick={() => { connectInBackground(); setSharing(true) }}>공유</button>}
          {current && <button type="button" className="danger" disabled={busy} onClick={() => {
            const label = `${current.roster.year}년 ${current.roster.month}월`
            if (window.confirm(`${label} 근무표를 삭제할까요? 삭제하면 되돌릴 수 없습니다.`)) {
              void run(async () => {
                await removeRoster(current.roster.id)
                forget(current.roster.id)
                const next = await refresh()
                setSelected(next[0]?.roster.id ?? '')
                setDate(null)
              })
            }
          }}>이 근무표 삭제</button>}
          <button type="button" className="primary" disabled={busy}
            onClick={() => { connectInBackground(); setAdding(true) }}>근무표 사진 추가</button>
        </div>
      </header>
      <section className="local-controls" aria-label="저장된 근무표">
        {items.length > 0 && <label>근무표
          <select aria-label="근무표" value={selected} disabled={busy} onChange={e => { setSlide(null); setSelected(e.target.value); setDate(null) }}>
            {items.map(i => <option key={i.roster.id} value={i.roster.id}>
              {i.roster.year}년 {i.roster.month}월 {i.roster.ward}
            </option>)}
          </select>
        </label>}
        {current && me && <label>내 이름
          <select aria-label="내 이름" value={me.id} disabled={busy} onChange={e => setMe(e.target.value)}>
            {current.roster.nurses.map(n => <option key={n.id} value={n.id}>{displayName(n)}</option>)}
          </select>
        </label>}
      </section>
      {error && <p className="local-error" role="alert">{error}</p>}
      {notice && <p className="local-notice" role="status">{notice}</p>}
      {busy && !current && <p className="local-empty" role="status">불러오는 중...</p>}
      {!busy && !current && (
        <div className="empty-state">
          <p className="empty-title">저장된 근무표가 없습니다.</p>
          <p className="empty-body">위의 "근무표 사진 추가"로 근무표를 찍어 올리면 내 근무와 인수인계 상대를 달력으로 볼 수 있어요.</p>
        </div>
      )}
      {current && !me && <PickMe roster={current} disabled={busy} onPick={setMe} />}
      {current && me && <RosterContext.Provider value={current}>
        <View style={{ flex: 1 }} key={current.roster.id + me.id}>
          <div className={`swipe-area${slide ? ` slide-${slide}` : ''}`} {...swipe}>
            <CalendarScreen onPick={setDate} />
          </div>
          {date && <DayDialog date={date} onDate={setDate} onClose={() => setDate(null)} onEdit={edit} />}
        </View>
      </RosterContext.Provider>}
      {sharing && current && <ShareDialog roster={current} onClose={() => setSharing(false)} />}
    </main>
  )
}
