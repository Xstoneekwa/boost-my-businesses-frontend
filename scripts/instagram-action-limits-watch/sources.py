"""Bounded public collectors. No browser, credentials, proxy, or 403 bypass."""
import email.utils
import http.client
import ipaddress
import socket
import ssl
import xml.etree.ElementTree as ET
from datetime import timedelta
from urllib.parse import urlsplit, urljoin
from normalize import now_iso, parse_time, plain

ALLOWED_URLS = {
    'https://www.reddit.com/r/Instagram/new/.rss',
    'https://www.reddit.com/r/InstagramMarketing/new/.rss',
}


def validate_url(url):
    if url not in ALLOWED_URLS:
        raise ValueError('NETWORK_ALLOWLIST_DENIED')
    return urlsplit(url)


class PinnedHTTPS(http.client.HTTPSConnection):
    """Resolve once, reject every non-global address, connect to a validated IP with TLS/SNI."""
    def connect(self):
        addresses = socket.getaddrinfo(self.host, self.port, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
            raise ValueError('PRIVATE_NETWORK_DENIED')
        raw = socket.create_connection((addresses[0][4][0], self.port), self.timeout)
        try:
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
        except Exception:
            raw.close()
            raise


def public_get(url, headers, timeout=20, body_max=524288):
    seen = set()
    for _ in range(3):
        p = validate_url(url)
        if url in seen:
            raise ValueError('REDIRECT_LOOP')
        seen.add(url)
        connection = PinnedHTTPS(p.hostname, timeout=timeout, context=ssl.create_default_context())
        try:
            connection.request('GET', p.path, headers=headers)
            response = connection.getresponse()
            out_headers = {k.lower(): v for k, v in response.getheaders()}
            if response.status in (301, 302, 303, 307, 308):
                url = urljoin(url, out_headers.get('location', ''))
                validate_url(url)
                continue
            if int(out_headers.get('content-length', '0')) > body_max:
                raise ValueError('BODY_TOO_LARGE')
            body = response.read(body_max + 1)
            if len(body) > body_max:
                raise ValueError('BODY_TOO_LARGE')
            return response.status, out_headers, body
        finally:
            connection.close()
    raise ValueError('TOO_MANY_REDIRECTS')


def retry_at(value, now, fallback=86400):
    try:
        seconds = max(0, int(value))
        return (now + timedelta(seconds=seconds)).isoformat()
    except (ValueError, TypeError):
        try:
            date = email.utils.parsedate_to_datetime(value)
            if date.tzinfo and date > now:
                return date.isoformat()
        except (ValueError, TypeError, OverflowError):
            pass
    return (now + timedelta(seconds=fallback)).isoformat()


def parse_atom(body):
    if b'<!DOCTYPE' in body.upper() or b'<!ENTITY' in body.upper():
        raise ValueError('XML_ENTITIES_DENIED')
    root = ET.fromstring(body)
    ns = {'a': 'http://www.w3.org/2005/Atom'}
    if root.tag != '{http://www.w3.org/2005/Atom}feed':
        raise ValueError('NOT_ATOM')
    items = []
    for e in root.findall('a:entry', ns)[:100]:
        link = e.find('a:link', ns)
        if link is None:
            continue
        items.append({'source': 'reddit', 'source_url': link.get('href'),
                      'published_at': e.findtext('a:published', namespaces=ns),
                      # Atom updated is intentionally never a publication fallback.
                      'publication_provenance': 'ATOM_PUBLISHED',
                      'title': e.findtext('a:title', default='', namespaces=ns),
                      'text_or_excerpt': plain(e.findtext('a:content', default='', namespaces=ns)),
                      'author_reference': e.findtext('a:author/a:name', namespaces=ns)})
    return items


def collect_source(config, source, previous=None, transport=public_get, at=None):
    at = at or now_iso()
    now = parse_time(at)
    previous = previous or {}
    check = {'source_id': source['id'], 'checked_at': at, 'status': 'SOURCE_UNAVAILABLE',
             'reason': None, 'observed': False, 'collection_success': False, 'last_success_at': previous.get('last_success_at'),
             'origin_family': 'reddit' if source['id'].startswith('reddit_') else {'meta_status': 'meta', 'downdetector': 'downdetector'}.get(source['id']),
             'coverage_complete': False, 'coverage_status': 'DEGRADED', 'http_status': None,
             'access_status': source.get('access_status', 'UNKNOWN'),
             'source_credibility': source.get('source_credibility', 'LOW')}
    if not source.get('enabled'):
        check['reason'] = source.get('reason', 'NOT_PROVEN_ACCESSIBLE')
        return check, []
    if previous.get('disabled'):
        check.update(reason='DISABLED_AFTER_REFUSAL', disabled=True)
        return check, []
    until = parse_time(previous.get('next_allowed_at'))
    if until and now < until:
        check.update(reason='COOLDOWN', next_allowed_at=previous['next_allowed_at'],
                     etag=previous.get('etag'), last_modified=previous.get('last_modified'),
                     entry_urls=previous.get('entry_urls', []))
        return check, []
    headers = {'User-Agent': config['user_agent'], 'Accept': 'application/atom+xml', 'Accept-Encoding': 'identity'}
    if previous.get('etag'):
        headers['If-None-Match'] = previous['etag']
    if previous.get('last_modified'):
        headers['If-Modified-Since'] = previous['last_modified']
    cadence = source.get('collection_interval_seconds', config['collection_interval_seconds'])
    check['next_allowed_at'] = (now + timedelta(seconds=cadence)).isoformat()
    try:
        status, response_headers, body = transport(source['url'], headers, config['timeout_seconds'], config['body_max_bytes'])
        check['http_status'] = status
        if status in (401, 403):
            check.update(reason='AUTH_OR_BLOCKED', disabled=True, access_status='BLOCKED')
            return check, []
        if status == 429:
            check.update(reason='RATE_LIMITED', next_allowed_at=retry_at(response_headers.get('retry-after'), now, config['cooldown_seconds']))
            return check, []
        if status == 304:
            if not previous.get('entry_urls'):
                check.update(reason='UNEXPECTED_304')
                return check, []
            check.update(status='NOT_MODIFIED', reason='BOUNDED_FEED_ONLY', observed=True, collection_success=True, last_success_at=at, coverage_status='PARTIAL',
                         entry_urls=previous['entry_urls'], etag=previous.get('etag'), last_modified=previous.get('last_modified'))
            return check, []
        if status != 200:
            check.update(reason='HTTP_' + str(status))
            return check, []
        if len(body) > config['body_max_bytes']:
            raise ValueError('BODY_TOO_LARGE')
        lower = body.lower()
        if any(x in lower for x in (b'<html', b'captcha', b'just a moment', b'blocked by network security', b'login required', b'payment required')):
            check.update(reason='CHALLENGE_OR_NON_FEED', disabled=True)
            return check, []
        items = parse_atom(body)
        urls = [x['source_url'] for x in items]
        overlap = bool(set(urls) & set(previous.get('entry_urls', [])))
        check.update(status='AVAILABLE_PARTIAL', observed=True, collection_success=True, last_success_at=at, reason='BOUNDED_FEED_ONLY', coverage_status='PARTIAL',
                     entry_urls=urls, overlap=overlap, gap_detected=bool(previous.get('entry_urls')) and not overlap,
                     etag=response_headers.get('etag'), last_modified=response_headers.get('last-modified'),
                     entries_count=len(items))
        return check, items
    except (OSError, ValueError, ET.ParseError, http.client.HTTPException) as error:
        # Do not retain arbitrary remote error text or secrets in logs.
        reason = str(error) if isinstance(error, ValueError) else type(error).__name__
        check.update(reason=reason[:80])
        return check, []
