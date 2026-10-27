import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { guessMonth, joinLines, looksLikeEmpno, looksLikeName, normalizeName, pairRows, parseTitle } from '../src/server/ocr'

describe('서버 OCR 결과 해석', () => {
  test('칸 안의 여러 줄과 공백을 합치고, 가장 낮은 신뢰도를 쓴다', () => {
    assert.deepEqual(
      joinLines([{ text: '홍 길', confidence: 0.9 }, { text: '동', confidence: 0.6 }]),
      { text: '홍길동', confidence: 0.6 },
    )
    assert.deepEqual(joinLines([]), { text: '', confidence: 0 })
  })

  test('이름·사번 형식', () => {
    for (const ok of ['가나다', '가나다라', '가나']) assert.ok(looksLikeName(ok), ok)
    for (const bad of ['', '김', 'Kim', '가나다1', '|가나다', '가나다라마바']) assert.ok(!looksLikeName(bad), bad)
    assert.ok(looksLikeEmpno('123456'))
    for (const bad of ['12345', '1234567', '12345a', '']) assert.ok(!looksLikeEmpno(bad), bad)
  })

  test('이름·사번 순서로 보낸 결과를 행별로 되돌린다', () => {
    const line = (text: string) => [{ text, confidence: 0.9 }]
    const rows = pairRows([line('가나다'), line('111111'), line('라마바'), line('222222')], 2)
    assert.deepEqual(rows.map(r => [r.name?.text, r.empno?.text]), [['가나다', '111111'], ['라마바', '222222']])
    assert.equal(pairRows([line('가나다')], 2)[1].name, undefined, '모자란 결과는 비워 둔다')
  })

  test('이름 뒤의 월 주석을 제거하고, 모호한 원문은 자동 채우지 않는다', () => {
    for (const text of ['홍길동(12월~1)', '홍길동(12월*1)', '홍길동(12월~1월)', '홍 길 동 ( 12 월 ~ 1 )']) {
      assert.equal(normalizeName(text), '홍길동', text)
    }
    assert.equal(normalizeName('김철수(10월)'), '김철수')
    assert.equal(normalizeName('홍 길 동'), '홍길동')
    for (const text of ['', '김', 'Kim(10월)', '홍길동(13월)', '홍길동(0월)', '홍길동(10월~13)',
      '홍길동(10월', '홍길동10월)', '홍길동(휴직)', '홍길동(10월)김철수', '이름/사번']) {
      assert.equal(normalizeName(text), '', text)
    }
  })

  test('제목에서 년·월·병동을 읽고, 출력일자는 무시한다', () => {
    assert.deepEqual(parseTitle(['11병동 2027 년 03 월 근무표 출력일자 : 2027-02-20 10:00:00']), { year: 2027, month: 3, ward: '11병동' })
    assert.deepEqual(parseTitle(['출력일자 : 2027-02-20', '2027년 12월 근무표']), { year: 2027, month: 12 })
    assert.equal(parseTitle(['출력일자 : 2027-02-20 10:00:00']), null)
    assert.equal(parseTitle(['2027 년 13 월']), null)
    assert.equal(parseTitle([]), null)
  })

  test('제목을 못 읽으면 촬영일로 달을 짐작한다', () => {
    assert.deepEqual(guessMonth({ year: 2027, month: 2, day: 20 }), { year: 2027, month: 3 })
    assert.deepEqual(guessMonth({ year: 2027, month: 12, day: 28 }), { year: 2028, month: 1 })
    assert.deepEqual(guessMonth({ year: 2027, month: 3, day: 2 }), { year: 2027, month: 3 })
  })
})
