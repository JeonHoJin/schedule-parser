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

export function registerServiceWorker() {
  if (typeof window === 'undefined') return
  ensureManifestLink()
  if (!('serviceWorker' in navigator)) return

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
