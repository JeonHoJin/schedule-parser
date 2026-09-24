import { test } from 'node:test'
import assert from 'node:assert/strict'
import { swipeDirection } from '../src/swipe'

const at = (x: number, y: number, t = 0) => ({ x, y, t })

test('가로로 충분히 움직인 빠른 스와이프만 인정한다', () => {
  assert.equal(swipeDirection(at(300, 400), at(180, 410, 200)), 'left')
  assert.equal(swipeDirection(at(100, 400), at(240, 380, 200)), 'right')
  assert.equal(swipeDirection(at(300, 400), at(270, 400, 100)), null, '너무 짧음')
  assert.equal(swipeDirection(at(300, 400), at(200, 300, 200)), null, '대각선·세로 스크롤')
  assert.equal(swipeDirection(at(300, 400), at(100, 400, 1500)), null, '너무 느림(끌기)')
})
