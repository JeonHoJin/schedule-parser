import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import type { Nurse, Roster, ShiftKind } from '@sp/domain'
import { createStore, upsert, type Cache, type SyncMeta } from '../src/store'
import type { RosterApi, RosterSummary } from '../src/server/rosters'
import type { LocalRoster } from '../src/data'

function roster(id: string, month: number, name = '가나다'): LocalRoster {
  const nurses: Nurse[] = [{ id: 'n1', empNo: '111111', name, order: 0 }]
  const days = new Date(2027, month, 0).getDate()
  const cells = Array.from({ length: days }, (_, i) => ({
    nurseId: 'n1', date: `2027-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}` as Roster['cells'][number]['date'],
    raw: 'D', kind: 'D' as ShiftKind, flags: [], confidence: 1, edited: false,
  }))
  return { roster: { id, year: 2027, month, ward: '', nurses, cells }, settings: { reviewThreshold: 0.8 }, review: { empnos: [], cells: [] } }
}

/** 서버 흉내: 근무표와 updatedAt, 호출 기록. `down` 이면 모든 호출이 실패한다. */
function fakeServer(initial: LocalRoster[] = []) {
  const docs = new Map(initial.map(d => [d.roster.id, d]))
  const stamps = new Map(initial.map(d => [d.roster.id, 't0']))
  let clock = 0
  const calls: string[] = []
  const state = { down: false }
  const guard = (what: string) => { calls.push(what); if (state.down) throw new Error('offline') }
  const api: RosterApi = {
    async list() {
      guard('list')
      return [...docs.values()].map((d): RosterSummary => ({
        id: d.roster.id, year: d.roster.year, month: d.roster.month, ward: '', nurses: 1, updatedAt: stamps.get(d.roster.id)!,
      }))
    },
    async get(id) { guard(`get ${id}`); return structuredClone(docs.get(id)!) },
    async put(data) {
      guard(`put ${data.roster.id}`)
      docs.set(data.roster.id, structuredClone(data))
      stamps.set(data.roster.id, `t${++clock}`)
      return { updatedAt: stamps.get(data.roster.id)! }
    },
    async remove(id) { guard(`remove ${id}`); docs.delete(id); stamps.delete(id) },
  }
  return { api, docs, calls, state, touch: (id: string, d: LocalRoster) => { docs.set(id, d); stamps.set(id, `t${++clock}`) } }
}

function memoryCache(initial: LocalRoster[] = []): Cache & { ids(): string[] } {
  const m = new Map(initial.map(d => [d.roster.id, d]))
  return {
    async list() { return [...m.values()] },
    async put(d) { m.set(d.roster.id, structuredClone(d)) },
    async remove(id) { m.delete(id) },
    ids: () => [...m.keys()].sort(),
  }
}

function memoryMeta(migrated = true): SyncMeta {
  let v: Record<string, string> = {}
  let done = migrated
  return { versions: () => v, setVersions: x => { v = { ...x } }, migrated: () => done, setMigrated: () => { done = true } }
}

describe('근무표 저장소 (서버가 원본)', () => {
  test('로그인한 적 없고 사본도 없으면 서버에 묻지 않는다', async () => {
    const srv = fakeServer()
    const store = createStore({ api: srv.api, cache: memoryCache(), meta: memoryMeta(false), hasIdentity: async () => false })
    assert.deepEqual(await store.sync(), { items: [], online: true })
    assert.deepEqual(srv.calls, [])
  })

  test('이전 버전에서 기기에만 있던 근무표는 처음 한 번 서버로 올린다', async () => {
    const srv = fakeServer()
    const cache = memoryCache([roster('r10', 10), roster('r11', 11)])
    const meta = memoryMeta(false)
    const store = createStore({ api: srv.api, cache, meta, hasIdentity: async () => false })
    const first = await store.sync()
    assert.equal(first.online, true)
    assert.deepEqual([...srv.docs.keys()].sort(), ['r10', 'r11'])
    assert.deepEqual(srv.calls, ['put r10', 'put r11', 'list'], '올린 직후에는 다시 받지 않는다')
    srv.calls.length = 0
    await store.sync()
    assert.deepEqual(srv.calls, ['list'], '두 번째부터는 목록만 확인')
  })

  test('바뀐 근무표만 받고, 서버에서 없어진 근무표는 사본에서도 지운다', async () => {
    const srv = fakeServer([roster('r10', 10), roster('r11', 11)])
    const cache = memoryCache()
    const store = createStore({ api: srv.api, cache, meta: memoryMeta(), hasIdentity: async () => true })
    await store.sync()
    assert.deepEqual(cache.ids(), ['r10', 'r11'])
    srv.calls.length = 0
    srv.touch('r11', roster('r11', 11, '라마바'))
    srv.docs.delete('r10')
    const next = await store.sync()
    assert.deepEqual(srv.calls, ['list', 'get r11'])
    assert.deepEqual(cache.ids(), ['r11'])
    assert.equal(next.items[0].roster.nurses[0].name, '라마바')
  })

  test('서버에 닿지 못하면 사본을 보여 주고, 연결되면 다시 맞춘다', async () => {
    const srv = fakeServer([roster('r10', 10)])
    const cache = memoryCache([roster('r10', 10)])
    const store = createStore({ api: srv.api, cache, meta: memoryMeta(), hasIdentity: async () => true })
    srv.state.down = true
    const off = await store.sync()
    assert.equal(off.online, false)
    assert.equal(off.items.length, 1)
    srv.state.down = false
    assert.equal((await store.sync()).online, true)
  })

  test('쓰기는 서버가 성공해야 사본에 반영된다', async () => {
    const srv = fakeServer()
    const cache = memoryCache()
    const store = createStore({ api: srv.api, cache, meta: memoryMeta(), hasIdentity: async () => true })
    await store.save(roster('r10', 10))
    assert.deepEqual(cache.ids(), ['r10'])
    srv.state.down = true
    await assert.rejects(store.save(roster('r11', 11)))
    await assert.rejects(store.remove('r10'))
    assert.deepEqual(cache.ids(), ['r10'], '실패한 쓰기는 사본을 바꾸지 않는다')
    srv.state.down = false
    await store.remove('r10')
    assert.deepEqual(cache.ids(), [])
    srv.calls.length = 0
    await store.save(roster('r12', 12))
    await store.sync()
    assert.deepEqual(srv.calls, ['put r12', 'list'], '방금 쓴 근무표는 다시 받지 않는다')
  })

  test('패스키로 다른 계정에 들어가면, 그 계정에 없는 달만 옮기고 그 계정 기준으로 맞춘다', async () => {
    const other = fakeServer([roster('r10', 10, '사아자'), roster('r12', 12)])
    const cache = memoryCache([roster('r10', 10), roster('r11', 11)])
    const meta = memoryMeta()
    meta.setVersions({ r10: 'old', r11: 'old' })
    const store = createStore({ api: other.api, cache, meta, hasIdentity: async () => true })
    const result = await store.adopt(await cache.list())
    assert.equal(result.moved, 1)
    assert.deepEqual([...other.docs.keys()].sort(), ['r10', 'r11', 'r12'])
    assert.equal(other.docs.get('r10')!.roster.nurses[0].name, '사아자', '같은 달은 그 계정 것을 남긴다')
    assert.deepEqual(cache.ids(), ['r10', 'r11', 'r12'])
    assert.equal(result.items.find(i => i.roster.id === 'r10')!.roster.nurses[0].name, '사아자')
  })

  test('upsert 는 같은 근무표를 바꾸고 최근 달 순으로 정렬한다', () => {
    const items = upsert(upsert([roster('r10', 10)], roster('r12', 12)), roster('r10', 10, '사아자'))
    assert.deepEqual(items.map(i => [i.roster.id, i.roster.nurses[0].name]), [['r12', '가나다'], ['r10', '사아자']])
  })
})
