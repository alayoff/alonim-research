/**
 * Service Worker — מטמון "stale-while-revalidate" לעמוד הראשי ולתמונות.
 *
 * המטרה: אחרי ביקור ראשון מוצלח (כשיש רשת, ולו לרגע), העמוד ימשיך להיטען
 * מיידית גם ברשת סלולרית חלשה מאוד או בלי רשת בכלל — בדיוק המצב שדווח
 * מסטודנטים שפתחו את הקישור מהטלפון בלי Wi-Fi וחיבור סלולרי חלש/לא זמין.
 *
 * זהירות עקרונית: אסור לגעת בבקשות שאינן same-origin, כדי לשמור על
 * עקרון "אפס בקשות לדומיינים חיצוניים" של הפרויקט (ר' README).
 *
 * גרסת המטמון (CACHE_NAME) עולה בכל שינוי כאן — זה מנקה מטמונים ישנים
 * אוטומטית ב-activate, כך שאין צורך "לנקות קאש" ידנית אחרי כל עדכון.
 */
const CACHE_VERSION = 'v1';
const CACHE_NAME = `alonim-research-${CACHE_VERSION}`;

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/roadmap-challenge.webp',
  './assets/roadmap-victory.webp',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // רק GET, ורק אותו מקור — שום מטמון/פרוקסי לבקשות חיצוניות.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached); // אין רשת/הבקשה נכשלה: נופלים חזרה למטמון אם יש

      // יש גרסה במטמון: מציגים אותה מיידית (ומרעננים ברקע לפעם הבאה).
      // אין: ממתינים לרשת (ונכשלים בחן אם גם זה לא זמין).
      return cached || network;
    })
  );
});
