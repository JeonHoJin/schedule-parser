import { StyleSheet, Text, View } from 'react-native'
import { SHIFT_LABEL, type ShiftKind } from '@sp/domain'
import { shiftColor } from '../theme'

const SHORT: Record<ShiftKind, string> = {
  D: 'D', E: 'E', N: 'N', OFF: '휴', OTHER: '·', EMPTY: '',
}

/** 배지가 이미 같은 내용을 보여주고 있으면 원문을 따로 적을 필요가 없다 */
export const rawWorthShowing = (raw: string, kind: ShiftKind): boolean =>
  raw !== kind && !(kind === 'OFF' && raw === '//')

export function ShiftBadge({ kind, size = 'sm' }: { kind: ShiftKind; size?: 'sm' | 'lg' }) {
  if (kind === 'EMPTY') return null
  const c = shiftColor[kind]
  const lg = size === 'lg'
  return (
    <View style={[styles.badge, lg && styles.badgeLg, { backgroundColor: c.bg }]}>
      <Text style={[styles.text, lg && styles.textLg, { color: c.fg }]}>
        {lg ? SHIFT_LABEL[kind] || '—' : SHORT[kind]}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 22, height: 20, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5,
  },
  badgeLg: { minWidth: 0, height: 34, borderRadius: 10, paddingHorizontal: 14 },
  text: { fontSize: 12, fontWeight: '700' },
  textLg: { fontSize: 16, fontWeight: '700' },
})
