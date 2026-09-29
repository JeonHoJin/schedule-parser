/**
 * 공유 링크로 연 근무표. 로그인하지 않고, 이 기기에 저장하지 않으며, 고칠 수 없다.
 * 보는 사람이 고른 "내 이름"만 이 기기에 기억해 둔다.
 */
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import type { IsoDate } from '@sp/domain'
import { CalendarScreen } from './CalendarScreen'
import { DayDialog } from './DayDialog'
import { PickMe } from '../components/PickMe'
import { displayName, RosterContext, type LocalRoster } from '../data'
import { fetchShared, ShareGone } from '../server/share'

const meKey = (token: string) => `schedule-parser:shared-me:${token.slice(0, 16)}`

function loadMe(token: string): string | undefined {
  try { return localStorage.getItem(meKey(token)) ?? undefined } catch { return undefined }
}

function saveMe(token: string, id: string) {
  try { localStorage.setItem(meKey(token), id) } catch { /* 이번 방문 동안만 기억 */ }
}

export function SharedApp({ token }: { token: string }) {
  const [data, setData] = useState<LocalRoster | null>(null)
  const [expiresAt, setExpiresAt] = useState('')
  const [error, setError] = useState('')
  const [date, setDate] = useState<IsoDate | null>(null)

  useEffect(() => {
    fetchShared(token)
      .then(({ data, expiresAt }) => {
        const me = loadMe(token)
        const known = data.roster.nurses.some(n => n.id === me)
        setData({ ...data, settings: { ...data.settings, myNurseId: known ? me : undefined } })
        setExpiresAt(expiresAt)
      })
      .catch(e => setError(e instanceof ShareGone ? e.message : '근무표를 불러오지 못했어요. 잠시 후 다시 열어 주세요.'))
  }, [token])

  function pick(id: string) {
    if (!data) return
    saveMe(token, id)
    setDate(null)
    setData({ ...data, settings: { ...data.settings, myNurseId: id } })
  }

  const me = data?.roster.nurses.find(n => n.id === data.settings.myNurseId)
  const until = expiresAt ? new Date(expiresAt) : null

  return (
    <main className="local-app">
      <header className="local-header">
        <h1>공유된 근무표</h1>
        {until && <span className="shared-badge">읽기 전용 · {until.getMonth() + 1}월 {until.getDate()}일까지</span>}
      </header>
      {data && me && (
        <section className="local-controls" aria-label="공유된 근무표">
          <label>내 이름
            <select aria-label="내 이름" value={me.id} onChange={e => pick(e.target.value)}>
              {data.roster.nurses.map(n => <option key={n.id} value={n.id}>{displayName(n)}</option>)}
            </select>
          </label>
        </section>
      )}
      {error && (
        <div className="empty-state">
          <p className="empty-title">{error}</p>
          <p className="empty-body">근무표를 보낸 사람에게 새 링크를 요청해 주세요.</p>
        </div>
      )}
      {!data && !error && <p className="local-empty" role="status">불러오는 중...</p>}
      {data && !me && <PickMe roster={data} disabled={false} onPick={pick} />}
      {data && me && <RosterContext.Provider value={data}>
        <View style={{ flex: 1 }} key={me.id}>
          {/* 한 달짜리 근무표 하나라 넘길 근무표는 없다. 날짜 팝업의 스와이프는 그대로 쓴다. */}
          <div className="swipe-area">
            <CalendarScreen onPick={setDate} />
          </div>
          {date && <DayDialog date={date} onDate={setDate} onClose={() => setDate(null)} />}
        </View>
      </RosterContext.Provider>}
    </main>
  )
}
