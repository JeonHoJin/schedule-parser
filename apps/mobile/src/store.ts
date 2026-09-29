/**
 * 근무표 저장소. 원본은 서버이고, 기기에는 마지막으로 받은 사본만 둔다.
 *
 * - 읽기: 서버 목록과 비교해 바뀐 근무표만 받아 사본을 맞춘다. 서버에 닿지 못하면 사본을 보여 준다.
 * - 쓰기(추가·수정·삭제): 서버에 먼저 쓰고, 성공했을 때만 사본을 고친다.
 * - 이전 버전에서 기기에만 있던 근무표는 처음 한 번 서버로 올린다.
 */
import type { LocalRoster } from './data'
import { dropCache, parseBackup, readCache, sortRosters, writeCache } from './local-storage'
import { server } from './server'
import { rosterApi, type RosterApi } from './server/rosters'

export interface Cache {
  list(): Promise<LocalRoster[]>
  put(data: LocalRoster): Promise<void>
  remove(id: string): Promise<void>
}

/** 사본마다 서버의 updatedAt 을 적어 두어, 바뀐 것만 받는다. 기기에만 있던 근무표를 올렸는지도. */
export interface SyncMeta {
  versions(): Record<string, string>
  setVersions(v: Record<string, string>): void
  migrated(): boolean
  setMigrated(): void
}

export interface SyncResult {
  items: LocalRoster[]
  /** false 면 서버에 닿지 못해 사본을 보여 주는 중(읽기 전용) */
  online: boolean
}

export function createStore(deps: {
  api: RosterApi
  cache: Cache
  meta: SyncMeta
  /** 이 기기가 서버에 로그인한 적이 있는지. 없으면 새로 온 사람이라 서버에 묻지 않는다. */
  hasIdentity: () => Promise<boolean>
}) {
  const { api, cache, meta } = deps

  async function migrate(cached: LocalRoster[], versions: Record<string, string>) {
    if (meta.migrated()) return
    for (const data of cached) versions[data.roster.id] = (await api.put(data)).updatedAt
    meta.setVersions(versions)
    meta.setMigrated()
  }

  return {
    async sync(): Promise<SyncResult> {
      const cached = await cache.list()
      if (!cached.length && !(await deps.hasIdentity())) {
        meta.setMigrated()
        return { items: [], online: true }
      }
      try {
        const versions = { ...meta.versions() }
        await migrate(cached, versions)
        const remote = await api.list()
        const have = new Set(cached.map(c => c.roster.id))
        for (const r of remote) {
          if (have.has(r.id) && versions[r.id] === r.updatedAt) continue
          await cache.put(await api.get(r.id))
          versions[r.id] = r.updatedAt
        }
        const live = new Set(remote.map(r => r.id))
        for (const c of cached) {
          if (live.has(c.roster.id)) continue
          await cache.remove(c.roster.id)
          delete versions[c.roster.id]
        }
        meta.setVersions(versions)
        return { items: await cache.list(), online: true }
      } catch (e) {
        console.warn('roster sync failed', e)
        return { items: cached, online: false }
      }
    },

    /** 서버에 쓰고, 성공하면 사본도 고친다. 실패하면 아무것도 바뀌지 않는다. */
    async save(data: LocalRoster): Promise<LocalRoster> {
      const clean = parseBackup(data)
      const { updatedAt } = await api.put(clean)
      await cache.put(clean)
      meta.setVersions({ ...meta.versions(), [clean.roster.id]: updatedAt })
      return clean
    },

    async remove(id: string): Promise<void> {
      await api.remove(id)
      await cache.remove(id)
      const versions = { ...meta.versions() }
      delete versions[id]
      meta.setVersions(versions)
    },
  }
}

/** 한 목록 안에서 근무표 하나를 바꾸거나 넣고, 최근 달 순으로 정렬한다. */
export function upsert(items: LocalRoster[], data: LocalRoster): LocalRoster[] {
  return sortRosters([...items.filter(i => i.roster.id !== data.roster.id), data])
}

const VERSIONS = 'schedule-parser:synced'
const MIGRATED = 'schedule-parser:server-source'

/** localStorage 가 막힌 브라우저에서는 매번 전체를 다시 받고, 올리기도 다시 시도한다(서버 쓰기는 멱등). */
export const localMeta: SyncMeta = {
  versions() {
    try { return JSON.parse(localStorage.getItem(VERSIONS) ?? '{}') as Record<string, string> } catch { return {} }
  },
  setVersions(v) {
    try { localStorage.setItem(VERSIONS, JSON.stringify(v)) } catch { /* 다음에 다시 받는다 */ }
  },
  migrated() {
    try { return localStorage.getItem(MIGRATED) === '1' } catch { return false }
  },
  setMigrated() {
    try { localStorage.setItem(MIGRATED, '1') } catch { /* 다음에 다시 올린다 */ }
  },
}

export const store = createStore({
  api: rosterApi,
  cache: { list: readCache, put: writeCache, remove: dropCache },
  meta: localMeta,
  hasIdentity: () => server.hasIdentity(),
})
