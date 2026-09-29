/**
 * 공유받은 근무표: 받은 링크(토큰)와 마지막으로 받은 사본을 이 기기에만 둔다. 로그인은 필요 없다.
 * 앱을 열 때마다 다시 받아서 보낸 사람의 수정이 반영되고, 공유가 끝난 링크는 "만료됨"으로 남는다.
 */
import type { LocalRoster } from './data'
import { carryMyNurse } from './roster-edit'
import { fetchShared, ShareGone } from './server/share'

export interface Received {
  token: string
  data: LocalRoster
  expiresAt: string
  fetchedAt: string
  /** 공유가 중지됐거나 만료됨: 마지막 사본만 남아 있다 */
  gone: boolean
}

export interface ReceivedBackend {
  list(): Promise<Received[]>
  put(r: Received): Promise<void>
  remove(token: string): Promise<void>
}

export const RECEIVED_PREFIX = 'received-'
/** 공유 링크 화면에서 목록에 넣은 뒤 앱이 처음 열 근무표 */
export const SELECT_KEY = 'schedule-parser:select'
export const isReceivedId = (id: string) => id.startsWith(RECEIVED_PREFIX)

export function createReceived(deps: {
  backend: ReceivedBackend
  fetch: (token: string) => Promise<{ data: LocalRoster; expiresAt: string }>
  now?: () => Date
}) {
  const now = () => (deps.now ?? (() => new Date()))().toISOString()

  /** 받은 근무표에 내 이름을 맞춘다: 전에 고른 사람이 아직 있으면 그대로, 없으면 내 근무표에서 이름으로 찾는다. */
  function withMe(data: LocalRoster, previous: string | undefined, own: LocalRoster[]): LocalRoster {
    const keep = previous && data.roster.nurses.some(n => n.id === previous) ? previous : undefined
    const myNurseId = keep ?? carryMyNurse(data.roster, own)
    return { ...data, settings: { ...data.settings, myNurseId } }
  }

  async function load(token: string, previous: Received | undefined, own: LocalRoster[]): Promise<Received> {
    const { data, expiresAt } = await deps.fetch(token)
    const id = `${RECEIVED_PREFIX}${token.slice(0, 12)}`
    const withId = { ...data, roster: { ...data.roster, id } }
    return { token, data: withMe(withId, previous?.data.settings.myNurseId, own), expiresAt, fetchedAt: now(), gone: false }
  }

  return {
    list: () => deps.backend.list(),

    /** 링크를 받아 목록에 넣는다. 이미 있는 링크면 새로 받기만 한다. */
    async add(token: string, own: LocalRoster[]): Promise<Received> {
      const existing = (await deps.backend.list()).find(r => r.token === token)
      const r = await load(token, existing, own)
      await deps.backend.put(r)
      return r
    },

    /** 모두 다시 받는다. 만료된 링크는 표시만 하고, 연결이 안 되면 사본을 그대로 둔다. */
    async refresh(own: LocalRoster[]): Promise<Received[]> {
      const out: Received[] = []
      for (const r of await deps.backend.list()) {
        try {
          const next = await load(r.token, r, own)
          await deps.backend.put(next)
          out.push(next)
        } catch (e) {
          if (e instanceof ShareGone && !r.gone) {
            const gone = { ...r, gone: true }
            await deps.backend.put(gone)
            out.push(gone)
          } else out.push(r)
        }
      }
      return out
    },

    async setMe(token: string, nurseId: string): Promise<Received | undefined> {
      const r = (await deps.backend.list()).find(x => x.token === token)
      if (!r || !r.data.roster.nurses.some(n => n.id === nurseId)) return undefined
      const next = { ...r, data: { ...r.data, settings: { ...r.data.settings, myNurseId: nurseId } } }
      await deps.backend.put(next)
      return next
    },

    remove: (token: string) => deps.backend.remove(token),
  }
}

/** 이 기기의 IndexedDB (내 근무표 사본과 따로 둔다: 그쪽은 서버와 맞추면서 지워지기 때문) */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(`schedule-parser-received:${new URL('.', location.href).pathname}`, 1)
    req.onupgradeneeded = () => req.result.createObjectStore('shares', { keyPath: 'token' })
    req.onerror = () => reject(new Error('기기 저장소를 열지 못했습니다.'))
    req.onsuccess = () => resolve(req.result)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction('shares', mode)
    const req = run(t.objectStore('shares'))
    t.oncomplete = () => { db.close(); resolve(req.result) }
    t.onerror = t.onabort = () => { db.close(); reject(new Error('기기 저장소에 저장하지 못했습니다.')) }
  }))
}

export const indexedDbReceived: ReceivedBackend = {
  list: () => tx('readonly', s => s.getAll() as IDBRequest<Received[]>),
  put: r => tx('readwrite', s => s.put(r)).then(() => undefined),
  remove: token => tx('readwrite', s => s.delete(token)).then(() => undefined),
}

export const received = createReceived({ backend: indexedDbReceived, fetch: token => fetchShared(token) })
