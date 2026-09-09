import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
// 便AJ 計測コミット0: 院内/経営タブの総字数と1画面目(ビューポート内)の字数を (a)名称・数値 (b)説明文 (c)モーダル・facts/lesson に分けて出す
const browser = await chromium.launch();
// (b) 説明文。v81 便AJ-2 の計測コミット0で「(d) 人の声・名札」(スタッフの声 .shop-voice・スタッフ帯 .staff-strip の職種名/氏名)を (b) から外して別計上にした(職種名は名称・声は人の気配=第25条。畳む対象ではない)
const EXPL = 'small, .ctrl-note, .shop-hint, .pnl-note, .kb-cond, .act-note, .kijun-badge, .mission-lesson, .modal-note, .card-title small, .ctrl-head small, .jihi-stat, .dec-sub, .tb-card p, .rs-learn';
const VOICE = '.shop-voice, .staff-strip';
async function measure(page, tab) {
  await page.evaluate((t) => document.querySelector(`[data-tab="${t}"]`)?.click(), tab); await page.waitForTimeout(250);
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(50);
  return page.evaluate(([EXPL, VOICE]) => {
    const pane = document.querySelector('.tab-pane.on, .pane.on, section.on, [data-pane].on') || document.body;
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
    const inView = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };
    const explSet = new Set(pane.querySelectorAll(EXPL));
    const voiceSet = new Set(pane.querySelectorAll(VOICE));
    const isIn = (set) => (n) => { let e = n.parentElement; while (e && e !== pane) { if (set.has(e)) return true; e = e.parentElement; } return false; };
    const isExpl = isIn(explSet), isVoice = isIn(voiceSet);
    const inModal = (n) => !!n.parentElement.closest('#modal, #decisionGate, #tutorial, #startGate, details:not([open])');
    let total = { a: 0, b: 0, c: 0, d: 0 }, first = { a: 0, b: 0, c: 0, d: 0 };
    const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const t = n.textContent.replace(/\s+/g, '');
      if (!t) continue;
      const el = n.parentElement; if (!el || !vis(el)) continue;
      const cat = inModal(n) ? 'c' : isVoice(n) ? 'd' : isExpl(n) ? 'b' : 'a';
      total[cat] += t.length;
      if (inView(el)) first[cat] += t.length;
    }
    return { total, first, sum: total.a + total.b + total.c + total.d, firstSum: first.a + first.b + first.c + first.d, height: document.documentElement.scrollHeight };
  }, [EXPL, VOICE]);
}
for (const w of [375, 390]) {
  for (const stage of ['day1', 'day10']) {
    const page = await browser.newPage({ viewport: { width: w, height: 844 } });
    await page.route(/googleapis|gstatic|zgo\.at/, (r) => r.abort());
    await page.addInitScript(() => { let s = 3; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; });
    await page.goto('http://localhost:8767/clinic-flow-3d/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(300);
    await page.evaluate(() => { document.querySelector('[data-gate="orthopedics"]')?.click(); document.getElementById('gateGo')?.click(); document.getElementById('tutSkip')?.click(); });
    await page.waitForTimeout(300);
    if (stage === 'day10') {
      await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('clinicTown_v3')); s.g.day = 10; s.g.lastStage = 3; localStorage.setItem('clinicTown_v3', JSON.stringify(s)); });
      await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(500);
      await page.evaluate(() => document.querySelector('#modal.show .btn-cta')?.click()); await page.waitForTimeout(100);
    }
    const out = {};
    for (const tab of ['clinic', 'mgmt']) out[tab] = await measure(page, tab);
    console.log(w, stage, JSON.stringify(out));
    await page.close();
  }
}
await browser.close();
