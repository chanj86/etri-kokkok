import { useSyncExternalStore } from 'react'

export type AppPath = '/' | '/lesson' | '/game' | '/records' | '/profile'

const validPaths = new Set<AppPath>([
  '/',
  '/lesson',
  '/game',
  '/records',
  '/profile',
])
const navigationEvent = 'kokkok:navigate'

export function currentPath(): AppPath {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  return validPaths.has(path as AppPath) ? (path as AppPath) : '/'
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('popstate', listener)
  window.addEventListener(navigationEvent, listener)
  return () => {
    window.removeEventListener('popstate', listener)
    window.removeEventListener(navigationEvent, listener)
  }
}

export function usePathname(): AppPath {
  return useSyncExternalStore(subscribe, currentPath, () => '/')
}

export function navigate(path: AppPath, replace = false): void {
  if (currentPath() === path) return
  if (replace) {
    window.history.replaceState(null, '', path)
  } else {
    window.history.pushState(null, '', path)
  }
  window.dispatchEvent(new Event(navigationEvent))
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
