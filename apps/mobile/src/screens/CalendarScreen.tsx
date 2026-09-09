import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import {
  daysInMonth, isoDate, monthOf, summarize, weekdayIndex, WEEKDAY_KO,
  type IsoDate, type ShiftKind,
} from '@sp/domain'
import { ShiftBadge } from '../components/ShiftBadge'
import { color, shiftColor, space } from '../theme'
import { displayName, useRoster } from '../data'

export function CalendarScreen({ onPick }: { onPick: (date: IsoDate) => void }) {
  const { index, me, review, roster } = useRoster()
  const now = new Date()
  const TODAY = isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate())
  const { year, month } = roster
  const total = daysInMonth(year, month)
  const mine = monthOf(index, me.id)
  const kindOf = new Map<IsoDate, ShiftKind>(mine.map(c => [c.date, c.kind]))
  const tally = summarize(mine)

  // 1일이 무슨 요일인지에 따라 앞을 비운다 (월요일 시작)
  const lead = weekdayIndex(isoDate(year, month, 1))
  const slots: Array<number | null> = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ]
  while (slots.length % 7 !== 0) slots.push(null)

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.ward}>{roster.ward}</Text>
      <Text style={styles.month}>{year}년 {month}월</Text>
      <Text style={styles.who}>{displayName(me)}</Text>

      <View style={styles.summary}>
        {(['D', 'E', 'N', 'OFF'] as ShiftKind[]).map(k => (
          <View key={k} style={[styles.stat, { backgroundColor: shiftColor[k].bg }]}>
            <Text style={[styles.statNum, { color: shiftColor[k].fg }]}>{tally[k] ?? 0}</Text>
            <Text style={[styles.statLabel, { color: shiftColor[k].fg }]}>
              {k === 'OFF' ? 'Off' : k}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.grid}>
        {WEEKDAY_KO.map((w, i) => (
          <View key={w} style={styles.cellHead}>
            <Text style={[styles.weekday, i >= 5 && styles.weekend]}>{w}</Text>
          </View>
        ))}

        {slots.map((day, i) => {
          if (day === null) return <View key={`x${i}`} style={styles.cell} />
          const date = isoDate(year, month, day)
          const kind = kindOf.get(date) ?? 'EMPTY'
          const working = kind === 'D' || kind === 'E' || kind === 'N'
          const today = date === TODAY
          return (
            <Pressable
              key={date}
              style={[styles.cell, today && styles.cellToday]}
              onPress={() => onPick(date)}
            >
              <Text style={[styles.day, i % 7 >= 5 && styles.weekend, today && styles.dayToday]}>
                {day}
              </Text>
              <View style={styles.badgeSlot}>
                <ShiftBadge kind={kind} />
              </View>
              {working && <View style={[styles.mark, { backgroundColor: shiftColor[kind].fg }]} />}
            </Pressable>
          )
        })}
      </View>

      {(review.cells.length > 0 || review.empnos.length > 0) && (
        <View style={styles.review}>
          <Text style={styles.reviewTitle}>확인이 필요해요</Text>
          <Text style={styles.reviewBody}>
            근무 {review.cells.length}칸, 사번 {review.empnos.length}명이
            자동 인식만으로는 확실하지 않아요.
          </Text>
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { padding: space(5), paddingBottom: space(12), maxWidth: 520, width: '100%', alignSelf: 'center' },
  ward: { fontSize: 13, color: color.muted, fontWeight: '600' },
  month: { fontSize: 28, fontWeight: '800', color: color.text, marginTop: space(1) },
  who: { fontSize: 14, color: color.muted, marginTop: space(1) },

  summary: { flexDirection: 'row', gap: space(2), marginTop: space(4), marginBottom: space(5) },
  stat: { flex: 1, borderRadius: 12, paddingVertical: space(3), alignItems: 'center' },
  statNum: { fontSize: 20, fontWeight: '800' },
  statLabel: { fontSize: 11, fontWeight: '700', marginTop: 2 },

  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    backgroundColor: color.card, borderRadius: 16, padding: space(2),
    borderWidth: 1, borderColor: color.line,
  },
  cellHead: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: space(2) },
  weekday: { fontSize: 12, fontWeight: '700', color: color.muted },
  weekend: { color: '#C4564F' },
  cell: {
    width: `${100 / 7}%`, height: 62, alignItems: 'center',
    paddingTop: space(1.5), borderRadius: 10,
  },
  cellToday: { backgroundColor: '#EEF3FF' },
  day: { fontSize: 13, color: color.text, fontWeight: '600' },
  dayToday: { color: color.accent, fontWeight: '800' },
  badgeSlot: { marginTop: space(1.5), height: 20, justifyContent: 'center' },
  mark: { width: 14, height: 2, borderRadius: 1, marginTop: space(1) },

  review: {
    marginTop: space(5), padding: space(4), borderRadius: 12,
    backgroundColor: '#FFF6E5', borderWidth: 1, borderColor: '#F3DFB6',
  },
  reviewTitle: { fontSize: 14, fontWeight: '700', color: '#8A5A00' },
  reviewBody: { fontSize: 13, color: '#8A5A00', marginTop: space(1), lineHeight: 19 },
})
