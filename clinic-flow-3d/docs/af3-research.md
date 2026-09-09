# 便AF-3 着手前調査(精神科・心療内科 本院化) — 読み取り専用調査ノート

社長指示(2026-09-07)「各診療科特有のものってあるでしょ？それは調査した上で矛盾しない形で作成して」への裏取り。
一次情報: `medical-kb/data/kb/r08/*.json`・`clinic-flow-3d/app/specialties/psychiatry.js`・`app/departments.js`・`app/game.js`・
`clinic-flow-3d/docs/af3-design.md`(designer 設計・既にA案で結論済み)・`docs/roadmap.md` 13ac(社長決裁の記録)・
`docs/specialty-module.md`・`tests/main-internal.test.mjs`・`tests/main-ophtha.test.mjs`。

**先に結論**: designer の `docs/af3-design.md` は本調査と同じ一次資料に基づき既に精査済みで、KB・実装との齟齬は無い。
本ノートは KB 側から独立に裏取りした結果と、実装コードで直接確認できた事実(af3-design.md には書かれていない具体行番号)を補う。

---

## 1. KB にある精神科の制度項目(全13件・items.json 132件中)

| id | 正式名称 | 点数 | 施設基準/届出 | 備考 |
|---|---|---|---|---|
| r08-I002-1-ro-1-1 | 通院精神療法(初診・60分以上・指定医) | 650 | 不要 | 初診時1回上限 |
| r08-I002-1-ro-2 | 通院精神療法(初診・30〜60分・指定医) | 550 | 不要 | 初診時1回上限 |
| r08-I002-1-ha-1-1 | 通院精神療法(初診以外・30分以上・指定医) | 410 | 不要 | 週1回(退院後4週は週2回) |
| r08-I002-1-ha-2-1 | 通院精神療法(初診以外・30分未満・指定医) | 315 | 不要 | 5分超が条件。週1回同上 |
| r08-I004-2-i | 心身医学療法(初診時) | 110 | 不要 | 精神科標榜以外でも算定可 |
| r08-I004-2-ro | 心身医学療法(再診時) | 80 | 不要 | 週2回→週1回(4週後) |
| r08-I002-n11-i-1/-2 | 早期診療体制充実加算1(3年以内/超) | 50/15 | **要届出** | 診療所も届出可だが実績要件(5%・60/医師)は未判定 |
| r08-I002-n11-ro-1/-2 | 早期診療体制充実加算2(3年以内/超) | 20/15 | **要届出** | **病院のみ**。ゲームの部門は診療所=到達不能(制度の写しとして登録のみ) |
| r08-I002-n11-ha-1/-2 | 早期診療体制充実加算3(3年以内/超) | 15/10 | **要届出** | 診療所向け。分院が唯一使う加算 |
| r08-A001-n8 | 外来管理加算 | 52 | 不要 | 精神科専門療法を行った日は算定不可(rule-0001・機械判定) |

通院精神療法の時間区分の実際の境目: **初診は60分**(ro-1 vs ro-2)、**再診(初診以外)は30分**(ha-1 vs ha-2)。
「分かれ目は30分」は再診には正確だが初診の境目(60分)を代表しない。「点数は時間の区分」の方が両方を包む言い方(→§5-i)。

### KB に無いもの(ゲームで触れてはいけない・確認済み)
- I002-1-イ(非指定医のセル・550点)・注13の減算セル(items内コメントで「別に存在するがKB未登録」と明記)
- I002注12(情報通信機器を用いた精神療法)= rule-0029 で「否定的確認」済み(オンライン診療がゲームに無いため登録しない)
- I001入院精神療法・I003標準型精神分析療法(rule-0010の相手項目として名前だけ登場。points等は未登録)
- I004の20歳未満加算(100分の200)= 条件文に「KB未登録」と明記
- 加算1のカ要件が列挙する「児童思春期精神科専門管理加算・療養生活継続支援加算・…精神科在宅患者支援管理料」等の個別項目そのもの(要件の中で名前だけ引用・itemとしては未登録)
- 通院精神療法本体に**届出必須の施設基準は無い**(fsNote「特掲の施設基準告示・届出通知に…届出の定めはない」)。これは「未確認」ではなく**確認済みの否定**。

---

## 2. 分院 psychiatry.js の使用/未使用マッピングと1日の式

**使用中**(reimbursementMappings): A000/A001/A001-n8/I002 4区分/I004 2区分/F400-3(処方箋料)/F400-n6-i(一般名処方)/I002-n11-ha-1・-2(加算3のみ)。

**KBにあるが未使用**(=本院化で新規に出せる/出す価値のない候補): 早期診療体制充実加算1(i-1/i-2)・加算2(ro-1/ro-2)。
加算2は病院限定のため部門・本院とも診療所である限り到達不能(登録のみが正しい)。加算1は診療所も対象だが実績要件(6か月の比率5%・60件/医師)を
ゲームが判定しないため、既存の判断(加算3だけを扱う)は本院化でも維持が妥当(af3-design.md 冒頭コメントと一致)。

**runDay の式**(psychiatry.js 139-186行):
```
budget = dayMinutes(460) × doctors                       // 1日の分数予算
need   = kind==='i004' ? i004{First,Revisit}
       : isFirst ? (long ? longFirst(65) : stdFirst(45))
                 : (long ? longRevisit(30) : stdRevisit(12))
if (used+need > budget) { 翌日へ(nv=day+1); deferred++; continue }
churn  = max(0.005, churnMonthly[plan] - psws×pswChurnRelief(0.005))   // std .05/mix .035/long .02
```
`long = plan==='long' || (plan==='mix' && rand()<mixLongShare(0.3))`。中断はパネル全体に対し `rand() < churn/26`(日次)で判定 — **来院とは独立**。
一般名処方は `prescProb(0.85)` の乱数の後、`policy.ippanmei` が ON のときだけ addする(内科と同型)。`renkei` は加算3の要件行にのみ効く(中断モデルには効かない)。

---

## 3. 本院化で矛盾が出る箇所(裏取り結果)

| # | 論点 | KB/コードで確認した事実 | 結論 |
|---|---|---|---|
| a | examMean と timePlan の二重 | `examCapDay = doctors×(480/(examMean+1.5))×0.72`(game.js 1668/2122/4690/5110/5279 の5箇所、af3-design記載の4箇所+bottleneckInfo分). examMean は「診察時間」スライダー(3〜12分・range固定・index.html 136行)で**科を問わず常に表示**(orthoOnly判定が無い唯一のスライダー=2077-2082行)。psychiatry.js は budget/need(分)の独自モデルを持ち、examMean と単位は同じ(1日の分数予算)だが接続する部品が無い。**二重は実装事実として確認**。design案(A: examMean を隠しtimePlanから逆算)は正しい解法 |
| b | 定着の符号 | 本院は onDischargeDept(game.js 814-818)で `loyalty={senior:.7,worker:.5,sports:.5}` × `sat`(待ち時間由来の満足度)のみで再来を決める。**mod.managementParameters.churnMonthly は main 経路で一切参照されない**(runDayを呼ばないため)。分院=「長く診る→中断.05→.02」、本院=「診察が長い→待ち↑→sat↓→定着↓」で**符号が逆**という設計の指摘は実装上正しい。対策(`mainLoyalty(policy)` を loyalty に掛ける)は未実装 = **AF-3で新規に書く関数** |
| c | psws不在=加算3要件 | facility_standards.json の3件(fs-i002-n11-1/2/3)の `staffing_req` はいずれも「常勤の精神保健指定医1名以上」のみで、**PSW配置は制度上の要件として存在しない**。psychiatry.js の fsDefs(78-90行)が課す `missing.push('精神保健福祉士1名')` は**ゲーム上の仮定**(要件カ=他加算届出orクロザピン体制の代理表現、gameNoteに明記)。本院化でこの仮定を維持するなら `settings.psws` を新設しないと**要件行が永久に埋まらない**(第26条=行き止まり禁止に抵触)。これは分院に実在する設計だが、本院 shim には psws フィールドが無い(mainDeptShim=game.js 719-723行のstaffはdoctors/nurses/clerksのみ) |
| d | 情報行(shim に last が無い) | `deptLeverHtml`(game.js 3695-3717)は `d.last && d.last.info` から `usedMin/budgetMin/deferred` を読むが、`DEPT.create`(departments.js 53-67)でのみ `last:null` が初期化され `runDay` の中で更新される。mainDeptShim は runDay を通らず**毎描画で新規オブジェクトを作る**(719行)ため `d.last` は常に `undefined` → 情報行(`${i ? ... : ''}`)は**本院では常に空になる**。af3-design の代案(前日 `history.balked` を使う)が唯一の解 |
| e | 一般名処方の二重 | 精神科の一般名処方は `policy.ippanmei`(dept.policy内)の1個のみで、整形本院の`settings`直下フラグとは別建て。内科・眼科の main.preset も同じく `policy:{ippanmei:true}` を使っており(deptLeverHtml内科版と同じ`data-dippan`配線)、**二重は無い**(内科main.preset.policyに既にippanmei有、整形固有のippanmeiフラグはsettingsに存在しない=確認: settings既定値にippanmei関連キーなし)。**保留は解消: 二重の懸念は根拠なし** |
| f | SHOP/自費/営業先/キホン集の整形語 | `TEXTBOOK`配列20項目のうちpreset.textbookで差し替え可能なのは**5項目(index 2/5/9/10/12=③⑥⑨⑩⑫)のみ**。index14(⑮自費は価値設計=PRP/AGA名指し)・index16(⑰客層から逆算=リハ・骨粗鬆症・AGA・MRI・PRP・スポーツクラブ/学校を列挙)は**差し替え機構が無く、内科・眼科main化でも未解消のまま残っている既存ギャップ**(精神科固有の新規問題ではない)。REL_DEFの`sports`(PRP需要UP)は`relHide`で隠せるが、`pharmacy`/`shoutengai`はrel差し替え対象外(整形色は薄いため実害小)。SHOPの`echo/dexa/mri/machines/physio/pts/rehaAide`は`shopHide`で隠せる(内科・眼科と同一設定で足りる) |

---

## 4. 内科・眼科の本院化作法との差分

| 要素 | 内科/眼科(既存) | 精神科(現状=分院のみ) | 同型にできるか |
|---|---|---|---|
| `main.line/order/fsTitle/preset` | 内科=order2、眼科=order3 | 未定義 | 可(af3-design: order4・line16字以内はtests/main-*.test.mjsの慣例と一致) |
| `pickProfile(rand)` | 両科にあり(main/部門共用) | **無い**(runDay内にインライン抽選のみ、131-134行) | 要新規抽出(1関数化のみ・ロジックは既存と同一乱数順で足りる) |
| `planVisit(p,policy,fs,rand,hasDept,equip)` | 両科にあり。戻り値`{report,isFirst,...}` | **無い**。runDayが直接kbActsを組み立てる(160-186行) | 要新規抽出。眼科と違い**戻り値に`needMin`を足す必要がある**(specialty-module.mdは眼科型のシグネチャしか文書化していない=更新要) |
| 白内障型パイプライン相当 | 眼科のみ(`cataractOnVisit`/`cataractDay`) | 該当なし | 精神科には該当機構なし(単純) |
| 施設基準 | 内科=`fsDefs`1件(clerks判定)。眼科=`fsDefs:[]` | `fsDefs`1件(doctors/psws/renkei判定) | 型は同じだが**psws判定は本院staffに存在しないフィールド**(§3-c) |
| テスト | `tests/main-internal.test.mjs`(96行)・`main-ophtha.test.mjs`(160行)。共通: `main.line`長さ検査・`pickProfile`網羅・`shim()`ローカル定義・`planVisit→DEPT.evalVisit`往復・`fsStatus`/`fsEnforce`検証 | 無し(psychiatry用main-*.test.mjsは未作成) | 同型で書ける。ただしpsws判定・renkei判定・needMin検証が精神科固有の追加項目 |
| UIレバー配線 | `dkanri`/`dkeiji`/`dippan`はいずれも`deptOf()`(mainDeptShim分岐込み)を経由し`bindDeptLeverHandlers`に登録済み(game.js 3966-4011) | **`data-dtime`ハンドラは`bindDeptLeverHandlers`に無く、部門カード専用の別関数(4282-4291行)で`G.depts[id]`を直書き**している | **未整合を発見**: `deptLeverHtml`のpsychiatry分岐(3695-3717行)は本院描画にも使われる(`renderPolicyCard`が`ortho`以外で全科呼ぶ)のに、そのボタンのクリックは本院では**無反応**になる。AF-3実装時に`[data-dtime]`を`bindDeptLeverHandlers`側へ移すか複製が必須 |

---

## 5. 3点の決め方の材料

**(i) 扉の1行**: KBで確認した境目は「初診60分・再診30分」の二本立て。「分かれ目は30分」は再診のみを正しく代表し、初診の60分境目を代表しない
(不正確ではないが片働き)。「点数は時間の区分」はどちらの境目も包む、より制度に忠実な言い方。designer推奨(案1)はKB上も裏付けられる。

**(ii) 「長く診るほど定着が上がる」を本院に足す根拠**: 分院の中断モデル(churnMonthly std.05→long.02、2.5倍差=社長確認済み2026-08-29)は
**本院の経路(onDischargeDept)からは呼ばれない別系統**(§3-b)。何もしなければ本院のtimePlanは「long=遅い割に得るもの無し」という
選ぶ意味のない選択肢になり、分院の確定済み設計思想(時間をかける診療は続けやすい)と本院の挙動が**矛盾したまま並立**する。
矛盾回避には、分院のchurnMonthlyから比率を導出した`mainLoyalty(policy)`を`loyalty`に掛ける以外に、分院の値と整合する式は無い
(既存のsat/loyalty機構に対し、分院と別の独立変数を追加で持ち込むと今度は「同じ量を二度置かない」第27条に触れる)。

**(iii) prpOn(PRP)を精神科で隠す根拠**: PRP療法(`settings.prpOn`)はTEXTBOOK⑮/⑰で「保険でできないことへの対価」の例として運動器の再生医療に
紐づけて説明され、REL_DEFの`sports`(隠す予定)の効果文言にも「PRP需要UP」と明記されている=**PRPは整形外科(運動器)の自費メニューとして設計された機能**
であり、精神科の診療内容(通院精神療法・心身医学療法)とは無関係。隠す根拠は明確。
**内科・眼科でも隠すべきかは、既に出荷済みの2科で未解決のまま残っている**(両main.presetのjihiHideは`selfReha`のみでprpOnを含まない=
現在も内科・眼科の本院でPRPメニューが出せてしまう)。精神科だけ隠すと「精神科だけ特別扱い」ではなく「精神科で新たに気づいた整合性の穴を、
先に精神科で塞ぎ、内科・眼科は別便で揃える」という順序になる(全科同時修正はAF-3のスコープ外=保留のまま送るのが安全側)。

---

## 参照した一次ファイル(絶対パス)

- `/home/user/bridge-lp/medical-kb/data/kb/r08/items.json`(132件)・`facility_standards.json`(30件)・`billing_rules.json`
- `/home/user/bridge-lp/medical-kb/docs/data-dictionary.md`
- `/home/user/bridge-lp/clinic-flow-3d/data/kb-r08.js`
- `/home/user/bridge-lp/clinic-flow-3d/app/specialties/psychiatry.js`(194行・全文読了)
- `/home/user/bridge-lp/clinic-flow-3d/app/specialties/internal-medicine.js`(285行・全文読了)
- `/home/user/bridge-lp/clinic-flow-3d/app/specialties/ophthalmology.js`(300行・全文読了)
- `/home/user/bridge-lp/clinic-flow-3d/app/departments.js`(213行・全文読了)
- `/home/user/bridge-lp/clinic-flow-3d/app/game.js`(行418-421, 574-830, 1381-1392, 1668, 2050-2145, 2122, 3228-3270, 3300-3380, 3683-3800, 3940-4030, 4260-4300, 4557-4600, 4680-4700, 4840-4885, 5100-5300, 5500-5590)
- `/home/user/bridge-lp/clinic-flow-3d/docs/af3-design.md`(designer設計・全文)・`docs/specialty-module.md`・`docs/roadmap.md`(13t/13u/13v/13w/13x/13aa/13ab/13ac節)
- `/home/user/bridge-lp/clinic-flow-3d/tests/main-internal.test.mjs`(96行・全文)・`tests/main-ophtha.test.mjs`(冒頭160行)
