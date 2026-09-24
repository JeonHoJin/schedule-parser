/**
 * 달력에서 날짜를 누르면 뜨는 팝업: 내 근무와 인수인계 상대, 그리고 병동 전체 근무.
 * 병동 전체 목록에서는 누구의 근무든 바로 고칠 수 있다.
 */
import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import {
  addDays, handover, monthOf, onShift, weekdayKo,
  type CycleSlot, type IsoDate, type Nurse, type ShiftGroup, type ShiftKind, type Team,
} from '@sp/domain'
import { ShiftBadge, rawWorthShowing } from '../components/ShiftBadge'
import { color, shiftColor, space } from '../theme'
import { displayName, useRoster } from '../data'
import { MAX_OTHER_LABEL } from '../roster-edit'
import { useSwipe, type SwipeDirection } from '../swipe'

const ORDER: ShiftKind[] = ['D', 'E', 'N', 'OFF', 'OTHER', 'EMPTY']
const CHOICES: Array<{ kind: ShiftKind; label: string }> = [
  { kind: 'D', label: 'D' }, { kind: 'E', label: 'E' }, { kind: 'N', label: 'N' },
  { kind: 'OFF', label: '휴' }, { kind: 'OTHER', label: '기타' }, { kind: 'EMPTY', label: '비움' },
]

const SLOTS: CycleSlot[] = ['D', 'E', 'N']
const TEAMS: Team[] = ['A', 'B', 'C', 'D', 'ACTING']
const TEAM_LABEL: Record<Team, string> = { A: 'A', B: 'B', C: 'C', D: 'D', ACTING: '액팅' }
const SLOT_NAME: Record<CycleSlot, string> = { D: '데이', E: '이브닝', N: '나이트' }

/** 표 칸에 들어갈 짧은 이름: 이름이 없으면 사번 */
const shortName = (n: Nurse) => n.name?.trim() || n.empNo || '?'

/** 인계 상대: 이전·다음 시간대에서 나와 같은 팀. 액팅은 정해진 상대가 없다. */
function partners(group: ShiftGroup, myTeam: Team | null) {
  if (!myTeam || myTeam === 'ACTING') return []
  return group.workers.filter(w => w.team === myTeam)
}

function HandoverLine({ label, group, partnersOf, today }: {
  label: string; group: ShiftGroup; partnersOf: ReturnType<typeof partners>; today: IsoDate
}) {
  const when = group.date === today ? '' : group.date < today ? '전날 ' : '다음날 '
  return (
    <div className="ho-line">
      <span className="ho-label">{label}</span>
      {group.outOfRange
        ? <span className="ho-none">{group.date < today ? '이전' : '다음'} 달 근무표를 추가하면 볼 수 있어요</span>
        : partnersOf.length === 0
          ? <span className="ho-none">없음</span>
          : <span>
              <span className={`slot-chip slot-${group.slot}`}>{when}{group.slot}</span>
              {partnersOf.map(w => <span key={w.nurse.id} className="ho-name">{displayName(w.nurse)}</span>)}
            </span>}
    </div>
  )
}

export type EditCell = (nurseId: string, date: IsoDate, kind: ShiftKind, label?: string) => Promise<void>

export function DayDialog({ date, onDate, onClose, onEdit }: {
  date: IsoDate
  onDate: (date: IsoDate) => void
  onClose: () => void
  onEdit: EditCell
}) {
  const { index, me } = useRoster()
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [other, setOther] = useState('')
  const [otherOpen, setOtherOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [slide, setSlide] = useState<SwipeDirection | null>(null)
  const sheet = useRef<HTMLDivElement>(null)
  const pushed = useRef(false)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // 휴대폰의 뒤로 가기가 앱을 떠나지 않고 팝업만 닫도록 history 에 한 칸 넣어 둔다.
  useEffect(() => {
    history.pushState({ dayDialog: true }, '')
    pushed.current = true
    const onPop = () => { pushed.current = false; closeRef.current() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    addEventListener('popstate', onPop)
    addEventListener('keydown', onKey)
    sheet.current?.focus()
    return () => {
      removeEventListener('popstate', onPop)
      removeEventListener('keydown', onKey)
      if (pushed.current) { pushed.current = false; history.back() }
    }
  }, [])

  useEffect(() => { setEditing(null); setError('') }, [date])

  function close() {
    if (pushed.current) { pushed.current = false; history.back() }
    closeRef.current()
  }

  const days = monthOf(index, me.id).map(c => c.date)
  const prev = addDays(date, -1), next = addDays(date, 1)
  function go(dir: SwipeDirection) {
    const to = dir === 'left' ? next : prev
    if (!days.includes(to)) return
    setSlide(dir)
    onDate(to)
  }
  // 왼쪽으로 밀면 다음날, 오른쪽으로 밀면 전날
  const swipe = useSwipe(go)
  const mine = index.cell(me.id, date)
  const chain = handover(index, me.id, date)
  const day = Number(date.slice(-2))
  const kind = mine?.kind ?? 'EMPTY'
  const title = `${Number(date.slice(5, 7))}월 ${day}일 (${weekdayKo(date)})`
  const myTeam = chain?.myTeam ?? null
  const groups = { D: onShift(index, date, 'D'), E: onShift(index, date, 'E'), N: onShift(index, date, 'N') }
  // 오늘 표에 보이는 인계 상대(같은 날의 이전·다음 시간대)를 표시한다.
  const highlight = new Set(chain
    ? [...partners(chain.previous, myTeam), ...partners(chain.next, myTeam)]
      .filter(w => w.cell.date === date).map(w => w.nurse.id)
    : [])

  const all = index.onDate(date)
    .map(c => ({ cell: c, nurse: index.nurse(c.nurseId)! }))
    .filter(x => x.nurse)
    .sort((a, b) => ORDER.indexOf(a.cell.kind) - ORDER.indexOf(b.cell.kind) || a.nurse.order - b.nurse.order)
  const working = all.filter(x => x.cell.kind !== 'EMPTY').length
  const offCount = all.filter(x => x.cell.kind === 'OFF').length
  const otherCount = all.filter(x => x.cell.kind === 'OTHER').length

  async function save(nurseId: string, k: ShiftKind, label?: string) {
    setSaving(true)
    setError('')
    try {
      await onEdit(nurseId, date, k, label)
      setEditing(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했습니다.')
    } finally { setSaving(false) }
  }

  return (
    <div className="day-backdrop" onClick={close}>
      <div className="day-sheet" role="dialog" aria-modal="true" aria-label={`${title} 근무`}
        tabIndex={-1} ref={sheet} onClick={e => e.stopPropagation()}>
        <div className="day-head">
          <button type="button" className="day-nav" aria-label="전날" disabled={!days.includes(prev)} onClick={() => go('right')}>‹</button>
          <h2>{title}</h2>
          <button type="button" className="day-nav" aria-label="다음날" disabled={!days.includes(next)} onClick={() => go('left')}>›</button>
          <button type="button" className="day-close" aria-label="닫기" onClick={close}>✕</button>
        </div>
        <div className="day-body" {...swipe}>
          <div key={date} className={slide ? `slide-${slide}` : undefined}>
          <div className="my-shift">
            <span className="my-label">내 근무</span>
            <ShiftBadge kind={kind} size="lg" />
            {myTeam && <span className="my-team">{myTeam === 'ACTING' ? '액팅' : `${myTeam}팀`}</span>}
            {kind === 'EMPTY' && <span className="my-raw">비어 있음</span>}
            {mine && rawWorthShowing(mine.raw, kind) && <span className="my-raw">근무표 표기 “{mine.raw}”</span>}
          </div>

          <div className="team-grid-wrap">
            <table className="team-grid">
              <thead>
                <tr><th aria-label="근무" />{TEAMS.map(t => <th key={t} scope="col">{TEAM_LABEL[t]}</th>)}</tr>
              </thead>
              <tbody>
                {SLOTS.map(slot => (
                  <tr key={slot} className={`slot-${slot}`}>
                    <th scope="row"><span className={`slot-chip slot-${slot}`} title={SLOT_NAME[slot]}>{slot}</span></th>
                    {TEAMS.map(team => (
                      <td key={team}>
                        {groups[slot].workers.filter(w => w.team === team).map(w => {
                          const isMe = w.nurse.id === me.id
                          const isPartner = highlight.has(w.nurse.id)
                          return (
                            <span key={w.nurse.id} title={displayName(w.nurse)}
                              className={`grid-name${isMe ? ' me' : ''}${isPartner ? ' partner' : ''}`}>
                              {shortName(w.nurse)}
                            </span>
                          )
                        })}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {chain && (
            <div className="handover">
              <HandoverLine label="인계 받기" group={chain.previous} partnersOf={partners(chain.previous, chain.myTeam)} today={date} />
              <HandoverLine label="인계 주기" group={chain.next} partnersOf={partners(chain.next, chain.myTeam)} today={date} />
              {chain.myTeam === 'ACTING' && <p className="ho-note">액팅은 정해진 인계 상대가 없어요.</p>}
            </div>
          )}
          {!chain && kind === 'OFF' && <p className="ho-note">쉬는 날이에요.</p>}
          {offCount + otherCount > 0 && (
            <p className="off-line">휴무 {offCount}명{otherCount ? ` · 기타 ${otherCount}명` : ''}</p>
          )}

          <Pressable onPress={() => setExpanded(v => !v)} style={styles.toggle} accessibilityRole="button">
            <Text style={styles.toggleText}>
              {expanded ? '병동 전체 접기' : `병동 전체 보기·수정 (근무 ${working}명)`}
            </Text>
          </Pressable>

          {expanded && <>
            <Text style={styles.editHint}>이름을 누르면 그 사람의 이날 근무를 바꿀 수 있어요. 바꾼 근무는 이 기기에 바로 저장돼요.</Text>
            {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
            <View style={styles.allBox}>
              {all.map(({ cell, nurse }) => {
                const open = editing === nurse.id
                return (
                  <View key={nurse.id} style={[styles.rowWrap, open && styles.rowOpen]}>
                    <Pressable style={styles.row} accessibilityRole="button"
                      accessibilityLabel={`${displayName(nurse)} 근무 바꾸기`}
                      onPress={() => {
                        setEditing(open ? null : nurse.id)
                        setOtherOpen(cell.kind === 'OTHER')
                        setOther(cell.kind === 'OTHER' ? cell.raw : '')
                        setError('')
                      }}>
                      <View style={styles.badgeSlot}>
                        {cell.kind === 'EMPTY' ? <Text style={styles.emptyMark}>—</Text> : <ShiftBadge kind={cell.kind} />}
                      </View>
                      <Text style={[styles.rowName, nurse.id === me.id && styles.rowMe]}>{displayName(nurse)}</Text>
                      {rawWorthShowing(cell.raw, cell.kind) && <Text style={styles.rowRaw}>{cell.raw}</Text>}
                      {cell.edited && <Text style={styles.edited}>수정됨</Text>}
                      <Text style={styles.chevron}>{open ? '닫기' : '변경'}</Text>
                    </Pressable>
                    {open && (
                      <View style={styles.picker}>
                        <View style={styles.choices}>
                          {CHOICES.map(c => {
                            const active = cell.kind === c.kind
                            const tone = shiftColor[c.kind]
                            return (
                              <Pressable key={c.kind} disabled={saving || (active && c.kind !== 'OTHER')}
                                accessibilityRole="button" accessibilityState={{ selected: active }}
                                style={[styles.choice, { backgroundColor: c.kind === 'EMPTY' ? color.bg : tone.bg }, active && { borderColor: tone.fg }]}
                                onPress={() => c.kind === 'OTHER' ? setOtherOpen(true) : void save(nurse.id, c.kind)}>
                                <Text style={[styles.choiceText, { color: c.kind === 'EMPTY' ? color.muted : tone.fg }]}>{c.label}</Text>
                              </Pressable>
                            )
                          })}
                        </View>
                        {otherOpen && (
                          <View style={styles.otherRow}>
                            <TextInput value={other} onChangeText={v => setOther(v.slice(0, MAX_OTHER_LABEL))}
                              placeholder="표기 (예: 교육, 연차)" style={styles.otherInput} maxLength={MAX_OTHER_LABEL}
                              accessibilityLabel="기타 근무 표기" autoFocus />
                            <Pressable disabled={saving || !other.trim()} style={[styles.otherSave, (!other.trim() || saving) && styles.disabled]}
                              accessibilityRole="button" onPress={() => void save(nurse.id, 'OTHER', other)}>
                              <Text style={styles.otherSaveText}>기타로 저장</Text>
                            </Pressable>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                )
              })}
            </View>
          </>}
          </div>
        </div>
      </div>
    </div>
  )
}

const styles = StyleSheet.create({
  toggle: { marginTop: space(4), paddingVertical: space(3), alignItems: 'center' },
  toggleText: { fontSize: 14, color: color.accent, fontWeight: '600' },
  editHint: { fontSize: 12, color: color.muted, marginBottom: space(2), lineHeight: 17 },
  error: { fontSize: 13, color: '#A12727', marginBottom: space(2) },
  allBox: { backgroundColor: color.card, borderRadius: 16, borderWidth: 1, borderColor: color.line, overflow: 'hidden' },
  rowWrap: { borderBottomWidth: 1, borderBottomColor: color.line },
  rowOpen: { backgroundColor: '#F4F7FF' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(2.5), paddingHorizontal: space(4), minHeight: 44 },
  badgeSlot: { width: 28, alignItems: 'center' },
  emptyMark: { color: color.faint, fontSize: 14 },
  rowName: { flex: 1, fontSize: 14, color: color.text },
  rowMe: { fontWeight: '800', color: color.accent },
  rowRaw: { fontSize: 12, color: color.faint },
  edited: { fontSize: 11, color: '#8A5A00', backgroundColor: '#FFF1D6', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, overflow: 'hidden' },
  chevron: { fontSize: 12, color: color.accent, fontWeight: '600' },
  picker: { paddingHorizontal: space(4), paddingBottom: space(3) },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  choice: { minWidth: 46, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space(2), borderWidth: 2, borderColor: 'transparent' },
  choiceText: { fontSize: 15, fontWeight: '700' },
  otherRow: { flexDirection: 'row', gap: space(2), marginTop: space(2), alignItems: 'center' },
  otherInput: { flex: 1, height: 40, borderWidth: 1, borderColor: color.line, borderRadius: 8, paddingHorizontal: space(3), fontSize: 16, backgroundColor: color.card },
  otherSave: { height: 40, paddingHorizontal: space(3), borderRadius: 8, backgroundColor: color.accent, justifyContent: 'center' },
  otherSaveText: { color: 'white', fontWeight: '700', fontSize: 14 },
  disabled: { opacity: 0.5 },
})
