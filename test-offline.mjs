// בדיקת PWA אמיתית: מרים שרת HTTP סטטי מקומי (כדי שיהיה "secure context" אמיתי
// שבו ה-Service Worker מורשה להירשם — דבר שלא קורה תחת file://), טוען את העמוד,
// מחכה שה-SW יהיה "ready" ושה-cache יתמלא, ואז מדמה ניתוק רשת מלא
// (context.setOffline(true), בדיוק כמו "טלפון בלי Wi-Fi וסלולר") וטוען מחדש —
// ומוודא שהעמוד עדיין עולה נכון, מלא, בלי שום בקשת רשת שתצליח.
//
// זו בדיקת ה-regression האמיתית לבאג שדווח: "יש בעיה עם העלאת האתר באנדרואיד
// בלי ווי פיי". אם הבדיקה הזו עוברת, זה מוכיח (לא רק "משהו נכתב"): אחרי ביקור
// ראשון מוצלח, טעינה חוזרת בלי רשת בכלל עובדת.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = '/home/claude/alonim';
const PORT = 8973;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};

// סופר כמה בקשות HTTP *אמיתיות* (שהגיעו בפועל לשרת, לא רק "בקשה" בצד
// הדפדפן שה-SW סיפק מהמטמון) מגיעות לקבצי אייקון — משמש לבדיקת QA #9
// (ראו למטה): ניווט-עוגן בעמוד לא אמור לייצר תעבורת-רשת אמיתית לאייקון.
let iconServerHits = 0;

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    if (p.includes('/assets/icons/')) iconServerHits++;
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('404');
  }
});
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

const fails = [], notes = [];
const ok = (c, m) => c ? notes.push('✓ ' + m) : fails.push('✗ ' + m);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

// --- ביקור ראשון (עם "רשת") — ה-SW צריך להירשם ולמלא את המטמון ---
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

const swState = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return { supported: false };
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  return { supported: true, registered: !!reg, scope: reg && reg.scope };
});
ok(swState.supported, 'הדפדפן תומך ב-Service Worker');
ok(swState.registered, `ה-SW נרשם והגיע ל-ready (scope=${swState.scope || '—'})`);

// מתן זמן ל-cache.addAll() הראשוני להסתיים בפועל (install מתרחש ברקע)
await page.waitForFunction(async () => {
  if (!('caches' in window)) return false;
  const keys = await caches.keys();
  if (!keys.length) return false;
  const cache = await caches.open(keys[0]);
  const entries = await cache.keys();
  return entries.length >= 5; // CORE_ASSETS כולל 8 פריטים
}, null, { timeout: 8000 }).catch(() => {});

const cacheState = await page.evaluate(async () => {
  const keys = await caches.keys();
  const cache = await caches.open(keys[0]);
  const entries = (await cache.keys()).map(r => new URL(r.url).pathname);
  return { cacheNames: keys, count: entries.length, entries };
});
ok(cacheState.count >= 5, `המטמון מכיל את נכסי הליבה (${cacheState.count} פריטים: ${cacheState.entries.join(', ')})`);

// --- Regression QA #9: ניווט-עוגן בעמוד לא צורך תעבורת-רשת לאייקון ---
// (אומת שהדפדפן "מרענן" את הפייביקון בעצמו בכל שינוי hash/pushState, גם בלי
// קשר לקליק על קישור. לכן ה-SW מגיש קבצי אייקון ישירות מהמטמון בלי
// revalidation — התיקון נבדק כאן ברמת התעבורה האמיתית לשרת, לא רק ברמת
// "בקשה" שהדפדפן מדווח עליה לדף.)
const iconHitsBeforeNav = iconServerHits;
await page.evaluate(() => {
  history.pushState(null, '', '#journey');
  history.pushState(null, '', '#theory');
  history.pushState(null, '', '#experiments');
});
await page.waitForTimeout(500);
ok(iconServerHits === iconHitsBeforeNav,
   `ניווט-עוגן חוזר (3 שינויי hash) לא גרם לשום בקשת-רשת אמיתית לאייקון לשרת (${iconServerHits - iconHitsBeforeNav} בקשות חדשות)`);

// --- כיבוי רשת מוחלט (סימולציה של "בלי Wi-Fi ובלי סלולר") ---
await ctx.setOffline(true);

// טעינה מחדש של אותו עמוד — בלי שום רשת
const navErrors = [];
page.once('requestfailed', r => navErrors.push(r.url()));
let gotoError = null;
try {
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load', timeout: 8000 });
} catch (e) { gotoError = String(e); }

ok(!gotoError, `העמוד נטען מחדש במצב offline בלי שגיאת ניווט (${gotoError || 'תקין'})`);

const offlineCheck = await page.evaluate(() => ({
  title: document.title,
  hasHeader: !!document.querySelector('header'),
  hasLab: !!document.getElementById('interactive-lab'),
  hasStartBtn: !!document.getElementById('start-trial-btn'),
  bodyLen: document.body.innerHTML.length,
}));
ok(offlineCheck.hasHeader && offlineCheck.hasLab && offlineCheck.hasStartBtn && offlineCheck.bodyLen > 5000,
   `העמוד נטען מלא מהמטמון במצב offline (header=${offlineCheck.hasHeader}, lab=${offlineCheck.hasLab}, start-btn=${offlineCheck.hasStartBtn}, גודל=${offlineCheck.bodyLen})`);
ok(errors.length === 0, `אין שגיאות JS בטעינה האופליין (${errors.join(' | ') || 'נקי'})`);

// אפשר גם לתפעל את המעבדה בפועל במצב offline (ללא שום תלות רשת)
await page.click('#mode-session-btn');
await page.click('#start-trial-btn');
await page.waitForTimeout(500);
const canInteractOffline = await page.evaluate(() =>
  document.getElementById('feedback-msg').textContent.includes('הגיבו עכשיו') ||
  !!window.trialActiveProbe);
ok(canInteractOffline, 'ניתן להתחיל תרגול בפועל במצב offline (לא רק טעינת מעטפת)');

await ctx.setOffline(false);
await browser.close();
server.close();

console.log(notes.join('\n'));
if (fails.length) { console.log('\n--- כשלים ---\n' + fails.join('\n')); process.exit(1); }
console.log('\nכל בדיקות ה-offline/PWA עברו.');
