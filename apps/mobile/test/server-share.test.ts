import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { fetchShared, shareUrl, ShareGone, tokenFromHash, toLocal, type SharedView } from '../src/server/share'

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123-_Z'

function view(): SharedView {
  const cells = ['p1', 'p2'].flatMap(id => [1, 2, 3].map(d => ({
    nurseId: id, date: `2027-02-0${d}` as const, raw: 'D', kind: 'D' as const, flags: [], edited: false,
  })))
  // 2월은 28일이지만 이 테스트에서는 3일치만 보내 parseBackup 검증을 확인한다.
  return {
    version: 1, expiresAt: '2027-03-01T00:00:00Z',
    roster: { year: 2027, month: 2, ward: '', nurses: [{ id: 'p1', name: '가나다', order: 0 }, { id: 'p2', name: '', order: 1 }], cells },
  }
}

function fullView(): SharedView {
  const v = view()
  v.roster.cells = ['p1', 'p2'].flatMap(id => Array.from({ length: 28 }, (_, i) => ({
    nurseId: id, date: `2027-02-${String(i + 1).padStart(2, '0')}` as SharedView['roster']['cells'][number]['date'],
    raw: 'D', kind: 'D' as const, flags: [], edited: i === 0,
  })))
  return v
}

describe('공유 링크', () => {
  test('링크 주소는 #share= 뒤에 토큰을 둔다', () => {
    assert.equal(shareUrl(TOKEN, 'https://example.test/app/index.html?x=1#old'), `https://example.test/app/#share=${TOKEN}`)
    assert.equal(tokenFromHash(`#share=${TOKEN}`), TOKEN)
    for (const bad of ['', '#share=', '#share=short', `#share=${TOKEN}x`, `#share=${TOKEN}&x=1`, '#other=1'])
      assert.equal(tokenFromHash(bad), null, bad)
  })

  test('받은 근무표를 앱 근무표로 바꾸고, 이름 없는 줄은 순서로 부른다', () => {
    const local = toLocal(fullView())
    assert.deepEqual(local.roster.nurses.map(n => [n.id, n.empNo, n.name]), [['p1', '', '가나다'], ['p2', '', '2번째 줄']])
    assert.equal(local.roster.cells.length, 56)
    assert.equal(local.roster.cells[0].confidence, 1)
    assert.equal(local.roster.cells[0].edited, true)
    assert.equal(local.settings.myNurseId, undefined)
    assert.throws(() => toLocal(view()), '칸이 모자란 근무표는 거절')
  })

  test('로그인 없이 읽고, 만료·중지된 링크는 따로 알린다', async () => {
    const seen: string[] = []
    const ok = await fetchShared(TOKEN, (async (url: string, init?: RequestInit) => {
      seen.push(url)
      assert.equal(init, undefined, '인증 헤더 없이 요청')
      return new Response(JSON.stringify(fullView()), { status: 200 })
    }) as typeof fetch)
    assert.equal(ok.expiresAt, '2027-03-01T00:00:00Z')
    assert.match(seen[0], /\/op\/roster-shared\?t=/)
    await assert.rejects(fetchShared(TOKEN, (async () => new Response('{}', { status: 404 })) as typeof fetch), ShareGone)
  })
})
