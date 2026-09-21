/**
 * Service Worker 등록 및 manifest 링크 삽입.
 *
 * Expo 웹은 HTML 템플릿 커스터마이징이 번거로우므로 런타임에 <link> 를 붙인다.
 * 파일 위치는 `apps/mobile/public/` 에 두어 expo export 가 dist 루트로 그대로 복사한다.
 *
 * SW 는 origin 의 서브패스(예: /schedule-parser/)에 등록되어 그 scope 안에서만 동작한다.
 * new URL('sw.js', location.href) 는 index.html 옆의 sw.js 를 가리키므로
 * GitHub Pages 서브패스 배포와 로컬 dev 서버 모두에서 자동으로 맞는 경로가 된다.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1'])

export function registerServiceWorker() {
  if (typeof window === 'undefined') return
  ensureManifestLink()
  if (!('serviceWorker' in navigator)) return

  // 로컬 dev 에서는 SW 를 등록하지 않고, 예전에 등록된 것도 지운다.
  // SW 가 살아 있으면 Metro 가 새로 빌드해도 오래된 번들이 계속 로드된다.
  if (LOCAL_HOSTS.has(location.hostname)) {
    navigator.serviceWorker.getRegistrations().then(async regs => {
      for (const r of regs) await r.unregister()
      const cs = 'caches' in window ? await caches.keys() : []
      await Promise.all(cs.map(k => caches.delete(k)))
    }).catch(() => {})
    return
  }

  const swUrl = new URL('sw.js', location.href).toString()
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(swUrl).catch(err => {
      console.warn('Service Worker 등록 실패:', err)
    })
  })

  // 새 SW 가 활성화되면 페이지를 한 번만 갱신해서 새 번들을 로드한다
  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return
    reloaded = true
    location.reload()
  })
}

function ensureManifestLink() {
  if (document.querySelector('link[rel="manifest"]')) return
  const link = document.createElement('link')
  link.rel = 'manifest'
  link.href = new URL('manifest.webmanifest', location.href).toString()
  document.head.appendChild(link)

  if (!document.querySelector('link[rel="icon"]')) {
    const icon = document.createElement('link')
    icon.rel = 'icon'
    icon.type = 'image/svg+xml'
    icon.href = new URL('icon.svg', location.href).toString()
    document.head.appendChild(icon)
  }

  if (!document.querySelector('meta[name="theme-color"]')) {
    const meta = document.createElement('meta')
    meta.name = 'theme-color'
    meta.content = '#2C6BED'
    document.head.appendChild(meta)
  }
}
