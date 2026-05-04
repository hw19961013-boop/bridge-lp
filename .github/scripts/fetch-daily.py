"""
朝の読み物ダッシュボード /morning 用に、複数ソースから「本文ありの」情報を集める。

Google News RSS は paywall + 追跡リダイレクトで読めない問題があるため廃止。
代わりに本文・抄録が API レベルで返る公式ソースのみを使う。

ソース一覧:
  - 医療政策   : 厚労省 RSS (news.rdf)
  - 医薬品承認 : PMDA RSS
  - 論文(医療経営/公衆衛生) : PubMed efetch (abstract 本文付き)
  - 論文(リハ/薬理/神経)    : PubMed efetch
  - AI 研究    : arXiv API (cs.AI / cs.CL / cs.LG)
  - 経済の数字 : Stooq CSV (日経/TOPIX/USDJPY/EURJPY/SP500/NASDAQ)
  - テック     : ITmedia ニュース RSS
  - 今日のできごと : Wikipedia REST (ja.wikipedia.org/api/rest_v1/feed/onthisday)

すべて認証不要・無料。失敗しても部分的に動く(個別 try/except)。
"""
from __future__ import annotations
import json
import os
import re
import html
import time
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
import xml.etree.ElementTree as ET
from pathlib import Path

USER_AGENT = 'bridge-lp-daily-refresher (+https://github.com/bridge-med/bridge-lp)'
TIMEOUT = 40
JST = timezone(timedelta(hours=9))


# ============================================================
# 共通ユーティリティ
# ============================================================
def http_get(url: str, accept: str = '') -> str:
    headers = {'User-Agent': USER_AGENT}
    if accept:
        headers['Accept'] = accept
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        raw = r.read()
        # 文字コード判定: Content-Type の charset 優先、なければ UTF-8 → cp932 fallback
        ctype = r.headers.get('Content-Type', '')
        m = re.search(r'charset=([^\s;]+)', ctype, re.IGNORECASE)
        enc = m.group(1) if m else 'utf-8'
        try:
            return raw.decode(enc, errors='replace')
        except LookupError:
            return raw.decode('utf-8', errors='replace')


def http_get_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.read()


def strip_html(s: str) -> str:
    s = re.sub(r'<[^>]+>', '', s)
    s = html.unescape(s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def truncate(s: str, n: int) -> str:
    if not s:
        return ''
    if len(s) <= n:
        return s
    return s[: n - 1].rstrip() + '…'


def parse_rfc822(s: str) -> tuple[str, str]:
    try:
        dt = parsedate_to_datetime(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat(), dt.strftime('%Y-%m-%d')
    except Exception:
        return s, s[:10] if s else ''


def parse_iso(s: str) -> tuple[str, str]:
    try:
        dt = datetime.fromisoformat(s.replace('Z', '+00:00'))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat(), dt.strftime('%Y-%m-%d')
    except Exception:
        return s, s[:10] if s else ''


# ============================================================
# 1. 厚労省 RSS (新着情報)
#    description は空なので、タイトル/カテゴリ/日付ベースで提供
# ============================================================
RSS_NS = {
    'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    'rss': 'http://purl.org/rss/1.0/',
    'dc':  'http://purl.org/dc/elements/1.1/',
}


def fetch_mhlw(limit: int = 6) -> list[dict]:
    url = 'https://www.mhlw.go.jp/stf/news.rdf'
    try:
        xml_text = http_get(url)
        root = ET.fromstring(xml_text)
    except Exception as e:
        print(f'[mhlw] failed: {e}')
        return []
    items: list[dict] = []
    for it in root.findall('rss:item', RSS_NS):
        title = (it.findtext('rss:title', namespaces=RSS_NS) or '').strip()
        link = (it.findtext('rss:link', namespaces=RSS_NS) or '').strip()
        date = (it.findtext('dc:date', namespaces=RSS_NS) or '').strip()
        desc = strip_html(it.findtext('rss:description', namespaces=RSS_NS) or '')
        # 「[政策情報] 〇〇」のような prefix が付くことがあるので分離
        category = ''
        m = re.match(r'\[(.+?)\]\s*(.+)$', title)
        if m:
            category = m.group(1)
            title = m.group(2).strip()
        iso, ymd = parse_iso(date)
        items.append({
            'title': title,
            'url': link,
            'source': '厚生労働省',
            'category': category,
            'pubDate': iso,
            'date': ymd,
            'body': truncate(desc, 300) if desc else '',
            'lang': 'ja',
        })
        if len(items) >= limit:
            break
    return items


# ============================================================
# 3. PubMed (論文・abstract 本文)
# ============================================================
def pubmed_search(term: str, retmax: int = 5) -> list[str]:
    url = (
        'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi'
        '?db=pubmed&retmode=json&sort=date'
        f'&term={urllib.parse.quote(term)}&retmax={retmax}'
    )
    try:
        return json.loads(http_get(url)).get('esearchresult', {}).get('idlist', [])
    except Exception as e:
        print(f'[pubmed search] {term}: {e}')
        return []


def pubmed_efetch_abstracts(ids: list[str]) -> dict[str, dict]:
    """efetch で各 PMID の abstract 本文を取得"""
    if not ids:
        return {}
    url = (
        'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi'
        f'?db=pubmed&id={",".join(ids)}&rettype=abstract&retmode=xml'
    )
    out: dict[str, dict] = {}
    try:
        xml_text = http_get(url)
        root = ET.fromstring(xml_text)
    except Exception as e:
        print(f'[pubmed efetch] {e}')
        return out
    for art in root.findall('.//PubmedArticle'):
        pmid_el = art.find('.//PMID')
        if pmid_el is None or not pmid_el.text:
            continue
        pmid = pmid_el.text.strip()
        title = ''.join(art.find('.//ArticleTitle').itertext()).strip() if art.find('.//ArticleTitle') is not None else ''
        # 抄録は AbstractText が複数(背景/方法/結果/結論)に分かれることがある
        abs_parts = []
        for at in art.findall('.//Abstract/AbstractText'):
            label = at.get('Label', '')
            text = ''.join(at.itertext()).strip()
            if label:
                abs_parts.append(f'{label}: {text}')
            else:
                abs_parts.append(text)
        abstract = ' '.join(abs_parts).strip()

        journal_el = art.find('.//Journal/Title')
        journal = journal_el.text.strip() if journal_el is not None and journal_el.text else ''

        # 著者(筆頭+et al.)
        authors = []
        for au in art.findall('.//AuthorList/Author'):
            ln = au.findtext('LastName') or ''
            fn = au.findtext('Initials') or ''
            if ln:
                authors.append(f'{ln} {fn}'.strip())
        author_label = authors[0] + (' et al.' if len(authors) > 1 else '') if authors else ''

        # 出版日。Month は "May" や "5" 等が混在
        MONTH_MAP = {
            'jan':'01','feb':'02','mar':'03','apr':'04','may':'05','jun':'06',
            'jul':'07','aug':'08','sep':'09','oct':'10','nov':'11','dec':'12',
        }
        pub_year = art.findtext('.//Article/Journal/JournalIssue/PubDate/Year') or ''
        pub_month_raw = (art.findtext('.//Article/Journal/JournalIssue/PubDate/Month') or '').strip()
        pub_day_raw = (art.findtext('.//Article/Journal/JournalIssue/PubDate/Day') or '').strip()
        if pub_month_raw.isdigit():
            pub_month = pub_month_raw.zfill(2)
        else:
            pub_month = MONTH_MAP.get(pub_month_raw[:3].lower(), '01')
        pub_day = pub_day_raw.zfill(2) if pub_day_raw.isdigit() else '01'
        date_str = f'{pub_year}-{pub_month}-{pub_day}' if pub_year else ''

        out[pmid] = {
            'title': title,
            'abstract': abstract,
            'journal': journal,
            'authors': author_label,
            'date_str': date_str,
        }
    return out


def fetch_pubmed_topic(label: str, query: str, limit: int) -> list[dict]:
    term = f'({query}) AND ("last 60 days"[edat])'
    ids = pubmed_search(term, retmax=limit)
    time.sleep(0.4)
    metadata = pubmed_efetch_abstracts(ids) if ids else {}
    items = []
    for pmid in ids:
        m = metadata.get(pmid)
        if not m or not m['abstract']:
            continue
        items.append({
            'title': m['title'],
            'url': f'https://pubmed.ncbi.nlm.nih.gov/{pmid}/',
            'source': m['journal'],
            'authors': m['authors'],
            'pubDate': m['date_str'],
            'date': m['date_str'][:10] if m['date_str'] else '',
            'body': truncate(m['abstract'], 700),
            'lang': 'en',
            'pmid': pmid,
            'topic': label,
        })
    return items


# ============================================================
# 4. arXiv API (AI/CS 系 abstract)
# ============================================================
ARXIV_NS = {
    'atom': 'http://www.w3.org/2005/Atom',
    'arxiv': 'http://arxiv.org/schemas/atom',
}


def fetch_arxiv(categories: list[str], total: int) -> list[dict]:
    cats = '+OR+'.join(f'cat:{c}' for c in categories)
    url = (
        f'https://export.arxiv.org/api/query?search_query={cats}'
        f'&sortBy=submittedDate&sortOrder=descending&max_results={total}'
    )
    try:
        xml_text = http_get(url)
        root = ET.fromstring(xml_text)
    except Exception as e:
        print(f'[arxiv] {e}')
        return []
    items = []
    for entry in root.findall('atom:entry', ARXIV_NS):
        title = (entry.findtext('atom:title', namespaces=ARXIV_NS) or '').strip().replace('\n', ' ')
        title = re.sub(r'\s+', ' ', title)
        url_link = (entry.findtext('atom:id', namespaces=ARXIV_NS) or '').strip()
        published = (entry.findtext('atom:published', namespaces=ARXIV_NS) or '').strip()
        summary = strip_html(entry.findtext('atom:summary', namespaces=ARXIV_NS) or '')
        authors = [
            (a.findtext('atom:name', namespaces=ARXIV_NS) or '').strip()
            for a in entry.findall('atom:author', ARXIV_NS)
        ]
        author_label = authors[0] + (' et al.' if len(authors) > 1 else '') if authors else ''
        cat_tags = [c.get('term', '') for c in entry.findall('atom:category', ARXIV_NS)]
        primary_cat = cat_tags[0] if cat_tags else ''
        iso, ymd = parse_iso(published)
        items.append({
            'title': title,
            'url': url_link.replace('http://', 'https://'),
            'source': 'arXiv ' + primary_cat,
            'authors': author_label,
            'pubDate': iso,
            'date': ymd,
            'body': truncate(summary, 700),
            'lang': 'en',
            'topic': primary_cat,
        })
    return items


# ============================================================
# 5. NHK ニュース (政治 + 経済)
#    description に本文冒頭が入っているので、その一面で理解できる
# ============================================================
NHK_FEEDS = [
    ('政治', 'https://www.nhk.or.jp/rss/news/cat4.xml'),
    ('経済', 'https://www.nhk.or.jp/rss/news/cat5.xml'),
    ('国際', 'https://www.nhk.or.jp/rss/news/cat6.xml'),
]


def fetch_nhk(category_label: str, url: str, limit: int) -> list[dict]:
    try:
        xml_text = http_get(url)
        root = ET.fromstring(xml_text)
    except Exception as e:
        print(f'[nhk {category_label}] {e}')
        return []
    items = []
    channel = root.find('channel')
    if channel is None:
        return items
    for it in channel.findall('item')[:limit]:
        title = (it.findtext('title') or '').strip()
        link = (it.findtext('link') or '').strip()
        pub = (it.findtext('pubDate') or '').strip()
        desc = strip_html(it.findtext('description') or '')
        iso, ymd = parse_rfc822(pub) if ',' in pub else parse_iso(pub)
        items.append({
            'title': title,
            'url': link,
            'source': f'NHK {category_label}',
            'category': category_label,
            'pubDate': iso,
            'date': ymd,
            'body': truncate(desc, 350),
            'lang': 'ja',
        })
    return items


def fetch_news() -> list[dict]:
    """NHK の政治・経済・国際を統合。新しい順で最大15件"""
    all_items: list[dict] = []
    for label, url in NHK_FEEDS:
        all_items.extend(fetch_nhk(label, url, limit=8))
        time.sleep(0.3)
    all_items.sort(key=lambda x: x['pubDate'], reverse=True)
    return all_items[:15]


# ============================================================
# 6. テック (ITmedia News RSS)
# ============================================================
def fetch_itmedia(limit: int = 4) -> list[dict]:
    url = 'https://rss.itmedia.co.jp/rss/2.0/news_bursts.xml'
    try:
        xml_text = http_get(url)
        root = ET.fromstring(xml_text)
    except Exception as e:
        print(f'[itmedia] {e}')
        return []
    items = []
    channel = root.find('channel')
    if channel is None:
        return items
    for it in channel.findall('item')[: limit * 2]:
        title = (it.findtext('title') or '').strip()
        link = (it.findtext('link') or '').strip()
        date = (it.findtext('pubDate') or it.findtext('{http://purl.org/dc/elements/1.1/}date') or '').strip()
        desc = strip_html(it.findtext('description') or '')
        iso, ymd = (parse_rfc822(date) if ',' in date else parse_iso(date))
        items.append({
            'title': title,
            'url': link,
            'source': 'ITmedia NEWS',
            'pubDate': iso,
            'date': ymd,
            'body': truncate(desc, 350) if desc else '',
            'lang': 'ja',
        })
        if len(items) >= limit:
            break
    return items


# ============================================================
# 7. Wikipedia 今日のできごと (en — ja は API 未提供)
# ============================================================
def fetch_wiki_onthisday(limit: int = 4) -> list[dict]:
    today = datetime.now(JST)
    url = (
        f'https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/'
        f'{today.month:02d}/{today.day:02d}'
    )
    try:
        data = json.loads(http_get(url, accept='application/json'))
    except Exception as e:
        print(f'[wiki] {e}')
        return []
    events = data.get('events', [])
    events.sort(key=lambda e: e.get('year', 0), reverse=True)
    items = []
    for ev in events[:limit]:
        year = ev.get('year', '')
        text = ev.get('text', '').strip()
        page_url = ''
        body = text
        if ev.get('pages'):
            page = ev['pages'][0]
            page_url = page.get('content_urls', {}).get('desktop', {}).get('page', '')
            extract = page.get('extract', '')
            if extract:
                body = f'{text}  —  {extract}'
        items.append({
            'title': f'{year}: {text[:80]}',
            'url': page_url or f'https://en.wikipedia.org/wiki/{today.strftime("%B")}_{today.day}',
            'source': 'Wikipedia (Today in History)',
            'date': today.strftime('%Y-%m-%d'),
            'body': truncate(body, 500),
            'lang': 'en',
            'year': year,
        })
    return items


# ============================================================
# Gemini 要約 (短い RSS description を 200-260字に膨らませる)
# ============================================================
GEMINI_MODEL = 'gemini-2.5-flash-lite'
GEMINI_ENDPOINT = (
    f'https://generativelanguage.googleapis.com/v1beta/models/'
    f'{GEMINI_MODEL}:generateContent'
)
SUMMARY_CACHE_PATH = Path('daily/summary_cache.json')
SUMMARY_CACHE_MAX = 500


def load_summary_cache() -> dict:
    if not SUMMARY_CACHE_PATH.exists():
        return {}
    try:
        return json.loads(SUMMARY_CACHE_PATH.read_text(encoding='utf-8'))
    except Exception:
        return {}


def save_summary_cache(cache: dict) -> None:
    # キャッシュが大きくなりすぎたら古い順に削除(dict 挿入順)
    if len(cache) > SUMMARY_CACHE_MAX:
        keys = list(cache.keys())
        for k in keys[: len(cache) - SUMMARY_CACHE_MAX]:
            cache.pop(k, None)
    SUMMARY_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    SUMMARY_CACHE_PATH.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )


def call_gemini(prompt: str, api_key: str) -> str | None:
    """Gemini に prompt を投げて応答テキストを返す。失敗時 None"""
    body = {
        'contents': [{'parts': [{'text': prompt}]}],
        'generationConfig': {
            'temperature': 0.2,
            'maxOutputTokens': 600,
        },
    }
    req = urllib.request.Request(
        f'{GEMINI_ENDPOINT}?key={api_key}',
        data=json.dumps(body).encode('utf-8'),
        headers={
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/json',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode('utf-8'))
        candidates = data.get('candidates', [])
        if not candidates:
            return None
        parts = candidates[0].get('content', {}).get('parts', [])
        if not parts:
            return None
        return parts[0].get('text', '').strip()
    except urllib.error.HTTPError as e:
        msg = e.read().decode('utf-8', errors='replace')[:200] if hasattr(e, 'read') else str(e)
        print(f'[gemini] HTTP {e.code}: {msg}')
        return None
    except Exception as e:
        print(f'[gemini] {e}')
        return None


def summarize_news(title: str, body: str, category: str) -> str:
    return f"""あなたは日本語ニュースの要約者です。
以下のニュースのタイトルと冒頭文から、社会人ビジネスパーソン向けに
200〜260字の日本語要約を1段落で作成してください。

要件:
- 元の情報より大きく踏み込まず、不確かな箇所は「とされている」など曖昧表現にする
- タイトル/冒頭に出ていない数字や固有名詞は出さない
- 「〜について報じている」のようなメタ的表現は使わず、内容そのものを書く
- 改行なしの1段落、200〜260字程度

カテゴリ: {category or '一般'}
タイトル: {title}
冒頭文: {body}
"""


def summarize_paper(title: str, abstract: str, journal: str = '') -> str:
    return f"""以下の英語論文の抄録(abstract)を、日本語で 250〜300字 の要約にしてください。
読み手は医療従事者または研究者で、専門用語に親しみがあります。

要件:
- 研究の問い・対象・方法・主要な結果・含意 をできるだけ含める
- 原文に書かれていないことは書かない(数値・固有名詞は原文どおりに)
- 専門用語は無理に和訳せず英語表記のまま残しても良い
- 改行なしの1段落、250〜300字

ジャーナル: {journal or '-'}
タイトル: {title}
Abstract:
{abstract}
"""


def summarize_wiki(year, title: str, body: str) -> str:
    return f"""以下は Wikipedia 英語版「Today in History」の項目です。
日本語で 180〜240字 の要約にしてください。
日本人読者にとって馴染みの薄い人名・地名・組織には簡単な補足を入れて構いません。
ただし元の情報にないことは書かないでください。

年: {year}
タイトル: {title}
本文: {body}
"""


def add_summaries(items: list[dict], api_key: str, cache: dict, label: str,
                  prompt_builder=None) -> int:
    """items の各記事に summary を付ける。戻り値: 新規呼び出し数。
    Gemini Free Flash-Lite は 15 RPM = 4 秒に1回が上限なので、
    安全側で5秒スリープ。429 が出たら30秒待って1回だけリトライ"""
    if not api_key:
        for it in items:
            cached = cache.get(it.get('url', ''))
            if cached:
                it['summary'] = cached
        return 0
    new_calls = 0
    consecutive_429 = 0
    for it in items:
        url = it.get('url', '')
        if not url:
            continue
        if url in cache:
            it['summary'] = cache[url]
            continue
        if prompt_builder:
            prompt = prompt_builder(it)
        else:
            prompt = summarize_news(
                it.get('title', ''),
                it.get('body', '') or '(本文なし)',
                it.get('category', ''),
            )
        summary = call_gemini(prompt, api_key)
        if summary is None:
            # 429 か API エラー。1分間は完全に空けてリトライ
            consecutive_429 += 1
            if consecutive_429 >= 3:
                print(f'[gemini {label}] 連続失敗、以降スキップ')
                break
            print(f'[gemini {label}] retry after 65s')
            time.sleep(65)
            summary = call_gemini(prompt, api_key)
        if summary:
            consecutive_429 = 0
            it['summary'] = summary
            cache[url] = summary
            new_calls += 1
        time.sleep(8)  # 大きめに待つ。RPM だけでなく TPM/burst も考慮
    if new_calls:
        print(f'[gemini {label}] {new_calls} new summaries')
    return new_calls


# ============================================================
# main
# ============================================================
def main(out_path: str, archive_dir: str | None = None) -> None:
    print('--- 厚労省 ---')
    mhlw = fetch_mhlw(limit=6)

    print('--- 政治経済ニュース (NHK) ---')
    news = fetch_news()

    print('--- PubMed (経営/公衆衛生) ---')
    papers_mgmt = fetch_pubmed_topic(
        '医療経営/公衆衛生',
        '("Healthcare Management" OR "Health Policy" OR "Health Economics" OR "public health"[mh]) '
        'AND (Review[pt] OR "Journal Article"[pt])',
        limit=3,
    )

    print('--- PubMed (リハ/薬理/神経) ---')
    papers_med = fetch_pubmed_topic(
        'リハ/薬理/神経',
        '(rehabilitation OR pharmacology OR neurology) '
        'AND ("Clinical Trial"[pt] OR "Randomized Controlled Trial"[pt] OR Review[pt])',
        limit=3,
    )

    print('--- arXiv (AI/CS) ---')
    arxiv_papers = fetch_arxiv(['cs.AI', 'cs.CL', 'cs.LG'], total=3)

    print('--- ITmedia ---')
    tech = fetch_itmedia(limit=4)

    print('--- Wikipedia 今日のできごと ---')
    wiki = fetch_wiki_onthisday(limit=4)

    # AI 要約。GEMINI_API_KEY が無い時はスキップ。
    # 英語ソース(papers / arxiv / wiki) は和訳を兼ねた要約。
    print('--- Gemini 要約 ---')
    api_key = (os.environ.get('GEMINI_API_KEY') or '').strip()
    cache = load_summary_cache()

    paper_prompt = lambda it: summarize_paper(it.get('title',''), it.get('body',''), it.get('source',''))
    wiki_prompt = lambda it: summarize_wiki(it.get('year',''), it.get('title',''), it.get('body',''))

    if api_key:
        add_summaries(news,        api_key, cache, 'news')
        add_summaries(tech,        api_key, cache, 'tech')
        add_summaries(papers_mgmt, api_key, cache, 'pmgr',  paper_prompt)
        add_summaries(papers_med,  api_key, cache, 'pmed',  paper_prompt)
        add_summaries(arxiv_papers,api_key, cache, 'arxiv', paper_prompt)
        add_summaries(wiki,        api_key, cache, 'wiki',  wiki_prompt)
        save_summary_cache(cache)
    else:
        print('GEMINI_API_KEY not set; using existing cache only')
        for items in (news, tech, papers_mgmt, papers_med, arxiv_papers, wiki):
            add_summaries(items, '', cache, 'cache-only')

    out = {
        'updated_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'updated_jst': datetime.now(JST).isoformat(timespec='minutes'),
        'sources': {
            'mhlw':         '厚生労働省 新着情報 RSS',
            'news':         'NHK ニュース RSS (政治 / 経済 / 国際)',
            'papers_mgmt':  'PubMed efetch (Healthcare Management / Health Policy / Public Health, last 60d)',
            'papers_med':   'PubMed efetch (rehabilitation / pharmacology / neurology, last 60d)',
            'arxiv':        'arXiv API (cs.AI / cs.CL / cs.LG, latest)',
            'tech':         'ITmedia News RSS',
            'wiki':         'Wikipedia REST API (Today in History, en)',
        },
        'mhlw':         mhlw,
        'news':         news,
        'papers_mgmt':  papers_mgmt,
        'papers_med':   papers_med,
        'arxiv':        arxiv_papers,
        'tech':         tech,
        'wiki':         wiki,
    }

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text(
        json.dumps(out, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )

    if archive_dir:
        stamp = datetime.now(JST).strftime('%Y-%m-%d-%H%M')
        archive_path = Path(archive_dir) / f'{stamp}.json'
        archive_path.parent.mkdir(parents=True, exist_ok=True)
        archive_path.write_text(
            json.dumps(out, ensure_ascii=False, indent=2) + '\n',
            encoding='utf-8',
        )
        print(f'archive: {archive_path}')

        # アーカイブ一覧 (index.json) を更新。最新30件まで
        snapshots = sorted(
            [p for p in Path(archive_dir).glob('*.json') if p.stem != 'index'],
            reverse=True,
        )[:30]
        snap_list = []
        for p in snapshots:
            parts = p.stem.split('-')  # YYYY MM DD HHMM
            if len(parts) == 4 and len(parts[3]) == 4:
                date = '-'.join(parts[:3])
                tm = f'{parts[3][:2]}:{parts[3][2:]}'
                label = f'{date} {tm}'
            else:
                label = p.stem
            snap_list.append({'file': p.name, 'label': label})
        index_path = Path(archive_dir) / 'index.json'
        index_path.write_text(
            json.dumps({
                'updated_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
                'snapshots': snap_list,
            }, ensure_ascii=False, indent=2) + '\n',
            encoding='utf-8',
        )

    counts = (
        f'mhlw {len(mhlw)} / news {len(news)} / '
        f'pmgr {len(papers_mgmt)} / pmed {len(papers_med)} / '
        f'arxiv {len(arxiv_papers)} / tech {len(tech)} / wiki {len(wiki)}'
    )
    print(f'wrote {out_path} ({counts})')


if __name__ == '__main__':
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else 'daily/feed.json'
    archive = sys.argv[2] if len(sys.argv) > 2 else None
    main(out, archive)
