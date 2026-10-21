import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from watch import queue_collection, publish_pending, post_backend
from correlate import build_report
from normalize import independent, normalize
from store import Store

NOW='2026-09-09T12:00:00Z'
def evidence():
    return normalize({'source':'reddit','source_url':'https://www.reddit.com/r/Instagram/comments/abc/title', 'published_at':'2026-09-09T11:30:00Z','title':'I cannot follow','text_or_excerpt':'I cannot follow anyone today.', 'author_reference':'one'},collected_at=NOW)

class FixPack(unittest.TestCase):
    def test_integration_delivery_retry_uses_same_durable_batch(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp') as root:
            with Store(root) as store:
                queue_collection(store,[evidence()],[])
                captured=[]
                def fail(url,key,payload):
                    captured.append(payload)
                    raise TimeoutError()
                with self.assertRaises(TimeoutError):
                    publish_pending(store,'https://backend.example/api/instagram-dashboard/compass/signals','test-key',fail)
            with Store(root) as store:
                publish_pending(store,'https://backend.example/api/instagram-dashboard/compass/signals','test-key',lambda u,k,p:captured.append(p))
                self.assertEqual(captured[0],captured[1])
                self.assertEqual(store.conn.execute("select count(*) from metadata where key like 'outbox:%'").fetchone()[0],0)
    def test_integration_raw_ttl_preserves_summary_and_identity(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp') as root:
            with Store(root) as store:
                s=evidence();store.ingest([s]);store.retain(at='2026-09-13T12:00:00Z',raw_hours=72)
                kept=store.all_signals()[0]
                self.assertNotIn('raw_evidence',kept)
                self.assertEqual(kept['short_summary'],s['short_summary'])
                self.assertEqual(kept['content_hash'],s['content_hash'])
    def test_regression_historical_report_and_crosspost_after_raw_purge(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp') as root:
            first = evidence()
            second = normalize({
                'source': 'reddit',
                'source_url': 'https://www.reddit.com/r/InstagramMarketing/comments/def/title',
                'crosspost_parent_url': first['source_url'],
                'published_at': '2026-09-09T11:45:00Z',
                'title': 'My Instagram following stopped',
                'text_or_excerpt': 'My account cannot follow another profile today.',
                'author_reference': 'two',
            }, collected_at=NOW)
            incident = {'account_id': 'one', 'action_type': 'FOLLOW', 'occurred_at': NOW}
            with Store(root) as store:
                store.ingest([first, second])
                initial = build_report(store.all_signals(), [], [], incident=incident, at=NOW)
                self.assertEqual(initial['matching_external_reports'], 1)
                store.retain(at='2026-09-13T12:00:00Z', raw_hours=72)
            with Store(root) as store:
                retained = store.all_signals()
                self.assertTrue(all('raw_evidence' not in row for row in retained))
                self.assertEqual(len(independent(retained)), 1)
                historical = build_report(retained, [], [], incident=incident, at='2026-09-13T12:00:00Z')
                self.assertEqual(historical['matching_external_reports'], 1)
                self.assertEqual(historical['independence_confidence'], 'REDUCED_AFTER_RAW_PURGE')
                self.assertIn('HISTORICAL_RAW_EXPIRED_USING_RETAINED_PROVENANCE', historical['limitations'])
                self.assertEqual(historical['evidence_summary'][0]['summary'], first['short_summary'])
    def test_contract_backend_endpoint_rejects_redirectable_or_private_contracts(self):
        for url in ['http://backend.example/api/instagram-dashboard/compass/signals','https://backend.example/other','https://a:b@backend.example/api/instagram-dashboard/compass/signals']:
            with self.assertRaises(ValueError):post_backend(url,'key',{'signals':[]})
    def test_contract_outbox_has_bounded_capacity(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp') as root:
            with Store(root) as store:
                for i in range(10):
                    s=evidence();s['id']=str(i);queue_collection(store,[s],[])
                with self.assertRaisesRegex(ValueError,'OUTBOX_FULL'):queue_collection(store,[evidence()],[])
