import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import type { ShiftKind } from '@sp/domain'
import { createReceived, isReceivedId, type Received, type ReceivedBackend } from '../src/received'
import { ShareGone, tokenFromText } from '../src/server/share'
import type { LocalRoster } from '../src/data'

const T1 = 'a'.repeat(43)
const T2 = 'b'.repeat(42) + '-'

function shared(names: string[], month = 10): LocalRoster {
  const days = new Date(2027, month, 0).getDate()
  const nurses = names.map((name, i) => ({ id: `p${i + 1}`, empNo: '', name, order: i }))
  const cells = nurses.flatMap(n => Array.from({ length: days }, (_, d) => ({
    nurseId: n.id, date: `2027-${String(month).padStart(2, '0')}-${String(d + 1).padStart(2, '0')}` as LocalRoster['roster']['cells'][number]['date'],
    raw: 'D', kind: 'D' as ShiftKind, flags: [], confidence: 1, edited: false,
  })))
  return { roster: { id: `shared-2027-${month}`, year: 2027, month, ward: '', nurses, cells }, settings: { reviewThreshold: 0.8 }, review: { empnos: [], cells: [] } }
}

function memory(): ReceivedBackend {
  const m = new Map<string, Received>()
  return { list: async () => [...m.values()], put: async r => { m.set(r.token, structuredClone(r)) }, remove: async t => { m.delete(t) } }
}

const own: LocalRoster[] = [{ ...shared(['가나다', '라마바'], 9), settings: { myNurseId: 'p2', reviewThreshold: 0.8 } }]
own[0].roster.nurses = own[0].roster.nurses.map(n => ({ ...n, id: `own-${n.id}`, empNo: n.id === 'p2' ? '222222' : '111111' }))
own[0].settings.myNurseId = 'own-p2'
own[0].roster.cells = own[0].roster.cells.map(c => ({ ...c, nurseId: `own-${c.nurseId}` }))

describe('공유받은 근무표', () => {
  test('붙여 넣은 글에서 토큰을 찾는다', () => {
    assert.equal(tokenFromText(`근무표 보세요 https://x.test/app/#share=${T1} 👍`), T1)
    assert.equal(tokenFromText(`  ${T2}\n`), T2)
    for (const bad of ['', 'https://x.test/app/', `#share=${T1}x`, 'hello']) assert.equal(tokenFromText(bad), null, bad)
  })

  test('추가하면 따로 된 id 로 들어가고, 내 근무표의 이름으로 "내 이름"을 맞춘다', async () => {
    const r = createReceived({ backend: memory(), fetch: async () => ({ data: shared(['사아자', '라마바']), expiresAt: 'e1' }) })
    const added = await r.add(T1, own)
    assert.ok(isReceivedId(added.data.roster.id))
    assert.equal(added.data.settings.myNurseId, 'p2', '라마바 = 내 이름')
    assert.equal((await r.list()).length, 1)
    await r.add(T1, own)
    assert.equal((await r.list()).length, 1, '같은 링크는 한 번만')
  })

  test('다시 받으면 수정이 반영되고, 고른 이름은 유지, 끝난 링크는 사본을 남기고 만료 표시', async () => {
    let names = ['사아자', '차카타']
    let gone = false
    let down = false
    const r = createReceived({
      backend: memory(),
      fetch: async () => {
        if (down) throw new TypeError('offline')
        if (gone) throw new ShareGone()
        return { data: shared(names), expiresAt: 'e1' }
      },
    })
    await r.add(T1, [])
    await r.setMe(T1, 'p1')
    names = ['사아자', '파하가']
    let [x] = await r.refresh([])
    assert.equal(x.data.roster.nurses[1].name, '파하가')
    assert.equal(x.data.settings.myNurseId, 'p1')
    down = true;
    [x] = await r.refresh([])
    assert.equal(x.gone, false, '연결이 안 되면 그대로')
    down = false; gone = true;
    [x] = await r.refresh([])
    assert.equal(x.gone, true)
    assert.equal(x.data.roster.nurses[1].name, '파하가', '마지막 사본은 남는다')
    assert.equal(await r.setMe(T1, 'nobody'), undefined)
    await r.remove(T1)
    assert.deepEqual(await r.list(), [])
  })
})
