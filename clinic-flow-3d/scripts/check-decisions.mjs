/* 経営の分岐点 — ケースの機械検査+一覧生成
 * 実行: node clinic-flow-3d/scripts/check-decisions.mjs [--write-doc]
 * 検査: 200件・ID一意・分類配分・3択以上・到達可能な発生条件(合成状態の格子で1つ以上)・next参照先・
 *       各選択肢を複数の状態で evaluate して NaN/負数/例外が無いこと・見込み=確定(同じ入力で同じ出力)・連続40件以上 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const D = require(join(ROOT, 'app', 'decisions.js'));
const dir = join(ROOT, 'app', 'decisions');
const files = readdirSync(dir).filter((f) => /^cases-.*\.js$/.test(f)).sort();
const all = [];
for (const f of files) { const list = require(join(dir, f)); for (const c of list) c._file = f; all.push(...list); }
D.register(all);

const errs = [];
const v = D.validate(all);
errs.push(...v.errs);

// 合成状態の格子(到達可能性)。ゲームで起こりうる範囲に限る
const specs = ['orthopedics', 'internal', 'ophthalmology'];
const mainEquips = [null, { fundusSet: true, oct: true, field: true, surgery: true }]; // 他科本院の設備(v79 便AI-3・眼科固有ケースの到達可能性)
const grid = [];
for (const specialty of specs)
  for (const day of [5, 12, 25, 50, 90, 200])
    for (const money of [-200000, 300000, 1500000, 6000000])
      for (const load of [0.3, 0.6, 0.85, 1.0])
        for (const extra of [{}, { depts: ['homecare'], branches: 1, hospital: true }, { depts: ['dialysis', 'ophthalmology'], branches: 2 }])
          for (const st of [{ slack: -2, trust: -1 }, { slack: 0, trust: 0 }, { slack: 2, trust: 2 }])
            for (const mainEquip of mainEquips) {
              const patients7 = Math.round(load * 40);
              grid.push(Object.assign({
                day, money, rep: 60 + (load - 0.6) * 20, aw: 0.3 + load * 0.3,
                staff: { doctors: day > 60 ? 2 : 1, nurses: day > 25 ? 2 : 1, receptionists: 1, pts: specialty === 'orthopedics' && day > 25 ? 1 : 0, rehaAides: 0 },
                staffTotal: 3 + (day > 25 ? 1 : 0) + (day > 60 ? 1 : 0), specialty, stage: day >= 8 ? 3 : day >= 4 ? 2 : 1,
                depts: [], branches: 0, hospital: false, rehaLevel: specialty === 'orthopedics' && day > 25 ? 1 : 0, flags: {},
                load, patients7, newp7: Math.round(patients7 * 0.3), refer7: Math.round(patients7 * 0.1), waitAvg: 10 + load * 40, balked7: load >= 0.85 ? 2 : 0,
                monthProfit: Math.round((load - 0.45) * 3000000), monthRevenue: Math.round(patients7 * 6000 * 26), dailyCost: 120000, runway: Math.max(0, Math.round(money / 120000)),
                rentDay: 25000, examMean: 6, relations: { hospital: day > 25 ? 1 : 0, caremane: day > 50 ? 1 : 0, rouken: 0, school: day > 12 ? 1 : 0 }, kaitei: 0, mainEquip
              }, extra, st));
            }

const stBase = D.newState('check');
const unreachable = [];
const chainIds = new Set();
for (const c of all) {
  const reach = grid.some((ctx) => D.eligible(c, ctx, stBase, { ignoreChain: true }).ok);
  if (!reach) unreachable.push(c.id);
  for (const ch of c.choices || []) {
    const fx = typeof ch.fx === 'function' ? null : ch.fx;
    if (fx && fx.next) { chainIds.add(c.id); chainIds.add(fx.next.id); }
    // 各状態で評価。例外・NaN・人数の負
    for (const ctx of grid.filter((_, i) => i % 7 === 0)) {
      let o;
      try { o = D.evaluate(c, ch, ctx, stBase); } catch (e) { errs.push(`[${c.id}/${ch.id}] evaluate 例外: ${e.message}`); break; }
      const o2 = D.evaluate(c, ch, ctx, stBase);
      if (JSON.stringify(o.fx) !== JSON.stringify(o2.fx)) errs.push(`[${c.id}/${ch.id}] 見込みと確定が一致しない`);
      for (const [k, val] of Object.entries(o.fx)) if (typeof val === 'number' && !Number.isFinite(val)) errs.push(`[${c.id}/${ch.id}] ${k} が数値でない`);
      if (o.fx.staff) for (const [k, val] of Object.entries(o.fx.staff)) if ((ctx.staff[k] || 0) + val < (k === 'doctors' ? 1 : 0)) errs.push(`[${c.id}/${ch.id}] ${k} が負になる`);
      // 文中の禁則
      const txt = [fnv(c.say, ctx), fnv(c.bg, ctx), c.ask, c.title, ch.label, fnv(ch.note, ctx), c.lesson].filter(Boolean).join('\n');
      if (/!/.test(txt)) errs.push(`[${c.id}/${ch.id}] 文中に「!」`);
      if (/\$\{|undefined|NaN/.test(txt)) errs.push(`[${c.id}/${ch.id}] 文中に未展開/undefined`);
    }
  }
}
function fnv(x, ctx) { return typeof x === 'function' ? x(ctx) : x; }
if (unreachable.length) errs.push(`到達できない発生条件: ${unreachable.join(', ')}`);

const perCat = v.cats;
const total = all.length;
console.log(`ケース ${total}件 / 分類別: ${Object.entries(perCat).map(([k, n]) => `${k}:${n}`).join(' ')} / 連続イベントに関わる ${chainIds.size}件`);
if (total < 200) errs.push(`件数が200未満(${total})`);
for (let k = 1; k <= 10; k++) if ((perCat[k] || 0) < 20) errs.push(`分類${k} が20件未満(${perCat[k] || 0})`);
if (chainIds.size < 40) errs.push(`連続イベントが40件未満(${chainIds.size})`);

if (process.argv.includes('--write-doc')) {
  const lines = ['# 経営の分岐点 — ケース一覧(自動生成: node clinic-flow-3d/scripts/check-decisions.mjs --write-doc)', '',
    `件数 ${total} / 連続イベントに関わるケース ${chainIds.size}。分類・発生条件・学習する論点。発生条件の「cond」はコードの要約、時期は tier(1=序盤 Day5〜 / 2=Day20〜 / 3=Day45〜または分院・部門あり)。`, '',
    '| ID | 分類 | タイトル | 話者 | 時期 | 科/前提 | 発生条件 | 学習する論点 | 連続 |', '|---|---|---|---|---|---|---|---|---|'];
  for (const c of all) {
    const who = typeof c.who === 'string' ? (D.WHO[c.who] || {}).name || c.who : c.who.name;
    const needs = [(c.spec || []).join('/'), ...Object.entries(c.needs || {}).map(([k, val]) => `${k}=${JSON.stringify(val)}`)].filter(Boolean).join(' ');
    const cond = c.condText || (c.cond ? String(c.cond).replace(/^\(?c\)?\s*=>\s*/, '').replace(/\s+/g, ' ') : '常時');
    const nexts = (c.choices || []).map((ch) => ch.fx && typeof ch.fx !== 'function' && ch.fx.next && ch.fx.next.id).filter(Boolean);
    lines.push(`| ${c.id} | ${c.cat} ${D.CATS[c.cat]} | ${c.title} | ${who} | ${c.tier} | ${needs} | ${cond.replace(/\|/g, '/')} | ${c.point || ''} | ${c.chainOnly ? '← 前の判断から' : ''}${nexts.length ? ` → ${[...new Set(nexts)].join(', ')}` : ''} |`);
  }
  writeFileSync(join(ROOT, 'docs', 'decisions-list.md'), lines.join('\n') + '\n');
  console.log('docs/decisions-list.md を更新');
}
if (errs.length) { console.log('NG:'); for (const e of errs) console.log('  - ' + e); process.exit(1); }
console.log('check-decisions: OK');
