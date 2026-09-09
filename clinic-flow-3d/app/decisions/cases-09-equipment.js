/* 経営の分岐点 — 分類9: 設備・物品・IT・データ活用 */
(function (root) {
  'use strict';
  const yen = (n) => '¥' + Math.round(n).toLocaleString('ja-JP');
  const CASES = [
    {
      id: 'EQ-01', cat: 9, title: '電子カルテのサポート終了が近い', tier: 2, spec: ['any'], who: 'vendor', cool: 365, once: true,
      cond: (c) => c.day >= 25,
      say: '今お使いの電子カルテは、半年後にサポートが終わります。更新か、延長保守か、ご検討ください。',
      bg: (c) => `更新は¥600,000の一時費用。延長保守は¥2,000/日で1年。何もしなければ障害時の復旧が自費になる。資金 ${yen(c.money)}。`,
      ask: '電子カルテの扱い',
      facts: (c) => [{ label: '資金', val: yen(c.money) }, { label: '手元で持てる日数', val: `${c.runway}日` }],
      choices: [
        { id: 'renew', label: '更新する', note: '¥600,000。切替の14日は現場が慣れず遅い。その後は入力が速い',
          req: { money: 600000 },
          fx: { money: -600000, examDelta: { d: 0.8, days: 14, label: 'カルテ切替' }, slack: -1, delayed: [{ days: 14, label: '新カルテに慣れる', fx: { slack: 2, examDelta: { d: -0.3, days: 365, label: '入力が速い' } } }] },
          reflect: '大きな一時費用と導入負担を先に払い、日々の速さを得た' },
        { id: 'extend', label: '延長保守で1年もたせる', note: '¥2,000/日が365日。更新は先送り。1年後に同じ判断が来る',
          fx: { dailyCost: { yen: 2000, days: 365, label: '電子カルテ延長保守' }, flag: 'eq_ehr_extended' },
          reflect: '時間を買った。合計¥730,000は更新費を超える' },
        { id: 'asis', label: 'そのまま使い続ける', note: '応急対応が¥800/日で90日。障害が起きれば復旧費と診療停止',
          fx: { dailyCost: { yen: 800, days: 90, label: '延命の応急対応' } },
          chance: { p: 0.35, label: 'サポート終了後に障害が起きる', hit: { money: -150000, newMul: { mul: 0.7, days: 3, label: 'カルテ障害' }, slack: -1, rep: -1 }, miss: {} },
          reflect: '何もしない選択は、確率で費用を払う選択' }
      ],
      lesson: '一時費用・継続費・確率の費用。3つを同じ単位に直して比べる', point: 'IT更新の時期と費用の形'
    },
    {
      id: 'EQ-02', cat: 9, title: '未収金が積み上がっている', tier: 1, spec: ['any'], who: 'billing', cool: 90,
      cond: (c) => c.day >= 15 && c.patients7 >= 10,
      say: 'レセコンの集計で、窓口の未収金が見える形になりました。少額ですが件数が増えています。',
      bg: (c) => `未収金はおよそ ${yen(Math.round(c.patients7 * 900))}。1日平均${c.patients7}人。回収の担当は決まっていない。`,
      ask: '未収金への向き合い方',
      choices: [
        { id: 'system', label: '督促の手順を作る', note: '¥20,000で通知の様式。30日後に大半が回収できる見込み',
          req: { money: 20000 },
          fx: (c) => ({ money: -20000, delayed: [{ days: 30, label: '未収金の回収', fx: { money: Math.round(c.patients7 * 700) } }] }),
          reflect: '仕組みで回収した。件数が増える前に手を打った' },
        { id: 'window', label: '窓口で当日回収を徹底する', note: '費用なし。受付の負担が増える。新しい未収は減る',
          fx: (c) => ({ slack: -1, delayed: [{ days: 14, label: '当日回収が定着', fx: { money: Math.round(c.patients7 * 400), slack: 1 } }] }),
          reflect: '人の対応で減らした。過去の分は残る' },
        { id: 'ignore', label: '少額なので放置する', note: '未収が¥600/日で90日積み上がる。回収できないまま増える',
          fx: { dailyCost: { yen: 600, days: 90, label: '積み上がる未収金' } },
          chance: { p: 0.5, label: '半年後に回収不能が確定', hit: { delayed: [{ days: 60, label: '未収金の一部が回収不能', fx: (c) => ({ money: -Math.round(c.patients7 * 600) }) }] }, miss: {} },
          reflect: 'データが見えたのに動かなかった。見える化の価値は動くこと' }
      ],
      lesson: 'データ活用は「見える」で終わらず、担当と手順を決めて初めて資金になる', point: 'データを行動に変える'
    },
    {
      id: 'EQ-03', cat: 9, title: '心電計が動かなくなった', tier: 1, spec: ['any'], who: 'nurse', cool: 180,
      cond: (c) => c.day >= 8,
      say: '心電計が今朝から動きません。修理か買い替えか。検査の予約は明日も入っています。',
      bg: (c) => `修理は¥80,000で7日。買い替えは¥350,000で3日後に届く。使って8年。1日平均${c.patients7}人。資金 ${yen(c.money)}。`,
      ask: '心電計の扱い',
      facts: (c) => [{ label: '資金', val: yen(c.money) }, { label: '手元で持てる日数', val: `${c.runway}日` }],
      choices: [
        { id: 'repair', label: '修理に出す', note: '¥80,000。7日間は検査を外に出す。古い機器なので再故障の可能性',
          req: { money: 80000 },
          fx: { money: -80000, rep: -0.5 },
          when: [{ if: (c) => c.patients7 >= 25, fx: { rep: -0.5 }, why: '患者が多いほど、検査を外に出す7日の影響が大きい' }],
          chance: { p: 0.4, label: '半年以内に再び故障する', hit: { delayed: [{ days: 90, label: '心電計が再故障、買い替え', fx: { money: -350000, slack: -1 } }] }, miss: {} },
          reflect: '安く直した。再故障の費用は確率で払う' },
        { id: 'buy', label: '買い替える', note: '¥350,000。3日で戻る。10年は安心。資金は減る',
          req: { money: 350000 },
          fx: { money: -350000 },
          when: [{ if: (c) => c.runway < 20, fx: { slack: -1 }, why: '手元資金が薄いときの大きな出費は、職員にも不安が伝わる' }],
          reflect: '大きく払って不確実さを消した。資金の厚みが判断を許した' },
        { id: 'outsource', label: '検査は病院に依頼し、機器は持たない', note: '費用なし。心電図のたびに紹介。病院との関係+1。検査の患者は離れる',
          fx: { rel: { hospital: 1 }, rep: -1, newMul: { mul: 0.95, days: 60, label: '検査を院内でできない' } },
          reflect: '持たない選択。紹介が増え、院内で完結する価値は落ちた' }
      ],
      lesson: '故障は「直すか買うか」だけでなく「持つか」の問い', point: '機器の修理・買い替え・持たない'
    },
    {
      id: 'EQ-04', cat: 9, title: '処置用の手袋が切れた', tier: 1, spec: ['any'], who: 'nurse', cool: 120,
      cond: (c) => c.day >= 6,
      say: '手袋が今朝切れました。門前薬局に借りて回しています。発注は誰の仕事でしたか。',
      bg: (c) => `消耗品の発注は「気づいた人」がしている。在庫の基準は無い。1日平均${c.patients7}人。職員の余力は${c.slack}。`,
      ask: '在庫切れを防ぐ仕組み',
      choices: [
        { id: 'owner', label: '担当と発注点を決める', note: '費用なし。決めるのに10日、余力−1。定着後は在庫切れが止まる。続きの相談が来る',
          fx: { slack: -1, flag: 'eq_stock_owner', delayed: [{ days: 10, label: '在庫の担当が定着する', fx: { slack: 2 } }], next: { id: 'EQ-04b', days: 10 } },
          when: [{ if: (c) => c.load >= 0.85, fx: { slack: -1 }, why: '混んでいる時期は、手順を作る時間が診療の後ろに追いやられる' }],
          reflect: '人と数字を決めた。仕組みは費用より時間で買う' },
        { id: 'bulk', label: 'まとめ買いで棚を厚くする', note: '¥80,000。当面は切れない。置き場所が要る。期限切れの廃棄が出ることも',
          req: { money: 80000 },
          fx: { money: -80000, slack: 1 },
          chance: { p: 0.3, label: '期限切れで一部を廃棄', hit: { money: -20000 }, miss: {} },
          reflect: '在庫で解決した。棚は安心を置く場所だが、金も眠る' },
        { id: 'adhoc', label: '気づいた人が買う今の形', note: '割高分が¥400/日で90日。また切れる。切れた日は処置が止まる',
          fx: { dailyCost: { yen: 400, days: 90, label: '割高な少量購入' } },
          chance: { p: (c) => (c.load >= 0.7 ? 0.6 : 0.35), label: 'また在庫切れ、処置が半日止まる', hit: { slack: -1, rep: -1 }, miss: {} },
          reflect: '担当が無い仕事は、忙しい日に必ず落ちる' }
      ],
      lesson: '在庫切れの原因は物ではなく担当の不在', point: '消耗品の在庫と担当'
    },
    {
      id: 'EQ-04b', cat: 9, title: '発注をアプリでやりたいと担当が言う', tier: 1, spec: ['any'], who: 'front', chainOnly: true, cool: 999,
      say: '在庫の担当になった受付からです。発注をスマホのアプリでまとめたい、月¥15,000ほどかかります、と。',
      bg: (c) => `担当を決めて10日。今は紙の台帳と電話・FAXで発注。受付${c.staff.receptionists}人。資金 ${yen(c.money)}。`,
      ask: '発注の道具',
      choices: [
        { id: 'app', label: 'アプリを入れる', note: '¥500/日。発注の手間が減る。担当の提案を採る',
          req: { money: 10000 },
          fx: { dailyCost: { yen: 500, days: null, label: '発注アプリ' }, slack: 1 },
          when: [{ if: (c) => c.staff.receptionists <= 1, fx: { slack: 1 }, why: '受付が1人だと、電話とFAXの往復が消える効果が大きい' }],
          reflect: '担当の提案に乗った。任せた人の道具は、任せた人が選ぶ' },
        { id: 'sheet', label: '表計算で自作する', note: '費用なし。作るのに担当の時間。更新が止まると紙に戻る',
          fx: { slack: -1, delayed: [{ days: 14, label: '発注表が回り始める', fx: { slack: 1 } }] },
          chance: { p: 0.35, label: '更新が止まり紙に戻る', hit: { slack: -1 }, miss: { slack: 1 } },
          reflect: '費用は無いが、続ける力に賭けた' },
        { id: 'no', label: '紙のままでいい', note: '費用なし。担当の提案を断る。やる気は下がる',
          fx: { slack: -1 },
          reflect: '断り方も判断。理由を伝えないと、次の提案は来ない' }
      ],
      lesson: '仕組みを任せたら、道具の選択も任せる範囲に入る', point: '発注の自動化と担当の裁量'
    },
    {
      id: 'EQ-05', cat: 9, title: '電話がつながらないと言われる', tier: 1, spec: ['any'], who: 'front', cool: 120,
      cond: (c) => c.load >= 0.6,
      prio: (c) => (c.balked7 >= 2 ? 1 : 0),
      say: '「何度かけても話し中」と言われました。回線は1本。予約と問い合わせが同じ電話に来ています。',
      bg: (c) => `回線1本、受付${c.staff.receptionists}人。混み具合${Math.round(c.load * 100)}%。待てず帰る人 1日${c.balked7}人。`,
      ask: '電話の受け方',
      choices: [
        { id: 'line', label: '回線を1本増やす', note: '¥700/日。取りこぼしは減る。取る人が同じなら負担は増える',
          req: { money: 30000 },
          fx: { dailyCost: { yen: 700, days: null, label: '電話回線の追加' }, aw: 0.01 },
          when: [{ if: (c) => c.staff.receptionists <= 1, fx: { slack: -1 }, why: '回線が増えても、受ける人が1人なら鳴る電話が増えるだけ' }],
          reflect: '入口を広げた。中で受ける人の数が次の課題' },
        { id: 'ivr', label: '自動音声で振り分ける', note: '¥1,200/日。予約と問い合わせが分かれる。高齢の患者が途中で切ることがある',
          fx: { dailyCost: { yen: 1200, days: null, label: '自動音声案内' }, slack: 1 },
          chance: { p: 0.35, label: '高齢の常連が「機械は嫌」と来院を控える', hit: { rep: -1 }, miss: {} },
          reflect: '受付を楽にした。電話の向こうの人の顔を思い出す判断' },
        { id: 'hours', label: '予約の電話時間帯を決めて掲示する', note: '費用なし。時間外の電話は断る形になる。評判に少し響く',
          fx: { slack: 1, rep: -0.5 },
          reflect: '費用の代わりに患者の都合を制限した。それが許される地域かを見る' }
      ],
      lesson: '電話は入口の設備。広げる・分ける・時間で絞る、の3つの形', point: '電話回線と受け方'
    },
    {
      id: 'EQ-06', cat: 9, title: '予約システムの乗り換えを勧められた', tier: 2, spec: ['any'], who: 'vendor', cool: 365, once: true,
      cond: (c) => c.day >= 20 && c.patients7 >= 12,
      say: 'ネット予約と自動の確認連絡が付いたシステムがあります。今の電話と台帳から乗り換えませんか。',
      bg: (c) => `今は電話と紙の台帳。乗り換えは¥200,000と¥1,500/日。切替に2週間。1日平均${c.patients7}人。資金 ${yen(c.money)}。`,
      ask: '予約の仕組み',
      facts: (c) => [{ label: '資金', val: yen(c.money) }, { label: '1日平均', val: `${c.patients7}人` }, { label: '混み具合', val: `${Math.round(c.load * 100)}%` }],
      choices: [
        { id: 'switch', label: '乗り換える', note: '¥1,500/日。移行の判断が続く。定着後は受付の電話が減る',
          req: { money: 200000 },
          fx: { dailyCost: { yen: 1500, days: null, label: '予約システム' }, flag: 'eq_booking', next: { id: 'EQ-06b', days: 7 } },
          when: [{ if: (c) => c.load >= 0.85, fx: { slack: -1 }, why: '混んでいる時期の切替は、現場が二重の仕事を抱える' }],
          reflect: '入口を変えた。移行と患者への案内が、この後の本番' },
        { id: 'upgrade', label: '今の業者の上位プランにする', note: '¥80,000と¥1,000/日。確認連絡だけ自動になる。ネット予約は無い',
          req: { money: 80000 },
          fx: { money: -80000, dailyCost: { yen: 1000, days: null, label: '予約確認の自動連絡' }, slack: 1 },
          reflect: '小さく変えた。無断キャンセルは減り、電話は減らない' },
        { id: 'keep', label: '電話と台帳のまま', note: '電話対応の時間外が¥1,000/日で60日。混むほど台帳の書き間違いが増える',
          fx: { dailyCost: { yen: 1000, days: 60, label: '電話対応の時間外' } },
          chance: { p: (c) => (c.load >= 0.85 ? 0.5 : 0.25), label: '予約の重複で待合が混乱する', hit: { rep: -1, slack: -1 }, miss: {} },
          reflect: '変えない費用は、混んだ日に確率で払う' }
      ],
      lesson: '予約は患者と医院の最初の接点。道具の変更は接点の変更', point: '予約システムの乗り換え'
    },
    {
      id: 'EQ-06b', cat: 9, title: '予約データの移し方と患者への案内', tier: 2, spec: ['any'], who: 'front', chainOnly: true, cool: 999,
      say: '台帳の予約を新しいシステムに移します。一晩で切り替えるか、2週間並行して動かすか。',
      bg: (c) => `乗り換え決定から7日。台帳には先30日分の予約。受付${c.staff.receptionists}人。職員の余力は${c.slack}。`,
      ask: '移行の方法',
      choices: [
        { id: 'overnight', label: '一晩で切り替える', note: '費用なし。速い。転記漏れがあれば当日に予約が消える',
          fx: { slack: -1, next: { id: 'EQ-06c', days: 21 } },
          chance: { p: 0.35, label: '転記漏れで予約が消え、患者を待たせる', hit: { rep: -1.5, trust: -1 }, miss: { slack: 1 } },
          reflect: '速さを選んだ。漏れは確率で、苦情は確実に届く' },
        { id: 'parallel', label: '2週間、台帳と並行して動かす', note: '費用なし。14日間は二重入力で余力−2。漏れは出にくい',
          fx: { slack: -2, examDelta: { d: 0.3, days: 14, label: '予約の二重入力' }, delayed: [{ days: 14, label: '並行運用が終わる', fx: { slack: 2 } }], next: { id: 'EQ-06c', days: 21 } },
          when: [{ if: (c) => c.staff.receptionists >= 2, fx: { slack: 1 }, why: '受付が2人いれば、二重入力を分担できる' }],
          reflect: '安全を時間で買った。現場の14日が費用' },
        { id: 'vendor', label: '業者に移行を任せる', note: '¥60,000。受付は案内に集中できる。業者は患者の事情を知らない',
          req: { money: 60000 },
          fx: { money: -60000, next: { id: 'EQ-06c', days: 21 } },
          chance: { p: 0.2, label: '常連の希望日時が機械的に入り、調整が要る', hit: { slack: -1 }, miss: {} },
          reflect: '金で手間を外に出した。事情まで外に出せたかは別' }
      ],
      lesson: '移行の費用は、速さ・現場の時間・外注費のどれかで払う', point: 'データ移行の方法'
    },
    {
      id: 'EQ-06c', cat: 9, title: '常連が新しい予約に困っている', tier: 2, spec: ['any'], who: 'patient', chainOnly: true, cool: 999,
      say: 'ネットで予約と言われても、私にはできません。前みたいに電話で取れないんですか。',
      bg: (c) => `新システムから21日。ネット予約は増えたが、高齢の常連の予約が減った。認知${Math.round(c.aw * 100)}%、評判${Math.round(c.rep)}。`,
      ask: '電話予約を残すか',
      choices: [
        { id: 'keepphone', label: '電話予約を残す', note: '費用なし。受付が電話とネットの両方を見る。余力−1。常連は戻る',
          fx: { slack: -1, rep: 1, trust: 1 },
          reflect: '二本立てにした。効率の一部を返して、人を残した' },
        { id: 'teach', label: '受付が操作を教える時間を作る', note: '費用なし。14日間、余力−1。覚えた人は自分で取れる。覚えない人もいる',
          fx: { slack: -1, delayed: [{ days: 14, label: '常連の一部がネット予約に慣れる', fx: { slack: 1, trust: 1 } }] },
          when: [{ if: (c) => c.staff.receptionists >= 2, fx: { slack: 1 }, why: '受付が2人いれば、教える時間を作りやすい' }],
          chance: { p: 0.4, label: 'それでも戻らない常連が出る', hit: { rep: -1 }, miss: { rep: 0.5 } },
          reflect: '教えるという投資。届く人と届かない人がいる' },
        { id: 'netonly', label: 'ネット中心で押し切る', note: '費用なし。受付は楽になる。常連の一部は離れる',
          fx: { slack: 1, rep: -1, newMul: { mul: 0.95, days: 30, label: '常連の一部が離れる' } },
          reflect: '効率を選んだ。離れた人の数が、選んだ費用' }
      ],
      lesson: '道具を変えると、使えない人が生まれる。誰を残すかまでが設計', point: '道具の変更と取り残される人'
    },
    {
      id: 'EQ-07', cat: 9, title: '待合の掲示が増えすぎた', tier: 1, spec: ['any'], who: 'front', cool: 150,
      cond: (c) => c.day >= 10,
      say: '待合の壁が掲示で埋まっています。読まれていないのに、問い合わせは減りません。',
      bg: (c) => `掲示は20枚超。診療時間の変更も貼ってある。待ち時間の平均${Math.round(c.waitAvg)}分。受付${c.staff.receptionists}人。`,
      ask: '案内表示の整え方',
      choices: [
        { id: 'trim', label: '掲示を3枚に絞る', note: '費用なし。見やすい。外した内容の問い合わせが増えるかもしれない',
          fx: { rep: 0.5 },
          chance: { p: 0.3, label: '外した案内の問い合わせが増える', hit: { slack: -1 }, miss: { slack: 1 } },
          reflect: '減らす勇気。減らして困ったものだけが、要る掲示' },
        { id: 'monitor', label: '待ち時間と案内のモニターを付ける', note: '¥120,000と¥300/日。待ち時間が見える。待ちが短い医院では効果が薄い',
          req: { money: 120000 },
          fx: { money: -120000, dailyCost: { yen: 300, days: null, label: '案内モニター' } },
          when: [{ if: (c) => c.waitAvg >= 30, fx: { rep: 1.5 }, why: '待ち時間が長いほど、見えることの安心が効く' }],
          reflect: '設備で伝えた。伝える中身は、掲示と同じく人が決める' },
        { id: 'voice', label: '受付が声で案内する', note: '費用なし。温かい。受付の余力−1。人が変わると案内も変わる',
          fx: { slack: -1, rep: 1 },
          reflect: '人で伝えた。人が疲れると案内も痩せる' }
      ],
      lesson: '掲示は多いほど読まれない。何を伝えないかを決めるのが案内', point: '待合の掲示と案内表示'
    },
    {
      id: 'EQ-08', cat: 9, title: 'ウェブサイトの情報が古い', tier: 1, spec: ['any'], who: 'advisor', cool: 200,
      cond: (c) => c.day >= 12,
      say: '医院のサイト、診療時間が開院当初のままです。スマホで見ると崩れています。新患は最初にここを見ます。',
      bg: (c) => `認知${Math.round(c.aw * 100)}%。新患 1日${c.newp7}人。作り直しは¥250,000。院長が自分で直すこともできる。`,
      ask: 'サイトの直し方',
      choices: [
        { id: 'rebuild', label: '業者に作り直してもらう', note: '¥250,000。認知+3%。30日後にさらに+2%。中身の文章は院長が書く',
          req: { money: 250000 },
          fx: { money: -250000, aw: 0.03, delayed: [{ days: 30, label: 'サイト経由の新患が増える', fx: { aw: 0.02 } }] },
          when: [{ if: (c) => c.aw < 0.4, fx: { aw: 0.02 }, why: '認知が低いほど、入口を整える伸び幅が大きい' }],
          reflect: '入口を整えた。中身の文章に、医院の考えが出る' },
        { id: 'self', label: '院長が夜に最低限直す', note: '費用なし。7日間、診察1人あたり+0.3分。診療時間の誤りだけ消える',
          fx: { examDelta: { d: 0.3, days: 7, label: '院長がサイトを直す' }, aw: 0.005 },
          reflect: '院長の時間で払った。最も高い時間で、最も小さい修正' },
        { id: 'leave', label: 'そのまま', note: '費用なし。古い時間を見て来た患者の苦情が出るかもしれない',
          fx: {},
          chance: { p: 0.3, label: '古い診療時間を見て来た患者が閉まった扉の前に立つ', hit: { rep: -1 }, miss: {} },
          reflect: '放置は無料ではない。扉の前で待った人が払う' }
      ],
      lesson: 'サイトは看板より先に見られる。古い情報は無い情報より悪い', point: 'ウェブサイトの更新'
    },
    {
      id: 'EQ-09', cat: 9, title: 'カルテの入力に時間がかかる', tier: 1, spec: ['any'], who: 'doctor', cool: 200,
      cond: (c) => c.load >= 0.6,
      say: '毎回同じ文を打っている。テンプレートを整えれば診察は速くなるはずだが、作る時間が無い。',
      bg: (c) => `診察1人あたり${c.examMean}分。混み具合${Math.round(c.load * 100)}%。よく使う定型文は30種ほど。医師${c.staff.doctors}人。`,
      ask: 'テンプレートの作り方',
      choices: [
        { id: 'night', label: '院長が夜に作る', note: '費用なし。7日後から診察−0.4分。院長の疲れがたまる。途中で止まることも',
          fx: {},
          chance: { p: 0.3, label: '忙しくて途中で止まる', hit: { slack: -1 }, miss: { delayed: [{ days: 7, label: 'テンプレートが揃う', fx: { examDelta: { d: -0.4, days: 120, label: 'カルテのテンプレート' } } }] } },
          reflect: '院長の夜で買った。止まらなければ安い、止まれば疲れだけ残る' },
        { id: 'team', label: '看護師と昼に作る', note: '費用なし。10日間、余力−1。10日後から診察−0.5分。看護師も入力できる形',
          fx: { slack: -1, delayed: [{ days: 10, label: 'テンプレートが揃い、看護師も入力できる', fx: { examDelta: { d: -0.5, days: 180, label: 'カルテのテンプレート' }, slack: 2 } }] },
          when: [{ if: (c) => c.staff.nurses <= 1, fx: { slack: -1 }, why: '看護師が1人だと、作業の間は処置室が空く' }],
          reflect: '現場と作った。速さより、誰でも使える形が残った' },
        { id: 'buy', label: '既製のテンプレートを買う', note: '¥60,000。即日。診察−0.3分。自院の言い方に合わないことがある',
          req: { money: 60000 },
          fx: { money: -60000 },
          chance: { p: 0.35, label: '合わずに使わなくなる', hit: {}, miss: { examDelta: { d: -0.3, days: 180, label: '既製テンプレート' } } },
          reflect: '早く買った。合うかどうかは使ってみるまで分からない' }
      ],
      lesson: '入力の速さは診察の速さ。作る時間を誰が出すかが論点', point: '電子カルテのテンプレート整備'
    },
    {
      id: 'EQ-10', cat: 9, title: '超音波装置を今入れるか', tier: 2, spec: ['any'], who: 'doctor', cool: 365, once: true,
      cond: (c) => c.day >= 20,
      say: 'エコーがあれば院内で検査が終わる患者が増える。¥1,500,000は大きい。今か、半年後か。',
      bg: (c) => `${c.specialty === 'orthopedics' ? '運動器の評価' : '腹部と頸部の検査'}に使う。1日平均${c.patients7}人。資金 ${yen(c.money)}、手元で持てる日数${c.runway}日。`,
      ask: '導入の時期と形',
      facts: (c) => [{ label: '資金', val: yen(c.money) }, { label: '手元で持てる日数', val: `${c.runway}日` }, { label: '1日平均', val: `${c.patients7}人` }],
      choices: [
        { id: 'buy', label: '今買う', note: '¥1,500,000。院内で完結し、評判+1。患者が少ないと稼働しない',
          req: { money: 1500000 },
          fx: { money: -1500000, rep: 1, flag: 'eq_us' },
          when: [
            { if: (c) => c.patients7 >= 25, fx: { aw: 0.02 }, why: '患者が多いほど、院内で検査できる価値が口で広がる' },
            { if: (c) => c.patients7 < 15, fx: { slack: -1 }, why: '患者が少ないと稼働せず、大きな買い物が職員の不安になる' }
          ],
          reflect: '大きく買った。稼働させる患者の数が、この機器の価値' },
        { id: 'lease', label: 'リースで入れる', note: '¥6,000/日がずっと。手元資金は減らない。5年で購入額を超える',
          fx: { dailyCost: { yen: 6000, days: null, label: '超音波装置のリース' }, rep: 1, flag: 'eq_us' },
          reflect: '資金の厚みを守った。長く使うほど高い' },
        { id: 'wait', label: '半年待つ', note: '費用なし。検査は病院に依頼。関係+1。患者は院内で終わらない',
          fx: { rel: { hospital: 1 }, rep: -0.5 },
          reflect: '待った。待つ間に失う患者と、守った資金を後で比べる' }
      ],
      lesson: '機器の導入時期は、資金の厚みより稼働の見込みで決める', point: '高額機器の導入時期と資金の形'
    },
    {
      id: 'EQ-11', cat: 9, title: '数字を見る目を育てるか', tier: 2, spec: ['any'], who: 'advisor', cool: 180, once: true,
      cond: (c) => c.day >= 20,
      say: '数字は毎日出ています。ただ、見ているのは私と院長だけです。職員が読めると、判断が現場で始まります。',
      bg: (c) => `直近30日の利益 ${yen(c.monthProfit)}。1日平均${c.patients7}人、待ち${Math.round(c.waitAvg)}分。職員${c.staffTotal}人。`,
      ask: '数字の共有',
      choices: [
        { id: 'monthly', label: '月1回、全員で数字を見る会', note: '費用なし。毎月1時間、診療の後。余力−1。30日後から現場の判断が速くなる',
          fx: { slack: -1, flag: 'eq_kpi', delayed: [{ days: 30, label: '職員が数字で話し始める', fx: { slack: 2, trust: 1 } }] },
          when: [
            { if: (c) => c.monthProfit < 0, fx: { slack: -1 }, why: '赤字の数字を見せると、最初は不安が先に立つ' },
            { if: (c) => c.staffTotal >= 6, fx: { slack: 1 }, why: '人数が多いほど、同じ数字を見る効果が大きい' }
          ],
          reflect: '数字を開いた。不安も一緒に開く。それでも共有した' },
        { id: 'doctor', label: '院長だけ講座で学ぶ', note: '¥30,000。院長の判断は速くなる。職員には届かない',
          req: { money: 30000 },
          fx: { money: -30000, flag: 'eq_kpi' },
          reflect: '一人の目を鍛えた。医院の目にはまだなっていない' },
        { id: 'leave', label: '数字は本部に任せる', note: '費用なし。現場は数字を知らずに働く。悪化の発見が遅れる',
          fx: {},
          chance: { p: 0.35, label: '売上の落ち込みに気づくのが1か月遅れる', hit: { money: -100000 }, miss: {} },
          reflect: '任せた。見ない数字は、悪くなってから見ることになる' }
      ],
      lesson: '数字を読める人の数が、医院の判断の速さ', point: 'KPIの読み方と共有'
    },
    {
      id: 'EQ-12', cat: 9, title: 'セキュリティの更新を先送りしていた', tier: 2, spec: ['any'], who: 'vendor', cool: 365, once: true,
      cond: (c) => c.day >= 25,
      say: 'カルテの端末、更新を止めているものがあります。バックアップも院内だけです。何かあれば復旧に時間がかかります。',
      bg: (c) => `端末の更新と外部バックアップで¥120,000と¥600/日。何もしなければ障害時は診療停止。1日平均${c.patients7}人。`,
      ask: '守り方',
      choices: [
        { id: 'full', label: '更新と外部バックアップの両方', note: '¥600/日。3日間、作業で診察+0.3分。障害の影響は小さい',
          req: { money: 120000 },
          fx: { dailyCost: { yen: 600, days: null, label: '外部バックアップ' }, examDelta: { d: 0.3, days: 3, label: '端末の更新作業' }, flag: 'eq_secure' },
          when: [{ if: (c) => !!c.flags.eq_ehr_extended, fx: { slack: -1 }, why: '延長保守中の古いカルテは、更新できない部分が残り手間が増える' }],
          reflect: '守りに払った。何も起きないことが、この費用の成果' },
        { id: 'backup', label: 'バックアップだけ', note: '¥30,000。障害が起きても3日で戻る。感染そのものは防げない',
          req: { money: 30000 },
          fx: { money: -30000 },
          chance: { p: 0.2, label: '端末が感染、3日間の診療停止', hit: { newMul: { mul: 0.6, days: 3, label: '端末の障害' }, rep: -1, money: -50000 }, miss: {} },
          reflect: '被害を小さくする方を選んだ。防ぐ方は選ばなかった' },
        { id: 'later', label: '落ち着いてから', note: '費用なし。障害が起きれば復旧費と診療停止が長い',
          fx: {},
          chance: { p: 0.25, label: '端末が感染、復旧まで7日', hit: { money: -300000, newMul: { mul: 0.6, days: 7, label: '端末の障害' }, rep: -2, trust: -1 }, miss: {} },
          reflect: '起きなかったのは運。起きたら全部が止まる' }
      ],
      lesson: '守りの費用は成果が見えない。見えないまま払い続けるのが守り', point: 'セキュリティ更新と事業継続'
    },
    {
      id: 'EQ-13', cat: 9, title: '患者アンケートが箱に溜まっている', tier: 2, spec: ['any'], who: 'front', cool: 180,
      cond: (c) => c.day >= 20,
      say: '待合のアンケート、箱に200枚ほど溜まっています。集計する人が決まっていません。',
      bg: (c) => `紙のアンケート。集計は未着手。評判${Math.round(c.rep)}、待ち時間の平均${Math.round(c.waitAvg)}分。受付${c.staff.receptionists}人。`,
      ask: '集計の方法',
      choices: [
        { id: 'sheet', label: '受付が月1回、表計算で集計する', note: '費用なし。余力−1。30日後に改善点が見え、評判+1。続けるには時間が要る',
          fx: { slack: -1, delayed: [{ days: 30, label: '集計から改善点が見える', fx: { rep: 1, slack: 1 } }] },
          when: [{ if: (c) => c.waitAvg >= 30, fx: { rep: 0.5 }, why: '待ち時間の不満が数字になると、対策の優先が付く' }],
          reflect: '紙を数字にした。数字にしたら、動くのが約束' },
        { id: 'qr', label: '二次元コードで回答に切り替える', note: '¥20,000。集計は自動。高齢の患者の回答が減る',
          req: { money: 20000 },
          fx: { money: -20000, slack: 1 },
          chance: { p: 0.4, label: '高齢の患者の声が集まらなくなる', hit: { rep: -0.5 }, miss: { rep: 0.5 } },
          reflect: '集計を自動にした。誰の声が消えたかを見る' },
        { id: 'read', label: '院長が読むだけにする', note: '費用なし。余力−1。傾向は掴めない。同じ不満が繰り返す',
          fx: { slack: -1 },
          chance: { p: 0.3, label: '同じ不満が繰り返し、口コミに出る', hit: { rep: -1 }, miss: {} },
          reflect: '読んだ。集計しないと、繰り返す声は1枚ずつしか見えない' }
      ],
      lesson: '声は集めるだけでは資産にならない。数える手と、動く手が要る', point: '患者アンケートの集計'
    },
    {
      id: 'EQ-14', cat: 9, title: '拠点ごとの数字を並べて見たい', tier: 3, spec: ['any'], who: 'billing', cool: 365, once: true,
      needs: { branches: 1 },
      say: '分院の請求も本院で見るようになりました。拠点ごとの数字を並べる機能を、業者から提案されています。',
      bg: (c) => `分院${c.branches}か所。今は拠点別の月報を手で作っている。分析機能は¥1,200/日。直近30日の利益 ${yen(c.monthProfit)}。`,
      ask: '拠点別の数字の作り方',
      choices: [
        { id: 'option', label: '分析機能を契約する', note: '¥1,200/日がずっと。拠点別が毎日見える。見る人がいなければ費用だけ',
          fx: { dailyCost: { yen: 1200, days: null, label: 'レセコンの分析機能' }, slack: 1 },
          when: [
            { if: (c) => !!c.flags.eq_kpi, fx: { trust: 1 }, why: '数字を見る習慣がある医院では、分析機能がすぐ判断に使われる' },
            { if: (c) => !c.flags.eq_kpi, fx: { slack: -1 }, why: '見る習慣が無いと、画面が増えるだけになる' }
          ],
          reflect: '道具を買った。使う習慣があるかで、価値がまるで違う' },
        { id: 'manual', label: '医事が手で月報を作り続ける', note: '費用なし。月に2日、医事の時間。締めから10日遅れて見える',
          fx: { slack: -1 },
          when: [{ if: (c) => c.branches >= 2, fx: { slack: -1 }, why: '拠点が増えるほど、手作業の月報は倍に増える' }],
          reflect: '人の時間で作った。拠点が増えるたびに重くなる' },
        { id: 'none', label: '全体の数字だけ見る', note: '費用なし。分院の赤字が全体に埋まって見えない',
          fx: {},
          chance: { p: 0.4, label: '分院の赤字に気づくのが2か月遅れる', hit: { money: -200000 }, miss: {} },
          reflect: '見なかった。合計の数字は、悪い拠点を隠す' }
      ],
      lesson: '拠点が増えたら、数字も拠点ごとに分ける。合計は判断を遅らせる', point: '拠点別データの見方'
    },
    {
      id: 'EQ-15', cat: 9, title: '物理療法の機器が古くなった', tier: 3, spec: ['orthopedics'], who: 'reha', cool: 365, once: true,
      cond: (c) => c.day >= 30,
      say: '牽引と干渉波の機器、修理が増えています。更新するか、台数を減らして運動療法中心に寄せるか。',
      bg: (c) => `物療機器4台、使って12年。更新は¥400,000。理学療法士${c.staff.pts}人。運動器リハビリテーション料の届出${c.rehaLevel ? 'あり' : 'なし'}。`,
      ask: '物療の位置づけ',
      choices: [
        { id: 'renew', label: '全台を更新する', note: '¥400,000。物療は今の形で続く。常連の高齢患者は安心',
          req: { money: 400000 },
          fx: { money: -400000, rep: 0.5 },
          reflect: '今の形を守った。物療に来る人の医院であり続ける' },
        { id: 'shift', label: '台数を半分にして運動療法に寄せる', note: '¥100,000で2台だけ更新。理学療法士の負担が増える。物療目当ての常連が離れる',
          req: { money: 100000 },
          fx: { money: -100000, slack: -1, flag: 'eq_exercise_shift' },
          when: [
            { if: (c) => c.rehaLevel >= 1, fx: { rep: 1 }, why: '運動器リハビリテーション料の届出があれば、寄せた先に受け皿がある' },
            { if: (c) => c.rehaLevel < 1, fx: { rep: -1 }, why: '届出が無いと、物療を減らした分の受け皿が無い' }
          ],
          chance: { p: 0.3, label: '物療目当ての常連が離れる', hit: { newMul: { mul: 0.95, days: 60, label: '物療の縮小' } }, miss: {} },
          reflect: '方針を変えた。機器の話に見えて、リハの中身の話' },
        { id: 'patch', label: '修理しながら使う', note: '修理費が¥1,200/日で90日。故障のたびに物療が止まる',
          fx: { dailyCost: { yen: 1200, days: 90, label: 'そのつどの修理費' } },
          chance: { p: 0.45, label: '故障で物療が10日止まる', hit: { money: -60000, rep: -1, slack: -1 }, miss: {} },
          reflect: '延命した。止まる日は選べない' }
      ],
      lesson: '機器の更新は、その診療を続けるかの問いを含む', point: '物療機器の更新と診療の方針'
    },
    {
      id: 'EQ-16', cat: 9, title: 'リハ室の機器が足りない', tier: 3, spec: ['orthopedics'], who: 'reha', cool: 200,
      needs: { rehaLevel: 1 },
      cond: (c) => c.load >= 0.6,
      say: '運動器リハビリテーションの患者が増えて、機器の順番待ちが出ています。増やすなら置く場所が要ります。',
      bg: (c) => `理学療法士${c.staff.pts}人、リハ助手${c.staff.rehaAides}人。混み具合${Math.round(c.load * 100)}%。リハ室は今の広さで限界。`,
      ask: '機器と場所',
      choices: [
        { id: 'waiting', label: '待合の一部をリハ室にする', note: '¥300,000で機器と改装。待合が狭くなり、待つ人の評判−1',
          req: { money: 300000 },
          fx: { money: -300000, slack: 1, rep: -1 },
          when: [{ if: (c) => c.waitAvg >= 30, fx: { rep: -1 }, why: '待ち時間が長い医院で待合を削ると、不満が増える' }],
          reflect: '場所を診療に振った。待つ人の居場所を削った' },
        { id: 'rent', label: '隣の区画を借りて広げる', note: '¥300,000の機器と家賃¥3,000/日。広い。固定費が増える',
          req: { money: 300000 },
          fx: { money: -300000, dailyCost: { yen: 3000, days: null, label: 'リハ室の増床の家賃' }, slack: 1, rep: 0.5 },
          reflect: '固定費で広さを買った。患者が減った月にも家賃は来る' },
        { id: 'slots', label: '時間帯を分けて機器を回す', note: '費用なし。予約の組み替えで受付の負担。患者の希望時間は通りにくい',
          fx: { slack: -1, rep: -0.5 },
          when: [{ if: (c) => c.staff.receptionists >= 2, fx: { slack: 1 }, why: '受付が2人いれば、予約の組み替えを分担できる' }],
          reflect: '運用で凌いだ。場所の問題は残ったまま' }
      ],
      lesson: '機器の増設は場所の問題。場所は待合か、家賃か、時間で払う', point: 'リハ機器の増設と場所'
    },
    {
      id: 'EQ-17', cat: 9, title: '透析装置の更新時期', tier: 3, spec: ['any'], who: 'dialysis', cool: 365, once: true,
      needs: { depts: ['dialysis'] },
      say: '透析装置の一部が更新の時期です。一括で替えるか、1台ずつ替えるか。替える間、その台は使えません。',
      bg: (c) => `透析装置のうち4台が更新時期。一括は¥4,000,000で5日停止。順次は3か月かけて1台ずつ。資金 ${yen(c.money)}。`,
      ask: '更新の進め方',
      facts: (c) => [{ label: '資金', val: yen(c.money) }, { label: '手元で持てる日数', val: `${c.runway}日` }],
      choices: [
        { id: 'all', label: '一括で更新する', note: '¥4,000,000。5日間、透析患者を病院に依頼。関係+1、評判−1。以後は安定',
          req: { money: 4000000 },
          fx: { money: -4000000, rel: { hospital: 1 }, rep: -1, newMul: { mul: 0.9, days: 5, label: '透析の一時停止' } },
          reflect: '一気に終えた。5日の依頼先があることが前提の判断' },
        { id: 'phased', label: '3か月かけて1台ずつ', note: '¥4,000,000を3回に分ける。停止は無い。90日間、透析室の余力−1',
          req: { money: 1400000 },
          fx: { money: -1400000, slack: -1, delayed: [{ days: 30, label: '2台目の更新', fx: { money: -1300000 } }, { days: 60, label: '3台目と4台目の更新', fx: { money: -1300000, slack: 1 } }] },
          when: [{ if: (c) => c.runway < 30, fx: { slack: -1 }, why: '手元資金が薄いと、分割の2回目・3回目が重く感じられる' }],
          reflect: '止めずに替えた。資金の出方が3回に分かれる' },
        { id: 'lease', label: 'リースに切り替える', note: '¥12,000/日がずっと。一時費用は無い。長く使うほど高い',
          fx: { dailyCost: { yen: 12000, days: null, label: '透析装置のリース' } },
          reflect: '資金を守った。継続費は透析患者が減っても続く' }
      ],
      lesson: '大型機器の更新は、金額より止まる日数と依頼先で決まる', point: '透析装置の更新と稼働'
    },
    {
      id: 'EQ-18', cat: 9, title: '眼底三次元画像解析の回し方', tier: 2, spec: ['ophthalmology'], who: 'ort', cool: 200,
      cond: (c) => !!(c.mainEquip && c.mainEquip.oct),
      say: '眼底三次元画像解析は月1回までの算定です。撮る順番、どう決めますか。',
      bg: (c) => `眼底三次元画像解析(OCT)を導入済み。継続患者1日平均${c.patients7}人、混み具合${Math.round(c.load * 100)}%。`,
      ask: '眼底三次元画像解析の検査枠',
      facts: (c) => [{ label: '算定の回数', val: '患者1人につき月1回まで(告示)' }, { label: '資金', val: yen(c.money) }],
      choices: [
        { id: 'schedule', label: 'システムで来院間隔を管理する', note: '¥40,000。来院間隔を記録して月1回の枠を管理。余力+1',
          req: { money: 40000 },
          fx: { money: -40000, slack: 1, flag: 'eq_oct_sched' },
          when: [{ if: (c) => c.staffTotal >= 4, fx: { rep: 0.5 }, why: '職員が多いほど、記録の運用がすぐ定着した' }],
          reflect: '仕組みを作った。月1回の枠を捨てずに使い切れる' },
        { id: 'ledger', label: '検査のたびに紙台帳で確認する', note: '費用なし。余力−1。確認漏れで算定できない撮影が起きうる',
          fx: { slack: -1 },
          chance: { p: 0.3, label: '確認漏れで撮影が算定できず材料費だけ残る', hit: { money: -15000 }, miss: {} },
          reflect: '人の手で確認した。漏れは起きるときに起きる' },
        { id: 'everytime', label: '毎回撮って、算定は後で選別する', note: '費用なし。撮り過ぎで算定漏れが起き、新患×0.97が30日',
          fx: { newMul: { mul: 0.97, days: 30, label: '算定トラブルの噂' } },
          chance: { p: 0.35, label: '算定できない撮影で材料費相当が無駄になる', hit: { money: -20000 }, miss: {} },
          reflect: '撮ってから選んだ。算定できない撮影は、患者にも職員にも重い' }
      ],
      lesson: '眼底三次元画像解析は、撮る枠より いつ撮るかで価値が決まる', point: '眼底三次元画像解析の運用'
    }
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = CASES;
  else root.DECISIONS.register(CASES);
})(typeof self !== 'undefined' ? self : this);
