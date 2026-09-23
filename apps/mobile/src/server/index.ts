/**
 * 앱 전체가 쓰는 서버 연결 하나. 기기 키는 IndexedDB 에 CryptoKey 객체 그대로 저장한다
 * (내보낼 수 없는 키도 구조화 복제로 저장된다).
 */
import { ServerClient, type KeyStore } from './client'

export const API_BASE = 'https://168-107-32-199.sslip.io'

const LINKED_FLAG = 'schedule-parser:server-linked'

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(`schedule-parser-keys:${new URL('.', location.href).pathname}`, 1)
    req.onupgradeneeded = () => req.result.createObjectStore('device')
    req.onerror = () => reject(new Error('기기 키 저장소를 열지 못했습니다.'))
    req.onsuccess = () => resolve(req.result)
  })
}

function keyRequest<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openKeyDb().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction('device', mode)
    const req = run(tx.objectStore('device'))
    tx.oncomplete = () => { db.close(); resolve(req.result) }
    tx.onerror = tx.onabort = () => { db.close(); reject(new Error('기기 키를 저장하지 못했습니다.')) }
  }))
}

export const indexedDbKeyStore: KeyStore = {
  get: () => keyRequest('readonly', s => s.get('default') as IDBRequest<CryptoKeyPair | undefined>),
  put: keys => keyRequest('readwrite', s => s.put(keys, 'default')).then(() => undefined),
}

export const server = new ServerClient({ base: API_BASE, store: indexedDbKeyStore })

/** 사용자가 한 번이라도 직접 연결한 기기만 다음부터 자동으로 연결한다. */
export const serverLink = {
  isLinked(): boolean {
    try { return localStorage.getItem(LINKED_FLAG) === '1' } catch { return false }
  },
  remember(): void {
    try { localStorage.setItem(LINKED_FLAG, '1') } catch { /* private mode 등 */ }
  },
}

export { ServerError } from './client'
