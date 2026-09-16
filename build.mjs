/**
 * בנייה: מקמפל Tailwind לפי הקלאסים שבשימוש ב-src/index.html בלבד,
 * ומטמיע את ה-CSS המינימלי ישירות בתוך index.html שבשורש (מוכן לפריסה).
 * הרצה:  npm run build
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

execFileSync('npx', ['tailwindcss', '-c', 'tailwind.config.js', '-i', 'src.css', '-o', '.tw.out.css', '--minify'], { stdio: 'inherit' });

const css  = readFileSync('.tw.out.css', 'utf8').trim();
const tpl  = readFileSync('src/index.html', 'utf8');
if (!tpl.includes('/*__TAILWIND_CSS__*/')) throw new Error('חסר הסמן /*__TAILWIND_CSS__*/ ב-src/index.html');

const out = tpl.replace('/*__TAILWIND_CSS__*/', css);
writeFileSync('index.html', out);
rmSync('.tw.out.css', { force: true });

const ext = out.match(/(?:src|href)="(?:https?:)?\/\/[^"]*"/g) || [];
if (ext.length) throw new Error('נמצאו הפניות חיצוניות: ' + ext.join(', '));

console.log(`\n✓ index.html נבנה — ${(Buffer.byteLength(out) / 1024).toFixed(1)}KB, CSS מוטמע ${(Buffer.byteLength(css) / 1024).toFixed(1)}KB, אפס בקשות לדומיינים חיצוניים.`);
