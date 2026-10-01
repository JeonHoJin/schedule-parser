// Refuse to run inside someone else's frame (GitHub Pages cannot send X-Frame-Options, and a
// framed copy could be used to trick taps on "삭제" or passkey prompts).
if (typeof window !== 'undefined' && window.top !== window.self) {
  document.documentElement.textContent = ''
  try { window.top!.location.href = window.location.href } catch { /* cross-origin top: stay blank */ }
  throw new Error('framed')
}

import { registerRootComponent } from 'expo'
import App from './App'
import { registerServiceWorker } from './src/register-sw'

registerRootComponent(App)
registerServiceWorker()
