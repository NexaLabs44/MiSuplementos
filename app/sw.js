/* ============================================================
   MiSuplementos — Service Worker  ·  v1
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
   ============================================================ */

const VERSION     = 'v1';
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
  event.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) {
        const copia = res.clone();
        caches.open(SHELL_CACHE).then(c => c.put(req, copia));
      }
      return res;
    }).catch(() => hit))
  );
});

/* ── Permite a la app forzar la actualización del SW ── */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
