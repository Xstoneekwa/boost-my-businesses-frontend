"""Deterministic, conservative public evidence normalization. No network or execution."""
import hashlib
import html
import ipaddress
import json
import re
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

UTC = timezone.utc
TAXONOMY = {'FOLLOW_BLOCKED', 'UNFOLLOW_BLOCKED', 'ACTION_BLOCKED', 'TRY_AGAIN_LATER',
            'FOLLOW_LIMIT_LOW', 'UNFOLLOW_LIMIT_LOW', 'DM_RESTRICTED', 'LIKE_RESTRICTED',
            'COMMENT_RESTRICTED', 'GENERIC_RATE_LIMIT', 'UNKNOWN_ACTION_RESTRICTION', 'OTHER'}
REQUIRED = {'source', 'source_url', 'published_at', 'title', 'text_or_excerpt'}
SECRET = re.compile(r'(?i)(password|passwd|authorization|bearer\s|api[_ -]?key|service_role|'
                    r'cookie|secret|credential|screenshot|dump[_ -]?xml|access[_ -]?token|refresh[_ -]?token|adb[_ -]?serial|<hierarchy|'
                    r'-----BEGIN .*PRIVATE KEY|[a-z]+://[^\s/:]+:[^\s/@]+@)')


def now_iso():
    return datetime.now(UTC).isoformat().replace('+00:00', 'Z')


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def safe_input(value):
    encoded = json.dumps(value, ensure_ascii=False)
    if len(encoded.encode()) > 524288 or SECRET.search(encoded):
        raise ValueError('UNSAFE_OR_OVERSIZED_INPUT')
    return value


def parse_time(value):
    if not isinstance(value, str) or not re.search(r'T.*(?:Z|[+-]\d\d:\d\d)$', value):
        return None
    try:
        dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return dt.astimezone(UTC) if dt.tzinfo else None
    except ValueError:
        return None


def canonical_url(value):
    if not isinstance(value, str) or len(value) > 4096:
        raise ValueError('INVALID_PUBLIC_URL')
    p = urlsplit(value)
    host = (p.hostname or '').lower().rstrip('.')
    if p.scheme != 'https' or not host or p.username or p.password or p.port not in (None, 443):
        raise ValueError('INVALID_PUBLIC_URL')
    if host == 'localhost' or '.' not in host or host.endswith(('.local', '.localhost', '.internal')):
        raise ValueError('PRIVATE_URL')
    try:
        if not ipaddress.ip_address(host).is_global:
            raise ValueError('PRIVATE_URL')
    except ValueError as error:
        if str(error) == 'PRIVATE_URL':
            raise
    if host in ('old.reddit.com', 'reddit.com', 'm.reddit.com'):
        host = 'www.reddit.com'
    query = [(k, v) for k, v in parse_qsl(p.query) if not k.lower().startswith('utm_')
             and k.lower() not in {'ref', 'share', 'context', 'sort', 'fbclid', 'gclid'}]
    return urlunsplit(('https', host, p.path.rstrip('/') or '/', urlencode(sorted(query)), ''))


def family(url):
    host = urlsplit(url).hostname
    if host == 'reddit.com' or host.endswith('.reddit.com'):
        return 'reddit'
    if host in ('x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'):
        return 'x'
    if host in ('metastatus.com', 'www.metastatus.com', 'help.instagram.com', 'about.instagram.com',
                'developers.facebook.com'):
        return 'meta'
    if host == 'downdetector.com' or host.endswith('.downdetector.com'):
        return 'downdetector'
    # Without a PSL dependency, conservatively merge shared suffixes (co.uk may
    # over-merge unrelated sites; it must never inflate independence).
    return '.'.join(host.split('.')[-2:])


def plain(text):
    text = re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]+>', ' ', str(text)))).strip()
    # Reddit Atom adds attribution/navigation outside the user's testimony.
    return re.split(r'\s+submitted by\s+', text, maxsplit=1, flags=re.I)[0].strip()


def classify(text):
    t = plain(text).lower().replace('’', "'")
    if re.search(r'\b(not blocked|no restrictions|never been blocked|can follow without|can unfollow without)\b', t) and not re.search(r"\b(but|however|can't|cannot|unable)\b", t):
        return 'OTHER'
    if re.search(r'(people|others|users|they) (cannot|can.t|are unable to) follow me', t):
        return 'OTHER'
    if re.search(r'\b(not unable|no longer (?:blocked|restricted)|not (?:follow|unfollow) blocked)\b', t):
        return 'OTHER'
    blocked = r'(can.t|cannot|can no longer|unable|blocked|restrict\w*|limit\w*|only|won.t|not letting)'
    def related(pattern):
        return bool(re.search(blocked + r'[^.!?;]{0,45}' + pattern, t)
                    or re.search(pattern + r'[^.!?;]{0,25}' + blocked, t))
    for word, action, low in [('unfollow', 'UNFOLLOW_BLOCKED', 'UNFOLLOW_LIMIT_LOW'),
                              ('follow', 'FOLLOW_BLOCKED', 'FOLLOW_LIMIT_LOW')]:
        if related(r'\b' + word + r'(?:s|ing)?\b'):
            if re.search(r'\b(?:low|only|reduced)\b', t) and re.search(r'\d', t):
                return low
            return action
    for pattern, action in [(r'\b(dm|dms|messages|messaging)\b', 'DM_RESTRICTED'),
                            (r'\b(like|likes|liking)\b', 'LIKE_RESTRICTED'),
                            (r'\b(comment|comments|commenting)\b', 'COMMENT_RESTRICTED')]:
        if 'notification' in t and action == 'DM_RESTRICTED' and not re.search(r'(can.t|cannot|unable to) send', t):
            continue
        if related(pattern):
            return action
    if any(x in t for x in ('reach', 'reels', 'video', 'log in', 'login', 'posting', 'outage', 'notification', 'collection')):
        return 'OTHER'
    if 'try again later' in t:
        return 'TRY_AGAIN_LATER'
    if 'action blocked' in t:
        return 'ACTION_BLOCKED'
    if 'rate limit' in t or 'we limit how often' in t:
        return 'GENERIC_RATE_LIMIT'
    return 'UNKNOWN_ACTION_RESTRICTION' if re.search(blocked, t) else 'OTHER'


def extract_threshold(text):
    t = text.lower().replace('–', '-').replace('—', '-')
    m = re.search(r'(?:only|around|about|after|~)\s*(\d+)\s*(?:-\s*(\d+))?\s*(?:successful\s+)?(unfollows?|follows?|people|messages|likes|comments)\b', t)
    if not m:
        return None
    period = re.search(r'(?:after|per|in|within)\s+(?:\d+\s+)?(?:hours?|days?|minutes?)', t)
    return {'min': int(m[1]), 'max': int(m[2] or m[1]), 'unit': m[3],
            'period_text': period[0] if period else None, 'evidence': m[0], 'self_reported': True}


def normalize(item, mode='MANUAL', collected_at=None):
    if not isinstance(item, dict) or not REQUIRED <= item.keys():
        raise ValueError('MISSING_EVIDENCE_FIELDS')
    safe_input(item)
    for field in ('source', 'source_url', 'title', 'text_or_excerpt'):
        if not isinstance(item[field], str):
            raise ValueError('INVALID_EVIDENCE_FIELD:' + field)
    if item['published_at'] is not None and not isinstance(item['published_at'], str):
        raise ValueError('INVALID_PUBLICATION_FIELD')
    for field in ('region', 'account_age_context', 'notes', 'publication_provenance', 'duration_reported'):
        if item.get(field) is not None and (not isinstance(item[field], str) or len(item[field]) > 1000):
            raise ValueError('INVALID_OPTIONAL_FIELD:' + field)
    if mode not in ('MANUAL', 'AUTOMATIC'):
        raise ValueError('INVALID_INGEST_MODE')
    collected_at = collected_at or now_iso()
    collected = parse_time(collected_at)
    if not collected:
        raise ValueError('INVALID_COLLECTION_TIME')
    url = canonical_url(item['source_url'])
    origin_url = canonical_url(item.get('original_source_url') or url)
    origin = family(origin_url)
    text = plain(item['text_or_excerpt'])[:500]
    action = classify(item['title'] + ' ' + text)
    supplied = item.get('action_type')
    if supplied is not None and supplied not in TAXONOMY:
        raise ValueError('INVALID_ACTION_TYPE')
    # Explicit metadata cannot manufacture a specific symptom contradicted by the excerpt.
    if supplied and supplied != action and action != 'OTHER':
        if supplied in ('FOLLOW_LIMIT_LOW', 'UNFOLLOW_LIMIT_LOW') and extract_threshold(text):
            action = supplied
    published = parse_time(item['published_at'])
    day_only = isinstance(item['published_at'], str) and bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}', item['published_at']))
    precision = 'SECOND' if published else ('DAY' if day_only else 'UNKNOWN')
    conflict = bool(item.get('date_conflict', False))
    author = item.get('author_reference')
    if author is not None and not isinstance(author, str):
        raise ValueError('INVALID_AUTHOR')
    author_key = digest(origin + ':' + author.strip().lower()) if author and author.strip() else None
    exclusions = []
    if conflict:
        exclusions.append('PUBLICATION_CONFLICT')
    if not published:
        exclusions.append('PUBLICATION_TIME_UNVERIFIED')
    elif published > collected:
        exclusions.append('FUTURE_PUBLICATION')
    if not author_key:
        exclusions.append('AUTHOR_UNVERIFIED')
    if author and author.lower().strip().removeprefix('/u/') in ('automoderator', '[deleted]', '[removed]'):
        exclusions.append('NON_INDEPENDENT_AUTHOR')
    kind = item.get('evidence_kind', 'PERSONAL_REPORT')
    if kind not in ('PERSONAL_REPORT', 'GUIDE', 'REPOST', 'OFFICIAL_GUIDANCE', 'OTHER'):
        raise ValueError('INVALID_EVIDENCE_KIND')
    combined = item['title'] + ' ' + text
    if not re.search(r"\b(I|my|we|our|je|mon|mes|nous)\b", combined, re.I) or text.lower() in ('same', 'same here', '+1'):
        exclusions.append('NOT_PERSONAL_TESTIMONY')
    if re.search(r'\b(how to fix|\d+ ways to|complete guide|buy followers)\b', combined, re.I):
        exclusions.append('GENERIC_GUIDE')
    if kind != 'PERSONAL_REPORT':
        exclusions.append('NOT_PERSONAL_REPORT')
    if origin in ('google.com', 'bing.com', 'yahoo.com'):
        exclusions.append('AGGREGATOR_NOT_ORIGINAL_SOURCE')
    if action == 'OTHER':
        exclusions.append('OTHER_SYMPTOM')
    native = re.search(r'/comments/([a-z0-9]+)(?:/[^/]+/([a-z0-9]+))?', origin_url)
    native_id = ':'.join(x for x in native.groups() if x) if native else None
    identity = origin + ':' + native_id if native_id else origin_url
    group_url = canonical_url(item['crosspost_parent_url']) if item.get('crosspost_parent_url') else origin_url
    threshold = item.get('reported_threshold')
    if threshold is not None:
        # Structured metadata retained only if supported by an explicit excerpt of the source.
        if not isinstance(threshold, dict) or not threshold.get('evidence') or threshold['evidence'].lower() not in text.lower():
            raise ValueError('THRESHOLD_REQUIRES_LITERAL_EVIDENCE')
        threshold = extract_threshold(threshold['evidence'])
        if threshold is None:
            raise ValueError('THRESHOLD_NOT_EXTRACTABLE')
    else:
        threshold = extract_threshold(text)
    credibility = (item['source_credibility'] if 'source_credibility' in item
                   else ('HIGH' if origin == 'meta' and kind == 'OFFICIAL_GUIDANCE'
                         else 'MEDIUM' if origin == 'reddit' else 'CONTEXTUAL'))
    if credibility not in ('HIGH', 'MEDIUM', 'LOW', 'CONTEXTUAL'):
        raise ValueError('INVALID_SOURCE_CREDIBILITY')
    access_status = item.get('access_status', 'WORKING' if mode == 'MANUAL' else 'LIMITED')
    if access_status not in ('WORKING', 'LIMITED', 'BLOCKED', 'UNKNOWN'):
        raise ValueError('INVALID_ACCESS_STATUS')
    if origin == 'meta' and kind == 'OFFICIAL_GUIDANCE':
        exclusions = [x for x in exclusions if x not in ('AUTHOR_UNVERIFIED', 'NOT_PERSONAL_REPORT', 'NOT_PERSONAL_TESTIMONY')]
    content_hash = digest(plain(item['title']) + '\n' + text)
    raw_reference = 'sha256:' + digest(json.dumps(item, ensure_ascii=False, sort_keys=True))
    action_family = comparable(action)
    return {'id': digest(identity), 'source': origin, 'source_label': item['source'], 'source_url': url,
            'source_native_id': native_id, 'canonical_url': url, 'url': url, 'retrieved_at': collected_at,
            'original_source_url': origin_url, 'published_at': published.isoformat().replace('+00:00', 'Z') if published else item['published_at'],
            'publication_precision': precision, 'publication_provenance': item.get('publication_provenance', 'SOURCE_ASSERTED'),
            'publication_date_confidence': 'HIGH' if precision == 'SECOND' and not conflict else 'LOW',
            'date_conflict': conflict, 'collected_at': collected_at, 'title': plain(item['title'])[:300],
            'short_summary': text[:350], 'action_type': action, 'reported_threshold': threshold,
            'first_seen': collected_at, 'last_seen': collected_at, 'platform': 'INSTAGRAM',
            'signal_type': 'OFFICIAL_STATUS' if origin == 'meta' and kind == 'OFFICIAL_GUIDANCE' else 'USER_REPORT',
            'action_family': action_family, 'symptom_family': action,
            'geography': item.get('region'), 'platform_version': item.get('platform_version'),
            'source_credibility': credibility, 'access_status': access_status,
            'freshness': 'CURRENT' if published and 0 <= (collected - published).total_seconds() <= 86400 else 'STALE', 'volume': 1, 'velocity': 0,
            'official_confirmation': origin == 'meta' and kind == 'OFFICIAL_GUIDANCE',
            'content_hash': content_hash, 'dedupe_key': digest(identity), 'cluster_id': None,
            'exclusion_reason': sorted(set(exclusions)), 'raw_reference': raw_reference,
            'source_family': origin, 'summary': text[:350],
            'duration_reported': item.get('duration_reported'), 'account_age_context': item.get('account_age_context'),
            'region': item.get('region'), 'confidence': 'LOW', 'raw_evidence': text[:500],
            'author_key': author_key, 'native_id': native_id, 'origin_group_id': digest(group_url),
            'content_fingerprint': digest(re.sub(r'\W+', ' ', text.lower()).strip()),
            'first_collected_at': collected_at, 'last_collected_at': collected_at,
            'evidence_kind': kind, 'exclusion_reasons': sorted(set(exclusions)),
            'evidence_ingest_mode': mode, 'ingest_modes': [mode], 'notes': item.get('notes'),
            'supplied_action_type': supplied,
            'synthetic': bool(item.get('synthetic', False))}


def comparable(action):
    return {'FOLLOW': 'FOLLOW', 'FOLLOW_BLOCKED': 'FOLLOW', 'FOLLOW_LIMIT_LOW': 'FOLLOW',
            'DM_RESTRICTED': 'DM', 'LIKE_RESTRICTED': 'LIKE', 'COMMENT_RESTRICTED': 'COMMENT', 'TRY_AGAIN_LATER': 'RATE_LIMIT', 'ACTION_BLOCKED': 'RATE_LIMIT', 'GENERIC_RATE_LIMIT': 'RATE_LIMIT', 'UNFOLLOW': 'UNFOLLOW', 'UNFOLLOW_BLOCKED': 'UNFOLLOW', 'UNFOLLOW_LIMIT_LOW': 'UNFOLLOW'}.get(action, action)


def independent(signals):
    """Union connected author/copy/origin groups; transitive copies cannot inflate counts."""
    groups = []
    for s in sorted(signals, key=lambda x: x['published_at'] or ''):
        keys = {(kind, s.get(field)) for kind, field in (
            ('author', 'author_key'), ('origin', 'origin_group_id'), ('copy', 'content_fingerprint')) if s.get(field)}
        evidence = s.get('raw_evidence') or s.get('summary') or s.get('short_summary') or ''
        words = set(re.findall(r'\w+', evidence.lower()))
        def near_copy(other):
            other_evidence = other.get('raw_evidence') or other.get('summary') or other.get('short_summary') or ''
            other_words = set(re.findall(r'\w+', other_evidence.lower()))
            return (len(words) >= 15 and len(other_words) >= 15
                    and len(words & other_words) / len(words | other_words) >= 0.9)
        overlapping = [g for g in groups if g[0] & keys or any(near_copy(r) for r in g[1])]
        rows = [s]
        for g in overlapping:
            keys |= g[0]
            rows += g[1]
            groups.remove(g)
        groups.append((keys, rows))
    representatives = []
    for _, rows in groups:
        representative = dict(min(rows, key=lambda s: (s['published_at'] or '', s['id'])))
        representative['independence_confidence'] = ('FULL' if all(row.get('raw_evidence') for row in rows)
                                                     else 'REDUCED_AFTER_RAW_PURGE')
        representatives.append(representative)
    return representatives
