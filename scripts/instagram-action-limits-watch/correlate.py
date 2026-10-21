"""Pure report/correlation functions. No service access or execution hooks."""
from collections import Counter
from datetime import timedelta
import json
from normalize import TAXONOMY, comparable, independent, now_iso, parse_time, safe_input
from remedies import trends

INCIDENT_FIELDS = {'account_id', 'username_safe', 'action_type', 'occurred_at', 'actions_before_problem',
                   'instagram_message_reason', 'instagram_version', 'device_context_safe', 'region_proxy_context'}


def incident_safe(item):
    if not isinstance(item, dict) or not {'account_id', 'action_type', 'occurred_at'} <= item.keys() or set(item) - INCIDENT_FIELDS:
        raise ValueError('INVALID_INCIDENT_FIELDS')
    safe_input(item)
    if not isinstance(item['account_id'], str) or not item['account_id'].strip() or not parse_time(item['occurred_at']):
        raise ValueError('INVALID_INCIDENT_ID_OR_TIME')
    if item['action_type'] not in TAXONOMY | {'FOLLOW', 'UNFOLLOW'}:
        raise ValueError('INVALID_INCIDENT_ACTION')
    count = item.get('actions_before_problem')
    if count is not None and (type(count) is not int or count < 0):
        raise ValueError('INVALID_ACTION_COUNT')
    for field, value in item.items():
        if field != 'actions_before_problem' and value is not None and (not isinstance(value, str) or len(value) > 500):
            raise ValueError('INCIDENT_SAFE_STRINGS_ONLY')
    return {field: item.get(field) for field in sorted(INCIDENT_FIELDS)}


def strength(count):
    return 'NONE' if count == 0 else 'WEAK' if count <= 2 else 'MODERATE' if count <= 5 else 'STRONG'


def thresholds(signals, internal_count=None):
    counts = Counter()
    distances = {}
    for s in signals:
        t = s['reported_threshold']
        label = 'unknown threshold' if not t else f"{t['min']}-{t['max']} {t['unit']} ({t.get('period_text') or 'period unknown'})"
        counts[label] += 1
        distances[label] = (max(t['min'] - internal_count, internal_count - t['max'], 0)
                            if t and internal_count is not None else None)
    return [{'threshold': label, 'reports_count': count, 'distance_to_internal_count': distances[label],
             'comparison_note': 'Count proximity only; unknown/different periods are not equivalent rates'}
            for label, count in sorted(counts.items(), key=lambda pair: (distances[pair[0]] is None, distances[pair[0]] or 0, pair[0]))]


def window(signals, action, center, hours, now, internal_count=None):
    start, end = center - timedelta(hours=hours), center + timedelta(hours=hours)
    candidates = [s for s in signals if not s['exclusion_reasons'] and parse_time(s['published_at'])
                  and comparable(s['action_type']) == comparable(action)
                  and start <= parse_time(s['published_at']) <= min(end, now)]
    rows = independent(candidates)
    families = sorted({r['source'] for r in rows})
    independence_confidence = ('REDUCED_AFTER_RAW_PURGE'
                               if any(r.get('independence_confidence') == 'REDUCED_AFTER_RAW_PURGE' for r in rows)
                               else 'FULL')
    return {'hours': hours, 'start': start.isoformat(), 'end': end.isoformat(),
            'future_state': 'PENDING' if end > now else 'COMPLETE',
            'matching_external_reports': len(rows), 'independent_authors': len({r['author_key'] for r in rows}),
            'distinct_origin_families': len(families), 'origin_families': families,
            'EXTERNAL_SIGNAL_STRENGTH': strength(len(rows)), 'matched_action_types': sorted({r['action_type'] for r in rows}),
            'closest_reported_thresholds': thresholds(rows, internal_count), 'signal_ids': [s['id'] for s in rows],
            'independence_confidence': independence_confidence}


def verdict(selected, full, coverage):
    if selected['matching_external_reports'] >= 3 and selected['distinct_origin_families'] >= 2:
        return 'LIKELY_GLOBAL'
    # No current source adapter sets complete action coverage. Manual imports cannot set it.
    adequate = coverage.get('complete_action_origin_families', [])
    if full['future_state'] == 'COMPLETE' and full['matching_external_reports'] == 0 and len(set(adequate)) >= 2 and coverage.get('verified_no_gaps_24h') is True:
        return 'LIKELY_ACCOUNT_SPECIFIC'
    return 'INCONCLUSIVE'


def build_report(signals, remedies, checks, incident=None, policy=None, at=None):
    at = at or now_iso()
    now = parse_time(at)
    if not now:
        raise ValueError('INVALID_REPORT_TIME')
    if incident:
        incident = incident_safe(incident)
        # Incident decision support must not present DM/login remedies as Follow evidence.
        remedies = [r for r in remedies if comparable(r['problem_type']) == comparable(incident['action_type'])]
    if policy is not None:
        safe_input(policy)
        if not isinstance(policy, dict) or set(policy) != {'restriction_policy_label', 'source'} or not all(isinstance(v, str) and v.strip() for v in policy.values()):
            raise ValueError('INVALID_POLICY')
        policy = {**policy, 'verification': 'OPERATOR_SUPPLIED_NOT_INDEPENDENTLY_VALIDATED'}
    latest = {}
    last_observed = {}
    for c in checks:
        latest[c['source_id']] = c
        if c.get('observed'):
            last_observed[c['source_id']] = {'checked_at': c['checked_at'], 'http_status': c.get('http_status'), 'status': c['status']}
    recent = any(parse_time(c['checked_at']) and now - timedelta(hours=24) <= parse_time(c['checked_at']) <= now for c in last_observed.values())
    coverage = {'state': 'PARTIAL' if recent else 'INSUFFICIENT',
                'sources': list(latest.values()), 'complete_action_origin_families': [], 'verified_no_gaps_24h': False,
                'last_observed_by_source': last_observed,
                'manual_imports_do_not_prove_coverage': True}
    result = {'schema_version': 1, 'rules_version': '1.0', 'generated_at': at,
              'PHONE_FARM_INCIDENT': incident, 'EXTERNAL_PROBLEM_VERDICT': 'INCONCLUSIVE',
              'EXTERNAL_SIGNAL_STRENGTH': 'NONE', 'matching_external_reports': 0, 'independent_authors': 0,
              'distinct_origin_families': 0, 'time_windows': {}, 'matched_action_types': [],
              'closest_reported_thresholds': [], 'evidence_summary': [], 'coverage_state': coverage,
              'confidence': 'LOW', 'limitations': ['NON_EXHAUSTIVE_COVERAGE'],
              'COMMUNITY_REMEDY_TRENDS': trends(remedies, at),
              'OFFICIAL_GUIDANCE': [{'source_url': r['source_url'], 'excerpt': r['evidence_excerpt'], 'published_at': r['published_at']}
                                    for r in remedies if r['provenance_class'] == 'OFFICIAL_PLATFORM_GUIDANCE'],
              'PHONE_FARM_CURRENT_POLICY': policy if policy else 'UNKNOWN_NOT_VERIFIED',
              'POTENTIAL_SAFE_ACTION': 'Human review of evidence and applicable policy; no account change proposed',
              'DO_NOT_AUTOMATE': 'ALL_REMEDIES_AND_RUNTIME_ACTIONS including pause, caps, resume, clear data, logout, reinstall, network, devices and verification',
              'PHONE_FARM_RECOMMENDATION': 'NOT_YET_VALIDATED',
              'synthetic_evidence_present': any(s['synthetic'] for s in signals),
              'retained_signal_count': len(signals)}
    if incident:
        center = parse_time(incident['occurred_at'])
        for h in (1, 6, 24):
            result['time_windows'][f'+/-{h}h'] = window(signals, incident['action_type'], center, h, now, incident['actions_before_problem'])
        selected = result['time_windows']['+/-6h']
        full = result['time_windows']['+/-24h']
        result['EXTERNAL_PROBLEM_VERDICT'] = verdict(selected, full, coverage)
        result['selected_window'] = '+/-6h'
    else:
        # No pooling different symptoms into an apparent strong cluster.
        per_action = {a: window(signals, a, now - timedelta(hours=12), 12, now)
                      for a in sorted({comparable(s['action_type']) for s in signals})}
        result['watch_snapshot_by_action'] = per_action
        selected = max(per_action.values(), key=lambda w: w['matching_external_reports'], default=window([], 'OTHER', now, 24, now))
        result['limitations'].append('NO_INTERNAL_INCIDENT')
    for k in ('matching_external_reports', 'independent_authors', 'distinct_origin_families', 'matched_action_types', 'closest_reported_thresholds', 'EXTERNAL_SIGNAL_STRENGTH', 'independence_confidence'):
        result[k] = selected[k]
    if selected['independence_confidence'] == 'REDUCED_AFTER_RAW_PURGE':
        result['limitations'].append('HISTORICAL_RAW_EXPIRED_USING_RETAINED_PROVENANCE')
    if selected['distinct_origin_families'] == 1:
        result['limitations'].append('SINGLE_ORIGIN_FAMILY')
    if incident and result['time_windows']['+/-24h']['future_state'] == 'PENDING':
        result['limitations'].append('FUTURE_WINDOW_PENDING')
    if result['synthetic_evidence_present']:
        result['limitations'].append('SYNTHETIC_DEMONSTRATION_NOT_LIVE_FINDINGS')
    for s in signals:
        if s['id'] in selected['signal_ids']:
            result['evidence_summary'].append({'id': s['id'], 'source_url': s['source_url'], 'published_at': s['published_at'],
                                                'action_type': s['action_type'], 'summary': s['short_summary'],
                                                'ingest_modes': s['ingest_modes']})
    result['excluded_reports'] = [{'id': s['id'], 'reasons': s['exclusion_reasons']} for s in signals if s['exclusion_reasons']]
    return result


def markdown_report(report):
    # Render untrusted excerpts inside a JSON fence, never executable HTML or instructions.
    content = json.dumps(report, ensure_ascii=False, indent=2).replace('`', '\\u0060').replace('<', '\\u003c')
    return ('# Instagram action limits — informational report\n\n'
            + ('**SYNTHETIC DEMONSTRATION — NOT LIVE FINDINGS**\n\n' if report['synthetic_evidence_present'] else '')
            + f"Verdict: **{report['EXTERNAL_PROBLEM_VERDICT']}**. Signal: **{report['EXTERNAL_SIGNAL_STRENGTH']}**.\n\n"
            + 'Community reports are not official guidance or validated Phone Farm recommendations. No execution hooks.\n\n'
            + '```json\n' + content + '\n```\n')
