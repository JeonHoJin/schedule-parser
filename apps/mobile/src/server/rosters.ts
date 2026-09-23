/**
 * 기기에 저장한 근무표를 서버에도 백업한다. 기기 저장이 기준이고, 서버 백업은 뒤에서 조용히
 * 따라간다. 실패해도 기기 저장은 그대로이며 다음 저장 때 전체가 다시 올라간다.
 */
import type { LocalRoster } from '../data'
import { server, ServerError } from './index'

type Op = (name: string, init: Parameters<typeof server.op>[1]) => Promise<Response>

/** 같은 근무표에 대한 요청은 순서대로 보낸다 (저장 뒤 삭제가 뒤집히지 않도록). */
export function createBackup(op: Op) {
  const queues = new Map<string, Promise<void>>()

  function enqueue(id: string, task: () => Promise<void>): Promise<void> {
    const next = (queues.get(id) ?? Promise.resolve())
      .then(task)
      .catch(e => console.warn('roster backup failed', e))
    queues.set(id, next)
    void next.finally(() => { if (queues.get(id) === next) queues.delete(id) })
    return next
  }

  return {
    save(data: LocalRoster): Promise<void> {
      return enqueue(data.roster.id, async () => {
        const res = await op('roster-save', {
          method: 'PUT',
          body: JSON.stringify({ version: 1, ...data }),
          headers: { 'content-type': 'application/json' },
        })
        if (!res.ok) throw new ServerError(res.status, `HTTP ${res.status}`)
      })
    },
    remove(id: string): Promise<void> {
      return enqueue(id, async () => {
        const res = await op('roster-delete', { method: 'DELETE', query: { id } })
        if (!res.ok && res.status !== 404) throw new ServerError(res.status, `HTTP ${res.status}`)
      })
    },
  }
}

export const backup = createBackup((name, init) => server.op(name, init))
