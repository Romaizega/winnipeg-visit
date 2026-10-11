const CACHE = 'wpg-edit-v6';
const BASE = self.registration.scope;
const ASSETS = ['','index.html','app.js','manifest.json','icons/icon-192.png','icons/icon-512.png'].map(p => new URL(p, BASE).href);
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('wpg-') && k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', event => { if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return; event.respondWith(fetch(event.request).then(response => { if (response.ok && new URL(event.request.url).pathname.startsWith(new URL(BASE).pathname)) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); } return response; }).catch(() => caches.match(event.request).then(cached => cached || (event.request.mode === 'navigate' ? caches.match(new URL('index.html', BASE).href) : Response.error())))); });
