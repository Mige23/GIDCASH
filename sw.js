/* ============================================================
   VentasPRO — Service Worker con Kill-Switch remoto
   ============================================================
   CÓMO DESACTIVAR LA APP EN TODOS LOS DISPOSITIVOS:
   ─────────────────────────────────────────────────
   Opción A (recomendada): Editá kill-switch.json en el repo
     → cambiá "active": true  por  "active": false
     → todos los dispositivos quedarán bloqueados al reconectarse

   Opción B (desactivación total):
     → Eliminá el repo o desplegá una página vacía
     → Sin kill-switch.json (404), el SW se auto-destruye

   Opción C (mensaje personalizado):
     → "active": false + texto en "message"
     → Los usuarios ven ese mensaje en pantalla
   ============================================================ */

const CACHE_NAME  = 'ventaspro-v3';
const KILL_SWITCH = './kill-switch.json';
const ASSETS = ['./', './ventaspro_stock.html', './manifest.json'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => clients.claim())
  );
});

async function autoDestruir(mensaje) {
  const keys = await caches.keys();
  await Promise.all(keys.map(k => caches.delete(k)));
  const allClients = await clients.matchAll({ includeUncontrolled: true });
  allClients.forEach(client => client.postMessage({
    type: 'APP_DESACTIVADA',
    mensaje: mensaje || 'Esta aplicación ya no está disponible.'
  }));
  await self.registration.unregister();
}

async function verificarKillSwitch() {
  try {
    const res = await fetch(KILL_SWITCH, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) {
      await autoDestruir('El servidor no responde. La aplicación fue desactivada.');
      return false;
    }
    const data = await res.json();
    if (data.active === false) {
      await autoDestruir(data.message || 'Esta aplicación fue desactivada por el administrador.');
      return false;
    }
    return true;
  } catch {
    return true; // Sin red → permitir offline, no destruir
  }
}

const INTERVALO_VERIF = 5 * 60 * 1000; // 5 minutos

self.addEventListener('fetch', e => {
  if (new URL(e.request.url).pathname.endsWith('kill-switch.json')) {
    e.respondWith(fetch(e.request, { cache: 'no-store' }));
    return;
  }

  e.respondWith((async () => {
    const ahora = Date.now();
    const c = await caches.open(CACHE_NAME);
    const tsRes = await c.match('__last_check__').catch(() => null);
    const ultimaVerif = tsRes ? parseInt(await tsRes.text()) : 0;

    if (ahora - ultimaVerif > INTERVALO_VERIF) {
      await c.put('__last_check__', new Response(String(ahora)));
      verificarKillSwitch(); // sin await — no bloquea la UX
    }

    const cached = await caches.match(e.request);
    if (cached) return cached;

    try {
      const res = await fetch(e.request);
      if (res.ok) { const clone = res.clone(); c.put(e.request, clone); }
      return res;
    } catch {
      return cached || new Response('Sin conexión', { status: 503 });
    }
  })());
});

self.addEventListener('message', e => {
  if (e.data?.type === 'VERIFICAR_AHORA') verificarKillSwitch();
});
