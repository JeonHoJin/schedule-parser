import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { joinLines, looksLikeEmpno, looksLikeName, pairRows } from '../src/server/ocr'

describe('서버 OCR 결과 해석', () => {
  test('칸 안의 여러 줄과 공백을 합치고, 가장 낮은 신뢰도를 쓴다', () => {
    assert.deepEqual(
      joinLines([{ text: '홍 길', confidence: 0.9 }, { text: '동', confidence: 0.6 }]),
      { text: '홍길동', confidence: 0.6 },
    )
    assert.deepEqual(joinLines([]), { text: '', confidence: 0 })
  })

  test('이름·사번 형식', () => {
    for (const ok of ['김민정', '남궁민수', '이서']) assert.ok(looksLikeName(ok), ok)
    for (const bad of ['', '김', 'Kim', '김민정1', '|김민정', '김민정남궁민']) assert.ok(!looksLikeName(bad), bad)
    assert.ok(looksLikeEmpno('193725'))
    for (const bad of ['19372', '1937255', '19372a', '']) assert.ok(!looksLikeEmpno(bad), bad)
  })

  test('이름·사번 순서로 보낸 결과를 행별로 되돌린다', () => {
    const line = (text: string) => [{ text, confidence: 0.9 }]
    const rows = pairRows([line('가나다'), line('111111'), line('라마바'), line('222222')], 2)
    assert.deepEqual(rows.map(r => [r.name?.text, r.empno?.text]), [['가나다', '111111'], ['라마바', '222222']])
    assert.equal(pairRows([line('가나다')], 2)[1].name, undefined, '모자란 결과는 비워 둔다')
  })
})
