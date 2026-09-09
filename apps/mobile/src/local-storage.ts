import type { LocalRoster } from './data'
import { daysInMonth, isoDate, type ShiftKind } from '@sp/domain'

const invalid = () => new Error('올바른 근무표 JSON 파일이 아닙니다.')
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw invalid()
  return v as Record<string, unknown>
}
const str = (v: unknown, max = 200): string => {
  if (typeof v !== 'string' || v.length > max) throw invalid()
  return v
}
const num = (v: unknown, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw invalid()
  return v
}
const integer = (v: unknown, min: number, max: number): number => {
  const n = num(v, min, max)
  if (!Number.isInteger(n)) throw invalid()
  return n
}
const array = (v: unknown, max: number): unknown[] => {
  if (!Array.isArray(v) || v.length > max) throw invalid()
  return v
}

// Build a fresh object: unknown fields and source-image URLs never enter app state.
export function parseBackup(value: unknown): LocalRoster {
  const doc = object(value)
  if (doc.version !== undefined && doc.version !== 1) throw invalid()
  const r = object(doc.roster)
  const year = integer(r.year, 2000, 2200)
  const month = integer(r.month, 1, 12)
  const days = daysInMonth(year, month)
  const nurses = array(r.nurses, 500).map(v => {
    const n = object(v)
    const id = str(n.id)
    if (!id) throw invalid()
    return { id, empNo: str(n.empNo), name: n.name === undefined ? '' : str(n.name), order: integer(n.order, 0, 10000) }
  })
  const ids = new Set(nurses.map(n => n.id))
  if (!nurses.length || ids.size !== nurses.length) throw invalid()
  const keys = new Set<string>()
  const kinds = new Set(['D', 'E', 'N', 'OFF', 'OTHER', 'EMPTY'])
  const cells = array(r.cells, nurses.length * days).map(v => {
    const c = object(v)
    const nurseId = str(c.nurseId)
    const date = str(c.date)
    const day = Number(date.slice(-2))
    if (!ids.has(nurseId) || !Number.isInteger(day) || day < 1 || day > days || date !== isoDate(year, month, day)) throw invalid()
    const key = JSON.stringify([nurseId, date])
    if (keys.has(key) || !kinds.has(String(c.kind)) || typeof c.edited !== 'boolean') throw invalid()
    keys.add(key)
    return {
      nurseId, date, raw: str(c.raw), kind: c.kind as ShiftKind,
      flags: array(c.flags, 20).map(v => str(v)), confidence: num(c.confidence, 0, 1), edited: c.edited,
    }
  })
  if (cells.length !== nurses.length * days) throw invalid()
  const s = doc.settings === undefined ? {} : object(doc.settings)
  const myNurseId = s.myNurseId === undefined ? undefined : str(s.myNurseId)
  if (myNurseId !== undefined && !ids.has(myNurseId)) throw invalid()
  const review = doc.review === undefined ? { empnos: [], cells: [] } : object(doc.review)
  const id = str(r.id)
  if (!id) throw invalid()
  return {
    roster: { id, year, month, ward: r.ward === undefined ? '' : str(r.ward), nurses, cells },
    settings: { myNurseId, reviewThreshold: s.reviewThreshold === undefined ? 0.8 : num(s.reviewThreshold, 0, 1) },
    review: {
      empnos: array(review.empnos, 500).map(v => {
        const e = object(v)
        return { row: integer(e.row, 0, 10000), read: e.read === null ? null : str(e.read) }
      }),
      cells: array(review.cells, 15500).map(v => {
        const c = object(v)
        return { row: integer(c.row, 0, 10000), day: integer(c.day, 1, days), raw: str(c.raw), score: num(c.score, -1, 1) }
      }),
    },
  }
}

async function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') throw new Error('이 브라우저에서는 기기 저장소를 사용할 수 없습니다.')
  return new Promise((resolve, reject) => {
    // Include the app path because project Pages sites share an origin.
    const request = indexedDB.open(`schedule-parser:${new URL('.', location.href).pathname}`, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('rosters', { keyPath: 'roster.id' })
    request.onerror = () => reject(new Error('기기 저장소를 열지 못했습니다. 브라우저 설정을 확인해 주세요.'))
    request.onblocked = () => reject(new Error('다른 앱 창을 닫고 다시 시도해 주세요.'))
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
  })
}

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('rosters', mode)
      const request = action(tx.objectStore('rosters'))
      tx.oncomplete = () => resolve(request.result)
      tx.onabort = () => reject(new Error('저장하지 못했습니다. 저장 공간과 브라우저 설정을 확인해 주세요.'))
      tx.onerror = () => reject(new Error('기기 저장소에 접근하지 못했습니다.'))
    })
  } finally { db.close() }
}

export async function listRosters(): Promise<LocalRoster[]> {
  const data = await transaction('readonly', s => s.getAll())
  return data.map(parseBackup).sort((a, b) => b.roster.year - a.roster.year || b.roster.month - a.roster.month)
}

export async function saveRoster(data: LocalRoster): Promise<void> {
  await transaction('readwrite', s => s.put(parseBackup(data)))
}

export async function removeRoster(id: string): Promise<void> {
  await transaction('readwrite', s => s.delete(id))
}
