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
const CACHE_VERSION = 'v2';
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
  // לא משתמשים ב-cache.addAll(CORE_ASSETS): פונקציה הזו "כולה או כלום" —
  // אם קובץ אחד נכשל (404, שינוי שם, רשת רעה באמצע ה-install), כל ה-install
  // נכשל ואין מטמון בכלל, אפילו לקבצים שהצליחו. במקום זה שומרים קובץ-קובץ
  // כדי שכשל יחיד לא יהרוס את כל יכולת העבודה-אופליין.
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(
        CORE_ASSETS.map((asset) =>
          cache.add(asset).catch((err) => {
            console.warn('[service-worker] דילוג על קובץ שנכשל ב-cache:', asset, err);
          })
        )
      ))
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

// קבצי אייקון (favicon/apple-touch-icon/manifest icons): אומת ב-QA שהדפדפן
// "מרענן" אותם מעצמו בכל שינוי hash/pushState בעמוד (גם כשזה לא ניווט אמיתי,
// למשל קליק על פריט בתפריט) — תופעה בדפדפן שאין עליה שליטה מה-HTML. בלי
// טיפול מיוחד, ה-stale-while-revalidate למטה היה פותח בקשת-רשת חדשה לכל
// "ריענון" כזה, מה שצורך תעבורה סלולרית בלי שום תועלת בפועל (האייקון לא
// משתנה בין ביקורים). במקום זה, הם מוגשים ישירות מהמטמון בלי revalidation —
// הם מתעדכנים ממילא בכל עליית גרסת-מטמון (CACHE_VERSION, שמנקה הכל מחדש).
const isIconRequest = (url) => /\/assets\/icons\//.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // רק GET, ורק אותו מקור — שום מטמון/פרוקסי לבקשות חיצוניות.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isIconRequest(url)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
    return;
  }

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
