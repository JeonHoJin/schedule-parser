import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import {
  handover, SHIFT_LABEL, weekdayKo, type IsoDate, type ShiftKind,
} from '@sp/domain'
import { ShiftBadge, rawWorthShowing } from '../components/ShiftBadge'
import { WorkerList } from '../components/WorkerList'
import { color, shiftColor, space } from '../theme'
import { displayName, useRoster } from '../data'

const ORDER: ShiftKind[] = ['D', 'E', 'N', 'OFF', 'OTHER']

export function ShiftDetailScreen({ date, onBack }: { date: IsoDate; onBack: () => void }) {
  const { index, me } = useRoster()
  const [expanded, setExpanded] = useState(false)
  const mine = index.cell(me.id, date)
  const chain = handover(index, me.id, date)
  const day = Number(date.slice(-2))
  const kind = mine?.kind ?? 'EMPTY'

  const all = index.onDate(date)
    .map(c => ({ cell: c, nurse: index.nurse(c.nurseId)! }))
    .filter(x => x.nurse && x.cell.kind !== 'EMPTY')
    .sort((a, b) =>
      ORDER.indexOf(a.cell.kind) - ORDER.indexOf(b.cell.kind) || a.nurse.order - b.nurse.order)

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Pressable onPress={onBack} style={styles.back}>
        <Text style={styles.backText}>‹ 달력</Text>
      </Pressable>

      <Text style={styles.date}>{Number(date.slice(5, 7))}월 {day}일 ({weekdayKo(date)})</Text>
      <View style={styles.myShift}>
        <ShiftBadge kind={kind} size="lg" />
        {mine && rawWorthShowing(mine.raw, kind) && (
          <Text style={styles.raw}>근무표 표기 “{mine.raw}”</Text>
        )}
      </View>

      {!chain ? (
        <Text style={styles.noChain}>
          {kind === 'OFF' ? '쉬는 날이에요.' : '이 날은 인수인계 체인이 없어요.'}
        </Text>
      ) : (
        <View style={styles.chain}>
          <WorkerList
            title="이전 근무자"
            hint="나에게 인계"
            group={chain.previous}
            showDate={chain.previous.date !== date}
            myTeam={chain.myTeam}
          />
          <WorkerList title="동시간 근무자" hint="함께 근무" group={chain.concurrent} />
          <WorkerList
            title="다음 근무자"
            hint="내가 인계"
            group={chain.next}
            showDate={chain.next.date !== date}
            myTeam={chain.myTeam}
          />
        </View>
      )}

      <Pressable onPress={() => setExpanded(v => !v)} style={styles.toggle}>
        <Text style={styles.toggleText}>
          {expanded ? '병동 전체 접기' : `병동 전체 보기 (${all.length}명)`}
        </Text>
      </Pressable>

      {expanded && (
        <View style={styles.allBox}>
          {all.map(({ cell, nurse }) => (
            <View key={nurse.id} style={styles.row}>
              <ShiftBadge kind={cell.kind} />
              <Text style={[styles.rowName, nurse.id === me.id && styles.rowMe]}>
                {displayName(nurse)}
              </Text>
              {rawWorthShowing(cell.raw, cell.kind) && (
                <Text style={styles.rowRaw}>{cell.raw}</Text>
              )}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { padding: space(5), paddingBottom: space(12), maxWidth: 520, width: '100%', alignSelf: 'center' },
  back: { paddingVertical: space(2), marginBottom: space(1) },
  backText: { fontSize: 15, color: color.accent, fontWeight: '600' },
  date: { fontSize: 24, fontWeight: '800', color: color.text },
  myShift: { flexDirection: 'row', alignItems: 'center', gap: space(3), marginTop: space(3) },
  raw: { fontSize: 13, color: color.muted },
  noChain: { fontSize: 15, color: color.muted, marginTop: space(6) },

  chain: {
    marginTop: space(6), backgroundColor: color.card, borderRadius: 16,
    padding: space(5), borderWidth: 1, borderColor: color.line,
  },

  toggle: { marginTop: space(5), paddingVertical: space(3), alignItems: 'center' },
  toggleText: { fontSize: 14, color: color.accent, fontWeight: '600' },
  allBox: {
    backgroundColor: color.card, borderRadius: 16,
    borderWidth: 1, borderColor: color.line, overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space(3),
    paddingVertical: space(2.5), paddingHorizontal: space(4),
    borderBottomWidth: 1, borderBottomColor: color.line,
  },
  rowName: { flex: 1, fontSize: 14, color: color.text },
  rowMe: { fontWeight: '800', color: color.accent },
  rowRaw: { fontSize: 12, color: color.faint },
})
