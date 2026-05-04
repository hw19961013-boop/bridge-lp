"""
朝の読み物ダッシュボード用に、医療・経済・論文の最新を1ファイル(JSON)に集約する。

ソース:
  - 医療  : Google News RSS (キーワード「診療報酬」「医療経営」)
  - 経済  : Google News RSS (キーワード「日経平均」「日経新聞」+ site:nikkei.com)
  - 論文  : PubMed E-utilities API
            (rehabilitation / pharmacology / neurology / public health の直近記事)

すべて認証不要・無料。失敗しても部分的に動く(個別 try/except)。
"""
from __future__ import annotations
import json
import re
import html
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import xml.etree.ElementTree as ET
from pathlib import Path

USER_AGENT = 'bridge-lp-daily-refresher (+https://github.com/bridge-med/bridge-lp)'
TIMEOUT = 20
ITEMS_PER_CATEGORY = 6
EXCERPT_LEN = 90


# ============================================================
# 共通ユーティリティ
# ============================================================
def http_get(url: str) -> str:
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.read().decode('utf-8', errors='replace')


def strip_html(s: str) -> str:
    s = re.sub(r'<[^>]+>', '', s)
    s = html.unescape(s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def truncate(s: str, n: int) -> str:
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
        return s, s[:10]


# ============================================================
# Google News RSS
# ============================================================
def google_news_rss(query: str) -> list[dict]:
    """検索クエリを Google News RSS にかけて item 一覧を返す"""
    q = urllib.parse.quote(query)
    url = f'https://news.google.com/rss/search?q={q}&hl=ja&gl=JP&ceid=JP:ja'
    try:
        xml_text = http_get(url)
        root = ET.fromstring(xml_text)
    except Exception as e:
        print(f'[news] failed: {query}: {e}')
        return []
    items = []
    channel = root.find('channel')
    if channel is None:
        return items
    for it in channel.findall('item'):
        title = (it.findtext('title') or '').strip()
        link = (it.findtext('link') or '').strip()
        pub = (it.findtext('pubDate') or '').strip()
        desc = strip_html(it.findtext('description') or '')
        source_el = it.find('source')
        source = source_el.text.strip() if source_el is not None and source_el.text else ''
        # Google News のタイトル末尾は「 - 媒体名」が多い → 媒体名を抽出/除去
        m = re.search(r'\s+-\s+([^-]+)$', title)
        if m and not source:
            source = m.group(1).strip()
            title = title[: m.start()].rstrip()
        elif m and source:
            title = title[: m.start()].rstrip()
        iso, ymd = parse_rfc822(pub)
        items.append({
            'title': title,
            'url': link,
            'source': source,
            'pubDate': iso,
            'date': ymd,
            'excerpt': truncate(desc, EXCERPT_LEN) if desc else '',
        })
    return items


def merge_news(queries: list[str], limit: int) -> list[dict]:
    """複数クエリの結果をマージ・URL重複排除・最新順で limit 件に"""
    seen = set()
    bag: list[dict] = []
    for q in queries:
        for it in google_news_rss(q):
            key = it['url']
            if key in seen or not key:
                continue
            seen.add(key)
            bag.append(it)
        time.sleep(0.5)  # Google に優しく
    bag.sort(key=lambda x: x['pubDate'], reverse=True)
    return bag[:limit]


# ============================================================
# PubMed E-utilities (論文)
# ============================================================
def pubmed_search(term: str, retmax: int = 5) -> list[str]:
    """PubMed esearch で id 一覧を取得(直近順)"""
    url = (
        'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi'
        '?db=pubmed&retmode=json&sort=date'
        f'&term={urllib.parse.quote(term)}&retmax={retmax}'
    )
    try:
        data = json.loads(http_get(url))
        return data.get('esearchresult', {}).get('idlist', [])
    except Exception as e:
        print(f'[pubmed search] failed: {term}: {e}')
        return []


def pubmed_summary(ids: list[str]) -> list[dict]:
    """esummary で id 群のメタデータ取得"""
    if not ids:
        return []
    url = (
        'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi'
        f'?db=pubmed&retmode=json&id={",".join(ids)}'
    )
    try:
        data = json.loads(http_get(url))
        result = data.get('result', {})
        items = []
        for pmid in result.get('uids', []):
            d = result.get(pmid, {})
            title = d.get('title', '').strip()
            journal = d.get('fulljournalname') or d.get('source') or ''
            authors = d.get('authors') or []
            first_author = authors[0]['name'] if authors else ''
            pubdate = d.get('pubdate', '')
            sortpubdate = d.get('sortpubdate', '')
            ymd = sortpubdate[:10] if sortpubdate else pubdate[:10]
            items.append({
                'title': title,
                'url': f'https://pubmed.ncbi.nlm.nih.gov/{pmid}/',
                'source': journal,
                'authors': first_author + (' et al.' if len(authors) > 1 else ''),
                'pubDate': sortpubdate or pubdate,
                'date': ymd,
                'pmid': pmid,
            })
        return items
    except Exception as e:
        print(f'[pubmed summary] failed: {e}')
        return []


def fetch_pubmed_topics(topics: list[str], per_topic: int, total: int) -> list[dict]:
    """複数トピックを横断して直近論文を集める"""
    bag: list[dict] = []
    seen = set()
    for t in topics:
        # 直近30日に絞り込み・review/clinical trial を優先
        term = (
            f'({t}) AND '
            f'("last 30 days"[edat]) AND '
            f'(Review[pt] OR "Clinical Trial"[pt] OR "Randomized Controlled Trial"[pt])'
        )
        ids = pubmed_search(term, retmax=per_topic)
        time.sleep(0.4)  # NCBI 推奨 3req/sec 未満
        for s in pubmed_summary(ids):
            if s['url'] in seen:
                continue
            seen.add(s['url'])
            s['topic'] = t
            bag.append(s)
        time.sleep(0.4)
    bag.sort(key=lambda x: x['pubDate'], reverse=True)
    return bag[:total]


# ============================================================
# main
# ============================================================
def main(out_path: str) -> None:
    print('--- medical news ---')
    medical = merge_news(['診療報酬', '医療経営', '医療政策'], limit=ITEMS_PER_CATEGORY)

    print('--- economy news ---')
    economy = merge_news(
        ['site:nikkei.com', '日経平均', '日銀'],
        limit=ITEMS_PER_CATEGORY,
    )

    print('--- pubmed papers ---')
    papers = fetch_pubmed_topics(
        topics=[
            'rehabilitation',
            'pharmacology',
            'neurology',
            'healthcare management',
            'public health',
        ],
        per_topic=2,
        total=ITEMS_PER_CATEGORY,
    )

    out = {
        'updated_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'sources': {
            'medical': 'Google News RSS (診療報酬 / 医療経営 / 医療政策)',
            'economy': 'Google News RSS (日経新聞 / 日経平均 / 日銀)',
            'papers': 'PubMed E-utilities (rehabilitation / pharmacology / neurology / healthcare management / public health, last 30 days)',
        },
        'medical': medical,
        'economy': economy,
        'papers': papers,
    }
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text(
        json.dumps(out, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    print(f'wrote {out_path} '
          f'(med {len(medical)} / eco {len(economy)} / pap {len(papers)})')


if __name__ == '__main__':
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else 'daily/feed.json'
    main(out)
