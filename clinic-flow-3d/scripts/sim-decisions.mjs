/* 経営の分岐点 — 方針別シミュレーション(設計の偏りの検査)
 * 実行: node clinic-flow-3d/scripts/sim-decisions.mjs
 * 200日間、簡略化した経営モデル(患者数・売上・費用)の上で相談を回し、固定の選び方
 * (常に1番目/2番目/3番目・最安・最高額・ランダム)で結果を比べる。特定の位置だけで勝てる設計になっていないかを見る。
 * 併せて、選択肢の位置ごとの「費用も負効果もない選択肢」の割合と90日換算費用の平均を静的に出す(便AI-2)。
 * ここでの経済は game.js の簡略版(検査用)。数字はゲーム本体の値ではない */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const D = require(join(ROOT, 'app', 'decisions.js'));
const dir = join(ROOT, 'app', 'decisions');
for (const f of readdirSync(dir).filter((x) => /^cases-.*\.js$/.test(x)).sort()) D.register(require(join(dir, f)));

const COST = { doctors: 80000, nurses: 18000, receptionists: 10000, pts: 16000, rehaAides: 10000 };
function run(strategy, seed, specialty, equip) {
  const G = { money: 2000000, rep: 60, aw: 0.3, coins: 0, relations: { hospital: { lv: 0, last: 0 }, caremane: { lv: 0, last: 0 }, rouken: { lv: 0, last: 0 }, pharmacy: { lv: 0, last: 0 }, company: { lv: 0, last: 0 }, sports: { lv: 0, last: 0 }, school: { lv: 0, last: 0 }, shoutengai: { lv: 0, last: 0 }, houkatsu: { lv: 0, last: 0 } } };
  const s = { doctors: 1, nurses: 1, receptionists: 1, pts: 0, rehaAides: 0, floorLv: 1, examMean: 6, rehaLevel: 0 };
  const st = D.newState(seed);
  const hist = [];
  let decided = 0, blockedPicks = 0, chains = 0;
  const rnd = D.rng(`${seed}|world`);
  for (let day = 1; day <= 200; day++) {
    // 簡略の1日: 新患は認知×評判、再診は評判、能力は医師数と診察時間、余力で診察時間が変わる
    const examDelta = D.examDelta(st, day);
    // 能力: 医師数×診察時間(planDay の examCapDay と同形)に、看護(処置ベッド=看護師数)と受付(会計・予約の回転)の薄さを掛ける。
    // 本体では看護師数がベッド稼働・受付数が窓口数に効くので、その簡略。1人で0.8・2人以上で1.0(v72・PM指摘=採用が売上に効かない計器の偏り)
    const support = Math.min(1, 0.8 + 0.2 * Math.min(1, Math.max(0, s.nurses - 1))) * Math.min(1, 0.8 + 0.2 * Math.min(1, Math.max(0, s.receptionists - 1)));
    const cap = Math.max(10, s.doctors * (480 / (s.examMean + examDelta + 1.5)) * 0.72) * support;
    const demand = (52 * G.aw * (G.rep / (G.rep + 55)) + 14 + D.trustReferrals(st)) * D.newMul(st, day) * (0.9 + rnd() * 0.2);
    const patients = Math.round(Math.min(demand, cap * 1.1));
    const revenue = patients * (5200 + (s.pts ? 900 : 0));
    const staffCost = Object.entries(COST).reduce((a, [k, v]) => a + (k === 'doctors' ? (s[k] - 1) * v : (s[k] || 0) * v), 0);
    const cost = 25000 + 8000 + staffCost + D.dailyCost(st, day) + patients * 300;
    G.money += revenue - cost;
    // 待ちと評判: 需要が能力を超えると評判が落ちる
    const load = demand / cap;
    G.rep = Math.max(15, Math.min(97, G.rep + (load > 1 ? -0.15 : 0.05) + (D.examDelta(st, day) > 1 ? -0.05 : 0)));
    G.aw = Math.max(0.05, Math.min(0.95, G.aw + 0.001));
    hist.push({ day, patients, revenue, cost, load });
    D.tick({ G, settings: s }, st, day);
    if (day < 5) continue;
    const h7 = hist.slice(-7);
    const ctx = {
      day, money: G.money, rep: G.rep, aw: G.aw, staff: { doctors: s.doctors, nurses: s.nurses, receptionists: s.receptionists, pts: s.pts, rehaAides: s.rehaAides },
      staffTotal: s.doctors + s.nurses + s.receptionists + s.pts + s.rehaAides, specialty, stage: day >= 8 ? 3 : day >= 4 ? 2 : 1,
      depts: [], branches: 0, hospital: false, rehaLevel: s.rehaLevel, flags: st.flags, slack: st.slack, trust: st.trust,
      load: Math.round(Math.min(1.2, h7.reduce((a, x) => a + x.load, 0) / h7.length) * 100) / 100,
      patients7: Math.round(h7.reduce((a, x) => a + x.patients, 0) / h7.length), newp7: Math.round(patients * 0.3), refer7: Math.round(D.trustReferrals(st) * 10) / 10,
      waitAvg: Math.round(10 + Math.max(0, load - 0.6) * 60), balked7: load > 1 ? 2 : 0,
      monthProfit: hist.slice(-30).reduce((a, x) => a + x.revenue - x.cost, 0), monthRevenue: hist.slice(-30).reduce((a, x) => a + x.revenue, 0),
      dailyCost: Math.round(cost), runway: Math.max(0, Math.round(G.money / Math.max(1, cost))), rentDay: 25000, examMean: s.examMean,
      relations: Object.fromEntries(Object.entries(G.relations).map(([k, v]) => [k, v.lv])), kaitei: 0, mainEquip: equip || null
    };
    const picked = D.pick(ctx, st);
    if (!picked) continue;
    const c = picked.c;
    if (picked.viaChain) chains++;
    const outs = c.choices.map((ch) => ({ ch, o: D.evaluate(c, ch, ctx, st) }));
    const okOuts = outs.filter((x) => x.o.ok);
    if (!okOuts.length) { blockedPicks++; st.cool[c.id] = day + 30; st.chainDue = st.chainDue.filter((x) => x.id !== c.id); st.nextDay = day + 3; continue; }
    let pickIdx;
    const order = outs.map((x, i) => i).filter((i) => outs[i].o.ok);
    if (strategy === 'first') pickIdx = order[0];
    else if (strategy === 'middle') pickIdx = order[Math.floor((order.length - 1) / 2)];
    else if (strategy === 'last') pickIdx = order[order.length - 1];
    else if (strategy === 'cheapest') pickIdx = order.slice().sort((a, b) => (outs[b].o.fx.money || 0) - (outs[a].o.fx.money || 0))[0];
    else if (strategy === 'spender') pickIdx = order.slice().sort((a, b) => (outs[a].o.fx.money || 0) - (outs[b].o.fx.money || 0))[0];
    else pickIdx = order[Math.floor(rnd() * order.length)];
    const { ch, o } = outs[pickIdx];
    D.commit(c, ch, o, { G, settings: s }, st, { viaChain: picked.viaChain });
    decided++;
  }
  return { money: Math.round(G.money), rep: Math.round(G.rep * 10) / 10, slack: st.slack, trust: st.trust, staff: s.doctors + s.nurses + s.receptionists + s.pts + s.rehaAides, decided, chains, blockedPicks, uniq: Object.keys(st.seen).length, seen: st.seen };
}

const strategies = ['first', 'middle', 'last', 'cheapest', 'spender', 'random'];
const seeds = ['a', 'b', 'c', 'd', 'e'];
const table = {};
for (const sg of strategies) {
  const rs = seeds.flatMap((sd) => ['orthopedics', 'internal'].map((sp) => run(sg, sd, sp)));
  const avg = (k) => Math.round(rs.reduce((a, r) => a + r[k], 0) / rs.length);
  table[sg] = { money: avg('money'), rep: avg('rep'), slack: (rs.reduce((a, r) => a + r.slack, 0) / rs.length).toFixed(1), trust: (rs.reduce((a, r) => a + r.trust, 0) / rs.length).toFixed(1), staff: avg('staff'), decided: avg('decided'), chains: avg('chains'), uniq: avg('uniq') };
}
console.table(table);
// 判定: どの単一戦略も「資金・評判・余力・信頼」の4指標すべてで首位にならない(=位置だけで勝てない)
// 余力と信頼は ±3 で頭打ちになり同値で並ぶことがある。同値のときは並んだ全員を首位として数える(甘く見ない)
const keys = ['money', 'rep', 'slack', 'trust'];
const leaders = keys.map((k) => {
  const vals = strategies.map((sg) => Number(table[sg][k]));
  const mx = Math.max(...vals);
  return strategies.filter((sg, i) => vals[i] === mx);
});
const leadCount = {};
for (const l of leaders) for (const sg of l) leadCount[sg] = (leadCount[sg] || 0) + 1;
const dominant = strategies.find((sg) => (leadCount[sg] || 0) === keys.length);
console.log('指標ごとの首位:', Object.fromEntries(keys.map((k, i) => [k, leaders[i].join('・')])));
// 注意(NGにはしない): 単一の位置が4指標のうち3つ以上で首位だと、位置で戦略が決まりやすい。
// 1番目の正の効果の配分を変える話になり、費用の配分(便AI-2)の範囲では動かせないため、判定ではなく注意として出す
const heavy = ['first', 'middle', 'last'].filter((sg) => (leadCount[sg] || 0) >= 3);
for (const sg of heavy) console.log(`注意: ${sg} が4指標のうち${leadCount[sg]}つで首位(目安は2つ以下。1番目の正の効果の配分はこの検査の外=PM判断)`);

/* ---------- 選択肢の位置による偏り(静的) ----------
 * 位置(1番目/中/最後)ごとに2つの割合と費用の平均を出す。
 *  罰なし   = 確実に起きる効果に、費用(一時費用・継続費)も職員減も、余力・信頼・評判・認知・関係・コインの減も、
 *             新患倍率<1 も診察時間の増も、遅延効果の負も無い選択肢。判定はこの列で行う
 *  費用なし = そのうち費用(一時費用・継続費)と職員減だけを見た割合(参考)
 *  90日換算費用 = 一時費用 + 継続費×min(日数,90)。「ずっと」の継続費は90日分で数える
 * 確率(chance)と条件(when)は起きるとは限らないので、この静的検査では base の効果だけを見る */
function fxCosty(fx) {
  if ((fx.money || 0) < 0) return true;
  if (fx.dailyCost && fx.dailyCost.yen > 0) return true;
  if (fx.staff && Object.values(fx.staff).some((v) => v < 0)) return true;
  return false;
}
function fxBad(fx) {
  if (fxCosty(fx)) return true;
  for (const k of ['slack', 'trust', 'rep', 'aw', 'coins']) if ((fx[k] || 0) < 0) return true;
  if (fx.rel && Object.values(fx.rel).some((v) => v < 0)) return true;
  if (fx.newMul && fx.newMul.mul < 1) return true;
  if (fx.examDelta && fx.examDelta.d > 0) return true;
  for (const d of fx.delayed || []) if (fxBad(d.fx || {})) return true;
  return false;
}
function cost90(fx) {
  let m = -Math.min(0, fx.money || 0);
  if (fx.dailyCost && fx.dailyCost.yen > 0) m += fx.dailyCost.yen * Math.min(fx.dailyCost.days == null ? 90 : fx.dailyCost.days, 90);
  return m;
}
// 判定用の中立な状況(この表は状況をずらしても動かないことを確認済み)
const posCtx = {
  day: 40, money: 1500000, rep: 60, aw: 0.4,
  staff: { doctors: 1, nurses: 2, receptionists: 1, pts: 1, rehaAides: 0 }, staffTotal: 5,
  specialty: 'orthopedics', stage: 3, depts: [], branches: 0, hospital: false, rehaLevel: 1, flags: {},
  slack: 0, trust: 0, load: 0.7, patients7: 28, newp7: 8, refer7: 4, waitAvg: 25, balked7: 0,
  monthProfit: 800000, monthRevenue: 5000000, dailyCost: 120000, runway: 12, rentDay: 25000, examMean: 6,
  relations: { hospital: 1, caremane: 1, rouken: 0, pharmacy: 0, company: 0, sports: 0, school: 0, shoutengai: 0, houkatsu: 0 }, kaitei: 0
};
const POSK = ['1番目', '中', '最後'];
const acc = { '1番目': { n: 0, free: 0, nocost: 0, yen: 0 }, '中': { n: 0, free: 0, nocost: 0, yen: 0 }, '最後': { n: 0, free: 0, nocost: 0, yen: 0 } };
for (const c of D.all()) {
  const n = c.choices.length;
  c.choices.forEach((ch, i) => {
    const fx = D.resolveFx(ch.fx, posCtx) || {};
    const a = acc[i === 0 ? '1番目' : i === n - 1 ? '最後' : '中'];
    a.n++; if (!fxBad(fx)) a.free++; if (!fxCosty(fx)) a.nocost++; a.yen += cost90(fx);
  });
}
const posTable = {};
for (const k of POSK) {
  const a = acc[k];
  posTable[k] = { 選択肢: a.n, 罰なし: `${a.free} (${(a.free / a.n * 100).toFixed(1)}%)`, 費用なし: `${a.nocost} (${(a.nocost / a.n * 100).toFixed(1)}%)`, '90日換算費用の平均': '¥' + Math.round(a.yen / a.n).toLocaleString('ja-JP') };
}
console.table(posTable);
const freeRates = POSK.map((k) => acc[k].free / acc[k].n * 100);
const spread = Math.max(...freeRates) - Math.min(...freeRates);
const yens = POSK.map((k) => acc[k].yen / acc[k].n);
console.log(`「罰なし」の割合の差 ${spread.toFixed(1)}pt(上限15pt) / 90日換算費用の最大÷最小 ${(Math.max(...yens) / Math.max(1, Math.min(...yens))).toFixed(1)}倍(目安2倍)`);

/* ---------- 眼科本院の走行(便AI-3): 固有ケースが実際に出ること ----------
 * specialty='ophthalmology'・mainEquip.surgery=true(検査設備一式も導入済み)で200日回し、
 * 眼科固有(spec:['ophthalmology'])のケースが1回以上 st.seen に載ることを「固有ケースがある」の定義とする */
const OPHTHA_EQUIP = { fundusSet: true, oct: true, field: true, surgery: true };
const ophthaRuns = seeds.map((sd) => run('random', sd, 'ophthalmology', OPHTHA_EQUIP));
const ophthaSpecIds = D.all().filter((c) => (c.spec || []).length === 1 && c.spec[0] === 'ophthalmology').map((c) => c.id);
const ophthaSeenCount = {};
for (const id of ophthaSpecIds) ophthaSeenCount[id] = ophthaRuns.reduce((a, r) => a + (r.seen[id] || 0), 0);
const ophthaTotal = Object.values(ophthaSeenCount).reduce((a, n) => a + n, 0);
console.log(`眼科本院(手術設備あり・種5×200日)の固有ケース出現回数: ${JSON.stringify(ophthaSeenCount)} / 合計${ophthaTotal}回`);

const NG = [];
if (ophthaTotal < 1) NG.push('眼科本院(手術設備あり)の200日走行で眼科固有ケースが1回も出ない');
if (dominant) NG.push(`${dominant} が4指標すべてで首位(位置だけで勝てる)`);
if (spread > 15) NG.push(`位置別の「罰なし」の割合の差が ${spread.toFixed(1)}pt(上限15pt)`);
const decidedMin = Math.min(...strategies.map((s) => table[s].decided));
if (decidedMin < 20) NG.push(`200日で判断が${decidedMin}回しか出ない`);
if (NG.length) { console.log('NG:'); for (const e of NG) console.log('  - ' + e); process.exit(1); }
console.log(`sim-decisions: OK(単一の位置で全指標は取れない・位置による費用の偏りは閾値内)${heavy.length ? ' ※注意あり' : ''}`);
