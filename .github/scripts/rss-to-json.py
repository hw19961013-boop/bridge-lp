"""
note.com の RSS を読み、LP が描画しやすい JSON に整形する。
入力: RSS XML ファイル(curl で取得済み)
出力: JSON (notes/feed.json)
"""
from __future__ import annotations
import sys
import json
import re
import html
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {
    'media': 'http://search.yahoo.com/mrss/',
}

MAX_ITEMS = 6
EXCERPT_LEN = 110


def strip_html(s: str) -> str:
    # CDATA 中の HTML を除去。「続きをみる」のリンクも捨てる。
    s = re.sub(r'<a [^>]*>続きをみる</a>', '', s)
    s = re.sub(r'<[^>]+>', '', s)
    s = html.unescape(s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def truncate(s: str, n: int) -> str:
    if len(s) <= n:
        return s
    return s[: n - 1].rstrip() + '…'


def parse_date(rfc822: str) -> tuple[str, str]:
    # 戻り値: (ISO8601, YYYY-MM-DD)
    try:
        dt = parsedate_to_datetime(rfc822)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat(), dt.strftime('%Y-%m-%d')
    except Exception:
        return rfc822, rfc822[:10]


def main(in_path: str, out_path: str) -> None:
    xml = Path(in_path).read_text(encoding='utf-8')
    root = ET.fromstring(xml)
    channel = root.find('channel')
    if channel is None:
        raise SystemExit('RSS に channel 要素がありません')

    items = []
    for it in channel.findall('item'):
        title = (it.findtext('title') or '').strip()
        link = (it.findtext('link') or '').strip()
        guid = (it.findtext('guid') or link).strip()
        pub = (it.findtext('pubDate') or '').strip()
        desc_raw = it.findtext('description') or ''
        excerpt = truncate(strip_html(desc_raw), EXCERPT_LEN)
        thumb_el = it.find('media:thumbnail', NS)
        thumb = thumb_el.text.strip() if thumb_el is not None and thumb_el.text else ''
        iso, ymd = parse_date(pub)
        items.append({
            'title': title,
            'url': link or guid,
            'guid': guid,
            'pubDate': iso,
            'date': ymd,
            'excerpt': excerpt,
            'thumbnail': thumb,
        })

    items.sort(key=lambda x: x['pubDate'], reverse=True)
    items = items[:MAX_ITEMS]

    out = {
        'updated_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'source': 'https://note.com/prime_duck4944/rss',
        'count': len(items),
        'items': items,
    }
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text(
        json.dumps(out, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    print(f'wrote {out_path} ({len(items)} items)')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('usage: rss-to-json.py <input.xml> <output.json>')
    main(sys.argv[1], sys.argv[2])
