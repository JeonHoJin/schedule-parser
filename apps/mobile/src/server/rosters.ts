/**
 * 서버의 근무표 CRUD(`roster-save/list/get/delete`). 근무표의 원본은 서버에 있다.
 */
import type { LocalRoster } from '../data'
import { parseBackup } from '../local-storage'
import { server, ServerError } from './index'

type Op = (name: string, init: Parameters<typeof server.op>[1]) => Promise<Response>

export interface RosterSummary {
  id: string
  year: number
  month: number
  ward: string
  nurses: number
  updatedAt: string
  sharedUntil?: string | null
}

async function ok(res: Response): Promise<Response> {
  if (!res.ok) throw new ServerError(res.status, `HTTP ${res.status}`)
  return res
}

export function createRosterApi(op: Op) {
  return {
    async list(): Promise<RosterSummary[]> {
      const res = await ok(await op('roster-list', { method: 'GET' }))
      return (await res.json() as { rosters: RosterSummary[] }).rosters
    },
    async get(id: string): Promise<LocalRoster> {
      const res = await ok(await op('roster-get', { method: 'GET', query: { id } }))
      return parseBackup(await res.json())
    },
    /** 근무표 전체를 서버에 쓴다(있으면 통째로 바꾼다). */
    async put(data: LocalRoster): Promise<{ updatedAt: string }> {
      const res = await ok(await op('roster-save', {
        method: 'PUT',
        body: JSON.stringify({ version: 1, ...data }),
        headers: { 'content-type': 'application/json' },
      }))
      return await res.json() as { updatedAt: string }
    },
    async remove(id: string): Promise<void> {
      const res = await op('roster-delete', { method: 'DELETE', query: { id } })
      if (!res.ok && res.status !== 404) throw new ServerError(res.status, `HTTP ${res.status}`)
    },
  }
}

export type RosterApi = ReturnType<typeof createRosterApi>

export const rosterApi = createRosterApi((name, init) => server.op(name, init))
