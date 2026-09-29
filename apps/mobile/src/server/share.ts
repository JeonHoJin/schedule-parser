/**
 * 읽기 전용 공유 링크. 링크는 `…/#share=<토큰>` 모양이라 토큰이 GitHub Pages 로 전송되지 않고,
 * 서버는 토큰의 해시만 가진다. 받는 쪽에는 이름과 근무만 가고 사번은 가지 않는다.
 */
import type { IsoDate, ShiftKind } from '@sp/domain'
import type { LocalRoster } from '../data'
import { parseBackup } from '../local-storage'
import { API_BASE, server, ServerError } from './index'

export interface ShareLink { token: string; expiresAt: string }

/** 서버가 돌려주는 공유 근무표 (사번 없음, 사람은 p1, p2 … 로 표시) */
export interface SharedView {
  version: 1
  expiresAt: string
  roster: {
    year: number
    month: number
    ward: string
    nurses: Array<{ id: string; name: string; order: number }>
    cells: Array<{ nurseId: string; date: IsoDate; raw: string; kind: ShiftKind; flags: string[]; edited: boolean }>
  }
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/

export function tokenFromHash(hash: string): string | null {
  const m = hash.match(/^#share=([^&]+)$/)
  return m && TOKEN.test(m[1]) ? m[1] : null
}

export function shareUrl(token: string, page: string = location.href): string {
  const base = new URL('.', page)
  return `${base.origin}${base.pathname}#share=${token}`
}

/** 공유 근무표를 앱의 근무표 모양으로. 이름이 비어 있는 줄은 순서로 부른다. */
export function toLocal(view: SharedView): LocalRoster {
  const r = view.roster
  return parseBackup({
    version: 1,
    roster: {
      id: `shared-${r.year}-${String(r.month).padStart(2, '0')}`,
      year: r.year, month: r.month, ward: r.ward,
      nurses: r.nurses.map((n, i) => ({ id: n.id, empNo: '', name: n.name.trim() || `${i + 1}번째 줄`, order: n.order })),
      cells: r.cells.map(c => ({ ...c, confidence: 1 })),
    },
  })
}

export class ShareGone extends Error {
  constructor() { super('링크가 만료되었거나 공유가 중지되었어요.') }
}

/** 로그인 없이 공유 근무표를 읽는다. 기기 키도 만들지 않는다. */
export async function fetchShared(token: string, fetcher: typeof fetch = fetch): Promise<{ data: LocalRoster; expiresAt: string }> {
  const res = await fetcher(`${API_BASE}/op/roster-shared?t=${encodeURIComponent(token)}`)
  if (res.status === 404) throw new ShareGone()
  if (!res.ok) throw new ServerError(res.status, `HTTP ${res.status}`)
  const view = await res.json() as SharedView
  return { data: toLocal(view), expiresAt: view.expiresAt }
}

async function ok(res: Response): Promise<Response> {
  if (!res.ok) throw new ServerError(res.status, `HTTP ${res.status}`)
  return res
}

/** 새 링크를 만든다(예전 링크는 막힌다). 근무표는 이미 서버에 있다. */
export async function createShare(data: LocalRoster): Promise<ShareLink> {
  const res = await ok(await server.op('roster-share', {
    method: 'POST',
    body: JSON.stringify({ id: data.roster.id }),
    headers: { 'content-type': 'application/json' },
  }))
  const link = await res.json() as ShareLink
  remember(data.roster.id, link)
  return link
}

export async function stopShare(id: string): Promise<void> {
  const res = await server.op('roster-unshare', { method: 'DELETE', query: { id } })
  if (!res.ok && res.status !== 404) throw new ServerError(res.status, `HTTP ${res.status}`)
  forget(id)
}

/** 지금 살아 있는 링크의 만료 시각. 서버에 없는 근무표면 null. */
export async function sharedUntil(id: string): Promise<string | null> {
  const res = await ok(await server.op('roster-list', { method: 'GET' }))
  const { rosters } = await res.json() as { rosters: Array<{ id: string; sharedUntil?: string | null }> }
  return rosters.find(r => r.id === id)?.sharedUntil ?? null
}

// 링크는 만들 때만 알 수 있으므로(서버는 해시만 가짐) 다시 복사할 수 있게 이 기기에 적어 둔다.
const key = (id: string) => `schedule-parser:share:${id}`

export function remembered(id: string): ShareLink | null {
  try {
    const v = JSON.parse(localStorage.getItem(key(id)) ?? 'null') as ShareLink | null
    return v && TOKEN.test(v.token) && typeof v.expiresAt === 'string' ? v : null
  } catch { return null }
}

function remember(id: string, link: ShareLink) {
  try { localStorage.setItem(key(id), JSON.stringify(link)) } catch { /* 저장 안 돼도 링크는 방금 보여 줬다 */ }
}

export function forget(id: string) {
  try { localStorage.removeItem(key(id)) } catch { /* 무시 */ }
}
