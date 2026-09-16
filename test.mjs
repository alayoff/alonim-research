import { chromium } from 'playwright';

const fails = [], notes = [];
const ok = (c, m) => c ? notes.push('✓ ' + m) : fails.push('✗ ' + m);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const external = [], errors = [];
page.on('request', r => { if (!r.url().startsWith('file://') && !r.url().startsWith('data:')) external.push(r.url()); });
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('file:///home/claude/alonim/index.html', { waitUntil: 'load' });
await page.waitForTimeout(600);

ok(external.length === 0, `אפס בקשות רשת חיצוניות (נמצאו ${external.length}${external.length ? ': ' + external.join(', ') : ''})`);
ok(errors.length === 0, `אין שגיאות JS (${errors.join(' | ') || 'נקי'})`);

// --- answer-key integrity: every stimulus vs its key ---
const keyAudit = await page.evaluate(() => {
  const centerOf = t => t.split(' ').filter(Boolean)[2];
  const evalEq = t => { const m = t.match(/^(\d+)\s*([+-])\s*(\d+)\s*=\s*(\d+)$/); const a=+m[1],b=+m[3],r=+m[4];
                        return ((m[2]==='+'?a+b:a-b) === r) ? 'J' : 'F'; };
  const bad = [];
  const check = (arr, src) => arr.forEach((it, i) => {
    const expected = it.type === 'flanker' ? (centerOf(it.text) === '→' ? 'J' : 'F') : evalEq(it.text);
    if (it.key !== expected) bad.push(`${src}[${i}] "${it.text}" key=${it.key} expected=${expected}`);
  });
  check(sessionSequence, 'session'); check(flankerPool, 'flanker'); check(mathPool, 'math');
  const mathFalse = mathPool.filter(m => m.key === 'F').length;
  return { bad, mathFalse, mathTotal: mathPool.length,
           types: sessionSequence.map(s => s.type),
           keys: sessionSequence.map(s => s.key) };
});
ok(keyAudit.bad.length === 0, `כל מפתחות התשובה תואמים לגירוי (${keyAudit.bad.join(' | ') || '18/18 תקינים'})`);
ok(keyAudit.mathFalse > 0, `ב-mathPool יש משוואות שגויות: ${keyAudit.mathFalse} מתוך ${keyAudit.mathTotal}`);
ok(keyAudit.types[4] === 'math_switch' && keyAudit.types[5] === 'math_repeat',
   `צעד 5 = Switch, צעד 6 = Repeat (בפועל: ${keyAudit.types[4]}, ${keyAudit.types[5]})`);

// --- run the full 6-step session with correct answers ---
await page.click('#mode-session-btn');
await page.click('#start-trial-btn');
const rts = [];
for (let i = 0; i < 6; i++) {
  await page.waitForFunction(() => window.trialActiveProbe ? true : document.getElementById('feedback-msg').textContent.includes('הגיבו עכשיו'), null, { timeout: 5000 });
  const key = await page.evaluate(i => sessionSequence[i].key, i);
  await page.waitForTimeout(90 + i * 40);          // RT דטרמיניסטי-יחסית
  await page.keyboard.press(key === 'J' ? 'j' : 'f');
  await page.waitForTimeout(700);
}
const res = await page.evaluate(() => ({
  results: sessionResults.map(r => ({ type: r.type, rt: r.rt, correct: r.correct })),
  sw: document.getElementById('sc-switch-rt').textContent,
  rp: document.getElementById('sc-repeat-rt').textContent,
  diff: document.getElementById('sc-diff-rt').textContent,
  cardHidden: document.getElementById('session-results-card').classList.contains('hidden'),
  insight: document.getElementById('sc-insight-text').textContent.slice(0, 90)
}));
ok(res.results.length === 6 && res.results.every(r => r.correct),
   `6 צעדים נענו נכון (${res.results.filter(r => r.correct).length}/6)`);
ok(!res.cardHidden, 'כרטיס התוצאות נפתח');
const swN = parseInt(res.sw), rpN = parseInt(res.rp), dfN = parseInt(res.diff.replace('+',''));
ok(dfN === swN - rpN, `SC = Switch − Repeat (${swN} − ${rpN} = ${dfN})`);

// --- semester slider (סמסטר א' ➔ ב') ---
await page.evaluate(() => document.getElementById('gorilla-journey-slider').scrollIntoView());
await page.waitForTimeout(1300);

const imgs = await page.evaluate(() => [...document.querySelectorAll('#gorilla-journey-slider img')].map(i => ({
  ok: i.complete && i.naturalWidth > 0, nw: i.naturalWidth,
  lazy: i.getAttribute('loading'), sized: !!(i.getAttribute('width') && i.getAttribute('height'))
})));
ok(imgs.length === 2, `שתי תמונות בסליידר (${imgs.length})`);
ok(imgs.every(i => i.ok && i.nw > 400), `שתי התמונות נטענו מ-file:// (${imgs.map(i=>i.nw).join(', ')}px)`);
ok(imgs.every(i => i.lazy === 'lazy' && i.sized), 'lazy + מידות מפורשות על שתי התמונות (מניעת CLS)');

const readState = () => page.evaluate(() => ({
  opB: +getComputedStyle(document.getElementById('sem-photo-b')).opacity,
  badge: document.getElementById('sem-badge').textContent.trim(),
  val: +document.getElementById('semester-range').value,
}));

const st0 = await readState();
ok(st0.opB < 0.05 && st0.badge.includes("סמסטר א'"),
   `מצב התחלתי = סמסטר א' (opacity B=${st0.opB}, badge="${st0.badge.slice(0,12)}…")`);

// החלקה חלקית — דהייה רציפה, בלי קפיצה בין מצבים
await page.evaluate(() => { const r = document.getElementById('semester-range');
  r.value = 35; r.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(150);
const st35 = await readState();
ok(st35.opB > 0.25 && st35.opB < 0.45, `החלקה ל-35% נותנת דהייה חלקית (opacity B=${st35.opB.toFixed(2)})`);

// שחרור מתחת ל-50% — נתפס חזרה לסמסטר א'
await page.evaluate(() => { const r = document.getElementById('semester-range');
  r.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForTimeout(700);
const stSnapBack = await readState();
ok(stSnapBack.val === 0 && stSnapBack.opB < 0.05, `שחרור מתחת לחצי נתפס חזרה לסמסטר א' (value=${stSnapBack.val})`);

// החלקה מלאה לסמסטר ב'
await page.evaluate(() => { const r = document.getElementById('semester-range');
  r.value = 88; r.dispatchEvent(new Event('input', { bubbles: true }));
  r.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForTimeout(700);
const stB = await readState();
ok(stB.val === 100 && stB.opB > 0.95, `שחרור מעל לחצי נתפס לסמסטר ב' (value=${stB.val}, opacity B=${stB.opB})`);
ok(stB.badge.includes("סמסטר ב'"), `התווית על התמונה התחלפה לסמסטר ב' (badge="${stB.badge.slice(0,12)}…")`);

// כפתור הקיצור חוזר לסמסטר א'
await page.click('#sem-btn-a');
await page.waitForTimeout(700);
const stBack = await readState();
ok(stBack.val === 0 && stBack.opB < 0.05, `כפתור "סמסטר א'" מחזיר את המצב (value=${stBack.val})`);

// אזור מגע נוח לאצבע
const thumbArea = await page.evaluate(() => document.getElementById('semester-range').getBoundingClientRect().height);
ok(thumbArea >= 40, `גובה אזור המגע של הפס ${Math.round(thumbArea)}px (≥40 להפעלה נוחה באצבע)`);

// --- UI components ---
await page.click('#hamburger-btn'); await page.waitForTimeout(450);
ok(await page.evaluate(() => !document.getElementById('nav-drawer').classList.contains('translate-x-full')), 'תפריט המבורגר נפתח');
ok(await page.evaluate(() => { const d = document.getElementById('nav-drawer').getBoundingClientRect();
    return Math.abs(d.right - window.innerWidth) < 4; }), 'המגירה עוגנת לצד ימין (RTL)');
await page.keyboard.press('Escape'); await page.waitForTimeout(400);

await page.evaluate(() => window.scrollTo(0, 1200)); await page.waitForTimeout(400);
ok(await page.evaluate(() => document.getElementById('back-to-top-btn').classList.contains('opacity-100')), 'כפתור Back-to-Top מופיע בגלילה');
await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(400);

await page.click('button[onclick="openQrModal()"]'); await page.waitForTimeout(400);
const qr = await page.evaluate(() => { const e = document.getElementById('qr-image');
  return { tag: e && e.tagName.toLowerCase(), w: e && e.getBoundingClientRect().width,
           label: e && e.getAttribute('aria-label'), url: siteUrl() }; });
ok(qr.tag === 'svg' && qr.w > 100, `QR נוצר בזמן ריצה כ-SVG (${qr.tag}, ${Math.round(qr.w)}px)`);
ok(qr.label === 'QR code ' + qr.url, `ה-QR מקודד את הכתובת הנוכחית (${qr.url})`);
await page.screenshot({ path: 'shot-qr.png' });
await page.keyboard.press('Escape'); await page.waitForTimeout(300);

// horizontal overflow check
ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
   'אין גלישה אופקית במסך נייד');

await page.evaluate(() => window.scrollTo(0,0)); await page.waitForTimeout(300);
await page.screenshot({ path: 'shot-mobile-top.png' });
await page.evaluate(() => document.getElementById('interactive-lab').scrollIntoView()); await page.waitForTimeout(500);
await page.screenshot({ path: 'shot-mobile-lab.png' });

const dpage = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await dpage.goto('file:///home/claude/alonim/index.html'); await dpage.waitForTimeout(700);
await dpage.screenshot({ path: 'shot-desktop.png' });

await browser.close();
console.log(notes.join('\n'));
if (fails.length) { console.log('\n--- כשלים ---\n' + fails.join('\n')); process.exit(1); }
console.log('\nכל הבדיקות עברו.');
