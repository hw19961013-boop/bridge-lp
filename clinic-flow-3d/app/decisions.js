/* クリニックタウン3D — 経営の分岐点(意思決定イベント)エンジン
 *
 * 役割: 「相談が届く → 状況を読む → 選択肢を比較 → 確定 → 結果 → 振り返り → 次へ」を、
 *       既存の経営状態(資金・職員数・患者数・評判・関係)に接続して回す共通基盤。
 * 原則:
 *  - UI・DOM・ゲーム大域に依存しない(Node/ブラウザ両対応。テスト可能)
 *  - 見込みと確定は同じ evaluate() から作る。乱数は (seed, ケースID, 選択肢, 日) から決定論的に作り、
 *    表示を更新しても結果が変わらない
 *  - 一時費用(money)と継続費(dailyCost=¥/日)を分ける。職員の増減は既存の職員数を変える(日給は既存の COSTS で計上)
 *  - 遅延効果は pending に予約し、期日に1回だけ適用する
 *  - 新しい概念は2つだけ: slack(職員の余力 −3〜+3)と trust(地域の信頼 −3〜+3)。意味は docs/decisions.md
 *
 * ケースのスキーマ(app/decisions/cases-*.js):
 *  { id, cat(1..10), title, tier(1..3), spec(['any'|科id]), needs{depts,branches,hospital,rehaLevel,stage,flag,notFlag},
 *    cond(ctx)=>bool, prio(ctx)=>0..3, cool(日), once, chainOnly, who(話者キー|{name,title}),
 *    say, bg, ask, facts(ctx)=>[{label,val}], choices[{id,label,note,req,fx,when,chance,reflect}], lesson, point }
 *  fx: { money, dailyCost:{yen,days,label}, staff:{k:n}, slack, trust, rep, aw, coins, rel:{key:n},
 *        newMul:{mul,days,label}, examDelta:{d,days,label}, flag, unflag, delayed:[{days,label,fx}], next:{id,days} }
 */
(function (root) {
  'use strict';

  const CATS = {
    1: '採用・人員配置・勤務体制', 2: '業務改善・役割分担・職員負担', 3: '給与・待遇・育成・定着',
    4: '営業・紹介獲得・受け入れ拡大', 5: '患者・家族対応・サービス体験', 6: '収益・固定費・資金繰り・投資',
    7: '地域連携・多職種連携・情報共有', 8: '医療安全・感染対策・災害・事業継続', 9: '設備・物品・IT・データ活用',
    10: '拠点統合・新規開設・組織変化・経営方針'
  };
  // 話者(既存の担当者キーは staff.js の STAFF と同じ。存在条件つきの話者は needs で絞る)
  const WHO = {
    doctor: { name: '剣持', title: '院長', emoji: '🧑‍⚕️' },
    nurse: { name: '榊', title: '看護師長', emoji: '👩‍⚕️' },
    front: { name: '松岡', title: '受付リーダー', emoji: '🧑‍💼' },
    billing: { name: '佐伯', title: '医事課', emoji: '🧾' },
    reha: { name: '湊', title: 'リハ・物療担当', emoji: '🏃' },
    ort: { name: '早坂', title: '視能訓練士', emoji: '👁' },
    advisor: { name: '白瀬', title: '経営アドバイザー(本部)', emoji: '📊' },
    family: { name: '患者の家族', title: '', emoji: '👨‍👩‍👧' },
    patient: { name: '患者', title: '', emoji: '🧓' },
    caremane: { name: '田島', title: 'ケアマネジャー(居宅介護支援事業所)', emoji: '🗂' },
    hospital: { name: '岡部', title: '市民総合病院 地域連携室', emoji: '🏥' },
    facility: { name: '施設の相談員', title: '介護施設', emoji: '🏘' },
    branch: { name: '分院長', title: '分院', emoji: '🏢' },
    homecare: { name: '在宅部門の看護師', title: '訪問診療', emoji: '🚗' },
    dialysis: { name: '透析室の臨床工学技士', title: '透析部門', emoji: '🩺' },
    staff: { name: 'ある職員', title: '', emoji: '🙋' },
    vendor: { name: '取引先の担当', title: '業者', emoji: '📦' },
    landlord: { name: '家主', title: 'テナント', emoji: '🏠' },
    bank: { name: '銀行の担当', title: '銀行', emoji: '🏦' },
    pharmacy: { name: '門前薬局の薬剤師', title: '薬局', emoji: '💊' },
    health: { name: '保健所の担当', title: '保健所', emoji: '🏛' }
  };

  const CASES = [];
  const BY_ID = new Map();

  function register(list) {
    for (const c of list || []) {
      if (BY_ID.has(c.id)) throw new Error(`decisions: duplicate id ${c.id}`);
      BY_ID.set(c.id, c);
      CASES.push(c);
    }
    return CASES.length;
  }
  const all = () => CASES.slice();
  const byId = (id) => BY_ID.get(id) || null;

  /* ---------- 決定論の乱数 ---------- */
  function hash32(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function rng(seedStr) {
    let a = hash32(seedStr) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- 状態 ---------- */
  function newState(seed) {
    return {
      v: 1, seed: seed || String(Date.now()),
      slack: 0, trust: 0,
      log: [],        // {n, day, id, choice, title, lines, reflect, snap}
      pending: [],    // {due, label, fx, src, n}
      mods: [],       // {kind, v, until, label, src}
      cool: {},       // id -> 次に出せる日
      seen: {},       // id -> 出た回数
      flags: {},      // 過去の判断の目印
      chainDue: [],   // {id, day, src}
      nextDay: 5,     // 次に相談を出せる日(通常枠)
      open: null,     // 開いている相談 {id, day, choice}
      count: 0
    };
  }
  function ensureState(st, seed) {
    const d = newState(seed);
    if (!st || typeof st !== 'object') return d;
    for (const k of Object.keys(d)) if (st[k] === undefined) st[k] = d[k];
    return st;
  }

  /* ---------- 発生条件 ---------- */
  function fnv(v, ctx) { return typeof v === 'function' ? v(ctx) : v; }
  function tierOf(ctx) { return ctx.day >= 45 || ctx.branches > 0 || ctx.depts.length > 0 ? 3 : ctx.day >= 20 ? 2 : 1; }

  function needsOk(c, ctx) {
    const n = c.needs || {};
    if (c.spec && !c.spec.includes('any') && !c.spec.includes(ctx.specialty)) return { ok: false, why: '本院の科が違う' };
    if (n.depts && !n.depts.every((d) => ctx.depts.includes(d))) return { ok: false, why: `部門が無い(${n.depts.join('・')})` };
    if (n.noDepts && n.noDepts.some((d) => ctx.depts.includes(d))) return { ok: false, why: '部門がある' };
    if (n.branches && ctx.branches < n.branches) return { ok: false, why: '分院が無い' };
    if (n.noBranches && ctx.branches > 0) return { ok: false, why: '分院がある' };
    if (n.hospital && !ctx.hospital) return { ok: false, why: '病院が無い' };
    if (n.rehaLevel && ctx.rehaLevel < n.rehaLevel) return { ok: false, why: 'リハの届出が無い' };
    if (n.stage && ctx.stage < n.stage) return { ok: false, why: '解放前' };
    if (n.flag && !ctx.flags[n.flag]) return { ok: false, why: `前提の判断が無い(${n.flag})` };
    if (n.notFlag && ctx.flags[n.notFlag]) return { ok: false, why: `既に判断済み(${n.notFlag})` };
    if (n.minStaff) for (const [k, v] of Object.entries(n.minStaff)) if ((ctx.staff[k] || 0) < v) return { ok: false, why: `${k} が足りない` };
    if (n.minDay && ctx.day < n.minDay) return { ok: false, why: '時期が早い' };
    // 話者の存在
    const who = typeof c.who === 'string' ? c.who : null;
    if (who === 'reha' && ctx.specialty !== 'orthopedics') return { ok: false, why: '湊は整形本院だけ' };
    if (who === 'ort' && ctx.specialty !== 'ophthalmology') return { ok: false, why: '早坂は眼科本院だけ' };
    if (who === 'branch' && ctx.branches < 1 && ctx.depts.length < 1) return { ok: false, why: '分院・部門が無い' };
    if (who === 'homecare' && !ctx.depts.includes('homecare')) return { ok: false, why: '在宅部門が無い' };
    if (who === 'dialysis' && !ctx.depts.includes('dialysis')) return { ok: false, why: '透析部門が無い' };
    return { ok: true };
  }

  function eligible(c, ctx, st, opts) {
    const o = opts || {};
    const nk = needsOk(c, ctx);
    if (!nk.ok) return nk;
    if (!o.ignoreTier && (c.tier || 1) > tierOf(ctx)) return { ok: false, why: '時期が早い(段階)' };
    if (!o.ignoreChain && c.chainOnly) return { ok: false, why: '前の判断からだけ届く' };
    if (!o.ignoreCool) {
      if (c.once && st.seen[c.id]) return { ok: false, why: '一度だけ' };
      if (st.cool[c.id] && ctx.day < st.cool[c.id]) return { ok: false, why: '再発までの期間' };
    }
    if (c.cond && !c.cond(ctx)) return { ok: false, why: '発生条件を満たさない' };
    return { ok: true };
  }

  // 次の相談を選ぶ。連続イベントの期日が来ていれば最優先。状況優先度(prio)→重み→決定論の抽選
  function pick(ctx, st) {
    const due = (st.chainDue || []).filter((x) => x.day <= ctx.day).sort((a, b) => a.day - b.day);
    for (const d of due) {
      const c = byId(d.id);
      if (c && needsOk(c, ctx).ok && (!c.cond || c.cond(ctx))) return { c, viaChain: d };
    }
    if (ctx.day < st.nextDay) return null;
    const pool = CASES.map((c) => ({ c, e: eligible(c, ctx, st) })).filter((x) => x.e.ok).map((x) => x.c);
    if (!pool.length) return null;
    const r = rng(`${st.seed}|pick|${ctx.day}`);
    const scored = pool.map((c) => {
      const p = c.prio ? Math.max(0, Math.min(3, c.prio(ctx) || 0)) : 0;
      const seenPenalty = st.seen[c.id] ? 0.35 : 1;
      return { c, w: ((c.weight || 1) + p * 2) * seenPenalty };
    });
    const maxP = Math.max(...scored.map((s) => s.w));
    // 状況優先度が高いものがあれば、その層から選ぶ(人員不足・資金不足・紹介増に応じる)
    const top0 = scored.filter((s) => s.w >= Math.max(1, maxP - 1.5));
    const top = top0.length ? top0 : scored; // 候補が全て既出(0.35)で層が空になると top[-1] を読んで落ちる(v79 qa が957日目で発見)。層が空なら全候補から選ぶ
    const tot = top.reduce((a, s) => a + s.w, 0);
    let x = r() * tot;
    for (const s of top) { x -= s.w; if (x <= 0) return { c: s.c }; }
    return { c: top[top.length - 1].c };
  }

  /* ---------- 効果の合成と評価 ---------- */
  // 効果の加算合成(数値は足す・staff/rel はキーごとに足す・delayed は連結・それ以外は上書き)
  function mergeFxSafe(a, b) {
    const o = Object.assign({}, a || {});
    if (!b) return o;
    for (const [k, v] of Object.entries(b)) {
      if (v === undefined) continue;
      if (['money', 'slack', 'trust', 'rep', 'aw', 'coins'].includes(k)) o[k] = (o[k] || 0) + v;
      else if (k === 'staff' || k === 'rel') { o[k] = Object.assign({}, o[k] || {}); for (const [kk, vv] of Object.entries(v)) o[k][kk] = (o[k][kk] || 0) + vv; }
      else if (k === 'delayed') o.delayed = (o.delayed || []).concat(v);
      else o[k] = v;
    }
    return o;
  }

  function reqCheck(ch, ctx) {
    const r = ch.req || {};
    const why = [];
    if (r.money !== undefined && ctx.money < r.money) why.push(`手元資金 ${yen(r.money)} 以上が要る(継続費の裏付け)`); // req は選べるかの門で、選んでも引かない(v77・PM判断 13x)
    if (r.staff) for (const [k, v] of Object.entries(r.staff)) if ((ctx.staff[k] || 0) < v) why.push(`${STAFF_LABEL[k] || k} ${v}人以上が要る`);
    if (r.depts && !r.depts.every((d) => ctx.depts.includes(d))) why.push('その部門が無い');
    if (r.branches && ctx.branches < r.branches) why.push('分院が無い');
    if (r.rehaLevel && ctx.rehaLevel < r.rehaLevel) why.push('リハの届出が要る');
    if (r.flag && !ctx.flags[r.flag]) why.push('前提の判断が要る');
    if (r.notFlag && ctx.flags[r.notFlag]) why.push('既に選んだ道と両立しない');
    if (r.slack !== undefined && ctx.slack < r.slack) why.push('職員の余力が足りない');
    if (r.trust !== undefined && ctx.trust < r.trust) why.push('地域の信頼が足りない');
    if (r.cond && !r.cond(ctx)) why.push(r.condWhy || '今の状況では選べない');
    return { ok: why.length === 0, why };
  }

  // 効果の中の関数(ctx依存の金額など)を、判断の時点の ctx で数値に固定する。遅延効果は後日 ctx 無しで適用するため
  function resolveFx(fx, ctx) {
    const o = Object.assign({}, fnv(fx, ctx) || {});
    if (o.delayed) o.delayed = o.delayed.map((d) => Object.assign({}, d, { fx: resolveFx(d.fx, ctx) }));
    return o;
  }

  // 見込み=確定。同じ ctx と seed なら同じ結果を返す
  function evaluate(c, ch, ctx, st) {
    const req = reqCheck(ch, ctx);
    let fx = mergeFxSafe({}, resolveFx(ch.fx, ctx));
    const why = [];
    for (const w of ch.when || []) {
      if (w.if(ctx)) { fx = mergeFxSafe(fx, resolveFx(w.fx, ctx)); if (w.why) why.push(w.why); }
    }
    let roll = null;
    if (ch.chance) {
      const p = Math.max(0, Math.min(1, fnv(ch.chance.p, ctx)));
      const r = rng(`${st.seed}|${c.id}|${ch.id}|${ctx.day}`)();
      const hit = r < p;
      roll = { p, hit, label: ch.chance.label || '', hitFx: resolveFx(ch.chance.hit, ctx), missFx: resolveFx(ch.chance.miss, ctx) };
      fx = mergeFxSafe(fx, hit ? roll.hitFx : roll.missFx);
    }
    // 人数が負にならないように丸める(医師は1人以上)
    if (fx.staff) {
      for (const [k, v] of Object.entries(fx.staff)) {
        const cur = ctx.staff[k] || 0;
        const min = k === 'doctors' ? 1 : 0;
        if (cur + v < min) fx.staff[k] = min - cur;
      }
    }
    return { caseId: c.id, choiceId: ch.id, day: ctx.day, ok: req.ok, blocked: req.why, fx, why, roll, lines: lines(fx, ctx) };
  }

  const STAFF_LABEL = { doctors: '医師', nurses: '看護師', receptionists: '受付', pts: '理学療法士', rehaAides: 'リハ助手' };
  const REL_NAMES = {}; // 営業先の表示名(game.js の REL_DEF から setRelNames で渡す)
  const REL_MAX = {};   // 営業先の関係Lvの上限(REL_DEF.max。無ければ3)
  function setRelNames(map) { for (const [k, v] of Object.entries(map || {})) REL_NAMES[k] = v; }
  function setRelMax(map) { for (const [k, v] of Object.entries(map || {})) REL_MAX[k] = v; }
  function yen(n) { const s = Math.abs(Math.round(n)).toLocaleString('ja-JP'); return (n < 0 ? '−¥' : '¥') + s; }
  function sgn(n, unit) { return (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n) + (unit || ''); }

  // 表示用の行(見込み・結果で共用)。数字は「今すぐ」「毎日」「あとで」を分けて出す
  function lines(fx, ctx, opts) {
    const L = [];
    const later = opts && opts.later; // 遅延効果の中身を出すとき(「今すぐ」と書かない)
    if (fx.money) L.push({ k: 'money', label: later ? '資金' : '資金(今すぐ)', val: yen(fx.money), neg: fx.money < 0 });
    if (fx.dailyCost && fx.dailyCost.yen) {
      const d = fx.dailyCost;
      L.push({ k: 'daily', label: d.days ? `継続費(${d.days}日間)` : '継続費(ずっと)', val: `${d.yen > 0 ? '−' : '+'}${yen(Math.abs(d.yen))}/日${d.label ? ` ${d.label}` : ''}`, neg: d.yen > 0 });
    }
    if (fx.staff) for (const [k, v] of Object.entries(fx.staff)) if (v) L.push({ k: 'staff', label: STAFF_LABEL[k] || k, val: `${sgn(v, '人')}(日給は毎日の費用に)`, neg: v < 0 });
    if (fx.slack) L.push({ k: 'slack', label: '職員の余力', val: sgn(fx.slack), neg: fx.slack < 0 });
    if (fx.trust) L.push({ k: 'trust', label: '地域の信頼', val: sgn(fx.trust), neg: fx.trust < 0 });
    if (fx.rep) L.push({ k: 'rep', label: '評判', val: sgn(Math.round(fx.rep * 10) / 10), neg: fx.rep < 0 });
    if (fx.aw) L.push({ k: 'aw', label: '認知', val: sgn(Math.round(fx.aw * 100), '%'), neg: fx.aw < 0 });
    if (fx.newMul) L.push({ k: 'new', label: `新患(${fx.newMul.days}日間)`, val: `×${fx.newMul.mul}${fx.newMul.label ? ` ${fx.newMul.label}` : ''}`, neg: fx.newMul.mul < 1 });
    if (fx.examDelta) L.push({ k: 'exam', label: `診察1人あたり(${fx.examDelta.days}日間)`, val: `${sgn(fx.examDelta.d, '分')}`, neg: fx.examDelta.d > 0 });
    if (fx.rel) for (const [k, v] of Object.entries(fx.rel)) if (v) L.push({ k: 'rel', label: `関係(${REL_NAMES[k] || k})`, val: sgn(v, 'Lv'), neg: v < 0 });
    if (fx.coins) L.push({ k: 'coins', label: 'コイン', val: sgn(fx.coins), neg: fx.coins < 0 });
    for (const d of fx.delayed || []) L.push({ k: 'later', label: `${d.days}日後`, val: d.label || summarizeFx(d.fx), sub: d.label ? summarizeFx(d.fx) : '', later: true });
    if (fx.next) L.push({ k: 'next', label: `${fx.next.days}日後`, val: '続きの相談が届く', later: true });
    return L;
  }
  function summarizeFx(fx) {
    if (!fx) return '';
    return lines(fx, null, { later: true }).map((l) => `${l.label} ${l.val}`).join('・');
  }

  /* ---------- 適用(見込みと同じ outcome を渡す) ---------- */
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function applyFx(fx, T, st, day, src) {
    const G = T.G, s = T.settings;
    const changed = [];
    if (fx.money) { G.money += fx.money; changed.push('money'); }
    if (fx.dailyCost && fx.dailyCost.yen) { st.mods.push({ kind: 'dailyCost', v: fx.dailyCost.yen, until: fx.dailyCost.days ? day + fx.dailyCost.days : null, label: fx.dailyCost.label || '', src }); changed.push('daily'); } // 負=削減
    if (fx.staff) for (const [k, v] of Object.entries(fx.staff)) { if (!v) continue; const min = k === 'doctors' ? 1 : 0; s[k] = Math.max(min, (s[k] || 0) + v); changed.push('staff'); }
    if (fx.slack) { st.slack = Math.round(clamp(st.slack + fx.slack, -3, 3) * 10) / 10; changed.push('slack'); }
    if (fx.trust) { st.trust = Math.round(clamp(st.trust + fx.trust, -3, 3) * 10) / 10; changed.push('trust'); }
    if (fx.rep) { G.rep = clamp(G.rep + fx.rep, 15, 97); changed.push('rep'); }
    if (fx.aw) { G.aw = clamp(G.aw + fx.aw, 0.05, 0.95); changed.push('aw'); }
    if (fx.coins) { G.coins = Math.max(0, (G.coins || 0) + fx.coins); changed.push('coins'); }
    if (fx.newMul) { st.mods.push({ kind: 'newMul', v: fx.newMul.mul, until: day + fx.newMul.days, label: fx.newMul.label || '', src }); changed.push('new'); }
    if (fx.examDelta) { st.mods.push({ kind: 'examDelta', v: fx.examDelta.d, until: day + fx.examDelta.days, label: fx.examDelta.label || '', src }); changed.push('exam'); }
    if (fx.rel && G.relations) for (const [k, v] of Object.entries(fx.rel)) { const r = G.relations[k]; if (r) { r.lv = clamp(r.lv + v, 0, REL_MAX[k] == null ? 3 : REL_MAX[k]); r.last = day; changed.push('rel'); } }
    if (fx.flag) st.flags[fx.flag] = day;
    if (fx.unflag) delete st.flags[fx.unflag];
    for (const d of fx.delayed || []) st.pending.push({ due: day + d.days, label: d.label || '', fx: d.fx, src, n: st.count });
    if (fx.next) st.chainDue.push({ id: fx.next.id, day: day + fx.next.days, src });
    return changed;
  }

  // 確定。outcome は evaluate() の戻り。履歴に残し、クールダウン・既出・次回日を更新
  function commit(c, ch, outcome, T, st, extra) {
    const day = outcome.day;
    st.count = (st.count || 0) + 1;
    const src = `${c.id}/${ch.id}`;
    const before = { money: T.G.money, slack: st.slack, trust: st.trust, staff: Object.assign({}, pickStaff(T.settings)) };
    applyFx(outcome.fx, T, st, day, src);
    st.seen[c.id] = (st.seen[c.id] || 0) + 1;
    st.cool[c.id] = day + (c.cool || 60);
    if (extra && extra.viaChain) st.chainDue = st.chainDue.filter((x) => x !== extra.viaChain && !(x.id === extra.viaChain.id && x.day === extra.viaChain.day));
    // 次の通常枠: 4〜7日後(決定論)。連続イベントは chainDue が別に持つ
    const gap = 4 + Math.floor(rng(`${st.seed}|gap|${day}`)() * 4);
    st.nextDay = Math.max(st.nextDay || 0, day + gap);
    const entry = {
      n: st.count, day, id: c.id, choice: ch.id, title: c.title, choiceLabel: ch.label,
      lines: outcome.lines, roll: outcome.roll ? { p: outcome.roll.p, hit: outcome.roll.hit, label: outcome.roll.label } : null,
      why: outcome.why, snap: extra && extra.snap ? extra.snap : null,
      after: { money: T.G.money, slack: st.slack, trust: st.trust }, before
    };
    st.log.push(entry);
    if (st.log.length > 60) st.log.shift();
    st.open = null;
    return entry;
  }
  function pickStaff(s) { return { doctors: s.doctors, nurses: s.nurses, receptionists: s.receptionists, pts: s.pts, rehaAides: s.rehaAides || 0 }; }

  // 1日の締めで呼ぶ: 期日の来た遅延効果を1回だけ適用し、期限切れの継続効果を外す。戻り=適用した遅延効果の一覧
  function tick(T, st, day) {
    const fired = [];
    const keep = [];
    for (const p of st.pending) {
      if (p.due <= day) { applyFx(p.fx || {}, T, st, day, p.src); fired.push(p); } else keep.push(p);
    }
    st.pending = keep;
    st.mods = st.mods.filter((m) => m.until === null || m.until === undefined || m.until > day);
    return fired;
  }

  /* ---------- 経済への接続(game.js から毎日読む) ---------- */
  function dailyCost(st, day) { return (st.mods || []).filter((m) => m.kind === 'dailyCost' && (m.until == null || m.until > day)).reduce((a, m) => a + m.v, 0); }
  function newMul(st, day) {
    let m = 1;
    for (const x of st.mods || []) if (x.kind === 'newMul' && (x.until == null || x.until > day)) m *= x.v;
    // 地域の信頼: ±2%/段(紹介と口コミの向き)
    m *= 1 + 0.02 * (st.trust || 0);
    return m;
  }
  function examDelta(st, day) {
    let d = 0;
    for (const x of st.mods || []) if (x.kind === 'examDelta' && (x.until == null || x.until > day)) d += x.v;
    // 職員の余力: 余力が無いほど1人あたりの診察が延びる(−1段=+0.3分)。余力があれば少し短い
    d += -0.3 * (st.slack || 0);
    return d;
  }
  // 地域の信頼による紹介(人/日の期待値)。正のときだけ
  function trustReferrals(st) { return Math.max(0, 0.3 * (st.trust || 0)); }

  /* ---------- 振り返り ---------- */
  function reflect(c, ch, outcome, ctx) {
    const parts = [];
    if (ch.reflect) parts.push(typeof ch.reflect === 'function' ? ch.reflect(ctx, outcome) : ch.reflect);
    if (outcome.roll) parts.push(outcome.roll.hit ? `${outcome.roll.label || '想定した結果'}になった(確率${Math.round(outcome.roll.p * 100)}%)` : `${outcome.roll.label || '想定した結果'}にはならなかった(確率${Math.round(outcome.roll.p * 100)}%の側が出なかった)`);
    for (const w of outcome.why || []) parts.push(w);
    if (c.lesson) parts.push(c.lesson);
    return parts.filter(Boolean);
  }

  /* ---------- 検証(テスト・scripts/check-decisions.mjs から) ---------- */
  function validate(list) {
    const errs = [];
    const ids = new Set();
    const cats = {};
    for (const c of list) {
      const at = `[${c.id || '?'}]`;
      if (!c.id || typeof c.id !== 'string') errs.push(`${at} id が無い`);
      if (ids.has(c.id)) errs.push(`${at} id 重複`);
      ids.add(c.id);
      if (!CATS[c.cat]) errs.push(`${at} cat が 1..10 でない`);
      cats[c.cat] = (cats[c.cat] || 0) + 1;
      if (!c.title) errs.push(`${at} title が無い`);
      if (![1, 2, 3].includes(c.tier)) errs.push(`${at} tier が 1..3 でない`);
      if (!Array.isArray(c.spec) || !c.spec.length) errs.push(`${at} spec が無い`);
      if (!c.who || (typeof c.who === 'string' && !WHO[c.who])) errs.push(`${at} who が不明`);
      if (!c.say) errs.push(`${at} say が無い`);
      if (!c.bg) errs.push(`${at} bg が無い`);
      if (!c.ask) errs.push(`${at} ask が無い`);
      if (!c.point) errs.push(`${at} point(論点) が無い`);
      if (!Array.isArray(c.choices) || c.choices.length < 3) errs.push(`${at} 選択肢が3つ未満`);
      const cids = new Set();
      for (const ch of c.choices || []) {
        if (!ch.id || cids.has(ch.id)) errs.push(`${at} 選択肢id が無いか重複(${ch.id})`);
        cids.add(ch.id);
        if (!ch.label) errs.push(`${at}/${ch.id} label が無い`);
        if (!ch.fx && !ch.when && !ch.chance) errs.push(`${at}/${ch.id} 効果が無い`);
        const nx = ch.fx && typeof ch.fx !== 'function' && ch.fx.next;
        if (nx && !ids.has(nx.id) && !list.some((x) => x.id === nx.id)) errs.push(`${at}/${ch.id} next の参照先が無い(${nx.id})`);
        for (const d of (ch.fx && typeof ch.fx !== 'function' && ch.fx.delayed) || []) if (!d.days || !d.fx) errs.push(`${at}/${ch.id} delayed に days/fx が無い`);
        if (/!/.test(ch.label)) errs.push(`${at}/${ch.id} label に「!」`);
      }
      if (/[。!]/.test(c.title || '')) errs.push(`${at} title に句点/「!」(見出しに句点を付けない=第19条)`);
      if (c.chainOnly && !list.some((x) => (x.choices || []).some((ch) => ch.fx && typeof ch.fx !== 'function' && ch.fx.next && ch.fx.next.id === c.id))) errs.push(`${at} chainOnly だが誰からも参照されない`);
    }
    return { errs, count: list.length, cats };
  }

  const DECISIONS = {
    resolveFx, setRelNames, setRelMax,
    CATS, WHO, register, all, byId, newState, ensureState, tierOf, needsOk, eligible, pick, evaluate, reqCheck, applyFx, commit, tick,
    dailyCost, newMul, examDelta, trustReferrals, reflect, lines, summarizeFx, validate, rng, hash32, yen, STAFF_LABEL
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = DECISIONS;
  else root.DECISIONS = DECISIONS;
})(typeof self !== 'undefined' ? self : this);
