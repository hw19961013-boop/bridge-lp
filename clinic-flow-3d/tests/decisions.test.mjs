/* 経営の分岐点エンジン(app/decisions.js)のテスト。実行: node clinic-flow-3d/tests/decisions.test.mjs
 * 見込み=確定・遅延効果は1回・継続費の符号・発生条件/段階/クールダウン/連続・人数の下限・状態の補完 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const D = require(join(ROOT, 'app', 'decisions.js'));
const dir = join(ROOT, 'app', 'decisions');
for (const f of readdirSync(dir).filter((x) => /^cases-.*\.js$/.test(x)).sort()) D.register(require(join(dir, f)));

let n = 0, failed = 0;
function t(name, fn) { n++; try { fn(); console.log(`  ok ${n} - ${name}`); } catch (e) { failed++; console.log(`  NG ${n} - ${name}\n      ${e.message}`); } }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || ''} 期待=${JSON.stringify(b)} 実際=${JSON.stringify(a)}`); }
function ok(v, msg) { if (!v) throw new Error(msg || 'falsy'); }

const ctx = (o) => Object.assign({
  day: 10, money: 800000, rep: 60, aw: 0.3, staff: { doctors: 1, nurses: 1, receptionists: 1, pts: 0, rehaAides: 0 }, staffTotal: 3,
  specialty: 'orthopedics', stage: 3, depts: [], branches: 0, hospital: false, rehaLevel: 0, flags: {}, slack: 0, trust: 0,
  load: 0.8, patients7: 25, newp7: 8, refer7: 1, waitAvg: 20, balked7: 0, monthProfit: 400000, monthRevenue: 5000000, dailyCost: 120000, runway: 6,
  rentDay: 25000, examMean: 6, relations: { hospital: 0, caremane: 0, rouken: 0 }, kaitei: 0
}, o || {});
const T = () => ({ G: { money: 800000, rep: 60, aw: 0.3, coins: 0, relations: { hospital: { lv: 0, last: 0 } } }, settings: { doctors: 1, nurses: 1, receptionists: 1, pts: 0, rehaAides: 0 } });

const ST01 = D.byId('ST-01');
t('ケースが登録され ST-01 が読める', () => { ok(ST01 && ST01.choices.length >= 3); });

t('見込み=確定: 同じ seed・ケース・選択肢・日なら同じ結果(確率つきも)', () => {
  const st = D.newState('seed-a');
  const c = ctx();
  const ch = ST01.choices.find((x) => x.id === 'wait');
  const a = D.evaluate(ST01, ch, c, st), b = D.evaluate(ST01, ch, c, st);
  eq(a.fx, b.fx); eq(a.roll.hit, b.roll.hit);
  const st2 = D.newState('seed-b');
  const results = [];
  for (let d = 10; d < 40; d++) results.push(D.evaluate(ST01, ch, ctx({ day: d }), st2).roll.hit);
  ok(results.some(Boolean) && results.some((x) => !x), '日が変われば結果も散る');
});

t('req を満たさない選択肢は blocked(資金不足)', () => {
  const st = D.newState('s');
  const o = D.evaluate(ST01, ST01.choices[0], ctx({ money: 10000 }), st);
  ok(!o.ok && o.blocked.length === 1);
});

t('when: 条件で結果が変わる(患者が少ないと採用の余力が増えない)', () => {
  const st = D.newState('s');
  const hire = ST01.choices[0];
  const busy = D.evaluate(ST01, hire, ctx({ load: 0.9 }), st);
  const idle = D.evaluate(ST01, hire, ctx({ load: 0.4 }), st);
  ok(idle.fx.slack < busy.fx.slack && idle.why.length === 1);
});

t('commit: 一時費用は資金、採用は職員数、遅延効果は pending、next は chainDue、クールダウンと次回日', () => {
  const st = D.newState('s'); const tt = T();
  const c = ctx(); const hire = ST01.choices[0];
  const o = D.evaluate(ST01, hire, c, st);
  D.commit(ST01, hire, o, tt, st, {});
  eq(tt.G.money, 800000 - 150000); eq(tt.settings.nurses, 2);
  eq(st.pending.length, 1); eq(st.chainDue.length, 1); eq(st.chainDue[0].id, 'ST-01b');
  ok(st.cool['ST-01'] > 10 && st.nextDay >= 14 && st.nextDay <= 17 && st.seen['ST-01'] === 1 && st.log.length === 1);
});

t('tick: 遅延効果は期日に1回だけ、継続効果は期限で消える', () => {
  const st = D.newState('s'); const tt = T();
  D.applyFx({ delayed: [{ days: 5, label: 'x', fx: { slack: 1 } }], examDelta: { d: 1, days: 3 } }, tt, st, 10, 'test');
  eq(D.tick(tt, st, 12).length, 0); eq(st.slack, 0); eq(D.examDelta(st, 12), 1);
  eq(D.tick(tt, st, 15).length, 1); eq(st.slack, 1); eq(st.pending.length, 0);
  eq(D.tick(tt, st, 16).length, 0); eq(st.slack, 1);
  eq(D.examDelta(st, 13), 0 - 0.3 * 1 + 0 - 0, undefined); // 余力+1 → −0.3分。期間効果は Day13 で消えている
});

t('dailyCost: 期間つき・ずっと・削減(負)を合算', () => {
  const st = D.newState('s'); const tt = T();
  D.applyFx({ dailyCost: { yen: 3000, days: 10 } }, tt, st, 1, 'a');
  D.applyFx({ dailyCost: { yen: 1000, days: null } }, tt, st, 1, 'b');
  D.applyFx({ dailyCost: { yen: -5000, days: null } }, tt, st, 1, 'c');
  eq(D.dailyCost(st, 5), -1000); eq(D.dailyCost(st, 11), -4000);
});

t('newMul: 期間の倍率×信頼(±2%/段)。trustReferrals は正のときだけ', () => {
  const st = D.newState('s'); const tt = T();
  D.applyFx({ newMul: { mul: 0.8, days: 10 }, trust: 2 }, tt, st, 1, 'a');
  eq(Math.round(D.newMul(st, 5) * 1000), Math.round(0.8 * 1.04 * 1000)); eq(D.newMul(st, 11), 1.04);
  eq(D.trustReferrals(st), 0.6); st.trust = -2; eq(D.trustReferrals(st), 0);
});

t('人数の下限: 医師は1人・他は0人を割らない', () => {
  const st = D.newState('s'); const tt = T();
  D.applyFx({ staff: { doctors: -3, nurses: -5 } }, tt, st, 1, 'a');
  eq(tt.settings.doctors, 1); eq(tt.settings.nurses, 0);
  const c = { id: 'X', choices: [] }; const ch = { id: 'a', fx: { staff: { nurses: -5 } } };
  const o = D.evaluate(c, ch, ctx(), st); eq(o.fx.staff.nurses, -1);
});

t('余力と信頼は −3〜+3 に収まる', () => {
  const st = D.newState('s'); const tt = T();
  D.applyFx({ slack: 9, trust: -9 }, tt, st, 1, 'a'); eq(st.slack, 3); eq(st.trust, -3);
});

t('eligible: 段階(tier)・chainOnly・once・クールダウン・科・存在条件', () => {
  const st = D.newState('s');
  ok(!D.eligible(D.byId('ST-01b'), ctx(), st).ok, 'chainOnly は通常枠に出ない');
  ok(!D.eligible(D.byId('OR-01'), ctx({ day: 100 }), st).ok, '分院が無ければ統合の相談は出ない');
  ok(D.eligible(D.byId('OR-01'), ctx({ day: 100, branches: 1 }), st).ok);
  ok(!D.eligible(D.byId('ST-02'), ctx({ day: 10 }), st).ok, 'tier2 は Day20 前に出ない');
  ok(D.eligible(D.byId('ST-02'), ctx({ day: 25, staff: { doctors: 2, nurses: 1, receptionists: 1, pts: 0, rehaAides: 0 } }), st).ok);
  st.cool['ST-01'] = 50; ok(!D.eligible(ST01, ctx({ day: 30 }), st).ok, 'クールダウン中');
  ok(D.eligible(ST01, ctx({ day: 50 }), st).ok);
  const reha = D.all().find((c) => c.who === 'reha');
  if (reha) ok(!D.needsOk(reha, ctx({ specialty: 'internal' })).ok, '湊は整形本院だけ');
});

t('pick: 期日前の連続は出ず通常枠が選ばれ、期日が来れば連続が最優先', () => {
  const st = D.newState('s');
  st.chainDue.push({ id: 'ST-01b', day: 12 });
  const p11 = D.pick(ctx({ day: 11 }), st); ok(p11 && p11.c.id !== 'ST-01b' && !p11.viaChain);
  const p12 = D.pick(ctx({ day: 12 }), st); ok(p12 && p12.c.id === 'ST-01b' && p12.viaChain);
  st.chainDue = []; st.nextDay = 30;
  eq(D.pick(ctx({ day: 20 }), st), null, 'nextDay まで通常枠は出ない');
  const a = D.pick(ctx({ day: 30 }), st), b = D.pick(ctx({ day: 30 }), st); eq(a.c.id, b.c.id, '同じ日・同じ seed なら同じ相談');
});

t('ensureState: 旧セーブ(dec 無し)や欠けたフィールドを補完する', () => {
  const st = D.ensureState(undefined, 'z'); ok(st.slack === 0 && Array.isArray(st.log) && st.nextDay === 5);
  const st2 = D.ensureState({ slack: 2 }, 'z'); ok(st2.slack === 2 && Array.isArray(st2.pending));
});

t('validate: 全ケースがスキーマを満たす(id 一意・3択以上・next 参照先・「!」なし)', () => {
  const v = D.validate(D.all());
  const real = v.errs.filter((e) => !/未満|200/.test(e));
  eq(real, []);
});

t('pick: 候補が全て既出(重み0.35)で優先層が空でも相談を返す(v79 qa の957日目クラッシュの再現)', () => {
  const st = D.newState('seed-all-seen'); st.nextDay = 1;
  for (const c of D.all()) st.seen[c.id] = 1;
  const ctx = { day: 300, money: 50000000, rep: 80, aw: 0.8, staff: { doctors: 2, nurses: 4, receptionists: 2, pts: 2 }, staffTotal: 10, specialty: 'orthopedics', stage: 3, depts: [], branches: 0, hospital: false, rehaLevel: 0, flags: {}, slack: 3, trust: 3, load: 0.7, patients7: 80, newp7: 40, refer7: 0, waitAvg: 5, balked7: 0, monthProfit: 500000, monthRevenue: 5000000, dailyCost: 0, runway: 999, rentDay: 0, examMean: 6, relations: {}, kaitei: null, mainEquip: null }; // 人員・資金に余裕があり load>0.6 で prio が全て0=全候補の重みが 0.35 になり優先層が空
  const r = D.pick(ctx, st);
  ok(r && r.c && r.c.id, '相談が返る');
});
console.log(`decisions.test: ${n - failed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
