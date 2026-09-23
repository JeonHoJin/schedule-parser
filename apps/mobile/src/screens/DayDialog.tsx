/**
 * 달력에서 날짜를 누르면 뜨는 팝업: 내 근무와 인수인계 상대, 그리고 병동 전체 근무.
 * 병동 전체 목록에서는 누구의 근무든 바로 고칠 수 있다.
 */
import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import {
  addDays, handover, monthOf, weekdayKo, type IsoDate, type ShiftKind,
} from '@sp/domain'
import { ShiftBadge, rawWorthShowing } from '../components/ShiftBadge'
import { WorkerList } from '../components/WorkerList'
import { color, shiftColor, space } from '../theme'
import { displayName, useRoster } from '../data'
import { MAX_OTHER_LABEL } from '../roster-edit'

const ORDER: ShiftKind[] = ['D', 'E', 'N', 'OFF', 'OTHER', 'EMPTY']
const CHOICES: Array<{ kind: ShiftKind; label: string }> = [
  { kind: 'D', label: 'D' }, { kind: 'E', label: 'E' }, { kind: 'N', label: 'N' },
  { kind: 'OFF', label: '휴' }, { kind: 'OTHER', label: '기타' }, { kind: 'EMPTY', label: '비움' },
]

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
  const mine = index.cell(me.id, date)
  const chain = handover(index, me.id, date)
  const day = Number(date.slice(-2))
  const kind = mine?.kind ?? 'EMPTY'
  const title = `${Number(date.slice(5, 7))}월 ${day}일 (${weekdayKo(date)})`

  const all = index.onDate(date)
    .map(c => ({ cell: c, nurse: index.nurse(c.nurseId)! }))
    .filter(x => x.nurse)
    .sort((a, b) => ORDER.indexOf(a.cell.kind) - ORDER.indexOf(b.cell.kind) || a.nurse.order - b.nurse.order)
  const working = all.filter(x => x.cell.kind !== 'EMPTY').length

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
          <button type="button" className="day-nav" aria-label="전날" disabled={!days.includes(prev)} onClick={() => onDate(prev)}>‹</button>
          <h2>{title}</h2>
          <button type="button" className="day-nav" aria-label="다음날" disabled={!days.includes(next)} onClick={() => onDate(next)}>›</button>
          <button type="button" className="day-close" aria-label="닫기" onClick={close}>✕</button>
        </div>
        <div className="day-body">
          <View style={styles.myShift}>
            <Text style={styles.label}>내 근무</Text>
            <ShiftBadge kind={kind} size="lg" />
            {kind === 'EMPTY' && <Text style={styles.raw}>비어 있음</Text>}
            {mine && rawWorthShowing(mine.raw, kind) && <Text style={styles.raw}>근무표 표기 “{mine.raw}”</Text>}
          </View>

          {!chain ? (
            <Text style={styles.noChain}>
              {kind === 'OFF' ? '쉬는 날이에요.' : '이 날은 인수인계 체인이 없어요.'}
            </Text>
          ) : (
            <View style={styles.chain}>
              <WorkerList title="이전 근무자" hint="나에게 인계" group={chain.previous}
                showDate={chain.previous.date !== date} myTeam={chain.myTeam} />
              <WorkerList title="동시간 근무자" hint="함께 근무" group={chain.concurrent} />
              <WorkerList title="다음 근무자" hint="내가 인계" group={chain.next}
                showDate={chain.next.date !== date} myTeam={chain.myTeam} />
            </View>
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
  )
}

const styles = StyleSheet.create({
  myShift: { flexDirection: 'row', alignItems: 'center', gap: space(3), flexWrap: 'wrap' },
  label: { fontSize: 13, color: color.muted, fontWeight: '600' },
  raw: { fontSize: 13, color: color.muted },
  noChain: { fontSize: 15, color: color.muted, marginTop: space(5) },
  chain: {
    marginTop: space(5), backgroundColor: color.card, borderRadius: 16,
    padding: space(4), paddingBottom: 0, borderWidth: 1, borderColor: color.line,
  },
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
