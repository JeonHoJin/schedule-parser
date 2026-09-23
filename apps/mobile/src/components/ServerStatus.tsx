import { useCallback, useEffect, useState } from 'react'
import { server, serverLink, ServerError } from '../server'

type State =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'connected'; userId: string }
  | { kind: 'failed'; message: string }

function describe(e: unknown): string {
  if (e instanceof ServerError) {
    if (e.status === 429) return '요청이 많아요. 잠시 후 다시 시도해 주세요.'
    return `서버 응답 ${e.status}`
  }
  return '서버에 닿지 못했어요. 네트워크를 확인해 주세요.'
}

/**
 * 서버 연결 상태. 처음에는 사용자가 직접 눌러야 연결한다 — 앱을 여는 것만으로 서버에
 * 기기가 등록되지 않게. 한 번 연결한 기기는 다음 실행부터 자동으로 연결한다.
 */
export function ServerStatus() {
  const [state, setState] = useState<State>({ kind: 'idle' })

  const connect = useCallback(async () => {
    setState({ kind: 'connecting' })
    try {
      const res = await server.op('whoami', { method: 'GET' })
      if (!res.ok) throw new ServerError(res.status, `HTTP ${res.status}`)
      const { user_id } = await res.json() as { user_id: string }
      serverLink.remember()
      setState({ kind: 'connected', userId: user_id })
    } catch (e) {
      setState({ kind: 'failed', message: describe(e) })
    }
  }, [])

  useEffect(() => {
    if (serverLink.isLinked()) void connect()
  }, [connect])

  return (
    <section className="server-status" aria-live="polite">
      {state.kind === 'idle' && (
        <button type="button" onClick={() => void connect()}>서버 연결</button>
      )}
      {state.kind === 'connecting' && <span>서버 연결 중…</span>}
      {state.kind === 'connected' && (
        <span className="server-ok">서버 연결됨 · 기기 {state.userId.slice(0, 8)}</span>
      )}
      {state.kind === 'failed' && (
        <>
          <span className="server-failed">{state.message}</span>
          <button type="button" onClick={() => void connect()}>다시 시도</button>
        </>
      )}
    </section>
  )
}
