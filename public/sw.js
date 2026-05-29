const CACHE_NAME = 'conlicit-hub-v1';
const CACHE_STATIC = [
  '/',
  '/assets/fonts/ADINEUE_PRO.TTF',
  '/assets/fonts/ADINEUE_PRO_BOLD.TTF',
  '/assets/images/logo-branco.png',
  '/assets/images/simbolo-branco.png',
  '/assets/images/simbolo-cyan.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CACHE_STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Ignora requests não-HTTP e chrome-extension
  if (!url.protocol.startsWith('http')) return;

  // Network-first para HTML e chamadas de API
  const isApi = url.pathname.startsWith('/auth') ||
    url.pathname.startsWith('/editais') ||
    url.pathname.startsWith('/clientes') ||
    url.pathname.startsWith('/boletim') ||
    url.pathname.startsWith('/calendario') ||
    url.pathname.startsWith('/edson') ||
    url.pathname.startsWith('/prospects') ||
    url.pathname.startsWith('/propostas') ||
    url.pathname.startsWith('/oportunidades') ||
    url.pathname.startsWith('/health');
  const isHtml = request.headers.get('accept')?.includes('text/html');

  // Nunca cachear métodos não-GET
  if (request.method !== 'GET') {
    e.respondWith(fetch(request));
    return;
  }

  if (isApi || isHtml) {
    e.respondWith(
      fetch(request)
        .then((res) => {
          if (isHtml && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first para assets estáticos
  e.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, clone));
        }
        return res;
      });
    })
  );
});

self.addEventListener('push', (e) => {
  if (!e.data) return;
  const data = e.data.json();
  e.waitUntil(
    self.registration.showNotification(data.title || 'Conlicit Hub', {
      body: data.body || '',
      icon: '/assets/images/simbolo-branco.png',
      badge: '/assets/images/simbolo-branco.png',
      data: data.url || '/',
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then((list) => {
      const url = e.notification.data || '/';
      const existing = list.find((c) => c.url === url && 'focus' in c);
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});
