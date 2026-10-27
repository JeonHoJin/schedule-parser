import { test } from 'node:test'
import assert from 'node:assert/strict'
import { locateBand } from '../src/band'

test('앞뒤로 여분의 같은 폭 칸이 있어도 요청한 일수만 반환한다', () => {
  const centers = Array.from({ length: 34 }, (_, i) => 100 + i * 50)
  const band = locateBand(centers, centers.map(() => 25), 30)!
  assert.equal(band.columns.length, 30)
  assert.equal(new Set(band.columns).size, 30)
  assert.equal(band.synthesized.size, 0)
  assert.deepEqual(band.seed, [0, 29])
})

test('유효하지 않은 일수로 격자를 만들지 않는다', () => {
  for (const count of [0, -1, 2.5, NaN]) assert.equal(locateBand([1, 2, 3], [1, 1, 1], count), null)
})
