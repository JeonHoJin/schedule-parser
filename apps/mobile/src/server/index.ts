/**
 * 앱 전체가 쓰는 서버 연결 하나. 기기 키는 IndexedDB 에 CryptoKey 객체 그대로 저장한다
 * (내보낼 수 없는 키도 구조화 복제로 저장된다).
 */
import { ServerClient, type KeyStore } from './client'

export const API_BASE = 'https://168-107-32-199.sslip.io'

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

/**
 * 근무표 사진을 추가하려는 순간 서버에 한 번 로그인해 둔다. 앱을 여는 것만으로는
 * 서버에 기기가 등록되지 않는다. 실패해도 사진 추가는 이 기기에서 그대로 진행된다.
 */
export function connectInBackground(): void {
  server.token().catch(e => console.warn('server sign-in failed', e))
}

export { ServerError } from './client'
