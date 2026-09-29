import { useState } from 'react'
import { displayName, type LocalRoster } from '../data'

/** "내 이름"이 없으면 달력 대신 이 화면에서 먼저 고르게 한다. */
export function PickMe({ roster, disabled, onPick }: { roster: LocalRoster; disabled: boolean; onPick: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const nurses = [...roster.roster.nurses].sort((a, b) => a.order - b.order)
  const q = query.trim()
  const shown = q ? nurses.filter(n => displayName(n).includes(q) || n.empNo.includes(q)) : nurses
  const search = nurses.some(n => n.empNo) ? '이름 또는 사번으로 찾기' : '이름으로 찾기'
  return (
    <section className="pick-me" aria-labelledby="pick-me-title">
      <h2 id="pick-me-title">이 근무표에서 내 이름을 골라 주세요</h2>
      <p>{roster.roster.year}년 {roster.roster.month}월 근무표입니다. 고른 사람의 근무와 인수인계 상대를 달력에 보여 드려요. 나중에 위의 "내 이름"에서 바꿀 수 있어요.</p>
      {nurses.length > 12 && (
        <input type="search" className="pick-search" placeholder={search} aria-label={search}
          value={query} onChange={e => setQuery(e.target.value)} />
      )}
      <div className="pick-grid">
        {shown.map(n => (
          <button key={n.id} type="button" disabled={disabled} onClick={() => onPick(n.id)}>
            {n.name?.trim()
              ? <><span className="pick-name">{n.name.trim()}</span>{n.empNo && <span className="pick-empno">{n.empNo}</span>}</>
              : <><span className="pick-name">{n.empNo || '(미확인)'}</span><span className="pick-empno">사번 · 이름 없음</span></>}
          </button>
        ))}
        {shown.length === 0 && <p className="pick-none">찾는 사람이 없습니다.</p>}
      </div>
    </section>
  )
}
