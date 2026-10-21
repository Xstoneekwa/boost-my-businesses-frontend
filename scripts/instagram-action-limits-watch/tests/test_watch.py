"""Offline stdlib-only behavioral and isolation tests. All evidence is synthetic."""
import contextlib
import io
import json
from pathlib import Path
import socket
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from normalize import normalize, classify, parse_time, canonical_url, independent
from correlate import build_report, strength, incident_safe, verdict
from sources import collect_source, public_get, PinnedHTTPS, parse_atom, retry_at
from store import Store
from watch import main, import_items

AT = '2026-09-08T15:00:00Z'
INCIDENT = {'account_id': 'synthetic', 'action_type': 'FOLLOW', 'occurred_at': '2026-09-07T12:00:00Z'}
CONFIG = json.loads((Path(__file__).resolve().parents[1] / 'config.json').read_text())
SOURCE = CONFIG['sources'][0]
ATOM = b'<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>I cannot follow</title><published>2026-09-07T12:00:00Z</published><link href="https://www.reddit.com/r/Instagram/comments/abc/test/"/><author><name>sample</name></author><content>I cannot follow anyone</content></entry></feed>'


def raw(i=1, **kw):
    result = {'source': 'reddit', 'source_url': f'https://www.reddit.com/r/Instagram/comments/test{i}/demo/',
              'published_at': '2026-09-07T12:00:00Z', 'title': 'I cannot follow',
              'text_or_excerpt': f'I cannot follow anyone. My unique synthetic report number {i}.',
              'author_reference': 'synthetic' + str(i), 'synthetic': True}
    result.update(kw)
    return result


def signal(i=1, **kw):
    return normalize(raw(i, **kw), collected_at=AT)


class NormalizeTests(unittest.TestCase):
    def test_certification_can_no_longer_follow(self):
        self.assertEqual(classify('I can no longer follow anyone'), 'FOLLOW_BLOCKED')
        self.assertEqual(classify('I can no longer unfollow anyone'), 'UNFOLLOW_BLOCKED')

    def test_taxonomy(self):
        for text, expected in [("I can't unfollow anyone", 'UNFOLLOW_BLOCKED'),
                               ("I cannot follow anyone", 'FOLLOW_BLOCKED'),
                               ('I can only follow 10 people', 'FOLLOW_LIMIT_LOW'),
                               ('I can only unfollow 10 people', 'UNFOLLOW_LIMIT_LOW'),
                               ("I can't send messages", 'DM_RESTRICTED'),
                               ("I cannot like posts", 'LIKE_RESTRICTED'),
                               ("I cannot comment", 'COMMENT_RESTRICTED'),
                               ('Try again later', 'TRY_AGAIN_LATER'),
                               ('Action blocked', 'ACTION_BLOCKED'),
                               ('We limit how often', 'GENERIC_RATE_LIMIT'),
                               ('I have a restriction', 'UNKNOWN_ACTION_RESTRICTION')]:
            with self.subTest(text=text): self.assertEqual(classify(text), expected)

    def test_false_positives(self):
        for t in ['I am not blocked', 'Others cannot follow me', 'People cannot follow me',
                  'My reach dropped', 'My video is blocked', 'I cannot log in', 'Instagram outage', 'I am blocked from posting']:
            with self.subTest(t=t): self.assertEqual(classify(t), 'OTHER')
        self.assertIn('GENERIC_GUIDE', signal(text_or_excerpt='My complete guide: how to fix follow blocked')['exclusion_reasons'])
        self.assertIn('NOT_PERSONAL_TESTIMONY', signal(title='same', text_or_excerpt='same')['exclusion_reasons'])
        self.assertIn('NON_INDEPENDENT_AUTHOR', signal(author_reference='AutoModerator')['exclusion_reasons'])

    def test_reddit_navigation_and_unrelated_terms(self):
        from normalize import plain
        text = 'I cannot create a shared collection. submitted by /u/example [link] [comments]'
        self.assertNotIn('[comments]', plain(text))
        self.assertEqual(classify(text), 'OTHER')
        self.assertEqual(classify("My DM notifications do not show up. I cannot understand why."), 'OTHER')
        self.assertEqual(classify('I cannot comprehend my dashboard. There are comments on my reels.'), 'OTHER')
        self.assertEqual(classify("I cannot send messages. My notifications work."), 'DM_RESTRICTED')

    def test_dates_utc_and_conflict(self):
        self.assertEqual(parse_time('2026-09-07T14:00:00+02:00'), parse_time('2026-09-07T12:00:00Z'))
        for value in (None, 'today', '2h ago', '2026-09-07', '2026-09-07T12:00:00'):
            self.assertIn('PUBLICATION_TIME_UNVERIFIED', signal(published_at=value)['exclusion_reasons'])
        self.assertIn('PUBLICATION_CONFLICT', signal(date_conflict=True)['exclusion_reasons'])
        self.assertIn('FUTURE_PUBLICATION', signal(published_at='2030-01-01T00:00:00Z')['exclusion_reasons'])
        self.assertEqual(parse_atom(ATOM.replace(b'<published>', b'<updated>').replace(b'</published>', b'</updated>'))[0]['published_at'], None)

    def test_threshold_null_and_explicit(self):
        self.assertIsNone(signal()['reported_threshold'])
        s = signal(text_or_excerpt='I cannot follow after around 10–20 follows after 24 hours')
        self.assertEqual((s['reported_threshold']['min'], s['reported_threshold']['max']), (10, 20))
        self.assertIsNone(s['region'])
        with self.assertRaises(ValueError): signal(reported_threshold={'min': 30})

    def test_manual_automatic_no_confidence_bonus(self):
        a = normalize(raw(), 'AUTOMATIC', AT)
        b = normalize(raw(), 'MANUAL', AT)
        self.assertEqual(a['confidence'], b['confidence'])
        self.assertEqual(a['id'], b['id'])
        self.assertNotEqual(a['evidence_ingest_mode'], b['evidence_ingest_mode'])

    def test_compass_v2_normalized_contract(self):
        s = signal(platform_version='401.0.0', access_status='LIMITED', source_credibility='MEDIUM')
        required = {'source', 'source_native_id', 'url', 'retrieved_at', 'published_at',
                    'publication_date_confidence', 'first_seen', 'last_seen', 'platform',
                    'signal_type', 'action_family', 'symptom_family', 'geography',
                    'platform_version', 'source_credibility', 'access_status', 'freshness',
                    'volume', 'velocity', 'official_confirmation', 'content_hash',
                    'dedupe_key', 'cluster_id', 'exclusion_reason', 'raw_reference'}
        self.assertFalse(required - set(s))
        self.assertEqual(s['platform'], 'INSTAGRAM')
        self.assertEqual(s['action_family'], 'FOLLOW')
        self.assertEqual(s['platform_version'], '401.0.0')
        self.assertTrue(s['raw_reference'].startswith('sha256:'))
        for invalid in ('TRUST_ME', '', None):
            with self.assertRaises(ValueError): signal(source_credibility=invalid)

    def test_dedupe_tracking_native_comments_crosspost(self):
        self.assertEqual(signal()['id'], signal(source_url=raw()['source_url'] + '?utm_source=google')['id'])
        comment = signal(source_url=raw()['source_url'] + 'commentid/')
        self.assertNotEqual(signal()['id'], comment['id'])
        a = signal()
        b = signal(2, crosspost_parent_url=a['source_url'])
        c = signal(3, text_or_excerpt=raw(2)['text_or_excerpt'])
        self.assertEqual(len(independent([a, b, c])), 1)
        self.assertEqual(len(independent([a, signal(4, author_reference='synthetic1')])), 1)

    def test_near_copy_and_search_origin(self):
        text = 'I cannot follow any of my friends from school since yesterday morning and the application keeps returning to its initial state without an error'
        self.assertEqual(len(independent([signal(1, text_or_excerpt=text), signal(2, text_or_excerpt=text + ' sadly')])), 1)
        s = signal(source_url='https://www.google.com/search?q=instagram', original_source_url=raw()['source_url'])
        self.assertEqual(s['source'], 'reddit')
        self.assertEqual(s['id'], signal()['id'])
        self.assertIn('AGGREGATOR_NOT_ORIGINAL_SOURCE', signal(source_url='https://www.google.com/search?q=instagram')['exclusion_reasons'])
        self.assertEqual(signal(source_url='https://one.forum.example.org/a')['source'], signal(source_url='https://two.example.org/b')['source'])

    def test_url_and_safe_input(self):
        for url in ['http://reddit.com', 'https://localhost/a', 'https://127.0.0.1/a', 'https://10.0.0.1/', 'https://user:pass@example.com/']:
            with self.subTest(url=url), self.assertRaises(ValueError): canonical_url(url)
        with self.assertRaises(ValueError): signal(notes='password=example')


class CorrelationTests(unittest.TestCase):
    def test_strength_boundaries(self):
        self.assertEqual([strength(i) for i in [0, 1, 2, 3, 5, 6, 12]], ['NONE', 'WEAK', 'WEAK', 'MODERATE', 'MODERATE', 'STRONG', 'STRONG'])

    def test_single_origin_strong(self):
        r = build_report([signal(i) for i in range(12)], [], [], INCIDENT, at=AT)
        self.assertEqual(r['EXTERNAL_SIGNAL_STRENGTH'], 'STRONG')
        self.assertEqual(r['EXTERNAL_PROBLEM_VERDICT'], 'INCONCLUSIVE')
        self.assertEqual(r['independent_authors'], 12)
        self.assertIn('SINGLE_ORIGIN_FAMILY', r['limitations'])

    def test_multi_origin_global(self):
        rows = [signal(1), signal(2), signal(3, source_url='https://forum.example.org/thread/3')]
        self.assertEqual(build_report(rows, [], [], INCIDENT, at=AT)['EXTERNAL_PROBLEM_VERDICT'], 'LIKELY_GLOBAL')

    def test_copies_and_mismatched_symptoms_do_not_inflate(self):
        rows = [signal(i, text_or_excerpt=raw()['text_or_excerpt']) for i in range(12)]
        r = build_report(rows, [], [], INCIDENT, at=AT)
        self.assertEqual(r['matching_external_reports'], 1)
        dm = signal(33, title='DM restriction', text_or_excerpt="I can't send messages")
        self.assertEqual(build_report([dm], [], [], INCIDENT, at=AT)['matching_external_reports'], 0)

    def test_window_bounds_pending_and_historical_crawl(self):
        rows = [signal(1, published_at='2026-09-07T11:00:00Z'), signal(2, published_at='2026-09-07T06:00:00Z'),
                signal(3, published_at='2026-09-06T12:00:00Z'), signal(4, published_at='2020-01-01T00:00:00Z')]
        r = build_report(rows, [], [], INCIDENT, at='2026-09-07T12:01:00Z')
        self.assertEqual([w['matching_external_reports'] for w in r['time_windows'].values()], [1, 2, 3])
        self.assertTrue(all(w['future_state'] == 'PENDING' for w in r['time_windows'].values()))

    def test_no_account_verdict_without_coverage(self):
        self.assertEqual(build_report([], [], [], INCIDENT, at=AT)['EXTERNAL_PROBLEM_VERDICT'], 'INCONCLUSIVE')
        full = {'future_state': 'COMPLETE', 'matching_external_reports': 0}
        sel = {'matching_external_reports': 0, 'distinct_origin_families': 0}
        self.assertEqual(verdict(sel, full, {'complete_action_origin_families': ['a', 'b'], 'verified_no_gaps_24h': True}), 'LIKELY_ACCOUNT_SPECIFIC')
        self.assertEqual(verdict(sel, {**full, 'future_state': 'PENDING'}, {'complete_action_origin_families': ['a', 'b'], 'verified_no_gaps_24h': True}), 'INCONCLUSIVE')

    def test_policy_and_incident_safety(self):
        self.assertEqual(build_report([], [], [], at=AT)['PHONE_FARM_CURRENT_POLICY'], 'UNKNOWN_NOT_VERIFIED')
        p = {'restriction_policy_label': 'operator supplied policy', 'source': 'approved internal document'}
        self.assertEqual(build_report([], [], [], policy=p, at=AT)['PHONE_FARM_CURRENT_POLICY']['restriction_policy_label'], p['restriction_policy_label'])
        for change in [{'token': 'sensitive'}, {'device_context_safe': 'adb_serial=123'}, {'account_id': ''}, {'actions_before_problem': -1}]:
            with self.assertRaises(ValueError): incident_safe({**INCIDENT, **change})


class NetworkTests(unittest.TestCase):
    def collect(self, status=200, headers=None, body=ATOM, previous=None):
        return collect_source(CONFIG, SOURCE, previous, lambda *a: (status, headers or {}, body), AT)

    def test_available_and_unavailable(self):
        c, items = self.collect()
        self.assertEqual(c['status'], 'AVAILABLE_PARTIAL')
        self.assertFalse(c['coverage_complete'])
        self.assertEqual(c['coverage_status'], 'PARTIAL')
        self.assertEqual(len(items), 1)
        for source in CONFIG['sources'][2:]:
            with patch('sources.public_get', side_effect=AssertionError('network forbidden')):
                c, items = collect_source(CONFIG, source, at=AT)
                self.assertFalse(c['observed'])

    def test_reddit_marketing_has_independent_bounded_cadence(self):
        source = CONFIG['sources'][1]
        c, items = collect_source(CONFIG, source, transport=lambda *a: (200, {}, ATOM), at=AT)
        self.assertEqual(c['status'], 'AVAILABLE_PARTIAL')
        self.assertEqual(len(items), 1)
        self.assertEqual((parse_time(c['next_allowed_at']) - parse_time(AT)).total_seconds(), 7200)
        self.assertEqual(c['source_credibility'], 'MEDIUM')

    def test_403_stays_disabled(self):
        c, _ = self.collect(403)
        self.assertTrue(c['disabled'])
        self.assertEqual(c['access_status'], 'BLOCKED')
        c, _ = collect_source(CONFIG, SOURCE, c, lambda *a: self.fail('retried 403'), AT)
        self.assertFalse(c['observed'])

    def test_429_retry_after(self):
        c, _ = self.collect(429, {'retry-after': '120'})
        self.assertEqual((parse_time(c['next_allowed_at']) - parse_time(AT)).total_seconds(), 120)
        c, _ = collect_source(CONFIG, SOURCE, c, lambda *a: self.fail('retried cooldown'), AT)
        self.assertEqual(c['reason'], 'COOLDOWN')
        self.assertEqual(retry_at('Wed, 09 Sep 2026 15:00:00 GMT', parse_time(AT)), '2026-09-09T15:00:00+00:00')
        c, _ = self.collect(429)
        self.assertEqual((parse_time(c['next_allowed_at']) - parse_time(AT)).total_seconds(), 86400)

    def test_timeout_size_challenge_malformed(self):
        def timeout(*a): raise TimeoutError()
        self.assertEqual(collect_source(CONFIG, SOURCE, transport=timeout, at=AT)[0]['reason'], 'TimeoutError')
        self.assertEqual(self.collect(body=b'x' * 524289)[0]['reason'], 'BODY_TOO_LARGE')
        self.assertTrue(self.collect(body=b'<html>captcha</html>')[0]['disabled'])
        self.assertEqual(self.collect(body=b'<bad')[0]['status'], 'SOURCE_UNAVAILABLE')

    def test_private_url_and_dns(self):
        with self.assertRaises(ValueError): public_get('https://127.0.0.1/', {})
        with patch('socket.getaddrinfo', return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('10.0.0.1', 443))]):
            with self.assertRaises(ValueError): PinnedHTTPS('www.reddit.com').connect()

    def test_redirect_private_and_loop(self):
        class Response:
            status = 302
            def getheaders(self): return [('Location', 'https://127.0.0.1/private')]
        with patch.object(PinnedHTTPS, 'request'), patch.object(PinnedHTTPS, 'getresponse', return_value=Response()):
            with self.assertRaises(ValueError): public_get(SOURCE['url'], {})
        class Loop(Response):
            def getheaders(self): return [('Location', SOURCE['url'])]
        with patch.object(PinnedHTTPS, 'request'), patch.object(PinnedHTTPS, 'getresponse', return_value=Loop()):
            with self.assertRaisesRegex(ValueError, 'REDIRECT_LOOP'): public_get(SOURCE['url'], {})

    def test_etag_and_feed_gap(self):
        c, _ = self.collect(headers={'etag': 'test'})
        c['next_allowed_at'] = AT
        def transport(url, headers, *args):
            self.assertEqual(headers['If-None-Match'], 'test')
            return 304, {}, b''
        latest, _ = collect_source(CONFIG, SOURCE, c, transport, AT)
        self.assertEqual(latest['status'], 'NOT_MODIFIED')
        c['entry_urls'] = ['https://example.org/old']
        self.assertTrue(self.collect(previous=c)[0]['gap_detected'])

    def test_get_only_and_response_size_header(self):
        class Response:
            status = 200
            def getheaders(self): return [('Content-Length', '999999')]
        with patch.object(PinnedHTTPS, 'request') as request, patch.object(PinnedHTTPS, 'getresponse', return_value=Response()):
            with self.assertRaisesRegex(ValueError, 'BODY_TOO_LARGE'): public_get(SOURCE['url'], {})
            self.assertEqual(request.call_args.args[0], 'GET')
        self.assertEqual(self.collect(500)[0]['reason'], 'HTTP_500')
        self.assertTrue(self.collect(401)[0]['disabled'])


class StoreTests(unittest.TestCase):
    def test_idempotency_and_transaction_rollback(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp') as d, Store(d) as s:
            s.ingest([signal()])
            s.ingest([normalize(raw(), 'AUTOMATIC', AT)])
            self.assertEqual(len(s.all_signals()), 1)
            self.assertEqual(s.all_signals()[0]['ingest_modes'], ['AUTOMATIC', 'MANUAL'])
            with self.assertRaises(sqlite3.IntegrityError):
                s.ingest([signal(2)], [{'id': 'bad', 'problem_signal_id': 'nonexistent'}])
            self.assertEqual(len(s.all_signals()), 1)

    def test_lock_ceiling_symlink_unowned(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp') as d, Store(d) as s:
            with self.assertRaisesRegex(ValueError, 'CONCURRENT_RUN_LOCKED'):
                with Store(d): pass
            s.max_bytes = s.size() + 100
            with self.assertRaisesRegex(ValueError, 'STORAGE_LIMIT_REACHED'): s.ingest([signal()])
        with tempfile.TemporaryDirectory(dir='/private/tmp') as d:
            Path(d, 'unknown').write_text('keep')
            with self.assertRaisesRegex(ValueError, 'UNOWNED'):
                with Store(d): pass

    def test_retention_protects_incident_evidence(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp') as d, Store(d) as s:
            s.ingest([signal()])
            r = build_report(s.all_signals(), [], [], INCIDENT, at=AT)
            s.save_report(r, 'demo')
            s.retain('2027-09-07T12:00:00Z')
            self.assertEqual(len(s.all_signals()), 1)
            self.assertEqual(len(list(Path(d, 'reports').glob('*.json'))), 1)

    def test_retention_without_report(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp') as d, Store(d) as s:
            s.ingest([signal()])
            s.retain('2027-09-07T12:00:00Z')
            self.assertEqual(s.all_signals(), [])

    def test_publication_conflict_survives_reimport(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp') as d, Store(d) as s:
            s.ingest([signal()])
            changed = signal(published_at='2026-09-07T11:00:00Z')
            s.ingest([changed])
            s.ingest([changed])
            self.assertIn('PUBLICATION_CONFLICT', s.all_signals()[0]['exclusion_reasons'])
            self.assertEqual(s.conn.execute('SELECT COUNT(*) FROM signal_versions').fetchone()[0], 1)

    def test_followup_reference_validation_and_transaction(self):
        from remedies import extract_remedies
        with tempfile.TemporaryDirectory(dir='/private/tmp') as d, Store(d) as s:
            first = signal(text_or_excerpt='I cannot follow. I waited and it worked for me')
            r = extract_remedies(first, first['raw_evidence'])[0]
            s.ingest([first], [r])
            next_signal = signal(2, author_reference='synthetic1', published_at='2026-09-08T10:00:00Z', text_or_excerpt='I cannot follow. I waited, it worked but blocked again')
            rr = extract_remedies(next_signal, next_signal['raw_evidence'], {'followup_of': r['id']})[0]
            s.ingest([next_signal], [rr])
            self.assertEqual(len(s.all_remedies()), 2)
            bad = dict(rr, id='bad', followup_of='missing')
            with self.assertRaisesRegex(ValueError, 'FOLLOWUP_REFERENCE_NOT_FOUND'): s.ingest([], [bad])
            self.assertEqual(len(s.all_remedies()), 2)

    def test_report_write_failure_rollback_and_expiry(self):
        from correlate import markdown_report
        with tempfile.TemporaryDirectory(dir='/private/tmp') as d, Store(d) as s:
            s.ingest([signal()])
            r = build_report(s.all_signals(), [], [], at=AT)
            with patch.object(Path, 'open', side_effect=OSError('test write failure')):
                with self.assertRaises(OSError): s.save_report(r, markdown_report(r))
            self.assertEqual(s.conn.execute('SELECT COUNT(*) FROM reports').fetchone()[0], 0)
            s.save_report(r, markdown_report(r))
            s.retain('2027-09-08T15:00:00Z')
            self.assertEqual(list(Path(d, 'reports').iterdir()), [])
            self.assertEqual(s.all_signals(), [])

    def test_synthetic_default_exclusion(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp') as d:
            with Store(d) as s: s.ingest([signal()])
            with contextlib.redirect_stdout(io.StringIO()): main(['--data-dir', d, 'report'])
            report = json.loads(next(Path(d, 'reports').glob('*.json')).read_text())
            self.assertFalse(report['synthetic_evidence_present'])
            self.assertEqual(report['retained_signal_count'], 0)

    def test_cli_import_report_offline_and_invalid_batch(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp') as d:
            evidence = Path(d, 'fixture.json')
            evidence.write_text(json.dumps(raw()))
            root = str(Path(d, 'data'))
            with patch('socket.getaddrinfo', side_effect=AssertionError('offline')), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(main(['--data-dir', root, 'import-evidence', '--file', str(evidence)]), 0)
                self.assertEqual(main(['--data-dir', root, 'report', '--include-synthetic']), 0)
            self.assertEqual(len(list(Path(root, 'reports').glob('*.md'))), 1)
            with self.assertRaises(ValueError): import_items([raw(), {'invalid': True}])

    def test_no_execution_hooks(self):
        import ast
        forbidden = {'subprocess', 'supabase', 'stripe', 'paramiko', 'ctypes'}
        for path in Path(__file__).resolve().parents[1].glob('*.py'):
            tree = ast.parse(path.read_text())
            for node in ast.walk(tree):
                if isinstance(node, ast.Import): self.assertFalse({a.name.split('.')[0] for a in node.names} & forbidden)
                if isinstance(node, ast.ImportFrom): self.assertNotIn((node.module or '').split('.')[0], forbidden)
                if isinstance(node, ast.Call):
                    name = ast.unparse(node.func)
                    self.assertNotIn(name, {'os.system', 'eval', 'exec', 'os.spawn', 'os.execv'})


if __name__ == '__main__': unittest.main()
