import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { CalendarScreen } from './src/screens/CalendarScreen'
import { ShiftDetailScreen } from './src/screens/ShiftDetailScreen'
import { OcrTestScreen } from './src/screens/OcrTestScreen'
import { ServerStatus } from './src/components/ServerStatus'
import { displayName, RosterContext, type LocalRoster } from './src/data'
import { listRosters, parseBackup, removeRoster, saveRoster } from './src/local-storage'
import './src/web.css'

export default function App() {
  const [items, setItems] = useState<LocalRoster[]>([])
  const [selected, setSelected] = useState('')
  const [date, setDate] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [ocrTest, setOcrTest] = useState(false)
  const current = items.find(i => i.roster.id === selected)

  async function refresh() {
    const next = await listRosters()
    setItems(next)
    return next
  }

  useEffect(() => {
    refresh().then(next => setSelected(next[0]?.roster.id ?? ''))
      .catch(e => setError(e.message)).finally(() => setBusy(false))
  }, [])

  if (ocrTest) return (
    <OcrTestScreen onClose={async savedId => {
      if (savedId) {
        const next = await refresh().catch(() => null)
        if (next?.some(i => i.roster.id === savedId)) {
          setSelected(savedId)
          setDate(null)
          setNotice('이 기기에 저장했습니다.')
        }
      }
      setOcrTest(false)
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

  async function importFile(file: File) {
    await run(async () => {
      if (file.size > 10 * 1024 * 1024) throw new Error('10MB 이하의 JSON 파일을 선택해 주세요.')
      let raw: unknown
      try { raw = JSON.parse(await file.text()) } catch { throw new Error('JSON 파일을 읽지 못했습니다.') }
      const data = parseBackup(raw)
      const existing = (await listRosters()).find(i => i.roster.id === data.roster.id)
      if (existing && !window.confirm('같은 근무표가 있습니다. 저장된 내용을 덮어쓸까요?')) return
      await saveRoster(data)
      await refresh()
      setSelected(data.roster.id)
      setDate(null)
      setNotice('이 기기에 저장했습니다.')
    })
  }

  function exportCurrent() {
    if (!current) return
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, ...current }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `schedule-${current.roster.year}-${String(current.roster.month).padStart(2, '0')}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <main className="local-app">
      <header className="local-header">
        <h1>근무표</h1>
        <label className="import-button">
          JSON 가져오기
          <input aria-label="근무표 JSON 가져오기" type="file" accept=".json,application/json" disabled={busy}
            onChange={e => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void importFile(file)
            }} />
        </label>
        <button type="button" onClick={() => setOcrTest(true)} style={{ marginLeft: 8 }}>근무표 사진 추가</button>
      </header>
      <ServerStatus />
      <section className="local-controls" aria-label="저장된 근무표">
        {items.length > 0 && <label>근무표
          <select aria-label="근무표" value={selected} disabled={busy} onChange={e => { setSelected(e.target.value); setDate(null) }}>
            {items.map(i => <option key={i.roster.id} value={i.roster.id}>
              {i.roster.year}년 {i.roster.month}월 {i.roster.ward}
            </option>)}
          </select>
        </label>}
        {current && <>
          <label>내 이름
            <select aria-label="내 이름" value={current.settings.myNurseId ?? ''} disabled={busy} onChange={e => {
              const myNurseId = e.target.value
              if (myNurseId) void run(async () => {
                await saveRoster({ ...current, settings: { ...current.settings, myNurseId } })
                await refresh()
                setDate(null)
              })
            }}>
              <option value="" disabled>선택</option>
              {current.roster.nurses.map(n => <option key={n.id} value={n.id}>{displayName(n)}</option>)}
            </select>
          </label>
          <div className="local-actions">
            <button disabled={busy} onClick={exportCurrent}>JSON 백업</button>
            <button disabled={busy} onClick={() => {
              if (window.confirm('이 근무표를 기기에서 삭제할까요? 백업이 없으면 복구할 수 없습니다.')) {
                void run(async () => {
                  await removeRoster(current.roster.id)
                  const next = await refresh()
                  setSelected(next[0]?.roster.id ?? '')
                  setDate(null)
                })
              }
            }}>삭제</button>
          </div>
        </>}
      </section>
      {error && <p className="local-error" role="alert">{error}</p>}
      {notice && <p className="local-notice" role="status">{notice}</p>}
      {busy && <p className="local-empty" role="status">불러오는 중...</p>}
      {!busy && !current && <p className="local-empty">저장된 근무표가 없습니다.</p>}
      {current?.settings.myNurseId && <RosterContext.Provider value={current}>
        <View style={{ flex: 1 }} key={current.roster.id + current.settings.myNurseId}>
          {date
            ? <ShiftDetailScreen date={date} onBack={() => setDate(null)} />
            : <CalendarScreen onPick={setDate} />}
        </View>
      </RosterContext.Provider>}
    </main>
  )
}
