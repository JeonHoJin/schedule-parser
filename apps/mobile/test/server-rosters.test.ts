import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createBackup } from '../src/server/rosters'
import type { LocalRoster } from '../src/data'

const roster = (id: string): LocalRoster => ({
  roster: { id, year: 2026, month: 9, ward: '', nurses: [], cells: [] },
  settings: { reviewThreshold: 0.8 },
  review: { empnos: [], cells: [] },
})

describe('근무표 서버 백업', () => {
  test('저장은 PUT 으로 문서 전체를, 삭제는 id 로 보낸다', async () => {
    const calls: Array<{ name: string; method?: string; body?: unknown; query?: Record<string, string> }> = []
    const b = createBackup(async (name, init) => {
      calls.push({ name, method: init?.method, body: init?.body && JSON.parse(String(init.body)), query: init?.query })
      return new Response(null, { status: name === 'roster-delete' ? 404 : 201 })
    })
    await b.save(roster('a'))
    await b.remove('a')
    assert.equal(calls[0].name, 'roster-save')
    assert.equal(calls[0].method, 'PUT')
    assert.deepEqual(calls[0].body, { version: 1, ...roster('a') })
    assert.deepEqual(calls[1], { name: 'roster-delete', method: 'DELETE', body: undefined, query: { id: 'a' } })
  })

  test('같은 근무표 요청은 순서를 지키고, 실패해도 다음 요청은 나간다', async () => {
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const b = createBackup(async name => {
      if (name === 'roster-save') { await gate; order.push('save'); return new Response(null, { status: 503 }) }
      order.push('delete')
      return new Response(null, { status: 204 })
    })
    const warn = console.warn
    console.warn = () => {}
    try {
      const saved = b.save(roster('a'))
      const removed = b.remove('a')
      release()
      await Promise.all([saved, removed])
    } finally { console.warn = warn }
    assert.deepEqual(order, ['save', 'delete'])
  })
})
