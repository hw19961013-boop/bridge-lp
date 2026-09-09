/* クリニックタウン3D — 経済モデル・法人経営・KPI・ミッション・UI統合
 * 教育の核:
 *   売上 = 患者数 × 診療単価
 *   患者数 = 新患(認知 × 評判 × 競合 × 紹介) + 再診(治療計画 × 患者体験)
 *   単価 = 診療の中身(初再診・注射・処置・物療・画像・リハ単位・自費)
 *   利益 = 売上 − 固定費 − 変動費 − 広告費 − 金利
 */

'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  const yen = (n) => `¥${Math.round(n).toLocaleString()}`;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // 期待値xを整数化(端数は確率で切り上げ)
  const frac = (x) => Math.floor(x) + (Math.random() < x % 1 ? 1 : 0);

  /* ================= 効果音(WebAudio合成・ミュート可) ================= */

  const SND = (() => {
    let ctx = null;
    function ac() {
      if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; } }
      return ctx;
    }
    document.addEventListener('pointerdown', () => { const c = ac(); if (c && c.state === 'suspended') c.resume(); });
    function tone(freq, dur, type, gain, delay) {
      if (!G.sound) return;
      const c = ac();
      if (!c || c.state === 'suspended') return;
      const t0 = c.currentTime + (delay || 0);
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(gain || 0.04, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(c.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    }
    return {
      cash() { tone(880, 0.09, 'triangle', 0.028); tone(1318, 0.12, 'triangle', 0.022, 0.05); },
      coin() { tone(988, 0.07, 'triangle', 0.05); tone(1480, 0.09, 'triangle', 0.045, 0.06); tone(1976, 0.16, 'triangle', 0.04, 0.12); },
      fanfare() {
        [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.055, i * 0.09));
        [523, 659, 784].forEach((f) => tone(f, 0.5, 'triangle', 0.035, 0.42));
      },
      day() { tone(392, 0.22, 'sine', 0.045); tone(523, 0.3, 'sine', 0.04, 0.12); },
      click() { tone(520, 0.05, 'square', 0.02); },
      buzz() { tone(196, 0.18, 'square', 0.03); },
      step() { tone(95 + Math.random() * 45, 0.045, 'triangle', 0.014); },
      // 🌧 環境音: フィルタ済みノイズのループ(雨・雪の風)
      ambience(kind) {
        if (this._amb && this._ambKind === kind) return;
        this.ambOff();
        if (!kind || !G.sound) return;
        const c = ac();
        if (!c || c.state === 'suspended') return;
        try {
          const len = c.sampleRate * 2;
          const buf = c.createBuffer(1, len, c.sampleRate);
          const d = buf.getChannelData(0);
          for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
          const src2 = c.createBufferSource();
          src2.buffer = buf;
          src2.loop = true;
          const filt = c.createBiquadFilter();
          filt.type = 'lowpass';
          filt.frequency.value = kind === 'rain' ? 900 : 420;
          const g = c.createGain();
          g.gain.value = kind === 'rain' ? 0.014 : 0.008;
          src2.connect(filt).connect(g).connect(c.destination);
          src2.start();
          this._amb = { src: src2, g };
          this._ambKind = kind;
        } catch (e) { /* noop */ }
      },
      ambOff() {
        if (this._amb) { try { this._amb.src.stop(); } catch (e) { /* noop */ } this._amb = null; this._ambKind = null; }
      }
    };
  })();

  /* ================= シェア(スコア自慢) ================= */

  function shareScore(text) {
    const payload = `${text}\n#クリニックタウン3D ${location.href}`;
    if (navigator.share) {
      navigator.share({ title: 'クリニックタウン3D', text: payload }).catch(() => {});
      return;
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = payload;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast('📋 コピーしました。SNSに貼り付けて自慢してください');
    } catch (e) { toast('コピーに失敗しました'); }
  }
  function shareBtnHtml() { return `<button class="btn-cta ghost share-btn" id="shareBtn">📤 スコアを自慢する</button>`; }
  function bindShare(text) {
    const b = $('shareBtn');
    if (b) b.addEventListener('click', () => shareScore(text));
  }

  /* ================= 定数 ================= */

  const RIVAL_REP = 65;
  // ライバルも成長する(難易度): 本院の競合評判は日数で上がる(上限+10)
  function rivalRepNow() { return RIVAL_REP + Math.min(10, G.day * 0.02); }
  const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'];
  const DAY_SPECS = {
    full: { label: '終日', min: 480, intake: 420, pay: 1, arr: 1 },
    am: { label: '午前', min: 240, intake: 200, pay: 0.6, arr: 0.55 },
    closed: { label: '休診', min: 0, intake: 0, pay: 0, arr: 0 }
  };

  // 実態準拠の算定構造(1点=10円)。KB読込時は下のKBIブロックが上書きする —
  // ここの値はKB未読込時のフォールバックで、令和8年度KBの合算値に揃えてある(便I掃除。
  // xray=写真診断43+撮影68+電子画像管理57、mri=撮影1330+断層診断450+電子画像管理120)。
  // 「何もしない再診」には外来管理加算が付く
  const FEES = {
    first: 2910, revisit: 760, kanri: 520, presc: 600, rehab: 900, checkup: 8000,
    treat: 1500, inj: 1800, trig: 1200, physio: 350, xray: 1680, mri: 19000,
    osteo: 3800, goods: 3500, goodsCogs: 2100, prpCogs: 12000
  };
  const SEG_NAMES = { senior: '高齢者', worker: '勤労者', sports: 'スポーツ' };
  // 運動器リハ: 1回=2単位で計算。(III)85点/(II)170点/(I)185点 ×2単位×10円
  const REHA_FEE = [0, 1700, 3400, 3700];
  // 名称は正式名称ベース(社長決定 2026-09-05)。A層=初めて名指しする場所(施設基準カードの行名・届出/要件割れのトースト・レセプト行)は REHA_FULL、
  // B層=同じ画面に正式名称が一度出ている狭い場所(バッジ・P&L・分院一覧)は通用略称 REHA_NAMES(KBの shortName と同じ形・社長決定 2026-09-06「3.残す」)
  const REHA_NAMES = ['未届出', '運動器リハ(III)', '運動器リハ(II)', '運動器リハ(I)'];
  const REHA_FULL = ['未届出', '運動器リハビリテーション料(III)', '運動器リハビリテーション料(II)', '運動器リハビリテーション料(I)'];

  const KIJUN = [
    { lv: 1, name: REHA_FULL[1], fee: REHA_FEE[1], reqText: '専従の理学療法士等 1名以上', ok: (pts, fl) => pts >= 1 },
    { lv: 2, name: REHA_FULL[2], fee: REHA_FEE[2], reqText: '専従の常勤PT 2名以上・45㎡以上', ok: (pts, fl) => pts >= 2 },
    { lv: 3, name: REHA_FULL[3], fee: REHA_FEE[3], reqText: '専従の常勤PT 4名以上・100㎡以上(要増築)', ok: (pts, fl) => pts >= 4 && fl >= 2 }
  ];

  /* ===== 診療報酬KB統合(令和8年度・一次資料照合済み) =====
     点数の唯一の情報源はKBゲームパック(data/kb-r08.js)。中核項目(初再診・
     外来管理加算・疾患別リハ・処方箋料・単純X線)はKB点数に同期し、
     算定可否は診療報酬エンジン(app/reimbursement.js)が判定する。
     KBが読めない環境でも従来の概算でゲームは止まらない(フォールバック)。 */
  const KBI = (() => {
    try {
      if (typeof REIMB !== 'undefined' && typeof KB_R08 !== 'undefined') { REIMB.init(KB_R08); return true; }
    } catch (e) { /* noop */ }
    return false;
  })();
  const kbPts = (id, fb) => { const p = KBI ? REIMB.pointsOf(id) : null; return p != null ? p : fb; };
  const kbName = (id, fb) => { const it = KBI ? REIMB.getItem(id) : null; return (it && it.name) || fb; };
  // ゲームのリハ届出レベル(1=III,2=II,3=I) → KBの項目/施設基準ID
  const REHA_KB_ITEM = { 1: 'r08-H002-3', 2: 'r08-H002-2', 3: 'r08-H002-1' };
  const REHA_KB_FS = { 1: 'r08-fs-h002-3', 2: 'r08-fs-h002-2', 3: 'r08-fs-h002-1' };
  if (KBI) {
    FEES.first = kbPts('r08-A000', 291) * 10;
    FEES.revisit = kbPts('r08-A001', 76) * 10;
    FEES.kanri = kbPts('r08-A001-n8', 52) * 10;
    FEES.presc = kbPts('r08-F400-3', 60) * 10;
    // 単純X線はフィルムレス運用の前提で電子画像管理加算(通則4-イ)まで一式(便H)
    FEES.xray = (kbPts('r08-E001-1-ro', 43) + kbPts('r08-E002-1-ro', 68) + kbPts('r08-E-denshi-tanjun', 57)) * 10;
    // MRIは撮影(E202-2)+断層診断(E203)+電子画像管理加算(通則3)の一式(便H)。
    // E203は月1回・CT/MRI通則2の同月2回目以降逓減は、初診・紹介時の精査のみ発行する設計で回避(rule-0014)
    FEES.mri = (kbPts('r08-E202-2', 1330) + kbPts('r08-E203', 450) + kbPts('r08-E-denshi-ct', 120)) * 10;
    for (const lv of [1, 2, 3]) REHA_FEE[lv] = kbPts(REHA_KB_ITEM[lv], [0, 85, 170, 185][lv]) * 2 * 10;
    KIJUN.forEach((k) => { k.fee = REHA_FEE[k.lv]; });
  }
  // 整形の手技も薬剤もKB点数(便M・v47で薬価レイヤー確立)。
  // inj=アルツ関節注キット1筒(G100算式66点)・trig=キシロカイン1%5mL(L200算式5点)・
  // block=同10mL(11点)。使用量はゲーム上の仮定(KB項目に明記)。
  // フォールバック値はKB整合(v46方針)。旧概算(100/50/50)は薬価より大きく、置換で単価が下がる
  const DRUG_PTS = { inj: 66, trig: 5, block: 11 };
  const DRUG_KB = { inj: 'r08-y620004641', trig: 'r08-y641210099-5ml', block: 'r08-y641210099-10ml' };
  if (KBI) for (const k of Object.keys(DRUG_KB)) DRUG_PTS[k] = kbPts(DRUG_KB[k], DRUG_PTS[k]);
  // 部門エンジン(患者パネル型): KBと同時に初期化できたときだけ部門を動かす
  const DEPTI = (() => {
    try {
      if (KBI && typeof DEPT !== 'undefined') { DEPT.init(REIMB, KB_R08); return true; }
    } catch (e) { /* noop */ }
    return false;
  })();
  // 現在適用中の施設基準ID群(エンジンへ渡す)
  function activeFsIds() {
    if (settings.specialty !== 'orthopedics') return (settings.mainFs || []).slice(); // 他科本院(v67)。会計は evalVisit が shim.fs を渡すのでここは説明の対称性
    const ids = [];
    if (settings.rehaLevel > 0) ids.push(REHA_KB_FS[settings.rehaLevel]);
    return ids;
  }

  const COSTS = {
    doctorDay: 80000, nurseDay: 18000, ptDay: 16000, recepDay: 10000,
    rent: [0, 25000, 55000, 120000], base: [0, 8000, 14000, 30000],
    perPatient: 300, billboardDay: 3000, mriMaint: 12000,
    branchRent: 35000, branchBase: 6000
  };

  const SHOP = {
    doctor:  { label: '医師を採用', costs: [0, 500000, 800000, 1200000, 2000000, 3000000], day: COSTS.doctorDay, hint: '診察室+1・日給¥80,000(採用費は逓増)' },
    nurse:   { label: '看護師を採用', costs: [120000, 120000, 150000, 180000, 220000, 260000], day: COSTS.nurseDay, hint: '処置ベッド稼働=看護師数・日給¥18,000' },
    pt:      { label: 'PTを採用', costs: [150000, 150000, 180000, 180000, 220000, 220000, 250000, 250000, 300000, 300000, 350000, 350000, 400000, 400000, 450000, 450000, 500000, 550000, 600000, 650000], day: COSTS.ptDay, hint: '施設基準の専従要件・日給¥16,000' },
    recep:   { label: '受付を増員', costs: [60000, 60000, 80000, 100000], day: COSTS.recepDay, hint: '受付窓口+1・日給¥10,000' },
    chairs:  { label: '待合椅子を+2脚', costs: null, flat: 40000, step: 2, hint: '' },
    beds:    { label: '処置ベッドを増設', costs: null, flat: 150000, hint: '処置1件+¥1,500・看護師とセット' },
    machines:{ label: 'リハ機器を増設', costs: null, flat: 300000, hint: 'リハ稼働=min(機器, PT×2+助手)・面積要件は増築' },
    physio:  { label: '物療機器を増設', costs: null, flat: 80000, hint: '消炎鎮痛等処置1件¥350・PT不要・1台35件/日' },
    rehaAide:{ label: 'リハ助手を採用', costs: [80000, 80000, 90000, 90000, 100000, 100000, 110000, 110000], day: 10000, hint: 'PT単位上限+4/人・機器稼働+1・日給¥10,000' }
  };

  const EXPAND_COST = 5000000;
  const EXPAND2_COST = 20000000;
  const MRI_COST = 18000000;
  const DEXA_COST = 2500000;
  const ECHO_COST = 2500000;
  // グループ病院(回復期リハ病棟を核とした地域の受け皿)
  const HOSP_BUILD_COST = 200000000;
  const HOSP_EXPAND_COST = 150000000;
  const HOSP_NAIKA_COST = 30000000;
  const HOSP_OPE_COST = 50000000;
  const WARD_FEE = 22290; // 回復期リハビリテーション病棟入院料1: 2,229点/日
  const PRP_CERT_COST = 500000;

  const KEYWORDS = [
    { id: 'area', name: '「◯◯町 整形外科」', cpc: 400, cvr: 0.10, vol: 40, source: 'house', hint: 'CV率10%・検索数に上限' },
    { id: 'pain', name: '「腰痛・膝の痛み」', cpc: 150, cvr: 0.035, vol: 120, source: 'house', hint: 'CV率3.5%・検索数は多い' },
    { id: 'sports', name: '「スポーツ整形」', cpc: 250, cvr: 0.06, vol: 30, source: 'station', reha: true, hint: 'CV率6%・単価とLTVが高い' }
  ];

  // 営業先(関係レベル 0〜max)。30日訪問しないと関係が1つ冷める
  const REL_DEF = {
    hospital: { name: '市民総合病院', cost: 50000, max: 3, effect: '紹介患者 +Lv人/日(処置・リハ率高)', desc: '地域連携室との関係。退院後の受け皿になる。' },
    caremane: { name: 'ケアマネ事業所', cost: 20000, max: 3, needsReha: true, effect: 'リハ紹介 +Lv×0.7人/日', desc: '担当者会議に顔を出し、空き状況を共有する。' },
    rouken: { name: '老健施設', cost: 30000, max: 3, needsReha: true, effect: 'リハ紹介 +Lv×0.7人/日', desc: '退所後の外来リハの受け皿として連携する。' },
    company: { name: '運送会社', cost: 30000, max: 2, effect: '健診 +Lv×1.5件/日', desc: '従業員の定期健診・腰痛対策セミナー。' },
    sports: { name: 'スポーツクラブ', cost: 30000, max: 3, effect: 'スポーツ外傷の新患 +Lv×0.6人/日・PRP需要UP', desc: 'トレーナーと提携し、外傷・障害の受け皿になる。' },
    school: { name: '高校(部活動)', cost: 25000, max: 2, effect: '部活外傷の新患 +Lv×0.5人/日', desc: '部活動の外傷対応・メディカルチェックで信頼を作る。' },
    shoutengai: { name: '商店街組合', cost: 40000, max: 3, effect: '訪問ごとに認知+1.2%・評判+0.5', desc: '祭りへの協賛・健康相談ブース。地域の顔になる。' },
    pharmacy: { name: '薬局(門前)', cost: 15000, max: 3, effect: '再診の定着 +2%/Lv(通いやすさ)', desc: '疑義照会・在庫連携・お薬手帳。院と薬局が繋がっている安心感は再診の定着に効く。' },
    houkatsu: { name: '地域包括支援センター', cost: 20000, max: 3, effect: '高齢の新患 +Lv×0.5人/日', desc: '介護予防教室・転倒予防の講師。地域の高齢者との接点を作る。' }
  };

  const SITES = [
    { id: 'kita', name: '北口クリニック', cost: 8000000, rivalRep: 62, bigger: 1.0, rehaBias: 1.0, desc: '駅の北側の住宅エリア。手堅い商圏。' },
    { id: 'minami', name: '南町クリニック', cost: 9000000, rivalRep: 60, bigger: 0.95, rehaBias: 1.35, desc: '高齢者が多くリハ需要が高い。PTを厚く。' },
    { id: 'tonari', name: '隣駅クリニック', cost: 12000000, rivalRep: 70, bigger: 1.4, rehaBias: 1.0, desc: '商圏は大きいが競合も強い。評判勝負。' }
  ];

  /* ================= 🏆 地域リーグ(町→市→県→地方→全国) ================= */
  // 架空のNPC医療法人。目標は法人月商(直近30日)。ライバルの月商も日々成長する
  const LEAGUE = [
    { name: 'ひまわりクリニック', tier: '町', rev: 8000000 }, // ライバル名は科に依らない(v73 便AF)
    { name: '中央クリニック', tier: '市', rev: 15000000 },
    { name: 'みなとクリニック', tier: '市', rev: 25000000 },
    { name: '医療法人 桜台会', tier: '市', rev: 40000000, title: '🥇 市でいちばんの{科名}グループ', reward: 2000000, coin: 5 },
    { name: '大和田医療グループ', tier: '県', rev: 60000000 },
    { name: '医療法人 青葉会', tier: '県', rev: 90000000 },
    { name: '医療法人 白鳳会', tier: '県', rev: 130000000, title: '🏅 県でいちばんの医療法人', reward: 5000000, coin: 8 },
    { name: '広域医療 コスモス会', tier: '地方', rev: 180000000 },
    { name: '医療法人 大樹会', tier: '地方', rev: 250000000, title: '👑 地方でいちばんの医療グループ', reward: 10000000, coin: 12 },
    { name: '全国チェーン アルカ会', tier: '全国', rev: 350000000, title: '🌟 全国いちばんの医療法人', reward: 30000000, coin: 20 }
  ];
  function leagueRev(i) { return Math.round(LEAGUE[i].rev * (1 + G.day * 0.0006)); }

  const MISSIONS = [
    { id: 'firstday', title: '初日の診療を完了する', reward: 50000,
      lesson: 'このゲームの回し方: ①1日進める → ②結果を見る → ③スタッフの声を聞く → ④1つ改善する。この繰り返しで数字は必ず動く。' },
    { id: 'wait40', title: '平均待ち時間40分未満の日をつくる(来院8人以上)', reward: 50000,
      lesson: '待ち時間は最大の離反要因。医療の質は見えにくいが、待ち時間は誰にでも見える。詰まりは受付か診察か — 1か所ずつ潰す。' },
    { id: 'rev50k', title: '1日の売上¥50,000を超える', reward: 50000,
      lesson: 'いちばん大事な式: 売上 = 患者数 × 単価。すべての打ち手はどちらか(または両方)を動かす。「今日の一手はどちらを動かしたか?」を毎日問う。' },
    { id: 'rep60', title: '評判を60にする', reward: 80000,
      lesson: '評判は患者体験の積分。待ち時間を削り、丁寧に診る — 地味な積み上げが、いちばん安い集患になる。' },
    { id: 'web', title: 'Web問診・事前受付を導入する', reward: 80000,
      lesson: '受付は院内導線の最初の関門。受付処理を軽くすると、同じ人数でも待ちが減り評判が守れる。「人を増やす前に仕事を減らす」が改善の原則。' },
    { id: 'physio10', spec: 'orthopedics', title: '物療(消炎鎮痛)を10件/日 実施する', reward: 100000,
      lesson: '物療は低単価(¥350)だが高回転で、再診の受け皿になる。整形外来の単価は「初再診料+注射+物療+画像+リハ」の複合で作る。' },
    { id: 'black3', title: '3日連続で黒字にする(法人)', reward: 150000,
      lesson: '外来は固定費型ビジネス。人件費・家賃は患者0人でも出ていく。損益分岐点(1日何人で黒字か)を頭に入れると、打ち手の優先順位が見える。' },
    { id: 'reha10', spec: 'orthopedics', title: '運動器リハを届け出て、リハ実施10件/日', reward: 200000,
      lesson: 'リハは整形外来の柱。施設基準で単価が変わる: (III)¥1,700→(II)¥3,400→(I)¥3,700(2単位換算)。専従PTの人数と面積が壁。' },
    { id: 'tie', title: '病院・ケアマネの両方と関係を作る(Lv1以上)', reward: 200000,
      lesson: '紹介は最強の新患チャネル。ただし関係は「作って終わり」ではない — 30日放置すると冷める。定期訪問は資産のメンテナンス。' },
    { id: 'month300k', title: '月間利益(直近30日・法人)¥300,000', reward: 300000,
      lesson: '日次の黒字が「点」なら、月間利益は「線」。バリューアップの順番は ①守り(待ち・評判)→②回転→③単価→④新患。' },
    { id: 'expand', spec: 'orthopedics', title: '院を増築する(リハ室100㎡・診察室4)', reward: 300000,
      lesson: '設備投資は「回収期間」で考える。増築もMRIも、1日あたりの増収×稼働日数でいつ回収できるかを先に計算する。' },
    { id: 'revenue', title: '本院の月商(直近30日)¥8,000,000', reward: 500000,
      lesson: '月商800万 = 1日30万×27診療日。患者数×単価に分解すると「あと何人」「あと何円」が見える — 分解できる目標だけが実行できる。' },
    { id: 'branch', title: '分院1号店を開設する', reward: 500000,
      lesson: '分院は「成功した仕組みのコピー」でしか成功しない。施設基準の専従要件は分院ごと — 採用が分院展開の本当の壁。' },
    { id: 'branchProfit', title: '分院の直近7日を黒字にする', reward: 500000,
      lesson: '分院経営は「見えない現場」のマネジメント。数字(稼働・評判・人件費率)で異変に気づく仕組みがないと、分院は静かに沈む。' },
    { id: 'corp', title: '法人月商(全拠点・直近30日)¥25,000,000', reward: 1000000,
      lesson: '経営者の仕事は「自分がいなくても回る仕組み」を作ること。ここからは地域リーグ — 市・県・地方・全国の頂点を目指す。' },
    { id: 'cityTop', title: '市でいちばんの{科名}グループになる', reward: 1000000,
      lesson: '規模の拡大は「同じ質を保てる範囲」でしか意味がない。シェアは 評判×拠点数×単価 の総合点で決まる。' },
    { id: 'prefTop', title: '県でいちばんの医療法人になる', reward: 2000000,
      lesson: '県レベルの競争は採用力の勝負。診療の質は「人が辞めない仕組み」でしか維持できない。' },
    { id: 'regionTop', title: '地方でいちばんの医療グループになる', reward: 3000000,
      lesson: 'ここまで来ると経営は「資本配分」の仕事。どの拠点に投資し、どこを守り、どこを畳むか。' },
    { id: 'hospital', title: 'グループ病院を開設する(回復期リハ病棟)', reward: 5000000,
      lesson: '外来は「来た日」だけの売上、入院は「病床が埋まっている毎日」が売上。回復期リハ病棟入院料1(2,229点/日)×稼働率 — 病院経営は配置基準(PT・看護)と稼働率のゲーム。' },
    { id: 'nationTop', title: '全国いちばんの医療法人になる', reward: 5000000,
      lesson: '頂点の景色。患者に選ばれ続ける組織だけがこの位置に立てる — 次は現実で。' }
  ];

  /* ================= プレミアム(コイン)経済 — アプリ版の課金設計をゲーム内で体験 ================= */

  const ITEMS = {
    campaign: { label: '📣 集患キャンペーン', coin: 4, days: 3, hint: '3日間 自然新患+50%' },
    ops: { label: '⚡ 業務改善コンサル', coin: 4, days: 3, hint: '3日間 診察時間-1.2分' },
    training: { label: '🎓 接遇研修(即時)', coin: 3, days: 0, hint: '即時 評判+3' },
    lucky: { label: '🍀 ラッキー看板', coin: 3, days: 7, hint: '7日間 認知+0.7%/日・重ねがけ可' },
    skip7: { label: '⏩ 7日パック(自動運営)', coin: 3, days: 0, hint: '7日を一括で自動運営' }
  };

  const FACILITIES = {
    cafe: { label: '☕ 院内カフェ', coin: 8, hint: '患者体験+5%・待合に常設' },
    kids: { label: '🧸 キッズスペース', coin: 7, hint: '新患+1〜2人/日(子連れ・勤労)' },
    bus: { label: '🚌 送迎バス', coin: 10, hint: '高齢の新患+1〜2人/日・再診率UP' },
    signage: { label: '📺 待合サイネージ', coin: 6, hint: '体感待ち時間-15%' }
  };

  const ACHIEVEMENTS = [
    { id: 'p100', name: '来院 累計100人', coin: 1, cond: (st) => st.patients >= 100 },
    { id: 'p1000', name: '来院 累計1,000人', coin: 2, cond: (st) => st.patients >= 1000 },
    { id: 'p10000', name: '来院 累計10,000人', coin: 5, cond: (st) => st.patients >= 10000 },
    { id: 'new300', name: '新患 累計300人', coin: 2, cond: (st) => st.newp >= 300 },
    { id: 'fans10', name: '🌟顔なじみ10人(通院5回以上)', coin: 2, cond: () => (G.regulars || []).filter((r) => r.visits >= 5).length >= 10 },
    { id: 'fans30', name: '🌟顔なじみ30人 — 地域のかかりつけ', coin: 4, cond: () => (G.regulars || []).filter((r) => r.visits >= 5).length >= 30 },
    { id: 'gradu10', name: '🎓卒業 累計10人(治して送り出す)', coin: 3, cond: (st) => (st.gradu || 0) >= 10 },
    { id: 'gradu50', name: '🎓卒業 累計50人 — 地域を治す医院', coin: 6, cond: (st) => (st.gradu || 0) >= 50 },
    { id: 'reha1000', name: 'リハ 累計1,000件', coin: 2, cond: (st) => st.reha >= 1000 },
    { id: 'reha10000', name: 'リハ 累計10,000件', coin: 5, cond: (st) => st.reha >= 10000 },
    { id: 'inj500', name: '注射 累計500件', coin: 2, cond: (st) => st.inj >= 500 },
    { id: 'mri100', name: 'MRI 累計100件', coin: 2, cond: (st) => st.mri >= 100 },
    { id: 'rev50m', name: '累計売上 ¥5,000万', coin: 2, cond: (st) => st.revenue >= 50000000 },
    { id: 'rev300m', name: '累計売上 ¥3億', coin: 4, cond: (st) => st.revenue >= 300000000 },
    { id: 'rev1b', name: '累計売上 ¥10億', coin: 8, cond: (st) => st.revenue >= 1000000000 },
    { id: 'rep90', name: '評判90到達', coin: 3, cond: () => G.rep >= 90 },
    { id: 'aw80', name: '認知80%到達', coin: 3, cond: () => G.aw >= 0.8 },
    { id: 'black7', name: '7日連続黒字', coin: 2, cond: () => (G.blackStreak || 0) >= 7 },
    { id: 'black30', name: '30日連続黒字', coin: 5, cond: () => (G.blackStreak || 0) >= 30 },
    { id: 'relAll', name: '全営業先と関係Lv1+', coin: 3, cond: () => Object.values(G.relations).every((r) => r.lv >= 1) },
    { id: 'relMax', name: 'どこかの営業先を最大Lvに', coin: 2, cond: () => Object.entries(G.relations).some(([k, r]) => r.lv >= REL_DEF[k].max) },
    { id: 'branch3', name: '分院3院', coin: 4, cond: () => G.branches.length >= 3 },
    { id: 'branch5', name: '分院5院', coin: 6, cond: () => G.branches.length >= 5 },
    { id: 'pt10', name: '法人PT10人', coin: 3, cond: () => corpStaff().pts >= 10 },
    { id: 'debtFree10m', name: '無借金で月商¥1,000万', coin: 4, cond: () => G.loans.length === 0 && monthRevenueAll() >= 10000000 },
    { id: 'day100', name: 'Day 100到達', coin: 2, cond: () => G.day >= 100 },
    { id: 'day365', name: 'Day 365到達', coin: 5, cond: () => G.day >= 365 },
    { id: 'lg_city', name: '市いちばん', coin: 4, cond: () => (G.league ? G.league.beaten : 0) >= 4 },
    { id: 'lg_pref', name: '県いちばん', coin: 6, cond: () => (G.league ? G.league.beaten : 0) >= 7 },
    { id: 'lg_region', name: '地方いちばん', coin: 8, cond: () => (G.league ? G.league.beaten : 0) >= 9 },
    { id: 'lg_nation', name: '全国いちばん', coin: 12, cond: () => (G.league ? G.league.beaten : 0) >= 10 },
    { id: 'hosp', name: 'グループ病院を開設', coin: 6, cond: () => !!G.hospital },
    { id: 'ward100', name: '回復期リハ病棟 100床稼働', coin: 8, cond: () => !!(G.hospital && G.hospital.last && G.hospital.last.occupied >= 100) }
  ];

  const TEXTBOOK = [
    { t: '① 売上 = 患者数 × 単価', b: 'すべての打ち手はこのどちらか(または両方)を動かす。「今日やったことはどちらを動かしたか?」を毎日問う。' },
    { t: '② 患者数 = 新患 + 再診', b: '新患は「認知×評判×アクセス×紹介」。再診は「治療計画×患者体験」。新患獲得コストは再診維持の5倍以上。' },
    { t: '③ 単価は複合で作る', b: '整形外来の単価 = 初再診料+注射+処置+物療+画像+リハ単位。リハだけに頼らず、医学的必要性のある行為を取りこぼさない。実施率をKPIにする。' },
    { t: '④ 外来は固定費型ビジネス', b: '人件費・家賃は患者0人でも出ていく。損益分岐点(何人で黒字か)を必ず把握する。' },
    { t: '⑤ 待ち時間は最大の離反要因', b: '医療の質は見えにくいが、待ち時間は誰にでも見える。予約制・動線・会計自動化で「体感」を削る。' },
    { t: '⑥ リハはLTVで考える', b: 'リハ1回の単価より「完遂までに何回通うか」。中断率を下げることが最大のリハ収益改善。単位/PT/日で稼働を見る。' },
    { t: '⑦ 紹介は資産、広告は費用', b: '病院・ケアマネ・スポーツクラブからの紹介は継続的に流れる。ただし関係は30日で冷め始める — 定期訪問が資産のメンテナンス。' },
    { t: '⑧ CPAはLTVと比べる', b: '広告の良し悪しは「1人獲得にいくらか(CPA)」を「1人が生涯いくら使うか(LTV)」と比べて判断。CPCが高騰したら撤退ラインを決める。' },
    { t: '⑧+ 常連は歩く広告塔', b: '通院5回以上の「顔なじみ」は治療継続の成果であり、口コミの発信源。新患獲得コストゼロで認知を広げてくれる。院内の体験投資は広告費でもある。' },
    { t: '⑨ 施設基準は経営の土台', b: '運動器リハ(III)=専従1名/(II)=常勤PT2名/(I)=4名+100㎡。要件割れは自主返還・指導のリスク。採用と定着は算定要件そのもの。' },
    { t: '⑩ 分院は専従の壁', b: '施設基準の専従要件は施設ごと。本院のPTを分院に兼務させることはできない。分院展開のボトルネックは資金より採用。' },
    { t: '⑪ 借入は時間を買う道具', b: '金利は「計画の質」で決まる。事業計画なしに銀行は貸さない。返済原資(日次黒字)の目処を先に立てる。' },
    { t: '⑫ 設備投資は回収期間で決める', b: 'MRI¥1,800万は1日3件×¥19,000=¥57,000の増収。維持費¥12,000/日を引いた¥45,000で割ると回収は400診療日 — 月27診療日なら約15か月。「欲しい」ではなく「何日で返ってくるか」で判断する。' },
    { t: '⑬ KPIは絞って毎日見る', b: '指標を20個並べたダッシュボードは誰も見ない。日次は3〜4個(来院数・新患・単価・実施率など)に絞り、週次で構造(単価分解・継続率)、月次で計画差異を見る。' },
    { t: '⑭ 診療時間は採算で決める', b: '日曜開院は手当1.4倍でも競合が閉まっている分だけ新患が増える。半日診療は人件費6割。1コマごとの採算を見て開けるコマを決める。' },
    { t: '⑮ 自費は価値設計から', b: 'PRPもAGAも「保険でできないこと」への対価。価格は原価ではなく価値と価格弾力性で決める。評判が低いうちは売れない — 保険診療の信頼が自費の土台。' },
    { t: '⑯ 外来管理加算のトレードオフ', b: '再診で処置・リハ・物療・トリガー注射(麻酔)を行わなければ外来管理加算(52点)が付く。実は関節腔内注射(第6部注射)は加算を妨げない — A001注8が列挙するのは検査の一部・リハ・精神科専門療法・処置・手術・麻酔・放射線治療で、注射は含まれないから。制度の条文を正確に読むと収益構造の見え方が変わる。' },
    { t: '⑰ 客層(セグメント)から逆算する', b: '高齢者=リハ・骨粗鬆症・定着率◎。勤労者=健診・AGA・土日夜間。スポーツ=外傷・MRI・PRP・単価◎。チャネル(ケアマネ/企業/クラブ/学校)ごとに来る客層は違う — 「誰に来てほしいか」から営業先と広告を選ぶ。' },
    { t: '⑱ 1点=10円、加算は「仕組み」で積む', b: '保険診療の価格は点数制(1点=10円)で全国一律 — だから勝負は「何を適切に算定できる体制か」。明細書発行体制等加算(1点・届出不要)・時間外対応体制加算(2〜7点・様式2で届出)は、体制を整えれば再診のたびに積み上がる。月1,000再診なら1点=月1万円。' },
    { t: '⑲ 外来と入院は別のゲーム', b: '外来の売上は「患者が来た日」だけ。入院は「病床が埋まっている毎日」が売上になる(回復期リハ病棟入院料1=2,229点/日×稼働病床)。そのかわり配置基準(PT・看護師の人数)を割れば病床は使えない — 入院経営は採用・定着・稼働率の三位一体。' },
    { t: '⑳ 制度は2年ごとに動く(診療報酬改定)', b: '保険診療の価格は国が2年に一度改定する。下がる項目を嘆くのではなく、上がった項目・新設された加算に体制を寄せるのが改定対応。「一つの算定に依存しない収益の複線化」が、ルール変更に強い経営を作る。' }
  ];

  // KPI定義(選んでピン留めできる)
  const KPIS = [
    { id: 'visits', name: '来院数/日', unit: '人', why: 'すべての起点。曜日でブレるので週平均とセットで見る', calc: (h) => h.patients },
    { id: 'newp', name: '新患数/日', unit: '人', why: '商圏×認知×評判×紹介の総合結果。マーケの通信簿', calc: (h) => h.newCount || 0 },
    { id: 'unit', name: '診療単価', unit: '円', why: '売上=患者数×単価の右側。診療の中身の充実度', calc: (h) => h.patients ? Math.round(h.revenue / h.patients) : 0 },
    { id: 'mix', name: '重点行為 実施率', unit: '%', why: '注射・ブロック等の実施率。単価の源泉(実クリニックで20〜40%程度)', calc: (h) => h.patients ? Math.round((h.injCount + h.trigCount) / h.patients * 100) : 0 },
    { id: 'rehaPerPT', name: 'リハ単位/PT/日', unit: '単位', why: 'PT1人あたり稼働。18単位/日が概ね上限、低ければ枠設計の問題', calc: (h) => h.pts ? Math.round(h.rehaCount * 2 / h.pts * 10) / 10 : 0 },
    { id: 'physio', name: '物療件数/日', unit: '件', why: '高回転・低単価の土台。継続来院の受け皿', calc: (h) => h.physioCount || 0 },
    { id: 'newRate', name: '新患率', unit: '%', why: '高すぎ=再診が定着していない、低すぎ=先細り。10%前後が目安', calc: (h) => h.patients ? Math.round((h.newCount || 0) / h.patients * 100) : 0 },
    { id: 'wait', name: '平均待ち時間', unit: '分', why: '患者体験の代表値。15分を超えたら回転設計を見直す', calc: (h) => Math.round(h.avgWait || 0) },
    { id: 'jihiDay', name: '自費売上/日', unit: '円', why: '価格決定権のある売上。評判との相関を見る', calc: (h) => h.jihi || 0 },
    { id: 'labor', name: '人件費率', unit: '%', why: '目安45〜55%。売上が伸びる前に人を増やすと悪化する', calc: (h) => h.revenue ? Math.round((h.staffCost || 0) / h.revenue * 100) : 0 },
    { id: 'mriN', name: 'MRI件数/日', unit: '件', why: '¥1,800万の投資回収を左右する。1日3件なら維持費込みで400診療日(約15か月)', calc: (h) => h.mriCount || 0 },
    { id: 'profit', name: '法人損益/日', unit: '円', why: '最後はここ。ただし日次のブレに一喜一憂しないこと', calc: (h) => (h.profit || 0) + (h.brProfit || 0) }
  ];

  /* ================= 状態 ================= */

  const SAVE_KEY = 'clinicTown_v3';

  const settings = {
    floorLv: 1,
    doctors: 1, nurses: 1, pts: 0, receptionists: 1, rehaAides: 0,
    chairs: 6, beds: 1, machines: 0, physio: 0,
    kiosk: false, reserve: false, reviewCare: false, webIntake: false,
    kasanMeisai: false, kasanJikangai: 0, kasanKyoka: false, kasanRenkei: false,
    /* kasanKohatsu はR8で加算廃止・再編に伴い削除(便H)。旧セーブの値は無視される */
    cashHelper: false,
    mri: false, dexa: false, echo: false,
    rehaLevel: 0,
    examMean: 6, pTreat: 0.15, pReha: 0.35, pInj: 0.2, pTrig: 0.12, pPhysio: 0.35,
    selfReha: false, selfRehaPrice: 8000, goods: false,
    prpOn: false, prpPrice: 55000, agaOn: false, agaPrice: 6000,
    learnMode: false, specialty: 'orthopedics', mainPolicy: null, mainFs: [], mainEquip: null, // mainEquip=他科本院の設備(v73 便AF・眼科の検査設備投資)
    schedule: ['full', 'full', 'full', 'am', 'full', 'am', 'closed'] // 月〜日
  };

  const G = {
    money: 2000000, rep: 55, aw: 0.30,
    day: 1, t: 0, speed: 2,
    // Reimbursement Debugger: ?debug=1 で算定詳細に評価トレースを表示
    debugMode: typeof location !== 'undefined' && /[?&]debug=1/.test(location.search),
    receiptDetailOpen: false,
    corpOpen: null, // 法人タブで展開中の拠点(索引+1件展開)
    billboard: false,
    relations: {}, // key -> {lv, last}
    loans: [],
    ads: { area: 0, pain: 0, sports: 0 },
    adPressure: 0, adReport: null, adSpendToday: 0,
    osteoPool: 0, agaPool: 0,
    kpiPins: ['visits', 'newp', 'unit', 'mix'],
    targetSeg: 'balance',
    cum: { revenue: 0, profit: 0 }, annualDone: false,
    voiceLog: [], voiceFeed: [],
    schedule: {}, arrivals: [], nextArrivalIdx: 0,
    today: null, history: [],
    branches: [],
    depts: {}, // 診療科部門(id -> DEPT状態)
    missionIdx: 0, missionDone: [],
    tutorialDone: false, plan: null,
    lastStage: 1, blackStreak: 0,
    coins: 2, boosts: {}, deco: {}, achDone: [],
    stats: { patients: 0, newp: 0, reha: 0, inj: 0, mri: 0, revenue: 0, gradu: 0 },
    med: { fsBroken: 0, warnDays: 0, days: 0, quizOk: 0, quizTotal: 0 }, // 医療(適切な算定)スコアの月内トラッカー
    referLog: [], referSeen: {}, handoverLog: [], // 部門間紹介(直近ログ・初回banner済みの向き・本院→在宅の引き継ぎ)
    clinicName: 'あなたのクリニック',
    daily: { last: '', streak: 0, chDone: '', chState: '', chDay: '', lastClearChar: '', chain: 0 },
    prestige: { count: 0, legacy: null },
    speedPass: { tier: 0, until: 0 },
    bonds: { front: 0, doctor: 0, nurse: 0, reha: 0, billing: 0, advisor: 0 },
    specialDone: [],
    season: { bestProfit: null, bestMonth: 0, months: 0 },
    league: { beaten: 0 },
    sound: true,
    notify: false,
    regulars: [], personaSeq: 0, graduLog: [],
    hospital: null,
    kaitei: { count: 0, consult: 1, inj: 1, treat: 1, physio: 1, reha: 1, img: 1, log: [] }
  };
  Object.keys(REL_DEF).forEach((k) => { G.relations[k] = { lv: 0, last: 0 }; });

  function weekdayOf(day) { return (day - 1) % 7; }
  function specOf(day) {
    const kind = settings.schedule[weekdayOf(day)] || 'full';
    return Object.assign({ kind }, DAY_SPECS[kind]);
  }
  function openDaysCount() { return settings.schedule.filter((k) => k !== 'closed').length; }

  /* ================= 🌦 天気(季節×日替わり・決定論) ================= */

  const WEATHER = {
    sunny:  { icon: '☀️', label: '晴れ',   newMul: 1.0,  show: 0,     falls: 0 },
    cloudy: { icon: '☁️', label: 'くもり', newMul: 0.97, show: 0,     falls: 0 },
    rain:   { icon: '☔', label: '雨',     newMul: 0.8,  show: -0.05, falls: 1.2,
      note: '新患の足が鈍る一方、濡れた路面の転倒で初診が入る。リハのキャンセルに注意' },
    heat:   { icon: '🥵', label: '猛暑日', newMul: 0.9,  show: -0.05, falls: 0.3,
      note: '暑さで通院がおっくうに。リハの中断が増えやすい日' },
    ice:    { icon: '❄️', label: '雪・凍結', newMul: 0.75, show: -0.07, falls: 2.6,
      note: '路面凍結で転倒の初診が急増。処置・固定の備えを' }
  };

  // ゲーム内の月(実プレイ開始月から30日=1ヶ月で進む)
  function gameMonth(day) {
    return ((new Date().getMonth() + Math.floor((day - 1) / 30)) % 12) + 1;
  }

  function weatherFor(day) {
    let h = (day * 2654435761) % 4294967296;
    h = ((h ^ (h >>> 13)) * 1103515245) % 2147483648;
    const r = (h % 1000) / 1000;
    const m = gameMonth(day);
    if (m === 6) return r < 0.42 ? 'rain' : r < 0.72 ? 'cloudy' : 'sunny'; // 梅雨
    if (m === 7 || m === 8) return r < 0.28 ? 'heat' : r < 0.42 ? 'rain' : r < 0.55 ? 'cloudy' : 'sunny'; // 夏
    if (m === 12 || m <= 2) return r < 0.22 ? 'ice' : r < 0.32 ? 'rain' : r < 0.58 ? 'cloudy' : 'sunny'; // 冬
    return r < 0.16 ? 'rain' : r < 0.42 ? 'cloudy' : 'sunny'; // 春秋
  }

  function ensureWeather() {
    if (!G.weather || G.weather.day !== G.day) {
      const kind = weatherFor(G.day);
      G.weather = Object.assign({ day: G.day, kind }, WEATHER[kind]);
    }
    return G.weather;
  }

  function monthRevenueMain() {
    return G.history.slice(-30).reduce((a, d) => a + d.revenue, 0) + (G.today ? G.today.revenue : 0);
  }
  function monthRevenueAll() {
    return G.history.slice(-30).reduce((a, d) => a + d.revenue + (d.brRevenue || 0), 0) + (G.today ? G.today.revenue : 0);
  }
  function monthJihi() {
    return G.history.slice(-30).reduce((a, d) => a + (d.jihi || 0), 0) + (G.today ? G.today.rev.jihi : 0);
  }

  function newToday() {
    return {
      revenue: 0, cost: 0, profit: 0, patients: 0, waitSum: 0, waitN: 0,
      rehaCount: 0, goodsCogs: 0, jihiCogs: 0, surgCogs: 0, surgCount: 0,
      newCount: 0, injCount: 0, trigCount: 0, physioCount: 0, xrayCount: 0, mriCount: 0, prpCount: 0, osteoVisits: 0, treatCount: 0, kanriCount: 0,
      segCounts: { senior: 0, worker: 0, sports: 0 },
      rev: { consult: 0, inj: 0, treat: 0, physio: 0, img: 0, reha: 0, osteo: 0, checkup: 0, jihi: 0 },
      balked: 0, soothe: 0, pulse: [], pulseEv: [], acct: {},
      brRevenue: 0, brProfit: 0
    };
  }

  // 算定項目の日次集計(月間レセプト集計の元データ)。点数項目は1点=10円、保険外はyen指定
  function acc(T, name, ten, yenAmt) {
    const a = T.acct[name] = T.acct[name] || { n: 0, ten: 0, yen: 0 };
    a.n++;
    a.ten += ten || 0;
    a.yen += yenAmt !== undefined ? yenAmt : (ten || 0) * 10;
  }

  // 打ち手マーカー: 日中に操作した打ち手を時刻つきで記録(ライブモニターに▼表示)
  function pushPulseEv(icon, label) {
    const T = G.today;
    const spec = G.daySpec;
    if (!T || !spec || spec.kind === 'closed' || G.t <= 0 || G.t >= spec.min) return;
    T.pulseEv.push({ t: G.t, icon, label });
    if (T.pulseEv.length > 20) T.pulseEv.shift();
    if (activeTab === 'clinic') renderPulse();
  }

  /* ================= セーブ/ロード ================= */

  function savePayload() {
    return {
        settings, g: {
          money: G.money, rep: G.rep, aw: G.aw, day: G.day,
          billboard: G.billboard, relations: G.relations,
          loans: G.loans, ads: G.ads, adPressure: G.adPressure,
          osteoPool: G.osteoPool, agaPool: G.agaPool, kpiPins: G.kpiPins,
          targetSeg: G.targetSeg, cum: G.cum, annualDone: G.annualDone, voiceLog: G.voiceLog,
          schedule: G.schedule, history: G.history.slice(-40),
          branches: G.branches, depts: G.depts, missionIdx: G.missionIdx, missionDone: G.missionDone,
          tutorialDone: G.tutorialDone, plan: G.plan,
          lastStage: G.lastStage, blackStreak: G.blackStreak,
          coins: G.coins, boosts: G.boosts, deco: G.deco, achDone: G.achDone,
          stats: G.stats, clinicName: G.clinicName,
          daily: G.daily, prestige: G.prestige, speedPass: G.speedPass, bonds: G.bonds,
          specialDone: G.specialDone, season: G.season, league: G.league, sound: G.sound, notify: G.notify, hospital: G.hospital, kaitei: G.kaitei,
          regulars: (G.regulars || []).slice(-80), mainMi: G.mainMi, mainWi: G.mainWi, personaSeq: G.personaSeq || 0, graduLog: (G.graduLog || []).slice(-30),
          med: G.med, referLog: (G.referLog || []).slice(-120), referSeen: G.referSeen, handoverLog: (G.handoverLog || []).slice(-30),
          dec: G.dec, // 経営の分岐点(v70): 余力・信頼・履歴・予約した遅延効果・継続効果・開いている相談
          mainQueue: G.mainQueue // 本院眼科の白内障パイプライン(v74 便AF-2): 術前待ち・手術待ち・術後の残回数
        }
      };
  }
  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(savePayload())); } catch (e) { /* noop */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      Object.assign(settings, d.settings);
      Object.assign(G, d.g);
      // 本院の科で隠す自費メニューは稼がない(v76 保留#43。旧セーブで selfReha が残っていても落とす)
      if (typeof SPECIALTIES !== 'undefined') { const mm = SPECIALTIES.get(settings.specialty); for (const k of (mm && mm.main && mm.main.preset && mm.main.preset.jihiHide) || []) settings[k] = false; }
      Object.keys(REL_DEF).forEach((k) => { if (!G.relations[k]) G.relations[k] = { lv: 0, last: 0 }; });
      if (!G.cum) G.cum = { revenue: 0, profit: 0 };
      if (d.g.blackStreak === undefined) G.blackStreak = 0;
      // 旧セーブは進行度から解放段階を復元(演出なしで全解放)
      if (d.g.lastStage === undefined) G.lastStage = G.day >= 8 ? 3 : G.day >= 4 ? 2 : 1;
      // 旧ミッションIDのセーブは、達成数を新カリキュラムに引き継ぐ
      if (G.missionDone.length && !G.missionDone.some((id) => MISSIONS.some((m) => m.id === id))) {
        G.missionIdx = Math.min(G.missionDone.length, MISSIONS.length);
      }
      // v7: コイン経済のフィールド補完(旧セーブは達成済みミッション分のコインを付与)
      if (d.g.coins === undefined) G.coins = d.g.medals !== undefined ? d.g.medals : 2 + G.missionIdx;
      if (!G.boosts) G.boosts = {};
      if (!G.deco) G.deco = {};
      if (!G.achDone) G.achDone = [];
      if (d.g.stats === undefined) G.stats = { patients: 0, newp: 0, reha: 0, inj: 0, mri: 0, revenue: G.cum.revenue || 0 };
      if (!G.clinicName) G.clinicName = 'あなたのクリニック';
      // v8: デイリー・殿堂フィールドの補完
      if (!G.daily) G.daily = { last: '', streak: 0, chDone: '' };
      if (!G.prestige) G.prestige = { count: 0, legacy: null };
      if (d.g.sound === undefined) G.sound = true;
      if (d.g.notify === undefined) G.notify = false;
      if (!G.regulars) G.regulars = [];
      if (!G.personaSeq) G.personaSeq = 0;
      if (G.stats && G.stats.gradu === undefined) G.stats.gradu = 0;
      if (!G.graduLog) G.graduLog = [];
      if (d.g.hospital === undefined) G.hospital = null;
      if (!G.kaitei) G.kaitei = { count: 0, consult: 1, inj: 1, treat: 1, physio: 1, reha: 1, img: 1, log: [] };
      // v11-12: スペシャル依頼・月間決算・地域リーグの補完
      if (!G.league) G.league = { beaten: 0 };
      if (!G.specialDone) G.specialDone = [];
      if (!G.season) G.season = { bestProfit: null, bestMonth: 0, months: 0 };
      // v10: 倍速パス・信頼度の補完(v9の買い切りはコインで返金)
      if (!G.speedPass) G.speedPass = { tier: 0, until: 0 };
      if (!G.bonds) G.bonds = { front: 0, doctor: 0, nurse: 0, reha: 0, billing: 0, advisor: 0 };
      if (G.daily.chState === undefined) Object.assign(G.daily, { chState: '', chDay: '', lastClearChar: '', chain: 0 });
      if (G.daily.quizDone === undefined) G.daily.quizDone = '';
      // v41: 医療(適切な算定)スコアの月内トラッカーの補完
      if (!G.med) G.med = { fsBroken: 0, warnDays: 0, days: 0, quizOk: 0, quizTotal: 0 };
      // v42: 部門間紹介の記録の補完
      if (!G.referLog) G.referLog = [];
      if (!G.referSeen) G.referSeen = {};
      if (!G.handoverLog) G.handoverLog = [];
      if (d.g.speedUnlocked) {
        const OLD_PRICE = { 8: 12, 16: 25, 32: 50 };
        let refund = 0;
        Object.keys(d.g.speedUnlocked).forEach((k) => { if (d.g.speedUnlocked[k]) refund += OLD_PRICE[k] || 0; });
        if (refund > 0) { G.coins += refund; G.speedRefund = refund; }
        delete G.speedUnlocked;
      }
      // v35: 診療科部門の補完(旧セーブは部門なし)
      if (!G.depts) G.depts = {};
      // 旧セーブの分院にv4フィールドを補完
      for (const br of G.branches) {
        // staff導入前のセーブはcorpStaff()でTypeErrorになる(保留#20)。開設時と同じ既定値で
        // 明示的に補完する(読み取り側の||0は手がかりを消して誤数字を見せるため採らない=PM裁定)。
        // ほかの必須フィールドも同時に補完し、部分的な分院オブジェクトに対して堅牢にする
        br.staff = Object.assign({ doctors: 1, nurses: 1, pts: 0, receptionists: 1 }, br.staff || {});
        if (!Array.isArray(br.profit7)) br.profit7 = [];
        if (br.machines === undefined) br.machines = 0;
        if (br.rehaLevel === undefined) br.rehaLevel = 0;
        if (br.aw === undefined) br.aw = 0.12;
        if (br.rep === undefined) br.rep = 52;
        if (br.revisitPool === undefined) br.revisitPool = 4;
        if (br.rehabPool === undefined) br.rehabPool = 0;
        if (br.last === undefined) br.last = null;
        if (br.floorLv === undefined) br.floorLv = 1;
        if (br.physio === undefined) br.physio = 0;
        if (br.pInj === undefined) br.pInj = 0.2;
        if (br.pReha === undefined) br.pReha = 0.35;
        if (br.mri === undefined) br.mri = false;
      }
      return true;
    } catch (e) { return false; }
  }

  function hardReset() {
    FS_FOLD_OPEN.clear(); // UI状態も初期化(v56 designer A2)
    try {
      localStorage.removeItem(SAVE_KEY);
      for (const k of Object.keys(localStorage)) if (k.startsWith(SAVE_KEY + '_dec') || k === SAVE_KEY + '_keep') localStorage.removeItem(k); // 分岐点のやり直し用スナップショット(v70)
    } catch (e) { /* noop */ }
    location.reload();
  }

  /* ================= シム構築 ================= */

  const clinicIso = new Iso($('clinicStage'), 20, 14, { maxTileW: 58 });
  const townIso = new Iso($('townStage'), TOWN.W, TOWN.H, { maxTileW: 46, topPad: 1.6 });

  // 評判は1日に-3までしか下がらない(悪循環の防止)。上げ幅は従来どおり
  function repDailyFloor() {
    return Math.max(15, (G.repDayStart !== undefined ? G.repDayStart : G.rep) - 3);
  }

  // 常連の記憶: 再来の患者は「前に来た同じ人」として戻ってくる
  function assignPersona(type, seg) {
    if (typeof PERSONA === 'undefined') return null;
    if (!G.regulars) G.regulars = [];
    const isReturn = type === 'revisit' || type === 'rehab';
    if (isReturn && G.regulars.length) {
      const pool = G.regulars.filter((r) => r.seg === seg);
      const list = pool.length ? pool : G.regulars;
      const r = list[Math.floor(Math.random() * list.length)];
      r.visits++;
      r.lastDay = G.day;
      if (!r.rid) r.rid = 'r' + (G.personaSeq = (G.personaSeq || 0) + 1);
      return Object.assign({}, r.p, { visits: r.visits, rid: r.rid });
    }
    G.personaSeq = (G.personaSeq || 0) + 1;
    const p = PERSONA.genPatient(G.personaSeq, seg);
    G.regulars.push({ p, seg, visits: 1, lastDay: G.day, rid: 'r' + G.personaSeq, mc: {}, wc: {}, lb: {}, fb: false, pr: null });
    if (G.regulars.length > 80) {
      G.regulars.sort((a, b) => a.lastDay - b.lastDay);
      G.regulars.splice(0, G.regulars.length - 80);
    }
    return Object.assign({}, p, { visits: 1 });
  }

  /* ===== 他科本院の会計(v66・便AD): 分院と同じエンジン経路(モジュールの planVisit→DEPT.evalVisit) =====
     整形本院の直書き経路(onDischarge本体)には触れない。本院患者の履歴は G.regulars の mc/wc/lb/fb/pr に持つ。 */
  function mainPolicyNow(mod) {
    if (!settings.mainPolicy) settings.mainPolicy = Object.assign({}, (mod.main && mod.main.preset && mod.main.preset.policy) || (mod.deptDefaults && mod.deptDefaults.policy) || {});
    return settings.mainPolicy;
  }
  function mainEquipNow(mod) {
    if (!settings.mainEquip) settings.mainEquip = Object.assign({}, (mod.deptDefaults && mod.deptDefaults.equip) || {});
    return settings.mainEquip;
  }
  function mainDeptShim(mod) {
    // equip は settings.mainEquip への参照(部門の dept.equip と同じ形)。dact で a.apply(d) が書くとそのまま保存対象になる(v73)
    return { id: mod.id, isMain: true, policy: mainPolicyNow(mod), fs: settings.mainFs || (settings.mainFs = []),
      staff: { doctors: settings.doctors, nurses: settings.nurses, clerks: settings.receptionists }, equip: mainEquipNow(mod), pt: [] };
  }
  /* 本院の白内障パイプライン(v74 便AF-2)。部門の dept.queue と同形。科を替えたら空にする */
  function mainQueueNow() {
    if (!G.mainQueue || !Array.isArray(G.mainQueue.postop)) G.mainQueue = { preop: 0, surgery: 0, postop: [] };
    return G.mainQueue;
  }
  /* 本院の日次(1日の締め)で回す科固有の経路。いまは眼科の術前検査→手術(手術日)→術後管理だけ。
     会計は onDischargeDept と同じ(DEPT.evalVisit+体制の加算)。材料費は T.surgCogs に積み、dayCost が拾う */
  function mainSpecialtyDay() {
    const mod = SPECIALTIES.get(settings.specialty);
    if (!mod || !mod.cataractDay || settings.specialty === 'orthopedics') return;
    const spec = G.daySpec || specOf(G.day);
    if (spec.kind === 'closed') return;
    const T = G.today;
    const shim = mainDeptShim(mod);
    if (!shim.equip || !shim.equip.surgery) return;
    let best = null;
    const out = mod.cataractDay(mainQueueNow(), shim.equip, shim.staff, G.day, {
      frac, rand: Math.random,
      visit: (tmp, report, label, slot) => {
        const r = DEPT.evalVisit(mod, shim, tmp, report, G.day);
        const rc = [];
        let rev = 0;
        for (const line of r.lines) { rc.push(line); rev += line.t * 10; }
        for (const k of KASAN_CORE.revisitLines(settings, kbPts)) { rc.push({ n: k.n, t: k.t, kb: k.kb }); rev += k.t * 10; }
        rc.forEach((x) => acc(T, x.n, x.t));
        const isOp = report.kbActs.some((a) => a.id === 'cataractOp');
        T.revenue += rev; if (isOp) { T.rev.treat += rev; T.surgCount++; } else T.rev.consult += rev;
        T.patients++;
        if (G.med && devWarn(r.ev.warnings).length) T._medWarn = true;
        if (label && (!best || best.slot < slot)) best = { slot, label, rc, rev, ev: r.ev };
        return r;
      },
      cost: (yen) => { T.surgCogs += yen; },
    });
    if (best) {
      G.lastReceipt = { type: 'revisit', seg: 'senior', rc: best.rc, ten: best.rc.reduce((a, r) => a + (r.t || 0), 0), yen: best.rev,
        kb: { rejected: best.ev.rejectedItems.map((x) => ({ itemId: x.itemId, name: x.name, points: x.points, reasons: x.reasons, rules: x.rules, fsInfo: x.fsInfo })), warnings: best.ev.warnings, trace: best.ev.trace } };
    }
    if (out.ops > 0 && G.speed <= 4) toast(`👁 水晶体再建術(眼内レンズ挿入・日帰り) ${out.ops}件。術後の経過観察へ`);
    return out;
  }
  function ensureHist(rec, mod) {
    if (!rec.mc) rec.mc = {}; if (!rec.wc) rec.wc = {}; if (!rec.lb) rec.lb = {};
    if (rec.fb === undefined) rec.fb = false;
    if (!rec.pr && mod.pickProfile) rec.pr = mod.pickProfile(Math.random);
    return rec;
  }
  function onDischargeDept(p, report) {
    const T = G.today;
    const seg = report.seg || 'senior';
    T.segCounts[seg] = (T.segCounts[seg] || 0) + 1;
    const mod = SPECIALTIES.get(settings.specialty);
    const rc = [];
    let revenue = 0;
    let kbEval = null;
    if (report.type === 'checkup' || !mod || !mod.planVisit) {
      revenue += FEES.checkup; T.rev.checkup += FEES.checkup; rc.push({ n: '健康診断(保険外)', y: FEES.checkup });
    } else {
      const rec = (p.persona && p.persona.rid) ? G.regulars.find((r) => r.rid === p.persona.rid) : null;
      const hist = rec ? ensureHist(rec, mod) : { pr: mod.pickProfile ? mod.pickProfile(Math.random) : null, mc: {}, wc: {}, lb: {}, fb: false, sv: 0 };
      const shim = mainDeptShim(mod);
      const v = mod.planVisit(hist, shim.policy, shim.fs, Math.random, (id) => !!(G.depts && G.depts[id]), shim.equip);
      if (v.refEye) routeReferral({ from: 'main', to: 'ophthalmology', kind: 'dm-retino', label: '糖尿病の定期眼底検査' });
      if (v.doLab && mod.managementParameters && mod.managementParameters.labCost) T.labCogs = (T.labCogs || 0) + mod.managementParameters.labCost;
      const r = DEPT.evalVisit(mod, shim, hist, v.report, G.day);
      kbEval = r.ev;
      for (const line of r.lines) { rc.push(line); revenue += line.t * 10; T.rev.consult += line.t * 10; if (line.kb === 'r08-A001-n8') T.kanriCount++; }
      if (v.isFirst) T.newCount++;
      // 白内障の候補化(眼科・手術設備がある本院だけ。分院の runDay と同じ関数・v74)。本院は初診も継続と同じ率 cataractConvert(社長決定 2026-09-06「b」。v74〜76 は初診を分院の一見 0.08 に相当させ、手術が本院売上の6割になっていた)
      if (mod.cataractOnVisit) mod.cataractOnVisit(mainQueueNow(), shim.equip, Math.random, hist.pr);
      // 体制の加算(初再診への加算)は科に依らない=整形本院と同じ計上(KASAN_CORE)
      const kas = v.isFirst ? KASAN_CORE.firstVisitLines(settings, kbPts) : KASAN_CORE.revisitLines(settings, kbPts);
      for (const k of kas) { revenue += k.t * 10; T.rev.consult += k.t * 10; rc.push({ n: k.n, t: k.t, kb: k.kb }); }
      if (G.med && devWarn(kbEval.warnings).length) T._medWarn = true;
    }
    rc.forEach((x) => acc(T, x.n, x.t, x.t ? undefined : x.y));
    G.lastReceipt = {
      type: report.type, seg, rc,
      ten: rc.reduce((a, r) => a + (r.t || 0), 0), yen: revenue,
      kb: kbEval ? { rejected: kbEval.rejectedItems.map((x) => ({ itemId: x.itemId, name: x.name, points: x.points, reasons: x.reasons, rules: x.rules, fsInfo: x.fsInfo })), warnings: kbEval.warnings, trace: kbEval.trace } : null
    };
    if (activeTab === 'clinic' && G.speed <= 4) renderReceipt();
    if (G.speed <= 2 && revenue > 0) SND.cash();
    T.revenue += revenue; T.patients++;
    T.waitSum += report.wait; T.waitN++;
    const feltWait = report.wait * (report.soothed ? 0.65 : 1);
    let sat = clamp(1.25 - feltWait * waitFeel() / 40, 0, 1);
    if (G.deco.cafe) sat = Math.min(1, sat + 0.05);
    G.rep += (sat * 100 - G.rep) * 0.01;
    G.rep = Math.max(G.rep, repDailyFloor());
    // 継続管理の次回来院(月1回ペース=モジュールの revisitDays。定着は満足度で決まる=ゲーム上の仮定)
    const P = (mod && mod.managementParameters) || {};
    const iv = P.revisitDays ? P.revisitDays[0] + Math.floor(Math.random() * (P.revisitDays[1] - P.revisitDays[0] + 1)) : 28;
    const loyalty = { senior: 0.7, worker: 0.5, sports: 0.5 }[seg] || 0.55;
    if ((report.type === 'first' || report.type === 'revisit') && Math.random() < loyalty * sat + (settings.reserve ? 0.05 : 0)) addSchedule(G.day + iv, 'revisit');
    updateHeader();
    return revenue;
  }

  const clinic = new CLINIC.ClinicSim(settings, {
    assignPersona,
    onRelayout(L) {
      clinicIso.W = L.W; clinicIso.H = L.H;
      clinicIso.resize();
    },
    onDischarge(p, report) {
      // 🎓 卒業: 8回以上通った常連は、治って通院を終えることがある(良いお別れ)
      if (p.persona && p.persona.rid && p.persona.visits >= 8 && Math.random() < 0.15) {
        const idx = G.regulars.findIndex((r) => r.rid === p.persona.rid);
        if (idx >= 0) {
          G.regulars.splice(idx, 1);
          G.stats.gradu = (G.stats.gradu || 0) + 1;
          G.rep = Math.min(100, G.rep + 0.4);
          (G.graduLog = G.graduLog || []).push({ name: p.persona.name, age: p.persona.age, ch: p.persona.chLabel, visits: p.persona.visits, day: G.day });
          if (G.graduLog.length > 30) G.graduLog.shift();
          if (typeof PERSONA !== 'undefined') banner(`🎓 ${p.persona.name}さんが卒業しました — 「${PERSONA.graduLine(p.persona)}」(評判+0.4)`);
          if (clinic.floats) clinic.floats.push({ x: p.x, y: p.y - 0.6, text: '🎓', t: 0 });
        }
      }
      if (settings.specialty !== 'orthopedics' && KBI && DEPTI) return onDischargeDept(p, report);
      let revenue = 0;
      const T = G.today;
      const seg = report.seg || 'senior';
      T.segCounts[seg] = (T.segCounts[seg] || 0) + 1;
      let didProcedure = false; // 処置・注射・リハ・物療のいずれかを実施したか(外来管理加算の判定)
      const rc = []; // レセプト(算定内訳・点数)

      if (report.type === 'first') {
        revenue += FEES.first; T.rev.consult += FEES.first; T.newCount++;
        rc.push({ n: '初診料', t: FEES.first / 10, kb: 'r08-A000' });
        // 初診への体制加算(v48): 機能強化=かかりつけ機能(在宅部門+在支診が前提)。
        // 電子的連携3は月1回/患者だが初診=新来のため自然に充足(再診2点側は集計モデルで
        // 月1回を守れないため申請しない=安全側)。計上行はKASAN_COREに一本化(保留#23)
        for (const k of KASAN_CORE.firstVisitLines(settings, kbPts)) { revenue += k.t * 10; T.rev.consult += k.t * 10; rc.push({ n: k.n, t: k.t, kb: k.kb }); }
      }
      if (report.type === 'revisit' || report.type === 'rehab') { revenue += FEES.revisit; T.rev.consult += FEES.revisit; rc.push({ n: '再診料', t: FEES.revisit / 10, kb: 'r08-A001' }); }
      if (report.type === 'checkup') { revenue += FEES.checkup; T.rev.checkup += FEES.checkup; rc.push({ n: '健康診断(保険外)', y: FEES.checkup }); }

      for (const it of report.items) {
        if (it === 'treat') {
          // 3割はシーネ・ギプス固定(整形らしい高点数処置)
          if (Math.random() < 0.3) { const p = kbPts('r08-J122-2', 490); revenue += p * 10; T.rev.treat += p * 10; rc.push({ n: 'ギプス・シーネ固定(手指及び手、足)', t: p, kb: 'r08-J122-2' }); }
          else { const p = kbPts('r08-J000-1', 52); revenue += p * 10; T.rev.treat += p * 10; rc.push({ n: '創傷処置(100cm²未満)', t: p, kb: 'r08-J000-1' }); }
          T.treatCount++; didProcedure = true;
        }
        if (it === 'inj') {
          const p = kbPts('r08-G010', 80);
          revenue += (p + DRUG_PTS.inj) * 10; T.rev.inj += (p + DRUG_PTS.inj) * 10; T.injCount++; didProcedure = true;
          rc.push({ n: '関節腔内注射', t: p, kb: 'r08-G010' });
          rc.push({ n: '関節注入薬剤(アルツ25mg)', t: DRUG_PTS.inj, kb: DRUG_KB.inj });
        }
        if (it === 'trig') {
          // 25%は腰部硬膜外ブロックへステップアップ(L100-2も薬剤(L200)もKB登録済み=便M)
          if (Math.random() < 0.25) {
            const p = kbPts('r08-L100-2-lumbar', 800);
            revenue += (p + DRUG_PTS.block) * 10; T.rev.inj += (p + DRUG_PTS.block) * 10;
            rc.push({ n: '腰部硬膜外ブロック', t: p, kb: 'r08-L100-2-lumbar' });
            rc.push({ n: 'ブロック注入薬剤(キシロカイン1%10mL)', t: DRUG_PTS.block, kb: DRUG_KB.block });
          }
          else {
            const p = kbPts('r08-L104', 70);
            revenue += (p + DRUG_PTS.trig) * 10; T.rev.inj += (p + DRUG_PTS.trig) * 10;
            rc.push({ n: 'トリガーポイント注射', t: p, kb: 'r08-L104' });
            rc.push({ n: 'トリガー注入薬剤(キシロカイン1%5mL)', t: DRUG_PTS.trig, kb: DRUG_KB.trig });
          }
          T.trigCount++; didProcedure = true;
        }
        if (it === 'reha') {
          // リハの算定はエンジン判定へ回す(下のkbEval)。実施フラグのみ立てる
          report._doRehaAct = true; didProcedure = true; T.rehaCount++;
        }
      }
      // リハ開始時: リハ総合計画評価料1(初回)。告示注1の列挙は運動器(I)(II)のみ=(III)では算定不可
      if (report.didReha && report.type !== 'rehab' && settings.rehaLevel >= 2) {
        const p = kbPts('r08-H003-2-1-i', 300);
        revenue += p * 10; T.rev.reha += p * 10;
        rc.push({ n: 'リハビリテーション総合計画評価料1(初回)', t: p, kb: 'r08-H003-2-1-i' });
      }

      // 物療(消炎鎮痛等処置): 機器があれば高回転で回る(故障イベント時は停止)
      if (settings.physio > 0 && !G.evPhysioDown && report.type !== 'checkup' && T.physioCount < settings.physio * 35 && Math.random() < settings.pPhysio + 0.02 * bondLv('nurse')) {
        const p = kbPts('r08-J119-2', 35);
        revenue += p * 10; T.rev.physio += p * 10; T.physioCount++; didProcedure = true;
        rc.push({ n: '消炎鎮痛等処置(器具等)', t: p, kb: 'r08-J119-2' });
      }

      // ---- 診療報酬エンジン(Layer 3): 外来管理加算・疾患別リハをKBで判定 ----
      // KB登録済み項目はエンジンが可否と点数を決める(A001注8の同日ルール等)。
      // KB未登録の行為(注射・物療等)は実施カテゴリとして伝えて判定に反映する
      let kbEval = null;
      if (KBI) {
        const procs = [];
        if (report.type === 'revisit' || report.type === 'rehab') procs.push({ itemId: 'r08-A001-n8' });
        if (report._doRehaAct) procs.push({ itemId: REHA_KB_ITEM[settings.rehaLevel] || 'r08-H002-3', units: 2 });
        const perfCats = [];
        if (report.items.includes('treat') || rc.some((x) => (x.n || '').indexOf('消炎鎮痛') === 0)) perfCats.push('処置');
        // 関節腔内注射は第6部注射 → A001注8の列挙外なので外来管理加算を妨げない(告示準拠)。
        // トリガーポイント注射・神経ブロックは第11部麻酔 → 妨げる
        if (report.items.includes('inj')) perfCats.push('注射');
        if (report.items.includes('trig')) perfCats.push('麻酔');
        kbEval = REIMB.evaluateEncounter({
          patient: { seg }, specialty: settings.specialty,
          encounter: { visitType: report.type, performedCategories: perfCats },
          procedures: procs,
          facilityStandards: activeFsIds(),
          history: {}
        });
        for (const b of kbEval.billableItems) {
          const y = b.subtotal * 10;
          revenue += y;
          if (b.itemId.indexOf('r08-H002') === 0) {
            T.rev.reha += y;
            rc.push({ n: `${b.name} ${b.points}点×${b.units}単位`, t: b.subtotal, kb: b.itemId });
          } else {
            T.rev.consult += y;
            if (b.itemId === 'r08-A001-n8') T.kanriCount++;
            rc.push({ n: b.name, t: b.subtotal, kb: b.itemId });
          }
        }
        if (G.med && devWarn(kbEval.warnings).length) T._medWarn = true;
      } else {
        // フォールバック(KB未読込でもゲームは止めない): 従来の簡略ロジック
        if ((report.type === 'revisit' || report.type === 'rehab') && !didProcedure) {
          revenue += FEES.kanri; T.rev.consult += FEES.kanri; T.kanriCount++;
          rc.push({ n: '外来管理加算', t: FEES.kanri / 10 });
        }
        if (report._doRehaAct && settings.rehaLevel > 0) {
          const f = REHA_FEE[settings.rehaLevel];
          revenue += f; T.rev.reha += f;
          rc.push({ n: `${REHA_FULL[settings.rehaLevel]}×2単位`, t: f / 10 });
        }
      }
      // 体制の加算(再診料への加算): 明細書発行体制等(A001注11)・時間外対応体制(A001注10・R8で改称/4区分)。
      // 明細書×連携の排他(rule-0016)込みでKASAN_COREに一本化(保留#23)
      if (report.type === 'revisit' || report.type === 'rehab') {
        let add = 0;
        for (const k of KASAN_CORE.revisitLines(settings, kbPts)) { add += k.t * 10; rc.push({ n: k.n, t: k.t, kb: k.kb }); }
        if (add) { revenue += add; T.rev.consult += add; }
      }
      // 処方箋料(処方が出る患者)。外来後発医薬品使用体制加算はR8で廃止・再編
      // (F100注8の地域支援・外来医薬品供給対応体制加算=院内処方のみ対象。院外処方の当院は対象外=便H)
      const prescribed = (report.type === 'first' || report.type === 'revisit')
        ? Math.random() < 0.55
        : (report.type === 'rehab' && Math.random() < 0.15);
      if (prescribed) {
        revenue += FEES.presc; T.rev.consult += FEES.presc;
        rc.push({ n: '処方箋料', t: FEES.presc / 10, kb: 'r08-F400-3' });
      }

      // 画像(X線は初診中心、MRIは装置があれば。スポーツ層は精査率が高い)
      if ((report.type === 'first' && Math.random() < 0.7) || (report.type === 'revisit' && Math.random() < 0.08)) {
        revenue += FEES.xray; T.rev.img += FEES.xray; T.xrayCount++;
        if (KBI) {
          rc.push({ n: '写真診断(単純撮影・四肢)', t: kbPts('r08-E001-1-ro', 43), kb: 'r08-E001-1-ro' });
          rc.push({ n: '撮影(単純撮影・デジタル)', t: kbPts('r08-E002-1-ro', 68), kb: 'r08-E002-1-ro' });
          rc.push({ n: '電子画像管理加算(単純撮影)', t: kbPts('r08-E-denshi-tanjun', 57), kb: 'r08-E-denshi-tanjun' });
        } else {
          rc.push({ n: '単純X線撮影+画像診断', t: FEES.xray / 10 });
        }
      }
      // 運動器エコー: 装置があれば初診の精査で高頻度に(いまの整形の単価トレンド)。D215-2-ロ-(3)=KB登録済み(便H)
      if (settings.echo && report.type === 'first' && Math.random() < (seg === 'sports' ? 0.45 : 0.3)) {
        const p = kbPts('r08-D215-2-ro-3', 350);
        revenue += p * 10; T.rev.img += p * 10;
        rc.push({ n: '超音波検査(運動器エコー)', t: p, kb: 'r08-D215-2-ro-3' });
      }
      const mriMul = seg === 'sports' ? 1.6 : seg === 'worker' ? 1.1 : 0.85;
      if (settings.mri && T.mriCount < 8 && (report.type === 'first' || p.refer) && Math.random() < 0.3 * mriMul) {
        revenue += FEES.mri; T.rev.img += FEES.mri; T.mriCount++;
        if (KBI) {
          rc.push({ n: 'MRI撮影(1.5テスラ以上3テスラ未満)', t: kbPts('r08-E202-2', 1330), kb: 'r08-E202-2' });
          rc.push({ n: 'コンピューター断層診断', t: kbPts('r08-E203', 450), kb: 'r08-E203' });
          rc.push({ n: '電子画像管理加算(CT・MRI)', t: kbPts('r08-E-denshi-ct', 120), kb: 'r08-E-denshi-ct' });
        } else {
          rc.push({ n: 'MRI撮影+コンピューター断層診断', t: FEES.mri / 10 });
        }
      }
      // 骨粗鬆症プログラム(DEXA): 高齢初診の一部が継続診療に乗る
      if (settings.dexa && report.type === 'first' && Math.random() < (seg === 'senior' ? 0.25 : 0.05)) G.osteoPool++;

      // サイネージは体感待ち時間を削り、カフェは待ちの不満をやわらげる
      // 院長の声かけ(サービスリカバリー): 体感待ちが約35%やわらぐ
      const feltWait = report.wait * (report.soothed ? 0.65 : 1);
      let sat = clamp(1.25 - feltWait * waitFeel() / 40, 0, 1);
      if (G.deco.cafe) sat = Math.min(1, sat + 0.05);
      if (report.didReha) sat = Math.min(1, sat + 0.1);

      // 自費リハ延長(価格弾力性)
      if (report.didReha && settings.selfReha) {
        const pJihi = clamp((G.rep - 55) / 80, 0, 0.35) * clamp(1.7 - settings.selfRehaPrice / 9000, 0.15, 1.2);
        if (Math.random() < pJihi) { revenue += settings.selfRehaPrice; T.rev.jihi += settings.selfRehaPrice; rc.push({ n: '自費リハ延長(保険外)', y: settings.selfRehaPrice }); }
      }
      // 物販(原価60%)
      if (settings.goods && (report.items.includes('treat') || report.items.includes('reha'))) {
        if (Math.random() < 0.12 * clamp(G.rep / 70, 0.6, 1.3)) {
          revenue += FEES.goods; T.rev.jihi += FEES.goods; T.goodsCogs += FEES.goodsCogs;
          rc.push({ n: '物販: サポーター等(保険外)', y: FEES.goods });
        }
      }

      // 🧾 直近の会計(点数の学び)+ 月間集計へ反映
      rc.forEach((x) => acc(T, x.n, x.t, x.t ? undefined : x.y));
      G.lastReceipt = {
        type: report.type, seg,
        rc,
        ten: rc.reduce((a, r) => a + (r.t || 0), 0),
        yen: revenue,
        // 学習モード・算定詳細用: エンジン判定の要約(未算定とその理由・根拠つき)
        kb: kbEval ? {
          rejected: kbEval.rejectedItems.map((x) => ({ itemId: x.itemId, name: x.name, points: x.points, reasons: x.reasons, rules: x.rules, fsInfo: x.fsInfo })),
          warnings: kbEval.warnings, trace: kbEval.trace
        } : null
      };
      if (activeTab === 'clinic' && G.speed <= 4) renderReceipt();

      if (G.speed <= 2 && revenue > 0) SND.cash();
      T.revenue += revenue;
      T.patients++;
      T.waitSum += report.wait; T.waitN++;
      G.rep += (sat * 100 - G.rep) * 0.01;
      G.rep = Math.max(G.rep, repDailyFloor());

      const showBoost = settings.reserve ? 0.05 : 0;
      const loyalty = { senior: 0.55, worker: 0.32, sports: 0.42 }[seg] || 0.45; // 客層で再診定着が違う
      if ((report.type === 'first' || report.type === 'revisit') && !report.didReha && Math.random() < loyalty * sat + showBoost + 0.02 * relLv('pharmacy')) {
        addSchedule(G.day + 2 + Math.floor(Math.random() * 6), 'revisit');
      }
      if (report.didReha && report.type !== 'rehab') {
        for (let k = 1; k <= 8; k++) addSchedule(G.day + Math.ceil(k * 2.5), 'rehab');
      }
      if (report.type === 'rehab' && !report.didReha) addSchedule(G.day + 1, 'rehab'); // 満枠振替
      else if (report.type === 'rehab' && Math.random() < 0.12 * (1 - sat) * (1 - 0.15 * bondLv('reha'))) removeSchedule('rehab');
      updateHeader();
      return revenue;
    },
    // 混雑離脱: 待合が飽和して入口で引き返した患者(機会損失+評判に小ダメージ)
    onBalk() {
      const T = G.today;
      if (!T) return;
      T.balked++;
      G.rep = Math.max(repDailyFloor(), G.rep - 0.06);
    }
  });
  clinicIso.W = clinic.L.W; clinicIso.H = clinic.L.H;

  const town = new TOWN.TownSim({
    onPatientArrive(wk) { clinic.spawn(wk.type, { refer: wk.refer, seg: wk.seg }); }
  });

  /* ================= 1日の計画 ================= */

  function addSchedule(day, kind) {
    if (!G.schedule[day]) G.schedule[day] = { revisit: 0, rehab: 0 };
    G.schedule[day][kind]++;
  }
  function addScheduleBulk(day, due) {
    if (!G.schedule[day]) G.schedule[day] = { revisit: 0, rehab: 0 };
    G.schedule[day].revisit += due.revisit;
    G.schedule[day].rehab += due.rehab;
  }
  function removeSchedule(kind) {
    const days = Object.keys(G.schedule).map(Number).sort((a, b) => a - b);
    for (const d of days) {
      if (d > G.day && G.schedule[d][kind] > 0) { G.schedule[d][kind]--; return; }
    }
  }

  function wait7() {
    const h = G.history.slice(-7).filter((x) => x.kind !== 'closed');
    const n = h.reduce((a, d) => a + (d.patients || 0), 0);
    return n ? h.reduce((a, d) => a + d.avgWait * d.patients, 0) / n : 10;
  }

  function relLv(key) { return G.relations[key] ? G.relations[key].lv : 0; }

  function planDay() {
    // 本院の常連の月次/週次カウンタ(v66: 他科本院の管理料・検査の回数制限に使う)。30日=1月・7日=1週(部門と同じ区切り)
    if (typeof DEPT !== 'undefined') {
      const mi = DEPT.monthIdx(G.day), wi = DEPT.weekIdx(G.day);
      if (G.mainMi !== mi) { for (const r of (G.regulars || [])) if (r.mc) r.mc = {}; G.mainMi = mi; }
      if (G.mainWi !== wi) { for (const r of (G.regulars || [])) if (r.wc) r.wc = {}; G.mainWi = wi; }
    }
    const spec = specOf(G.day);
    G.daySpec = spec;
    G.today = newToday();
    G.adSpendToday = 0;
    G.repDayStart = G.rep;
    G.lastPulseT = 0;

    // 現場イベント(当日限りの効果をリセット→低確率で発生)
    G.evArrivalMul = 1; G.evExamDelta = 0; G.evRecepSlow = false; G.evPhysioDown = false; G.evExtraRefer = 0;
    settings.evExamDelta = 0; settings.evRecepSlow = false;
    // 前日の振り返りコメントは残し、古い報告だけ流す
    G.voiceFeed = (G.voiceFeed || []).filter((v) => v.kind === 'daily').slice(-1);
    if (spec.kind !== 'closed' && G.day > 3 && typeof STAFF_UI !== 'undefined') {
      const pool = STAFF_UI.STAFF_EVENTS.filter((ev) => (!ev.cond || ev.cond(G, settings)) && Math.random() < ev.p);
      if (pool.length) {
        const ev = pool[Math.floor(Math.random() * pool.length)];
        ev.apply(G, settings);
        settings.evExamDelta = G.evExamDelta || 0;
        settings.evRecepSlow = !!G.evRecepSlow;
        pushVoice(ev.char, ev.text, 'event');
        banner(`💬 ${STAFF_UI.STAFF[ev.char].name}「${ev.text}」`);
      }
    }

    // ブースト: 業務改善コンサル(診察回転UP)+ 院長(剣持)との信頼(診察が手際よく)
    if (boostActive('ops')) G.evExamDelta = (G.evExamDelta || 0) - 1.2;
    if (bondLv('doctor') > 0) G.evExamDelta = (G.evExamDelta || 0) - 0.15 * bondLv('doctor');
    if (DECI && G.dec) G.evExamDelta = (G.evExamDelta || 0) + DECISIONS.examDelta(G.dec, G.day); // 分岐点: 職員の余力と期間つき効果
    settings.evExamDelta = G.evExamDelta || 0;

    if (spec.kind === 'closed') {
      const due = G.schedule[G.day];
      if (due) {
        addScheduleBulk(G.day + 1, due);
        delete G.schedule[G.day];
      }
      G.arrivals = [];
      G.nextArrivalIdx = 0;
      return;
    }

    // 客層ミックス(ターゲット方針で商圏の獲得層が寄る)
    const baseMix = { senior: 0.55, worker: 0.33, sports: 0.12 };
    if (G.targetSeg !== 'balance') {
      baseMix[G.targetSeg] += 0.22;
      const tot = baseMix.senior + baseMix.worker + baseMix.sports;
      Object.keys(baseMix).forEach((k) => { baseMix[k] /= tot; });
    }
    const pickMix = (mix) => {
      const r = Math.random();
      return r < mix.senior ? 'senior' : r < mix.senior + mix.worker ? 'worker' : 'sports';
    };

    const arrivals = [];
    const push = (type, source, refer, seg) => arrivals.push({ t: 0, type, source, refer: !!refer, seg: seg || pickMix(baseMix) });
    const sundayBoost = weekdayOf(G.day) === 6 ? 1.3 : 1; // 日曜開院は競合が休み
    const wx = ensureWeather();

    // 自然新患(天気・流行イベントで増減)
    const share = G.rep / (G.rep + rivalRepNow());
    const campMul = boostActive('campaign') ? 1.5 : 1;
    const decMul = DECI && G.dec ? DECISIONS.newMul(G.dec, G.day) : 1; // 分岐点: 期間つきの新患倍率+地域の信頼(±2%/段)
    const nNew = Math.max(0, Math.round(52 * G.aw * share * spec.arr * sundayBoost * wx.newMul * (G.evArrivalMul || 1) * campMul * decMul + (Math.random() * 4 - 2)));
    for (let i = 0; i < nNew; i++) push('first', 'house');
    // 天気による転倒・外傷の初診(雨は少し、凍結は多い)
    for (let i = 0; i < frac(wx.falls * spec.arr); i++) push('first', 'house', false, Math.random() < 0.7 ? 'senior' : 'worker');

    // リスティング広告
    const report = {};
    const w7 = wait7();
    for (const kw of KEYWORDS) {
      const budget = G.ads[kw.id] || 0;
      const cpcEff = Math.round(kw.cpc * (1 + G.adPressure) * (1 - 0.02 * bondLv('advisor')));
      const clicks = budget > 0 ? Math.min(kw.vol, Math.floor(budget / cpcEff)) : 0;
      const cvrEff = kw.cvr * clamp(G.rep / 65, 0.5, 1.35) * (w7 > 25 ? 0.7 : 1);
      let pats = 0;
      for (let c = 0; c < clicks; c++) if (Math.random() < cvrEff) pats++;
      const spend = clicks * cpcEff;
      G.adSpendToday += spend;
      report[kw.id] = { spend, clicks, pats, cpcEff };
      const adSeg = kw.id === 'sports' ? 'sports' : kw.id === 'pain' ? (Math.random() < 0.55 ? 'worker' : 'senior') : null;
      for (let i = 0; i < pats; i++) push('first', kw.source, !!kw.reha, adSeg);
    }
    G.adReport = report;

    if (G.billboard) for (let i = 0; i < 1 + Math.round(Math.random()); i++) push('first', 'station', false, Math.random() < 0.6 ? 'worker' : 'senior');

    // プレミアム施設: キッズスペース(勤労・スポーツ世帯)・送迎バス(高齢者)
    if (G.deco.kids) for (let i = 0; i < 1 + frac(0.6); i++) push('first', 'house', false, Math.random() < 0.6 ? 'worker' : 'sports');
    if (G.deco.bus) for (let i = 0; i < 1 + frac(0.6); i++) push('first', 'house', false, 'senior');

    // 営業関係からの紹介(関係レベル依存・チャネルごとに客層が違う)
    for (let i = 0; i < (G.evExtraRefer || 0); i++) push('first', 'hospital', true, 'senior');
    for (let i = 0; i < relLv('hospital'); i++) push('first', 'hospital', true, Math.random() < 0.7 ? 'senior' : 'worker');
    // 地域の信頼(分岐点): 正のときだけ紹介が増える(0.3人/日/段の期待値)
    if (DECI && G.dec) for (let i = 0; i < frac(DECISIONS.trustReferrals(G.dec) * spec.arr); i++) push('first', 'hospital', true, 'senior');
    // ケアマネ・老健の紹介: 整形本院はリハ体制が前提。他科本院(v67)はリハ需要の無い高齢の新患として来る
    if (settings.rehaLevel > 0 || settings.specialty !== 'orthopedics') {
      const wantsReha = settings.specialty === 'orthopedics';
      for (let i = 0; i < frac(relLv('caremane') * 0.7); i++) push('first', 'caremane', wantsReha, 'senior');
      for (let i = 0; i < frac(relLv('rouken') * 0.7); i++) push('first', 'caremane', wantsReha, 'senior');
    }
    for (let i = 0; i < frac(relLv('company') * 1.5); i++) push('checkup', 'station', false, 'worker');
    for (let i = 0; i < frac(relLv('sports') * 0.6); i++) push('first', 'station', true, 'sports');
    for (let i = 0; i < frac(relLv('school') * 0.5); i++) push('first', 'station', false, 'sports');
    for (let i = 0; i < frac(relLv('houkatsu') * 0.5); i++) push('first', 'house', false, 'senior');

    // 再診・リハ(予約済み)
    const due = G.schedule[G.day] || { revisit: 0, rehab: 0 };
    const showRate = (0.75 + 0.2 * (G.rep / 100) + (settings.reserve ? 0.05 : 0) + (G.deco.bus ? 0.04 : 0) + 0.01 * bondLv('front') + (G.weather ? G.weather.show : 0)) * Math.min(1.1, G.evArrivalMul || 1);
    for (let i = 0; i < due.revisit; i++) if (Math.random() < showRate) push('revisit', 'house');
    for (let i = 0; i < due.rehab; i++) if (Math.random() < showRate) push('rehab', 'house');
    delete G.schedule[G.day];

    arrivals.forEach((a) => {
      a.t = settings.reserve ? 10 + Math.random() * (spec.intake - 30)
        : (Math.random() < 0.62 ? triRand(0, spec.intake * 0.5) : triRand(spec.intake * 0.5, spec.intake));
    });
    arrivals.sort((a, b) => a.t - b.t);
    G.arrivals = arrivals;
    G.nextArrivalIdx = 0;
  }

  /* ================= 分院(マクロ経営) ================= */

  function branchStaffCost(st) {
    return st.doctors * COSTS.doctorDay + st.nurses * COSTS.nurseDay + st.pts * COSTS.ptDay + st.receptionists * COSTS.recepDay;
  }

  // マップ上の3拠点以降は「郊外N号院」(マップ外・無制限)
  function siteOf(br) {
    return SITES.find((s) => s.id === br.siteId) || { id: br.siteId, name: br.name, rivalRep: 64, bigger: 1.05, rehaBias: 1.1 };
  }

  function branchKijunCheck(br) {
    const ok3 = br.staff.pts >= 4 && (br.floorLv || 1) >= 2;
    if (br.rehaLevel === 3 && !ok3) { br.rehaLevel = br.staff.pts >= 2 ? 2 : br.staff.pts >= 1 ? 1 : 0; return true; }
    if (br.rehaLevel === 2 && br.staff.pts < 2) { br.rehaLevel = br.staff.pts >= 1 ? 1 : 0; return true; }
    if (br.rehaLevel === 1 && br.staff.pts < 1) { br.rehaLevel = 0; return true; }
    return false;
  }

  /* 部門間の紹介の経路付け: 紹介先が法人内に開設済みで受け入れ余地があればパネルへ、
     無ければ他院へ紹介する(ケアは必ず成立する。他院での診療はこのゲームでは扱わない)。
     紹介の発生は患者ニーズ(モジュール側)が決め、ゲームが動かせるのは受け皿だけ */
  function routeReferral(ref) {
    const target = G.depts[ref.to];
    const tmod = typeof SPECIALTIES !== 'undefined' ? SPECIALTIES.get(ref.to) : null;
    let ok = false;
    if (target && tmod && tmod.status === 'full') {
      const P = tmod.managementParameters || {};
      if (ref.to === 'homecare') {
        // 在宅は地区(クラスタ)の空き枠が受け皿。満床なら他院の在宅医療機関へ
        const cl = homecareCtx(target).assignCluster();
        if (cl !== null) {
          const np = DEPT.addPatient(target, 'home', G.day, {
            fb: true, cl, o: 1 + Math.floor(Math.random() * 14),
            sj: Math.random() < (P.shijiRate || 0.4) ? 1 : 0,
          });
          np.nv = tmod._nextVisit(np, G.day);
          ok = true;
        }
      } else {
        const cap = (P.panelPerDoctor || 9999) * (target.staff.doctors || 1);
        if (target.pt.length < cap) {
          DEPT.addPatient(target, ref.profile, G.day, Object.assign({ nv: G.day + 3 + Math.floor(Math.random() * 5) }, ref.extra || {}));
          ok = true;
        }
      }
    }
    (G.referLog = G.referLog || []).push({ day: G.day, from: ref.from, to: ref.to, reason: ref.reason, ok });
    if (G.referLog.length > 120) G.referLog.shift();
    // 仕組みの発見は向きごとに一度だけ知らせる(以後は法人タブの記録が持つ)。本院→在宅は呼び出し側が毎回banner
    if (ref.from !== 'main') {
      const key = ref.from + '>' + (ok ? ref.to : 'out');
      G.referSeen = G.referSeen || {};
      if (!G.referSeen[key]) {
        G.referSeen[key] = 1;
        const fmod = SPECIALTIES.get(ref.from);
        const fname = fmod ? (fmod.short || fmod.name) : ref.from;
        const tname = tmod ? (tmod.short || tmod.name) : ref.to;
        banner(ok
          ? `🤝 ${fname}部門から${tname}部門へ紹介がありました — ${ref.reason}。記録は「🏢 法人」タブに`
          : `🤝 ${fname}部門から他院へ紹介しました — ${ref.reason}。記録は「🏢 法人」タブに`);
      }
    }
    return ok;
  }

  function branchRent(br) { const lv = br.floorLv || 1; return lv >= 3 ? 90000 : lv >= 2 ? 50000 : COSTS.branchRent; }

  function branchDay(br, spec) {
    const site = siteOf(br);
    if (branchKijunCheck(br)) { toast(`⚠️ ${br.name}: 施設基準の要件割れで降格しました(専従PT・面積)`); if (G.med) G.med.fsBroken++; }
    if (spec.kind === 'closed') {
      const cost = branchRent(br) + COSTS.branchBase + (br.mri ? COSTS.mriMaint : 0);
      br.last = { revenue: 0, cost, profit: -cost, visits: 0, reha: 0 };
      br.profit7.push(-cost);
      if (br.profit7.length > 7) br.profit7.shift();
      return { revenue: 0, cost, profit: -cost };
    }
    const f = spec.arr;
    const examCap = br.staff.doctors * 48 * f;
    const rivalNow = site.rivalRep + Math.min(10, Math.max(0, G.day - (br.openedDay || 0)) * 0.02);
    const share = br.rep / (br.rep + rivalNow);
    const nNewRaw = 42 * site.bigger * br.aw * share * f * (0.85 + Math.random() * 0.3);
    const revisRaw = br.revisitPool * f * (0.8 + Math.random() * 0.3);
    const visitsExam = Math.min(nNewRaw + revisRaw, examCap);
    const scale = (nNewRaw + revisRaw) > 0 ? visitsExam / (nNewRaw + revisRaw) : 0;
    const nNew = nNewRaw * scale, revis = revisRaw * scale;
    // リハ: 機器×PT稼働と、PT単位上限(1人24単位=12回)の両方でキャップ
    const rehaCap = Math.min(Math.min(br.machines, br.staff.pts * 2) * 26, br.staff.pts * 12) * f;
    const rehaVisits = Math.min(br.rehabPool, rehaCap);
    const rehaFee = REHA_FEE[br.rehaLevel];
    const starts = br.rehaLevel > 0 ? Math.min(visitsExam * (br.pReha || 0.35) * site.rehaBias, Math.max(0, rehaCap - rehaVisits)) : 0;
    // 分院ごとの診療方針(注射・物療)
    const injRev = visitsExam * (br.pInj || 0.2) * 2000;
    const physioN = Math.min(visitsExam * 0.45, (br.physio || 0) * 30 * f);
    const treats = visitsExam * 0.12 * Math.min(1, br.staff.nurses);
    const mriN = br.mri ? Math.min(nNew * 0.3, 6 * f) : 0;
    const load = visitsExam / Math.max(1, examCap);
    const sat = clamp(1.2 - load * 0.55, 0.35, 1);

    const revenue = Math.round(
      nNew * (FEES.first + FEES.xray * 0.6) + revis * 1500 +
      rehaVisits * (FEES.rehab + rehaFee) + treats * FEES.treat + injRev +
      physioN * FEES.physio + mriN * FEES.mri
    );
    const visits = Math.round(visitsExam + rehaVisits);
    const cost = Math.round(branchStaffCost(br.staff) * spec.pay + branchRent(br) + COSTS.branchBase + (br.mri ? COSTS.mriMaint : 0) + visits * COSTS.perPatient);
    const profit = revenue - cost;

    br.revisitPool = br.revisitPool * 0.55 + visitsExam * 0.45 * sat;
    br.rehabPool = Math.max(0, br.rehabPool - rehaVisits + starts * 7);
    br.rep = clamp(br.rep + (sat * 100 - br.rep) * 0.025, 20, 95);
    br.aw = clamp(br.aw + (br.rep >= 70 ? 0.006 : 0.0025) - 0.0045, 0.05, 0.95);
    br.last = { revenue, cost, profit, visits, reha: Math.round(rehaVisits) };
    br.profit7.push(profit);
    if (br.profit7.length > 7) br.profit7.shift();
    return { revenue, cost, profit };
  }

  // 病院(マクロ): 入院は「病床が埋まっている毎日」が売上。配置基準がそのまま稼働上限になる
  function hospitalDay(spec) {
    const h = G.hospital;
    const capPT = h.hospPTs * 6;      // PT 1人あたり6床(リハ提供体制)
    const capNurse = h.wardNurses * 5; // 病棟看護 1人あたり5床(看護配置)
    const usable = Math.max(0, Math.min(h.beds, capPT, capNurse));
    const demand = clamp(0.55 + h.rep / 250 + G.branches.length * 0.015 + relLv('hospital') * 0.02, 0.5, 0.95);
    const occupied = Math.round(usable * demand);
    const wardRev = occupied * WARD_FEE;
    // 外来は診療日のみ。病棟は年中無休(休診日も人件費85%はかかる)
    const orthoV = Math.round((20 + h.orthoDocs * 18) * spec.arr * (0.9 + Math.random() * 0.2));
    const orthoRev = orthoV * 5000;
    const naikaV = h.naika ? Math.round((15 + h.internists * 25) * spec.arr * (0.9 + Math.random() * 0.2)) : 0;
    const naikaRev = naikaV * 3500;
    const opeN = h.ope ? frac(h.surgeons * 0.45 * spec.arr) : 0;
    const opeRev = opeN * 750000;
    const revenue = Math.round(wardRev + orthoRev + naikaRev + opeRev);
    const staffCost = Math.round(((h.orthoDocs + h.internists + h.surgeons) * 120000 + h.hospPTs * 16000 + h.wardNurses * 18000) * Math.max(spec.pay, 0.85));
    const cost = Math.round(staffCost + 500000 + occupied * 2000);
    const profit = revenue - cost;
    h.rep = clamp(h.rep + ((usable >= h.beds * 0.8 ? 64 : 46) + demand * 38 - h.rep) * 0.02, 30, 95);
    h.last = { occupied, usable, demand, wardRev, orthoV, orthoRev, naikaV, naikaRev, opeN, opeRev, revenue, cost, profit, staffCost };
    return { revenue, cost, profit };
  }

  function corpStaff() {
    const total = { doctors: settings.doctors, nurses: settings.nurses, pts: settings.pts, receptionists: settings.receptionists };
    for (const br of G.branches) for (const k of Object.keys(total)) total[k] += br.staff[k];
    return total;
  }

  /* ================= 日次決算 ================= */

  function mainStaffCost() {
    return (settings.doctors - 1) * COSTS.doctorDay + settings.nurses * COSTS.nurseDay + settings.pts * COSTS.ptDay + settings.receptionists * COSTS.recepDay + (settings.rehaAides || 0) * 10000;
  }

  function loanInterestDay() {
    return G.loans.reduce((a, l) => a + l.principal * l.dailyRate, 0);
  }

  function dayCost() {
    const spec = G.daySpec || specOf(G.day);
    let c = COSTS.rent[settings.floorLv] + COSTS.base[settings.floorLv];
    c += mainStaffCost() * spec.pay * (weekdayOf(G.day) === 6 && spec.kind !== 'closed' ? 1.4 : 1);
    c += G.adSpendToday;
    if (G.billboard) c += COSTS.billboardDay;
    if (settings.mri) c += COSTS.mriMaint;
    c += loanInterestDay();
    if (DECI && G.dec) c += DECISIONS.dailyCost(G.dec, G.day); // 分岐点の継続費(手当・保守など。負なら削減)
    c += (G.today ? G.today.patients : 0) * COSTS.perPatient;
    c += G.today ? G.today.goodsCogs + G.today.jihiCogs + (G.today.labCogs || 0) + (G.today.surgCogs || 0) : 0;
    return Math.round(c);
  }

  // プール型・自由診療の収益(1日の締めで計上)
  function accrueDailyPrograms() {
    const T = G.today;
    const spec = G.daySpec;
    if (spec.kind === 'closed') return;
    if (settings.dexa && G.osteoPool > 0) {
      const visits = frac(G.osteoPool / 25 * spec.arr);
      T.osteoVisits = visits;
      T.revenue += visits * FEES.osteo;
      T.rev.osteo += visits * FEES.osteo;
      G.osteoPool = Math.max(0, G.osteoPool * 0.998);
    }
    if (settings.prpOn) {
      const demand = clamp((G.rep - 58) / 12, 0, 2.2) * clamp(1.55 - settings.prpPrice / 100000, 0.15, 1.3) * (1 + 0.25 * relLv('sports')) * spec.arr;
      const cases = frac(demand * (0.7 + Math.random() * 0.6));
      if (cases > 0) {
        T.prpCount = cases;
        T.revenue += cases * settings.prpPrice;
        T.rev.jihi += cases * settings.prpPrice;
        T.jihiCogs += cases * FEES.prpCogs;
      }
    }
    if (settings.agaOn) {
      const joins = frac(0.5 * clamp(G.aw * 1.5, 0.3, 1.2) * clamp(1.6 - settings.agaPrice / 12000, 0.2, 1.3) * spec.arr);
      G.agaPool = Math.max(0, G.agaPool + joins - frac(G.agaPool * 0.015));
      const rev = Math.round(G.agaPool * settings.agaPrice / 25 * spec.arr);
      T.revenue += rev;
      T.rev.jihi += rev;
      T.jihiCogs += Math.round(rev * 0.35);
    }
  }

  function endDay() {
    const T = G.today;
    const spec = G.daySpec || specOf(G.day);
    const endedDay = G.day;
    const repStart = G.repDayStart !== undefined ? G.repDayStart : G.rep;
    const prevOpen = G.history.filter((h) => h.kind !== 'closed').slice(-1)[0] || null;
    accrueDailyPrograms();
    if (DEPTI) mainSpecialtyDay(); // 本院眼科の白内障パイプライン(v74)
    // 医事課(佐伯)との信頼: 算定の取りこぼしを拾う(売上+0.3%/Lv)
    if (spec.kind !== 'closed' && bondLv('billing') > 0) {
      const pick = Math.round(T.revenue * 0.003 * bondLv('billing'));
      T.revenue += pick; T.rev.consult += pick;
    }
    // 📜 診療報酬改定の影響(カテゴリ別単価係数)
    if (spec.kind !== 'closed' && G.kaitei && G.kaitei.count > 0) {
      const k = G.kaitei;
      const adj = Math.round(
        T.rev.consult * (k.consult - 1) + T.rev.inj * (k.inj - 1) + T.rev.treat * (k.treat - 1) +
        T.rev.physio * (k.physio - 1) + T.rev.reha * (k.reha - 1) + T.rev.img * (k.img - 1)
      );
      if (adj) { T.kaiteiAdj = adj; T.revenue += adj; }
    }
    T.cost = dayCost();
    T.profit = T.revenue - T.cost;
    T.avgWait = T.waitN ? T.waitSum / T.waitN : 0;

    for (const br of G.branches) {
      const r = branchDay(br, spec);
      T.brRevenue += r.revenue;
      T.brProfit += r.profit;
    }
    if (G.hospital) {
      const r = hospitalDay(spec);
      T.brRevenue += r.revenue;
      T.brProfit += r.profit;
    }
    // 診療科部門(患者パネル型): 収益は全てエンジン算定+明示概算
    if (DEPTI) {
      for (const id of Object.keys(G.depts)) {
        const mod = SPECIALTIES.get(id);
        if (!mod || mod.status !== 'full' || !mod.runDay) continue;
        const dctx = { day: G.day, spec, rep: G.rep, aw: G.aw, rand: Math.random,
          hasDept: (did) => !!G.depts[did] };
        if (id === 'homecare') Object.assign(dctx, homecareCtx(G.depts[id]));
        const r = DEPT.runDay(mod, G.depts[id], dctx);
        T.brRevenue += r.revenue;
        T.brProfit += r.profit;
        for (const ev of r.events) if (ev.kind === 'fs_broken') { toast(`⚠️ ${mod.name}部門: ${ev.message}`); if (G.med) G.med.fsBroken++; }
        if (G.med && devWarn(r.warnings).length) T._medWarn = true;
        for (const ref of r.referrals || []) routeReferral(ref);
      }
    }
    // 通院困難化: 高齢の常連が通院を続けられなくなり、在宅医療へ移行する(発生率はゲーム上の仮定)。
    // 在宅部門があれば法人内の訪問診療へ、無ければ他院の在宅医療機関へ紹介する(ケアは必ず成立する)。
    // 本院からの紹介もB009は特別の関係(法人内)では算定できないため、収入には接続しない。
    // 卒業(治ってのお別れ)とは別の出来事: 評判は動かさず、記録もhandoverLogに分ける(designer裁定)
    if (G.regulars && G.regulars.length && spec.kind !== 'closed') {
      for (let i = G.regulars.length - 1; i >= 0; i--) {
        const rg = G.regulars[i];
        if (rg.seg !== 'senior' || rg.visits < 4) continue;
        if (Math.random() < 0.0015) {
          G.regulars.splice(i, 1);
          const ok = routeReferral({ to: 'homecare', from: 'main', profile: 'home', reason: '通院が難しくなった' });
          const nm = (rg.p && rg.p.name) || 'ある常連';
          const age = (rg.p && rg.p.age) || '';
          (G.handoverLog = G.handoverLog || []).push({ name: nm, age, ch: (rg.p && rg.p.chLabel) || '', visits: rg.visits, day: G.day, ok });
          if (G.handoverLog.length > 30) G.handoverLog.shift();
          banner(ok
            ? `🏠 ${nm}さん${age ? `(${age})` : ''}は通院が難しくなりました — これからは在宅部門が家に伺います`
            : `🏠 ${nm}さん${age ? `(${age})` : ''}は通院が難しくなりました — これからは他院の在宅診療が家に伺います`);
          break; // 1日1人まで
        }
      }
    }
    if (G.kaitei && G.kaitei.count > 0 && T.brRevenue) {
      const k = G.kaitei;
      const avg = (k.consult + k.inj + k.treat + k.physio + k.reha + k.img) / 6;
      const badj = Math.round(T.brRevenue * (avg - 1));
      if (badj) { T.brRevenue += badj; T.brProfit += badj; }
    }

    // 医療スコアの月内トラッカー: 診療日のうちKB整備メモ(needs_review系)が出た日を数える
    if (G.med && T.patients > 0) { G.med.days++; if (T._medWarn) G.med.warnDays++; }

    G.money += T.profit + T.brProfit;
    G.cum.revenue += T.revenue + T.brRevenue;
    G.cum.profit += T.profit + T.brProfit;
    G.history.push({
      day: G.day, wd: weekdayOf(G.day), kind: spec.kind,
      revenue: T.revenue, cost: T.cost, profit: T.profit,
      patients: T.patients, avgWait: T.avgWait, rehaCount: T.rehaCount,
      newCount: T.newCount, injCount: T.injCount, trigCount: T.trigCount,
      physioCount: T.physioCount, mriCount: T.mriCount, kanriCount: T.kanriCount,
      segS: T.segCounts.senior, segW: T.segCounts.worker, segP: T.segCounts.sports, balked: T.balked || 0, acct: T.acct,
      jihi: T.rev.jihi, staffCost: Math.round(mainStaffCost() * spec.pay), pts: settings.pts,
      brRevenue: T.brRevenue, brProfit: T.brProfit
    });

    if (spec.kind !== 'closed') {
      let dAw = G.adSpendToday / 10000 * 0.0015 - 0.005;
      if (G.billboard) dAw += 0.008;
      if (G.rep >= 70) dAw += 0.006; else if (G.rep >= 60) dAw += 0.003;
      if (settings.reviewCare) dAw += 0.003;
      dAw += 0.001 * relLv('shoutengai');
      // 🌟常連の口コミ: 顔なじみ(通院5回以上)が多いほど認知がじわっと広がる(上限+0.3%/日)
      const fans = (G.regulars || []).filter((r) => r.visits >= 5).length;
      dAw += Math.min(0.003, fans * 0.0001);
      if (boostActive('lucky')) dAw += 0.007;
      G.aw = clamp(G.aw + dAw, 0.05, 0.95);
      if (settings.reviewCare) G.rep = Math.min(100, G.rep + 0.15);
      const totalAds = Object.values(G.ads).reduce((a, b) => a + b, 0);
      G.adPressure = totalAds > 12000 ? Math.min(0.6, G.adPressure + 0.04) : Math.max(0, G.adPressure - 0.03);
    }

    // 営業関係の減衰(30日放置で1レベル冷める)
    const cooled = [];
    for (const [k, r] of Object.entries(G.relations)) {
      if (r.lv > 0 && G.day - r.last > 30) { r.lv--; r.last = G.day; cooled.push(REL_DEF[k].name); }
    }
    if (cooled.length) toast(`🥶 足が遠のいて関係が冷えました: ${cooled.join('・')}。定期訪問で戻せます`);

    // 施設基準チェック
    const cur = KIJUN.find((k) => k.lv === settings.rehaLevel);
    if (cur && !cur.ok(settings.pts, settings.floorLv)) {
      const next = [...KIJUN].reverse().find((k) => k.lv < settings.rehaLevel && k.ok(settings.pts, settings.floorLv));
      settings.rehaLevel = next ? next.lv : 0;
      toast(`⚠️ 施設基準の要件割れ — ${REHA_FULL[settings.rehaLevel]}に降格しました`);
      if (G.med) G.med.fsBroken++; // 医療評価: 本院の要件割れも数える(部門・分院と同じ範囲)
    }
    // 他科本院(v67): 届出済みの施設基準が要件を割れば適用から外す(部門と同じ fsEnforce)。fsEnforce は dept.fs を差し替えるので settings に書き戻す
    if (settings.specialty !== 'orthopedics' && DEPTI) {
      const mm = SPECIALTIES.get(settings.specialty);
      if (mm && mm.main && mm.fsDefs) {
        const shim = mainDeptShim(mm);
        const broken = DEPT.fsEnforce(mm, shim);
        settings.mainFs = shim.fs;
        for (const b of broken) {
          const fsx = REIMB.getFacilityStandard(b.fsId);
          toast(`⚠️ 施設基準の要件割れ — ${fsx ? (fsx.shortName || fsx.name) : b.fsId}を適用から外しました(${b.missing.join('・')})`);
          if (G.med) G.med.fsBroken++;
        }
      }
    }

    G.rep = clamp(G.rep, Math.max(15, repStart - 3), 97);
    if (spec.kind !== 'closed') G.blackStreak = (T.profit + T.brProfit) > 0 ? (G.blackStreak || 0) + 1 : 0;

    // 累計スタッツ(実績システムの土台)
    if (spec.kind !== 'closed') {
      const st = G.stats;
      st.patients += T.patients;
      st.newp += T.newCount;
      st.reha += T.rehaCount;
      st.inj += T.injCount + T.trigCount;
      st.mri += T.mriCount;
    }
    G.stats.revenue += T.revenue + T.brRevenue;

    dailyVoice();
    checkMission(T);
    checkAchievements();
    checkDailyChallenge(T);
    // リーグ称号はミッションより後(同日ならより大きな瞬間を前面に)
    if (spec.kind !== 'closed') checkLeague();

    if (G.day % 7 === 0 && G.history.length >= 8 && spec.kind !== 'closed') weeklyDigest();
    if (G.day % 30 === 0 && G.history.length >= 25) monthlyClose();

    if (G.money < -300000) {
      G.money += 1000000;
      G.loans.push({ principal: 1000000, dailyRate: 0.001, label: '緊急融資(高金利)' });
      showModal('🏦 緊急融資', `<p>資金がショートしました。銀行から <b>¥1,000,000</b> の緊急融資(日利0.1%)を受けました。</p><p class="modal-note">📖 追い込まれてからの借入は高くつく。事業計画があれば通常融資(低金利)を計画的に使えます。</p>`, '経営を続ける');
    }

    const corpProfit = T.profit + T.brProfit;
    if (spec.kind !== 'closed' && G.speed <= 2) SND.day();
    const wdName = WEEKDAYS[weekdayOf(G.day)];
    banner(spec.kind === 'closed'
      ? `Day ${G.day}(${wdName}) — 🌙 休診日(固定費 ${yen(Math.abs(corpProfit))})`
      : `Day ${G.day}(${wdName}) 終了 — 本院 ${yen(T.revenue)}${G.branches.length ? ` / 分院 ${yen(T.brRevenue)}` : ''} / 法人損益 <b class="${corpProfit >= 0 ? 'pos' : 'neg'}">${corpProfit >= 0 ? '+' : ''}${yen(corpProfit)}</b>`);

    G.day++;
    G.t = 0;
    clinic.rehaToday = 0;
    updateHomecareTown();
    decisionAfterDay(); // 🔀 経営の分岐点: 期日の来た遅延効果→相談を開く(開いている間はシムが止まる)
    if (G.day === 366 && !G.annualDone) {
      G.annualDone = true;
      G.coins += 10;
      const title = G.cum.revenue >= 250000000 ? '👑 地域医療の帝王(殿堂入り)'
        : G.cum.revenue >= 150000000 ? '🏆 名経営者'
        : G.cum.revenue >= 80000000 ? '🛡️ 堅実経営者' : '🎗️ 一年を生き抜いた経営者';
      showModal('🎊 Day 365 到達 — 年次決算', `
        <p class="modal-note">🎁 年次ボーナス: 🪙コイン+10</p>
        <div class="pnl-row"><span>年商(法人・365日)</span><b>${yen(G.cum.revenue)}</b></div>
        <div class="pnl-row"><span>年間損益</span><b>${G.cum.profit >= 0 ? '+' : ''}${yen(G.cum.profit)}</b></div>
        <div class="pnl-row"><span>拠点数</span><b>${1 + G.branches.length}</b></div>
        <div class="pnl-row"><span>法人スタッフ</span><b>医師${corpStaff().doctors}・PT${corpStaff().pts}ほか</b></div>
        <div class="lesson-box"><b>称号: ${title}</b><p>1年間の意思決定、おつかれさまでした。2年目はさらなる高みへ — 経営は続く。</p></div>
        ${shareBtnHtml()}`, '2年目へ');
      bindShare(`🎊 ${title} 「${G.clinicName}」Day365決算: 年商${yen(G.cum.revenue)}・拠点${1 + G.branches.length}`);
    }
    kaiteiCheck();
    planDay();

    // 段階解放(Day4・Day8)— 新しい打ち手のお披露目
    const stg = unlockStage();
    if (stg > (G.lastStage || 1)) {
      G.lastStage = stg;
      applyUnlocks();
      renderShop();
      announceStage(stg);
    } else if (spec.kind !== 'closed' && G.speed <= 2 && tutIdx < 0 && !$('modal').classList.contains('show')) {
      // 1日の結果画面(ミッション達成・週次サマリーの演出があるときは譲る)
      showResult(T, spec, prevOpen, endedDay, Math.round(G.rep - repStart));
    }

    save();
    renderPnl(); renderPlanner(); renderCorp(); renderAds(); renderKpiStrip(); renderStaffStrip(); renderTodo(); renderItems();
    updateHeader();
  }

  /* ================= 現場スタッフ(キャラクター) ================= */

  function pushVoice(charKey, text, kind) {
    G.voiceFeed = (G.voiceFeed || []).slice(-1);
    G.voiceFeed.push({ char: charKey, text, kind });
    renderVoice();
  }

  function staffCtx() {
    const opens = G.history.filter((h) => h.kind !== 'closed');
    const h = opens[opens.length - 1] || null;
    const examCapDay = Math.max(10, settings.doctors * (480 / (settings.examMean + 1.5)) * 0.72);
    return {
      h, s: settings, G,
      wait: h ? h.avgWait : 0,
      load: h ? h.patients / examCapDay : 0,
      standing: clinic.standingCount(),
      rehaUtil: h && clinic.rehaCap() > 0 ? h.rehaCount / clinic.rehaCap() : 0,
      labor: h && h.revenue > 0 ? (h.staffCost || 0) / h.revenue : 0,
      profit: h ? h.profit + (h.brProfit || 0) : 0
    };
  }

  // 湊(リハ・物療担当)は整形本院だけ(v67): 内科本院には彼が翻訳すべきボトルネックが無い=肩書だけ残す中間は取らない(第14条)
  const staffVisible = (k) => k !== 'reha' || settings.specialty === 'orthopedics';
  function renderStaffStrip() {
    const el = $('staffStrip');
    if (!el || typeof STAFF_UI === 'undefined') return;
    const c = staffCtx();
    el.innerHTML = Object.entries(STAFF_UI.STAFF).filter(([k]) => staffVisible(k)).map(([k, st]) => {
      const mood = st.mood(c);
      const lv = bondLv(k);
      const pts = (G.bonds && G.bonds[k]) || 0;
      return `<span class="staff-chip mood-${mood}" title="${st.title} ${st.name} / 信頼${pts}pt(Lv${lv}) ${BOND_FX[k] || ''}">${STAFF_UI.faceSVG(k, mood, 34)}<span class="staff-meta"><small>${st.title}</small><b>${st.name}・${STAFF_UI.MOOD_LABEL[mood]}${lv ? ` <i class="bond-hearts">${'♥'.repeat(lv)}</i>` : ''}${(G.specialDone || []).includes(k) ? '<i class="sp-star">★</i>' : ''}</b></span></span>`;
    }).join('');
  }

  function dailyVoice() {
    if (typeof STAFF_UI === 'undefined') return;
    const c = staffCtx();
    if (!c.h || c.h.patients === 0) return;
    if (!G.voiceLog) G.voiceLog = [];
    const recent = new Set(G.voiceLog.filter((v) => v.day > G.day - 5).map((v) => v.id));
    let best = null;
    for (const [k, st] of Object.entries(STAFF_UI.STAFF)) {
      if (!staffVisible(k)) continue;
      for (const cm of st.comments) {
        if (recent.has(cm.id)) continue;
        let ok = false;
        try { ok = cm.cond(c); } catch (e) { ok = false; }
        if (!ok) continue;
        if (!best || cm.prio > best.cm.prio) best = { k, cm };
      }
    }
    if (best) {
      G.voiceLog.push({ id: best.cm.id, day: G.day });
      if (G.voiceLog.length > 30) G.voiceLog.shift();
      pushVoice(best.k, best.cm.text(c), 'daily');
    }
  }

  function renderVoice() {
    const card = $('voiceCard');
    if (!card || typeof STAFF_UI === 'undefined') return;
    const feed = (G.voiceFeed || []).filter((v) => staffVisible(v.char));
    card.hidden = feed.length === 0;
    const c = staffCtx();
    $('voiceBody').innerHTML = feed.map((v) => {
      const st = STAFF_UI.STAFF[v.char];
      const mood = v.kind === 'event' ? 'idea' : st.mood(c);
      return `<div class="voice-row">${STAFF_UI.faceSVG(v.char, mood, 44)}<div class="voice-txt"><small>${st.title} ${st.name}${v.kind === 'event' ? ' — 現場から報告' : ' — 今日の振り返り'}</small><p>${v.text}</p></div></div>`;
    }).join('');
  }

  /* ================= 📈 ライブモニター(日中のリアルタイム描画) ================= */

  const PULSE_COLORS = { n: '#3E7CA6', w: '#C4574E', r: '#3A8A70' };

  function renderPulse() {
    const cv = $('pulseChart');
    if (!cv) return;
    const T = G.today;
    const data = (T && T.pulse) || [];
    const spec = G.daySpec || specOf(G.day);
    const cssW = cv.parentElement.clientWidth - 36;
    const cssH = 110;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.style.width = cssW + 'px';
    cv.style.height = cssH + 'px';
    cv.width = cssW * dpr;
    cv.height = cssH * dpr;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const lg = $('pulseLegend');
    if (!data.length) {
      ctx.fillStyle = '#7C929E';
      ctx.font = '600 11.5px "Noto Sans JP", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('リアルタイム運転中(×1〜×4)に描画されます', cssW / 2, cssH / 2);
      if (lg) lg.innerHTML = '';
      return;
    }
    const totalMin = Math.max(spec.min || 480, 60);
    const x = (t) => (t / totalMin) * cssW;
    const maxN = Math.max(10, ...data.map((d) => d.n));
    const maxW = Math.max(30, ...data.map((d) => d.w));
    const maxR = Math.max(30000, ...data.map((d) => d.r));
    const yOf = (v, max) => cssH - 4 - (v / max) * (cssH - 12);
    // 院内人数(面)
    ctx.beginPath();
    ctx.moveTo(x(data[0].t), cssH - 4);
    data.forEach((d) => ctx.lineTo(x(d.t), yOf(d.n, maxN)));
    ctx.lineTo(x(data[data.length - 1].t), cssH - 4);
    ctx.closePath();
    ctx.fillStyle = 'rgba(62,124,166,0.16)';
    ctx.fill();
    const line = (key, max, color, width) => {
      ctx.beginPath();
      data.forEach((d, i) => { const px = x(d.t), py = yOf(d[key], max); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
      ctx.strokeStyle = color;
      ctx.lineWidth = width || 1.8;
      ctx.stroke();
    };
    line('n', maxN, PULSE_COLORS.n, 1.6);
    line('w', maxW, PULSE_COLORS.w, 1.8);
    line('r', maxR, PULSE_COLORS.r, 1.8);
    // 待ち30分の警戒ライン
    if (maxW > 30) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(196,87,78,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, yOf(30, maxW));
      ctx.lineTo(cssW, yOf(30, maxW));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // 打ち手マーカー: 操作した瞬間を▼で刻む(打ち手と波形の因果を見る)
    const evs = (T && T.pulseEv) || [];
    ctx.textAlign = 'center';
    evs.forEach((ev) => {
      const ex = x(ev.t);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(201,138,45,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ex, 12);
      ctx.lineTo(ex, cssH - 4);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '10px sans-serif';
      ctx.fillText(ev.icon, ex, 10);
    });
    const last = data[data.length - 1];
    if (lg) lg.innerHTML = `
      <span style="color:${PULSE_COLORS.n}">● 院内 <b>${last.n}人</b></span>
      <span style="color:${PULSE_COLORS.w}">● いまの平均待ち <b>${last.w}分</b></span>
      <span style="color:${PULSE_COLORS.r}">● 売上 <b>${yen(last.r)}</b></span>
      ${evs.slice(-4).map((ev) => `<span class="pulse-ev">${ev.icon} ${fmtClock(ev.t)} ${ev.label}</span>`).join('')}`;
  }

  /* ================= 📜 診療報酬改定(365日ごと・制度は動く) ================= */

  // 現実の改定でよくある方向性をパターン化。年次決算の2日後に2つ抽選して施行
  const KAITEI_POOL = [
    { name: 'リハビリテーション料の適正化', spec: 'orthopedics', fx: { reha: 0.96 }, note: '運動器リハの評価引き下げ。量から質(アウトカム)への圧力' },
    { name: '外来機能・かかりつけの評価強化', fx: { consult: 1.02 }, note: '初再診・継続管理への評価が引き上げ' },
    { name: '画像診断の適正化', fx: { img: 0.94 }, note: 'MRI・X線の評価引き下げ。「必要性の説明」がより重要に' },
    { name: '注射・処置の見直し', fx: { inj: 0.97, treat: 0.98 }, note: '注射・処置の一部が引き下げ' },
    { name: '物理療法の包括化圧力', spec: 'orthopedics', fx: { physio: 0.95 }, note: '消炎鎮痛等処置の評価見直し' },
    { name: '運動器リハの評価引き上げ', spec: 'orthopedics', fx: { reha: 1.03 }, note: 'アウトカム実績のあるリハへの評価アップ' },
    { name: '地域連携・紹介の加算拡充', fx: { consult: 1.015 }, note: '紹介・情報連携への評価が上がる' },
    { name: '検査の包括範囲拡大', fx: { img: 0.97, inj: 0.99 }, note: '出来高だった項目の一部が包括に' }
  ];
  const KAITEI_CAT = { consult: '初再診・管理料', inj: '注射', treat: '処置', physio: '物療', reha: 'リハ', img: '画像' };

  function applyKaitei() {
    const k = G.kaitei;
    const picks = [];
    const pool = KAITEI_POOL.filter((x) => !x.spec || x.spec === settings.specialty); // 科に無いカテゴリの改定は出さない(v73)
    for (let i = 0; i < 2 && pool.length; i++) picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    const changes = [];
    picks.forEach((p) => {
      Object.entries(p.fx).forEach(([cat, mul]) => {
        const before = k[cat];
        k[cat] = clamp(Math.round(k[cat] * mul * 1000) / 1000, 0.85, 1.12);
        changes.push(`${KAITEI_CAT[cat]} ${k[cat] > before ? '+' : ''}${Math.round((k[cat] / before - 1) * 100)}%`);
      });
    });
    k.count++;
    k.log.push({ day: G.day, names: picks.map((p) => p.name) });
    SND.day();
    showModal(`📜 診療報酬改定(第${k.count}次)`, `
      <p>2年に一度、<b>診療報酬(点数)は国が改定します</b>。今回の改定内容:</p>
      ${picks.map((p) => `<div class="pnl-row"><span>📌 ${p.name}</span></div><p class="pnl-note">${p.note}</p>`).join('')}
      <div class="pnl-row"><span>単価への影響</span><b>${changes.join(' / ')}</b></div>
      <div class="pnl-row"><span>現在の累積係数</span><b>${Object.keys(KAITEI_CAT).map((c) => `${KAITEI_CAT[c]}${Math.round((k[c] - 1) * 100) >= 0 ? '+' : ''}${Math.round((k[c] - 1) * 100)}%`).join(' ')}</b></div>
      <p class="modal-note">📖 経営は制度の上に乗っている。下がった項目を嘆くより、上がった項目に体制を寄せるのが改定対応 — 2年ごとの「ルール変更に強い経営」こそ本当の実力。</p>`,
      '改定に対応する');
    banner(`📜 診療報酬改定がありました(${changes.join(' / ')})。影響はP&Lで確認できます`);
  }

  function kaiteiCheck() {
    // 年次決算(Day366)の2日後に施行: Day368, 733, 1098…
    if (G.day <= 367) return;
    const due = Math.floor((G.day - 3) / 365);
    if ((G.kaitei.count || 0) < due) applyKaitei();
  }

  /* ================= 🧾 月間レセプト集計(算定項目ランキング) ================= */

  function renderAcct() {
    const el = $('acctBody');
    if (!el) return;
    const agg = {};
    G.history.slice(-30).forEach((h) => {
      if (!h.acct) return;
      Object.entries(h.acct).forEach(([k, v]) => {
        const a = agg[k] = agg[k] || { n: 0, ten: 0, yen: 0 };
        a.n += v.n; a.ten += v.ten; a.yen += v.yen;
      });
    });
    const rows = Object.entries(agg).sort((a, b) => b[1].yen - a[1].yen);
    if (!rows.length) {
      el.innerHTML = '<p class="plan-lead">まだ実績がありません。1日診療すると、算定項目ごとの件数×点数がここに積み上がります。</p>';
      return;
    }
    const total = rows.reduce((a, [, v]) => a + v.yen, 0);
    el.innerHTML = `
      <p class="plan-lead">直近30日の算定内訳(件数×点数)。<b>どの行為が収益の柱か</b> — 実際のレセプト分析と同じ視点で読む。</p>
      ${rows.slice(0, 16).map(([k, v]) => `
        <div class="acct-row">
          <div class="acct-info">
            <span class="acct-name">${k}</span>
            <div class="acct-bar"><i style="width:${Math.max(1, v.yen / total * 100).toFixed(1)}%"></i></div>
          </div>
          <span class="acct-n">${v.n.toLocaleString()}件${v.ten ? `<small>${v.ten.toLocaleString()}点</small>` : '<small>保険外</small>'}</span>
          <b class="acct-yen">${yen(v.yen)}</b>
        </div>`).join('')}
      ${rows.length > 16 ? `<p class="pnl-note">ほか${rows.length - 16}項目</p>` : ''}
      <div class="pnl-row total"><span>合計(直近30日・本院)</span><b>${yen(total)}</b></div>
      <p class="pnl-note">📖 レセプト分析の第一歩は「件数×単価」への分解。件数が多い低単価(物療)と、件数が少ない高単価(MRI・リハ)の両輪で単価は作られる。</p>`;
  }

  /* ================= 👤 患者タップ(現場介入: 院長の声かけ) ================= */

  const PHASE_JP = {
    walk: '移動中', recepQ: '受付待ち', recep: '受付中', waitExam: '診察待ち', exam: '診察中',
    waitTreat: '処置待ち', treat: '処置中', waitReha: 'リハ待ち', reha: 'リハ中', cashQ: '会計待ち', cash: '会計中'
  };
  const ITEM_JP = { inj: '関節注', trig: 'トリガー/ブロック', treat: '処置', reha: 'リハ' };
  const SOOTHE_MAX = 3;

  function showPatientModal(p) {
    const used = G.today.soothe || 0;
    const waiting = p.phase === 'recepQ' || p.phase === 'waitExam' || p.phase === 'waitTreat' || p.phase === 'waitReha' || p.phase === 'cashQ';
    const can = used < SOOTHE_MAX && !p.soothed && waiting;
    const pe = p.persona;
    const title = pe ? `👤 ${pe.name}さん(${pe.age}) — ${TYPE_NAMES[p.type] || '患者'}` : `👤 ${TYPE_NAMES[p.type] || '患者'}の患者さん(${SEG_NAMES[p.seg] || ''})`;
    const isRegular = pe && pe.visits >= 5;
    const speech = pe && typeof PERSONA !== 'undefined'
      ? `<div class="persona-speech">「${isRegular && (G.day + pe.age) % 2 === 0
        ? PERSONA.regularLine(pe)
        : PERSONA.patientLine(pe, PERSONA.ctxOf(p), { wait: p.waitTotal, variant: G.day })}」</div>` : '';
    showModal(title, `
      ${speech}
      ${pe ? `<div class="pnl-row"><span>主訴</span><b>${pe.complaint}</b></div>
      <div class="pnl-row"><span>ひとこと</span><b>${pe.job}・${pe.chLabel}(${SEG_NAMES[p.seg] || ''})</b></div>
      ${pe.visits ? `<div class="pnl-row"><span>通院</span><b>${pe.visits}回目${isRegular ? ' 🌟常連さん' : ''}</b></div>` : ''}` : ''}
      <div class="pnl-row"><span>いまの状態</span><b>${PHASE_JP[p.phase] || p.phase}</b></div>
      <div class="pnl-row"><span>ここまでの待ち時間</span><b class="${p.waitTotal > 30 ? 'neg-t' : ''}">${Math.round(p.waitTotal)}分</b></div>
      ${p.items.length ? `<div class="pnl-row"><span>実施済み</span><b>${p.items.map((i) => ITEM_JP[i] || i).join('・')}</b></div>` : ''}
      ${p.soothed
        ? '<p class="modal-note">🙏 声かけ済み — 体感待ちがやわらいでいます。</p>'
        : `<p class="modal-note">⚡ <b>院長の声かけ</b>(残り${SOOTHE_MAX - used}回/日): 待たせている理由を説明して一言お詫びすると、<b>体感待ち時間が約35%やわらぐ</b>。待ち時間そのものより「放置された感」が離反を生む — サービスリカバリーの基本。</p>
        ${waiting ? `<div class="modal-actions"><button class="btn-cta" id="sootheBtn" ${can ? '' : 'disabled'}>🙏 声をかける(残り${SOOTHE_MAX - used})</button></div>` : ''}`}`,
      '閉じる');
    const sb = $('sootheBtn');
    if (sb) sb.addEventListener('click', () => {
      if ((G.today.soothe || 0) >= SOOTHE_MAX || p.soothed) return;
      G.today.soothe = (G.today.soothe || 0) + 1;
      p.soothed = true;
      clinic.floats.push({ x: p.x, y: p.y - 0.6, text: '🙏', t: 0 });
      pushPulseEv('🙏', '院長の声かけ');
      SND.coin();
      $('modal').classList.remove('show');
      const reply = p.persona && typeof PERSONA !== 'undefined'
        ? `${p.persona.name}さん「${PERSONA.patientLine(p.persona, 'soothe', { variant: G.day })}」`
        : 'この患者さんの体感待ちがやわらぎます';
      toast(`🙏 ${reply}`);
    });
  }

  /* ================= 🧾 レセプト表示・加算届出(算定の学び) ================= */

  const TYPE_NAMES = { first: '初診', revisit: '再診', rehab: 'リハ再診', checkup: '健診' };

  function renderReceipt() {
    const card = $('receiptCard');
    const el = $('receiptBody');
    if (!card || !el) return;
    const r = G.lastReceipt;
    if (!r) { card.hidden = true; return; }
    card.hidden = false;
    const learn = !!settings.learnMode;
    const open = KBI && (learn || G.receiptDetailOpen);

    // 明細行: KB読込済みかつKB項目の行だけを「実点数(出典あり)」として扱う。
    // それ以外の点数行は教育用概算(KB未読込時は全行が概算表示になる)
    const isKb = (x) => KBI && x.kb;
    const rows = r.rc.map((x) => `<div class="rcpt-row${isKb(x) ? ' kb' : ''}"><span>${x.n}${isKb(x) ? '' : (x.t ? ' <i class="sim-tag">概算</i>' : '')}</span><b>${x.t ? `${x.t.toLocaleString()}点` : yen(x.y)}</b></div>`).join('');

    // 算定詳細(学習モード/トグルで展開): 根拠・未算定とその理由
    let detail = '';
    if (open) {
      const pageOf = (ev) => (ev && ev.page ? String(ev.page).replace(/^PDF\s*/, '') : '');
      const usedDocs = [];
      const evRows = r.rc.filter((x) => x.kb).map((x) => {
        const it = REIMB.getItem(x.kb);
        const ev = it && it.evidence && (it.evidence.find((e) => e.field === 'points') || it.evidence[0]);
        const doc = ev && REIMB.docOf(ev.doc);
        if (doc && !usedDocs.includes(doc.title)) usedDocs.push(doc.title);
        return `<div class="kb-ev"><b>${it ? it.name : x.kb}</b> <small>${it && it.kubun ? `[${it.kubun}]` : ''}${ev ? ` ${pageOf(ev)}` : ''}</small>
          ${it && it.conditions ? `<p class="kb-cond is-note">条件: ${it.conditions}</p>` : ''}
          ${ev ? `<p class="kb-quote">「${ev.quote}」</p>` : ''}
        </div>`;
      }).join('');
      const rejected = (r.kb && r.kb.rejected) || [];
      const rejRows = rejected.map((x) => `<div class="kb-reject">
          <b>未算定: ${x.name}</b>${x.points != null ? ` <small>(+${x.points.toLocaleString()}点の余地)</small>` : ''}
          <p class="kb-cond">理由: ${x.reasons.join(' / ')}</p>
          ${x.fsInfo ? `<p class="kb-cond">必要条件: ${x.fsInfo.staffing || ''}${x.fsInfo.formNo ? `(届出: ${x.fsInfo.formNo})` : ''}</p>` : ''}
          ${x.rules && x.rules[0] && x.rules[0].quote ? `<p class="kb-quote">「${x.rules[0].quote}」</p>` : ''}
        </div>`).join('');
      const warn = playerWarn(r.kb && r.kb.warnings);
      const dwarn = G.debugMode ? devWarn(r.kb && r.kb.warnings) : [];
      detail = `<div class="rcpt-detail">
        ${evRows}${rejRows}
        ${warn.length ? `<p class="kb-cond">⚠ ${warn.map((w) => w.message).join(' / ')}</p>` : ''}
        ${dwarn.length ? `<p class="kb-cond">dev: ${dwarn.map((w) => w.message).join(' / ')}</p>` : ''}
        <p class="rcpt-note">出典: ${usedDocs.join(' / ') || '令和8年度診療報酬KB'}。「概算」の行はKB未登録の教育用簡略値</p>
        ${G.debugMode && r.kb ? `<pre class="kb-trace">${JSON.stringify(r.kb.trace, null, 1)}</pre>` : ''}
      </div>`;
    }

    el.innerHTML = `
      <div class="rcpt-head"><span class="rcpt-head-t"><b>${TYPE_NAMES[r.type] || r.type}</b> <small>${SEG_NAMES[r.seg] || ''}の患者さん</small></span>
        <span class="rcpt-tools">
          <button class="mini-btn${learn ? ' plus' : ''}" id="learnModeBtn" title="診療報酬の根拠を常に表示">🎓 学習モード${learn ? 'ON' : ''}</button>
          ${learn || !KBI ? '' : `<button class="mini-btn" id="rcptDetailBtn">${open ? '閉じる' : '📖 算定詳細'}</button>`}
        </span>
      </div>
      ${rows}
      <div class="rcpt-row total"><span>合計${r.ten ? `(${r.ten.toLocaleString()}点)` : ''}</span><b>${yen(r.yen)}</b></div>
      ${detail}
      ${open ? '' : `<p class="rcpt-note">1点=10円・全国一律の公定価格${KBI ? '。点数は令和8年度診療報酬KB(告示・通知の一次資料照合済み)に同期' : '(教育用の概算)'}</p>`}`;
    const lb = $('learnModeBtn');
    if (lb) lb.addEventListener('click', () => { settings.learnMode = !settings.learnMode; save(); renderReceipt(); });
    const db = $('rcptDetailBtn');
    if (db) db.addEventListener('click', () => { G.receiptDetailOpen = !G.receiptDetailOpen; renderReceipt(); });
  }

  // 施設基準・届出(運動器リハ以外の加算): 小さな点数も「仕組み」で積み上がる。
  // 点数・区分は令和8年度KBに同期(時間外対応体制加算はR8で改称・4区分。ゲームは3と1の2段を採用)。
  // 外来後発医薬品使用体制加算はR8で廃止・再編(院内処方向けの地域支援・外来医薬品供給対応体制加算へ。
  // 院外処方の当院は対象外)のため届出メニューから外した(便H)
  // 届出可否はKASAN_CORE.ok(純関数)に委譲(保留#23でテスト固定)。ctxはここで組む
  const kasanCtx = () => ({
    kasanMeisai: settings.kasanMeisai, kasanRenkei: settings.kasanRenkei,
    kasanJikangai: settings.kasanJikangai, receptionists: settings.receptionists,
    homecareZaishien: !!(G.depts && G.depts.homecare && (G.depts.homecare.fs || []).includes('r08-fs-zaishien')),
  });
  const KASAN = [
    { id: 'meisai', name: '明細書発行体制等加算', ten: '再診ごと+1点', cost: 0,
      req: '電子請求+詳細な明細書の無償交付+院内掲示(届出不要)',
      verb: '体制を整える', doneLabel: '体制あり',
      done: () => settings.kasanMeisai, ok: () => KASAN_CORE.ok.meisai(kasanCtx()), apply: () => { settings.kasanMeisai = true; } },
    { id: 'jikangai3', name: '時間外対応体制加算3', ten: '再診ごと+4点', cost: 50000,
      req: '標榜時間外の夜間の数時間の電話等対応体制(様式2)',
      done: () => settings.kasanJikangai >= 1, ok: () => KASAN_CORE.ok.jikangai3(kasanCtx()), apply: () => { settings.kasanJikangai = 1; } },
    { id: 'jikangai1', name: '時間外対応体制加算1', ten: '再診ごと+7点', cost: 150000,
      req: '常勤職員等による常時の電話等対応体制(様式2)', gameReq: '受付2名以上・時間外対応体制加算3を届出済み',
      done: () => settings.kasanJikangai === 2, ok: () => KASAN_CORE.ok.jikangai1(kasanCtx()), apply: () => { settings.kasanJikangai = 2; } },
    { id: 'kyoka', name: '機能強化加算', ten: '初診ごと+80点', cost: 200000,
      req: 'かかりつけ機能に係る届出((2)ア〜キのいずれか)ほか、常勤医師の配置・掲示・業務継続計画の策定等(様式1の3)',
      gameReq: '在宅部門を開設し在支診の届出があること(制度の要件キに相当)。実績要件と(3)〜(7)はゲームでは判定しない',
      done: () => settings.kasanKyoka,
      ok: () => KASAN_CORE.ok.kyoka(kasanCtx()),
      apply: () => { settings.kasanKyoka = true; } },
    { id: 'renkei', name: '電子的診療情報連携体制整備加算3', ten: '初診ごと+4点(患者ごと月1回)', cost: 300000,
      req: '医療DX推進に係る体制(第1の8-3=区分3/様式1の6)。明細書発行体制等加算とは併算定できない(A000注16)',
      gameReq: '明細書発行体制が前提。マイナ保険証利用率30%は満たした扱い、届出後は明細書1点を一律に取り下げる(安全側/ゲーム上の仮定)',
      hint: '損得: 初診+4点と再診+1点の入れ替え。初診と再診の比率で変わる', // hintはこの行だけ残す(損得の向きが逆転しうる唯一の行=第8条・editor v69)
      done: () => settings.kasanRenkei, ok: () => KASAN_CORE.ok.renkei(kasanCtx()),
      apply: () => { settings.kasanRenkei = true; } }
  ];

  /* ================= 段階解放(Day1-3 / 4-7 / 8+) ================= */

  function unlockStage() { return G.day >= 8 ? 3 : G.day >= 4 ? 2 : 1; }
  const STAGE_SHOP = { recep: 1, chairs: 1, doctor: 2, nurse: 2, beds: 2, physio: 2, pt: 3, machines: 3, rehaAide: 3 };

  function applyUnlocks() {
    const stage = unlockStage();
    const vis = (id, need) => { const el = $(id); if (el) el.style.display = stage >= need ? '' : 'none'; };
    const corpBtn = document.querySelector('.tab-btn[data-tab="corp"]');
    if (corpBtn) corpBtn.style.display = stage >= 3 ? '' : 'none';
    vis('jihiCard', 3);
    vis('salesCard', 2);
    vis('adTarget', 2);
    vis('itemCard', 2);
    vis('achCard', 2);
    vis('prestigeCard', 3);
    vis('leagueCard', 3);
    vis('acctCard', 3);
    ['kpiCard', 'plannerCard', 'bankCard', 'pnlCard', 'kijunCard'].forEach((id) => vis(id, 3));
    const lock = $('mgmtLock');
    if (lock) lock.hidden = stage >= 3;
    ['opWeb', 'opKiosk', 'opReview'].forEach((id) => vis(id, 2));
    const orthoMain = settings.specialty === 'orthopedics';
    const slider = (id, need, orthoOnly) => {
      const el = $(id);
      if (el) { const w = el.closest('.ctrl'); if (w) w.style.display = (stage >= need && (!orthoOnly || orthoMain)) ? '' : 'none'; }
    };
    slider('pInj', 2, true); slider('pTrig', 2, true); slider('pPhysio', 2, true); slider('pTreat', 2, true); slider('pReha', 3, true);
    renderPolicyCard();
  }

  function announceStage(stage) {
    const body = stage === 2
      ? `<p>Day 4 — 現場が回り始めたので、打ち手が増えます。</p>
         <ul class="unlock-list">
           <li>🧑‍⚕️ <b>採用</b>(医師・看護師)と設備</li>
           <li>💉 <b>診療方針</b> — 単価はここで作る</li>
           <li>📱 <b>Web問診・自動精算機・クチコミ返信</b> — 受付の詰まり対策</li>
           <li>🤝 <b>営業まわり・ターゲット客層</b>(タウン)</li>
           <li>🪙 <b>アイテム・プレミアム施設・実績</b> — コインはミッションと実績で獲得</li>
         </ul>
         <p class="modal-note">📖 打ち手は詰まっている所に。案内は「今日やること」</p>`
      : `<p>Day 8 — ここからが経営の本番です。</p>
         <ul class="unlock-list">
           ${settings.specialty === 'orthopedics' ? '<li>🏃 <b>運動器リハ</b>(PT採用・リハ機器・施設基準の届出)</li>' : '<li>📋 <b>施設基準・届出</b>(経営タブ)</li>'}
           <li>📊 <b>P&L・KPIピン留め・事業計画・銀行融資</b>(経営タブ)</li>
           <li>🏢 <b>分院展開</b>(法人タブ)</li>
           ${settings.specialty === 'orthopedics' ? '<li>🪙 <b>自費メニュー</b>(PRP・AGAほか)と<b>大型投資</b>(MRI・DEXA・増築)</li>' : '<li>🪙 <b>自費メニュー</b>と<b>大型投資</b>(増築)</li>'}
         </ul>
         ${settings.specialty === 'orthopedics' ? '<p class="modal-note">📖 施設基準(専従PT数×面積)で運動器リハビリテーション料の1回単価が¥1,700→¥3,700</p>' : '<p class="modal-note">📖 施設基準カード(経営タブ)で確認できます</p>'}`;
    if ($('modal').classList.contains('show')) {
      banner('🔓 新しい打ち手が解放されました。院内・経営タブをチェック');
      return;
    }
    showModal('🔓 打ち手が解放されました', body, 'やってみる');
  }

  /* ================= ボトルネック診断と改善候補 ================= */

  function bottleneckInfo() {
    const stage = unlockStage();
    const opens = G.history.filter((h) => h.kind !== 'closed');
    const h = opens[opens.length - 1];
    const F = (label, tab, sel) => ({ label, tab, sel });
    if (!h || !h.patients) {
      return { text: 'まだ実績がありません。まず1日診療してみましょう(⏸〜×2の速度がおすすめ)', fixes: [] };
    }
    const examCapDay = Math.max(10, settings.doctors * (480 / (settings.examMean + 1.5)) * 0.72);
    const load = h.patients / examCapDay;
    const rehaUtil = clinic.rehaCap() > 0 ? h.rehaCount / clinic.rehaCap() : 0;
    if ((h.balked || 0) >= 3) {
      return {
        text: `待合がパンクして${h.balked}人が帰りました。容量(椅子)と回転(受付・診察)の両面で受け皿を`,
        fixes: [
          F('待合椅子を増やす', 'clinic', '#shopCard'),
          stage >= 2 ? F('Web問診で受付を短縮', 'clinic', '#shopCard') : F('受付を増員する', 'clinic', '#shopCard'),
          F('予約制で来院を平準化', 'clinic', '#shopCard'),
          stage >= 2 ? F('医師を採用(診察の回転)', 'clinic', '#shopCard') : null
        ].filter(Boolean)
      };
    }
    if (load >= 0.88) {
      return {
        text: `診察が詰まっています(医師キャパの${Math.round(load * 100)}%稼働)。待ち時間の主因はここ`,
        fixes: [
          stage >= 2 ? F('医師を採用する', 'clinic', '#shopCard') : null,
          F('診察時間を短くする', 'clinic', '#policyCard'),
          F('予約制で来院を平準化', 'clinic', '#shopCard')
        ].filter(Boolean)
      };
    }
    if (h.avgWait >= 30 && !settings.webIntake) {
      return {
        text: `受付が詰まっています(平均待ち${Math.round(h.avgWait)}分)。人を増やす前に、受付の仕事を軽くするのが先`,
        fixes: [
          stage >= 2 ? F('Web問診を導入する', 'clinic', '#shopCard') : null,
          F('受付を増員する', 'clinic', '#shopCard'),
          stage >= 2 ? F('自動精算機を置く', 'clinic', '#shopCard') : null
        ].filter(Boolean)
      };
    }
    if (settings.rehaLevel > 0 && rehaUtil >= 0.92) {
      return {
        text: `リハ枠が満杯です(稼働${Math.round(rehaUtil * 100)}%)。予約が取れず、リハ患者が離れ始めます`,
        fixes: [F('PTを採用する', 'clinic', '#shopCard'), F('リハ助手を配置する', 'clinic', '#shopCard'), F('リハ機器を増設する', 'clinic', '#shopCard')]
      };
    }
    if (stage >= 2 && settings.physio === 0) {
      return {
        text: '物療(消炎鎮痛)が未導入です。再診の受け皿と単価の土台がまだ抜けています',
        fixes: [F('物療機器を導入する', 'clinic', '#shopCard'), F('物療の案内方針を上げる', 'clinic', '#policyCard')]
      };
    }
    if (h.profit + (h.brProfit || 0) < 0) {
      return {
        text: `昨日は赤字でした(${yen(h.profit + (h.brProfit || 0))})。患者数と単価、どちらが足りないかを切り分けます`,
        fixes: [
          F('診療方針(単価)を見直す', 'clinic', '#policyCard'),
          F('広告で新患を増やす', 'town', '#marketingCard'),
          stage >= 3 ? F('P&Lで内訳を確認', 'mgmt', '#pnlCard') : null
        ].filter(Boolean)
      };
    }
    if ((h.newCount || 0) <= 3 && G.aw < 0.5) {
      return {
        text: `新患が少なめです(昨日${h.newCount || 0}人・認知${Math.round(G.aw * 100)}%)。まず「知られる」ことから`,
        fixes: [
          F('キーワード広告を出す', 'town', '#marketingCard'),
          F('駅前看板(タウンで駅をタップ)', 'town', '#townStage'),
          stage >= 2 ? F('商店街・営業まわり', 'town', '#salesCard') : null
        ].filter(Boolean)
      };
    }
    return { text: '大きな詰まりはありません。次の一手(集患・単価・新メニュー)を仕込むチャンス', fixes: [] };
  }

  function bindGoto(root) {
    root.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => {
      const [tab, sel] = b.dataset.goto.split('|');
      $('modal').classList.remove('show');
      switchTab(tab);
      const target = document.querySelector(sel);
      if (target) {
        setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
        target.classList.add('tut-focus');
        setTimeout(() => target.classList.remove('tut-focus'), 2400);
      }
    }));
  }

  function renderTodo() {
    const el = $('todoBody');
    if (!el) return;
    const m = MISSIONS[G.missionIdx];
    const bn = bottleneckInfo();
    const today = todayKey();
    const ch = pickChallenge(today);
    const chDone = G.daily && G.daily.chDone === today;
    const chState = G.daily && G.daily.chDay === today ? G.daily.chState : '';
    let reqRow;
    if (chDone) {
      reqRow = `<p>${requestHtml(ch, 20)} — <b class="daily-done">✅ クリア済み</b></p>`;
    } else if (chState === 'ok') {
      reqRow = `<p>${requestHtml(ch, 20)} — <b class="req-on">📋 受注中(今日の診療で達成を)</b></p>`;
    } else if (chState === 'pass') {
      reqRow = `<p class="req-passed">今日はパスしました。${typeof STAFF_UI !== 'undefined' ? STAFF_UI.STAFF[ch.char].name : ''}「わかりました、また明日相談しますね」</p>`;
    } else {
      reqRow = `<p>${requestHtml(ch, 20)}</p><div class="fix-row"><button class="fix-chip" data-chact="ok">受ける</button><button class="fix-chip ghost" data-chact="pass">今日はパス</button></div>`;
    }
    el.innerHTML = `
      ${m ? `<div class="todo-row"><span class="todo-tag mission">🎯 ミッション</span><p>${m.title}</p></div>` : ''}
      <div class="todo-row"><span class="todo-tag daily">📅 依頼</span><div class="req-body">${reqRow}</div></div>
      <div class="todo-row"><span class="todo-tag quiz">🧠 クイズ</span><p>${G.daily && G.daily.quizDone === today ? '<b class="daily-done">✅ 本日の算定クイズはクリア済み</b>' : '<button class="fix-chip" id="quizBtn">算定◯×クイズに挑戦(🪙+1)</button>'}</p></div>
      <div class="todo-row"><span class="todo-tag">🔍 いまの詰まり</span><p>${bn.text}</p></div>
      ${bn.fixes.length ? `<div class="fix-row">${bn.fixes.map((f) => `<button class="fix-chip" data-goto="${f.tab}|${f.sel}">${f.label} →</button>`).join('')}</div>` : ''}`;
    bindGoto(el);
    const qb = $('quizBtn');
    if (qb) qb.addEventListener('click', () => { SND.click(); showQuizModal(); });
    el.querySelectorAll('[data-chact]').forEach((b) => b.addEventListener('click', () => {
      G.daily.chDay = today;
      G.daily.chState = b.dataset.chact;
      const name = typeof STAFF_UI !== 'undefined' ? STAFF_UI.STAFF[ch.char].name : 'スタッフ';
      toast(b.dataset.chact === 'ok' ? `📋 ${name}「ありがとうございます! お願いします!」` : `💬 ${name}「了解です、無理は禁物ですから」`);
      renderTodo(); save();
    }));
  }

  /* ================= 1日の結果画面 ================= */

  function showResult(T, spec, prev, dayNum, repDelta) {
    const corpProfit = T.profit + T.brProfit;
    const delta = (now, before, isYen, goodUp) => {
      if (!prev) return '';
      const diff = now - before;
      if (Math.abs(diff) < (isYen ? 1000 : 1)) return '<small class="rs-flat">前日並み</small>';
      const good = goodUp ? diff > 0 : diff < 0;
      const v = isYen ? yen(Math.round(diff)) : String(Math.round(diff));
      return `<small class="rs-delta ${good ? 'up' : 'down'}">${diff > 0 ? '+' : ''}${v}</small>`;
    };
    const bn = bottleneckInfo();
    const dv = (G.voiceFeed || []).filter((v) => v.kind === 'daily').slice(-1)[0];
    const st = dv && typeof STAFF_UI !== 'undefined' ? STAFF_UI.STAFF[dv.char] : null;
    const m = MISSIONS[G.missionIdx];
    showModal(`📋 Day ${dayNum}(${WEEKDAYS[weekdayOf(dayNum)]})の結果`, `
      <div class="rs-grid">
        <div class="rs-item"><small>患者数</small><b>${T.patients}人</b>${delta(T.patients, prev ? prev.patients : 0, false, true)}</div>
        <div class="rs-item"><small>売上(本院)</small><b>${yen(T.revenue)}</b>${delta(T.revenue, prev ? prev.revenue : 0, true, true)}</div>
        <div class="rs-item"><small>損益(法人)</small><b class="${corpProfit >= 0 ? 'pos-t' : 'neg-t'}">${corpProfit >= 0 ? '+' : ''}${yen(corpProfit)}</b>${delta(corpProfit, prev ? prev.profit + (prev.brProfit || 0) : 0, true, true)}</div>
        <div class="rs-item"><small>平均待ち</small><b>${Math.round(T.avgWait)}分</b>${delta(T.avgWait, prev ? prev.avgWait : 0, false, false)}</div>
        <div class="rs-item"><small>評判</small><b>${Math.round(G.rep)}</b><small class="rs-delta ${repDelta >= 0 ? 'up' : 'down'}">${repDelta >= 0 ? '+' : ''}${repDelta}</small></div>
        <div class="rs-item"><small>新患</small><b>${T.newCount}人</b>${delta(T.newCount, prev ? prev.newCount || 0 : 0, false, true)}</div>
      </div>
      ${G.weather && G.weather.note ? `<div class="rs-bottle">${G.weather.icon} <b>${G.weather.label}</b> — ${G.weather.note}</div>` : ''}
      ${T.balked ? `<div class="rs-bottle rs-balk">🚪 混雑で <b>${T.balked}人</b> が入口で帰ってしまいました(機会損失 約${yen(T.balked * 3500)}) — 椅子か回転(受付・診察)を</div>` : ''}
      <div class="rs-bottle">🔍 ${bn.text}</div>
      ${st ? `<div class="voice-row rs-voice">${STAFF_UI.faceSVG(dv.char, 'normal', 40)}<div class="voice-txt"><small>${st.title} ${st.name}</small><p>${dv.text}</p></div></div>` : ''}
      ${bn.fixes.length
        ? `<p class="rs-next"><b>明日のおすすめ:</b></p><div class="fix-row">${bn.fixes.map((f) => `<button class="fix-chip" data-goto="${f.tab}|${f.sel}">${f.label} →</button>`).join('')}</div>`
        : m ? `<p class="rs-next"><b>明日のおすすめ:</b> 🎯 ${m.title}</p>` : ''}
      <div class="rs-learn">📖 <b>今日の学び</b> ${TEXTBOOK[(dayNum - 1) % TEXTBOOK.length].t}<br><small>${TEXTBOOK[(dayNum - 1) % TEXTBOOK.length].b}</small></div>
    `, '明日へ →');
    bindGoto($('modalBody'));
  }

  /* ================= 🪙コイン経済: アイテム・実績・自由度 ================= */

  const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function boostActive(id) { return !!(G.boosts && G.boosts[id] && G.day <= G.boosts[id]); }

  /* --- キャラとの信頼度(依頼クリアで上がり、職掌に応じた恒常効果) --- */

  const BOND_FX = {
    front: '受付の段取り上手 — 体感待ち-2%/Lv・再診来院率+1%/Lv',
    doctor: '診察の手際 — 診察時間-0.15分/Lv',
    nurse: '物療への声かけ上手 — 物療案内+2%/Lv',
    reha: 'リハ継続支援 — 満枠時の離脱減/Lv',
    billing: '算定精度 — 売上の取りこぼし回収+0.3%/Lv',
    advisor: '広告運用の腕 — CPC-2%/Lv'
  };

  function bondLv(char) {
    const p = (G.bonds && G.bonds[char]) || 0;
    return p >= 30 ? 3 : p >= 14 ? 2 : p >= 6 ? 1 : 0;
  }

  // 体感待ち時間の補正(サイネージ×受付リーダーとの信頼)
  function waitFeel() {
    return (G.deco.signage ? 0.85 : 1) * (1 - 0.02 * bondLv('front'));
  }

  function checkAchievements() {
    if (!G.achDone) return;
    const got = [];
    for (const a of ACHIEVEMENTS) {
      if (G.achDone.includes(a.id)) continue;
      let ok = false;
      try { ok = a.cond(G.stats); } catch (e) { ok = false; }
      if (!ok) continue;
      G.achDone.push(a.id);
      G.coins += a.coin;
      G.money += a.coin * 100000; // 実績はコイン+お金の二重報酬
      got.push(a);
    }
    if (got.length) {
      SND.fanfare();
      banner(`🏅 実績解除: ${got.map((a) => `${a.name}(💰${yen(a.coin * 100000)}+🪙${a.coin})`).join(' / ')}`);
      renderAch();
      renderItems();
      updateHeader();
    }
  }

  function buyItem(id) {
    const item = ITEMS[id];
    if (G.coins < item.coin) { toast(`🪙コインが足りません(必要${item.coin}・ミッションと実績で貯まります)`); return; }
    if (item.days > 0 && boostActive(id)) { toast('このブーストは実施中です'); return; }
    if (id === 'skip7' && tutIdx >= 0) return;
    G.coins -= item.coin;
    if (id === 'training') {
      G.rep = clamp(G.rep + 3, 15, 97);
      toast('🎓 接遇研修を実施しました。評判+3');
    } else if (id === 'skip7') {
      const sp = G.speed;
      G.speed = 8; // 一括実行中は日次結果モーダルを抑制
      for (let i = 0; i < 7; i++) autoDay();
      G.speed = sp;
      banner(`⏩ 7日間を自動運営しました(現在 Day ${G.day})。P&L・週次サマリーで振り返りを`);
    } else {
      G.boosts[id] = G.day + item.days;
      toast(`${item.label} を開始しました。明日から${item.days}日間有効です`);
    }
    renderItems(); updateHeader(); save();
  }

  function buyFacility(id) {
    const f = FACILITIES[id];
    if (G.deco[id]) return;
    if (G.coins < f.coin) { toast(`🪙コインが足りません(必要${f.coin}・ミッションと実績で貯まります)`); return; }
    G.coins -= f.coin;
    G.deco[id] = true;
    clinic.deco = G.deco;
    toast(`${f.label} を設置しました。院内ビューにも表示されます`);
    renderItems(); updateHeader(); save();
  }

  function renderItems() {
    const el = $('itemList');
    if (!el) return;
    const boostRows = Object.entries(ITEMS).map(([id, item]) => {
      const act = item.days > 0 && boostActive(id);
      return `
      <div class="shop-row">
        <div class="shop-info">
          <span class="shop-name">${item.label}${act ? ` <span class="boost-on">実施中(Day ${G.boosts[id]}まで)</span>` : ''}</span>
          <span class="shop-hint">${item.hint}</span>
        </div>
        <div class="shop-btns"><button class="mini-btn ${G.coins >= item.coin && !act ? 'plus' : ''}" data-item="${id}" ${act ? 'disabled' : ''}>🪙 ${item.coin}</button></div>
      </div>`;
    }).join('');
    const facRows = Object.entries(FACILITIES).map(([id, f]) => `
      <div class="shop-row ${G.deco[id] ? 'expand-row done' : ''}">
        <div class="shop-info">
          <span class="shop-name">${f.label}${G.deco[id] ? ' <small>設置済み</small>' : ''}</span>
          <span class="shop-hint">${f.hint}</span>
        </div>
        ${G.deco[id] ? '' : `<div class="shop-btns"><button class="mini-btn ${G.coins >= f.coin ? 'plus' : ''}" data-fac="${id}">🪙 ${f.coin}</button></div>`}
      </div>`).join('');
    el.innerHTML = `
      <p class="plan-lead">🪙コインは<b>ミッション・実績・年次決算</b>で獲得(現在 <b>🪙 ${G.coins}</b>)。アプリ版なら課金ポイントになる部分を、ゲーム内通貨で体験する設計です。</p>
      <h3 class="sub-title">⚡ ブースト(期間限定)</h3>${boostRows}
      <h3 class="sub-title">🏛 プレミアム施設(買い切り・院内ビューに表示)</h3>${facRows}`;
    el.querySelectorAll('[data-item]').forEach((b) => b.addEventListener('click', () => buyItem(b.dataset.item)));
    el.querySelectorAll('[data-fac]').forEach((b) => b.addEventListener('click', () => buyFacility(b.dataset.fac)));
  }

  function renderAch() {
    const el = $('achList');
    if (!el) return;
    el.innerHTML = `<p class="plan-lead">解除 <b>${G.achDone.length}/${ACHIEVEMENTS.length}</b> — どの実績から狙うかも経営判断。解除で<b>💰資金(コイン×¥10万)+🪙コイン</b>の二重報酬。</p>
      <div class="ach-grid">` + ACHIEVEMENTS.map((a) => {
      const done = G.achDone.includes(a.id);
      return `<span class="ach-chip ${done ? 'done' : ''}">${done ? '🏅' : '🔒'} ${a.name} <b>💰${a.coin * 10}万+🪙${a.coin}</b></span>`;
    }).join('') + '</div>';
  }

  function updateNameBadge() {
    const el = $('nameBadge');
    if (el) el.innerHTML = `🏥 ${escapeHtml(G.clinicName)} <small class="name-edit">✏️ 改名</small>`;
  }

  /* ================= 📅 デイリー(ログインボーナス・日替わりお題) ================= */

  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function yesterdayKey() {
    const d = new Date(Date.now() - 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // キャラからの日替わり依頼: 6キャラ×4パターン。成立しない依頼(リハ未届出等)はプールから外す
  const DAILY_REQUESTS = [
    // 受付リーダー 松岡 — 回転と待ち時間
    { id: 'f_wait25', char: 'front', text: '今日は平均待ち25分未満で回したいです(来院8人以上)', cond: (T) => T.patients >= 8 && T.avgWait < 25, coin: 1 },
    { id: 'f_wait15', char: 'front', text: '勝負の日です。平均待ち15分未満、いけますか?(来院10人以上)', cond: (T) => T.patients >= 10 && T.avgWait < 15, coin: 2 },
    { id: 'f_p25', char: 'front', text: '混みそうな予感…来院25人、詰まらせず回しきりましょう', cond: (T) => T.patients >= 25, coin: 2, stage: 2 },
    { id: 'f_new8', char: 'front', text: '新しい患者さんが8人来てくれたら、受付の空気も変わるんです', cond: (T) => T.newCount >= 8, coin: 1 },
    // 院長 剣持 — 診療の質と単価
    { id: 'd_unit', char: 'doctor', text: '中身の濃い診療を。診療単価¥4,000以上で1日を終えたい(来院10人以上)', cond: (T) => T.patients >= 10 && T.revenue / T.patients >= 4000, coin: 1 },
    { id: 'd_inj25', char: 'doctor', text: '適応を丁寧に拾えば注射はもっと打てる。実施率25%を(来院15人以上)', cond: (T) => T.patients >= 15 && (T.injCount + T.trigCount) / T.patients >= 0.25, coin: 2 },
    { id: 'd_xray', char: 'doctor', text: '初診の見落としは怖い。今日はX線10件、しっかり精査を', cond: (T) => T.xrayCount >= 10, coin: 1, stage: 2 },
    { id: 'd_black', char: 'doctor', text: '経営も診療のうち。今日は黒字で締めよう', cond: (T) => T.profit + T.brProfit > 0, coin: 1 },
    // 看護師長 榊 — 処置・物療・現場
    { id: 'n_treat5', char: 'nurse', text: '処置室が空いてます。今日は処置5件、ベッドを活かしましょう', cond: (T) => T.treatCount >= 5, coin: 1, stage: 2 },
    { id: 'n_physio10', char: 'nurse', text: '物療の器械、遊ばせておくのはもったいない。10件回しましょう', cond: (T) => T.physioCount >= 10, coin: 1, needsPhysio: true },
    { id: 'n_checkup', char: 'nurse', text: '健診の予約が入りそうです。今日は健診2件お願いします', cond: (T) => T.rev.checkup >= 16000, coin: 1, stage: 2 },
    { id: 'n_wait30', char: 'nurse', text: '来院20人でも待ち30分未満 — 現場の底力を見せましょう', cond: (T) => T.patients >= 20 && T.avgWait < 30, coin: 2, stage: 2 },
    // リハ・物療担当 湊 — リハ稼働
    { id: 'r_reha10', char: 'reha', text: 'リハ枠に空きがあります。今日は10件やりきりたいです', cond: (T) => T.rehaCount >= 10, coin: 1, needsReha: true },
    { id: 'r_reha20', char: 'reha', text: '今日は全開でいきます。リハ20件、送客お願いします!', cond: (T) => T.rehaCount >= 20, coin: 2, needsReha: true },
    { id: 'r_physio15', char: 'reha', text: '物療15件。低単価でも、続けて通える場所があることが大事なんです', cond: (T) => T.physioCount >= 15, coin: 1, needsPhysio: true },
    { id: 'r_combo', char: 'reha', text: 'リハ+物療で25件。運動器の外来らしい1日にしましょう', cond: (T) => T.rehaCount + T.physioCount >= 25, coin: 2, needsReha: true },
    // 医事課 佐伯 — 売上と算定
    { id: 'b_rev100k', char: 'billing', text: '今日の売上目標は¥100,000。単価と件数、両方見ていきます', cond: (T) => T.revenue >= 100000, coin: 1, stage: 2 },
    { id: 'b_rev200k', char: 'billing', text: 'レセプトが楽しみになる日を。売上¥200,000超え、狙えます', cond: (T) => T.revenue >= 200000, coin: 2, stage: 3 },
    { id: 'b_kanri', char: 'billing', text: '「何もしない再診」も外来管理加算をきちんと算定。今日は5件', cond: (T) => T.kanriCount >= 5, coin: 1 },
    { id: 'b_jihi', char: 'billing', text: '自費売上¥15,000。保険外の柱を育てましょう', cond: (T) => T.rev.jihi >= 15000, coin: 2, stage: 3 },
    // 経営アドバイザー 白瀬 — 経営と外向き
    { id: 'a_repblack', char: 'advisor', text: '評判60以上をキープしたまま黒字で締める — 攻守両立の日に', cond: (T) => G.rep >= 60 && T.profit + T.brProfit > 0, coin: 1 },
    { id: 'a_new10', char: 'advisor', text: '新患10人。認知・評判・紹介、どの蛇口を開けますか?', cond: (T) => T.newCount >= 10, coin: 2, stage: 2 },
    { id: 'a_sales', char: 'advisor', text: '今日はどこか1件、営業訪問を。関係は放置すると冷めますから', cond: (T) => Object.values(G.relations).some((r) => r.lv > 0 && r.last === G.day), coin: 1, stage: 2 },
    { id: 'a_mri2', char: 'advisor', text: 'MRIの回収計画、今日は2件が目安です', cond: (T) => T.mriCount >= 2, coin: 1, needsMri: true },
    // 季節の依頼(実際の月に連動)
    { id: 's_spring_f', char: 'front', months: [3, 4, 5], text: '春は引っ越しシーズン。新しく越してきた方が7人来てくれたら嬉しいです', cond: (T) => T.newCount >= 7, coin: 1 },
    { id: 's_spring_n', char: 'nurse', months: [3, 4, 5], text: '新年度の健診シーズンです。今日は健診3件、段取りします', cond: (T) => T.rev.checkup >= 24000, coin: 2, stage: 2 },
    { id: 's_summer_d', char: 'doctor', months: [6, 7, 8], text: '夏の大会前で部活の外傷が増える。X線12件でも精査は妥協しない', cond: (T) => T.xrayCount >= 12, coin: 2, stage: 2 },
    { id: 's_summer_r', char: 'reha', months: [6, 7, 8], text: '暑さでリハ中断が増える季節です。今日は12件、灯を絶やさずに', cond: (T) => T.rehaCount >= 12, coin: 1, needsReha: true },
    { id: 's_autumn_a', char: 'advisor', months: [9, 10, 11], text: 'スポーツの秋。運動会帰りの新患12人、獲りにいきましょう', cond: (T) => T.newCount >= 12, coin: 2, stage: 2 },
    { id: 's_autumn_b', char: 'billing', months: [9, 10, 11], text: '行楽シーズンは再診が乱れがち。それでも売上¥150,000は守りたい', cond: (T) => T.revenue >= 150000, coin: 1, stage: 2 },
    { id: 's_winter_f', char: 'front', months: [12, 1, 2], text: '路面凍結で転倒の患者さんが急増します。来院30人でも待ち35分未満で', cond: (T) => T.patients >= 30 && T.avgWait < 35, coin: 2, stage: 2 },
    { id: 's_winter_n', char: 'nurse', months: [12, 1, 2], text: '転倒・骨折の処置が増える季節。今日は処置7件、備えます', cond: (T) => T.treatCount >= 7, coin: 2, stage: 2 }
  ];

  function dailyPool() {
    const stage = unlockStage();
    const month = new Date().getMonth() + 1;
    const pool = DAILY_REQUESTS.filter((r) => {
      if (r.stage && stage < r.stage) return false;
      if (r.needsReha && settings.rehaLevel === 0) return false;
      if (r.needsMri && !settings.mri) return false;
      if (r.needsPhysio && settings.physio === 0) return false;
      if (r.months && !r.months.includes(month)) return false;
      return true;
    });
    return pool.length ? pool : DAILY_REQUESTS.slice(0, 4);
  }

  function pickChallenge(dateStr) {
    const pool = dailyPool();
    let h = 0;
    for (let i = 0; i < dateStr.length; i++) h = (h * 31 + dateStr.charCodeAt(i)) % 9973;
    // 連続依頼: 前日にクリアした相手から、50%で「昨日の続き」が来る(報酬+1)
    if (G.daily && G.daily.lastClearChar && h % 2 === 0) {
      const same = pool.filter((r) => r.char === G.daily.lastClearChar);
      if (same.length) return Object.assign({}, same[h % same.length], { chain: true });
    }
    return pool[h % pool.length];
  }

  /* --- 🧠 算定◯×クイズ(日替わり・教育コンテンツ) --- */

  const QUIZ = [
    { q: '処置や検査を行わなかった再診でも、計画的な医学管理を行えば外来管理加算(52点)を算定できる', a: true,
      exp: '外来管理加算は「何もしない再診」の医学管理を評価する加算。処置・リハ・検査等を行った日は算定できない。' },
    { q: '初診料は291点である', a: true,
      exp: '1点=10円なので¥2,910。クリニック外来の収益の土台になる基本診療料。' },
    { q: '運動器リハビリテーション料(I)は、専従の常勤PT2名がいれば届出できる', a: false,
      exp: 'PT2名は(II)の要件。(I)はより手厚い専従スタッフ体制に加え、100㎡以上の訓練室など面積要件も必要。' },
    { q: '消炎鎮痛等処置(いわゆる物療)は1回350点である', a: false,
      exp: '正しくは35点(¥350)。低単価だが、継続通院を支える整形外来の重要な柱。' },
    { q: '処方箋料は60点である', a: true,
      exp: '院外処方箋の交付1回につき60点(¥600)。' },
    { q: '関節腔内注射を行った日でも、外来管理加算を併せて算定できる', a: false,
      exp: '注射・処置・リハ等を行った日は外来管理加算は算定不可。「どちらか」の関係を覚えておこう。' },
    { q: '回復期リハビリテーション病棟入院料は、算定上限日数の範囲内なら入院中毎日算定できる', a: true,
      exp: '病棟単位の包括入院料で、疾患ごとの上限日数まで毎日算定する。病院経営の安定収益源。' },
    { q: '疾患別リハビリテーションの1単位は20分である', a: true,
      exp: '1単位=20分。運動器リハは患者1人につき1日6単位までなど、上限も定められている。' },
    { q: '診療報酬の点数は都道府県ごとに異なる', a: false,
      exp: '診療報酬は全国一律の公定価格。原則2年に1度の改定で見直される(このゲームの改定イベントの元ネタ)。' },
    { q: '時間外加算が付くのは初診料だけである', a: false,
      exp: '再診料にも時間外・休日・深夜の加算がある。届出した夜間・早朝等加算も再診で算定できる。' },
    { q: 'リハビリテーション総合計画評価料は300点である', a: true,
      exp: '多職種でリハ計画を作り評価した場合に月1回300点。「計画→実施→評価」の流れごと点数になっている。' },
    { q: '施設基準の要件(専従PTの人数など)を満たせなくなっても、届出済みなら算定を続けてよい', a: false,
      exp: '要件を満たせなくなったら速やかに届出の変更(辞退)が必要。要件割れのまま算定を続けると返還の対象になる。' },
    { q: 'MRIの撮影料は、装置の性能(テスラ数)にかかわらず同じ点数である', a: false,
      exp: '1.5T未満/1.5T以上3T未満/3T以上で点数が異なる。高性能機ほど高い点数が設定されている。' },
    { q: '関節腔内注射では、手技料とは別に使用した薬剤の薬剤料も算定できる', a: true,
      exp: '注射の手技料と薬剤料は別建て。ヒアルロン酸などの薬剤料が加わって1回の算定額になる。' },
    { q: '院外処方の診療所でも、後発医薬品の使用体制を整えれば「外来後発医薬品使用体制加算」を算定できる', a: false,
      exp: '令和8年度に「外来後発医薬品使用体制加算」はなく、院内処方向けの「地域支援・外来医薬品供給対応体制加算」(処方料の加算・8/7/5点)に再編されている。院外処方の診療所が後発を後押しして取れるのは、処方箋料の一般名処方加算1(8点)・2(6点)のほう。' },
    { q: '時間外対応体制加算は、体制の区分によって2点から7点まで点数が分かれている', a: true,
      exp: '常時対応(1=7点)から連携当番(4=2点)まで4区分。届出制(様式2)で、区分ごとに求められる対応体制が異なる。' }
  ];

  function pickQuiz(dateStr) {
    let h = 7;
    for (let i = 0; i < dateStr.length; i++) h = (h * 37 + dateStr.charCodeAt(i)) % 9973;
    return QUIZ[h % QUIZ.length];
  }

  function showQuizModal() {
    const today = todayKey();
    const q = pickQuiz(today);
    const done = G.daily.quizDone === today;
    showModal('🧠 今日の算定◯×クイズ', `
      <p class="quiz-q">Q. ${q.q}</p>
      ${done
        ? `<div class="rs-bottle">本日は回答済みです。<br><small>📖 ${q.exp}</small></div>`
        : `<div class="modal-actions quiz-actions"><button class="btn-cta" id="quizO">⭕ 正しい</button><button class="btn-cta ghost" id="quizX">❌ 誤り</button></div><div id="quizResult"></div>`}
      <p class="modal-note">毎日1問、実際の診療報酬から出題。正解で🪙+1。</p>`, done ? '閉じる' : 'あとで');
    if (done) return;
    const answer = (ans) => {
      if (G.daily.quizDone === today) return;
      const ok = ans === q.a;
      G.daily.quizDone = today;
      if (G.med) { G.med.quizTotal++; if (ok) G.med.quizOk++; }
      if (ok) { G.coins += 1; SND.coin(); } else { SND.buzz(); }
      const res = $('quizResult');
      if (res) res.innerHTML = `<div class="rs-bottle ${ok ? '' : 'rs-balk'}"><b>${ok ? '⭕ 正解。🪙+1' : `❌ 不正解…(正解は${q.a ? '⭕' : '❌'})`}</b><br><small>📖 ${q.exp}</small></div>`;
      const bo = $('quizO'), bx = $('quizX');
      if (bo) bo.disabled = true;
      if (bx) bx.disabled = true;
      save(); renderTodo(); updateHeader();
    };
    $('quizO').addEventListener('click', () => answer(true));
    $('quizX').addEventListener('click', () => answer(false));
  }

  function requestHtml(ch, size) {
    const reward = ch.coin + (ch.chain ? 1 : 0);
    if (typeof STAFF_UI === 'undefined') return `今日の依頼: 「${ch.text}」(🪙+${reward})`;
    const st = STAFF_UI.STAFF[ch.char];
    return `${STAFF_UI.faceSVG(ch.char, 'idea', size || 20)} <b>${st.name}</b>${ch.chain ? '<span class="chain-tag">🔗連続依頼</span>' : ''}「${ch.text}」(🪙+${reward}・信頼+${2 + (ch.chain ? 1 : 0)})`;
  }

  function checkDailyLogin() {
    const today = todayKey();
    if (G.daily.last === today) return;
    const consecutive = G.daily.last === yesterdayKey();
    G.daily.streak = consecutive ? (G.daily.streak || 0) + 1 : 1;
    // 昨日依頼をクリアしていなければ連続依頼は途切れる
    if (G.daily.chDone !== yesterdayKey()) { G.daily.lastClearChar = ''; G.daily.chain = 0; }
    const firstEver = !G.daily.last;
    G.daily.last = today;
    if (firstEver) { save(); return; } // 初回起動はスターターコインがあるので静かに記録だけ
    const r = G.daily.streak >= 7 ? 3 : G.daily.streak >= 3 ? 2 : 1;
    G.coins += r;
    save();
    const ch = pickChallenge(today);
    showModal('🎁 デイリーボーナス', `
      <p class="daily-streak">連続ログイン <b>${G.daily.streak}日目</b> → <b>🪙コイン+${r}</b></p>
      <div class="pnl-row"><span>連続3日以上</span><b>毎日🪙+2</b></div>
      <div class="pnl-row"><span>連続7日以上</span><b>毎日🪙+3</b></div>
      <div class="rs-bottle daily-req">📅 <b>今日の依頼:</b><br>${requestHtml(ch, 26)}<small class="req-note">院内タブの「今日やること」で受けられます</small></div>
      <p class="modal-note">🪙コインはブースト・プレミアム施設・<b>倍速パス(×8/×16/×32)</b>に使えます。</p>`,
      '今日も経営する');
    updateHeader();
  }

  function checkDailyChallenge(T) {
    const today = todayKey();
    if (!G.daily || G.daily.chDone === today) return;
    if (G.daily.chDay !== today || G.daily.chState !== 'ok') return; // 「受ける」を押した依頼だけカウント
    const spec = G.daySpec || specOf(G.day);
    if (spec.kind === 'closed') return;
    const ch = pickChallenge(today);
    let ok = false;
    try { ok = ch.cond(T); } catch (e) { ok = false; }
    if (!ok) return;
    const bonus = ch.chain ? 1 : 0;
    G.daily.chDone = today;
    G.daily.lastClearChar = ch.char;
    G.daily.chain = (G.daily.chain || 0) + 1;
    G.coins += ch.coin + bonus;
    G.bonds[ch.char] = (G.bonds[ch.char] || 0) + 2 + bonus;
    if (bondLv(ch.char) >= 3 && !(G.specialDone || []).includes(ch.char)) specialRequest(ch.char);
    SND.coin();
    const name = typeof STAFF_UI !== 'undefined' ? STAFF_UI.STAFF[ch.char].name : 'スタッフ';
    banner(`🎁 ${name}の依頼クリア${ch.chain ? '(🔗連続依頼)' : ''} → 🪙+${ch.coin + bonus}・${name}の信頼+${2 + bonus}${G.daily.chain >= 2 ? `(${G.daily.chain}日連続)` : ''}`);
    renderTodo();
    renderStaffStrip();
    updateHeader();
  }

  /* ================= 🏛 殿堂(プレステージ) — 実績を引き継いで2周目へ ================= */

  const PRESTIGE_KEY = 'clinicTown_prestige';

  function nextLegacy() {
    const n = G.achDone.length;
    const coinTotal = ACHIEVEMENTS.filter((a) => G.achDone.includes(a.id)).reduce((s, a) => s + a.coin, 0);
    return {
      money: 2000000 + n * 200000,
      rep: Math.min(70, 55 + Math.floor(n / 3)),
      aw: Math.min(0.5, 0.30 + n * 0.005),
      coins: 2 + 3 * ((G.prestige ? G.prestige.count : 0) + 1) + Math.floor(coinTotal / 10)
    };
  }

  function prestigeUnlocked() {
    return G.annualDone || G.missionDone.includes('corp');
  }

  function prestigeNow() {
    const legacy = nextLegacy();
    try {
      localStorage.setItem(PRESTIGE_KEY, JSON.stringify({
        count: (G.prestige ? G.prestige.count : 0) + 1,
        legacy,
        achDone: G.achDone, stats: G.stats, deco: G.deco, clinicName: G.clinicName,
        daily: G.daily, speedPass: G.speedPass, bonds: G.bonds,
        specialDone: G.specialDone, season: G.season
      }));
      localStorage.removeItem(SAVE_KEY);
    } catch (e) { /* noop */ }
    location.reload();
  }

  function loadPrestige() {
    try {
      const raw = localStorage.getItem(PRESTIGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function renderPrestige() {
    const el = $('prestigeBody');
    if (!el) return;
    const lap = (G.prestige ? G.prestige.count : 0) + 1;
    const lg = nextLegacy();
    const unlocked = prestigeUnlocked();
    const applied = G.prestige && G.prestige.legacy
      ? `<div class="rs-bottle">🏛 現在 <b>${lap}周目</b> — 適用中の殿堂ボーナス: 開始資金${yen(G.prestige.legacy.money)} / 初期評判${G.prestige.legacy.rep} / 初期認知${Math.round(G.prestige.legacy.aw * 100)}% / 開始🪙${G.prestige.legacy.coins}</div>`
      : `<p class="plan-lead">現在 <b>${lap}周目</b>。殿堂入りすると経営はDay 1からやり直しですが、<b>実績に応じて開始条件が強くなります</b>。</p>`;
    el.innerHTML = `
      ${applied}
      <div class="pnl-row"><span>引き継ぐもの</span><b>実績(${G.achDone.length}/${ACHIEVEMENTS.length})・累計スタッツ・プレミアム施設・倍速パス・キャラとの信頼・院名</b></div>
      <div class="pnl-row"><span>リセットされるもの</span><b>資金・評判・日数・スタッフ・分院・ミッション(再挑戦で報酬も再獲得)</b></div>
      ${(G.graduLog || []).length ? `<h3 class="sub-title">🎓 卒業アルバム(直近${Math.min(12, G.graduLog.length)}人 / 累計${G.stats.gradu || 0}人)</h3>
      <div class="ach-list">${G.graduLog.slice(-12).reverse().map((g) => `<span class="ach-chip done">🎓 ${escapeHtml(g.name)}さん(${g.age}・${g.ch}) 通院${g.visits}回 — Day ${g.day}</span>`).join('')}</div>` : ''}
      <h3 class="sub-title">次に殿堂入りした場合の開始ボーナス(実績${G.achDone.length}個 連動)</h3>
      <div class="pnl-row"><span>開始資金(実績1つ+¥200,000)</span><b>${yen(lg.money)}</b></div>
      <div class="pnl-row"><span>初期評判(実績3つで+1)</span><b>${lg.rep}</b></div>
      <div class="pnl-row"><span>初期認知(実績1つ+0.5%)</span><b>${Math.round(lg.aw * 100)}%</b></div>
      <div class="pnl-row"><span>開始コイン(周回+実績コイン連動)</span><b>🪙 ${lg.coins}</b></div>
      ${unlocked
        ? `<button class="btn-cta" id="prestigeGo">🏛 殿堂入りして ${lap + 1}周目を始める</button>`
        : `<p class="mgmt-lock">🔒 解放条件: <b>Day 365の年次決算</b> または <b>最終ミッション(法人月商¥2,500万)達成</b></p>`}`;
    const btn = $('prestigeGo');
    if (btn) btn.addEventListener('click', () => {
      showModal('🏛 殿堂入りの確認', `
        <p><b>${lap + 1}周目</b>を開始します。経営はDay 1に戻りますが、以下を引き継ぎます:</p>
        <div class="pnl-row"><span>開始資金</span><b>${yen(lg.money)}</b></div>
        <div class="pnl-row"><span>初期評判 / 初期認知</span><b>${lg.rep} / ${Math.round(lg.aw * 100)}%</b></div>
        <div class="pnl-row"><span>開始コイン</span><b>🪙 ${lg.coins}</b></div>
        <div class="pnl-row"><span>実績・累計スタッツ・施設・院名</span><b>そのまま引き継ぎ</b></div>
        <p class="modal-note">⚠️ 現在の経営(資金・分院・スタッフ)は殿堂に記録され、リセットされます。</p>
        <div class="modal-actions"><button class="btn-cta danger" id="prestigeConfirm">殿堂入りする</button></div>`,
        'やめておく');
      $('prestigeConfirm').addEventListener('click', prestigeNow);
    });
  }

  /* ================= 💫 スペシャル依頼(信頼Lv3・キャラごとに1回) ================= */

  const SPECIALS = {
    front: { title: '受付マニュアル、完成しました',
      text: '新人向けの受付マニュアル、ついに完成しました。この院の受付は、もう誰が入っても回ります。ここまで任せてもらえたおかげです。……次は後輩を育てる番ですね。',
      note: '📖 業務の「属人化」を外すのは経営の仕事。マニュアルは辞めない仕組みでもある。' },
    doctor: { title: '学会で症例報告をしてきた',
      text: '先週の学会で、うちの保存療法の症例をまとめて報告してきた。座長に「いい外来ですね」と言われたよ。……経営が安定しているから、診療に集中できる。君のおかげだ。',
      note: '📖 医師が学び続けられる環境は、採用力にも診療の質にも効く長期投資。' },
    nurse: { title: '新人ナースが「ここで働きたい」と',
      text: '看護学生の実習生が2人、「卒業したらここで働きたい」と言ってくれました。現場の空気は、ちゃんと外に伝わるんですよ。人が人を呼ぶ職場になってきました。',
      note: '📖 採用コストが最も安いのは「働きたいと思われる職場」を作ること。' },
    reha: { title: 'リハ室が「地域の居場所」になってきた',
      text: '卒業した患者さんが、町内会の体操教室にうちのメニューを持ち込んでくれたんです。「あそこのリハは違う」って。リハ室が地域の健康の入口になってきました!',
      note: '📖 リハのLTVは院内で完結しない — 地域に出た患者が次の患者を連れてくる。' },
    billing: { title: 'レセプト返戻ゼロ、3か月続きました',
      text: '返戻・査定ゼロを3か月続けました。派手さはないですが、取りこぼしゼロは「診療の証明」がきちんとできている証拠です。この院の裏側は、私が守ります。',
      note: '📖 医事の精度は利益率に直結する。バックオフィスへの信頼は隠れた競争力。' },
    advisor: { title: '本部があなたをモデルケースに',
      text: '本部会議であなたの院の数字を紹介したら、「モデルケースとして横展開したい」と。……私が言うのも変ですが、ここまでの経営、本物です。次のステージに行きましょう。',
      note: '📖 再現性のある経営だけが「仕組み」として横展開できる。' }
  };

  function specialRequest(char) {
    if (!G.specialDone) G.specialDone = [];
    G.specialDone.push(char);
    const sp = SPECIALS[char];
    if (!sp) return;
    G.coins += 10;
    G.money += 300000;
    const st = typeof STAFF_UI !== 'undefined' ? STAFF_UI.STAFF[char] : { name: 'スタッフ', title: '' };
    showModal(`💫 ${sp.title}`, `
      <div class="voice-row rs-voice">${typeof STAFF_UI !== 'undefined' ? STAFF_UI.faceSVG(char, 'good', 56) : ''}<div class="voice-txt"><small>${st.title} ${st.name} — 信頼Lv3 スペシャル</small><p>${sp.text}</p></div></div>
      <div class="pnl-row"><span>スペシャル報酬</span><b>💰${yen(300000)} + 🪙10</b></div>
      <p class="modal-note">${sp.note}</p>`,
      'ありがとう');
    renderStaffStrip();
    updateHeader();
  }

  /* ================= 📆 月間決算(30日ごと・自己ベスト更新) ================= */

  function monthlyClose() {
    const profit = G.history.slice(-30).reduce((a, h) => a + h.profit + (h.brProfit || 0), 0);
    if (!G.season) G.season = { bestProfit: null, bestMonth: 0, months: 0 };
    G.season.months++;
    const isBest = G.season.bestProfit === null || profit > G.season.bestProfit;
    if (isBest) { G.season.bestProfit = profit; G.season.bestMonth = G.season.months; }
    const grade = profit >= 3000000 ? 'S' : profit >= 1000000 ? 'A' : profit > 0 ? 'B' : 'C';
    const coin = { S: 3, A: 2, B: 1, C: 0 }[grade];
    G.coins += coin;
    let planHtml = '';
    if (G.plan) {
      const rate = monthRevenueAll() / G.plan.revenue;
      planHtml = `<div class="pnl-row"><span>事業計画 達成率</span><b>${(rate * 100).toFixed(0)}%${rate >= 1 ? ' ✅' : ''}</b></div>`;
    }
    // 医療(適切な算定)スコア: 制度上の事実(要件割れ日・KB整備メモ)+理解(クイズ)。配点はゲーム上の仮定
    const med = G.med || { fsBroken: 0, warnDays: 0, days: 0, quizOk: 0, quizTotal: 0 };
    const medProper = Math.max(0, 60 - med.fsBroken * 10);
    const medClean = med.days ? Math.round(20 * (1 - med.warnDays / med.days)) : 20;
    const medQuiz = med.quizTotal ? Math.round(20 * (med.quizOk / med.quizTotal)) : 0;
    const medScore = medProper + medClean + medQuiz;
    const medGrade = medScore >= 90 ? 'S' : medScore >= 70 ? 'A' : medScore >= 50 ? 'B' : 'C';
    const medDetail = [
      `要件どおりの算定 ${medProper}/60${med.fsBroken ? `(要件割れで適用が外れた${med.fsBroken}件)` : ''}`,
      `判定の保留 ${medClean}/20${med.warnDays ? `(保留した日${med.warnDays})` : ''}`,
      `理解 ${medQuiz}/20${med.quizTotal ? `(クイズ${med.quizOk}/${med.quizTotal})` : '(デイリークイズ未回答・回答は任意)'}`,
    ].join('・');
    G.med = { fsBroken: 0, warnDays: 0, days: 0, quizOk: 0, quizTotal: 0 };
    // 紹介(直近30日): 対比を1行で(designer裁定)
    const refWin = (G.referLog || []).filter((l) => l.day > G.day - 30);
    const refIn = refWin.filter((l) => l.ok).length, refOut = refWin.length - refIn;
    showModal(`📆 月間決算(第${G.season.months}期) — 経営評価 ${grade}`, `
      <div class="pnl-row"><span>今月の利益(直近30日・法人)</span><b class="${profit >= 0 ? 'pos-t' : 'neg-t'}">${yen(profit)}</b></div>
      <div class="pnl-row"><span>自己ベスト</span><b>${yen(G.season.bestProfit)}(第${G.season.bestMonth}期)${isBest && G.season.months > 1 ? ' 🏆 記録更新' : ''}</b></div>
      ${planHtml}
      ${refWin.length ? `<div class="pnl-row"><span>紹介 — 法人内で受けた / 他院へ</span><b>${refIn}件 / ${refOut}件</b></div>` : ''}
      <div class="pnl-row"><span>成績ボーナス</span><b>${coin ? `🪙+${coin}` : 'なし(黒字着地で🪙+1〜)'}</b></div>
      <div class="pnl-row total"><span>医療評価(適切な算定)</span><b>${medScore}点 ${medGrade}</b></div>
      <p class="pnl-note"><small>${medDetail}</small></p>
      <p class="pnl-note"><small>要件割れ(届け出た施設基準の要件を割り、その日から適用が外れたこと)は制度上の事実。判定の保留は、エンジンがまだ機械判定できない条件に当たった日。配点の比率はゲーム上の仮定</small></p>
      <p class="modal-note">📖 経営評価: S=月間利益300万 / A=100万 / B=黒字。医療評価は別の物差し。月次は「計画差異」を見る時間 — ズレたのは患者数か単価かを切り分ける。</p>
      ${isBest && G.season.months > 1 ? shareBtnHtml() : ''}`,
      '来月へ');
    if (isBest && G.season.months > 1) bindShare(`📆 「${G.clinicName}」月間利益の自己ベスト更新 — ${yen(profit)}(第${G.season.months}期・評価${grade})`);
  }

  /* ================= 🏆 地域リーグ判定・表示 ================= */

  function checkLeague() {
    if (!G.league) G.league = { beaten: 0 };
    const my = monthRevenueAll();
    let n = 0;
    while (n < LEAGUE.length && my >= leagueRev(n)) n++;
    if (n <= G.league.beaten) return;
    for (let i = G.league.beaten; i < n; i++) {
      const L = LEAGUE[i];
      if (L.title) {
        G.money += L.reward;
        G.coins += L.coin;
        SND.fanfare();
        showModal(`🏆 ${L.title}`, `
          <p><b>${L.name}</b>(月商 ${yen(leagueRev(i))})を追い抜き、<b>${L.tier}の頂点</b>に立ちました。</p>
          <div class="pnl-row"><span>あなたの法人月商</span><b>${yen(my)}</b></div>
          <div class="pnl-row"><span>制覇ボーナス</span><b>💰${yen(L.reward)} + 🪙${L.coin}</b></div>
          <p class="modal-note">📖 上には上がいる — ライバルの月商も成長し続けます。次のステージへ。</p>
          ${shareBtnHtml()}`,
          '次の頂点へ');
        bindShare(`🏆 ${L.title} 「${G.clinicName}」が${L.tier}の頂点に立ちました(Day ${G.day}・法人月商 ${yen(my)})`);
      } else {
        banner(`🏆 ${L.name}(${L.tier})を追い抜きました。法人月商 ${yen(my)}`);
      }
    }
    G.league.beaten = n;
    renderLeague();
    updateMissionBar();
  }

  function renderLeague() {
    const el = $('leagueBody');
    if (!el) return;
    if (!G.league) G.league = { beaten: 0 };
    const my = monthRevenueAll();
    let pos = 0;
    while (pos < LEAGUE.length && my >= leagueRev(pos)) pos++;
    const rank = LEAGUE.length - pos + 1;
    const next = G.league.beaten < LEAGUE.length ? LEAGUE[G.league.beaten] : null;
    const nextRev = next ? leagueRev(G.league.beaten) : 0;
    const pct = next ? Math.min(100, my / nextRev * 100) : 100;
    const rows = [];
    for (let i = LEAGUE.length - 1; i >= 0; i--) {
      if (i === pos - 1 || (pos === 0 && i === 0)) { /* noop marker */ }
      rows.push(`<div class="lg-row ${i < G.league.beaten ? 'beaten' : ''}">
        <span class="lg-tier t-${LEAGUE[i].tier}">${LEAGUE[i].tier}</span>
        <b class="lg-name">${LEAGUE[i].name}</b>
        <span class="lg-rev">${yen(leagueRev(i))}/月</span>
        ${i < G.league.beaten ? '<i class="lg-check">✓ 制覇</i>' : ''}
      </div>`);
      if (i === pos) rows.push(`<div class="lg-row you">
        <span class="lg-tier t-you">YOU</span><b class="lg-name">${escapeHtml(G.clinicName)} グループ</b>
        <span class="lg-rev">${yen(my)}/月</span><i class="lg-check">現在 ${rank}位</i></div>`);
    }
    if (pos === 0) rows.push(`<div class="lg-row you">
      <span class="lg-tier t-you">YOU</span><b class="lg-name">${escapeHtml(G.clinicName)} グループ</b>
      <span class="lg-rev">${yen(my)}/月</span><i class="lg-check">現在 ${rank}位</i></div>`);
    el.innerHTML = `
      ${next
        ? `<p class="plan-lead">次の目標: <b>${next.name}</b>(${next.tier}) — 月商 <b>${yen(nextRev)}</b>
           <span class="lg-gap">あと ${yen(Math.max(0, nextRev - my))}</span></p>
           <div class="pv-track big"><i style="width:${pct.toFixed(1)}%" class="${pct >= 100 ? 'full' : pct >= 70 ? 'mid' : 'low'}"></i></div>`
        : '<p class="plan-lead">🌟 <b>全国制覇済み</b> — あなたの上には誰もいません。殿堂入りで伝説を刻みましょう。</p>'}
      <div class="lg-table">${rows.join('')}</div>
      <p class="pnl-note">ライバル法人の月商は成長し続けます(+約22%/年)。抜いた順位は維持されます。</p>`;
  }

  /* ================= 週次・月次レビュー ================= */

  function kpiWeekAgg(hist) {
    const open = hist.filter((h) => h.kind !== 'closed');
    if (!open.length) return null;
    const sum = (f) => open.reduce((a, h) => a + f(h), 0);
    return {
      days: open.length,
      visits: sum((h) => h.patients) / open.length,
      newp: sum((h) => h.newCount || 0) / open.length,
      unit: sum((h) => h.patients) ? sum((h) => h.revenue) / sum((h) => h.patients) : 0,
      mix: sum((h) => h.patients) ? (sum((h) => (h.injCount || 0) + (h.trigCount || 0))) / sum((h) => h.patients) * 100 : 0,
      rehaPerPT: sum((h) => h.pts) ? sum((h) => h.rehaCount * 2) / sum((h) => h.pts) : 0,
      physio: sum((h) => h.physioCount || 0) / open.length,
      wait: sum((h) => h.avgWait) / open.length,
      jihi: sum((h) => h.jihi || 0) / open.length,
      labor: sum((h) => h.revenue) ? sum((h) => h.staffCost || 0) / sum((h) => h.revenue) * 100 : 0,
      profit: hist.reduce((a, h) => a + h.profit + (h.brProfit || 0), 0)
    };
  }

  function weeklyDigest() {
    const thisW = kpiWeekAgg(G.history.slice(-7));
    const lastW = kpiWeekAgg(G.history.slice(-14, -7));
    if (!thisW) return;
    const row = (label, a, b, fmt, goodUp) => {
      const arrow = !b ? '' : a > b * 1.02 ? (goodUp ? '<b class="up">↗</b>' : '<b class="down">↗</b>') : a < b * 0.98 ? (goodUp ? '<b class="down">↘</b>' : '<b class="up">↘</b>') : '→';
      return `<div class="wk-row"><span>${label}</span><b>${fmt(a)}</b><small>先週 ${b ? fmt(b) : '–'}</small>${arrow}</div>`;
    };
    const f0 = (v) => Math.round(v).toLocaleString();
    const f1 = (v) => (Math.round(v * 10) / 10).toLocaleString();
    showModal(`📅 週次サマリー(Day ${G.day - 6}〜${G.day})`, `
      <div class="wk-table">
        ${row('来院数/日', thisW.visits, lastW && lastW.visits, f1, true)}
        ${row('新患数/日', thisW.newp, lastW && lastW.newp, f1, true)}
        ${row('診療単価', thisW.unit, lastW && lastW.unit, (v) => '¥' + f0(v), true)}
        ${row('重点行為 実施率', thisW.mix, lastW && lastW.mix, (v) => f0(v) + '%', true)}
        ${row('リハ単位/PT/日', thisW.rehaPerPT, lastW && lastW.rehaPerPT, f1, true)}
        ${row('物療件数/日', thisW.physio, lastW && lastW.physio, f1, true)}
        ${row('自費売上/日', thisW.jihi, lastW && lastW.jihi, (v) => '¥' + f0(v), true)}
        ${row('平均待ち時間', thisW.wait, lastW && lastW.wait, (v) => f0(v) + '分', false)}
        ${row('人件費率', thisW.labor, lastW && lastW.labor, (v) => f0(v) + '%', false)}
        ${row('週間損益(法人)', thisW.profit, lastW && lastW.profit, (v) => '¥' + f0(v), true)}
      </div>
      <p class="modal-note">📖 週次は「構造」を見る時間。単価が落ちたなら中身(実施率・リハ単位)のどれか、患者数が落ちたなら新患か再診かを切り分ける。</p>`,
      '来週も頑張る');
  }

  function reviewPlan() {
    const rate = monthRevenueAll() / G.plan.revenue;
    const grade = rate >= 1 ? 'S' : rate >= 0.8 ? 'A' : rate >= 0.6 ? 'B' : 'C';
    const comments = {
      S: '目標達成。計画の精度と実行力、どちらも本物です。次の30日はもう一段高い目標を。',
      A: 'あと一歩。どのKPI(患者数/単価/認知)が計画とズレたかを特定して、来月の一手に変えましょう。',
      B: '未達。計画が高すぎたのか、実行が足りなかったのか — 区別することが大事。',
      C: '大幅未達。目標を下げるのは敗北ではなく、計画の修正は経営の仕事そのものです。'
    };
    showModal(`📋 30日レビュー — 評価 ${grade}`,
      `<p>目標月商 ${yen(G.plan.revenue)} に対して、実績 <b>${yen(monthRevenueAll())}</b>(達成率 ${(rate * 100).toFixed(0)}%)。</p><div class="lesson-box"><b>📖 経営の学び</b><p>${comments[grade]}</p></div>`,
      '次の30日へ');
  }

  /* ================= ミッション ================= */

  const missionApplies = (m) => !m.spec || m.spec === settings.specialty;
  function skipSpecMissions() { while (MISSIONS[G.missionIdx] && !missionApplies(MISSIONS[G.missionIdx])) G.missionIdx++; }
  function checkMission(T) {
    skipSpecMissions();
    const m = MISSIONS[G.missionIdx];
    if (!m) return;
    let done = false;
    switch (m.id) {
      case 'firstday': done = T.patients >= 1; break;
      case 'wait40': done = T.patients >= 8 && T.avgWait < 40; break;
      case 'rev50k': done = T.revenue >= 50000; break;
      case 'rep60': done = G.rep >= 60; break;
      case 'web': done = settings.webIntake; break;
      case 'physio10': done = T.physioCount >= 10; break;
      case 'black3': done = (G.blackStreak || 0) >= 3; break;
      case 'reha10': done = settings.rehaLevel >= 1 && T.rehaCount >= 10; break;
      case 'tie': done = relLv('hospital') > 0 && relLv('caremane') > 0; break;
      case 'month300k': done = G.history.slice(-30).reduce((a, h) => a + h.profit + (h.brProfit || 0), 0) >= 300000; break;
      case 'expand': done = settings.floorLv >= 2; break;
      case 'revenue': done = monthRevenueMain() >= 8000000; break;
      case 'branch': done = G.branches.length >= 1; break;
      case 'branchProfit': done = G.branches.some((b) => b.profit7.length >= 7 && b.profit7.reduce((a, x) => a + x, 0) > 0); break;
      case 'corp': done = monthRevenueAll() >= 25000000; break;
      case 'cityTop': done = (G.league ? G.league.beaten : 0) >= 4; break;
      case 'prefTop': done = (G.league ? G.league.beaten : 0) >= 7; break;
      case 'regionTop': done = (G.league ? G.league.beaten : 0) >= 9; break;
      case 'hospital': done = !!G.hospital; break;
      case 'nationTop': done = (G.league ? G.league.beaten : 0) >= 10; break;
    }
    if (done) {
      SND.fanfare();
      G.money += m.reward;
      const md = 1 + Math.floor(G.missionIdx / 5);
      G.coins += md;
      G.missionDone.push(m.id);
      showModal(`🎉 ミッション達成: ${m.title}`,
        `<p>達成ボーナス <b>${yen(m.reward)}</b> + <b>🪙コイン×${md}</b> を獲得しました。</p><div class="lesson-box"><b>📖 経営の学び</b><p>${m.lesson}</p></div>`,
        G.missionIdx + 1 < MISSIONS.length ? '次のミッションへ' : 'クリニックタウンの覇者だ');
      G.missionIdx++;
      renderMissions();
      updateMissionBar();
      renderTodo();
    }
  }

  /* ================= UI: 共通 ================= */

  function fmtClock(t) {
    const spec = G.daySpec || specOf(G.day);
    const m = Math.floor(Math.min(t, spec.min || 0)) + 9 * 60;
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  }

  function updateHeader() {
    if (typeof enforceSpeedPass === 'function' && G.speed > 4) enforceSpeedPass();
    $('hMoney').textContent = yen(G.money);
    $('hMoney').classList.toggle('neg', G.money < 0);
    const hm = $('hMedal');
    if (hm) hm.textContent = `🪙 ${G.coins || 0}`;
    const spec = G.daySpec || specOf(G.day);
    const wxh = ensureWeather();
    $('hDay').textContent = `Day ${G.day}(${WEEKDAYS[weekdayOf(G.day)]}${spec.kind === 'am' ? '·午前' : spec.kind === 'closed' ? '·休診' : ''}) ${wxh.icon}`;
    $('hDay').title = `天気: ${wxh.label}${wxh.note ? ' — ' + wxh.note : ''}`;
    $('hClock').textContent = spec.kind === 'closed' ? '—' : fmtClock(G.t);
    $('hRep').textContent = Math.round(G.rep);
    $('hAw').textContent = `${Math.round(G.aw * 100)}%`;
    $('hToday').textContent = yen(G.today ? G.today.revenue : 0);
  }

  function updateMissionBar() {
    const m = MISSIONS[G.missionIdx];
    const lap = G.prestige && G.prestige.count > 0 ? `🏛${G.prestige.count + 1}周目 ` : '';
    const vis = MISSIONS.filter(missionApplies);
    $('missionText').textContent = lap + (m ? `MISSION ${vis.indexOf(m) + 1}/${vis.length}: ${m.title}` : '🏆 全ミッション制覇。街いちばんの医療法人だ — 殿堂入りはいつでも(経営タブ)');
  }

  let bannerTimer = null;
  function banner(html) {
    const el = $('banner');
    el.innerHTML = html;
    el.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.classList.remove('show'), 5000);
  }
  let toastTimer = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  function showModal(title, bodyHtml, btnLabel) {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = bodyHtml;
    $('modalBtn').textContent = btnLabel || 'OK';
    $('modal').classList.add('show');
  }
  $('modalBtn').addEventListener('click', () => $('modal').classList.remove('show'));

  /* ================= UI: タブ ================= */

  let activeTab = 'clinic';
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.addEventListener('click', () => switchTab(b.dataset.tab));
  });
  function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.tab-btn').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('show', p.id === `tab-${tab}`));
    if (tab === 'clinic') { clinicIso.resize(); renderKpiStrip(); renderStaffStrip(); renderVoice(); renderReceipt(); renderPulse(); }
    if (tab === 'town') { townIso.resize(); renderAds(); }
    if (tab === 'corp') renderCorp();
    if (tab === 'mgmt') { renderPnl(); renderMissions(); renderPlanner(); renderBank(); renderKpiPicker(); renderAch(); renderPrestige(); renderLeague(); renderAcct(); renderDecCard(); }
  }

  /* ================= UI: 診療時間 ================= */

  function renderSchedule() {
    const el = $('scheduleRow');
    if (!el) return;
    el.innerHTML = settings.schedule.map((k, i) => `
      <button class="sch-btn ${k}" data-sch="${i}">
        <span class="sch-day">${WEEKDAYS[i]}</span>
        <span class="sch-kind">${DAY_SPECS[k].label}</span>
      </button>`).join('');
    const openMin = settings.schedule.reduce((a, k) => a + DAY_SPECS[k].min, 0);
    $('scheduleNote').innerHTML = `週<b>${(openMin / 60).toFixed(0)}時間</b> / 午前=人件費6割 / 日曜=手当1.4倍・新患1.3倍`;
    el.querySelectorAll('[data-sch]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.sch);
      const order = ['full', 'am', 'closed'];
      const next = order[(order.indexOf(settings.schedule[i]) + 1) % 3];
      const openDays = settings.schedule.filter((k, j) => (j === i ? next : k) !== 'closed').length;
      if (openDays < 3) { toast('週3日は開けましょう(患者さんが離れます)'); return; }
      settings.schedule[i] = next;
      renderSchedule(); save();
    }));
  }

  /* ================= UI: 院内(ショップ・自費) ================= */

  function shopCost(key) {
    const item = SHOP[key];
    if (item.flat) return item.flat;
    const cur = settingValue(key);
    return item.costs[Math.min(cur, item.costs.length - 1)];
  }
  function shopMax(key) {
    const M = clinic.L.MAX;
    return { doctor: M.doctors, nurse: M.nurses, pt: M.pts, recep: M.receptionists, chairs: M.chairs, beds: M.beds, machines: M.machines, physio: settings.floorLv >= 3 ? 12 : 8, rehaAide: 8 }[key];
  }
  function settingValue(key) {
    return { doctor: settings.doctors, nurse: settings.nurses, pt: settings.pts, recep: settings.receptionists, chairs: settings.chairs, beds: settings.beds, machines: settings.machines, physio: settings.physio, rehaAide: settings.rehaAides }[key];
  }
  function setSettingValue(key, v) {
    if (key === 'doctor') settings.doctors = v;
    else if (key === 'nurse') settings.nurses = v;
    else if (key === 'pt') settings.pts = v;
    else if (key === 'recep') settings.receptionists = v;
    else if (key === 'rehaAide') settings.rehaAides = v;
    else settings[key] = v;
  }

  function buy(key) {
    const item = SHOP[key];
    const cur = settingValue(key);
    const step = item.step || 1;
    if (cur + step > shopMax(key)) { toast(settings.floorLv === 1 ? 'これ以上は入りません(増築で上限UP)' : 'これ以上は増やせません'); return; }
    const cost = shopCost(key);
    if (G.money < cost) { toast('資金が足りません'); return; }
    G.money -= cost;
    SND.click();
    setSettingValue(key, cur + step);
    pushPulseEv('👥', `${SHOP[key].label}`);
    clinic.applySettings();
    renderShop(); updateHeader(); save();
  }
  function fire(key) {
    const cur = settingValue(key);
    const min = { doctor: 1, nurse: 0, pt: 0, recep: 1, chairs: 2, beds: 0, machines: 0, physio: 0, rehaAide: 0 }[key];
    const step = SHOP[key].step || 1;
    if (cur - step < min) { toast('これ以上は減らせません'); return; }
    setSettingValue(key, cur - step);
    clinic.applySettings();
    renderShop(); save();
  }

  const SHOP_VOICE = { doctor: 'doctor', nurse: 'nurse', beds: 'nurse', pt: 'reha', machines: 'reha', physio: 'reha', rehaAide: 'reha', recep: 'front', chairs: 'front' };

  function renderShop() {
    const stage = unlockStage();
    const mm = SPECIALTIES.get(settings.specialty);
    const hide = (mm && mm.main && mm.main.preset && mm.main.preset.shopHide) || [];
    const rows = Object.entries(SHOP).map(([key, item]) => {
      if (hide.includes(key)) return '';
      const need = STAGE_SHOP[key] || 1;
      if (need > stage) {
        return `
        <div class="shop-row locked">
          <div class="shop-info">
            <span class="shop-name">🔒 ${item.label}</span>
            <span class="shop-hint">Day ${need === 2 ? 4 : 8} で解放</span>
          </div>
        </div>`;
      }
      const cur = settingValue(key);
      const max = shopMax(key);
      const vc = SHOP_VOICE[key];
      const vt = vc && typeof STAFF_UI !== 'undefined' ? STAFF_UI.STAFF[vc].invest[key] : null;
      return `
      <div class="shop-row">
        <div class="shop-info">
          <span class="shop-name">${item.label} <b class="shop-count">${cur}${item.day ? '人' : ''}</b> <small class="shop-max">/ 最大${max}</small></span>
          <span class="shop-hint">${item.hint}</span>
          ${vt ? `<span class="shop-voice">${STAFF_UI.faceSVG(vc, 'normal', 17)} ${STAFF_UI.STAFF[vc].name}「${vt}」</span>` : ''}
        </div>
        <div class="shop-btns">
          <button class="mini-btn" data-fire="${key}">−</button>
          <button class="mini-btn plus" data-buy="${key}">＋ ${yen(shopCost(key))}</button>
        </div>
      </div>`;
    }).join('');

    const bigNames = [!hide.includes('mri') && 'MRI', !hide.includes('dexa') && 'DEXA', '増築'].filter(Boolean).join('・');
    const bigTicket = stage < 3 ? `
      <div class="shop-row locked">
        <div class="shop-info">
          <span class="shop-name">🔒 大型投資(${bigNames})</span>
          <span class="shop-hint">Day 8 で解放</span>
        </div>
      </div>` : `
      ${hide.includes('mri') ? '' : `<div class="shop-row ${settings.mri ? 'expand-row done' : 'expand-row'}">
        <div class="shop-info"><span class="shop-name">🧲 MRI ${settings.mri ? '導入済み(維持費¥12,000/日)' : 'を導入する'}</span>
        <span class="shop-hint">MRI検査 1件1,900点=¥19,000(撮影1,330+断層診断450+電子画像管理120)。断層診断450点は同一患者・同一月に1回だけ。維持費¥12,000/日・1日最大8件はゲーム上の設定。導入時に施設基準(様式37)の届出まで整える前提</span>
        ${typeof STAFF_UI !== 'undefined' ? `<span class="shop-voice">${STAFF_UI.faceSVG('advisor', 'normal', 17)} 白瀬「${STAFF_UI.STAFF.advisor.invest.mri}」</span>` : ''}</div>
        ${settings.mri ? '' : `<div class="shop-btns"><button class="mini-btn plus" id="mriBtn">🧲 ${yen(MRI_COST)}</button></div>`}
      </div>`}
      ${hide.includes('dexa') ? '' : `<div class="shop-row ${settings.dexa ? 'expand-row done' : 'expand-row'}">
        <div class="shop-info"><span class="shop-name">🦴 骨密度測定装置(DEXA)${settings.dexa ? ' 導入済み' : ''}</span>
        <span class="shop-hint">骨塩定量検査(DEXA法)360点+管理で1受診¥3,800</span></div>
        ${settings.dexa ? '' : `<div class="shop-btns"><button class="mini-btn plus" id="dexaBtn">🦴 ${yen(DEXA_COST)}</button></div>`}
      </div>`}
      ${hide.includes('echo') ? '' : `<div class="shop-row ${settings.echo ? 'expand-row done' : 'expand-row'}">
        <div class="shop-info"><span class="shop-name">📡 超音波診断装置(運動器エコー)${settings.echo ? ' 導入済み' : ''}</span>
        <span class="shop-hint">超音波検査(運動器)350点・初診の約3割(スポーツ層4.5割)</span>
        ${typeof STAFF_UI !== 'undefined' ? `<span class="shop-voice">${STAFF_UI.faceSVG('doctor', 'normal', 17)} 剣持「エコーは診断の質も説明力も上がる。導入するなら使い倒す」</span>` : ''}</div>
        ${settings.echo ? '' : `<div class="shop-btns"><button class="mini-btn plus" id="echoBtn">📡 ${yen(ECHO_COST)}</button></div>`}
      </div>`}
      ${settings.floorLv === 1
        ? `<div class="shop-row expand-row">
            <div class="shop-info"><span class="shop-name">🏗 院を増築する(Lv2)</span>
            <span class="shop-hint">診察室4・リハ室100㎡(機器12)・椅子20に上限UP</span></div>
            <div class="shop-btns"><button class="mini-btn plus" id="expandBtn">🏗 ${yen(EXPAND_COST)}</button></div>
          </div>`
        : settings.floorLv === 2
          ? `<div class="shop-row expand-row">
              <div class="shop-info"><span class="shop-name">🏙 別館を建てる(Lv3)</span>
              <span class="shop-hint">診察室6・リハ室150㎡(機器18)・椅子28・受付4・ベッド6・PT20名/家賃¥120,000/日</span></div>
              <div class="shop-btns"><button class="mini-btn plus" id="expand2Btn">🏙 ${yen(EXPAND2_COST)}</button></div>
            </div>`
          : `<div class="shop-row expand-row done"><div class="shop-info"><span class="shop-name">🏙 別館まで増築済み(診察室6・リハ室150㎡)</span></div></div>`}`;

    $('shopList').innerHTML = rows + bigTicket;
    $('shopList').querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => buy(b.dataset.buy)));
    $('shopList').querySelectorAll('[data-fire]').forEach((b) => b.addEventListener('click', () => fire(b.dataset.fire)));
    const ex = $('expandBtn');
    if (ex) ex.addEventListener('click', () => {
      if (G.money < EXPAND_COST) { toast(`資金が足りません(${yen(EXPAND_COST)})`); return; }
      G.money -= EXPAND_COST;
      settings.floorLv = 2;
      clinic.applySettings();
      toast('🏗 増築が完了しました。リハ室100㎡・診察室4室の体制です');
      renderShop(); renderPnl(); updateHeader(); save();
    });
    const ex2 = $('expand2Btn');
    if (ex2) ex2.addEventListener('click', () => {
      if (G.money < EXPAND2_COST) { toast(`資金が足りません(${yen(EXPAND2_COST)})`); return; }
      G.money -= EXPAND2_COST;
      settings.floorLv = 3;
      clinic.applySettings();
      toast('🏙 別館完成 — 診察室6・リハ室150㎡(機器18)・椅子28の大型体制へ');
      renderShop(); renderPnl(); updateHeader(); save();
    });
    const mriB = $('mriBtn');
    if (mriB) mriB.addEventListener('click', () => {
      if (G.money < MRI_COST) { toast(`資金が足りません(${yen(MRI_COST)})`); return; }
      G.money -= MRI_COST;
      settings.mri = true;
      toast('🧲 MRIを導入しました。初診・紹介患者の精査で稼働します');
      renderShop(); updateHeader(); save();
    });
    const echoB = $('echoBtn');
    if (echoB) echoB.addEventListener('click', () => {
      if (G.money < ECHO_COST) { toast(`資金が足りません(${yen(ECHO_COST)})`); return; }
      G.money -= ECHO_COST;
      settings.echo = true;
      SND.click();
      toast('📡 運動器エコーを導入しました。初診の精査で算定されます(350点)');
      renderShop(); updateHeader(); save();
    });
    const dexaB = $('dexaBtn');
    if (dexaB) dexaB.addEventListener('click', () => {
      if (G.money < DEXA_COST) { toast(`資金が足りません(${yen(DEXA_COST)})`); return; }
      G.money -= DEXA_COST;
      settings.dexa = true;
      toast('🦴 DEXAを導入しました。骨粗鬆症の継続診療が始まります');
      renderShop(); updateHeader(); save();
    });

    $('opReserve').classList.toggle('on', settings.reserve);
    $('opKiosk').classList.toggle('on', settings.kiosk);
    $('opReview').classList.toggle('on', settings.reviewCare);
    $('opWeb').classList.toggle('on', settings.webIntake);
    renderJihi();
  }

  // 本院の科で意味を持たない自費メニューは出さない(v76 保留#43: 自費リハ延長は整形のリハ完了者が前提。preset.jihiHide)
  function jihiHidden(key) {
    const mm = SPECIALTIES.get(settings.specialty);
    const hide = (mm && mm.main && mm.main.preset && mm.main.preset.jihiHide) || [];
    return hide.includes(key);
  }
  function renderJihi() {
    const el = $('jihiList');
    if (!el) return;
    const uptakeReha = clamp((G.rep - 55) / 80, 0, 0.35) * clamp(1.7 - settings.selfRehaPrice / 9000, 0.15, 1.2);
    const prpDemand = clamp((G.rep - 58) / 12, 0, 2.2) * clamp(1.55 - settings.prpPrice / 100000, 0.15, 1.3) * (1 + 0.25 * relLv('sports'));
    const agaJoin = 0.5 * clamp(G.aw * 1.5, 0.3, 1.2) * clamp(1.6 - settings.agaPrice / 12000, 0.2, 1.3);
    el.innerHTML = `
      ${jihiHidden('selfReha') ? '' : `<div class="jihi-item">
        <div class="jihi-head"><button class="op-btn ${settings.selfReha ? 'on' : ''}" data-jihi="selfReha">🏃 自費リハ延長</button>
        <span class="jihi-stat">想定利用率 ${(uptakeReha * 100).toFixed(0)}%(リハ完了者)</span></div>
        <label class="ctrl"><span class="ctrl-head">価格 <b>${yen(settings.selfRehaPrice)}</b></span>
        <input type="range" data-jprice="selfRehaPrice" min="4000" max="15000" step="1000" value="${settings.selfRehaPrice}"></label>
      </div>`}
      <div class="jihi-item">
        <div class="jihi-head"><button class="op-btn ${settings.prpOn ? 'on' : ''}" data-jihi="prpOn">💉 PRP療法(再生医療)${settings.prpOn ? '' : ` <small>要認定 ${yen(PRP_CERT_COST)}</small>`}</button>
        <span class="jihi-stat">想定 ${prpDemand.toFixed(1)}件/日・原価 ${yen(FEES.prpCogs)}/件</span></div>
        <label class="ctrl"><span class="ctrl-head">価格 <b>${yen(settings.prpPrice)}</b></span>
        <input type="range" data-jprice="prpPrice" min="30000" max="165000" step="5000" value="${settings.prpPrice}"></label>
      </div>
      <div class="jihi-item">
        <div class="jihi-head"><button class="op-btn ${settings.agaOn ? 'on' : ''}" data-jihi="agaOn">💇 AGA外来(継続課金)</button>
        <span class="jihi-stat">会員 ${Math.round(G.agaPool)}人・加入 ${agaJoin.toFixed(1)}人/日・原価率35%</span></div>
        <label class="ctrl"><span class="ctrl-head">月額 <b>${yen(settings.agaPrice)}</b></span>
        <input type="range" data-jprice="agaPrice" min="3000" max="15000" step="1000" value="${settings.agaPrice}"></label>
      </div>
      <div class="jihi-item">
        <div class="jihi-head"><button class="op-btn ${settings.goods ? 'on' : ''}" data-jihi="goods">🦵 物販(サポーター等)<small> 原価60%</small></button>
        <span class="jihi-stat">一部が購入・¥3,500</span></div>
      </div>`;
    el.querySelectorAll('[data-jihi]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.jihi;
      if (k === 'prpOn' && !settings.prpOn) {
        if (G.money < PRP_CERT_COST) { toast(`再生医療の届出・認定に ${yen(PRP_CERT_COST)} 必要です`); return; }
        G.money -= PRP_CERT_COST;
        toast('💉 再生医療等提供計画の認定完了。PRP療法を開始します');
      }
      settings[k] = !settings[k];
      renderJihi(); updateHeader(); save();
    }));
    el.querySelectorAll('[data-jprice]').forEach((s) => s.addEventListener('input', (e) => {
      settings[e.target.dataset.jprice] = Number(e.target.value);
      renderJihi(); save();
    }));
  }

  $('opReserve').addEventListener('click', () => {
    if (!settings.reserve) {
      if (G.money < 50000) { toast('資金が足りません(¥50,000)'); return; }
      G.money -= 50000;
      settings.reserve = true;
      pushPulseEv('📅', '予約制ON');
      toast('予約制を導入しました');
    } else { settings.reserve = false; }
    renderShop(); updateHeader(); save();
  });
  $('opKiosk').addEventListener('click', () => {
    if (!settings.kiosk) {
      if (G.money < 300000) { toast('資金が足りません(¥300,000)'); return; }
      G.money -= 300000;
      settings.kiosk = true;
      clinic.applySettings();
      pushPulseEv('🏧', '自動精算機');
      toast('自動精算機を設置しました');
    } else { settings.kiosk = false; clinic.applySettings(); }
    renderShop(); updateHeader(); save();
  });
  $('opReview').addEventListener('click', () => {
    settings.reviewCare = !settings.reviewCare;
    toast(settings.reviewCare ? 'クチコミに丁寧に返信する方針にしました' : 'クチコミ返信をやめました');
    renderShop(); save();
  });
  $('opWeb').addEventListener('click', () => {
    if (!settings.webIntake) {
      if (G.money < 200000) { toast('資金が足りません(¥200,000)'); return; }
      G.money -= 200000;
      settings.webIntake = true;
      pushPulseEv('📱', 'Web問診');
      toast('📱 Web問診・事前受付を導入しました。受付時間が約45%短縮されます(受付ボトルネック対策)');
    } else { settings.webIntake = false; }
    renderShop(); updateHeader(); save();
  });

  [['examMean', 'vExamMean', (v) => `${v}分`, (v) => v],
   ['pTreat', 'vPTreat', (v) => `${v}%`, (v) => v / 100],
   ['pReha', 'vPReha', (v) => `${v}%`, (v) => v / 100],
   ['pInj', 'vPInj', (v) => `${v}%`, (v) => v / 100],
   ['pTrig', 'vPTrig', (v) => `${v}%`, (v) => v / 100],
   ['pPhysio', 'vPPhysio', (v) => `${v}%`, (v) => v / 100]
  ].forEach(([key, label, fmt, conv]) => {
    $(key).addEventListener('input', (e) => {
      const v = Number(e.target.value);
      settings[key] = conv(v);
      $(label).textContent = fmt(v);
      save();
    });
    const POLICY_JP = { examMean: '診察時間', pTreat: '処置方針', pReha: 'リハ方針', pInj: '関節注方針', pTrig: 'トリガー方針', pPhysio: '物療方針' };
    $(key).addEventListener('change', (e) => pushPulseEv('🎛', `${POLICY_JP[key]}→${fmt(Number(e.target.value))}`));
  });

  /* ================= UI: KPI ================= */

  function renderKpiPicker() {
    const el = $('kpiPicker');
    if (!el) return;
    el.innerHTML = KPIS.map((k) => `
      <button class="kpi-chip ${G.kpiPins.includes(k.id) ? 'on' : ''}" data-kpi="${k.id}" title="${k.why}">${k.name}</button>`).join('') +
      `<p class="plan-lead" style="margin-top:8px">タップでピン留め(最大4つ)→ 院内タブに常時表示。<b>日次は絞って毎日見る</b>のがコツ。週次サマリーは7日ごとに自動表示。</p>` +
      `<div class="kpi-why">${KPIS.filter((k) => G.kpiPins.includes(k.id)).map((k) => `<p><b>${k.name}</b> — ${k.why}</p>`).join('')}</div>`;
    el.querySelectorAll('[data-kpi]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.kpi;
      if (G.kpiPins.includes(id)) G.kpiPins = G.kpiPins.filter((x) => x !== id);
      else if (G.kpiPins.length >= 4) { toast('ピン留めは4つまで。「絞る」のもKPI設計です'); return; }
      else G.kpiPins.push(id);
      renderKpiPicker(); renderKpiStrip(); save();
    }));
  }

  function renderKpiStrip() {
    const el = $('kpiStrip');
    if (!el) return;
    const opens = G.history.filter((h) => h.kind !== 'closed');
    const last = opens[opens.length - 1];
    if (!last) { el.innerHTML = '<span class="kpi-tile empty">KPI: 1日終えると表示(経営タブで指標を選べます)</span>'; return; }
    const prior = opens.slice(-8, -1);
    el.innerHTML = G.kpiPins.map((id) => {
      const k = KPIS.find((x) => x.id === id);
      if (!k) return '';
      const v = k.calc(last);
      const avg = prior.length ? prior.reduce((a, h) => a + k.calc(h), 0) / prior.length : null;
      const trend = avg === null || avg === 0 ? '' : v > avg * 1.03 ? '<i class="tr up">▲</i>' : v < avg * 0.97 ? '<i class="tr down">▼</i>' : '<i class="tr">–</i>';
      const fv = k.unit === '円' ? '¥' + Math.round(v).toLocaleString() : `${v}${k.unit}`;
      return `<span class="kpi-tile"><small>${k.name}</small><b>${fv}</b>${trend}</span>`;
    }).join('');
  }

  /* ================= UI: タウン(広告・営業) ================= */

  function renderAds() {
    const tEl = $('adTarget');
    if (tEl) {
      const segLabel = { balance: '🎯 バランス', senior: '👴 高齢者重視', worker: '💼 勤労者重視', sports: '🏃 スポーツ重視' };
      const lastH = G.history.filter((h) => h.kind !== 'closed').slice(-1)[0];
      tEl.innerHTML = `
        <div class="op-row">${Object.entries(segLabel).map(([k, v]) => `<button class="op-btn ${G.targetSeg === k ? 'on' : ''}" data-tseg="${k}">${v}</button>`).join('')}</div>
        <p class="ctrl-note">高齢=リハ・骨粗鬆症 / 勤労=健診・AGA / スポーツ=MRI・PRP${lastH && lastH.segS !== undefined ? ` — 昨日の客層: 高齢${lastH.segS}・勤労${lastH.segW}・スポーツ${lastH.segP}人` : ''}</p>
        ${(() => { const f = (G.regulars || []).filter((r) => r.visits >= 5).length; const g = (G.stats && G.stats.gradu) || 0; return f || g ? `<p class="ctrl-note">🌟 顔なじみ(通院5回以上) <b>${f}人</b> — 口コミで認知+${Math.min(0.3, f * 0.01).toFixed(2)}%/日${g ? ` ・ 🎓卒業 累計<b>${g}人</b>(治して送り出した数)` : ''}</p>` : ''; })()}`;
      tEl.querySelectorAll('[data-tseg]').forEach((b) => b.addEventListener('click', () => {
        G.targetSeg = b.dataset.tseg;
        toast(`🎯 ターゲット方針: ${segLabel[G.targetSeg]}(商圏からの新患の客層が寄ります)`);
        renderAds(); save();
      }));
    }
    const el = $('adsList');
    if (!el) return;
    el.innerHTML = KEYWORDS.map((kw) => {
      const r = G.adReport ? G.adReport[kw.id] : null;
      const cpcEff = Math.round(kw.cpc * (1 + G.adPressure) * (1 - 0.02 * bondLv('advisor')));
      return `
      <div class="ad-kw">
        <div class="ad-head">
          <span class="ad-name">${kw.name} <small>CPC ${yen(cpcEff)}${G.adPressure > 0 ? ` <b class="ad-up">↑競合入札</b>` : ''}</small></span>
          <b class="ad-budget">${G.ads[kw.id] === 0 ? '停止中' : yen(G.ads[kw.id]) + '/日'}</b>
        </div>
        <input type="range" data-ad="${kw.id}" min="0" max="15000" step="1000" value="${G.ads[kw.id]}">
        <div class="ad-stats">
          <span>${kw.hint}</span>
          ${r ? `<span class="ad-result">昨日: ${r.clicks}クリック → 新患${r.pats}人 ${r.pats > 0 ? `/ CPA ${yen(r.spend / r.pats)}` : r.spend > 0 ? '/ CPA ∞(成果ゼロ)' : ''}</span>` : ''}
        </div>
      </div>`;
    }).join('');
    el.querySelectorAll('[data-ad]').forEach((s) => s.addEventListener('input', (e) => {
      G.ads[e.target.dataset.ad] = Number(e.target.value);
      renderAds(); save();
    }));
    const ltv = Math.round(avgUnitPrice() * 4.2);
    $('adSummary').innerHTML = `
      <span>広告費 合計 <b>${yen(Object.values(G.ads).reduce((a, b) => a + b, 0))}/日(上限)</b></span>
      <span>参考LTV(1人の新患が生む売上目安): <b>${yen(ltv)}</b> — CPAがこれを超えたら出しすぎ</span>
      ${G.adPressure > 0.1 ? `<span class="ad-warn">⚠️ 競合が入札を強めています(CPC +${Math.round(G.adPressure * 100)}%)</span>` : ''}`;
    renderRelations();
  }

  function stars(lv, max) { return '★'.repeat(lv) + '☆'.repeat(max - lv); }

  function renderRelations() {
    const el = $('relList');
    if (!el) return;
    el.innerHTML = Object.entries(REL_DEF).filter(([, def]) => !def.hidden).map(([k, def]) => { // 科に合わない営業先は出さない(preset.relHide・v73)
      const r = G.relations[k];
      const stale = r.lv > 0 ? Math.max(0, 30 - (G.day - r.last)) : null;
      return `<div class="rel-row">
        <div class="rel-info"><b>${def.name}</b> <span class="rel-stars">${stars(r.lv, def.max)}</span>
        <small>${def.effect}${stale !== null ? ` / あと${stale}日で関係が冷える` : ''}</small></div>
        <button class="mini-btn plus" data-rel="${k}">${r.lv === 0 ? '挨拶に行く' : r.lv < def.max ? '関係を深める' : '定期訪問'} ${yen(def.cost)}</button>
      </div>`;
    }).join('');
    el.querySelectorAll('[data-rel]').forEach((b) => b.addEventListener('click', () => visitRelation(b.dataset.rel)));
  }

  function visitRelation(key) {
    const def = REL_DEF[key];
    const r = G.relations[key];
    if (def.needsReha && settings.specialty === 'orthopedics' && settings.rehaLevel === 0) {
      showModal(def.name, '<p>「リハビリの体制がないと、ご紹介できません」<br>まず院内でリハ(専従PT・機器・施設基準)を立ち上げましょう。</p><p class="modal-note">📖 連携営業は「提供できる医療」が先。</p>', '出直す');
      return;
    }
    if (G.money < def.cost) { toast('資金が足りません'); return; }
    G.money -= def.cost;
    if (key === 'shoutengai') {
      G.aw = clamp(G.aw + 0.012, 0.05, 0.95);
      G.rep = Math.min(100, G.rep + 0.5);
    }
    if (r.lv < def.max) {
      r.lv++;
      toast(`🤝 ${def.name}: 関係が深まりました(${stars(r.lv, def.max)})`);
    } else {
      toast(`🍵 ${def.name}: 定期訪問。関係は良好です(${stars(r.lv, def.max)})`);
    }
    if (typeof PERSONA !== 'undefined' && PERSONA.contact(key)) {
      const ct = PERSONA.contact(key);
      setTimeout(() => toast(`💬 ${ct.name}「${PERSONA.contactLine(key, Math.min(r.lv, 2), 'visit')}」`), 1700);
    }
    r.last = G.day;
    renderAds(); updateHeader(); save();
  }

  // 🔁 スタッフ応援配置: 受付・会計スタッフをタップして配置を切り替える
  function showStaffModal(kind) {
    const L = clinic.L;
    const canHelp = settings.receptionists >= 2;
    const recepN = clinic.recepWindows();
    const cashN = clinic.cashServices().length;
    const wl = clinic.waitingLoad();
    const busy = kind === 'cash' ? clinic.cashQueue.length >= 3 : wl.n >= Math.max(5, wl.cap * 0.45);
    const floorLine = typeof PERSONA !== 'undefined' && typeof STAFF_UI !== 'undefined'
      ? `<div class="persona-speech">${STAFF_UI.faceSVG(kind === 'cash' ? 'billing' : 'front', busy ? 'busy' : 'normal', 34)} ${STAFF_UI.STAFF[kind === 'cash' ? 'billing' : 'front'].name}「${PERSONA.staffLine(kind, busy, G.day + (G.today ? G.today.patients : 0))}」</div>` : '';
    showModal(kind === 'cash' ? '💴 会計まわりの采配' : '🪟 受付まわりの采配', `
      ${floorLine}
      <div class="pnl-row"><span>受付窓口の稼働</span><b>${recepN}窓口(受付 ${settings.receptionists}人${settings.cashHelper ? ' − 応援1' : ''})</b></div>
      <div class="pnl-row"><span>会計窓口の稼働</span><b>${cashN}窓口${settings.kiosk ? '(自動精算機あり)' : settings.cashHelper ? '(応援+1)' : ''}</b></div>
      <p>受付スタッフを1人、<b>会計の応援</b>に回せます。会計が2窓口になり精算の列が早く進む一方、受付の窓口は1つ減ります。</p>
      ${settings.kiosk ? '<p class="modal-note">自動精算機ですでに会計は2窓口です。応援は受付を減らすだけなので不要。</p>' : ''}
      ${!canHelp ? '<p class="modal-note">⚠️ 受付が1人だけの間は応援に出せません(受付窓口が0になってしまう)。</p>' : ''}
      <div class="modal-actions"><button class="btn-cta${settings.cashHelper ? ' ghost' : ''}" id="helperBtn" ${!settings.cashHelper && !canHelp ? 'disabled' : ''}>${settings.cashHelper ? '受付に戻す' : '会計へ応援に出す'}</button></div>
      <p class="modal-note">📖 ボトルネックは動く。朝は受付、昼過ぎは会計 — 人の配置も「打ち手」のひとつ。</p>`,
      '閉じる');
    $('helperBtn').addEventListener('click', () => {
      if (!settings.cashHelper && !canHelp) return;
      settings.cashHelper = !settings.cashHelper;
      SND.click();
      pushPulseEv('🔁', settings.cashHelper ? '会計へ応援' : '受付へ復帰');
      toast(settings.cashHelper ? '🔁 受付スタッフ1人が会計の応援に入りました' : '🪟 応援スタッフが受付に戻りました');
      $('modal').classList.remove('show');
      save();
    });
  }

  $('clinicStage').addEventListener('click', (e) => {
    const rect = $('clinicStage').getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    // スタッフ(受付・会計)のタップを患者より優先
    const L = clinic.L;
    const staffPts = [];
    for (let w = 0; w < clinic.recepWindows(); w++) staffPts.push({ p: L.RECEP.staff[w], kind: 'recep' });
    staffPts.push({ p: L.CASH.staff, kind: 'cash' });
    if (settings.cashHelper) staffPts.push({ p: { x: L.CASH.kiosk.x, y: L.CASH.kiosk.y - 0.55 }, kind: 'cash' });
    for (const st of staffPts) {
      const sp = clinicIso.p(st.p.x + 0.5, st.p.y + 0.5, 0);
      if (Math.hypot(sp.x - px, sp.y - py) < clinicIso.tw * 0.7) { showStaffModal(st.kind); return; }
    }
    let best = null, bd = Infinity;
    for (const p of clinic.patients) {
      const sp = clinicIso.p(p.x + 0.5, p.y + 0.5, 0);
      const d = Math.hypot(sp.x - px, sp.y - py);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best || bd > clinicIso.tw * 0.9) return;
    showPatientModal(best);
  });

  $('townStage').addEventListener('click', (e) => {
    const rect = $('townStage').getBoundingClientRect();
    const tile = townIso.unproject(e.clientX - rect.left, e.clientY - rect.top);
    const b = town.buildingAt(tile);
    if (!b) return;
    openBuilding(b);
  });

  function openBuilding(b) {
    if (b.id.startsWith('dept_')) {
      const id = b.id.slice(5);
      const m = typeof SPECIALTIES !== 'undefined' ? SPECIALTIES.get(id) : null;
      const d = G.depts[id];
      if (m && d) {
        const L = d.last;
        showModal(`${m.icon} ${b.label}`, `<p>${L ? `患者 ${L.visits}人/日 / 継続患者 ${d.pt.length}人 / 昨日の損益 ${yen(L.profit)}` : '開設準備中 — 明日から診療開始'}</p><p class="modal-note">経営の操作は「🏢 法人」タブの部門カードで。</p>`, '閉じる');
      }
      return;
    }
    if (b.id.startsWith('br_')) {
      const br = G.branches.find((x) => 'br_' + x.siteId === b.id);
      if (br) showModal(br.name, `<p>患者 ${br.last ? br.last.visits : 0}人/日 / リハ ${br.last ? br.last.reha : 0}件/日 / ${REHA_NAMES[br.rehaLevel]}</p><p>評判 ${Math.round(br.rep)} / 認知 ${Math.round(br.aw * 100)}% / 昨日の損益 ${br.last ? yen(br.last.profit) : '–'}</p><p class="modal-note">詳細な経営は「🏢 法人」タブで。</p>`, '閉じる');
      return;
    }
    if (b.id === 'station') {
      if (G.billboard) { showModal('駅前看板', '<p>掲出中(維持費 ¥3,000/日)。駅利用者の新患と認知に効いています。</p>', '閉じる'); return; }
      showModal('駅前看板を出す', '<p>駅前ロータリーの看板枠に広告を掲出します。</p><p><b>効果:</b> 認知 +0.8%/日、駅利用者の新患 +1〜2人/日</p><p><b>費用:</b> ¥100,000 + ¥3,000/日</p><div class="modal-actions"><button class="btn-cta" id="actGo">実行する</button></div>', 'やめておく');
      $('actGo').addEventListener('click', () => {
        if (G.money < 100000) { toast('資金が足りません'); return; }
        G.money -= 100000;
        G.billboard = true;
        $('modal').classList.remove('show');
        toast('✅ 駅前看板を掲出しました');
        updateHeader(); save();
      });
      return;
    }
    if (b.id === 'rival') {
      showModal(`ライバル${mainSpecName()}`, `<p>開業15年、評判 ${Math.round(rivalRepNow())}(年々力をつけています)。新患は評判の比で分け合っています。リスティングを出しすぎると入札を強めてきます。</p><p class="modal-note">📖 相手を下げる手はない。自院の評判・認知・提供価値を上げるだけ。</p>`, '閉じる');
      return;
    }
    if (b.id === 'clinic') {
      showModal(`${G.clinicName}(本院)`, `<p>現在: 医師${settings.doctors}人 / PT${settings.pts}人 / ${REHA_NAMES[settings.rehaLevel]} / 評判${Math.round(G.rep)} / 認知${Math.round(G.aw * 100)}%</p>`, '閉じる');
      return;
    }
    const def = REL_DEF[b.id];
    if (def) {
      const r = G.relations[b.id];
      const ct = typeof PERSONA !== 'undefined' ? PERSONA.contact(b.id) : null;
      const greet = ct ? `<div class="persona-speech">🧑‍💼 ${ct.name}(${ct.title})<br>「${PERSONA.contactLine(b.id, r.lv, 'greet')}」</div>` : '';
      showModal(def.name, `
        ${greet}
        <p>${def.desc}</p>
        <p>関係レベル: <b class="rel-stars">${stars(r.lv, def.max)}</b>${r.lv > 0 ? `(最終訪問 Day ${r.last} / 30日放置で冷える)` : ''}</p>
        <p><b>効果:</b> ${def.effect}</p>
        ${def.needsReha && settings.specialty === 'orthopedics' && settings.rehaLevel === 0 ? '<p class="modal-note">⚠️ リハ体制がないと紹介は始まりません</p>' : ''}
        <div class="modal-actions"><button class="btn-cta" id="relGo">${r.lv === 0 ? '挨拶に行く' : r.lv < def.max ? '関係を深める' : '定期訪問する'}(${yen(def.cost)})</button></div>`,
        'やめておく');
      $('relGo').addEventListener('click', () => {
        $('modal').classList.remove('show');
        visitRelation(b.id);
      });
    }
  }

  // 3D視察(街)用: 建物ごとの介入ボタンのラベル
  function buildingActLabel(b) {
    if (b.id.startsWith('br_') || b.id.startsWith('dept_')) return `🏥 ${b.label}の様子を見る`;
    if (b.id === 'station') return G.billboard ? '🪧 駅前看板を確認する' : '🪧 駅前看板の商談をする';
    if (b.id === 'rival') return '🕵 ライバルの様子をうかがう';
    const def = REL_DEF[b.id];
    if (def) {
      const r = G.relations[b.id];
      return r && r.lv > 0 ? `🤝 ${def.name}を訪問する(${'★'.repeat(r.lv)})` : `🤝 ${def.name}に営業する`;
    }
    return `🏢 ${b.label || '建物'}を調べる`;
  }

  /* ================= UI: 法人(分院) ================= */

  const BR_ROLES = [['doctors', '医師', 1, 6], ['nurses', '看護師', 0, 6], ['pts', 'PT', 0, 20], ['receptionists', '受付', 1, 4]];
  const BR_EXPAND_COST = 4000000;
  const BR_EXPAND2_COST = 12000000;

  function branchHireCost(role, cur) {
    if (role === 'doctors') return 800000;
    if (role === 'pts') return SHOP.pt.costs[Math.min(cur, SHOP.pt.costs.length - 1)];
    if (role === 'nurses') return 120000;
    return 60000;
  }

  /* ================= 在宅部門: ルートと街の連携 ================= */

  const HOMECARE_CAP_PER_CLUSTER = 7; // 地区あたりの患者上限(ゲーム仮定。戸建て地区=べつべつの戸建て・マンション地区=同一建物の各戸)
  const HOMECARE_MIN_PER_TILE = 1.2;  // タウン1タイルの移動時間(分・ゲーム仮定)

  // 今日回る患者を地区の近い順に並べ、移動時間を付ける(同一地区内は2分)
  function orderHomecareRoute(due) {
    const S = TOWN.HOMECARE_SITES;
    const byCl = new Map();
    for (const p of due) { if (!byCl.has(p.cl)) byCl.set(p.cl, []); byCl.get(p.cl).push(p); }
    let cur = TOWN.CLINIC_ENTRANCE;
    const out = []; const rest = [...byCl.keys()];
    const dist = (cl) => Math.abs(S[cl].x - cur.x) + Math.abs(S[cl].y - cur.y);
    while (rest.length) {
      rest.sort((a, b) => dist(a) - dist(b));
      const cl = rest.shift();
      const travel = dist(cl) * HOMECARE_MIN_PER_TILE;
      byCl.get(cl).forEach((p, i) => out.push({ p, travelMin: i === 0 ? travel : 2 }));
      cur = S[cl];
    }
    return out;
  }

  function homecareCtx(dept) {
    const counts = {};
    for (const p of dept.pt) counts[p.cl] = (counts[p.cl] || 0) + 1;
    const nSites = TOWN.HOMECARE_SITES.length;
    return {
      homecareCap: nSites * HOMECARE_CAP_PER_CLUSTER,
      assignCluster: () => {
        const avail = [];
        for (let i = 0; i < nSites; i++) if ((counts[i] || 0) < HOMECARE_CAP_PER_CLUSTER) avail.push(i);
        if (!avail.length) return null;
        const i = avail[Math.floor(Math.random() * avail.length)];
        counts[i] = (counts[i] || 0) + 1;
        return i;
      },
      releaseCluster: (i) => { counts[i] = Math.max(0, (counts[i] || 0) - 1); },
      orderByRoute: (due) => orderHomecareRoute(due),
      // 在医総管の人数セル選択用(v50): マンション地区か・戸数をモジュールに渡す
      siteInfo: (i) => TOWN.HOMECARE_SITES[i],
    };
  }

  // タウン表示へ: 地区の患者数と今日のルート(期日が来ている患者の地区を近い順に)
  function updateHomecareTown() {
    if (!town.setHomecare) return;
    const d = G.depts.homecare;
    if (!d || !DEPTI) { town.setHomecare(null); return; }
    const counts = {};
    for (const p of d.pt) counts[p.cl] = (counts[p.cl] || 0) + 1;
    const due = d.pt.filter((p) => p.nv <= G.day);
    const route = [...new Set(orderHomecareRoute(due).map((o) => o.p.cl))];
    town.setHomecare({ clusters: counts, route });
    const legend = $('hcLegend');
    if (legend) legend.hidden = false;
  }

  /* ================= 診療科部門のUI(法人タブ内) ================= */

  const DEPT_KEIJI_COST = 50000; // 体制整備(院内掲示・長期処方対応)の費用: ゲーム上の仮定

  // KB整備の未了メモ(needs_review等)はプレイヤー面に出さない。debugModeでのみ見せる(designer A1)
  const DEV_WARN = new Set(['needs_review', 'rule_unmachined', 'limit_unstructured', 'unknown_item', 'no_points', 'engine']);
  const playerWarn = (ws) => (ws || []).filter((w) => !DEV_WARN.has(w.kind) && w.kind !== 'conditional_ok');
  const devWarn = (ws) => (ws || []).filter((w) => DEV_WARN.has(w.kind));

  // 設備・体制の投資ボタン(モジュールのactions定義から。購入済みは消える)。
  // noteは「何が買えるか」なので購入前に見せる(v49 PM裁定A: 値段だけで選ばせない)
  function deptActionsHtml(m, d) {
    // 本院では preset.actionHide の行動を出さない(本院で意味を持たない投資は押せない部屋を作らない・第14条。v74で眼科の手術設備は本院にも開いた)
    const hide = d.isMain && m.main && m.main.preset && m.main.preset.actionHide ? m.main.preset.actionHide : [];
    const btns = (m.actions || []).filter((a) => a.can(d) && !hide.includes(a.id))
      .map((a) => `<button class="op-btn${a.note ? ' has-note' : ''}" data-dact="${m.id}:${a.id}"><b>${a.label}</b> <small>${yen(a.cost)}</small>${a.note ? `<small class="act-note">${a.note}</small>` : ''}</button>`).join('');
    return btns ? `<div class="op-row">${btns}</div>` : '';
  }

  // 主役レバー(科ごとに1つ)。制度上の数値は全てKB(kbPts)から読む
  function deptLeverHtml(m, d) {
    if (m.id === 'ophthalmology') {
      const q = d.isMain ? mainQueueNow() : d.queue;
      const P = m.managementParameters;
      return `
      <div class="dept-lever">
        <span class="ctrl-head">検査設備への投資 <small>— 設備が検査可能範囲と単価を決める</small></span>
        ${deptActionsHtml(m, d) || '<span class="kijun-badge">導入済みの設備で診療中</span>'}
        ${d.equip.surgery && q ? `<div class="pnl-row"><span>白内障</span><b>${m.queueLine(q)}</b></div>
        <div class="pnl-row"><span>手術日</span><b>${P.surgDays.map((w) => WEEKDAYS[w]).join('・')}・枠${P.surgPerDay * d.staff.doctors}件/日</b></div>` : ''}
      </div>`;
    }
    if (m.id === 'psychiatry') {
      const cur = d.policy.timePlan;
      const i = d.last && d.last.info;
      return `
      <div class="dept-lever">
        <span class="ctrl-head">診察時間の方針 <small>— 時間区分がそのまま点数になる(通院精神療法)</small></span>
        <button class="choice-row ${cur === 'std' ? 'on' : ''}" data-dtime="${m.id}:std">
          <b>30分未満が基本</b><span>${kbPts('r08-I002-1-ha-2-1', 0)}点。多くの患者を診られるが、治療の中断は起きやすい(中断率はゲーム上の仮定)</span>
        </button>
        <button class="choice-row ${cur === 'mix' ? 'on' : ''}" data-dtime="${m.id}:mix">
          <b>必要に応じて30分以上</b><span>約3割の診察に時間をかける(${kbPts('r08-I002-1-ha-1-1', 0)}点)。収益と治療の継続のあいだを取る</span>
        </button>
        <button class="choice-row ${cur === 'long' ? 'on' : ''}" data-dtime="${m.id}:long">
          <b>全員30分以上</b><span>${kbPts('r08-I002-1-ha-1-1', 0)}点。診られる人数が大きく減り経営は厳しくなるが、中断は最も少ない</span>
        </button>
        ${i ? `<div class="pnl-row"><span>昨日の診察時間</span><b>${i.usedMin}分 / 枠${i.budgetMin}分${i.deferred ? `・翌日へ${i.deferred}件` : ''}</b></div>` : ''}
        ${deptActionsHtml(m, d) || '<span class="kijun-badge">連携病院との協定あり</span>'}
        <div class="op-row">
          <button class="op-btn" data-dippan="${m.id}">一般名処方 <span class="kijun-badge${d.policy.ippanmei ? '' : ' off'}">${d.policy.ippanmei ? 'ON' : 'OFF'}</span></button>
          <p class="pnl-note"><small>一般名処方加算の要件は院内掲示とウェブ掲載(届出は不要)。ONにすると整えている前提=ゲーム上の簡略化</small></p>
        </div>
      </div>`;
    }
    if (m.id === 'homecare') {
      const i = d.last && d.last.info;
      return `
      <div class="dept-lever">
        <span class="ctrl-head">訪問ルート <small>— 患者宅の地区を近い順に回る(本日の予定ルートは「🗺 タウン」タブへ)</small></span>
        <div class="pnl-row"><span>在宅患者</span><b>${d.pt.length}人 / 受入枠${i && i.cap !== undefined ? i.cap : TOWN.HOMECARE_SITES.length * HOMECARE_CAP_PER_CLUSTER}人</b></div>
        ${deptActionsHtml(m, d) || '<span class="kijun-badge">24時間の連絡・往診体制あり</span>'}
      </div>`;
    }
    if (m.id === 'dialysis') {
      const cools = d.policy.cools;
      return `
      <div class="dept-lever">
        <span class="ctrl-head">ベッド×クール <small>— ${d.equip.beds}床×${cools}クール(1日の枠 ${d.equip.beds * cools})</small></span>
        <button class="choice-row ${cools === 2 ? 'on' : ''}" data-dcool="${m.id}:2">
          <b>2クール</b><span>日中のみ。看護配置に余裕を残す</span>
        </button>
        <button class="choice-row ${cools === 3 ? 'on' : ''}" data-dcool="${m.id}:3">
          <b>3クール</b><span>夜間も回して枠1.5倍。3クール目は午後5時以降の開始とみなし、時間外・休日加算が付く。看護師の必要数も増える</span>
        </button>
        ${deptActionsHtml(m, d)}
      </div>`;
    }
    if (m.id === 'internal') {
      const cur = d.policy.kanri;
      const pI = [kbPts('r08-B001-3-1-lipid', 0), kbPts('r08-B001-3-1-ht', 0), kbPts('r08-B001-3-1-dm', 0)];
      return `
      <div class="dept-lever">
        <span class="ctrl-head">生活習慣病管理料の方針 <small>— 実際の算定可否は患者ごとにエンジンが判定</small></span>
        <button class="choice-row ${cur === 'I' ? 'on' : ''}" data-dkanri="${m.id}:I">
          <b>(I)</b><span>主病別 ${Math.min(...pI)}〜${Math.max(...pI)}点・月1回。検査・注射・病理診断などは管理料に含まれ別に算定しない</span>
        </button>
        <button class="choice-row ${cur === 'II' ? 'on' : ''}" data-dkanri="${m.id}:II">
          <b>(II)</b><span>${kbPts('r08-B001-3-3', 0)}点・月1回。検査は別に算定できる。(I)を算定した月から6月以内はその患者に算定できない</span>
        </button>
        <div class="op-row">
          ${d.policy.keiji
            ? '<span class="kijun-badge wrap">長期処方・リフィル対応の体制あり(届出不要)</span>'
            : `<button class="op-btn" data-dkeiji="${m.id}">📋 体制を整える(院内掲示・長期処方対応) <small>${yen(DEPT_KEIJI_COST)}</small></button>`}
          <button class="op-btn" data-dippan="${m.id}">一般名処方 <span class="kijun-badge${d.policy.ippanmei ? '' : ' off'}">${d.policy.ippanmei ? 'ON' : 'OFF'}</span></button>
          <p class="pnl-note"><small>一般名処方加算の要件は院内掲示とウェブ掲載(届出は不要)。ONにすると整えている前提=ゲーム上の簡略化</small></p>
        </div>
      </div>`;
    }
    return '';
  }

  // 施設基準の「届出済み」折りたたみの開閉状態(部門idキー。保存対象外=UI状態。innerHTML再描画で飛ぶため保持。v56 便V)
  const FS_FOLD_OPEN = new Set();

  /* 施設基準ブロック(v56 便V・designer方針): 行動(届け出る)→事実(未=足りないもの)→済み(適用中)の順に並べ、
     済みだけを<details>に畳む。gameNoteは行に従属させ(.fs-item)、fsNote(否定的確認)は行の有無に関わらず末尾に常時出す(#35) */
  function deptFsHtml(m, d, main) {
    const sts = DEPT.fsStatus(m, d);
    const nameOf = (st) => { const fs = REIMB.getFacilityStandard(st.fsId); return fs ? (fs.shortName || fs.name) : st.fsId; };
    // gameNote=ゲーム独自ゲートの断り(v52 PM裁定A。missingは足りないものの名前だけに保つ)
    const gn = (st) => (st.gameNote ? `<small class="kb-cond is-note">${st.gameNote}</small>` : '');
    const act = sts.filter((st) => !st.notified && st.ok)
      .map((st) => `<div class="fs-item${st.gameNote ? ' has-note' : ''}"><button class="mini-btn plus wrap" data-dfsnotify="${m.id}:${st.fsId}">${nameOf(st)} を届け出る</button>${gn(st)}</div>`);
    const fact = sts.filter((st) => !st.notified && !st.ok)
      .map((st) => `<div class="fs-item${st.gameNote ? ' has-note' : ''}"><span class="kijun-badge off wrap">${nameOf(st)} 未(${st.missing.join('・')})</span>${gn(st)}</div>`);
    const done = sts.filter((st) => st.notified);
    const fold = done.length
      ? `<details class="fs-fold" data-fsfold="${m.id}"${FS_FOLD_OPEN.has(m.id) ? ' open' : ''}><summary>適用中 ${done.length}件</summary><div class="fs-fold-b">${done.map((st) => `<span class="kijun-badge">${nameOf(st)}</span>`).join('')}</div></details>`
      : '';
    const grp = (xs) => (xs.length ? `<div class="fs-group">${xs.join('')}</div>` : '');
    const list = grp(act) + grp(fact) + fold;
    // fsDefsが無い科は既定文、ある科はモジュールのfsNote(否定的確認)を行と併記(#35)
    const note = sts.length === 0 ? (m.fsNote || 'この科の登録項目に届出必須の基準はない') : (m.fsNote || '');
    // 本院(経営タブ・v67 designer M2/M3): 下段「📮 その他の体制・届出」と同格の見出しを立て、裸の「施設基準」ラベルは出さない。
    // 体制の操作場所(院内›診療方針)への道筋を1行添える(ここに出るのは結果)
    if (main) {
      const title = (m.main && m.main.fsTitle) || `${m.name}の施設基準`;
      const hasLever = d.policy && Object.keys(d.policy).length > 0; // 診療方針レバーが無い科(眼科)では道筋を出さない(案内先が無い・v73)
      return `<h3 class="sub-title">📋 ${title}</h3><div class="branch-kijun">${hasLever ? '<p class="kijun-kb">体制は 🏥 院内 › 診療方針 で整える。ここに出るのは結果</p>' : ''}${list ? `<div class="fs-list">${list}</div>` : ''}${note ? `<p class="kijun-kb">${note}</p>` : ''}</div>`;
    }
    return `<div class="branch-kijun">施設基準${list ? `<div class="fs-list">${list}</div>` : ''}${note ? `<p class="kijun-kb">${note}</p>` : ''}</div>`;
  }

  function deptCard(m, d) {
    const L = d.last;
    const staffRows = (m.staffDef || []).map(([key, label, min, max, cost]) => `
      <div class="plan-step"><span>${label} <small>最大${max}・採用 ${yen(cost)}</small></span>
        <div><button class="mini-btn" data-dfire="${m.id}:${key}">−</button><b>${d.staff[key] || 0}</b><button class="mini-btn plus" data-dhire="${m.id}:${key}">＋</button></div>
      </div>`).join('');
    const info = L && L.info ? L.info : null;
    const statTxt = info
      ? (m.infoLine ? m.infoLine(info) : (info.panel !== undefined ? `継続患者 ${info.panel}人` : ''))
      : '開設準備中';
    return `
    <div class="branch-card">
      <div class="branch-head">
        <b>${m.icon} ${m.name}部門</b>
        <span class="branch-stat">${statTxt}</span>
      </div>
      ${L ? `<div class="branch-pnl">昨日: 患者${L.visits}人 売上${yen(L.revenue)} 損益 <b class="${L.profit >= 0 ? 'pos-t' : 'neg-t'}">${yen(L.profit)}</b></div>` : '<div class="branch-pnl">開設準備中 — 明日から診療開始</div>'}
      ${deptLeverHtml(m, d)}
      ${m.id === 'homecare' && (G.handoverLog || []).some((h) => h.ok) ? (() => {
        const hs = G.handoverLog.filter((h) => h.ok); const last = hs[hs.length - 1];
        return `<p class="kb-cond">本院から引き継いだ方: ${escapeHtml(last.name)}さん${last.age ? `(${last.age}${last.ch ? `・${escapeHtml(last.ch)}` : ''})` : ''}${hs.length > 1 ? ` ほか${hs.length - 1}人` : ''}</p>`;
      })() : ''}
      <div class="branch-staff">${staffRows}</div>
      ${deptFsHtml(m, d)}
      ${L && L.events.filter((e) => e.kind === 'fs_warn').map((e) => `<p class="pnl-note">⚠ ${e.message}</p>`).join('') || ''}
      <div class="op-row">
        <button class="op-btn" data-dreceipt="${m.id}">📖 昨日の代表レセプトを見る</button>
      </div>
      ${(() => { const pw = playerWarn(L && L.warnings); return pw.length ? `<p class="pnl-note">${pw[0].message}</p>` : ''; })()}
      ${G.debugMode && L && devWarn(L.warnings).length ? `<p class="pnl-note">dev: ${devWarn(L.warnings).map((w) => w.message).join(' / ')}</p>` : ''}
    </div>`;
  }

  // modal内の <div class="kb-quote">「…」</div> の重複を初出だけ残して落とす(文字列一致・順序は保つ)
  function dedupeQuotes(html) {
    const seen = new Set();
    return html.replace(/<div class="kb-quote">「([\s\S]*?)」<\/div>/g, (m0, q) => (seen.has(q) ? '' : (seen.add(q), m0)));
  }

  function deptReceiptShow(m, d) {
    const s = d.last && d.last.sample;
    if (!s) { showModal(`📖 ${m.name}部門の代表レセプト`, '<p class="plan-lead">まだ会計がありません。1日進めてから開いてください。</p>', '閉じる'); return; }
    const pageOfEv = (p) => p ? `・${String(p).replace(/^PDF\s*/, '')}` : '';
    const lineRows = s.lines.map((l) => {
      const amount = l.t != null ? `${l.t}点` : yen(l.y || 0);
      let detail = '';
      if (l.kb) {
        const it = REIMB.getItem(l.kb);
        const ev = it ? ((it.evidence || []).find((e) => e.field === 'points') || (it.evidence || [])[0]) : null;
        if (ev) {
          const doc = REIMB.docOf(ev.doc);
          detail = `<div class="kb-quote">「${ev.quote}」(${doc ? doc.title : ev.doc}${pageOfEv(ev.page)})</div>`;
        }
        // 特定保険医療材料・薬剤の行は価格・区分・使用量の説明(KBのconditions)を添える —
        // 型の6区分や「使用量5mLはゲーム上の仮定」を画面でも隠さない(v46材料・v47薬剤)。
        // 表記は院内レセプト学習モードの先例(「条件: 」ラベル・引用の前)に揃える(designer裁定)
        if (it && (it.categoryM === '特定保険医療材料' || it.categoryM === '薬剤') && it.conditions) {
          detail = `<p class="kb-cond is-note">条件: ${it.conditions}</p>` + detail;
        }
      } else if (l.incl && KBI) {
        const rule = KB_R08.rules.find((r) => r.id === l.incl);
        if (rule && rule.quote) detail = `<div class="kb-quote">「${rule.quote}」</div>`;
      }
      const approx = l.t == null;
      return `<div class="kb-ev"><b>${approx ? l.n.replace('(概算)', '') : l.n}</b>${approx ? ' <i class="sim-tag">概算</i>' : ''} — ${amount}${detail}</div>`;
    }).join('');
    // 合計は明細の後(積み上げて合計に着地する紙の読み方)。点数と概算の円は混ぜない
    const totalPts = s.lines.reduce((a, l) => a + (l.t || 0), 0);
    const approxYen = s.lines.reduce((a, l) => a + (l.t == null ? (l.y || 0) : 0), 0);
    const totalRow = `<div class="kb-ev total"><b>点数の合計</b><span>${totalPts.toLocaleString()}点 = ${yen(totalPts * 10)}</span></div>`
      + (approxYen ? `<div class="kb-cond">ほかに ${yen(approxYen)}(KB未登録・ゲーム上の概算)</div>` : '');
    // 未算定の施設基準は3状態: 要件充足(届出のみ)→導線 / 要件不足→事実のみ / 体制で解けないもの→何も足さない
    const fsStates = DEPT.fsStatus(m, d);
    // 同じ条文(ruleId)で却下された項目は1ブロックにまとめ、条文は1回だけ引く
    // (同じ法令文を何度も読ませない)。施設基準の導線を持つ却下は個別のまま
    const rejAll = (s.kb && s.kb.rejected) || [];
    const rejGroups = new Map(); const rejSingles = [];
    for (const x of rejAll) {
      const rid = !x.fsInfo && x.rules && x.rules.length === 1 && x.rules[0].quote ? x.rules[0].id : null;
      if (rid) { if (!rejGroups.has(rid)) rejGroups.set(rid, []); rejGroups.get(rid).push(x); }
      else rejSingles.push(x);
    }
    const rejGrouped = [];
    for (const xs of rejGroups.values()) {
      if (xs.length === 1) { rejSingles.push(xs[0]); continue; }
      const names = xs.map((x) => x.name);
      const label = names.length > 3 ? `${names.slice(0, 3).join('・')} ほか${names.length - 3}件` : names.join('・');
      // units>1の項目(リハ等)が将来グループに入っても合計が正しいようsubtotalを優先
      const pts = xs.reduce((a, x) => a + (x.subtotal != null ? x.subtotal : (x.points || 0)), 0);
      const reason = (xs[0].reasons || [])[0] || '';
      rejGrouped.push({ idx: rejAll.indexOf(xs[0]), html: `
      <div class="kb-reject"><b>${label}</b>(計${pts.toLocaleString()}点) は算定していません
        ${reason ? `<div class="kb-cond">${reason}</div>` : ''}
        <div class="kb-quote">「${xs[0].rules[0].quote}」</div>
      </div>` });
    }
    const rejRowsRaw = rejSingles.map((x) => {
      let fsLine = '';
      if (x.fsInfo) {
        const st = fsStates.find((f) => f.fsId === x.fsInfo.id);
        if (st && st.ok && !st.notified) {
          fsLine = `<div class="kb-cond">必要な施設基準: ${x.fsInfo.name}${x.fsInfo.formNo ? `(${x.fsInfo.formNo})` : ''}。要件は満たしています。あとは届け出るだけです</div>
            <button class="mini-btn plus" data-gokijun="${m.id}">この部門の施設基準へ</button>`;
        } else if (st && !st.ok) {
          fsLine = `<div class="kb-cond">必要な施設基準: ${x.fsInfo.name} — あと${st.missing.join('・')}が足りません</div>`;
        } else {
          fsLine = `<div class="kb-cond">必要な施設基準: ${x.fsInfo.name}${x.fsInfo.formNo ? `(${x.fsInfo.formNo})` : ''}</div>`;
        }
      }
      // fsLineが施設基準名を語るとき、reasons側の同じ一文は落とす(同じ名前を2回言わない)
      const reasons = (x.reasons || []).filter((r) => !x.fsInfo || !r.includes('施設基準'));
      return `
      <div class="kb-reject"><b>${x.name}</b>${x.points != null ? `(${x.points}点)` : ''} は算定していません
        ${reasons.length ? `<div class="kb-cond">${reasons.join('。')}</div>` : ''}
        ${(x.rules || []).filter((r) => r.quote).map((r) => `<div class="kb-quote">「${r.quote}」</div>`).join('')}
        ${fsLine}
      </div>`;
    // 個別行と集約ブロックを元の却下順(初出index)で並べ直す(順序が入れ替わらないように)
    }).map((html, i) => ({ idx: rejAll.indexOf(rejSingles[i]), html }))
      .concat(rejGrouped)
      .sort((a, b) => a.idx - b.idx)
      .map((p) => p.html).join('');
    // 同じ法令文をmodal内で2回読ませない(v39裁定の延長・v58 #36の水平展開で近接重複が起き得る):
    // 最終並び順で同一quoteの2回目以降はquote行だけ落とす(理由・項目名は残す)
    const rejRows = dedupeQuotes(rejRowsRaw);
    const warnRows = playerWarn(s.kb && s.kb.warnings).slice(0, 3)
      .map((w) => `<div class="kb-cond">⚠ ${w.message}</div>`).join('')
      + (G.debugMode ? devWarn(s.kb && s.kb.warnings).map((w) => `<div class="kb-cond">dev: ${w.message}</div>`).join('') : '');
    showModal(`📖 ${m.name}部門の代表レセプト`, `
      <p class="plan-lead">${s.label}</p>
      ${lineRows}${totalRow}${rejRows}${warnRows}
      <p class="modal-note">点数と条文はKB(令和8年度)によります。点数は1点=10円の換算で、患者の窓口負担はその一部です。「概算」の行は、KBに未登録の行為をゲーム上の概算で計上したものです。</p>`, '閉じる');
    document.querySelectorAll('#modal [data-gokijun]').forEach((go) => go.addEventListener('click', () => {
      const mo = $('modal'); if (mo) mo.classList.remove('show');
      G.corpOpen = 'dept-' + go.dataset.gokijun;
      renderCorp();
      const kijun = document.querySelector('.branch-kijun');
      if (kijun) {
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        kijun.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
        kijun.classList.add('kijun-flash');
        setTimeout(() => kijun.classList.remove('kijun-flash'), 1200);
      }
    }));
  }

  // 部門と本院(他科・v66)で共用する方針レバーの配線。本院は id===settings.specialty のとき mainDeptShim を dept として扱う
  function deptOf(id) {
    if (id === settings.specialty) { const m = SPECIALTIES.get(id); return m ? mainDeptShim(m) : null; }
    return G.depts[id];
  }
  function afterLeverChange() { renderCorp(); renderPolicyCard(); renderPnl(); updateHeader(); save(); }
  // 施設基準の届出/折りたたみの配線。部門カード(法人タブ)と他科本院の施設基準カード(経営タブ・v67)で共用
  function bindDeptFsHandlers(el) {
    el.querySelectorAll('details.fs-fold').forEach((dt) => dt.addEventListener('toggle', () => {
      if (dt.open) FS_FOLD_OPEN.add(dt.dataset.fsfold); else FS_FOLD_OPEN.delete(dt.dataset.fsfold);
    }));
    el.querySelectorAll('[data-dfsnotify]').forEach((b) => b.addEventListener('click', () => {
      const [id, fsId] = b.dataset.dfsnotify.split(':');
      const d = deptOf(id); const m = SPECIALTIES.get(id);
      if (!d || !m) return;
      const st = DEPT.fsStatus(m, d).find((x) => x.fsId === fsId);
      if (!st || !st.ok || st.notified) return;
      d.fs.push(fsId);
      FS_FOLD_OPEN.add(id); // 届け出た直後は「適用中」を開いて見せる(閉じた箱へ消えない=第27条)
      toast('✅ 届け出ました — ゲーム上は当日から適用します(実際の適用時期は簡略化しています)');
      renderCorp(); renderPnl(); save();
    }));
  }
  function bindDeptLeverHandlers(el) {
    // 設備投資などの行動(actions)。部門は G.depts、本院は mainDeptShim(equip=settings.mainEquip)に効く(v73 便AF)
    el.querySelectorAll('[data-dact]').forEach((b) => b.addEventListener('click', () => {
      const [id, actId] = b.dataset.dact.split(':');
      const d = deptOf(id); const m = SPECIALTIES.get(id);
      const a = m ? (m.actions || []).find((x) => x.id === actId) : null;
      if (!d || !a || !a.can(d)) return;
      if (G.money < a.cost) { toast('資金が足りません'); return; }
      G.money -= a.cost;
      a.apply(d);
      SND.click();
      toast(`✅ ${a.label} — ${a.note || '整いました'}`);
      if (id === settings.specialty) afterLeverChange(); else { renderCorp(); updateHeader(); save(); }
    }));
    el.querySelectorAll('[data-dkanri]').forEach((b) => b.addEventListener('click', () => {
      const [id, plan] = b.dataset.dkanri.split(':');
      const d = deptOf(id);
      if (!d || d.policy.kanri === plan) return;
      d.policy.kanri = plan;
      toast(plan === 'I'
        ? '管理料(I)の方針に変更 — 検査・注射は管理料に含まれ、別に算定しなくなります'
        : '管理料(II)の方針に変更 — (I)を算定した患者は、その月から6月以内は算定できません');
      afterLeverChange();
    }));
    el.querySelectorAll('[data-dkeiji]').forEach((b) => b.addEventListener('click', () => {
      const d = deptOf(b.dataset.dkeiji);
      if (!d || d.policy.keiji) return;
      if (G.money < DEPT_KEIJI_COST) { toast('資金が足りません'); return; }
      G.money -= DEPT_KEIJI_COST;
      d.policy.keiji = true;
      if (!d.fs.includes('r08-fs-b001-3')) d.fs.push('r08-fs-b001-3');
      FS_FOLD_OPEN.add(b.dataset.dkeiji); // 整えた直後は「適用中」を開いて見せる(閉じた箱へ消えない=第27条・v67 designer M1)
      // 体制が整って新たに届け出られるようになった基準を、その場所(経営タブ/この部門)ごと1行で示す(v67 designer M2)
      const dm = SPECIALTIES.get(b.dataset.dkeiji);
      const opened = dm ? DEPT.fsStatus(dm, d).filter((st) => st.ok && !st.notified).map((st) => { const fs = REIMB.getFacilityStandard(st.fsId); return fs ? (fs.shortName || fs.name) : st.fsId; }) : [];
      const where = b.dataset.dkeiji === settings.specialty ? '📊 経営 › 施設基準' : 'この部門';
      toast('📋 体制を整えました。生活習慣病管理料は届出不要' + (opened.length ? `。次は「${opened.join('・')}」の届出(${where})` : '')); // 正式名称ベース(社長決定 2026-09-05)。375幅で3行になるが名称は削らない
      afterLeverChange();
    }));
    el.querySelectorAll('[data-dippan]').forEach((b) => b.addEventListener('click', () => {
      const d = deptOf(b.dataset.dippan);
      if (!d) return;
      d.policy.ippanmei = !d.policy.ippanmei;
      afterLeverChange();
    }));
  }
  // 診療方針カード(v66): 整形本院は従来のスライダー(.ctrl-grid)、他科本院はモジュールのレバー(部門と同じHTML)を #mainLever に描く
  function renderPolicyCard() {
    const card = $('policyCard'); if (!card) return;
    const grid = card.querySelector('.ctrl-grid');
    let lever = $('mainLever');
    if (!lever) { lever = document.createElement('div'); lever.id = 'mainLever'; card.appendChild(lever); }
    const m = SPECIALTIES.get(settings.specialty);
    const ortho = settings.specialty === 'orthopedics' || !m || !m.main;
    lever.innerHTML = ortho ? '' : deptLeverHtml(m, mainDeptShim(m));
    if (!ortho) bindDeptLeverHandlers(lever);
  }
  function renderCorp() {
    const el = $('corpBody');
    if (!el) return;
    const total = corpStaff();
    const corpToday = G.history.length ? G.history[G.history.length - 1] : null;
    const summary = `
      <div class="corp-summary">
        <span>拠点 <b>${1 + G.branches.length}</b></span>
        <span>医師 <b>${total.doctors}</b></span>
        <span>看護師 <b>${total.nurses}</b></span>
        <span>PT <b>${total.pts}</b></span>
        <span>受付 <b>${total.receptionists}</b></span>
        ${corpToday ? `<span>昨日の法人損益 <b class="${(corpToday.profit + corpToday.brProfit) >= 0 ? 'pos-t' : 'neg-t'}">${yen(corpToday.profit + corpToday.brProfit)}</b></span>` : ''}
      </div>`;

    // 拠点の索引+1件だけ展開(現在地は常に1つ)。展開中の拠点だけ操作UIを描く
    const open = G.corpOpen || null;
    const siteRow = (id, icon, name, badge, stat, warn) => `
      <button class="site-row ${open === id ? 'on' : ''}" data-site="${id}">
        <span class="site-name">${icon} ${name}</span>
        ${badge ? `<span class="site-badge">${badge}</span>` : ''}
        ${warn ? '<span class="site-warn">⚠</span>' : ''}
        <span class="site-stat">${stat || ''}</span>
        <span class="site-caret">${open === id ? '▴' : '▾'}</span>
      </button>`;

    // 診療科部門: fullモジュールは開設して経営できる。それ以外は準備中の一覧
    const deptParts = [];
    for (const m of (typeof SPECIALTIES !== 'undefined' ? SPECIALTIES.playable() : [])) {
      if (m.id === settings.specialty) continue;
      if (!m.open && !(G.depts && G.depts[m.id])) continue; // 部門として開設できない科(整形=本院専用)は並べない(第14条)
      const d = G.depts[m.id];
      if (d && DEPTI && m.status === 'full') {
        const L = d.last;
        const p7 = d.profit7.reduce((a, x) => a + x, 0);
        const warn = !!(L && L.events.length) || (d.profit7.length >= 7 && p7 < 0);
        deptParts.push(siteRow('dept-' + m.id, m.icon, `${m.name}部門`,
          m.deptBadge ? m.deptBadge(d) : '', L ? `昨日 ${yen(L.profit)}` : '準備中', warn));
        if (open === 'dept-' + m.id) deptParts.push(`<div class="site-detail">${deptCard(m, d)}</div>`);
      } else if (DEPTI && m.status === 'full' && m.open) {
        const can = (!m.open.needPlan || G.plan) && G.rep >= m.open.repMin && G.money >= m.open.cost;
        deptParts.push(`<div class="spec-row">
          <b>${m.icon} ${m.name}</b>
          <small>${m.desc}</small>
          <div class="spec-open"><small>開設条件: ${m.open.condDesc}</small>
            <button class="mini-btn ${can ? 'plus' : ''}" data-deptopen="${m.id}" ${can ? '' : 'disabled'}>開設する ${yen(m.open.cost)}</button></div>
        </div>`);
      } else {
        deptParts.push(`<div class="spec-row"><b>${m.icon} ${m.name}</b> <span class="kijun-badge off">準備中</span><small>${m.desc}</small></div>`);
      }
    }
    const specialtySection = deptParts.length ? `<h3 class="sub-title">🌱 別の診療科を開く <small>— 診療科部門。会計は1行ずつ根拠つき</small></h3>${deptParts.join('')}` : '';

    // 🤝 今月の紹介(直近30日): 紹介は部門と部門のあいだの出来事なので独立セクションで見せる(designer裁定)。
    // 他院へ流れた分も同じ書式・同じ色で並べ、円は出さない(失敗ではなくケアが成立した事実)
    let referSection = '';
    {
      const win = (G.referLog || []).filter((l) => l.day > G.day - 30);
      if (win.length) {
        const nameOf = (id) => id === 'main' ? '🏥 本院' : (() => { const sm = SPECIALTIES.get(id); return sm ? `${sm.icon} ${sm.short || sm.name}` : id; })();
        const aggR = {};
        for (const l of win) { const k = `${l.from}>${l.to}>${l.ok ? 1 : 0}`; (aggR[k] = aggR[k] || Object.assign({}, l, { n: 0 })).n++; }
        const refRows = Object.values(aggR).map((a) => { const tm = SPECIALTIES.get(a.to) || { name: a.to }; return `<div class="pnl-row"><span>${nameOf(a.from)} → ${a.ok ? nameOf(a.to) : `他院の${tm.short || tm.name}`}(${a.reason})</span><b>${a.n}件</b></div>`; }).join('');
        const outTos = [...new Set(win.filter((l) => !l.ok).map((l) => l.to))];
        const leads = outTos.map((to) => {
          const sm = SPECIALTIES.get(to); const nm2 = sm ? (sm.short || sm.name) : to;
          const n2 = win.filter((l) => !l.ok && l.to === to).length;
          if (!G.depts[to]) return `<p class="plan-lead">${nm2}部門は未開設のため、この${n2}件は他院が診ています。開けば、次からは法人の中で続きます</p>`;
          return to === 'homecare'
            ? `<p class="plan-lead">${nm2}部門の地区に空きがなく、他院の在宅診療が引き受けました。地区に空きが出れば法人内で受けられます</p>`
            : `<p class="plan-lead">${nm2}部門が受けきれず、他院が引き受けました。医師を増やすと法人内で受けられます</p>`;
        }).join('');
        referSection = `<h3 class="sub-title">🤝 今月の紹介 <small>— 患者さんが次に向かった先</small></h3>${refRows}${leads}
          <p class="kb-cond">紹介先が同一法人内なら、診療情報提供料(I)は算定できません(留意事項B009(4))。算定できるのは他院への紹介だけです</p>`;
      }
    }

    const brCard = (br, bi) => {
      const machineMax = (br.floorLv || 1) >= 3 ? 18 : (br.floorLv || 1) >= 2 ? 12 : 6;
      const kijunBtns = KIJUN.map((k) => {
        if (br.rehaLevel === k.lv) return `<span class="kijun-badge">${k.name} 届出済</span>`;
        const ok = k.lv === 3 ? (br.staff.pts >= 4 && (br.floorLv || 1) >= 2) : k.ok(br.staff.pts, 1);
        return `<button class="mini-btn ${ok ? 'plus' : ''}" data-brkijun="${bi}:${k.lv}" ${ok ? '' : 'disabled'}>${k.name}</button>`;
      }).join(' ');
      const p7 = br.profit7.reduce((a, x) => a + x, 0);
      return `
      <div class="branch-card">
        <div class="branch-head">
          <b>🏥 ${br.name}${(br.floorLv || 1) >= 3 ? ' <small>🏙150㎡</small>' : (br.floorLv || 1) >= 2 ? ' <small>🏗100㎡</small>' : ''}${br.mri ? ' <small>🧲MRI</small>' : ''}</b>
          <span class="branch-stat">評判 ${Math.round(br.rep)} / 認知 ${Math.round(br.aw * 100)}% / ${REHA_NAMES[br.rehaLevel]}</span>
        </div>
        ${br.last ? `<div class="branch-pnl">昨日: 患者${br.last.visits}人(リハ${br.last.reha}) 売上${yen(br.last.revenue)} 損益 <b class="${br.last.profit >= 0 ? 'pos-t' : 'neg-t'}">${yen(br.last.profit)}</b> / 直近7日計 <b class="${p7 >= 0 ? 'pos-t' : 'neg-t'}">${yen(p7)}</b></div>` : '<div class="branch-pnl">開院準備中 — 明日から診療開始</div>'}
        <div class="branch-staff">
          ${BR_ROLES.map(([key, label, min, max]) => `
            <div class="plan-step"><span>${label} <small>最大${max}</small></span>
              <div><button class="mini-btn" data-brfire="${bi}:${key}">−</button><b>${br.staff[key]}</b><button class="mini-btn plus" data-brhire="${bi}:${key}">＋ ${yen(branchHireCost(key, br.staff[key]))}</button></div>
            </div>`).join('')}
          <div class="plan-step"><span>リハ機器 <small>最大${machineMax}・稼働=min(機器,PT×2)</small></span>
            <div><button class="mini-btn" data-brmfire="${bi}">−</button><b>${br.machines}</b><button class="mini-btn plus" data-brmachine="${bi}">＋ ${yen(300000)}</button></div>
          </div>
          <div class="plan-step"><span>物療機器 <small>最大6・1台30件/日</small></span>
            <div><button class="mini-btn" data-brpfire="${bi}">−</button><b>${br.physio || 0}</b><button class="mini-btn plus" data-brphysio="${bi}">＋ ${yen(80000)}</button></div>
          </div>
        </div>
        <div class="ctrl-grid">
          <label class="ctrl"><span class="ctrl-head">注射方針 <b>${Math.round((br.pInj || 0.2) * 100)}%</b></span>
            <input type="range" data-brpinj="${bi}" min="0" max="50" step="5" value="${Math.round((br.pInj || 0.2) * 100)}"></label>
          <label class="ctrl"><span class="ctrl-head">リハ提案方針 <b>${Math.round((br.pReha || 0.35) * 100)}%</b></span>
            <input type="range" data-brpreha="${bi}" min="0" max="70" step="5" value="${Math.round((br.pReha || 0.35) * 100)}"></label>
        </div>
        <div class="op-row">
          ${(br.floorLv || 1) < 2 ? `<button class="op-btn" data-brexpand="${bi}">🏗 増築100㎡ <small>${yen(BR_EXPAND_COST)}</small></button>` : ''}
          ${(br.floorLv || 1) === 2 ? `<button class="op-btn" data-brexpand2="${bi}">🏙 別館150㎡ <small>${yen(BR_EXPAND2_COST)}</small></button>` : ''}
          ${!br.mri ? `<button class="op-btn" data-brmri="${bi}">🧲 MRI導入 <small>${yen(MRI_COST)}</small></button>` : ''}
          <button class="op-btn" data-brsales="${bi}">📣 地域営業 <small>¥30,000(認知+1.5%)</small></button>
        </div>
        <div class="branch-kijun">施設基準(<b>専従はこの分院のPTのみ</b>。(I)は増築100㎡+PT4名): ${kijunBtns}</div>
      </div>`;
    };

    const exCount = G.branches.filter((b) => b.siteId.startsWith('ex')).length;
    const generic = { id: 'ex' + (exCount + 1), name: `郊外${exCount + 1}号院`, cost: 12000000 + exCount * 2000000, desc: '隣町の新興住宅地。マップ外だが商圏は良好。分院数に上限はありません。' };
    const openable = [...SITES.filter((s) => !G.branches.some((b) => b.siteId === s.id)), generic];
    const openSection = `
      <h3 class="sub-title">🏗 新しい分院を開設する</h3>
      <p class="plan-lead">条件: <b>事業計画の策定 ${G.plan ? '✅' : '❌'}</b> / <b>本院評判70以上 ${G.rep >= 70 ? '✅' : `❌(現在${Math.round(G.rep)})`}</b> / 開設資金</p>
      ${openable.map((s) => {
        const can = G.plan && G.rep >= 70 && G.money >= s.cost;
        return `<div class="shop-row">
          <div class="shop-info"><span class="shop-name">${s.name} <small class="shop-max">${yen(s.cost)}</small></span><span class="shop-hint">${s.desc}</span></div>
          <div class="shop-btns"><button class="mini-btn ${can ? 'plus' : ''}" data-open="${s.id}" data-opencost="${s.cost}" data-openname="${s.name}" ${can ? '' : 'disabled'}>開設する</button></div>
        </div>`;
      }).join('')}`;

    const h = G.hospital;
    let hospSection;
    if (!h) {
      const canHosp = (G.league ? G.league.beaten : 0) >= 7 && G.plan && G.money >= HOSP_BUILD_COST;
      hospSection = `
      <h3 class="sub-title">🏥 グループ病院を建てる — 町のクリニックから、全国規模の医療グループへ</h3>
      <p class="plan-lead">外来の売上は「来た日」だけ。入院は<b>「病床が埋まっている毎日」</b>が売上 — 回復期リハ病棟入院料1(<b>2,229点/日×病床</b>)という別次元の算定の世界です。</p>
      <div class="pnl-row"><span>条件① 県リーグ制覇</span><b>${(G.league ? G.league.beaten : 0) >= 7 ? '✅' : `❌(現在 ${G.league ? G.league.beaten : 0}/7)`}</b></div>
      <div class="pnl-row"><span>条件② 事業計画の策定</span><b>${G.plan ? '✅' : '❌'}</b></div>
      <div class="pnl-row"><span>条件③ 建設資金(回復期リハ病棟60床)</span><b>${yen(HOSP_BUILD_COST)}</b></div>
      <button class="btn-cta ${canHosp ? '' : 'ghost'}" id="hospBuild" ${canHosp ? '' : 'disabled'}>🏥 病院を建設する ${yen(HOSP_BUILD_COST)}</button>`;
    } else {
      const L = h.last;
      hospSection = `
      <h3 class="sub-title">🏥 ${escapeHtml(G.clinicName)} グループ病院 <small>— 回復期リハ病棟 ${h.beds}床${h.naika ? '・内科' : ''}${h.ope ? '・手術センター' : ''}</small></h3>
      ${L ? `
      <div class="pnl-row"><span>回復期リハ病棟入院料1(2,229点/日 × ${L.occupied}床稼働)</span><b>${yen(L.wardRev)}</b></div>
      <div class="pnl-row"><span>整形外来(${L.orthoV}人)</span><b>${yen(L.orthoRev)}</b></div>
      ${h.naika ? `<div class="pnl-row"><span>内科外来(${L.naikaV}人)</span><b>${yen(L.naikaRev)}</b></div>` : ''}
      ${h.ope ? `<div class="pnl-row"><span>手術(人工関節・骨接合等 ${L.opeN}件)</span><b>${yen(L.opeRev)}</b></div>` : ''}
      <div class="pnl-row"><span>人件費・固定費・変動費</span><b>−${yen(L.cost)}</b></div>
      <div class="pnl-row total ${L.profit >= 0 ? 'pos' : 'neg'}"><span>昨日の病院損益</span><b>${L.profit >= 0 ? '+' : ''}${yen(L.profit)}</b></div>
      <p class="pnl-note">稼働上限 ${L.usable}床 = min(病床${h.beds}, PT${h.hospPTs}×6床, 病棟看護${h.wardNurses}×5床) × 需要${Math.round(L.demand * 100)}%。<b>配置基準がそのまま売上上限</b>。入院は休診日も動き続けます(人件費85%)</p>` : '<p class="plan-lead">開院準備中 — 明日から稼働します。</p>'}
      <div class="branch-staff">
        <div class="plan-step"><span>病棟看護師 <small>1人=5床・日給¥18,000</small></span>
          <div><button class="mini-btn" data-hfire="wardNurses">−</button><b>${h.wardNurses}</b><button class="mini-btn plus" data-hhire="wardNurses">＋ ${yen(150000)}</button></div></div>
        <div class="plan-step"><span>病院PT <small>1人=6床・日給¥16,000</small></span>
          <div><button class="mini-btn" data-hfire="hospPTs">−</button><b>${h.hospPTs}</b><button class="mini-btn plus" data-hhire="hospPTs">＋ ${yen(250000)}</button></div></div>
        <div class="plan-step"><span>整形外科医(勤務医) <small>日給¥120,000</small></span>
          <div><button class="mini-btn" data-hfire="orthoDocs">−</button><b>${h.orthoDocs}</b><button class="mini-btn plus" data-hhire="orthoDocs">＋ ${yen(1500000)}</button></div></div>
        ${h.naika ? `<div class="plan-step"><span>内科医 <small>日給¥120,000</small></span>
          <div><button class="mini-btn" data-hfire="internists">−</button><b>${h.internists}</b><button class="mini-btn plus" data-hhire="internists">＋ ${yen(1500000)}</button></div></div>` : ''}
        ${h.ope ? `<div class="plan-step"><span>外科医(手術) <small>日給¥120,000・週約3件/人</small></span>
          <div><button class="mini-btn" data-hfire="surgeons">−</button><b>${h.surgeons}</b><button class="mini-btn plus" data-hhire="surgeons">＋ ${yen(2000000)}</button></div></div>` : ''}
      </div>
      <div class="op-row">
        ${h.beds < 120 ? `<button class="op-btn" data-hexpand="1">🏗 増床 60→120床 <small>${yen(HOSP_EXPAND_COST)}</small></button>` : ''}
        ${!h.naika ? `<button class="op-btn" data-hnaika="1">🩺 内科を開設 <small>${yen(HOSP_NAIKA_COST)}・診療科が広がる</small></button>` : ''}
        ${!h.ope ? `<button class="op-btn" data-hope="1">🔪 手術センター <small>${yen(HOSP_OPE_COST)}・人工関節等</small></button>` : ''}
      </div>`;
    }

    // 索引(site-row)+展開中の1件だけ詳細を描く
    const mainLast = [...G.history].reverse().find((x) => x.kind !== 'closed') || null;
    const rows = [];
    const mainSpec = (typeof SPECIALTIES !== 'undefined' && SPECIALTIES.get(settings.specialty)) || null;
    rows.push(siteRow('main', '🏥', escapeHtml(G.clinicName), '本院',
      mainLast ? `昨日 ${yen(mainLast.profit)}` : '', false));
    if (open === 'main') rows.push(`<div class="site-detail">
      <div class="pnl-row"><span>診療科</span><b>${mainSpec ? mainSpec.name : '整形外科'}</b></div>
      <div class="pnl-row"><span>体制</span><b>医師${settings.doctors} / 看護師${settings.nurses} / PT${settings.pts} / ${REHA_NAMES[settings.rehaLevel]}</b></div>
      <div class="pnl-row"><span>評判 / 認知</span><b>${Math.round(G.rep)} / ${Math.round(G.aw * 100)}%</b></div>
      ${mainLast ? `<div class="pnl-row"><span>昨日</span><b>患者${mainLast.patients}人・売上${yen(mainLast.revenue)}・損益${yen(mainLast.profit)}</b></div>` : ''}
      <p class="pnl-note">本院の診療は「🏥 院内」タブ、人員・設備・施設基準は「📊 経営」タブで。</p>
    </div>`);
    G.branches.forEach((br, bi) => {
      const p7 = br.profit7.reduce((a, x) => a + x, 0);
      rows.push(siteRow('br' + bi, '🏥', br.name, REHA_NAMES[br.rehaLevel],
        br.last ? `昨日 ${yen(br.last.profit)}` : '準備中', br.profit7.length >= 7 && p7 < 0));
      if (open === 'br' + bi) rows.push(`<div class="site-detail">${brCard(br, bi)}</div>`);
    });
    if (G.hospital) {
      rows.push(siteRow('hosp', '🏥', 'グループ病院', `回復期${G.hospital.beds}床`,
        G.hospital.last ? `昨日 ${yen(G.hospital.last.profit)}` : '準備中', false));
      if (open === 'hosp') rows.push(`<div class="site-detail">${hospSection}</div>`);
    }
    rows.push(siteRow('newsite', '🏗', '新しく開設する', '',
      `分院${G.branches.length}${G.hospital ? '・病院あり' : ''}`, false));
    if (open === 'newsite') rows.push(`<div class="site-detail">${openSection}${G.hospital ? '' : hospSection}</div>`);

    el.innerHTML = summary
      + `<h3 class="sub-title">🏥 ${mainSpecName()}を増やす <small>— 分院とグループ病院</small></h3>`
      + rows.join('')
      + referSection
      + specialtySection;

    el.querySelectorAll('[data-site]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.site;
      G.corpOpen = G.corpOpen === id ? null : id;
      renderCorp();
    }));

    // 診療科部門の操作
    el.querySelectorAll('[data-deptopen]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.deptopen;
      const m = SPECIALTIES.get(id);
      if (!m || !m.open || G.depts[id]) return;
      if (G.money < m.open.cost) { toast('資金が足りません'); return; }
      G.money -= m.open.cost;
      G.depts[id] = DEPT.create(m, G.day);
      if (town.setDepts) town.setDepts(Object.keys(G.depts));
      if (id === 'homecare') updateHomecareTown();
      G.corpOpen = 'dept-' + id;
      SND.fanfare();
      toast(`🎉 ${m.name}部門を開設しました — 明日から診療開始`);
      renderCorp(); updateHeader(); save();
    }));
    bindDeptLeverHandlers(el);
    el.querySelectorAll('[data-dhire]').forEach((b) => b.addEventListener('click', () => {
      const [id, key] = b.dataset.dhire.split(':');
      const d = G.depts[id]; const m = SPECIALTIES.get(id);
      const def = m ? (m.staffDef || []).find((x) => x[0] === key) : null;
      if (!d || !def) return;
      if ((d.staff[key] || 0) >= def[3]) { toast('これ以上は増やせません'); return; }
      if (G.money < def[4]) { toast('資金が足りません'); return; }
      G.money -= def[4];
      d.staff[key] = (d.staff[key] || 0) + 1;
      SND.click();
      renderCorp(); updateHeader(); save();
    }));
    el.querySelectorAll('[data-dfire]').forEach((b) => b.addEventListener('click', () => {
      const [id, key] = b.dataset.dfire.split(':');
      const d = G.depts[id]; const m = SPECIALTIES.get(id);
      const def = m ? (m.staffDef || []).find((x) => x[0] === key) : null;
      if (!d || !def) return;
      if ((d.staff[key] || 0) <= def[2]) { toast('これ以上は減らせません'); return; }
      d.staff[key]--;
      renderCorp(); save();
    }));
    bindDeptFsHandlers(el);
    el.querySelectorAll('[data-dreceipt]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.dreceipt;
      const m = SPECIALTIES.get(id);
      if (m && G.depts[id]) deptReceiptShow(m, G.depts[id]);
    }));
    el.querySelectorAll('[data-dtime]').forEach((b) => b.addEventListener('click', () => {
      const [id, plan] = b.dataset.dtime.split(':');
      const d = G.depts[id];
      if (!d || d.policy.timePlan === plan) return;
      d.policy.timePlan = plan;
      toast(plan === 'long' ? '全員30分以上の方針へ — 診られる人数は減りますが、治療の中断は最も少なくなります'
        : plan === 'mix' ? '必要に応じて30分以上の方針へ — 約3割の診察に時間をかけます'
        : '30分未満が基本の方針へ — 診られる人数は増えますが、治療の中断は起きやすくなります');
      renderCorp(); save();
    }));
    el.querySelectorAll('[data-dcool]').forEach((b) => b.addEventListener('click', () => {
      const [id, n] = b.dataset.dcool.split(':');
      const d = G.depts[id];
      if (!d || d.policy.cools === Number(n)) return;
      d.policy.cools = Number(n);
      toast(Number(n) === 3 ? '3クール運用へ — 夜間帯も回します(看護配置に注意)' : '2クール運用へ — 日中のみの運用に戻します');
      renderCorp(); save();
    }));


    el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
      const cost = Number(b.dataset.opencost);
      const name = b.dataset.openname;
      if (G.money < cost) { toast('資金が足りません'); return; }
      G.money -= cost;
      G.branches.push({
        siteId: b.dataset.open, name, openedDay: G.day,
        staff: { doctors: 1, nurses: 1, pts: 0, receptionists: 1 },
        machines: 0, physio: 0, floorLv: 1, mri: false, pInj: 0.2, pReha: 0.35,
        rehaLevel: 0, aw: 0.12, rep: 52, revisitPool: 4, rehabPool: 0, profit7: [], last: null
      });
      town.setBranches(G.branches.map((x) => x.siteId));
      toast(`🎉 ${name} を開設しました`);
      renderCorp(); updateHeader(); save();
    }));
    el.querySelectorAll('[data-brhire]').forEach((b) => b.addEventListener('click', () => {
      const [bi, key] = b.dataset.brhire.split(':');
      const br = G.branches[Number(bi)];
      const role = BR_ROLES.find((r) => r[0] === key);
      if (br.staff[key] >= role[3]) { toast('これ以上は増やせません'); return; }
      const cost = branchHireCost(key, br.staff[key]);
      if (G.money < cost) { toast('資金が足りません'); return; }
      G.money -= cost;
      br.staff[key]++;
      renderCorp(); updateHeader(); save();
    }));
    el.querySelectorAll('[data-brfire]').forEach((b) => b.addEventListener('click', () => {
      const [bi, key] = b.dataset.brfire.split(':');
      const br = G.branches[Number(bi)];
      const role = BR_ROLES.find((r) => r[0] === key);
      if (br.staff[key] <= role[2]) { toast('これ以上は減らせません'); return; }
      br.staff[key]--;
      branchKijunCheck(br);
      renderCorp(); save();
    }));
    el.querySelectorAll('[data-brmachine]').forEach((b) => b.addEventListener('click', () => {
      const br = G.branches[Number(b.dataset.brmachine)];
      const max = (br.floorLv || 1) >= 3 ? 18 : (br.floorLv || 1) >= 2 ? 12 : 6;
      if (br.machines >= max) { toast('これ以上は入りません(増築で上限UP)'); return; }
      if (G.money < 300000) { toast('資金が足りません'); return; }
      G.money -= 300000;
      br.machines++;
      renderCorp(); updateHeader(); save();
    }));
    el.querySelectorAll('[data-brmfire]').forEach((b) => b.addEventListener('click', () => {
      const br = G.branches[Number(b.dataset.brmfire)];
      if (br.machines <= 0) return;
      br.machines--;
      renderCorp(); save();
    }));
    el.querySelectorAll('[data-brphysio]').forEach((b) => b.addEventListener('click', () => {
      const br = G.branches[Number(b.dataset.brphysio)];
      if ((br.physio || 0) >= 6) { toast('これ以上は入りません'); return; }
      if (G.money < 80000) { toast('資金が足りません'); return; }
      G.money -= 80000;
      br.physio = (br.physio || 0) + 1;
      renderCorp(); updateHeader(); save();
    }));
    el.querySelectorAll('[data-brpfire]').forEach((b) => b.addEventListener('click', () => {
      const br = G.branches[Number(b.dataset.brpfire)];
      if ((br.physio || 0) <= 0) return;
      br.physio--;
      renderCorp(); save();
    }));
    el.querySelectorAll('[data-brexpand]').forEach((b) => b.addEventListener('click', () => {
      const br = G.branches[Number(b.dataset.brexpand)];
      if (G.money < BR_EXPAND_COST) { toast(`資金が足りません(${yen(BR_EXPAND_COST)})`); return; }
      G.money -= BR_EXPAND_COST;
      br.floorLv = 2;
      toast(`🏗 ${br.name} を増築(100㎡) — 機器12台・運動器リハ(I)の面積要件を満たしました`);
      renderCorp(); updateHeader(); save();
    }));
    el.querySelectorAll('[data-brexpand2]').forEach((b) => b.addEventListener('click', () => {
      const br = G.branches[Number(b.dataset.brexpand2)];
      if (G.money < BR_EXPAND2_COST) { toast(`資金が足りません(${yen(BR_EXPAND2_COST)})`); return; }
      G.money -= BR_EXPAND2_COST;
      br.floorLv = 3;
      toast(`🏙 ${br.name} に別館(150㎡) — 機器18台体制になりました(家賃¥90,000/日)`);
      renderCorp(); updateHeader(); save();
    }));
    el.querySelectorAll('[data-brmri]').forEach((b) => b.addEventListener('click', () => {
      const br = G.branches[Number(b.dataset.brmri)];
      if (G.money < MRI_COST) { toast(`資金が足りません(${yen(MRI_COST)})`); return; }
      G.money -= MRI_COST;
      br.mri = true;
      toast(`🧲 ${br.name} にMRIを導入しました(維持費¥12,000/日)`);
      renderCorp(); updateHeader(); save();
    }));
    el.querySelectorAll('[data-brsales]').forEach((b) => b.addEventListener('click', () => {
      const br = G.branches[Number(b.dataset.brsales)];
      if (G.money < 30000) { toast('資金が足りません'); return; }
      G.money -= 30000;
      br.aw = clamp(br.aw + 0.015, 0.05, 0.9);
      toast(`📣 ${br.name}: 地域営業 — 認知が ${Math.round(br.aw * 100)}% になりました`);
      renderCorp(); updateHeader(); save();
    }));
    el.querySelectorAll('[data-brpinj]').forEach((s) => s.addEventListener('input', (e) => {
      G.branches[Number(e.target.dataset.brpinj)].pInj = Number(e.target.value) / 100;
      save();
    }));
    el.querySelectorAll('[data-brpreha]').forEach((s) => s.addEventListener('input', (e) => {
      G.branches[Number(e.target.dataset.brpreha)].pReha = Number(e.target.value) / 100;
      save();
    }));
    el.querySelectorAll('[data-brkijun]').forEach((b) => b.addEventListener('click', () => {
      const [bi, lv] = b.dataset.brkijun.split(':').map(Number);
      const br = G.branches[bi];
      br.rehaLevel = lv;
      toast(`✅ ${br.name}: ${REHA_FULL[lv]}を届け出ました`);
      renderCorp(); save();
    }));

    // 病院の操作
    const hb = $('hospBuild');
    if (hb) hb.addEventListener('click', () => {
      if ((G.league ? G.league.beaten : 0) < 7 || !G.plan || G.money < HOSP_BUILD_COST) return;
      G.money -= HOSP_BUILD_COST;
      G.hospital = {
        openedDay: G.day, beds: 60, wardNurses: 12, hospPTs: 10,
        orthoDocs: 2, internists: 0, surgeons: 0, naika: false, ope: false,
        rep: 60, last: null
      };
      SND.fanfare();
      showModal('🏥 グループ病院、開院', `
        <p>回復期リハ病棟 <b>60床</b> の病院が開院しました。クリニック群で外来を受け、病院で入院リハを受ける — <b>地域完結型のグループ</b>の完成形へ。</p>
        <div class="pnl-row"><span>回復期リハ病棟入院料1</span><b>2,229点/日 × 稼働病床</b></div>
        <div class="pnl-row"><span>稼働の上限</span><b>min(病床, PT×6床, 病棟看護×5床)</b></div>
        <p class="modal-note">📖 外来は「来た日」だけの売上、入院は「埋まっている毎日」が売上。そのかわり配置基準(人)を守れなければ病床は使えない — 病院経営は採用と稼働率のゲーム。</p>`,
        '病院経営へ');
      renderCorp(); updateHeader(); save();
    });
    const HIRE_COST = { wardNurses: 150000, hospPTs: 250000, orthoDocs: 1500000, internists: 1500000, surgeons: 2000000 };
    const HMAX = { wardNurses: 40, hospPTs: 30, orthoDocs: 8, internists: 6, surgeons: 6 };
    const HMIN = { wardNurses: 4, hospPTs: 2, orthoDocs: 1, internists: 0, surgeons: 0 };
    el.querySelectorAll('[data-hhire]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.hhire;
      if (G.hospital[k] >= HMAX[k]) { toast('これ以上は増やせません'); return; }
      if (G.money < HIRE_COST[k]) { toast('資金が足りません'); return; }
      G.money -= HIRE_COST[k];
      G.hospital[k]++;
      SND.click();
      renderCorp(); updateHeader(); save();
    }));
    el.querySelectorAll('[data-hfire]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.hfire;
      if (G.hospital[k] <= HMIN[k]) { toast('これ以上は減らせません'); return; }
      G.hospital[k]--;
      renderCorp(); save();
    }));
    const hx = el.querySelector('[data-hexpand]');
    if (hx) hx.addEventListener('click', () => {
      if (G.money < HOSP_EXPAND_COST) { toast(`資金が足りません(${yen(HOSP_EXPAND_COST)})`); return; }
      G.money -= HOSP_EXPAND_COST;
      G.hospital.beds = 120;
      toast('🏗 増床 — 回復期リハ病棟120床。配置(PT・看護)も忘れずに');
      renderCorp(); updateHeader(); save();
    });
    const hn = el.querySelector('[data-hnaika]');
    if (hn) hn.addEventListener('click', () => {
      if (G.money < HOSP_NAIKA_COST) { toast(`資金が足りません(${yen(HOSP_NAIKA_COST)})`); return; }
      G.money -= HOSP_NAIKA_COST;
      G.hospital.naika = true;
      G.hospital.internists = Math.max(1, G.hospital.internists);
      toast(`🩺 内科を開設 — ${mainSpecName()}以外の診療科で外来の裾野が広がります`);
      renderCorp(); updateHeader(); save();
    });
    const ho = el.querySelector('[data-hope]');
    if (ho) ho.addEventListener('click', () => {
      if (G.money < HOSP_OPE_COST) { toast(`資金が足りません(${yen(HOSP_OPE_COST)})`); return; }
      G.money -= HOSP_OPE_COST;
      G.hospital.ope = true;
      G.hospital.surgeons = Math.max(1, G.hospital.surgeons);
      toast('🔪 手術センター開設 — 人工関節・骨接合の手術が回り始めます');
      renderCorp(); updateHeader(); save();
    });
  }

  /* ================= UI: 経営タブ(P&L・基準・銀行) ================= */

  function renderPnl() {
    const T = G.today || newToday();
    const cost = dayCost();
    const spec = G.daySpec || specOf(G.day);
    const staffCost = Math.round(mainStaffCost() * spec.pay);
    $('pnlToday').innerHTML = `
      <div class="pnl-row"><span>外来収益(初再診・外来管理${T.kanriCount}件・処方箋)</span><b>${yen(T.rev.consult)}</b></div>
      <div class="pnl-row"><span>注射(関節注・トリガー等 ${T.injCount + T.trigCount}件)</span><b>${yen(T.rev.inj)}</b></div>
      <div class="pnl-row"><span>${T.surgCount ? `手術(水晶体再建術・眼内レンズ挿入 ${T.surgCount}件)・` : ''}処置(${T.treatCount}件)・物療(${T.physioCount}件)</span><b>${yen(T.rev.treat + T.rev.physio)}</b></div>
      <div class="pnl-row"><span>画像(X線${T.xrayCount}・MRI${T.mriCount})</span><b>${yen(T.rev.img)}</b></div>
      <div class="pnl-row"><span>リハビリ(${T.rehaCount}件・${REHA_NAMES[settings.rehaLevel]})</span><b>${yen(T.rev.reha)}</b></div>
      ${settings.dexa ? `<div class="pnl-row"><span>骨粗鬆症プログラム(${T.osteoVisits}件・登録${Math.round(G.osteoPool)}人)</span><b>${yen(T.rev.osteo)}</b></div>` : ''}
      <div class="pnl-row"><span>健診</span><b>${yen(T.rev.checkup)}</b></div>
      <div class="pnl-row"><span>自費(PRP${T.prpCount}件・AGA会員${Math.round(G.agaPool)}人ほか)</span><b>${yen(T.rev.jihi)}</b></div>
      <div class="pnl-row total"><span>本院売上(${T.patients}人)</span><b>${yen(T.revenue)}</b></div>
      <div class="pnl-row"><span>人件費${spec.kind === 'am' ? '(半日0.6)' : weekdayOf(G.day) === 6 && spec.kind !== 'closed' ? '(日曜手当1.4)' : ''}</span><b>−${yen(staffCost)}</b></div>
      <div class="pnl-row"><span>家賃・固定費${settings.mri ? '(MRI維持含む)' : ''}</span><b>−${yen(COSTS.rent[settings.floorLv] + COSTS.base[settings.floorLv] + (settings.mri ? COSTS.mriMaint : 0))}</b></div>
      <div class="pnl-row"><span>広告費(本日消化)</span><b>−${yen(G.adSpendToday + (G.billboard ? COSTS.billboardDay : 0))}</b></div>
      <div class="pnl-row"><span>変動費(材料・自費原価${T.surgCogs ? '・手術材料' : ''})</span><b>−${yen(T.patients * COSTS.perPatient + T.goodsCogs + T.jihiCogs + (T.labCogs || 0) + (T.surgCogs || 0))}</b></div>
      ${(() => {
        const k = G.kaitei;
        if (!k || !k.count) return '';
        const est = Math.round(T.rev.consult * (k.consult - 1) + T.rev.inj * (k.inj - 1) + T.rev.treat * (k.treat - 1) + T.rev.physio * (k.physio - 1) + T.rev.reha * (k.reha - 1) + T.rev.img * (k.img - 1));
        return est ? `<div class="pnl-row"><span>📜 診療報酬改定の影響(第${k.count}次まで累積・日締めで計上)</span><b class="${est >= 0 ? 'pos-t' : 'neg-t'}">${est >= 0 ? '+' : ''}${yen(est)}</b></div>` : '';
      })()}
      ${G.loans.length ? `<div class="pnl-row"><span>支払利息(${G.loans.length}件)</span><b>−${yen(loanInterestDay())}</b></div>` : ''}
      <div class="pnl-row total ${T.revenue - cost >= 0 ? 'pos' : 'neg'}"><span>本院 本日見込み損益</span><b>${T.revenue - cost >= 0 ? '+' : ''}${yen(T.revenue - cost)}</b></div>
      <div class="pnl-note">人件費率(本日): ${T.revenue > 0 ? Math.round(staffCost / T.revenue * 100) + '%' : '–'}(目安 45〜55%)</div>
    `;
    $('pnlMonth').textContent = `${yen(monthRevenueMain())}(法人 ${yen(monthRevenueAll())})`;

    const hist = G.history.slice(-14);
    const maxAbs = Math.max(50000, ...hist.map((h) => Math.abs(h.profit + (h.brProfit || 0))));
    $('pnlChart').innerHTML = hist.map((h) => {
      const p = h.profit + (h.brProfit || 0);
      const hpx = Math.max(3, Math.abs(p) / maxAbs * 46);
      return `<div class="bar-col" title="Day${h.day}: ${yen(p)}"><div class="bar ${p >= 0 ? 'pos' : 'neg'}" style="height:${hpx}px"></div><span>${WEEKDAYS[h.wd ?? (h.day - 1) % 7]}</span></div>`;
    }).join('') || '<p class="pnl-empty">まだ実績がありません(1日終えると表示)</p>';

    // 直近実績からの月間リハ回数(施設基準の増収試算に使用)
    const rehaMo = (() => {
      const hs = G.history.slice(-14);
      if (!hs.length) return 0;
      return Math.round(hs.reduce((a, h) => a + (h.rehaCount || 0), 0) / hs.length * 30);
    })();
    const kijunOrtho = KIJUN.map((k) => {
      const ok = k.ok(settings.pts, settings.floorLv);
      const active = settings.rehaLevel === k.lv;
      const badge = active ? '<span class="kijun-badge">適用中</span>'
        : ok ? '<span class="kijun-badge alt">条件充足</span>'
        : '<span class="kijun-badge off">条件不足</span>';
      // KBの実要件(1行要約)と増収試算(simulation estimate)
      let kbInfo = '';
      if (KBI) {
        const fs = REIMB.getFacilityStandard(REHA_KB_FS[k.lv]);
        if (fs) {
          // 制度上の要件はゲーム内要件(専従PT数)と同じものを指す文を選ぶ(第1文=医師要件では噛み合わない・editor v69 方針A)。様式は番号だけ(方針B)
          const sents = (fs.staffing || '').split('。');
          const staffing = sents.find((x) => x.includes('専従')) || sents[0];
          let formNo = (fs.formNo || '').split('。')[0].replace(/別添\d+\s*/, '');
          while (/\([^()]*\)/.test(formNo)) formNo = formNo.replace(/\([^()]*\)/g, ''); // 括弧の入れ子((I)の届出事項と同様)も消し切る(qa v69)
          let est = '';
          if (!active && settings.rehaLevel > 0 && k.lv > settings.rehaLevel && rehaMo > 0) {
            const d = (kbPts(REHA_KB_ITEM[k.lv], 0) - kbPts(REHA_KB_ITEM[settings.rehaLevel], 0)) * 2 * rehaMo;
            est = `<br><b>推定月間増収 約${yen(d * 10)}</b>(現在のリハ${rehaMo}回/月ベースの試算・確定収益ではない)`;
          }
          kbInfo = `<div class="kijun-kb">制度上の要件: ${staffing}${formNo ? ` / 届出: ${formNo}` : ''}${est}</div>`;
        }
      }
      return `<div class="kijun-row ${active ? 'ok' : ''}">
        <div><b>${k.name}</b> ${badge} — リハ1回(2単位) ${yen(k.fee)}<br><small>ゲーム内要件: ${k.reqText} ${ok ? '✅' : '❌'}</small>${kbInfo}</div>
        ${active ? '' : `<button class="mini-btn ${ok ? 'plus' : ''}" data-kijun="${k.lv}" ${ok ? '' : 'disabled'}>届け出る</button>`}
      </div>`;
    }).join('') + `<p class="pnl-note">要件(専従PT数・面積)を割ると自動降格。分院は分院の専従PTだけで数える。届出→即日適用はゲーム上の簡略化。制度上の要件全文はレシートの🎓学習モードで読める。</p>`;
    // 他科本院(v67): 施設基準は部門カードと同じ3状態(届け出る/未/届出済み)で描く。運動器リハの段は整形本院だけ(第14条)
    const mainMod = typeof SPECIALTIES !== 'undefined' ? SPECIALTIES.get(settings.specialty) : null;
    const orthoMain = settings.specialty === 'orthopedics' || !mainMod || !mainMod.main;
    $('kijunBody').innerHTML = (orthoMain ? `<h3 class="sub-title">📋 運動器リハの施設基準</h3>${kijunOrtho}` : deptFsHtml(mainMod, mainDeptShim(mainMod), true))
      + `<h3 class="sub-title">📮 その他の体制・届出 <small>— 1点=10円(点数は令和8年度KBに同期)</small></h3>`
      + KASAN.map((k) => {
        const done = k.done();
        const can = !done && k.ok();
        return `<div class="kijun-row ${done ? 'ok' : ''}">
          <div><b>${k.name}</b> — <b class="kasan-ten">${k.ten}</b><br><small>制度上の要件: ${k.req}${k.cost ? ` / 整備費 ${yen(k.cost)}` : ''}${k.gameReq ? `<br>ゲーム内要件: ${k.gameReq}` : ''}${k.hint ? `<br>${k.hint}` : ''}</small></div>
          ${done ? `<span class="kijun-badge">${k.doneLabel || '届出済'}</span>` : `<button class="mini-btn ${can ? 'plus' : ''}" data-kasan="${k.id}" ${can ? '' : 'disabled'}>${k.verb || '届け出る'}${k.cost ? ` ${yen(k.cost)}` : '(無料)'}</button>`}
        </div>`;
      }).join('');
    $('kijunBody').querySelectorAll('[data-kijun]').forEach((b) => b.addEventListener('click', () => {
      settings.rehaLevel = Number(b.dataset.kijun);
      toast(`✅ ${REHA_FULL[settings.rehaLevel]}を届け出ました(リハ1回 ${yen(REHA_FEE[settings.rehaLevel])})`);
      renderPnl(); save();
    }));
    $('kijunBody').querySelectorAll('[data-kasan]').forEach((b) => b.addEventListener('click', () => {
      const k = KASAN.find((x) => x.id === b.dataset.kasan);
      if (!k || k.done() || !k.ok()) return;
      if (k.cost > 0) {
        if (G.money < k.cost) { toast(`資金が足りません(${yen(k.cost)})`); return; }
        G.money -= k.cost;
      }
      k.apply();
      SND.coin();
      toast(`📮 ${k.name} を届け出ました(${k.ten})`);
      renderPnl(); updateHeader(); save();
    }));
    if (!orthoMain) bindDeptFsHandlers($('kijunBody'));
  }

  function blackDays7() {
    return G.history.slice(-7).filter((h) => h.profit + (h.brProfit || 0) > 0).length;
  }

  function renderBank() {
    const el = $('bankBody');
    if (!el) return;
    const outstanding = G.loans.reduce((a, l) => a + l.principal, 0);
    if (!G.plan) {
      el.innerHTML = `<p class="plan-lead">「事業計画書はお持ちですか?」<br>銀行融資には<b>事業計画の策定が必須</b>です。まず上の事業計画カードから策定を。</p>
        ${outstanding ? loanListHtml() : ''}`;
      bindLoanBtns(el);
      return;
    }
    const black = blackDays7();
    const limit = Math.min(10000000, 3000000 + black * 1000000);
    const available = Math.max(0, limit - G.loans.filter((l) => l.label === '銀行融資').reduce((a, l) => a + l.principal, 0));
    const diag = planDiagnosis({ revenue: G.plan.revenue, patientsPerDay: G.plan.patientsPerDay, rehaPerDay: G.plan.rehaPerDay, staff: G.plan.staff });
    const goodPlan = !diag.some((d) => d.lv === 'bad');
    const rate = goodPlan ? 0.0003 : 0.0006;
    el.innerHTML = `
      <p class="plan-lead">融資枠は<b>直近の黒字日数</b>で、金利は<b>事業計画の質</b>で決まります。</p>
      <div class="pnl-row"><span>融資枠(3百万+黒字日数×1百万)</span><b>${yen(limit)}(直近7日黒字 ${black}日)</b></div>
      <div class="pnl-row"><span>借入可能額</span><b>${yen(available)}</b></div>
      <div class="pnl-row"><span>適用金利</span><b>${goodPlan ? '日利0.03% — 計画良好' : '日利0.06% — 計画に⚠️あり'}</b></div>
      ${available >= 1000000 ? `
        <div class="plan-step"><span>借入額</span>
          <div><button class="mini-btn" id="loanMinus">−</button><b id="loanAmt">¥1,000,000</b><button class="mini-btn plus" id="loanPlus">＋</button></div>
        </div>
        <button class="btn-cta" id="loanGo">この条件で借り入れる</button>` : '<p class="plan-lead">現在借入可能額はありません(黒字を積むと枠が増えます)。</p>'}
      ${loanListHtml()}`;
    let amt = 1000000;
    const lm = $('loanMinus'), lp = $('loanPlus'), lg = $('loanGo');
    if (lp) {
      lp.addEventListener('click', () => { amt = Math.min(available, amt + 1000000); $('loanAmt').textContent = yen(amt); });
      lm.addEventListener('click', () => { amt = Math.max(1000000, amt - 1000000); $('loanAmt').textContent = yen(amt); });
      lg.addEventListener('click', () => {
        G.money += amt;
        G.loans.push({ principal: amt, dailyRate: rate, label: '銀行融資' });
        toast(`🏦 ${yen(amt)} を借り入れました(利息 ${yen(amt * rate)}/日)`);
        renderBank(); updateHeader(); save();
      });
    }
    bindLoanBtns(el);
  }

  function loanListHtml() {
    if (!G.loans.length) return '';
    return `<h3 class="sub-title">借入一覧</h3>` + G.loans.map((l, i) => `
      <div class="pnl-row"><span>${l.label} ${yen(l.principal)}(利息${yen(l.principal * l.dailyRate)}/日)</span>
      <button class="mini-btn" data-repay="${i}">全額返済</button></div>`).join('');
  }
  function bindLoanBtns(el) {
    el.querySelectorAll('[data-repay]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.repay);
      const l = G.loans[i];
      if (G.money < l.principal) { toast('返済資金が足りません'); return; }
      G.money -= l.principal;
      G.loans.splice(i, 1);
      toast('💸 完済しました');
      renderBank(); updateHeader(); save();
    }));
  }

  /* ================= 事業計画 ================= */

  const PLAN_ROLES = [
    ['doctors', '医師', COSTS.doctorDay, 1, 4, '※院長1人分の人件費は利益から'],
    ['nurses', '看護師', COSTS.nurseDay, 0, 4, ''],
    ['pts', 'PT', COSTS.ptDay, 0, 12, ''],
    ['receptionists', '受付', COSTS.recepDay, 1, 3, '']
  ];
  let planEditing = false;
  let draft = null;

  function newDraft() {
    return {
      revenue: G.plan ? G.plan.revenue : 4000000,
      patientsPerDay: G.plan ? G.plan.patientsPerDay : 30,
      rehaPerDay: G.plan ? G.plan.rehaPerDay : 10,
      staff: G.plan ? Object.assign({}, G.plan.staff) : {
        doctors: settings.doctors, nurses: settings.nurses, pts: settings.pts, receptionists: settings.receptionists
      }
    };
  }

  function avgUnitPrice() {
    const h = G.history.slice(-7).filter((x) => x.kind !== 'closed');
    const rev = h.reduce((a, d) => a + d.revenue, 0);
    const pt = h.reduce((a, d) => a + d.patients, 0);
    return pt >= 10 ? rev / pt : 3200;
  }

  function staffCostOf(st) {
    return (st.doctors - 1) * COSTS.doctorDay + st.nurses * COSTS.nurseDay + st.pts * COSTS.ptDay + st.receptionists * COSTS.recepDay;
  }

  function planDiagnosis(d) {
    const unit = avgUnitPrice();
    const openDays = openDaysCount();
    const fixed = staffCostOf(d.staff) + COSTS.rent[settings.floorLv] + COSTS.base[settings.floorLv] + Object.values(G.ads).reduce((a, b) => a + b, 0) + (G.billboard ? COSTS.billboardDay : 0) + (settings.mri ? COSTS.mriMaint : 0);
    const bep = Math.ceil(fixed / Math.max(500, unit - COSTS.perPatient));
    const examCap = Math.floor(d.staff.doctors * (480 / (settings.examMean + 1.5)) * 0.72);
    const rehaCap = Math.min(settings.machines, d.staff.pts * 2) * Math.floor(480 / 15);
    const laborRate = d.revenue > 0 ? (staffCostOf(d.staff) * openDays * 4.3) / d.revenue : 1;
    const planProfit = Math.round((d.patientsPerDay * (unit - COSTS.perPatient) - fixed) * openDays * 4.3);
    const msgs = [];
    msgs.push({ lv: 'info', text: `想定単価 ${yen(unit)}/人(直近実績) → 損益分岐点は <b>1日${bep}人</b>(週${openDays}日診療)` });
    if (d.patientsPerDay < bep) msgs.push({ lv: 'bad', text: `⚠️ 目標${d.patientsPerDay}人/日 < 損益分岐${bep}人/日 — <b>この計画は構造的に赤字</b>` });
    else msgs.push({ lv: 'good', text: `✅ 目標達成時の計画利益: <b>${planProfit >= 0 ? '+' : ''}${yen(planProfit)}/月</b>` });
    if (d.patientsPerDay > examCap) msgs.push({ lv: 'bad', text: `⚠️ 診察キャパ不足 — 医師${d.staff.doctors}人では約${examCap}人/日が限界` });
    if (d.rehaPerDay > rehaCap) msgs.push({ lv: 'bad', text: `⚠️ リハキャパ不足 — PT${d.staff.pts}人×機器${settings.machines}台では約${rehaCap}件/日が限界` });
    if (laborRate > 0.60) msgs.push({ lv: 'bad', text: `⚠️ 計画人件費率 ${(laborRate * 100).toFixed(0)}% — 目安(45〜55%)を大きく超過` });
    else if (laborRate > 0.55) msgs.push({ lv: 'warn', text: `計画人件費率 ${(laborRate * 100).toFixed(0)}% — やや高め` });
    else msgs.push({ lv: 'good', text: `計画人件費率 ${(laborRate * 100).toFixed(0)}% — 健全圏(目安45〜55%)` });
    return msgs;
  }

  function renderPlanner() {
    const el = $('plannerBody');
    if (!el) return;
    if (!G.plan || planEditing) {
      if (!draft) draft = newDraft();
      const diag = planDiagnosis(draft);
      el.innerHTML = `
        <p class="plan-lead">目標と人員をセットで決めます。<b>計画は当てるためではなく、ズレに早く気づくため</b>。銀行融資・分院開設の前提条件。30日ごとにレビュー。</p>
        <div class="plan-form">
          <label class="ctrl">
            <span class="ctrl-head">目標月商(30日) <b>${yen(draft.revenue)}</b></span>
            <input type="range" id="planRev" min="2000000" max="30000000" step="500000" value="${draft.revenue}">
          </label>
          <div class="plan-steppers">
            <div class="plan-step"><span>目標患者数/日(本院)</span><div><button class="mini-btn" data-pd="patientsPerDay" data-d="-5">−</button><b>${draft.patientsPerDay}人</b><button class="mini-btn plus" data-pd="patientsPerDay" data-d="5">＋</button></div></div>
            <div class="plan-step"><span>目標リハ件数/日(本院)</span><div><button class="mini-btn" data-pd="rehaPerDay" data-d="-5">−</button><b>${draft.rehaPerDay}件</b><button class="mini-btn plus" data-pd="rehaPerDay" data-d="5">＋</button></div></div>
            ${PLAN_ROLES.map(([key, label, cost, min, max, note]) => `
              <div class="plan-step"><span>${label}の計画 <small>${yen(cost)}/日${note}</small></span>
                <div><button class="mini-btn" data-ps="${key}" data-d="-1">−</button><b>${draft.staff[key]}人</b><button class="mini-btn plus" data-ps="${key}" data-d="1">＋</button></div>
              </div>`).join('')}
          </div>
          <div class="plan-diag">${diag.map((m) => `<p class="diag ${m.lv}">${m.text}</p>`).join('')}</div>
          <button class="btn-cta" id="planCommit">${G.plan ? 'この内容で計画を更新する' : 'この計画で行く(策定)'}</button>
          ${G.plan ? '<button class="btn-cta ghost" id="planCancel">見直しをやめる</button>' : ''}
        </div>`;
      $('planRev').addEventListener('input', (e) => { draft.revenue = Number(e.target.value); renderPlanner(); });
      el.querySelectorAll('[data-pd]').forEach((b) => b.addEventListener('click', () => {
        const k = b.dataset.pd;
        draft[k] = clamp(draft[k] + Number(b.dataset.d), 0, 200);
        renderPlanner();
      }));
      el.querySelectorAll('[data-ps]').forEach((b) => b.addEventListener('click', () => {
        const k = b.dataset.ps;
        const role = PLAN_ROLES.find((r) => r[0] === k);
        draft.staff[k] = clamp(draft.staff[k] + Number(b.dataset.d), role[3], role[4]);
        renderPlanner();
      }));
      $('planCommit').addEventListener('click', () => {
        G.plan = { revenue: draft.revenue, patientsPerDay: draft.patientsPerDay, rehaPerDay: draft.rehaPerDay, staff: Object.assign({}, draft.staff), startDay: G.day };
        planEditing = false;
        draft = null;
        toast('📝 事業計画を策定しました。銀行融資も使えます');
        renderPlanner(); renderBank(); save();
      });
      const pc = $('planCancel');
      if (pc) pc.addEventListener('click', () => { planEditing = false; draft = null; renderPlanner(); });
      return;
    }

    const plan = G.plan;
    const cur = monthRevenueAll();
    const pct = Math.min(100, cur / plan.revenue * 100);
    const h7 = G.history.slice(-7).filter((x) => x.kind !== 'closed');
    const ptAvg = h7.length ? h7.reduce((a, d) => a + d.patients, 0) / h7.length : 0;
    const rehaAvg = h7.length ? h7.reduce((a, d) => a + d.rehaCount, 0) / h7.length : 0;
    const rev7 = h7.reduce((a, d) => a + d.revenue, 0);
    const laborNow = h7.reduce((a, d) => a + (d.staffCost || 0), 0);
    const laborRate = rev7 > 0 ? laborNow / rev7 : 0;
    const staffRows = PLAN_ROLES.map(([key, label]) => {
      const now = key === 'doctors' ? settings.doctors : key === 'nurses' ? settings.nurses : key === 'pts' ? settings.pts : settings.receptionists;
      const diff = now - plan.staff[key];
      return `<span class="staff-chip ${diff === 0 ? 'ok' : diff < 0 ? 'under' : 'over'}">${label} ${now}/${plan.staff[key]}人${diff === 0 ? '' : diff < 0 ? `(計画まであと${-diff})` : `(計画+${diff})`}</span>`;
    }).join('');
    const bar = (label, now, target, unit) => {
      const p = Math.min(100, target > 0 ? now / target * 100 : 0);
      return `<div class="pv-row"><span class="pv-label">${label}</span>
        <div class="pv-track"><i style="width:${p.toFixed(1)}%" class="${p >= 100 ? 'full' : p >= 70 ? 'mid' : 'low'}"></i></div>
        <span class="pv-num">${now}${unit} / ${target}${unit}</span></div>`;
    };
    el.innerHTML = `
      <div class="pv-head">
        <div class="pv-rev">
          <span>月商目標(法人) ${yen(plan.revenue)} / 次回レビュー Day ${Math.ceil(G.day / 30) * 30}</span>
          <b>${yen(cur)} <small>(${pct.toFixed(0)}%)</small></b>
          <div class="pv-track big"><i style="width:${pct.toFixed(1)}%" class="${pct >= 100 ? 'full' : pct >= 70 ? 'mid' : 'low'}"></i></div>
        </div>
      </div>
      ${bar('患者数/日(7日平均)', Math.round(ptAvg), plan.patientsPerDay, '人')}
      ${bar('リハ件数/日(7日平均)', Math.round(rehaAvg), plan.rehaPerDay, '件')}
      <div class="pv-staff"><span class="pv-label">本院人員(現在/計画)</span>${staffRows}</div>
      <div class="pv-row"><span class="pv-label">人件費率(直近7日)</span>
        <b class="pv-rate ${laborRate > 0.6 ? 'bad' : laborRate > 0.55 ? 'warn' : 'good'}">${rev7 > 0 ? (laborRate * 100).toFixed(0) + '%' : '–'}</b>
        <small>目安 45〜55%</small></div>
      <button class="btn-cta ghost" id="planEdit">計画を見直す</button>`;
    $('planEdit').addEventListener('click', () => { planEditing = true; draft = newDraft(); renderPlanner(); });
  }

  function renderMissions() {
    $('missionList').innerHTML = MISSIONS.map((m, i) => {
      if (!missionApplies(m)) return '';
      const st = i < G.missionIdx ? 'done' : i === G.missionIdx ? 'now' : 'locked';
      return `<div class="mission-row ${st}">
        <span class="mission-mark">${st === 'done' ? '✅' : st === 'now' ? '🎯' : '🔒'}</span>
        <div><b>${m.title}</b>${st === 'done' ? `<p class="mission-lesson">${m.lesson}</p>` : ''}</div>
      </div>`;
    }).join('');
    $('textbook').innerHTML = TEXTBOOK.map((c) => `<details class="tb-card"><summary>${c.t}</summary><p>${c.b}</p></details>`).join('');
  }

  /* ================= 開始の扉(v66): 引き継ぐクリニック ================= */
  // セーブが無いときだけ出る。選ぶまでシムを動かさない(loop/skipBtn/checkDailyLoginが gateOpen を見る)。
  // 候補=SPECIALTIES.mainCandidates()(main:{line,order} を持つ外来型)。1枚なら提示(.spec-row)、2枚以上なら排他選択(.choice-row)。
  // 準備中の科は出さない(第14条)。文言は承継版(editor原稿・語は社長決定で差し替え可)。
  let gateOpen = false;
  let afterGate = null;
  let gatePick = null;
  const GATE = {
    lead1: '前の院長が診てきた患者と、少しの運転資金。あなたはその続きから始める。',
    lead2: 'どの科を継ぐかで、経営の勝負どころが変わる。',
    go: 'この院を引き継ぐ',
    goPick: (name) => `${name}を引き継ぐ`,
  };
  function mainSpecName() {
    const m = typeof SPECIALTIES !== 'undefined' ? SPECIALTIES.get(settings.specialty) : null;
    return m ? (m.short || m.name) : '整形外科';
  }
  function gateCandidates() {
    return typeof SPECIALTIES !== 'undefined' && SPECIALTIES.mainCandidates ? SPECIALTIES.mainCandidates() : [];
  }
  function renderGateList(cands) {
    if (cands.length === 1) {
      const m = cands[0];
      $('gateList').innerHTML = `<div class="spec-row"><b>${m.name}</b><small>${m.main.line}</small></div>`;
      $('gateGo').textContent = GATE.go;
      return;
    }
    $('gateList').innerHTML = cands.map((m) => `<button class="choice-row${m.id === gatePick ? ' on' : ''}" data-gate="${m.id}"><b>${m.name}</b><small>${m.main.line}</small></button>`).join('');
    const pm = cands.find((m) => m.id === gatePick) || cands[0];
    $('gateGo').textContent = GATE.goPick(pm.short || pm.name);
  }
  function openStartGate(onDone) {
    const cands = gateCandidates();
    if (!cands.length) { onDone(); return; }
    gateOpen = true; afterGate = onDone;
    gatePick = cands.some((m) => m.id === settings.specialty) ? settings.specialty : cands[0].id;
    $('gateLead').textContent = cands.length === 1 ? GATE.lead1 : GATE.lead1 + GATE.lead2;
    renderGateList(cands);
    $('startGate').classList.add('show');
  }
  // 自院を名指しする語を本院の科に合わせる(広告キーワード・称号)。テンプレートは {科名}
  function applyMainWords() {
    const name = mainSpecName();
    const m = typeof SPECIALTIES !== 'undefined' ? SPECIALTIES.get(settings.specialty) : null;
    const kws = m && m.main && m.main.preset && m.main.preset.keywords;
    KEYWORDS.forEach((kw, i) => {
      if (!kw._o) kw._o = { name: kw.name, hint: kw.hint, reha: kw.reha };
      Object.assign(kw, kw._o, kws && kws[i] ? kws[i] : {});
    });
    for (const x of MISSIONS.concat(LEAGUE)) { if (x.title) { x._t = x._t || x.title; x.title = x._t.replace('{科名}', name); } }
    // キホン集の科別上書き(v77 保留#42): preset.textbook = { index: { t, b } }。整形前提の項目だけ差し替える。制度上の数値は書かない(KB のみ)
    const tb = m && m.main && m.main.preset && m.main.preset.textbook;
    TEXTBOOK.forEach((c, i) => { if (!c._o) c._o = { t: c.t, b: c.b }; Object.assign(c, c._o, tb && tb[i] ? tb[i] : {}); });
    const rel = m && m.main && m.main.preset && m.main.preset.rel;
    const relHide = (m && m.main && m.main.preset && m.main.preset.relHide) || [];
    for (const [k, def] of Object.entries(REL_DEF)) { if (!def._o) def._o = { name: def.name, effect: def.effect, desc: def.desc }; Object.assign(def, def._o, rel && rel[k] ? rel[k] : {}); def.hidden = relHide.includes(k); }
  }
  function applyMainSpecialty(id) {
    const m = typeof SPECIALTIES !== 'undefined' ? SPECIALTIES.get(id) : null;
    if (!m || !m.main) return false;
    settings.specialty = id;
    const pre = m.main.preset || {};
    if (pre.settings) Object.assign(settings, pre.settings);
    settings.mainPolicy = pre.policy ? Object.assign({}, pre.policy) : null;
    settings.mainFs = [];
    settings.mainEquip = Object.assign({}, (m.deptDefaults && m.deptDefaults.equip) || {}, pre.equip || {}); // 設備は科の既定から(v73)
    if (typeof G !== 'undefined' && G) G.mainQueue = { preop: 0, surgery: 0, postop: [] }; // 科を替えたら手術待ちは空(v74)
    for (const k of pre.jihiHide || []) settings[k] = false; // 隠した自費メニューは稼がない(v76 保留#43)
    applyMainWords();
    skipSpecMissions();
    return true;
  }
  function closeStartGate() {
    if (!gateOpen) return;
    if (!applyMainSpecialty(gatePick)) return;
    gateOpen = false;
    $('startGate').classList.remove('show');
    save();
    const fn = afterGate; afterGate = null;
    if (fn) fn();
  }
  $('gateList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-gate]');
    if (!b || !gateOpen) return;
    gatePick = b.dataset.gate;
    renderGateList(gateCandidates());
  });
  $('gateGo').addEventListener('click', closeStartGate);

  /* ================= チュートリアル ================= */

  const TUTORIAL = [
    { tab: null, sel: null, text: '今日からこの{科名}はあなたの院です。まずは<b>①1日進める → ②結果を見る → ③1つ直す</b>。' },
    { tab: null, sel: '.hud', text: '<b>資金・評判・認知</b>が経営の体温計。<b>⏩1日</b> で1日スキップできます。' },
    { tab: 'clinic', sel: '#todoCard', text: '<b>迷ったらここ</b>。ミッション・依頼・詰まりの打ち手が出ます。' },
    { tab: 'clinic', sel: '#shopCard', text: '最初は<b>受付と椅子</b>。Day 4・Day 8 で打ち手が増えます。' },
    { tab: 'mgmt', sel: '#formulaCard', text: 'いちばん大事な式は <b>売上 = 患者数 × 単価</b>。では初日をどうぞ。' }
  ];
  let tutIdx = -1;

  function startTutorial() { tutIdx = 0; showTutStep(); }
  function showTutStep() {
    const st = TUTORIAL[tutIdx];
    if (!st) { endTutorial(); return; }
    if (st.tab) switchTab(st.tab);
    $('tutText').innerHTML = st.text.replace('{科名}', mainSpecName());
    $('tutStep').textContent = `${tutIdx + 1} / ${TUTORIAL.length}`;
    $('tutorial').classList.add('show');
    document.querySelectorAll('.tut-focus').forEach((el) => el.classList.remove('tut-focus'));
    if (st.sel) {
      const el = document.querySelector(st.sel);
      if (el) {
        el.classList.add('tut-focus');
        setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
      }
    }
    $('tutNext').textContent = tutIdx === TUTORIAL.length - 1 ? '経営を始める' : '次へ →';
  }
  function endTutorial() {
    tutIdx = -1;
    $('tutorial').classList.remove('show');
    document.querySelectorAll('.tut-focus').forEach((el) => el.classList.remove('tut-focus'));
    G.tutorialDone = true;
    switchTab('clinic');
    save();
  }
  $('tutNext').addEventListener('click', () => { tutIdx++; showTutStep(); });
  $('tutSkip').addEventListener('click', endTutorial);
  $('helpBtn').addEventListener('click', startTutorial);
  $('resetBtn').addEventListener('click', () => {
    showModal('はじめからやり直す', '<p>セーブデータを消して、Day 1 からやり直します。よろしいですか?</p><div class="modal-actions"><button class="btn-cta danger" id="resetGo">全部消してやり直す</button></div>', 'やめておく');
    $('resetGo').addEventListener('click', hardReset);
  });

  /* ================= 速度・表示 ================= */

  // 倍速パス(時間制): ×4まではデフォルト無料。×8/×16/×32は24時間パスをコインで購入。
  // パスは上位を買えば下位も使え、有効中に買い足すと残り時間に+24hされる。殿堂(周回)後も残り時間は有効。
  const SPEED_PASS_PRICE = { 8: 6, 16: 12, 32: 22 };
  const PASS_MS = 24 * 3600 * 1000;

  function passActive() { return !!(G.speedPass && G.speedPass.until > Date.now()); }
  function passAllowed() { return passActive() ? G.speedPass.tier : 4; }
  function speedLocked(v) { return SPEED_PASS_PRICE[v] !== undefined && v > passAllowed(); }
  function passRemainText() {
    if (!passActive()) return '';
    const min = Math.max(1, Math.round((G.speedPass.until - Date.now()) / 60000));
    return min >= 60 ? `残り${Math.floor(min / 60)}時間${min % 60 ? min % 60 + '分' : ''}` : `残り${min}分`;
  }

  function updateSpeedButtons() {
    document.querySelectorAll('.speed-btn[data-speed]').forEach((b) => {
      const v = Number(b.dataset.speed);
      if (SPEED_PASS_PRICE[v] === undefined) return;
      const locked = speedLocked(v);
      b.classList.toggle('locked', locked);
      b.textContent = locked ? `🔒×${v}` : `×${v}`;
      b.title = locked
        ? `24時間パス 🪙${SPEED_PASS_PRICE[v]}(上位パスなら下位も使用可)`
        : `⏳ パス${passRemainText()}`;
    });
  }

  function setSpeed(v, btn) {
    G.speed = v;
    document.querySelectorAll('.speed-btn').forEach((x) => x.classList.toggle('on', x === btn));
  }

  // パス失効の監視: 失効したら×4に自動で戻す
  function enforceSpeedPass() {
    if (G.speed > 4 && speedLocked(G.speed)) {
      const b4 = document.querySelector('.speed-btn[data-speed="4"]');
      setSpeed(4, b4);
      updateSpeedButtons();
      toast('⏳ 倍速パスの時間が終了しました(×4に戻ります)');
      save();
    }
  }

  document.querySelectorAll('.speed-btn[data-speed]').forEach((b) => {
    b.addEventListener('click', () => {
      const v = Number(b.dataset.speed);
      if (!speedLocked(v)) { setSpeed(v, b); return; }
      const cost = SPEED_PASS_PRICE[v];
      const active = passActive();
      showModal(`⏩ 倍速×${v} の24時間パス`, `
        <p>これから<b>24時間(実時間)</b>、営業の進みを <b>×${v}</b> まで上げられます(×${v}以下はすべて使用可・いつでも切替可)。</p>
        <div class="pnl-row"><span>価格</span><b>🪙 ${cost} / 24時間</b></div>
        ${active ? `<div class="pnl-row"><span>現在のパス(×${G.speedPass.tier})</span><b>${passRemainText()} — 購入で+24時間&上位に切替</b></div>` : ''}
        <div class="pnl-row"><span>殿堂入り(周回)後</span><b>残り時間はそのまま有効</b></div>
        <div class="pnl-row"><span>所持コイン</span><b>🪙 ${G.coins}</b></div>
        ${G.coins >= cost
          ? `<div class="modal-actions"><button class="btn-cta" id="speedBuy">🪙${cost}で24時間パスを買う</button></div>`
          : `<p class="modal-note">コインが足りません。ミッション・実績・デイリー依頼で貯まります。</p>`}`,
        'やめておく');
      const buy = $('speedBuy');
      if (buy) buy.addEventListener('click', () => {
        G.coins -= cost;
        const base = passActive() ? G.speedPass.until : Date.now();
        G.speedPass = { tier: Math.max(v, passActive() ? G.speedPass.tier : 0), until: base + PASS_MS };
        updateSpeedButtons();
        setSpeed(v, b);
        $('modal').classList.remove('show');
        toast(`⏳ 倍速×${G.speedPass.tier}パスが有効になりました。${passRemainText()}`);
        updateHeader(); save();
      });
    });
  });
  const view = { heat: false, lines: false };
  $('heatBtn').addEventListener('click', () => { view.heat = !view.heat; $('heatBtn').classList.toggle('on', view.heat); });
  $('lineBtn').addEventListener('click', () => { view.lines = !view.lines; $('lineBtn').classList.toggle('on', view.lines); });

  /* ================= メインループ ================= */

  function updateClinicHud() {
    const qs = clinic.queueSummary();
    qs.sort((a, b) => b[1] - a[1]);
    const [name, n] = qs[0];
    $('bottleneck').textContent = n >= 3 ? `ボトルネック: ${name}(${n}人)` : 'ボトルネック: なし 😌';
    $('bottleneck').classList.toggle('hot', n >= 3);
    $('panic').hidden = clinic.standingCount() === 0;
    const T = G.today;
    $('cWait').textContent = T && T.waitN ? `${(T.waitSum / T.waitN).toFixed(0)}分` : '–';
    $('cIn').textContent = clinic.patients.length;
  }

  let lastTs = 0, frameN = 0;
  function loop(ts) {
    clinicIso.time = ts;
    townIso.time = ts;
    if (activeTab === 'clinic' && ++frameN % 150 === 0) renderStaffStrip();
    const dtReal = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    if (G.speed > 0 && tutIdx < 0 && !gateOpen && !decOpen) {
      let dt = dtReal * G.speed * 3;
      while (dt > 0) {
        const step = Math.min(0.5, dt);
        stepSim(step);
        dt -= step;
      }
    }
    if (activeTab === 'clinic' && !(walk3d && walk3d.active)) clinic.draw(clinicIso, view);
    if (activeTab === 'town' && !(walk3d && walk3d.active)) {
      town.setAwareness(G.aw);
      town.draw(townIso, {
        billboard: G.billboard,
        hospitalTie: relLv('hospital') > 0, caremaneTie: relLv('caremane') > 0, companyTie: relLv('company') > 0,
        listing: Object.values(G.ads).reduce((a, b) => a + b, 0),
        hcProgress: G.daySpec && G.daySpec.min ? Math.min(1, G.t / G.daySpec.min) : 0
      });
    }
    updateHeader();
    updateClinicHud();
    requestAnimationFrame(loop);
  }

  let closedStreak = 0;
  function stepSim(dt) {
    const spec = G.daySpec || specOf(G.day);
    if (spec.kind === 'closed') {
      if (closedStreak++ > 8) { closedStreak = 0; return; } // 全休ガード
      endDay();
      return;
    }
    closedStreak = 0;
    G.t += dt;
    while (G.nextArrivalIdx < G.arrivals.length && G.arrivals[G.nextArrivalIdx].t <= G.t) {
      const a = G.arrivals[G.nextArrivalIdx];
      town.requestVisit(a.type, a.source, a.refer, a.seg);
      G.nextArrivalIdx++;
    }
    clinic.tick(dt);
    town.tick(dt);
    // 📈 ライブモニター: 10分ごとに院内の状態をサンプリング
    if (G.t - (G.lastPulseT || 0) >= 10) {
      G.lastPulseT = G.t;
      const waiting = clinic.patients.filter((p) => p.phase === 'recepQ' || p.phase === 'waitExam' || p.phase === 'waitTreat' || p.phase === 'waitReha' || p.phase === 'cashQ');
      const curWait = waiting.length ? waiting.reduce((a, p) => a + p.waitTotal, 0) / waiting.length : 0;
      G.today.pulse.push({ t: G.t, n: clinic.patients.length, w: Math.round(curWait), r: G.today.revenue });
      if (activeTab === 'clinic' && G.speed <= 4) renderPulse();
    }
    const townPatients = town.walkers.some((w) => w.kind === 'patient');
    if (G.t >= spec.min && !townPatients && clinic.patients.length === 0) endDay();
    else if (G.t >= spec.min + 150) {
      clinic.reset();
      endDay();
    }
  }

  /* ================= 1日スキップ(自動運営・期待値ベース) ================= */

  function autoDay() {
    if (tutIdx >= 0 || decOpen) return;
    const spec = G.daySpec || specOf(G.day);
    const T = G.today;
    if (spec.kind !== 'closed') {
      // 在院・移動中の患者は簡易精算
      let inflight = clinic.patients.length + town.walkers.filter((w) => w.kind === 'patient').length;
      town.walkers = town.walkers.filter((w) => w.kind !== 'patient');
      clinic.reset();
      while (inflight-- > 0) { T.patients++; T.revenue += 1500; T.rev.consult += 1500; }
      // 未到着の来院を期待値で処理
      const arr = G.arrivals.slice(G.nextArrivalIdx);
      G.nextArrivalIdx = G.arrivals.length;
      let rehaAvail = Math.min(clinic.usableMachines() * 34, clinic.rehaCap());
      const examCapDay = Math.max(10, settings.doctors * (spec.min / (settings.examMean + (G.evExamDelta || 0) + 1.5)) * 0.72);
      let examServed = 0, turnedAway = 0;
      for (const a of arr) {
        // 診察キャパを超えた患者は診られない(機会損失+評判低下)
        if (a.type !== 'rehab') {
          if (examServed >= examCapDay) { turnedAway++; continue; }
          examServed++;
        } else if (rehaAvail < 1) {
          if (Math.random() < Math.min(0.9, 0.7 + 0.05 * bondLv('reha'))) addSchedule(G.day + 1, 'rehab'); // 離脱(信頼で減)
          continue;
        }
        if (settings.specialty !== 'orthopedics' && KBI && DEPTI) {
          // 他科本院(v66): 期待値の再実装はせず、到着1件ずつ同じエンジン経路(onDischargeDept)を通す。待ち時間は負荷の期待値
          const wait = clamp(7 + (examServed / examCapDay) * 26, 5, 45);
          const persona = assignPersona(a.type, a.seg || 'senior');
          onDischargeDept({ persona, refer: a.refer, x: 0, y: 0 }, { type: a.type, items: [], didReha: false, wait, seg: a.seg || 'senior', soothed: false });
          continue;
        }
        const seg = a.seg || 'senior';
        T.segCounts[seg] = (T.segCounts[seg] || 0) + 1;
        T.patients++;
        let rev = 0, proc = false, didReha = false, kanriBlock = false;
        if (a.type === 'checkup') { rev += FEES.checkup; T.rev.checkup += FEES.checkup; acc(T, '健康診断(保険外)', 0, FEES.checkup); }
        else if (a.type === 'first') {
          rev += FEES.first; T.rev.consult += FEES.first; T.newCount++; acc(T, '初診料', FEES.first / 10);
          for (const k of KASAN_CORE.firstVisitLines(settings, kbPts)) { rev += k.t * 10; T.rev.consult += k.t * 10; acc(T, k.n, k.t); }
        }
        else { rev += FEES.revisit; T.rev.consult += FEES.revisit; acc(T, '再診料', FEES.revisit / 10); }
        if (a.type !== 'checkup') {
          if (Math.random() < settings.pInj) {
            const p = kbPts('r08-G010', 80);
            rev += (p + DRUG_PTS.inj) * 10; T.rev.inj += (p + DRUG_PTS.inj) * 10; T.injCount++; proc = true;
            acc(T, '関節腔内注射', p); acc(T, '関節注入薬剤(アルツ25mg)', DRUG_PTS.inj);
          }
          if (Math.random() < settings.pTrig) {
            const block = Math.random() < 0.25;
            T.trigCount++; proc = true; kanriBlock = true; // 麻酔(トリガー・ブロック)はA001注8の対象
            if (block) {
              const pb = kbPts('r08-L100-2-lumbar', 800);
              rev += (pb + DRUG_PTS.block) * 10; T.rev.inj += (pb + DRUG_PTS.block) * 10;
              acc(T, '腰部硬膜外ブロック', pb); acc(T, 'ブロック注入薬剤(キシロカイン1%10mL)', DRUG_PTS.block);
            }
            else {
              const p = kbPts('r08-L104', 70);
              rev += (p + DRUG_PTS.trig) * 10; T.rev.inj += (p + DRUG_PTS.trig) * 10;
              acc(T, 'トリガーポイント注射', p); acc(T, 'トリガー注入薬剤(キシロカイン1%5mL)', DRUG_PTS.trig);
            }
          }
          if (settings.physio > 0 && !G.evPhysioDown && T.physioCount < settings.physio * 35 && Math.random() < settings.pPhysio + 0.02 * bondLv('nurse')) { const p = kbPts('r08-J119-2', 35); rev += p * 10; T.rev.physio += p * 10; T.physioCount++; proc = true; kanriBlock = true; acc(T, '消炎鎮痛等処置(器具等)', p); }
          const segMul = { senior: 1.2, sports: 1.45, worker: 0.75 }[seg] || 1;
          const wantReha = a.type === 'rehab' || (settings.rehaLevel > 0 && (a.refer || Math.random() < settings.pReha * segMul));
          if (wantReha && settings.rehaLevel > 0 && rehaAvail >= 1) {
            rehaAvail--; didReha = true; proc = true; kanriBlock = true;
            const fr = REHA_FEE[settings.rehaLevel];
            rev += fr; T.rev.reha += fr; T.rehaCount++;
            acc(T, `${REHA_FULL[settings.rehaLevel]}×2単位`, fr / 10);
          } else if (clinic.usableBeds() > 0 && Math.random() < settings.pTreat) {
            const gips = Math.random() < 0.3;
            const p = gips ? kbPts('r08-J122-2', 490) : kbPts('r08-J000-1', 52);
            rev += p * 10; T.rev.treat += p * 10; T.treatCount++; proc = true; kanriBlock = true;
            acc(T, gips ? 'ギプス・シーネ固定(手指及び手、足)' : '創傷処置(100cm²未満)', p);
          }
        }
        // 外来管理加算: A001注8の列挙(処置・リハ・麻酔等)を行わない場合に算定。第6部注射(関節注)は妨げない(告示準拠)
        if ((a.type === 'revisit' || a.type === 'rehab') && !kanriBlock) { rev += FEES.kanri; T.rev.consult += FEES.kanri; T.kanriCount++; acc(T, '外来管理加算', FEES.kanri / 10); }
        if (a.type === 'revisit' || a.type === 'rehab') {
          let add = 0;
          for (const k of KASAN_CORE.revisitLines(settings, kbPts)) { add += k.t * 10; acc(T, k.n, k.t); }
          if (add) { rev += add; T.rev.consult += add; }
        }
        if ((a.type === 'first' || a.type === 'revisit') && Math.random() < 0.55) {
          rev += FEES.presc; T.rev.consult += FEES.presc; acc(T, '処方箋料', FEES.presc / 10);
        }
        if (a.type === 'first' && Math.random() < 0.7) { rev += FEES.xray; T.rev.img += FEES.xray; T.xrayCount++; acc(T, '単純X線撮影(写真診断+デジタル撮影+電子画像管理)', FEES.xray / 10); }
        if (settings.echo && a.type === 'first' && Math.random() < (seg === 'sports' ? 0.45 : 0.3)) { const pe = kbPts('r08-D215-2-ro-3', 350); rev += pe * 10; T.rev.img += pe * 10; acc(T, '超音波検査(運動器エコー)', pe); }
        const mriMul = seg === 'sports' ? 1.6 : seg === 'worker' ? 1.1 : 0.85;
        if (settings.mri && T.mriCount < 8 && (a.type === 'first' || a.refer) && Math.random() < 0.3 * mriMul) { rev += FEES.mri; T.rev.img += FEES.mri; T.mriCount++; acc(T, 'MRI撮影(1.5テスラ以上3テスラ未満)+断層診断+電子画像管理', FEES.mri / 10); }
        if (settings.dexa && a.type === 'first' && Math.random() < (seg === 'senior' ? 0.25 : 0.05)) G.osteoPool++;
        if (didReha && settings.selfReha) {
          const pJ = clamp((G.rep - 55) / 80, 0, 0.35) * clamp(1.7 - settings.selfRehaPrice / 9000, 0.15, 1.2);
          if (Math.random() < pJ) { rev += settings.selfRehaPrice; T.rev.jihi += settings.selfRehaPrice; acc(T, '自費リハ延長(保険外)', 0, settings.selfRehaPrice); }
        }
        if (settings.goods && proc && Math.random() < 0.12 * clamp(G.rep / 70, 0.6, 1.3)) { rev += FEES.goods; T.rev.jihi += FEES.goods; T.goodsCogs += FEES.goodsCogs; acc(T, '物販: サポーター等(保険外)', 0, FEES.goods); }
        T.revenue += rev;
        const loyalty = { senior: 0.55, worker: 0.32, sports: 0.42 }[seg] || 0.45;
        if ((a.type === 'first' || a.type === 'revisit') && !didReha && Math.random() < loyalty * 0.85 + 0.02 * relLv('pharmacy')) addSchedule(G.day + 2 + Math.floor(Math.random() * 6), 'revisit');
        if (didReha && a.type !== 'rehab') {
          // 総合計画評価料1は運動器(I)(II)のみ(告示注1・(III)は算定不可)。
          // rev への加算はこの位置だと T.revenue += rev(上) に届かないため直接 T.revenue へ(既存バグの修正)
          if (settings.rehaLevel >= 2) {
            const p = kbPts('r08-H003-2-1-i', 300);
            T.revenue += p * 10; T.rev.reha += p * 10;
            acc(T, 'リハビリテーション総合計画評価料1(初回)', p);
          }
          for (let k = 1; k <= 8; k++) addSchedule(G.day + Math.ceil(k * 2.5), 'rehab');
        }
        if (a.type === 'rehab' && !didReha) addSchedule(G.day + 1, 'rehab');
      }
      // 常連の記憶: スキップした日も、来ていた分だけ通院回数を進める(卒業も静かに起きる)
      if (G.regulars && G.regulars.length && T.patients > 0) {
        const bump = Math.min(8, T.patients, G.regulars.length);
        for (let i = 0; i < bump; i++) {
          const r = G.regulars[Math.floor(Math.random() * G.regulars.length)];
          r.visits++;
          r.lastDay = G.day;
        }
        for (let i = G.regulars.length - 1; i >= 0; i--) {
          if (G.regulars[i].visits >= 8 && Math.random() < 0.08) {
            const rg = G.regulars.splice(i, 1)[0];
            G.stats.gradu = (G.stats.gradu || 0) + 1;
            G.rep = Math.min(100, G.rep + 0.2);
            (G.graduLog = G.graduLog || []).push({ name: rg.p.name, age: rg.p.age, ch: rg.p.chLabel, visits: rg.visits, day: G.day });
            if (G.graduLog.length > 30) G.graduLog.shift();
          }
        }
      }
      const n = T.patients;
      if (n > 0) {
        const load = examServed / examCapDay;
        const wait = clamp(7 + load * 26, 5, 45);
        T.waitSum = wait * n; T.waitN = n;
        let sat = clamp(1.25 - wait * waitFeel() / 40, 0, 1);
        if (G.deco.cafe) sat = Math.min(1, sat + 0.05);
        G.rep += (sat * 100 - G.rep) * Math.min(0.3, 0.01 * n);
        G.rep = Math.max(G.rep, repDailyFloor());
      }
      // 断られた患者は評判を下げ、街の噂になる
      if (turnedAway > 0) {
        T.balked += turnedAway;
        G.rep = Math.max(repDailyFloor(), G.rep - Math.min(3, turnedAway * 0.08));
      }
    }
    endDay();
    renderKpiStrip();
  }

  /* ================= デバッグフック(検証用) ================= */

  window.GAME = {
    G, settings, clinic, town, KIJUN, REHA_FEE, KPIS, REL_DEF, autoDay,
    pickChallenge, specialRequest, monthlyClose, todayKey,
    grant: (n) => { G.money += n; updateHeader(); },
    getWalk: () => walk3d
  };
  $('skipBtn').addEventListener('click', () => {
    if (tutIdx >= 0 || gateOpen || decOpen) return;
    autoDay();
    banner(`⏩ Day ${G.day - 1} を自動運営でスキップしました`);
  });

  /* ================= 🔀 経営の分岐点(意思決定イベント・v70) =================
   * エンジンは app/decisions.js。ここは接続(状況の読み取り・画面・履歴・やり直し)だけ。
   * 開いている間は開始の扉と同じく decOpen でシムと日送りを止める。見込みと確定は同じ outcome を使う */
  const DECI = typeof DECISIONS !== 'undefined';
  let decOpen = false, decBusy = false, decPick = null, decCur = null;
  const DEC_SNAP_MAX = 8;

  if (DECI) { const nm = {}, mx = {}; for (const [k, d] of Object.entries(REL_DEF)) { nm[k] = d.name; mx[k] = d.max; } DECISIONS.setRelNames(nm); DECISIONS.setRelMax(mx); }
  function decState() {
    if (!DECI) return null;
    G.dec = DECISIONS.ensureState(G.dec, `${Date.now().toString(36)}`);
    return G.dec;
  }
  // 判断に使う「今の状況」。ケースの cond/prio/bg/when がこれを読む(docs/decisions.md に一覧)
  function decCtx() {
    const st = decState();
    const open7 = G.history.filter((h) => h.kind !== 'closed').slice(-7);
    const avg = (k) => (open7.length ? open7.reduce((a, h) => a + (h[k] || 0), 0) / open7.length : 0);
    const patients7 = Math.round(avg('patients'));
    const examCap = Math.max(10, settings.doctors * (DAY_SPECS.full.min / (settings.examMean + 1.5)) * 0.72);
    const mh = G.history.slice(-30);
    const monthProfit = Math.round(mh.reduce((a, h) => a + h.profit + (h.brProfit || 0), 0));
    const monthRevenue = Math.round(mh.reduce((a, h) => a + h.revenue + (h.brRevenue || 0), 0));
    const dailyCostNow = Math.round(COSTS.rent[settings.floorLv] + COSTS.base[settings.floorLv] + mainStaffCost() + (st ? DECISIONS.dailyCost(st, G.day) : 0));
    const staff = { doctors: settings.doctors, nurses: settings.nurses, receptionists: settings.receptionists, pts: settings.pts, rehaAides: settings.rehaAides || 0 };
    const rel = {}; for (const k of Object.keys(G.relations || {})) rel[k] = G.relations[k].lv;
    return {
      day: G.day, money: Math.round(G.money), rep: G.rep, aw: G.aw, staff,
      staffTotal: staff.doctors + staff.nurses + staff.receptionists + staff.pts + staff.rehaAides,
      specialty: settings.specialty, stage: unlockStage(), depts: Object.keys(G.depts || {}), branches: (G.branches || []).length, hospital: !!G.hospital,
      rehaLevel: settings.rehaLevel || 0, flags: st ? st.flags : {}, slack: st ? st.slack : 0, trust: st ? st.trust : 0,
      load: Math.round(Math.min(1.2, patients7 / examCap) * 100) / 100, patients7, newp7: Math.round(avg('newCount')),
      refer7: Math.round((relLv('hospital') + 0.7 * (relLv('caremane') + relLv('rouken')) + (st ? DECISIONS.trustReferrals(st) : 0)) * 10) / 10,
      waitAvg: Math.round(avg('avgWait')), balked7: Math.round(avg('balked')),
      monthProfit, monthRevenue, dailyCost: dailyCostNow, runway: Math.max(0, Math.round(G.money / Math.max(1, dailyCostNow))),
      rentDay: COSTS.rent[settings.floorLv], examMean: settings.examMean, relations: rel, kaitei: G.kaitei ? G.kaitei.count : 0,
      mainEquip: settings.mainEquip || null // 他科本院の設備(眼科の検査・手術設備。v79 便AI-3・眼科固有ケースの存在条件)
    };
  }
  const decWho = (c) => (typeof c.who === 'string' ? DECISIONS.WHO[c.who] || { name: c.who, title: '', emoji: '💬' } : Object.assign({ emoji: '💬' }, c.who));
  const decFace = (c) => (typeof c.who === 'string' && typeof STAFF_UI !== 'undefined' && STAFF_UI.STAFF[c.who] ? STAFF_UI.faceSVG(c.who, 'normal', 40) : `<span class="dec-emoji">${decWho(c).emoji}</span>`);
  const fnv = (v, ctx) => (typeof v === 'function' ? v(ctx) : v);

  // 1日の締め(G.day++ の後)から呼ぶ
  function decisionAfterDay() {
    if (!DECI) return;
    const st = decState();
    const fired = DECISIONS.tick({ G, settings }, st, G.day);
    if (fired.length) {
      banner(`🔀 前の判断の結果 — ${fired.map((f) => `${f.label || ''}${f.fx ? `(${DECISIONS.summarizeFx(f.fx)})` : ''}`).join(' / ')}`);
      for (const f of fired) (G.voiceFeed = G.voiceFeed || []).push({ kind: 'event', char: 'advisor', text: `${f.label}: ${DECISIONS.summarizeFx(f.fx)}`, day: G.day });
      updateHeader(); renderStaffStrip(); if (activeTab === 'mgmt') renderDecCard();
    }
    if (!G.tutorialDone || tutIdx >= 0 || gateOpen || decOpen || G.day < 5) return;
    if ($('modal').classList.contains('show')) return; // ミッション達成などの modal が開いている日は重ねない(翌日の締めで開く・qa v72 指摘)
    const picked = DECISIONS.pick(decCtx(), st);
    if (picked) openDecision(picked.c, picked.viaChain);
  }

  function openDecision(c, viaChain) {
    const st = decState();
    st.open = { id: c.id, day: G.day, chain: viaChain ? { id: viaChain.id, day: viaChain.day } : null };
    decOpen = true; decBusy = false; decPick = null;
    const ctx = decCtx();
    decCur = { c, viaChain: st.open.chain, ctx, outcomes: {} };
    for (const ch of c.choices) decCur.outcomes[ch.id] = DECISIONS.evaluate(c, ch, ctx, st);
    renderDecision();
    $('decisionGate').classList.add('show');
    $('decisionGate').scrollTop = 0;
    save();
  }

  function decLinesHtml(lines) {
    if (!lines.length) return '<p class="dec-none">数字はすぐには動かない</p>';
    return lines.map((l) => `<div class="pnl-row dec-line${l.later ? ' later' : ''}"><span>${l.label}</span><b class="${l.neg ? 'neg' : l.later ? '' : 'pos'}">${l.val}</b>${l.sub ? `<small class="dec-sub">${l.sub}</small>` : ''}</div>`).join('');
  }

  function renderDecision() {
    const { c, ctx, outcomes } = decCur;
    const who = decWho(c);
    const st = decState();
    const facts = c.facts ? fnv(c.facts, ctx) : [];
    const choices = c.choices.map((ch) => {
      const o = outcomes[ch.id];
      const on = decPick === ch.id;
      return `<button class="choice-row dec-choice${on ? ' on' : ''}${o.ok ? '' : ' blocked'}" data-dec="${ch.id}" ${o.ok ? '' : 'aria-disabled="true"'}>
        <b>${ch.label}</b><small>${fnv(ch.note, ctx) || ''}${o.ok ? '' : `<br><i class="dec-block">選べない: ${o.blocked.join('・')}</i>`}</small></button>`;
    }).join('');
    let preview = '<p class="dec-hint">選択肢を押すと見込みが出る。確定するまで変えられる</p>';
    if (decPick) {
      const o = outcomes[decPick];
      const rollHtml = o.roll ? `<p class="dec-why">🎲 ${o.roll.label}: ${Math.round(o.roll.p * 100)}%。起きれば ${DECISIONS.summarizeFx(o.roll.hitFx) || '数字は動かない'} / 起きなければ ${DECISIONS.summarizeFx(o.roll.missFx) || '数字は動かない'}</p>` : '';
      const whyHtml = o.why.length ? `<p class="dec-why">${o.why.map((w) => `※ ${w}`).join('<br>')}</p>` : '';
      // 見込み: 確率つきの行は「確定側」を伏せて幅で見せる(確定後に同じ outcome で結果を出す)
      const shown = o.roll ? DECISIONS.lines(DECISIONS.resolveFx(c.choices.find((x) => x.id === decPick).fx, ctx), ctx) : o.lines;
      preview = `<div class="dec-preview"><small class="dec-plabel">見込み</small>${decLinesHtml(shown)}${rollHtml}${whyHtml}</div>`;
    }
    $('decFace').innerHTML = decFace(c);
    $('decWho').textContent = `${who.title ? who.title + ' ' : ''}${who.name}からの相談`;
    $('decTitle').textContent = c.title;
    $('decStep').textContent = `Day ${ctx.day} · ${DECISIONS.CATS[c.cat]}`;
    $('decBody').innerHTML = `
      <p class="dec-say">「${fnv(c.say, ctx)}」</p>
      <p class="dec-bg">${fnv(c.bg, ctx)}</p>
      <div class="dec-facts">${facts.map((f) => `<span class="kijun-badge alt">${f.label} ${f.val}</span>`).join('')}<span class="kijun-badge alt">余力 ${st.slack > 0 ? '+' : ''}${st.slack}</span><span class="kijun-badge alt">信頼 ${st.trust > 0 ? '+' : ''}${st.trust}</span></div>
      <p class="dec-ask"><b>決めること:</b> ${c.ask}</p>
      <div class="dec-choices">${choices}</div>
      ${preview}
      <div class="tut-btns"><button class="btn-cta" id="decGo" ${decPick && outcomes[decPick].ok ? '' : 'disabled'}>この方針で決める</button></div>`;
    $('decBody').querySelectorAll('[data-dec]').forEach((b) => b.addEventListener('click', () => {
      if (decBusy) return;
      const id = b.dataset.dec;
      if (!outcomes[id].ok) { toast(`選べない: ${outcomes[id].blocked.join('・')}`); return; }
      decPick = id;
      const box = $('decisionGate').querySelector('.dec-box'); const keep = box ? box.scrollTop : 0;
      renderDecision();
      if (box) { box.scrollTop = keep; const pv = box.querySelector('.dec-preview'); if (pv && pv.scrollIntoView) pv.scrollIntoView({ block: 'nearest' }); } // 再描画で先頭へ戻さない・見込みを視界に(designer A)
    }));
    const go = $('decGo'); if (go) go.addEventListener('click', confirmDecision);
  }

  // 分岐前の状態を丸ごと残す(やり直し用。直近 DEC_SNAP_MAX 件)
  function decSnapshot(n) {
    try {
      const key = `${SAVE_KEY}_dec${n}`;
      localStorage.setItem(key, JSON.stringify(savePayload()));
      for (const k of Object.keys(localStorage)) {
        const m = k.match(new RegExp(`^${SAVE_KEY}_dec(\\d+)$`));
        if (m && Number(m[1]) <= n - DEC_SNAP_MAX) localStorage.removeItem(k);
      }
      return key;
    } catch (e) { return null; }
  }

  function confirmDecision() {
    if (!decOpen || decBusy || !decPick) return;
    decBusy = true; // 連続タップの二重処理を防ぐ
    const { c, ctx, viaChain } = decCur;
    const ch = c.choices.find((x) => x.id === decPick);
    const st = decState();
    const outcome = decCur.outcomes[ch.id]; // 見込みに使ったものと同じ
    if (!outcome.ok) { decBusy = false; return; }
    const snap = decSnapshot(st.count + 1);
    const entry = DECISIONS.commit(c, ch, outcome, { G, settings }, st, { viaChain, snap });
    entry.reflect = DECISIONS.reflect(c, ch, outcome, ctx);
    applyUnlocks(); renderShop(); renderStaffStrip(); updateHeader(); if (activeTab === 'corp') renderCorp();
    pushVoice(typeof c.who === 'string' && STAFF_UI.STAFF[c.who] ? c.who : 'advisor', `${c.title} → ${ch.label}`, 'event');
    renderDecisionResult(entry, c, ch, outcome);
    save();
  }

  function renderDecisionResult(entry, c, ch, outcome) {
    const who = decWho(c);
    const d = (a, b) => (b - a);
    const dm = entry.after.money - entry.before.money;
    const moneyLine = dm ? `<div class="pnl-row dec-line"><span>資金</span><b class="${dm < 0 ? 'neg' : 'pos'}">${dm < 0 ? '−' : '+'}${yen(Math.abs(dm))}<small class="dec-sub">${yen(entry.before.money)} → ${yen(entry.after.money)}</small></b></div>` : '';
    const stRow = (label, a, b) => (a === b ? '' : `<div class="pnl-row dec-line"><span>${label}</span><b class="${b < a ? 'neg' : 'pos'}">${a} → ${b}</b></div>`);
    const stLine = stRow('職員の余力', entry.before.slack, entry.after.slack) + stRow('地域の信頼', entry.before.trust, entry.after.trust);
    const later = outcome.lines.filter((l) => l.later);
    $('decWho').textContent = `${who.title ? who.title + ' ' : ''}${who.name}に方針を伝えた`;
    $('decBody').innerHTML = `
      <p class="dec-ask"><b>決めた方針:</b> ${ch.label}</p>
      <div class="dec-preview"><small class="dec-plabel">変わった数字</small>${moneyLine}${stLine}${decLinesHtml(outcome.lines.filter((l) => !l.later && l.k !== 'money' && l.k !== 'slack' && l.k !== 'trust'))}
      ${later.length ? `<small class="dec-plabel">あとで</small>${decLinesHtml(later)}` : ''}</div>
      <div class="dec-reflect">${entry.reflect.map((r) => `<p>${r}</p>`).join('')}</div>
      <div class="tut-btns"><button class="btn-cta" id="decClose">続ける</button></div>`;
    $('decClose').addEventListener('click', closeDecision);
  }

  function closeDecision() {
    if (!decOpen) return;
    decOpen = false; decBusy = false; decPick = null; decCur = null;
    $('decisionGate').classList.remove('show');
    if (G.dec) G.dec.open = null;
    save();
    if (activeTab === 'mgmt') renderDecCard();
  }

  /* 経営タブのカード: 余力・信頼の今、予定している効果、履歴とやり直し */
  function renderDecCard() {
    const el = $('decCardBody');
    if (!el || !DECI) return;
    const st = decState();
    const day = G.day;
    const meaning = (v, pos, neg) => (v > 0 ? pos : v < 0 ? neg : '中立');
    const mods = st.mods.filter((m) => m.until == null || m.until > day);
    const pend = st.pending.slice().sort((a, b) => a.due - b.due);
    const keep = (() => { try { return !!localStorage.getItem(SAVE_KEY + '_keep'); } catch (e) { return false; } })();
    const log = st.log.slice().reverse().slice(0, 10);
    el.innerHTML = `
      <div class="dec-facts">
        <span class="kijun-badge ${st.slack < 0 ? 'off' : st.slack > 0 ? '' : 'alt'}">職員の余力 ${st.slack > 0 ? '+' : ''}${st.slack} · ${meaning(st.slack, '診察が速い', '診察が延びる')}</span>
        <span class="kijun-badge ${st.trust < 0 ? 'off' : st.trust > 0 ? '' : 'alt'}">地域の信頼 ${st.trust > 0 ? '+' : ''}${st.trust} · ${meaning(st.trust, '紹介が増える', '新患が減る')}</span>
      </div>
      <p class="kijun-kb">余力1段=診察±0.3分 / 信頼1段=新患±2%・紹介+0.3人/日</p>
      ${mods.length ? `<h3 class="sub-title">続いている効果</h3>${(() => {
        const perm = mods.filter((m) => m.kind === 'dailyCost' && m.until == null);
        const rest = mods.filter((m) => !(m.kind === 'dailyCost' && m.until == null));
        const permSum = perm.reduce((a, m) => a + m.v, 0);
        const permRow = perm.length ? `<div class="pnl-row dec-line"><span>ずっと続く継続費 <small>(${perm.length}件: ${perm.map((m) => m.label || '').filter(Boolean).join('・')})</small></span><b class="${permSum > 0 ? 'neg' : 'pos'}">${permSum > 0 ? '−' : '+'}${yen(Math.abs(permSum))}/日</b></div>` : '';
        return permRow + rest.map((m) => `<div class="pnl-row dec-line"><span>${m.label || m.kind}</span><b>${m.kind === 'dailyCost' ? `${m.v > 0 ? '−' : '+'}${yen(Math.abs(m.v))}/日` : m.kind === 'newMul' ? `新患×${m.v}` : `診察${m.v > 0 ? '+' : ''}${m.v}分`}${m.until ? ` · Day ${m.until}まで` : ''}</b></div>`).join('');
      })()}` : ''}
      ${pend.length ? `<h3 class="sub-title">あとで来る結果</h3>${pend.map((p) => `<div class="pnl-row dec-line later"><span>Day ${p.due} ${p.label}</span><b>${DECISIONS.summarizeFx(p.fx) || '—'}</b></div>`).join('')}` : ''}
      <h3 class="sub-title">判断の履歴 <small>— ${st.log.length}件</small></h3>
      ${log.length ? log.map((e) => `<div class="dec-log">
          <div><b>Day ${e.day}</b> ${e.title} → <b>${e.choiceLabel}</b><br><small>${e.lines.filter((l) => !l.later).map((l) => `${l.label} ${l.val}`).join('・') || '数字は動かなかった'}${e.roll ? ` · 🎲${e.roll.hit ? '起きた' : '起きなかった'}` : ''}</small></div>
          ${e.snap && localStorage.getItem(e.snap) ? `<button class="mini-btn" data-decrewind="${e.n}">別の方針を試す</button>` : ''}
        </div>`).join('') : '<p class="pnl-empty">まだ相談は届いていない(Day 5 から)</p>'}
      ${keep ? '<div class="op-row"><button class="op-btn" id="decKeepBack">🔁 控えに残した進行に戻る</button></div>' : ''}`;
    el.querySelectorAll('[data-decrewind]').forEach((b) => b.addEventListener('click', () => decAskRewind(Number(b.dataset.decrewind))));
    const kb = $('decKeepBack'); if (kb) kb.addEventListener('click', decRestoreKeep);
  }

  function decAskRewind(n) {
    const e = (G.dec.log || []).find((x) => x.n === n);
    if (!e) return;
    showModal('🔀 この分岐から別の方針を試す', `
      <p><b>Day ${e.day}「${e.title}」</b>の直前に戻ります。資金・職員・患者・あとで来る結果・履歴もその時点に戻り、同じ相談が同じ見込みで開きます。</p>
      <p>いまの進行(Day ${G.day})をどうしますか。</p>
      <div class="op-row dec-rewind">
        <button class="op-btn has-note" id="decRwKeep">🗂 控えに残して戻る<span class="act-note">控えは1つだけ。経営タブの分岐点カードから戻れる</span></button>
        <button class="op-btn has-note" id="decRwDrop">↩️ いまの進行を捨てて戻る<span class="act-note">Day ${e.day} 以降の進行は消える</span></button>
      </div>`, 'やめる');
    const fin = (keep) => {
      try {
        const raw = localStorage.getItem(e.snap);
        if (!raw) { toast('この分岐の記録は残っていない'); return; }
        if (keep) localStorage.setItem(SAVE_KEY + '_keep', JSON.stringify(savePayload()));
        localStorage.setItem(SAVE_KEY, raw);
        location.reload();
      } catch (err) { toast('やり直しに失敗した'); }
    };
    $('decRwKeep').addEventListener('click', () => fin(true));
    $('decRwDrop').addEventListener('click', () => fin(false));
  }
  function decRestoreKeep() {
    try {
      const raw = localStorage.getItem(SAVE_KEY + '_keep');
      if (!raw) return;
      localStorage.setItem(SAVE_KEY, raw);
      localStorage.removeItem(SAVE_KEY + '_keep');
      location.reload();
    } catch (e) { toast('戻せなかった'); }
  }

  /* ================= 起動 ================= */

  const hasSave = load();
  applyMainWords();
  let prestigeApplied = null;
  if (!hasSave) {
    // 殿堂入り直後(セーブなし+殿堂記録あり)なら、実績連動ボーナスを適用して2周目開始
    const pr = loadPrestige();
    if (pr && pr.legacy) {
      prestigeApplied = pr;
      G.prestige = { count: pr.count, legacy: pr.legacy };
      G.money = pr.legacy.money;
      G.rep = pr.legacy.rep;
      G.aw = pr.legacy.aw;
      G.coins = pr.legacy.coins;
      G.achDone = pr.achDone || [];
      G.stats = pr.stats || G.stats;
      G.deco = pr.deco || {};
      G.clinicName = pr.clinicName || G.clinicName;
      G.daily = pr.daily || G.daily;
      G.speedPass = pr.speedPass || { tier: 0, until: 0 };
      G.bonds = pr.bonds || G.bonds;
      G.specialDone = pr.specialDone || [];
      G.season = pr.season || G.season;
      if (pr.speedUnlocked) {
        const OLD_PRICE = { 8: 12, 16: 25, 32: 50 };
        Object.keys(pr.speedUnlocked).forEach((k) => { if (pr.speedUnlocked[k]) G.coins += OLD_PRICE[k] || 0; });
      }
      G.tutorialDone = true; // 2周目はチュートリアル不要
    }
    [8, 7, 7, 6, 6, 5, 5, 4, 4, 3].forEach((n, i) => {
      for (let k = 0; k < n; k++) addSchedule(i + 1, 'revisit');
    });
  }
  clinic.applySettings();
  clinicIso.W = clinic.L.W; clinicIso.H = clinic.L.H;
  town.setBranches(G.branches.map((x) => x.siteId));
  if (town.setDepts) town.setDepts(Object.keys(G.depts || {}));
  updateHomecareTown();
  clinic.deco = G.deco;
  planDay();
  applyUnlocks();
  renderSchedule();
  renderShop();
  renderTodo();
  renderItems();
  renderAch();
  updateNameBadge();
  const nb = $('nameBadge');
  if (nb) nb.addEventListener('click', () => {
    showModal('🏥 クリニック名を変更', `
      <p>院名は自由に決められます(タウン・院内表示に反映)。</p>
      <input id="nameInput" class="name-input" maxlength="14" value="${escapeHtml(G.clinicName)}">
      <div class="modal-actions"><button class="btn-cta" id="nameGo">この名前にする</button></div>`, 'やめておく');
    $('nameGo').addEventListener('click', () => {
      const v = $('nameInput').value.trim();
      if (v) G.clinicName = v.slice(0, 14);
      $('modal').classList.remove('show');
      updateNameBadge(); save();
      toast(`🏥 「${G.clinicName}」に改名しました`);
    });
  });
  renderPnl();
  renderMissions();
  renderPlanner();
  renderBank();
  renderCorp();
  renderAds();
  renderKpiPicker();
  renderKpiStrip();
  renderStaffStrip();
  renderVoice();
  updateMissionBar();
  updateHeader();
  $('vExamMean').textContent = `${settings.examMean}分`;
  $('examMean').value = settings.examMean;
  $('vPTreat').textContent = `${Math.round(settings.pTreat * 100)}%`;
  $('pTreat').value = Math.round(settings.pTreat * 100);
  $('vPReha').textContent = `${Math.round(settings.pReha * 100)}%`;
  $('pReha').value = Math.round(settings.pReha * 100);
  $('vPInj').textContent = `${Math.round(settings.pInj * 100)}%`;
  $('pInj').value = Math.round(settings.pInj * 100);
  $('vPTrig').textContent = `${Math.round(settings.pTrig * 100)}%`;
  $('pTrig').value = Math.round(settings.pTrig * 100);
  $('vPPhysio').textContent = `${Math.round(settings.pPhysio * 100)}%`;
  $('pPhysio').value = Math.round(settings.pPhysio * 100);

  clinicIso.resize();
  townIso.resize();
  window.addEventListener('resize', () => { clinicIso.resize(); townIso.resize(); });

  switchTab('clinic');
  const afterStart = () => {
    if (prestigeApplied) {
      save();
      const lg = prestigeApplied.legacy;
      showModal(`🏛 ${prestigeApplied.count + 1}周目スタート`, `
        <p>殿堂入りおめでとうございます。実績連動ボーナスを適用して、新しい経営を始めます。</p>
        <div class="pnl-row"><span>開始資金</span><b>${yen(lg.money)}</b></div>
        <div class="pnl-row"><span>初期評判 / 初期認知</span><b>${lg.rep} / ${Math.round(lg.aw * 100)}%</b></div>
        <div class="pnl-row"><span>開始コイン</span><b>🪙 ${lg.coins}</b></div>
        <div class="pnl-row"><span>実績・累計・施設・院名</span><b>引き継ぎ済み</b></div>
        <p class="modal-note">📖 2周目のテーマは「再現性」。前回うまくいった打ち手が、初期条件が違っても通用するか — それが経営の腕です。</p>`,
        `${prestigeApplied.count + 1}周目の経営へ`);
    } else if (!G.tutorialDone) startTutorial();
    applyUnlocks(); renderShop(); renderMissions(); updateMissionBar(); renderCorp(); updateHeader();
  };
  decState();
  if (!hasSave) openStartGate(afterStart);
  else banner(`おかえりなさい — Day ${G.day} から再開します`);
  if (hasSave && G.dec && G.dec.open) { const oc = DECISIONS.byId(G.dec.open.id); if (oc) openDecision(oc, G.dec.open.chain); else G.dec.open = null; } // 判断の途中で閉じた/やり直しで戻った相談を再表示
  if (G.tutorialDone && !gateOpen && !decOpen && !$('modal').classList.contains('show')) checkDailyLogin();
  renderPrestige();
  updateSpeedButtons();
  const sb = $('soundBtn');
  if (sb) {
    const paint = () => { sb.textContent = G.sound ? '🔊' : '🔇'; sb.title = G.sound ? '効果音ON' : '効果音OFF'; };
    paint();
    sb.addEventListener('click', () => { G.sound = !G.sound; paint(); if (G.sound) SND.coin(); save(); });
  }
  // 🔔 通知(デイリーボーナスのリマインド): Capacitorネイティブ or PWAのperiodicSync
  async function setupNotifications() {
    try {
      const LN = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
      if (LN) {
        const perm = await LN.requestPermissions();
        if (perm.display !== 'granted') return false;
        await LN.schedule({ notifications: [{
          id: 1, title: 'クリニックタウン3D',
          body: '🎁 今日のログインボーナスとスタッフからの依頼が届いています',
          schedule: { on: { hour: 19, minute: 0 }, repeats: true }
        }] });
        return true;
      }
      if (!('Notification' in window)) return false;
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return false;
      if (navigator.serviceWorker) {
        const reg = await navigator.serviceWorker.ready;
        if (reg.periodicSync) await reg.periodicSync.register('ct3d-daily', { minInterval: 20 * 3600 * 1000 }).catch(() => {});
      }
      return true;
    } catch (e) { return false; }
  }
  const ntb = $('notifyBtn');
  if (ntb) {
    const paintN = () => { ntb.textContent = G.notify ? '🔔' : '🔕'; ntb.title = G.notify ? 'デイリー通知ON' : 'デイリー通知OFF'; };
    paintN();
    ntb.addEventListener('click', async () => {
      if (G.notify) {
        G.notify = false;
        paintN(); save();
        toast('🔕 デイリー通知をOFFにしました');
        return;
      }
      const ok = await setupNotifications();
      G.notify = ok;
      paintN(); save();
      toast(ok ? '🔔 毎日のボーナスと依頼をお知らせします' : '通知が許可されませんでした(端末の設定を確認してください)');
    });
  }
  /* --- 🚶 3D視察モード: 経営者が「現場に降りる」(院内⇄街) --- */
  let walk3d = null;
  function launchWalk(mode) {
    if (tutIdx >= 0) { toast('まずはチュートリアルを終えましょう'); return; }
    if (!window.Walk3D || !window.THREE) { toast('この端末では3D表示を利用できません'); return; }
    if (!walk3d) {
      try {
        walk3d = new Walk3D(clinic, {
          town,
          getDeco: () => G.deco || {},
          getTown: () => ({ branches: G.branches.map((x) => x.siteId), billboard: G.billboard }),
          getClinicName: () => G.clinicName,
          getWeather: () => ensureWeather(),
          onStep: () => SND.step(),
          onAmbience: (kind) => SND.ambience(kind === 'rain' ? 'rain' : kind === 'ice' ? 'wind' : null),
          getBuddyLine: (mode) => {
            const wx = ensureWeather();
            const cands = [];
            if (mode === 'town') {
              // 冷えかけの営業関係
              let cold = null;
              Object.keys(REL_DEF).forEach((k) => {
                const r = G.relations[k];
                if (r && r.lv > 0 && G.day - r.last > 18 && (!cold || r.last < G.relations[cold].last)) cold = k;
              });
              if (cold) cands.push(`${REL_DEF[cold].name}、${G.day - G.relations[cold].last}日ご無沙汰です。関係は30日で冷え始めますよ`);
              if (!G.billboard) cands.push('駅前の看板枠、まだ空いてます。駅利用者の新患に効きますよ');
              if (G.aw < 0.5) cands.push(`認知はまだ${Math.round(G.aw * 100)}%。商店街や包括センターで顔を売りましょう`);
              const fans = (G.regulars || []).filter((r) => r.visits >= 5).length;
              if (fans >= 5) cands.push(`顔なじみが${fans}人。口コミが効き始めています。良い流れです`);
              if (wx.kind === 'ice') cands.push('この路面…明日は転倒の初診が増えます。処置の備えを');
              if (wx.kind === 'rain') cands.push('雨の日はリハのキャンセルが出ます。午後の枠、電話を入れておきましょう');
              cands.push('営業は「提供できる医療」が先。リハ体制が整うほど紹介は太くなります');
              return { name: '白瀬', text: cands[(G.day + Math.floor(G.t / 60)) % cands.length] };
            }
            const bn = bottleneckInfo();
            const wl = clinic.waitingLoad();
            if (bn && bn.text && !bn.text.includes('なし')) cands.push(bn.text);
            if (wl.n >= wl.cap * 0.6) cands.push(`待合が埋まってきました(${wl.n}/${wl.cap})。混雑の前に一手を`);
            if (wx.note) cands.push(`今日は${wx.label}。${wx.note}`);
            const angry = clinic.patients.filter((p) => p.waitTotal > 45).length;
            if (angry) cands.push(`${angry}人、かなりお待たせしています。院長の声かけどうでしょう`);
            if ((G.today.soothe || 0) === 0 && clinic.patients.some((p) => p.waitTotal > 30)) cands.push('お待たせしている方に声をかけると、体感の待ちがやわらぎますよ');
            cands.push('現場を歩くと、数字にならない詰まりが見えますね');
            cands.push('患者さんをタップすると、その方の事情が分かりますよ');
            return { name: '松岡', text: cands[(G.day + Math.floor(G.t / 45)) % cands.length] };
          },
          getHud: () => ({
            line1: `Day ${G.day}(${WEEKDAYS[weekdayOf(G.day)]}) ${fmtClock(G.t)} — ${escapeHtml(G.clinicName)}`,
            line2: walk3d && walk3d.mode === 'town'
              ? `認知 ${Math.round(G.aw * 100)}% ・ 評判 ${Math.round(G.rep)} ・ 本日 ${G.today ? G.today.patients : 0}人 / ${yen(G.today ? G.today.revenue : 0)}`
              : `院内 ${clinic.patients.length}人 ・ 本日 ${G.today ? G.today.patients : 0}人 / ${yen(G.today ? G.today.revenue : 0)}`
          }),
          onPatientTap: (p) => showPatientModal(p),
          onStaffTap: (kind) => showStaffModal(kind),
          onFloorStaffTap: (role, idx) => {
            if (typeof PERSONA === 'undefined') return;
            const st = PERSONA.genStaff(role, idx);
            SND.click();
            toast(`🗣 ${st.name}(${st.role})「${PERSONA.floorStaffLine(role, idx, G.day)}」`);
          },
          onBuildingTap: (b) => { SND.click(); openBuilding(b); },
          buildingActLabel,
          getShareMeta: () => ({
            name: G.clinicName,
            sub: `Day ${G.day} ・ 評判 ${Math.round(G.rep)} ・ 認知 ${Math.round(G.aw * 100)}% ・ 本日 ${G.today ? G.today.patients : 0}人`,
            tag: '#クリニックタウン3D'
          }),
          onShare: (blob, meta) => {
            const file = new File([blob], 'clinic-town-3d.png', { type: 'image/png' });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
              navigator.share({ files: [file], title: 'クリニックタウン3D', text: `${meta.name} ${meta.sub} ${meta.tag}` }).catch(() => {});
            } else {
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'clinic-town-3d.png';
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 4000);
              toast('📸 現場の一コマを保存しました — SNSでシェアしてください');
            }
          },
          onTooFar: () => toast('💬 もう少し近づいて声をかけましょう'),
          onModeSwitch: (m) => {
            SND.click();
            pushPulseEv('🚶', m === 'town' ? '街へ営業に' : '院内へ戻る');
            banner(m === 'town' ? '🗺 街に出ました — 病院やケアマネ事業所に近づくと営業できます' : '🏥 院内に戻りました');
          },
          onEnter: () => {
            if (G.speed > 2) { G.speed = 2; updateSpeedButtons(); }
            pushPulseEv('🚶', walk3d && walk3d.mode === 'town' ? '街を視察' : '現場視察');
            SND.click();
            banner(walk3d && walk3d.mode === 'town'
              ? '🗺 街の視察 — 営業先の建物に近づくと訪問できます。院の入口から中にも入れます'
              : '🚶 視察モード — 現場を歩いて、患者さんやスタッフに声をかけられます');
          },
          onExit: () => { SND.click(); SND.ambOff(); }
        });
      } catch (e) { toast('この端末では3D表示を利用できません'); return; }
    }
    if (!walk3d.enter(mode)) toast('この端末では3D表示を利用できません');
  }
  const wkb = $('walkBtn');
  if (wkb) {
    if (!window.Walk3D || !window.THREE) wkb.style.display = 'none';
    else wkb.addEventListener('click', () => launchWalk('clinic'));
  }
  const wtb = $('walkTownBtn');
  if (wtb) {
    if (!window.Walk3D || !window.THREE) wtb.style.display = 'none';
    else wtb.addEventListener('click', () => launchWalk('town'));
  }

  // 縦持ちスマホに一度だけ横持ちのコックピット表示を案内
  try {
    if (window.innerWidth < 900 && window.matchMedia('(orientation: portrait)').matches && !localStorage.getItem('ct3d_rotateHint') && G.tutorialDone) {
      setTimeout(() => banner('💡 横持ちにすると、院内を見ながら操作できる「コックピット表示」になります'), 7000);
      localStorage.setItem('ct3d_rotateHint', '1');
    }
  } catch (e) { /* noop */ }
  if (G.speedRefund) {
    banner(`⏩ 倍速が時間制パスになりました — 旧・買い切り分は 🪙${G.speedRefund} を返金済みです`);
    delete G.speedRefund;
    save();
  }

  requestAnimationFrame((ts) => { lastTs = ts; requestAnimationFrame(loop); });
})();
