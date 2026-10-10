/**
 * בנייה: מקמפל Tailwind לפי הקלאסים שבשימוש ב-src/index.html בלבד,
 * ומטמיע את ה-CSS המינימלי ישירות בתוך index.html שבשורש (מוכן לפריסה).
 * הרצה:  npm run build
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

execFileSync('npx', ['tailwindcss', '-c', 'tailwind.config.js', '-i', 'src.css', '-o', '.tw.out.css', '--minify'], { stdio: 'inherit' });

const css = readFileSync('.tw.out.css', 'utf8').trim();
const tpl = readFileSync('src/index.html', 'utf8');
if (!tpl.includes('/*__TAILWIND_CSS__*/')) throw new Error('חסר הסמן /*__TAILWIND_CSS__*/ ב-src/index.html');
if (!tpl.includes('/*__QR_ENCODER__*/')) throw new Error('חסר הסמן /*__QR_ENCODER__*/ ב-src/index.html');

// מקודד ה-QR נשמר כמודול נפרד וקריא (qr.js) ומוזרק לעמוד בזמן בנייה —
// כך יש לו מקור אמת אחד, בלי עותק כפול שמתיישן.
const qr = readFileSync('qr.js', 'utf8')
  .replace(/^export /gm, '')
  .split('\n').map(l => l.trim() ? '    ' + l : l).join('\n');

const out = tpl
  .replace('/*__TAILWIND_CSS__*/', css)
  .replace('/*__QR_ENCODER__*/', qr);
writeFileSync('index.html', out);
rmSync('.tw.out.css', { force: true });

// בדיקת "אפס בקשות לדומיינים חיצוניים": הבדיקה הקודמת תפסה רק
// src="//..."/href="..." במרכאות כפולות. מרחיבים גם למרכאות בודדות,
// ל-CSS url(...), ול-fetch()/XMLHttpRequest.open() עם כתובת חיצונית —
// כדי שתלות חיצונית חדשה (בכל אחת מהצורות האלה) תיתפס כבר ב-build ולא
// רק תתגלה בפרודקשן.
// הדומיין שהאתר עצמו רץ עליו בפרודקשן (ר' siteUrl() ב-src/index.html).
// תגיות SEO כמו <link rel="canonical"> ו-og:url/og:image חייבות להצביע
// בכתובת מלאה ומוחלטת על העמוד/המשאב עצמו — זו לא "תלות חיצונית" אלא
// הפניה לעצמנו, ולכן היא מותרת ולא נחשבת הפרה של עקרון אפס-הבקשות-החיצוניות.
const OWN_ORIGIN = 'https://alonim-research.chuk-app.workers.dev';
const isOwnOriginRef = (m) => m.includes(OWN_ORIGIN);

const EXTERNAL_REF_CHECKS = [
  { label: 'src/href חיצוני', re: /(?:src|href)\s*=\s*["'](?:https?:)?\/\/[^"']*["']/gi },
  { label: 'CSS url() חיצוני', re: /url\(\s*["']?(?:https?:)?\/\/[^)"']*["']?\s*\)/gi },
  { label: 'fetch() לכתובת חיצונית', re: /\bfetch\(\s*["'`](?:https?:)?\/\/[^"'`]*["'`]/gi },
  { label: 'XMLHttpRequest.open() לכתובת חיצונית', re: /\.open\(\s*["'][A-Za-z]+["']\s*,\s*["'](?:https?:)?\/\/[^"']*["']/gi },
];
const ext = EXTERNAL_REF_CHECKS.flatMap(({ label, re }) =>
  (out.match(re) || []).filter((m) => !isOwnOriginRef(m)).map((m) => `${label}: ${m}`)
);
if (ext.length) throw new Error('נמצאו הפניות חיצוניות:\n' + ext.join('\n'));

console.log(`\n✓ index.html נבנה — ${(Buffer.byteLength(out) / 1024).toFixed(1)}KB (CSS ${(Buffer.byteLength(css) / 1024).toFixed(1)}KB + מקודד QR ${(Buffer.byteLength(qr) / 1024).toFixed(1)}KB מוטמעים), אפס בקשות לדומיינים חיצוניים.`);
