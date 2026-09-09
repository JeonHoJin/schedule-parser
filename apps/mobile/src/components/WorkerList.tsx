import { StyleSheet, Text, View } from 'react-native'
import type { ShiftGroup } from '@sp/domain'
import { rawWorthShowing } from './ShiftBadge'
import { color, shiftColor, space } from '../theme'
import { displayName } from '../data'

interface Props {
  title: string
  hint: string
  group: ShiftGroup
  /** 이 날짜가 상세보기의 기준 날짜와 다르면 함께 보여준다 */
  showDate?: boolean
}

export function WorkerList({ title, hint, group, showDate }: Props) {
  const c = shiftColor[group.slot]
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <View style={[styles.dot, { backgroundColor: c.fg }]} />
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>

      {group.outOfRange ? (
        <Text style={styles.empty}>
          {group.date < '2026-09-01' ? '이전' : '다음'} 달 근무표를 추가하면 볼 수 있어요
        </Text>
      ) : group.workers.length === 0 ? (
        <Text style={styles.empty}>없음</Text>
      ) : (
        <View style={styles.chips}>
          {group.workers.map(w => (
            <View key={w.nurse.id} style={[styles.chip, { backgroundColor: c.bg }]}>
              <Text style={[styles.chipText, { color: c.fg }]}>{displayName(w.nurse)}</Text>
              {rawWorthShowing(w.cell.raw, w.cell.kind) && (
                <Text style={[styles.chipRaw, { color: c.fg }]}>{w.cell.raw}</Text>
              )}
            </View>
          ))}
        </View>
      )}
      {showDate && !group.outOfRange && (
        <Text style={styles.date}>
          {Number(group.date.slice(5, 7))}월 {Number(group.date.slice(8))}일 근무
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { marginBottom: space(6) },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: space(2) },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: space(2) },
  title: { fontSize: 15, fontWeight: '700', color: color.text },
  hint: { fontSize: 12, color: color.muted, marginLeft: space(2) },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: space(1),
    paddingVertical: space(1.5), paddingHorizontal: space(3), borderRadius: 999,
  },
  chipText: { fontSize: 14, fontWeight: '600' },
  chipRaw: { fontSize: 11, opacity: 0.7 },
  empty: { fontSize: 14, color: color.faint, paddingVertical: space(1) },
  date: { fontSize: 12, color: color.faint, marginTop: space(2) },
})
