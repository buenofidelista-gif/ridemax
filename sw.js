/* RideMax — service worker: deixa o app abrir sem internet.
   Página: rede primeiro (pega a versão nova quando há internet), cópia guardada se offline.
   Ícones/manifesto: cópia guardada primeiro.
   Nada de outros sites (ex.: clima) passa por aqui, e os DADOS não ficam neste cache
   (eles ficam no IndexedDB do app). Ao publicar uma versão nova, aumente VERSAO. */
var VERSAO = "ridemax-v7"; // v7: endereço dos ícones com ?v=2 (Chrome 144+ só troca o ícone do app instalado se o endereço mudar) — 27/11/2026
var ARQUIVOS = ["./ridemax.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png", "./apple-touch-icon.png", "./atalho-corrida.png", "./atalho-turno.png", "./atalho-rapida.png", "./atalho-despesa.png"];

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
      /* página: sempre pergunta ao servidor (ignora a espera de 10 min do cache do navegador) */
      fetch(new Request(url.href, { cache: "no-cache", credentials: "same-origin" })).then(function (resp) {
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

/* ---------- LEMBRETES ----------
   O app grava a lista de avisos em IndexedDB ("ridemax" › "kv" › ridemax_web_v1_lembretes).
   Quando o Chrome acorda este service worker (periodicsync, só Android com o app instalado),
   mostra numa notificação só os avisos do dia que ainda não foram mostrados. */
var LEMB_KEY = "ridemax_web_v1_lembretes", LEMB_VISTOS = "ridemax_sw_notificados";
function idbAbrir() {
  return new Promise(function (ok, erro) {
    var r = indexedDB.open("ridemax", 1);
    r.onupgradeneeded = function () { try { r.result.createObjectStore("kv"); } catch (e) {} };
    r.onsuccess = function () { ok(r.result); };
    r.onerror = function () { erro(r.error); };
  });
}
function idbLer(db, k) { return new Promise(function (ok, erro) { var q = db.transaction("kv", "readonly").objectStore("kv").get(k); q.onsuccess = function () { ok(q.result); }; q.onerror = function () { erro(q.error); }; }); }
function idbGravar(db, k, v) { return new Promise(function (ok, erro) { var tx = db.transaction("kv", "readwrite"); tx.objectStore("kv").put(v, k); tx.oncomplete = function () { ok(); }; tx.onerror = tx.onabort = function () { erro(tx.error); }; }); }
function hojeISO() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function lembretesVerificar() {
  return idbAbrir().then(function (db) {
    return Promise.all([idbLer(db, LEMB_KEY), idbLer(db, LEMB_VISTOS)]).then(function (r) {
      var lista = null, vistos = {};
      try { lista = JSON.parse(r[0] || "null"); } catch (e) { lista = null; }
      try { vistos = JSON.parse(r[1] || "{}") || {}; } catch (e) { vistos = {}; }
      if (!lista || !lista.on || !Array.isArray(lista.itens)) { db.close(); return; }
      var hoje = hojeISO();
      var novos = lista.itens.filter(function (i) { return i && i.id && i.quando <= hoje && hoje <= i.ate && !vistos[i.id]; });
      if (!novos.length) { db.close(); return; }
      var titulo = novos.length === 1 ? novos[0].titulo : ("RideMax: " + novos.length + " lembretes");
      var corpo = novos.length === 1 ? novos[0].texto : novos.slice(0, 5).map(function (i) { return "• " + i.titulo + " — " + i.texto; }).join("\n");
      novos.forEach(function (i) { vistos[i.id] = hoje; });
      var corte = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
      Object.keys(vistos).forEach(function (k) { if (vistos[k] < corte) delete vistos[k]; });
      return self.registration.showNotification(titulo, { body: corpo, icon: "icon-192.png", badge: "icon-192.png", tag: "ridemax-lembretes", renotify: true, data: { url: "./ridemax.html" } })
        .then(function () { return idbGravar(db, LEMB_VISTOS, JSON.stringify(vistos)); })
        .then(function () { db.close(); });
    });
  }).catch(function () {});
}
self.addEventListener("periodicsync", function (ev) { if (ev.tag === "ridemax-lembretes") ev.waitUntil(lembretesVerificar()); });
self.addEventListener("message", function (ev) { if (ev.data && ev.data.tipo === "lembretes-verificar") ev.waitUntil(lembretesVerificar()); });
self.addEventListener("notificationclick", function (ev) {
  ev.notification.close();
  ev.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (cs) {
    for (var i = 0; i < cs.length; i++) { if ("focus" in cs[i]) return cs[i].focus(); }
    return self.clients.openWindow((ev.notification.data && ev.notification.data.url) || "./ridemax.html");
  }));
});
