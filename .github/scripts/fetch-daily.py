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
# 5. 経済の数字 (Stooq CSV)
# ============================================================
STOOQ_TICKERS = [
    ('日経平均',     '^nkx'),
    ('TOPIX',       '^tpx'),
    ('USDJPY',      'usdjpy'),
    ('EURJPY',      'eurjpy'),
    ('S&P 500',     '^spx'),
    ('NASDAQ',      '^ndq'),
    ('米10年金利',   '10usy.b'),
]


def fetch_stooq_quote(symbol: str) -> dict | None:
    url = f'https://stooq.com/q/l/?s={symbol}&f=sd2t2ohlcv&h&e=csv'
    try:
        text = http_get(url)
        lines = [l for l in text.strip().splitlines() if l]
        if len(lines) < 2:
            return None
        header = [h.strip().lower() for h in lines[0].split(',')]
        cols = lines[1].split(',')
        row = dict(zip(header, cols))
        close = row.get('close', '')
        if close in ('', 'N/D'):
            return None
        return {
            'date': row.get('date', ''),
            'close': close,
            'open': row.get('open', ''),
            'high': row.get('high', ''),
            'low': row.get('low', ''),
        }
    except Exception as e:
        print(f'[stooq {symbol}] {e}')
        return None


def fetch_market() -> dict:
    out = {'updated': datetime.now(JST).isoformat(timespec='minutes'), 'rows': []}
    for name, sym in STOOQ_TICKERS:
        q = fetch_stooq_quote(sym)
        if not q:
            continue
        out['rows'].append({
            'name': name,
            'symbol': sym.upper(),
            'date': q['date'],
            'close': q['close'],
            'open': q['open'],
            'high': q['high'],
            'low': q['low'],
        })
        time.sleep(0.2)
    return out


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
# main
# ============================================================
def main(out_path: str, archive_dir: str | None = None) -> None:
    print('--- 厚労省 ---')
    mhlw = fetch_mhlw(limit=6)

    print('--- PubMed (経営/公衆衛生) ---')
    papers_mgmt = fetch_pubmed_topic(
        '医療経営/公衆衛生',
        '("Healthcare Management" OR "Health Policy" OR "Health Economics" OR "public health"[mh]) '
        'AND (Review[pt] OR "Journal Article"[pt])',
        limit=5,
    )

    print('--- PubMed (リハ/薬理/神経) ---')
    papers_med = fetch_pubmed_topic(
        'リハ/薬理/神経',
        '(rehabilitation OR pharmacology OR neurology) '
        'AND ("Clinical Trial"[pt] OR "Randomized Controlled Trial"[pt] OR Review[pt])',
        limit=5,
    )

    print('--- arXiv (AI/CS) ---')
    arxiv_papers = fetch_arxiv(['cs.AI', 'cs.CL', 'cs.LG'], total=5)

    print('--- 経済 ---')
    market = fetch_market()

    print('--- ITmedia ---')
    tech = fetch_itmedia(limit=4)

    print('--- Wikipedia 今日のできごと ---')
    wiki = fetch_wiki_onthisday(limit=4)

    out = {
        'updated_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'updated_jst': datetime.now(JST).isoformat(timespec='minutes'),
        'sources': {
            'mhlw':         '厚生労働省 新着情報 RSS',
            'papers_mgmt':  'PubMed efetch (Healthcare Management / Health Policy / Public Health, last 60d)',
            'papers_med':   'PubMed efetch (rehabilitation / pharmacology / neurology, last 60d)',
            'arxiv':        'arXiv API (cs.AI / cs.CL / cs.LG, latest)',
            'market':       'Stooq CSV (Nikkei / TOPIX / FX / SP500 / NASDAQ / US10Y)',
            'tech':         'ITmedia News RSS',
            'wiki':         'Wikipedia REST API (Today in History, en)',
        },
        'mhlw':         mhlw,
        'papers_mgmt':  papers_mgmt,
        'papers_med':   papers_med,
        'arxiv':        arxiv_papers,
        'market':       market,
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
        f'mhlw {len(mhlw)} / pmgr {len(papers_mgmt)} / pmed {len(papers_med)} / '
        f'arxiv {len(arxiv_papers)} / market {len(market.get("rows", []))} / '
        f'tech {len(tech)} / wiki {len(wiki)}'
    )
    print(f'wrote {out_path} ({counts})')


if __name__ == '__main__':
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else 'daily/feed.json'
    archive = sys.argv[2] if len(sys.argv) > 2 else None
    main(out, archive)
