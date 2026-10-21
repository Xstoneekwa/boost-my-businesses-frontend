"""Synthetic remedy observations; no real recovery claims or external network."""
import unittest
from test_watch import signal, AT
from remedies import extract_remedies, duration, outcome, trends, aggregate
from correlate import build_report


def remedy(i=1, text=None, **kwargs):
    text = text or f'I cannot follow. I waited {i * 12} hours and it worked for me. Synthetic narrative {i}.'
    s = signal(i, text_or_excerpt=text, **kwargs)
    return extract_remedies(s, text)[0]


class RemedyTests(unittest.TestCase):
    def test_certification_pause_shorthand_and_no_effect(self):
        for hours in (24, 48, 72):
            r = remedy(text=f"I cannot follow. I waited {hours}h and it still doesn't work")
            self.assertEqual(r['reported_duration']['min_hours'], hours)
            self.assertEqual(r['reported_result'], 'no_effect')
            self.assertIsNone(r['time_to_recovery'])
        r = remedy(text='I cannot follow. I waited a few days and it worked for me')
        self.assertEqual(r['reported_duration']['text'], 'a few days')
        self.assertIsNone(r['reported_duration']['min_hours'])
        self.assertIsNone(aggregate([r])['FOLLOW_BLOCKED'][0]['median_reported_wait_time'])

    def test_certification_suggestion_not_successful_bundle(self):
        text = 'I cannot follow. I waited 48 hours and it worked for me. Someone suggested reinstalling Instagram.'
        rows = extract_remedies(signal(text_or_excerpt=text), text)
        self.assertEqual({r['remedy_type']: r['reported_result'] for r in rows},
                         {'WAIT_NO_CHANGE': 'resolved', 'REINSTALL_APP': 'unknown'})
        self.assertTrue(all(r['intervention_bundle_id'] is None for r in rows))

    def test_certification_clearing_data_not_cache(self):
        r = remedy(text="I cannot follow. I tried clearing app data and it didn't help")
        self.assertEqual(r['remedy_type'], 'CLEAR_APP_DATA')
        self.assertEqual(r['reported_result'], 'no_effect')
        self.assertEqual(r['risk_level'], 'HIGH_RISK')
        self.assertEqual(r['phone_farm_recommendation'], 'NOT_YET_VALIDATED')

    def test_certification_incident_remedies_match_action(self):
        s = signal(title='I cannot send messages', text_or_excerpt='I cannot send messages. I waited 48 hours and it worked for me.')
        report = build_report([s], extract_remedies(s, s['raw_evidence']), [],
                              {'account_id': 'synthetic', 'action_type': 'FOLLOW_BLOCKED', 'occurred_at': '2026-09-07T12:00:00Z'}, at=AT)
        for section in report['COMMUNITY_REMEDY_TRENDS'].values():
            self.assertEqual(section['TOP_REPORTED_REMEDIES'], {})

    def test_results(self):
        for text, expected in [('I waited and it worked for me', 'resolved'), ('I waited, improved', 'improved'),
                               ('I waited but nothing worked', 'no_effect'), ('I tried, now worse', 'worsened'),
                               ('I waited and it worked temporarily', 'temporary_improvement'), ('Try waiting', 'unknown')]:
            self.assertEqual(outcome(text), expected)
        self.assertEqual(remedy(text='I cannot follow. You should wait 48 hours, it worked for me')['reported_result'], 'unknown')

    def test_nulls_and_risks(self):
        r = remedy(text='I cannot follow. I cleared app data. Nothing worked')
        self.assertEqual(r['risk_level'], 'HIGH_RISK')
        self.assertIsNone(r['reported_duration'])
        self.assertIsNone(r['time_to_recovery'])
        self.assertEqual(r['phone_farm_recommendation'], 'NOT_YET_VALIDATED')
        self.assertEqual(remedy(text='I cannot follow. I cleared cache')['risk_level'], 'MEDIUM_RISK')
        self.assertEqual(remedy()['risk_level'], 'LOW_RISK')

    def test_bundle_no_false_causality(self):
        r = remedy(text='I cannot follow. I waited 48 hours and reinstalled Instagram; it worked for me')
        self.assertTrue(r['remedy_type'].startswith('BUNDLE:'))
        self.assertIsNotNone(r['intervention_bundle_id'])
        groups = aggregate([r])['FOLLOW_BLOCKED']
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]['reported_success_count'], 1)

    def test_followup_relapse_latest_author(self):
        first = remedy(1)
        second = remedy(2, text='I cannot follow. I waited 24 hours, it worked but I was blocked again', author_reference='synthetic1', published_at='2026-09-08T10:00:00Z')
        group = aggregate([first, second])['FOLLOW_BLOCKED'][0]
        self.assertEqual(group['independent_reports_count'], 1)
        self.assertEqual(group['reported_success_count'], 0)
        self.assertEqual(group['reported_temporary_improvement_count'], 1)

    def test_durations_median_range_censored(self):
        self.assertEqual(duration('48-72 hours')['max_hours'], 72)
        self.assertIsNone(duration('72+ hours')['max_hours'])
        self.assertFalse(duration('72+ hours')['exact'])
        self.assertEqual(duration('2 days')['min_hours'], 48)
        rows = [remedy(i) for i in (1, 2, 3)]
        group = aggregate(rows)['FOLLOW_BLOCKED'][0]
        self.assertEqual(group['median_reported_wait_time'], 24)
        self.assertEqual(group['wait_time_sample_count'], 3)
        rows += [remedy(4, text='I cannot follow. I waited 72+ hours and it worked for me.')]
        group = aggregate(rows)['FOLLOW_BLOCKED'][0]
        self.assertEqual(group['wait_time_sample_count'], 3)
        self.assertTrue(group['range_reported_wait_time']['censored'])
        self.assertIsNone(aggregate(rows[:2])['FOLLOW_BLOCKED'][0]['median_reported_wait_time'])
        trial = remedy(5, text='I cannot follow. I waited 999 hours, still blocked.')
        group = aggregate(rows + [trial])['FOLLOW_BLOCKED'][0]
        self.assertEqual(group['trial_or_unknown_duration_count_excluded'], 1)
        self.assertEqual(group['median_reported_wait_time'], 24)

    def test_contradictions_and_counts(self):
        rows = [remedy(1), remedy(2, text='I cannot follow. I waited 48 hours but nothing worked')]
        g = aggregate(rows)['FOLLOW_BLOCKED'][0]
        self.assertEqual(g['contradictions']['score'], 1)
        fields = ['reported_success_count', 'reported_no_effect_count', 'reported_worsening_count',
                  'reported_improved_count', 'reported_temporary_improvement_count', 'reported_unknown_count']
        self.assertEqual(sum(g[k] for k in fields), g['independent_reports_count'])

    def test_leaders_sparse_and_fastest(self):
        rows = [remedy(1, text='I cannot follow. I waited; I recovered after 24 hours and it worked for me')]
        out = trends(rows, AT)['7d']['trends']['FOLLOW_BLOCKED']
        self.assertIsNone(out['MOST_SUCCESSFUL_REPORTED_RESPONSE'])
        self.assertEqual(out['FASTEST_REPORTED_RECOVERY']['hours'], 24)
        self.assertEqual(out['NEW_EMERGING_RESPONSE']['status'], 'INSUFFICIENT_BASELINE')

    def test_emerging_requires_comparable_baseline(self):
        rows = [remedy(i) for i in (1, 2, 3)]
        r = trends(rows, AT)
        self.assertEqual(r['7d']['trends']['FOLLOW_BLOCKED']['NEW_EMERGING_RESPONSE']['status'], 'INSUFFICIENT_BASELINE')
        r = trends(rows, AT, {'verified_comparable_30d': True})
        self.assertEqual(r['7d']['trends']['FOLLOW_BLOCKED']['NEW_EMERGING_RESPONSE']['candidates'], ['WAIT_NO_CHANGE'])
        old = remedy(4, published_at='2026-08-20T12:00:00Z')
        r = trends(rows + [old], AT, {'verified_comparable_30d': True})
        self.assertEqual(r['7d']['trends']['FOLLOW_BLOCKED']['NEW_EMERGING_RESPONSE']['status'], 'NONE')

    def test_support_quote_not_official(self):
        self.assertEqual(remedy(text='I cannot follow. Support told me to wait')['provenance_class'], 'COMMUNITY_REPORTED')
        s = signal(source_url='https://help.instagram.com/example', evidence_kind='OFFICIAL_GUIDANCE')
        official = extract_remedies(s, 'Wait before retrying')[0]
        self.assertEqual(official['provenance_class'], 'OFFICIAL_PLATFORM_GUIDANCE')
        self.assertEqual(official['reported_result'], 'unknown')
        self.assertEqual(aggregate([]), {})

    def test_undated_excluded_and_windows(self):
        r = remedy(published_at=None)
        result = trends([r], AT)
        for window in result.values(): self.assertEqual(window['TOP_REPORTED_REMEDIES'], {})
        old = remedy(published_at='2026-07-01T12:00:00Z')
        result = trends([old], AT)
        self.assertEqual(result['30d']['TOP_REPORTED_REMEDIES'], {})
        self.assertTrue(result['historical_retained']['TOP_REPORTED_REMEDIES'])

    def test_new_pattern_candidate_and_decision_support(self):
        r = remedy(text='I cannot follow. I tried a strange new workaround with a local ritual')
        self.assertEqual(r['remedy_type'], 'OTHER_REPORTED')
        self.assertEqual(r['risk_level'], 'HIGH_RISK')
        report = build_report([], [], [], at=AT)
        self.assertIn('ALL_REMEDIES', report['DO_NOT_AUTOMATE'])
        self.assertEqual(report['PHONE_FARM_RECOMMENDATION'], 'NOT_YET_VALIDATED')


if __name__ == '__main__': unittest.main()
