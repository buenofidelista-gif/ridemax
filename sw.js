/* RideMax — service worker: deixa o app abrir sem internet.
   Página: rede primeiro (pega a versão nova quando há internet), cópia guardada se offline.
   Ícones/manifesto: cópia guardada primeiro.
   Nada de outros sites (ex.: clima) passa por aqui, e os DADOS não ficam neste cache
   (eles ficam no IndexedDB do app). Ao publicar uma versão nova, aumente VERSAO. */
var VERSAO = "ridemax-v1";
var ARQUIVOS = ["./ridemax.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png", "./icons/apple-touch-icon.png"];

self.addEventListener("install", function (ev) {
  ev.waitUntil(caches.open(VERSAO).then(function (c) { return c.addAll(ARQUIVOS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (ev) {
  ev.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf("ridemax-") === 0 && k !== VERSAO; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (ev) {
  var req = ev.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var ehPagina = req.mode === "navigate" || /\/ridemax\.html$/.test(url.pathname);
  if (ehPagina) {
    ev.respondWith(
      fetch(req).then(function (resp) {
        if (resp && resp.ok) { var cp = resp.clone(); caches.open(VERSAO).then(function (c) { c.put("./ridemax.html", cp); }); }
        return resp;
      }).catch(function () {
        return caches.match("./ridemax.html").then(function (r) { return r || Response.error(); });
      })
    );
    return;
  }
  ev.respondWith(caches.match(req, { ignoreSearch: true }).then(function (r) {
    return r || fetch(req).then(function (resp) {
      if (resp && resp.ok) { var cp = resp.clone(); caches.open(VERSAO).then(function (c) { c.put(req, cp); }); }
      return resp;
    });
  }));
});
