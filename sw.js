// オフライン対応。アプリのファイルを端末に保存しておき、通信できなくても開けるようにする。
// ファイルを更新したら CACHE の番号を上げる（古いキャッシュは自動で消える）
const CACHE = 'nanishita-v23';
const FILES = [
  './',
  'index.html',
  'css/style.css',
  'js/db.js',
  'js/app.js',
  'manifest.webmanifest',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', e => {
  // cache: 'reload'：ブラウザの HTTP キャッシュに残った古いファイルを取り込まないようにする
  const requests = FILES.map(f => new Request(f, { cache: 'reload' }));
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(requests)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 保存済みのファイルをすぐ返し、裏で最新版を取りに行って保存し直す（次回起動時に反映）
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  e.respondWith(caches.open(CACHE).then(async cache => {
    // 画面遷移は常にアプリ本体（index.html）を返す
    const key = req.mode === 'navigate' ? './' : req;
    const cached = await cache.match(key, { ignoreSearch: true });
    const network = fetch(req)
      .then(res => {
        if (res.ok) cache.put(key, res.clone());
        return res;
      })
      .catch(() => cached);
    if (cached) {
      e.waitUntil(network);
      return cached;
    }
    return network;
  }));
});
