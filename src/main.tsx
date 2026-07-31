import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AppProvider } from './context/AppProvider'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('/sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => {
        const resourceUrls = performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
        registration.active?.postMessage({
          type: 'CACHE_URLS',
          urls: [window.location.href, ...resourceUrls],
        })
      })
      .catch((error: unknown) => {
        console.error('서비스 워커를 등록하지 못했습니다.', error)
      })
  })
}
