/**
 * mlhops 서버 클라이언트: 기기 키 로그인 + op 호출.
 *
 * 기기 키(ECDSA P-256)는 기기 밖으로 나가지 않는다. 서버는 공개키만 알고, 1회용 챌린지에
 * 대한 서명으로 이 기기임을 확인한 뒤 짧게 쓰는 토큰을 준다. 토큰은 메모리에만 두고
 * 새로고침하면 기기 키로 다시 받는다 — 저장소에 토큰이 남지 않게 하려는 것.
 */

export interface KeyStore {
  get(): Promise<CryptoKeyPair | undefined>
  put(keys: CryptoKeyPair): Promise<void>
}

export class ServerError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'ServerError'
  }
}

interface Session {
  token: string
  userId: string
  refreshAt: number
}

export interface ClientOptions {
  base: string
  store: KeyStore
  fetch?: typeof fetch
  subtle?: SubtleCrypto
  now?: () => number
}

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const

export function base64url(bytes: ArrayBuffer): string {
  let s = ''
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export class ServerClient {
  private session?: Session
  private pending?: Promise<Session>
  private readonly fetch: typeof fetch
  private readonly subtle: SubtleCrypto
  private readonly now: () => number

  constructor(private readonly opts: ClientOptions) {
    this.fetch = opts.fetch ?? globalThis.fetch.bind(globalThis)
    this.subtle = opts.subtle ?? globalThis.crypto.subtle
    this.now = opts.now ?? Date.now
  }

  get userId(): string | undefined {
    return this.session?.userId
  }

  private async deviceKeys(): Promise<CryptoKeyPair> {
    const existing = await this.opts.store.get()
    if (existing) return existing
    // extractable=false: 개인키는 이 브라우저 밖으로 내보낼 수 없다
    const keys = await this.subtle.generateKey(ECDSA, false, ['sign', 'verify']) as CryptoKeyPair
    await this.opts.store.put(keys)
    return keys
  }

  private async postJson<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.fetch(this.opts.base + path, {
      method: 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({})) as T & { error?: string }
    if (!res.ok) throw new ServerError(res.status, data.error ?? `HTTP ${res.status}`)
    return data
  }

  private async signIn(): Promise<Session> {
    const keys = await this.deviceKeys()
    const { challenge } = await this.postJson<{ challenge: string }>('/auth/challenge')
    const message = new TextEncoder().encode(`mlhops-auth-v1:${challenge}`)
    const signature = await this.subtle.sign(SIGN, keys.privateKey, message)
    const jwk = await this.subtle.exportKey('jwk', keys.publicKey)
    const res = await this.postJson<{ access_token: string; expires_in: number; user_id: string }>(
      '/auth/token',
      {
        public_key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
        challenge,
        signature: base64url(signature),
      },
    )
    const margin = Math.min(60, res.expires_in / 2)
    this.session = {
      token: res.access_token,
      userId: res.user_id,
      refreshAt: this.now() + (res.expires_in - margin) * 1000,
    }
    return this.session
  }

  /** 동시에 여러 요청이 와도 로그인은 한 번만 한다. */
  async token(): Promise<string> {
    if (this.session && this.now() < this.session.refreshAt) return this.session.token
    this.pending ??= this.signIn().finally(() => { this.pending = undefined })
    return (await this.pending).token
  }

  /** `/op/{name}[/{version}]` 호출. 401 이면 한 번 다시 로그인해서 재시도한다. */
  async op(name: string, init: {
    method?: string; body?: BodyInit; version?: string; headers?: Record<string, string>; query?: Record<string, string>
  } = {}): Promise<Response> {
    const query = init.query ? `?${new URLSearchParams(init.query)}` : ''
    const path = `/op/${name}${init.version ? `/${init.version}` : ''}${query}`
    const call = async () => this.fetch(this.opts.base + path, {
      method: init.method ?? 'POST',
      body: init.body,
      headers: { ...init.headers, authorization: `Bearer ${await this.token()}` },
    })
    let res = await call()
    if (res.status === 401) {
      this.session = undefined
      res = await call()
    }
    return res
  }
}
