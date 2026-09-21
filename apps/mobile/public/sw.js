/**
 * schedule-parser Service Worker
 *
 * 목표:
 *   1. 새 배포 시 다음 방문에서 새 HTML 을 반드시 받도록 (network-first HTML)
 *   2. 컨텐츠 해시가 붙은 JS/CSS/JSON 은 캐시-우선 (오프라인 및 즉시 로드)
 *   3. 오프라인에서도 마지막으로 캐시된 앱이 뜨도록
 *
 * VERSION 을 바꾸면 이전 캐시가 삭제되고 자동으로 새 SW 가 활성화된다.
 */
const VERSION = 'v1'
const RUNTIME = `sp-runtime-${VERSION}`

self.addEventListener('install', event => {
  // 새 SW 를 즉시 대기 상태에서 벗어나게 한다
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter(n => n !== RUNTIME).map(n => caches.delete(n)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  const isHtml = request.mode === 'navigate' ||
    request.headers.get('accept')?.includes('text/html') ||
    url.pathname.endsWith('.html')

  if (isHtml) {
    event.respondWith(networkFirst(request))
  } else {
    event.respondWith(cacheFirst(request))
  }
})

async function networkFirst(request) {
  try {
    const res = await fetch(request)
    if (res.ok) {
      const cache = await caches.open(RUNTIME)
      cache.put(request, res.clone())
    }
    return res
  } catch {
    const cached = await caches.match(request)
    if (cached) return cached
    throw new Error('오프라인 · 캐시된 페이지 없음')
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const res = await fetch(request)
  if (res.ok && res.type === 'basic') {
    const cache = await caches.open(RUNTIME)
    cache.put(request, res.clone())
  }
  return res
}
