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

// --- Regression: ברירת המחדל בטעינת העמוד היא סשן 6 הצעדים, לא פלנקר בודד ---
// (המבקש המפורש: רוב המבקרים אמורים לנסות קודם את הניסוי המשולב עצמו.)
const defaultModeState = await page.evaluate(() => ({
  currentMode,
  sessionBtnActive: document.getElementById('mode-session-btn').className.includes('bg-purple-600'),
  progressBarHidden: document.getElementById('session-progress-bar').classList.contains('hidden'),
  startBtnText: document.getElementById('start-trial-btn').textContent.trim(),
}));
ok(defaultModeState.currentMode === 'session' && defaultModeState.sessionBtnActive && !defaultModeState.progressBarHidden,
   `ברירת המחדל בטעינה היא סשן 6 הצעדים (currentMode=${defaultModeState.currentMode})`);
ok(defaultModeState.startBtnText.includes('6 צעדים'), `כפתור ההפעלה הדיפולטי מזמין לסשן (${defaultModeState.startBtnText})`);

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

// --- Regression: הסבר התוצאות מנוסח בשפה מובנת לקהל הרחב, בלי מספרים/מונחים ---
// (משוב מפורש מהמשתמש: גרסה קודמת עדיין כללה מספרי ms ואת המונח "Switch Cost"
// בתוך הטקסט הראשי. הפתרון: התגית והפסקה המרכזית נטולות ספרות/מונחים לגמרי,
// והמספרים המדויקים זמינים רק בתוך <details> מתקפל שנסגר כברירת מחדל.)
const plainLangCheck = await page.evaluate(() => {
  const details = document.querySelector('#session-results-card details');
  return {
    badgeText: document.getElementById('sc-user-score-badge').textContent,
    insightText: document.getElementById('sc-insight-text').textContent,
    detailsExists: !!details,
    detailsCollapsed: !!details && !details.open,
    detailsSwitch: document.getElementById('sc-switch-rt').textContent,
    detailsRepeat: document.getElementById('sc-repeat-rt').textContent,
    detailsDiff: document.getElementById('sc-diff-rt').textContent,
  };
});
ok(!/\d/.test(plainLangCheck.badgeText) && plainLangCheck.badgeText.trim().length > 0,
   `התגית העליונה איכותנית/אמוג'י, בלי שום ספרה (${plainLangCheck.badgeText})`);
ok(!/\d/.test(plainLangCheck.insightText) && plainLangCheck.insightText.length > 80,
   `הסבר התוצאות המרכזי מנוסח במילים בלבד, בלי מספרים/יחידות-זמן (${plainLangCheck.insightText.length} תווים)`);
ok(plainLangCheck.detailsExists && plainLangCheck.detailsCollapsed,
   'אזור "נתונים מדויקים" קיים כ-<details> מתקפל, סגור כברירת מחדל');
ok(/\d/.test(plainLangCheck.detailsSwitch) && /\d/.test(plainLangCheck.detailsRepeat) && /\d/.test(plainLangCheck.detailsDiff),
   `המספרים המדויקים עדיין קיימים בפועל בתוך ה-<details> (גם כשהוא סגור): ${plainLangCheck.detailsSwitch} / ${plainLangCheck.detailsRepeat} / ${plainLangCheck.detailsDiff}`);

// --- Regression: "נסו שוב" + אפשרות להריץ סשן נוסף בלי רענון דף ---
// (באג שדווח: המשתמש חייב לרענן את הדף כדי לנסות שוב. הסיבה האמיתית: הכפתור
// הצף "חזרה למעלה" חפף/נצמד לכפתור "נסו שוב" ותפס הקשות מיועדות אליו.)
await page.waitForTimeout(400); // הכרטיס כבר גלל אליו לבד (finishSessionCalculations)
ok(await page.evaluate(() => document.getElementById('back-to-top-btn').dataset.suppressed === '1'),
   'הכפתור הצף "חזרה למעלה" מוסתר כל עוד כרטיס התוצאות גלוי (מונע הקשה שגויה במקום "נסו שוב")');

const retryLocator = page.locator('button[onclick="restartSession()"]');
await retryLocator.scrollIntoViewIfNeeded();
const retryBox = await retryLocator.boundingBox();
// הקשה ממש בפינה שבה הכפתור הצף היה בעבר חופף לכפתור "נסו שוב"
await page.mouse.click(retryBox.x + 12, retryBox.y + retryBox.height - 6);
await page.waitForTimeout(250);
const afterRetryTap = await page.evaluate(() => ({ sessionStepIndex, cardHidden: document.getElementById('session-results-card').classList.contains('hidden') }));
ok(afterRetryTap.sessionStepIndex === 0 && afterRetryTap.cardHidden,
   'הקשה על "נסו שוב" (כולל בפינה הקריטית) מפעילה סשן חדש בפועל, בלי רענון דף');

const rts2 = [];
for (let i = 0; i < 6; i++) {
  await page.waitForFunction(() => document.getElementById('feedback-msg').textContent.includes('הגיבו עכשיו'), null, { timeout: 5000 });
  const key = await page.evaluate(i => sessionSequence[i].key, i);
  await page.waitForTimeout(90 + i * 40);
  await page.keyboard.press(key === 'J' ? 'j' : 'f');
  await page.waitForTimeout(700);
}
const res2 = await page.evaluate(() => ({
  resultsLen: sessionResults.length,
  cardHidden: document.getElementById('session-results-card').classList.contains('hidden'),
}));
ok(res2.resultsLen === 6 && !res2.cardHidden, `סשן שני, בתוך אותו טעינת-עמוד, מסתיים תקין (${res2.resultsLen}/6 צעדים)`);

// --- Regression: מניעת ריצה כפולה (race condition) ב-startTrial ---
// (קריאה כפולה/מהירה ל-startTrial — למשל לחיצה כפולה מקרית — הייתה פותחת
// שני טיימרים במקביל, והטיימר השני דורס את מצב הראשון. התיקון: guard לפי
// trialActive/pendingTrialTimer בכניסה לפונקציה.)
await page.click('#mode-flanker-btn'); await page.waitForTimeout(200);
const raceCheck = await page.evaluate(() => {
  startTrial();
  const firstTimer = pendingTrialTimer;
  startTrial(); // קריאה שנייה מיידית — חייבת להיחסם ע"י ה-guard
  return { firstTimer, timerUnchanged: pendingTrialTimer === firstTimer };
});
ok(raceCheck.firstTimer !== null && raceCheck.timerUnchanged,
   'קריאה כפולה ל-startTrial לא פותחת טיימר שני (ה-timer הראשון נשאר ללא שינוי)');
await page.waitForTimeout(400); // מניחים לטיימר הראשון לפתוח את הגירוי בפועל
await page.keyboard.press('f'); // סוגרים את הטריאל (לא משנה אם התשובה נכונה — רק ניקוי מצב)
await page.waitForTimeout(300);

// --- Regression: מעבר מצב (setLabMode) באמצע טריאל ממתין מבטל אותו ---
// (באג state-desync: החלפת מצב באמצע ה-"+" שלפני הגירוי השאירה טיימר ישן
// פעיל ברקע, שדרס את המצב החדש כשההתראה שלו הגיעה.)
const modeSwitchCancel = await page.evaluate(() => {
  startTrial();
  const hadPendingTimer = pendingTrialTimer !== null;
  setLabMode('math');
  return { hadPendingTimer, pendingAfterSwitch: pendingTrialTimer, trialActiveAfterSwitch: trialActive, modeAfterSwitch: currentMode };
});
ok(modeSwitchCancel.hadPendingTimer && modeSwitchCancel.pendingAfterSwitch === null && !modeSwitchCancel.trialActiveAfterSwitch,
   `מעבר מצב באמצע טריאל ממתין מבטל אותו (pendingTimer=${modeSwitchCancel.pendingAfterSwitch}, trialActive=${modeSwitchCancel.trialActiveAfterSwitch})`);
ok(modeSwitchCancel.modeAfterSwitch === 'math', `המעבר למצב החדש בוצע בפועל (${modeSwitchCancel.modeAfterSwitch})`);
await page.click('#mode-flanker-btn'); await page.waitForTimeout(200); // חזרה למצב נקי להמשך הבדיקות

// --- Regression: עזיבת הטאב (visibilitychange) באמצע טריאל פעיל מבטלת אותו ---
// (ללא זה, RT נמדד כולל את כל משך ההיעדרות מהטאב — נתון פגום בלי סימון.)
const hiddenCancel = await page.evaluate(() => new Promise((resolve) => {
  startTrial();
  setTimeout(() => { // מניחים לגירוי בפועל להופיע (trialActive=true)
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    resolve({
      trialActive,
      pendingTrialTimer,
      feedbackText: document.getElementById('feedback-msg').textContent,
      startBtnDisabled: document.getElementById('start-trial-btn').disabled,
    });
  }, 350);
}));
ok(!hiddenCancel.trialActive && hiddenCancel.pendingTrialTimer === null,
   `עזיבת הטאב באמצע טריאל פעיל מבטלת אותו (trialActive=${hiddenCancel.trialActive})`);
ok(hiddenCancel.feedbackText.includes('בוטל') && !hiddenCancel.startBtnDisabled,
   `מוצגת הודעה שהצעד בוטל, וכפתור "התחל צעד" חזר לפעיל (הודעה: "${hiddenCancel.feedbackText}")`);
await page.evaluate(() => Object.defineProperty(document, 'hidden', { value: false, configurable: true }));

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

// --- Regression: focus-trap במגירת הניווט ---
// (בלי focus-trap, Tab "בורח" מהמגירה הפתוחה לאלמנטים חבויים מאחוריה —
// מבחינת מי שמנווט במקלדת, זו ניווט בלתי-צפוי לתוכן שהוא לא יכול לראות.)
ok(await page.evaluate(() => document.getElementById('nav-drawer').contains(document.activeElement)),
   'בפתיחת המגירה, המיקוד עובר לאלמנט הראשון בתוכה');
const drawerTrap = await page.evaluate(() => {
  const drawer = document.getElementById('nav-drawer');
  const items = Array.from(drawer.querySelectorAll('a[href], button:not([disabled])')).filter(el => el.offsetParent !== null);
  items[0].focus();
  return { count: items.length };
});
await page.keyboard.press('Shift+Tab'); // מהראשון, אחורה — חייב לעגל לאחרון
const wrappedToLast = await page.evaluate(() => {
  const drawer = document.getElementById('nav-drawer');
  const items = Array.from(drawer.querySelectorAll('a[href], button:not([disabled])')).filter(el => el.offsetParent !== null);
  return document.activeElement === items[items.length - 1];
});
ok(drawerTrap.count > 1 && wrappedToLast, `Shift+Tab מהפריט הראשון במגירה מעגל לפריט האחרון (${drawerTrap.count} פריטים)`);
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'hamburger-btn'),
   'סגירת המגירה (Escape) מחזירה את המיקוד לכפתור ההמבורגר');

// יוצאים ממצב סשן (סוגר את כרטיס התוצאות) לפני בדיקת הכפתור הצף הרגילה —
// כל עוד כרטיס התוצאות גלוי, הכפתור הצף מוסתר בכוונה (ר' הבדיקה למעלה).
await page.click('#mode-flanker-btn'); await page.waitForTimeout(200);

await page.evaluate(() => window.scrollTo(0, 1200)); await page.waitForTimeout(400);
ok(await page.evaluate(() => document.getElementById('back-to-top-btn').classList.contains('opacity-100')), 'כפתור Back-to-Top מופיע בגלילה (כשאין כרטיס תוצאות פתוח)');
await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(400);

await page.click('button[onclick="openQrModal()"]'); await page.waitForTimeout(400);
const qr = await page.evaluate(() => { const e = document.getElementById('qr-image');
  return { tag: e && e.tagName.toLowerCase(), w: e && e.getBoundingClientRect().width,
           label: e && e.getAttribute('aria-label'), url: siteUrl() }; });
ok(qr.tag === 'svg' && qr.w > 100, `QR נוצר בזמן ריצה כ-SVG (${qr.tag}, ${Math.round(qr.w)}px)`);
ok(qr.label === 'QR code ' + qr.url, `ה-QR מקודד את הכתובת הנוכחית (${qr.url})`);
await page.screenshot({ path: 'shot-qr.png' });

// --- Regression: focus-trap במודאל ה-QR (אותה בעיה כמו במגירה, ר' לעיל) ---
ok(await page.evaluate(() => document.getElementById('qr-modal').contains(document.activeElement)),
   'בפתיחת מודאל ה-QR, המיקוד עובר לאלמנט בתוכו');
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
ok(await page.evaluate(() => document.activeElement && document.activeElement.matches('button[onclick="openQrModal()"]')),
   'סגירת מודאל ה-QR (Escape) מחזירה את המיקוד לכפתור שפתח אותו');

// הערה: בדיקת "קליק על קישור-עוגן לא צורך תעבורת-רשת לאייקון" (QA #9) לא
// רלוונטית כאן — העמוד הזה נטען מ-file://, כך שאין Service Worker פעיל
// בכלל (SW דורש origin אמיתי) ולכן אין מטמון-ברקע לבדוק. הבדיקה הזו נמצאת
// ב-test-offline.mjs, שמריץ שרת http מקומי אמיתי עם ה-SW פעיל.

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
