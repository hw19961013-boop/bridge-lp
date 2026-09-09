/* 経営の分岐点 — 分類5: 患者・家族対応・サービス体験 */
(function (root) {
  'use strict';
  const yen = (n) => '¥' + Math.round(n).toLocaleString('ja-JP');
  const CASES = [
    {
      id: 'PT-01', cat: 5, title: '「説明が足りない」と家族から', tier: 1, spec: ['any'], who: 'family', cool: 75,
      cond: (c) => c.patients7 >= 12,
      say: '母の治療方針、本人は「先生に任せる」と言うのですが、私たちには説明がほとんど届いていません。',
      bg: (c) => `高齢の常連の家族から。診察1人あたり${c.examMean}分。家族は仕事の合間に付き添っている。`,
      ask: '家族への説明の仕組み',
      choices: [
        { id: 'slot', label: '家族同席の説明枠を週1回作る', note: '費用なし。診察1人あたり+0.5分が20日。家族の納得は上がる',
          fx: { examDelta: { d: 0.5, days: 20, label: '家族説明枠' }, rep: 1, trust: 1 },
          reflect: '説明は診療の一部。時間で払った' },
        { id: 'sheet', label: '説明用の紙を作って渡す', note: '¥30,000。作るのに10日。紙で伝わる部分は伝わる',
          req: { money: 30000 },
          fx: { money: -30000, delayed: [{ days: 10, label: '説明用紙が完成', fx: { rep: 0.8 } }] },
          reflect: '仕組みで払った。伝わらない部分は残る' },
        { id: 'apology', label: 'その場で謝り、次回に時間を取る', note: '費用なし。その家族には届く。仕組みは変わらない',
          fx: { rep: 0.3 },
          chance: { p: 0.35, label: '別の家族から同じ声', hit: { rep: -1 }, miss: {} },
          reflect: '個別対応は効くが、次の家族には届かない' }
      ],
      lesson: '患者への対応を守る費用は、時間か仕組みかのどちらかで払う', point: '家族への説明。時間・仕組み・個別対応'
    },
    {
      id: 'PT-02', cat: 5, title: '待合で立って待つ人が出ている', tier: 1, spec: ['any'], who: 'front', cool: 60,
      cond: (c) => c.balked7 >= 1 || c.waitAvg >= 30,
      say: 'ピークの時間、椅子が足りず立って待つ方がいます。高齢の方に座ってもらう声かけで、受付が手いっぱいです。',
      bg: (c) => `平均待ち${Math.round(c.waitAvg)}分。待てずに帰る人が1日${c.balked7}人。待合椅子は院内タブで増やせる。`,
      ask: '待合の混雑への対応',
      choices: [
        { id: 'spread', label: '予約時間を分散して山を崩す', note: '費用なし。新患×0.95が14日。立ち待ちは減る',
          fx: { newMul: { mul: 0.95, days: 14, label: '予約分散' }, rep: 1 },
          reflect: '入りを平らにした。椅子を買うのとどちらが安いか' },
        { id: 'guide', label: '受付の案内で外出待ちを促す', note: '費用なし。受付の負担が増える。帰ってしまう人も出る',
          fx: { slack: -1, rep: 0.3 },
          chance: { p: 0.3, label: '外出した人が戻らない', hit: { rep: -0.5 }, miss: {} },
          reflect: '人の対応で吸収した。混雑日は限界がある' },
        { id: 'nothing', label: '混雑は一時的と見て何もしない', note: '新患×0.95が30日。続けば口コミに出る',
          fx: { newMul: { mul: 0.95, days: 30, label: '立ち待ちのまま' } },
          chance: { p: (c) => (c.waitAvg >= 40 ? 0.5 : 0.25), label: '口コミに立ち待ちの投稿', hit: { rep: -1.5, aw: -0.01 }, miss: {} },
          reflect: '一時的かどうかは、次の週の数字で分かる' }
      ],
      lesson: '患者体験の不満は、まず受付に集まり、次に口コミに出る', point: '待合の混雑。分散・案内・設備'
    },
    {
      id: 'PT-03', cat: 5, title: '予約の無断キャンセルが続いている', tier: 1, spec: ['any'], who: 'front', cool: 75,
      cond: (c) => c.patients7 >= 15,
      say: '予約の無断キャンセルが週に数件あります。枠は空くのに、当日の飛び込みは断っていて、もったいないです。',
      bg: (c) => `1日平均${c.patients7}人。無断キャンセルは週に3〜4件(架空の集計)。空いた枠は埋まらず、その分の収入が消えている。`,
      ask: '無断キャンセルへの対応',
      choices: [
        { id: 'remind', label: '前日に確認の連絡を入れる', note: '費用なし。受付の手を毎日30分使う。キャンセル自体は減る',
          fx: { slack: -1, newMul: { mul: 1.03, days: 30, label: '空き枠が埋まる' } },
          when: [{ if: (c) => c.staff.receptionists >= 2, fx: { slack: 1 }, why: '受付が2人いるので、確認の連絡は負担にならなかった' }],
          reflect: '手間で回収した。受付が薄いときは別の仕事が遅れる' },
        { id: 'walkin', label: '空いた枠を当日受付に開放する', note: '費用なし。飛び込みが入る。予約の人の待ちが少し延びる',
          fx: { newMul: { mul: 1.02, days: 30, label: '当日枠の開放' }, rep: -0.3 },
          chance: { p: 0.3, label: '飛び込みが重なり待ちが伸びる', hit: { rep: -0.7 }, miss: {} },
          reflect: '枠は埋まる。予約した人の時間で払っている' },
        { id: 'rule', label: '続く人は予約を制限する', note: '費用なし。常連の反発が出ることがある。枠の無駄は減る',
          fx: { rep: -0.5, newMul: { mul: 1.02, days: 30, label: 'キャンセル減' } },
          when: [{ if: (c) => c.rep >= 65, fx: { rep: 0.8 }, why: '評判が高い院では、ルールは公平さとして受け止められた' }],
          chance: { p: 0.25, label: '制限された患者が口コミに書く', hit: { rep: -1 }, miss: {} },
          reflect: 'ルールは公平さを買う。伝え方で反発の大きさが変わる' }
      ],
      lesson: '空いた枠は在庫と同じ。埋めるか、空けないかを先に決める', point: '無断キャンセル。確認・開放・制限'
    },
    {
      id: 'PT-04', cat: 5, title: '「先に診てほしい」と強く言う患者', tier: 1, spec: ['any'], who: 'front', cool: 60,
      cond: (c) => c.waitAvg >= 25,
      say: '「仕事があるから先に診て」と強く言う方がいます。順番を守る方の目もあり、受付で毎回迷います。',
      bg: (c) => `平均待ち${Math.round(c.waitAvg)}分。急ぐ理由は仕事・送迎などさまざま。順番の決め方は今は受付の裁量。`,
      ask: '順番の決め方をどうするか',
      choices: [
        { id: 'rule', label: '順番の基準を決めて掲示する', note: '掲示¥5,000。体調による優先だけ認める。受付は迷わなくなる',
          req: { money: 5000 },
          fx: { money: -5000, slack: 1, rep: 0.3 },
          chance: { p: 0.2, label: '「融通が利かない」の声', hit: { rep: -0.5 }, miss: {} },
          reflect: '基準を見せた。受付の判断が院の判断になった' },
        { id: 'nurse', label: '看護師が状態を見て前後を判断する', note: '費用なし。看護師の手が一時的に取られる。納得は得やすい',
          fx: { slack: -1, rep: 0.5 },
          when: [{ if: (c) => c.staff.nurses <= 1, fx: { slack: -1 }, why: '看護師が1人だと、判断のたびに処置が止まる' }],
          reflect: '医療の目で順番を決めた。人が足りないと続かない' },
        { id: 'asis', label: '受付の裁量のままにする', note: '費用なし。余力−1。その場は収まる。基準が無いと「あの人は通った」が残る',
          fx: { slack: -1 },
          chance: { p: (c) => (c.waitAvg >= 40 ? 0.45 : 0.25), label: '順番を巡る言い合いが待合で起きる', hit: { rep: -1, slack: -1 }, miss: {} },
          reflect: '裁量は楽だが、揉めたときに受付が一人で背負う' }
      ],
      lesson: '公平さは基準を見せて守る。人の裁量だけに置くと、その人が削れる', point: '診察順の基準。掲示・判断・裁量'
    },
    {
      id: 'PT-05', cat: 5, title: '口コミサイトに低い評価が付いた', tier: 2, spec: ['any'], who: 'front', cool: 120,
      cond: (c) => c.rep <= 66 || c.waitAvg >= 30,
      say: '口コミサイトに「受付が冷たい、説明が無い」と低い評価が付きました。職員も見てしまっています。',
      bg: (c) => `評判${Math.round(c.rep)}。投稿は匿名で、来院日は特定できない。平均待ち${Math.round(c.waitAvg)}分。`,
      ask: '低評価への最初の対応',
      choices: [
        { id: 'reply', label: '院として公開で返信する', note: '費用なし。誠実な返信は読む人に届く。言い返しに見えると逆効果',
          fx: { rep: 0.3, next: { id: 'PT-05b', days: 10 } },
          chance: { p: 0.3, label: '返信が「言い訳」と受け取られる', hit: { rep: -1 }, miss: { rep: 0.5 } },
          reflect: '返信は投稿者より、次に読む人に向けて書く' },
        { id: 'inspect', label: '院内で事実を調べ、流れを見直す', note: '費用なし。受付と看護の時間を使う。原因が分かれば直せる',
          fx: { slack: -1, delayed: [{ days: 14, label: '受付の流れを直した', fx: { rep: 0.8 } }], next: { id: 'PT-05b', days: 10 } },
          when: [{ if: (c) => c.waitAvg >= 40, fx: { rep: 0.3 }, why: '待ちの長さが背景だと分かり、直す先が絞れた' }],
          reflect: '投稿を材料にした。返事より直す方が残る' },
        { id: 'ignore', label: '反応しない', note: '新患×0.95が60日。1件なら埋もれる。続けば流れになる',
          fx: { newMul: { mul: 0.95, days: 60, label: '低い評価が残る' } },
          chance: { p: (c) => (c.rep < 60 ? 0.5 : 0.3), label: '同調する投稿が続く', hit: { rep: -1.5, aw: -0.01 }, miss: {} },
          reflect: '静観は1件目までの手。2件目からは流れになる' }
      ],
      lesson: '口コミは相手への返事より、次に来る人への態度が読まれる', point: '低評価への初動。返信・調査・静観'
    },
    {
      id: 'PT-05b', cat: 5, title: '名指しで書かれた職員が落ち込んでいる', tier: 2, spec: ['any'], who: 'staff', chainOnly: true, cool: 999,
      say: '投稿に書かれたのはたぶん私です。あの日は一人で受付を回していました。辞めた方がいいのでしょうか。',
      bg: (c) => `投稿から10日。当日は受付1人で電話と会計が重なっていた。職員の余力は${c.slack}。`,
      ask: '職員をどう守り、どう直すか',
      choices: [
        { id: 'protect', label: '体制の問題として応援を決める', note: '費用なし。混雑時に看護が受付を手伝う。看護の手は減る',
          fx: { slack: 1, flag: 'pt_front_backup', next: { id: 'PT-05c', days: 20 } },
          when: [{ if: (c) => c.staff.nurses <= 1, fx: { slack: -1 }, why: '看護師1人では受付の応援に回れず、決めても実行できない' }],
          reflect: '人ではなく体制に原因を置いた。実行できる人数かは別' },
        { id: 'train', label: '接遇の研修を受けさせる', note: '¥40,000。本人は「自分が悪い」と受け取ることもある',
          req: { money: 40000 },
          fx: { money: -40000, rep: 0.5, next: { id: 'PT-05c', days: 20 } },
          chance: { p: 0.35, label: '本人が「責められた」と感じる', hit: { slack: -1 }, miss: { slack: 1 } },
          reflect: '研修は技術を足す。受け取り方までは設計できない' },
        { id: 'talk', label: '話を聞き、対応は変えない', note: '費用なし。本人は少し楽になる。混雑の日はまた起きる',
          fx: { slack: 1 },
          chance: { p: 0.4, label: '同じ日の混雑で同じ苦情', hit: { rep: -0.8 }, miss: {} },
          reflect: '気持ちは受け止めた。仕組みは同じままだった' }
      ],
      lesson: '苦情は人に付くが、原因は体制に付いていることが多い', point: '名指しの苦情と職員の保護'
    },
    {
      id: 'PT-05c', cat: 5, title: '良い評価をどう増やすか', tier: 2, spec: ['any'], who: 'advisor', chainOnly: true, cool: 999,
      say: '評価が下がったままです。良い声は来ているのに投稿されません。投稿を頼む仕組みを作りますか。',
      bg: (c) => `評判${Math.round(c.rep)}。感謝の言葉は受付に届くが、口コミには出ない。謝礼付きの依頼は院として選ばない。`,
      ask: '良い口コミを増やすか、増やさないか',
      choices: [
        { id: 'card', label: '会計時に投稿のお願いカードを渡す', note: '¥15,000。謝礼なし。投稿は少し増える。頼まれて嫌な人もいる',
          req: { money: 15000 },
          fx: { money: -15000, aw: 0.01 },
          chance: { p: (c) => (c.rep >= 65 ? 0.55 : 0.35), label: '良い投稿が増える', hit: { rep: 1.2 }, miss: { rep: -0.2 } },
          reflect: '頼めば増えるが、頼まれた側の気持ちも評価に出る' },
        { id: 'quality', label: '頼まず、待ちと説明を直して待つ', note: '費用なし。効果は遅い。評判は診療の実力で戻る',
          fx: { delayed: [{ days: 30, label: '良い口コミが自然に付く', fx: { rep: 0.8 } }] },
          when: [{ if: (c) => !!c.flags.pt_front_backup, fx: { rep: 0.5 }, why: '混雑時の応援を決めていたので、受付の評価が戻り始めた' }],
          reflect: '遅いが、戻った評価は自分たちの実力の分だけ残る' },
        { id: 'reply_all', label: '全ての口コミに返信を続ける', note: '費用なし。院長か受付の時間を毎日使う。読んだ人の印象は良い',
          fx: { slack: -1, rep: 0.6, aw: 0.01 },
          reflect: '毎日の手間で印象を買った。続けられる人数かを見る' }
      ],
      lesson: '評価は頼んで増やすより、直して増える方が長く残る', point: '評価の回復。依頼・実力・返信'
    },
    {
      id: 'PT-06', cat: 5, title: '会計で多く請求していたことが分かった', tier: 1, spec: ['any'], who: 'billing', cool: 90,
      cond: (c) => c.patients7 >= 10,
      say: '先週の会計で、数人に多く請求していたことが分かりました。差額は1人数百円です。',
      bg: (c) => `原因は入力の取り違え。対象は6人(架空)。連絡先は分かる。本人からの指摘はまだ無い。`,
      ask: '間違いをどう扱うか',
      choices: [
        { id: 'call', label: '全員に連絡して返金する', note: '差額と電話の手間。信頼は守れる。「間違いがあった」も伝わる',
          fx: { money: -3000, slack: -1, trust: 1, rep: 0.5 },
          reflect: '先に言った。間違いより、隠さなかったことが残る' },
        { id: 'next', label: '次回来院時に精算する', note: '費用なし。来ない人の分は残る。先に気づかれると印象が悪い',
          fx: {},
          chance: { p: 0.3, label: '患者側が先に気づく', hit: { rep: -1.5, trust: -1 }, miss: {} },
          reflect: '手間は省けた。気づかれるかどうかに賭けた形になった' },
        { id: 'system', label: '返金し、入力の二重確認を入れる', note: '差額の返金と、毎日の点検に医事の時間。再発は減る',
          fx: { money: -3000, slack: -1, trust: 1, dailyCost: { yen: 1000, days: 30, label: '会計の二重確認' }, flag: 'pt_bill_check' },
          when: [{ if: (c) => c.staff.receptionists >= 2, fx: { slack: 1 }, why: '受付が2人いるので、点検を分けて持てた' }],
          reflect: '返金と再発防止を分けて払った。点検は人数が要る' }
      ],
      lesson: '自分たちの間違いは、見つけた側が先に言うほど安く済む', point: '会計ミスの開示。返金・時期・再発防止'
    },
    {
      id: 'PT-07', cat: 5, title: '「家族です」と病名を電話で聞かれた', tier: 1, spec: ['any'], who: 'front', cool: 90,
      say: '「家族だ」という方から電話で、ある患者さんが通院しているか、病名は何かと聞かれました。',
      bg: (c) => `受付は答えずに保留した。本人確認の手順は決まっていない。同じような電話は月に数回ある。`,
      ask: '院外からの問い合わせへの答え方',
      choices: [
        { id: 'rule', label: '本人の同意なしには答えない手順', note: '費用なし。相手が怒ることもある。院は守れる',
          fx: { flag: 'pt_privacy_rule', trust: 1, slack: 1 },
          chance: { p: 0.25, label: '相手から「冷たい」と苦情', hit: { rep: -0.5 }, miss: {} },
          reflect: '手順にした。断る言葉を受付に持たせるのが次の仕事' },
        { id: 'confirm', label: '本人に連絡し意向を確かめて返す', note: '費用なし。受付の手間が毎回かかる。本人の意思が通る',
          fx: { slack: -1, trust: 1, rep: 0.3 },
          reflect: '本人の意思を通した。手間はその都度かかる' },
        { id: 'judge', label: '受付がその場で判断する', note: '費用なし。早い。判断を誤れば信頼を一度に失う',
          fx: {},
          chance: { p: 0.3, label: '誤って伝わり、本人から抗議', hit: { rep: -2, trust: -2 }, miss: {} },
          reflect: '早さを取った。外れたときの損は取り返せない' }
      ],
      lesson: '個人情報の扉は、開ける側ではなく本人が持つ。手順で守る', point: '個人情報の照会。手順・確認・裁量'
    },
    {
      id: 'PT-08', cat: 5, title: '家族が他院の意見も聞きたいと言う', tier: 2, spec: ['any'], who: 'family', cool: 90,
      cond: (c) => c.patients7 >= 12,
      say: '父の治療について、別の病院の意見も聞きたいと思っています。先生に失礼にならないでしょうか。',
      bg: (c) => `長く通う患者の家族から。本人は「今の先生でいい」と言う。市民総合病院との関係はLv${c.relations.hospital || 0}。`,
      ask: '他院の意見を求める家族への対応',
      choices: [
        { id: 'support', label: '資料を整えて紹介状を書く', note: '院長の時間を使う。家族は納得する。戻らない可能性もある',
          fx: { examDelta: { d: 0.3, days: 7, label: '紹介状の準備' }, trust: 1, rel: { hospital: 1 } },
          chance: { p: (c) => (c.rep >= 65 ? 0.25 : 0.4), label: '患者が他院に移る', hit: { rep: -0.3 }, miss: { rep: 0.8 } },
          reflect: '出口を開けた。戻る人は信頼して戻る' },
        { id: 'listen', label: '不安の中身を先に聞く時間を取る', note: '費用なし。診察1人あたり+0.5分が7日。行く前に解けることも',
          fx: { examDelta: { d: 0.5, days: 7, label: '家族の話を聞く' }, rep: 0.5 },
          chance: { p: 0.5, label: '話を聞くだけで不安が解ける', hit: { trust: 1 }, miss: {} },
          reflect: '不安の正体を聞いた。解けない分は他院の意見で解ける' },
        { id: 'patient', label: '本人の意向を優先し、家族には控える', note: '費用なし。本人の意思は守る。家族との溝は残る',
          fx: {},
          when: [{ if: (c) => c.trust <= 0, fx: { rep: -0.5 }, why: '地域の信頼が薄い時期は、家族の不満が外に出やすい' }],
          chance: { p: 0.3, label: '家族が他院に直接連れて行く', hit: { rep: -0.8, trust: -0.5 }, miss: {} },
          reflect: '本人を守った。家族は判断の外に置かれたと感じる' }
      ],
      lesson: '他院の意見を求める声は、離れる前の合図。閉じるほど離れる', point: 'セカンドオピニオン。支援・傾聴・本人優先'
    },
    {
      id: 'PT-09', cat: 5, title: '一人で来る高齢の方が予約日を間違える', tier: 2, spec: ['any'], who: 'nurse', cool: 120,
      say: '一人で来る高齢の方が、予約日を間違えたり、会計の後に待合で動けなくなることが増えました。',
      bg: (c) => `ご本人は一人暮らし。家族は遠方(架空)。ケアマネジャーが付いているかは未確認。看護師${c.staff.nurses}人。`,
      ask: '一人で来る認知症の方への対応',
      choices: [
        { id: 'family', label: '家族に連絡し、付き添いを頼む', note: '費用なし。家族が来られない日もある。次の相談につながる',
          fx: { trust: 0.5, next: { id: 'PT-09b', days: 14 } },
          chance: { p: 0.4, label: '家族が付き添えない', hit: { slack: -1 }, miss: {} },
          reflect: '家族に返した。来られない日の対応は院に残る' },
        { id: 'caremane', label: 'ケアマネジャーに連絡し支援を組む', note: '費用なし。看護師が連絡に時間を使う。地域の関係が育つ',
          fx: { slack: -1, trust: 1, rel: { caremane: 1 }, next: { id: 'PT-09b', days: 14 } },
          when: [{ if: (c) => (c.relations.caremane || 0) >= 1, fx: { slack: 1 }, why: 'ケアマネ事業所と付き合いがあり、話が早く通った' }],
          reflect: '地域につないだ。関係があるほど手間は小さい' },
        { id: 'watch', label: '受付と看護で来院時に見守る', note: '費用なし。毎回の見守りで手が取られる。仕組みにはならない',
          fx: { slack: -1, rep: 0.3 },
          chance: { p: 0.3, label: '待合で転びかける', hit: { rep: -1, slack: -1 }, miss: {} },
          reflect: '院で抱えた。人の目は毎回要り、限界も早い' }
      ],
      lesson: '一人で来られなくなる前に、誰と組むかを決める', point: '認知症の方の通院支援'
    },
    {
      id: 'PT-09b', cat: 5, title: '院で送迎はできないかと家族から', tier: 2, spec: ['any'], who: 'family', chainOnly: true, cool: 999,
      say: '母を毎回連れて来るのが難しくなりました。院で送迎はできませんか。近所の方も同じだと言っています。',
      bg: (c) => `前回の相談から14日。付き添いで通院は続いている。送迎は車・運転手・保険と、費用も責任も院が持つ。`,
      ask: '送迎の要望への答え',
      choices: [
        { id: 'shuttle', label: '週2回の送迎を始める', note: '車と運転を委託し¥8,000/日が続く。高齢の新患は増える。事故の責任も院に',
          req: { money: 100000 },
          fx: { dailyCost: { yen: 8000, days: null, label: '送迎の委託' }, newMul: { mul: 1.05, days: 60, label: '送迎で通いやすい' }, rep: 1 },
          when: [{ if: (c) => c.load >= 0.85, fx: { rep: -0.5 }, why: '混んでいる時期に増やすと、待ちが延びて不満も一緒に増える' }],
          chance: { p: 0.15, label: '送迎中の小さな事故', hit: { money: -200000, rep: -1 }, miss: {} },
          reflect: '通いやすさを買った。固定費と責任も一緒に買った' },
        { id: 'info', label: '外部の移動手段を案内し予約を固定', note: '費用なし。院の負担は小さい。来られない日は増える',
          fx: { rep: 0.3, trust: 0.3 },
          reflect: '院の外の手段につないだ。できる範囲を示す答え' },
        { id: 'homecare', label: '在宅部門の訪問診療に切り替える', note: '在宅部門があるときだけ。外来から訪問へ。移動は院側が持つ',
          req: { depts: ['homecare'] },
          fx: { trust: 1, rep: 0.5, slack: -1 },
          reflect: '診療の形を変えた。部門があるからできる答え' }
      ],
      lesson: '送迎は患者の便利より先に、事故と費用の責任を誰が持つかを決める', point: '送迎の要望。自前・案内・訪問'
    },
    {
      id: 'PT-10', cat: 5, title: '薬が変わった理由を患者が知らない', tier: 1, spec: ['any'], who: 'pharmacy', cool: 90,
      cond: (c) => c.patients7 >= 10,
      say: '薬が変わった理由を患者さんが知らないまま来られます。薬局で聞かれても、私たちには答えられません。',
      bg: (c) => `診察1人あたり${c.examMean}分。薬の変更は診察の最後に短く伝えている。門前薬局との関係はLv${c.relations.pharmacy || 0}。`,
      ask: '薬の説明をどこで担うか',
      choices: [
        { id: 'doctor', label: '診察で変更の理由を一言添える', note: '費用なし。診察1人あたり+0.3分が30日。説明は診療の一部',
          fx: { examDelta: { d: 0.3, days: 30, label: '薬の説明' }, rep: 0.5 },
          when: [{ if: (c) => c.load >= 0.85, fx: { rep: -0.3 }, why: '混んでいる時期は、診察が延びた分だけ待ちの不満が出た' }],
          reflect: '診察の時間で払った。混雑期は別の不満に変わる' },
        { id: 'share', label: '変更理由を薬局に共有する紙を作る', note: '費用なし。医事が1日10分。薬局が説明を補える',
          fx: { slack: -1, rel: { pharmacy: 1 }, rep: 0.3 },
          reflect: '薬局と分担した。医事の手間で関係を買った' },
        { id: 'leave', label: '薬局の説明に任せる', note: '費用なし。余力−1。薬局は理由を知らないまま説明する。誤解が残る',
          fx: { slack: -1 },
          chance: { p: 0.35, label: '薬を飲まない患者が出て、症状が戻る', hit: { rep: -1, trust: -0.5 }, miss: {} },
          reflect: '任せたつもりが、誰も担っていなかった' }
      ],
      lesson: '説明はどこかで誰かがしている。担い手を決めないと患者が埋める', point: '服薬説明の分担。診察・共有・薬局'
    },
    {
      id: 'PT-11', cat: 5, title: '日本語が難しい患者が増えてきた', tier: 2, spec: ['any'], who: 'front', cool: 120,
      cond: (c) => c.newp7 >= 5,
      say: '日本語が難しい患者さんが増えています。問診も会計も時間がかかり、伝わったか不安です。',
      bg: (c) => `新患1日${c.newp7}人のうち、月に数人が外国語話者(架空)。受付は身振りと個人の翻訳アプリで対応中。`,
      ask: '言葉の壁への備え',
      choices: [
        { id: 'device', label: '翻訳端末を受付と診察室に置く', note: '¥60,000。医療の言葉は誤訳もある。日常の案内は通る',
          req: { money: 60000 },
          fx: { money: -60000, slack: 1, rep: 0.3 },
          reflect: '道具で日常の壁を下げた。医療の説明は別の手が要る' },
        { id: 'phone', label: '電話通訳サービスを契約する', note: '¥1,500/日がずっと続く。使う日は少ないが、診察の会話が通る',
          fx: { dailyCost: { yen: 1500, days: null, label: '電話通訳' }, rep: 0.5, trust: 0.5 },
          when: [{ if: (c) => c.newp7 >= 10, fx: { aw: 0.02 }, why: '新患が多い地域では、対応できる院として名前が広がった' }],
          reflect: '使わない日も払う。安全を固定費で買った' },
        { id: 'sheet', label: '多言語の問診票と案内を用意する', note: '¥20,000。作るのに14日。問診は通る。会話は通らない',
          req: { money: 20000 },
          fx: { money: -20000, delayed: [{ days: 14, label: '多言語の問診票ができる', fx: { slack: 1, rep: 0.5 } }] },
          reflect: '書式で入口を整えた。診察室の会話は残る' },
        { id: 'asis', label: '今のまま身振りで対応する', note: '費用なし。時間は毎回かかる。伝わらないと安全にも触れる',
          fx: { slack: -1 },
          chance: { p: 0.3, label: '服薬の説明が伝わらず体調を崩す', hit: { rep: -1.5, trust: -1 }, miss: {} },
          reflect: '費用を払わなかった分を、時間と危うさで払った' }
      ],
      lesson: '言葉の費用は、払わないと時間と安全で払う', point: '言葉の壁。端末・通訳・書式'
    },
    {
      id: 'PT-12', cat: 5, title: '感謝の手紙と菓子折りが届いた', tier: 1, spec: ['any'], who: 'nurse', cool: 90,
      cond: (c) => c.rep >= 58,
      say: '退院された方から、手紙と菓子折りが届きました。受け取ってよいのか、職員にどう見せるか迷います。',
      bg: (c) => `評判${Math.round(c.rep)}。贈り物の扱いは決まっていない。職員は忙しさの中で、感謝の声を直接聞く機会が少ない。`,
      ask: '感謝の受け止め方',
      choices: [
        { id: 'share', label: '手紙を職員に共有し菓子は皆で', note: '費用なし。余力が戻る。「受け取る院」になる',
          fx: { slack: 1 },
          chance: { p: 0.2, label: '別の患者から高価な贈り物が届く', hit: { rep: -0.3 }, miss: {} },
          reflect: '声を職員に届けた。受け取る基準は後で要る' },
        { id: 'policy', label: '贈り物は受け取らない方針にする', note: '費用なし。手紙は共有する。相手を傷つけない言葉が要る',
          fx: { flag: 'pt_no_gift', slack: 1, trust: 0.5 },
          chance: { p: 0.25, label: '断り方が硬く、相手ががっかりする', hit: { rep: -0.5 }, miss: {} },
          reflect: '線を引いた。引き方の言葉まで決めると生きる' },
        { id: 'private', label: '院長が個人で返事を書き職員には伏せる', note: '費用なし。相手には丁寧。職員には届かない',
          fx: { examDelta: { d: 0.2, days: 3, label: '返事を書く' }, rep: 0.3 },
          when: [{ if: (c) => c.slack <= -1, fx: { slack: -1 }, why: '余力の無い職員は、良い声が届かないと消耗が続く' }],
          reflect: '相手には届いた。職員に届かなかった分は資源にならない' }
      ],
      lesson: '感謝は職員に届けたときに資源になる。届け方は決めておく', point: '感謝の共有と贈り物の方針'
    },
    {
      id: 'PT-13', cat: 5, title: '一人で20分話す患者と待つ人', tier: 2, spec: ['any'], who: 'doctor', cool: 90,
      cond: (c) => c.load >= 0.6,
      say: '一人で20分近く話される方がいる。話は大事だが、その間に待合で帰る人が出ている。',
      bg: (c) => `診察1人あたり平均${c.examMean}分。待てずに帰る人が1日${c.balked7}人。長く話す方は数人で、皆常連。`,
      ask: '長い診察と待つ人の折り合い',
      choices: [
        { id: 'slot', label: '相談は別の予約枠に分ける', note: '費用なし。混雑時は短く、別枠で長く。常連は少し寂しい',
          fx: { examDelta: { d: -0.4, days: 30, label: '相談枠を分けた' }, rep: 0.3 },
          chance: { p: 0.3, label: '「話を聞いてくれなくなった」の声', hit: { rep: -0.7 }, miss: {} },
          reflect: '時間の置き場所を変えた。減らしたわけではないと伝える' },
        { id: 'nurse', label: '看護師が先に話を聞いて整理する', note: '費用なし。看護師の手が取られる。診察は短くなり患者も満足',
          fx: { slack: -1, examDelta: { d: -0.3, days: 30, label: '看護師の事前聞き取り' }, rep: 0.5 },
          when: [{ if: (c) => c.staff.nurses <= 1, fx: { slack: -1 }, why: '看護師1人だと、聞き取りの間は処置が止まる' }],
          reflect: '聞く役を分けた。人数が薄いと処置が止まる' },
        { id: 'asis', label: '今のまま話を聞き続ける', note: '新患×0.95が30日。その方の満足は守る。待つ人は増え、帰る人も出る',
          fx: { rep: 0.2, newMul: { mul: 0.95, days: 30, label: '待つ人が帰る' } },
          chance: { p: (c) => (c.balked7 >= 1 ? 0.5 : 0.25), label: '待てずに帰る人が増える', hit: { rep: -1, newMul: { mul: 0.97, days: 14, label: '待てず帰る' } }, miss: {} },
          reflect: '目の前の人を選んだ。待合の人は黙って帰る' }
      ],
      lesson: '一人の満足と皆の時間は同じ財布から出る。分け方を決める', point: '診察時間の配分。別枠・事前聞き取り・現状'
    },
    {
      id: 'PT-14', cat: 5, title: '患者アンケートをやるか、誰が動かすか', tier: 3, spec: ['any'], who: 'advisor', cool: 150,
      cond: (c) => c.day >= 45,
      say: '患者さんの声を数字で見たことがありません。やるなら、結果を誰が動かすかまで決めたいです。',
      bg: (c) => `評判${Math.round(c.rep)}、平均待ち${Math.round(c.waitAvg)}分。感想は受付に断片で届く。集計と改善の担当は空いている。`,
      ask: 'アンケートをやるか、どう使うか',
      choices: [
        { id: 'paper', label: '紙で1か月、受付が集計する', note: '¥15,000。受付の手が毎日取られる。厳しい声も来る',
          req: { money: 15000 },
          fx: { money: -15000, slack: -1, flag: 'pt_survey', delayed: [{ days: 30, label: '集計結果を院内で共有', fx: { rep: 0.8, slack: 1 } }] },
          chance: { p: (c) => (c.rep < 60 ? 0.5 : 0.25), label: '厳しい声が多く職員が落ち込む', hit: { slack: -1 }, miss: {} },
          reflect: '声を数字にした。数字を受け止める支えも要った' },
        { id: 'web', label: '二次元コードで集め、月1回見る', note: '¥40,000。手間は少ない。回答は少なめ。高齢の方は答えにくい',
          req: { money: 40000 },
          fx: { money: -40000, flag: 'pt_survey', delayed: [{ days: 30, label: '回答をもとに1つ直す', fx: { rep: 0.5 } }] },
          when: [{ if: (c) => c.patients7 >= 30, fx: { rep: 0.3 }, why: '患者数が多いので、回答数が集まり傾向が読めた' }],
          reflect: '手間を抑えた。答える人が偏ることは知っておく' },
        { id: 'none', label: 'やらず、受付の聞き取りで代える', note: '費用なし。声は届くが偏る。数字は残らない',
          fx: { slack: 1 },
          chance: { p: 0.3, label: '気づかない不満が口コミに出る', hit: { rep: -1 }, miss: {} },
          reflect: '受付の耳に頼った。聞こえない声は見えないまま' }
      ],
      lesson: '聞くだけで良くはならない。動かす人と期限を先に決める', point: '患者の声の集め方と使い方'
    },
    {
      id: 'PT-15', cat: 5, title: '本院と分院で対応が違うと言われた', tier: 3, spec: ['any'], who: 'branch', needs: { branches: 1 }, cool: 120,
      say: '本院と分院の両方に通う方から「予約の取り方も、待ち時間の案内も違う」と言われました。',
      bg: (c) => `分院${c.branches}か所。予約の締切や電話の受け方が院ごとに違う。職員は「うちの流儀」に慣れている。`,
      ask: '拠点間の対応差をどう扱うか',
      choices: [
        { id: 'unify', label: '本院の手順に全て合わせる', note: '費用なし。分院の職員は覚え直し。60日は余力が下がる',
          fx: { slack: -1, flag: 'pt_unified_rules', delayed: [{ days: 60, label: '手順が揃い、案内が楽になる', fx: { slack: 1, rep: 0.8 } }] },
          when: [{ if: (c) => c.slack <= -1, fx: { rep: -0.5 }, why: '余力が無い時期の覚え直しで、現場の対応が一時的に荒れた' }],
          reflect: '裏まで揃えた。慣れるまでの期間は現場が払う' },
        { id: 'common', label: '患者に見える部分だけ揃える', note: '¥50,000で共通の案内を作る。裏の手順は各院に任せる',
          req: { money: 50000 },
          fx: { money: -50000, rep: 0.5, trust: 0.3 },
          reflect: '見える部分だけ揃えた。裏の違いはいつか表に出る' },
        { id: 'leave', label: '院ごとの違いは残す', note: '手戻りが¥600/日で60日。職員は楽。両方に通う患者には分かりにくいまま',
          fx: { slack: 1, dailyCost: { yen: 600, days: 60, label: '取り違えの手戻り' } },
          chance: { p: 0.3, label: '違いから予約の取り違えが起きる', hit: { rep: -1, trust: -0.5 }, miss: {} },
          reflect: '現場の楽を取った。患者は法人として見ている' }
      ],
      lesson: '拠点が増えると、患者は院ではなく法人を見る。揃える範囲を選ぶ', point: '拠点間の対応の統一範囲'
    },
    {
      id: 'PT-16', cat: 5, title: '夜に電話がつながらないと在宅の家族から', tier: 3, spec: ['any'], who: 'homecare', needs: { depts: ['homecare'] }, cool: 120,
      say: '在宅の患者さんの家族から「夜に電話がつながらない」と言われました。夜間の窓口は決めていません。',
      bg: (c) => `在宅部門あり。夜間の連絡は今は担当者の携帯で、出られない日がある。訪問看護との連携はまだ浅い。`,
      ask: '夜間の連絡をどう受けるか',
      choices: [
        { id: 'oncall', label: '当番制で夜間の電話を受ける', note: '当番手当¥3,000/日が続く。職員の休みが削れる。家族は安心する',
          fx: { dailyCost: { yen: 3000, days: null, label: '夜間当番の手当' }, slack: -1, trust: 1, rep: 0.5 },
          when: [{ if: (c) => c.staff.nurses >= 2, fx: { slack: 1 }, why: '看護師が複数いるので、当番を回しても休みが守れた' }],
          reflect: '院で受けた。人数が薄いと当番は同じ人に寄る' },
        { id: 'partner', label: '訪問看護に夜間の一次対応を頼む', note: '費用なし。相手の負担が増える。関係が浅いと断られる',
          fx: { trust: 0.5 },
          chance: { p: (c) => (c.trust >= 1 ? 0.7 : 0.4), label: '訪問看護が引き受ける', hit: { rep: 0.5, slack: 1 }, miss: { rep: -0.5 } },
          reflect: '連携で受けた。頼める関係かどうかが結果を決めた' },
        { id: 'explain', label: '受けない範囲を説明し連絡先を渡す', note: '費用なし。正直だが、期待していた家族は離れる',
          fx: { trust: -0.5 },
          chance: { p: 0.35, label: '家族が他の在宅診療に移る', hit: { rep: -1, newMul: { mul: 0.97, days: 30, label: '在宅の評判' } }, miss: {} },
          reflect: '線を引いた。引く前に伝えていれば違った' }
      ],
      lesson: '在宅は昼の診療より、夜に誰が出るかで信頼が決まる', point: '在宅の夜間対応。当番・連携・線引き'
    },
    {
      id: 'PT-17', cat: 5, title: '透析の曜日を変えたい要望が重なる', tier: 3, spec: ['any'], who: 'dialysis', needs: { depts: ['dialysis'] }, cool: 120,
      say: '透析の患者さんから、法事や旅行で曜日を変えたい要望が重なります。ベッドの空きは限られています。',
      bg: (c) => `透析部門あり。振替の依頼は月に数件から十数件へ(架空)。空きが無いと断るか、他の患者をずらすかになる。`,
      ask: '振替要望への受け方',
      choices: [
        { id: 'spare', label: '振替用に1枠を空けておく', note: '空けた枠の収入が毎日減る(¥6,000/日)。希望には応えられる',
          fx: { dailyCost: { yen: 6000, days: null, label: '透析の予備枠' }, rep: 1, trust: 0.5 },
          when: [{ if: (c) => c.load < 0.6, fx: { rep: 0.3 }, why: '混んでいない時期は空き枠の損が小さく、評判の効果だけが残った' }],
          reflect: '融通を固定費で買った。空きの費用は毎日出る' },
        { id: 'rule', label: '月1回までなど振替の上限を決める', note: '費用なし。公平だが、事情のある方には冷たく映る',
          fx: { slack: 1, rep: -0.3 },
          chance: { p: 0.25, label: '上限を超える事情で揉める', hit: { rep: -0.8 }, miss: {} },
          reflect: '上限で守った。例外の決め方まで決めると揉めない' },
        { id: 'adjust', label: '都度、他の患者と調整して対応する', note: '費用なし。技士と看護の手が毎回取られる。動かされた側の不満も',
          fx: { slack: -1, rep: 0.3 },
          chance: { p: 0.35, label: 'ずらされた患者から苦情', hit: { rep: -0.7, trust: -0.5 }, miss: {} },
          reflect: '都度の調整で応えた。動かされた人の分を忘れやすい' }
      ],
      lesson: '固定の枠を持つ診療は、空きの費用と融通の価値を天秤にかける', point: '透析の振替。予備枠・上限・都度調整'
    },
    {
      id: 'PT-18', cat: 5, title: '点眼が続かない高齢患者への対応', tier: 2, spec: ['ophthalmology'], who: 'caremane', cool: 150,
      say: '担当のお宅、点眼を忘れがちです。緑内障の管理、大丈夫でしょうか。',
      bg: (c) => `独居の高齢患者。点眼の自己管理が難しい。ケアマネジャーとの関係 Lv${c.relations.caremane || 0}。1日平均${c.patients7}人。`,
      ask: '点眼継続の支援策',
      facts: (c) => [{ label: 'ケアマネジャーとの関係', val: `Lv${c.relations.caremane || 0}` }],
      choices: [
        { id: 'aid', label: '点眼補助具と点眼表を渡す', note: '¥2,000の道具代。渡すだけでは続かないことがある',
          req: { money: 2000 },
          fx: { money: -2000, flag: 'pt_dropaid' },
          chance: { p: 0.5, label: '点眼が続くようになる', hit: { trust: 1 }, miss: {} },
          reflect: '道具を渡した。続くかどうかは日々の習慣が決める' },
        { id: 'ask', label: 'ケアマネジャー経由で訪問介護に声かけを頼む', note: '費用なし。余力−1。関係+1。訪問介護の対応力に左右される',
          fx: { slack: -1, rel: { caremane: 1 } },
          when: [{ if: (c) => (c.relations.caremane || 0) >= 1, fx: { trust: 1 }, why: '関係が育っていると、声かけの依頼がすぐ通った' }],
          reflect: '院外の力を借りた。頼れる関係を先に作っていたか' },
        { id: 'wait', label: '次回受診まで様子を見る', note: '費用なし。余力−1。緑内障が進む可能性は残る',
          fx: { slack: -1 },
          chance: { p: 0.35, label: '緑内障が進行し、家族から相談が来る', hit: { trust: -1, rep: -0.5 }, miss: {} },
          reflect: '様子を見た。進む病気は、見ている間も進む' }
      ],
      lesson: '点眼が続くかは、本人の意思でなく、誰が見ているかで決まる', point: '点眼の継続支援'
    }
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = CASES;
  else root.DECISIONS.register(CASES);
})(typeof self !== 'undefined' ? self : this);
