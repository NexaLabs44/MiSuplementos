/* ============================================================
   MiSuplementos — Service Worker  ·  v2
   Ámbito: /app/

   ⚠️ ESTRATEGIA: NETWORK-FIRST PARA EL HTML.
   Esto no es un detalle técnico, es la decisión crítica de todo
   el fichero. La app es un único index.html que se despliega varias
   veces por semana. Un service worker con la estrategia habitual
   (cache-first) serviría una versión antigua durante días sin que
   ni el usuario ni el desarrollador se enteren, y se perdería la
   capacidad de corregir un bug en dos minutos.

   Por eso:
     · El HTML se pide SIEMPRE a la red. La caché es solo el plan B
       cuando no hay conexión.
     · Los iconos y el manifiesto sí van cache-first: no cambian.
     · Las llamadas a Supabase NUNCA se cachean. Son datos de salud
       y deben venir siempre del servidor.

   ⚠️ VERSION hay que subirla en CADA cambio de este fichero.
   Si no cambia, el navegador conserva el service worker anterior
   y el código nuevo no llega a instalarse nunca.

   v2 — Notificaciones push (app v66)
   ============================================================ */

const VERSION     = 'v2';
const SHELL_CACHE = `misuplementos-shell-${VERSION}`;
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './offline.html',
];

/* ── Instalación: precargar el esqueleto ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(c => c.addAll(SHELL_FILES))
      // Si un archivo falla, no bloqueamos la instalación entera
      .catch(err => console.warn('[sw] precarga parcial:', err))
      .then(() => self.skipWaiting())
  );
});

/* ── Activación: borrar cachés de versiones anteriores ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('misuplementos-') && k !== SHELL_CACHE)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ── Intercepción de peticiones ── */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Nunca tocamos Supabase, Stripe ni la API de Anthropic:
  // son datos vivos y algunos son de salud.
  if (url.origin !== self.location.origin) return;

  // Fuera del ámbito /app/ no nos metemos (la landing va aparte)
  if (!url.pathname.startsWith('/app/')) return;

  const esDocumento = req.mode === 'navigate' ||
                      req.destination === 'document' ||
                      url.pathname.endsWith('.html') ||
                      url.pathname.endsWith('/');

  if (esDocumento) {
    // NETWORK-FIRST: siempre la versión más reciente si hay red.
    event.respondWith(
      fetch(req)
        .then(res => {
          const copia = res.clone();
          caches.open(SHELL_CACHE).then(c => c.put('./index.html', copia));
          return res;
        })
        .catch(async () => {
          const cacheado = await caches.match('./index.html');
          if (cacheado) return cacheado;
          const off = await caches.match('./offline.html');
          return off || new Response(
            '<h1>Sin conexión</h1><p>Vuelve a intentarlo cuando tengas red.</p>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        })
    );
    return;
  }

  // Iconos y manifiesto: cache-first, no cambian casi nunca
  // v2: si no está en caché Y falla la red, hay que devolver una
  // Response de verdad. Antes se devolvía el `hit` que ya sabíamos
  // vacío, y respondWith(undefined) rompe la petición entera.
  event.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) {
        const copia = res.clone();
        caches.open(SHELL_CACHE).then(c => c.put(req, copia));
      }
      return res;
    }).catch(() => new Response('', { status: 504, statusText: 'Sin conexión' })))
  );
});

/* ── Permite a la app forzar la actualización del SW ── */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});


/* ════════════════════════════════════════════════════════════
   v2 — RECORDATORIOS PUSH (app v66)

   El contenido viene cifrado desde la Edge Function send-push.
   Aquí solo se pinta: ninguna decisión de a quién o qué avisar
   se toma en el cliente.
   ════════════════════════════════════════════════════════════ */

self.addEventListener('push', event => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch (e) {
    // Si alguna vez llega un push sin JSON válido, mejor un aviso
    // genérico que ninguno: en Chrome, recibir un push y no mostrar
    // notificación cuenta como incumplimiento y acaba revocando
    // el permiso del sitio.
    d = { body: event.data ? event.data.text() : '' };
  }

  const title = d.title || 'MiSuplementos';
  event.waitUntil(
    self.registration.showNotification(title, {
      body:  d.body || 'Tienes tomas pendientes.',
      tag:   d.tag  || 'misuplementos',
      renotify: true,
      icon:  './icon-192.png',
      badge: './icon-192.png',
      data:  { url: d.url || '/app/' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/app/';
  event.waitUntil((async () => {
    // Si la app ya está abierta en alguna pestaña se enfoca esa,
    // en vez de abrir una copia nueva con otra sesión.
    const abiertas = await self.clients.matchAll({
      type: 'window', includeUncontrolled: true
    });
    for (const c of abiertas) {
      if (c.url.includes('/app/') && 'focus' in c) return c.focus();
    }
    return self.clients.openWindow(url);
  })());
});
