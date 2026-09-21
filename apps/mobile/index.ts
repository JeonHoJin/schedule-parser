import { registerRootComponent } from 'expo'
import App from './App'
import { registerServiceWorker } from './src/register-sw'

registerRootComponent(App)
registerServiceWorker()
