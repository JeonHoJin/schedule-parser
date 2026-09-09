import { StyleSheet, Text, View } from 'react-native'
import type { ShiftGroup, Team } from '@sp/domain'
import { rawWorthShowing } from './ShiftBadge'
import { color, shiftColor, space } from '../theme'
import { displayName } from '../data'

interface Props {
  title: string
  hint: string
  group: ShiftGroup
  /** 이 날짜가 상세보기의 기준 날짜와 다르면 함께 보여준다 */
  showDate?: boolean
  /**
   * 나의 팀. 지정하면 같은 팀 근무자를 하이라이트한다.
   * 이전·다음 근무자에서만 의미가 있다 — 그 사람이 나의 직접 인계 상대다.
   */
  myTeam?: Team | null
}

const TEAM_LABEL: Record<Team, string> = {
  A: 'A팀', B: 'B팀', C: 'C팀', D: 'D팀', ACTING: '액팅',
}

export function WorkerList({ title, hint, group, showDate, myTeam }: Props) {
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
          {group.workers.map(w => {
            const isPartner = myTeam != null && myTeam !== 'ACTING' && w.team === myTeam
            return (
              <View
                key={w.nurse.id}
                style={[
                  styles.chip,
                  { backgroundColor: c.bg },
                  isPartner && { borderColor: c.fg, borderWidth: 2 },
                ]}
              >
                <Text style={[styles.chipText, { color: c.fg }]}>{displayName(w.nurse)}</Text>
                <Text style={[styles.chipTeam, { color: c.fg }]}>{TEAM_LABEL[w.team]}</Text>
                {rawWorthShowing(w.cell.raw, w.cell.kind) && (
                  <Text style={[styles.chipRaw, { color: c.fg }]}>{w.cell.raw}</Text>
                )}
              </View>
            )
          })}
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
    borderWidth: 2, borderColor: 'transparent',
  },
  chipText: { fontSize: 14, fontWeight: '600' },
  chipTeam: { fontSize: 11, fontWeight: '700', opacity: 0.75 },
  chipRaw: { fontSize: 11, opacity: 0.7 },
  empty: { fontSize: 14, color: color.faint, paddingVertical: space(1) },
  date: { fontSize: 12, color: color.faint, marginTop: space(2) },
})
