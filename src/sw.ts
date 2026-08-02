/// <reference lib="webworker" />

const sw = self as unknown as ServiceWorkerGlobalScope

const CACHE_NAME = 'etri-kokkok-shell-v4'
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/badminton-icon.svg',
  '/apple-touch-icon.svg',
  '/etri-logo.png',
  '/fonts/GFCGunhamiTalks.woff2',
  '/fonts/Mona12.woff2',
  '/fonts/Mona12-Bold.woff2',
]

interface PushPayload {
  title?: string
  body?: string
  icon?: string
  badge?: string
  data?: {
    url?: string
  }
}

sw.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)),
  )
  sw.skipWaiting()
})

sw.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((cacheName) =>
            cacheName === CACHE_NAME
              ? Promise.resolve(true)
              : caches.delete(cacheName),
          ),
        ),
      )
      .then(() => sw.clients.claim()),
  )
})

sw.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as { type?: string; urls?: string[] } | undefined
  if (data?.type !== 'CACHE_URLS' || !Array.isArray(data.urls)) return

  const sameOriginUrls = data.urls.filter((url) => {
    try {
      return new URL(url, sw.location.origin).origin === sw.location.origin
    } catch {
      return false
    }
  })

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(sameOriginUrls.map((url) => cache.add(url))).then(
        () => undefined,
      ),
    ),
  )
})

sw.addEventListener('fetch', (event: FetchEvent) => {
  if (event.request.method !== 'GET') return
  const requestUrl = new URL(event.request.url)
  if (requestUrl.origin !== sw.location.origin) return

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone()
          event.waitUntil(
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(event.request, copy)),
          )
        }
        return response
      })
      .catch(async () => {
        const cached = await caches.match(event.request)
        if (cached) return cached
        if (event.request.mode === 'navigate') {
          const appShell = await caches.match('/')
          if (appShell) return appShell
        }
        return new Response('오프라인 상태입니다.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      }),
  )
})

sw.addEventListener('push', (event: PushEvent) => {
  let payload: PushPayload
  try {
    payload = event.data?.json() as PushPayload
  } catch {
    payload = { body: event.data?.text() }
  }

  event.waitUntil(
    sw.registration.showNotification(
      payload.title ?? 'ETRI 콕콕 레슨 알림',
      {
        body: payload.body ?? '레슨 순서와 예상 시각을 확인해 주세요.',
        icon: payload.icon ?? '/badminton-icon.svg',
        badge: payload.badge ?? '/badminton-icon.svg',
        data: payload.data ?? { url: '/lesson' },
        tag: 'lesson-reminder',
      },
    ),
  )
})

sw.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  const targetUrl = new URL(
    event.notification.data?.url ?? '/lesson',
    sw.location.origin,
  ).href

  event.waitUntil(
    sw.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (windowClients) => {
        for (const client of windowClients) {
          if ('focus' in client) {
            await client.navigate(targetUrl)
            return client.focus()
          }
        }
        return sw.clients.openWindow(targetUrl)
      }),
  )
})
