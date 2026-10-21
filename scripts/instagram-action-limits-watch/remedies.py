"""Community observations, never recommendations or runtime hooks."""
import re
import statistics
from collections import defaultdict
from datetime import timedelta
from normalize import digest, parse_time, plain, family

PATTERNS = {
    'FULL_PAUSE': r'(?:full|complete|total) pause|stopped all actions|paused (?:my |the )?account',
    'FOLLOW_UNFOLLOW_PAUSE': r'stopped (?:following|unfollowing)|pause (?:follow|unfollow)',
    'WAIT_NO_CHANGE': r'wait(?:ed|ing)?|did nothing|let it expire',
    'REDUCE_VOLUME': r'reduc(?:ed|e|ing) (?:the )?(?:volume|actions|quota)|fewer actions',
    'SPACE_ACTIONS': r'spac(?:e|ed|ing) (?:the )?actions|between actions',
    'GRADUAL_RESUME': r'gradual|slowly resum',
    'RESTART_APP': r'restart(?:ed)? (?:the )?app',
    'RESTART_DEVICE': r'restart(?:ed)? (?:the |my )?(?:phone|device)|reboot',
    'CLEAR_CACHE': r'clear(?:ed|ing)? (?:the )?cache',
    'CLEAR_APP_DATA': r'clear(?:ed|ing)? (?:the )?(?:app )?data',
    'LOGOUT_LOGIN': r'log(?:ged)? out|logout',
    'REINSTALL_APP': r'reinstall|uninstall',
    'CHANGE_DEVICE': r'(?:changed|new|different) (?:phone|device)',
    'CHANGE_CLONE': r'(?:changed|new|different) clone',
    'CHANGE_NETWORK': r'(?:changed|switch(?:ed)?) (?:wi-?fi|network)',
    'CHANGE_IP_VPN': r'(?:changed|switch(?:ed)?) (?:ip|vpn)',
    'REMOVE_VPN': r'(?:removed|disabled|turned off) (?:the )?vpn',
    'COMPLETE_CHALLENGE': r'complet(?:ed|e) (?:the )?(?:challenge|verification)',
    'COMPLETE_EMAIL_PHONE_2FA': r'(?:gave|provided|confirmed|completed|verified|added).{0,35}(?:email|phone number|2fa)',
}
LOW = {'FULL_PAUSE', 'FOLLOW_UNFOLLOW_PAUSE', 'WAIT_NO_CHANGE', 'REDUCE_VOLUME', 'SPACE_ACTIONS', 'GRADUAL_RESUME'}
MEDIUM = {'RESTART_APP', 'RESTART_DEVICE', 'CLEAR_CACHE'}
RESULTS = ('resolved', 'improved', 'no_effect', 'worsened', 'temporary_improvement', 'unknown')
PROVENANCE_CLASSES = ('COMMUNITY_REPORTED', 'OFFICIAL_PLATFORM_GUIDANCE', 'PHONE_FARM_VALIDATED')
COUNT_FIELDS = dict(zip(RESULTS, ('reported_success_count', 'reported_improved_count', 'reported_no_effect_count',
                                 'reported_worsening_count', 'reported_temporary_improvement_count', 'reported_unknown_count')))


def duration(text):
    m = re.search(r'\b(\d+(?:\.\d+)?)\s*(?:([-–])\s*(\d+(?:\.\d+)?))?\s*(\+|or more)?\s*(minutes?|mins?|hours?|hrs?|h|days?|d)\b', text, re.I)
    if not m:
        qualitative = re.search(r'\b(?:a few|several|some) days\b', text, re.I)
        if qualitative:
            return {'min_hours': None, 'max_hours': None, 'censored': False, 'exact': False,
                    'qualitative': True, 'text': qualitative[0]}
        return None
    scale = 1 / 60 if m[5].lower().startswith('min') else 24 if m[5].lower().startswith('d') else 1
    lo, hi = float(m[1]) * scale, float(m[3] or m[1]) * scale
    if hi < lo:
        return None
    return {'min_hours': lo, 'max_hours': None if m[4] else hi, 'censored': bool(m[4]),
            'exact': not m[2] and not m[4], 'text': m[0]}


def outcome(text):
    t = text.lower().replace('’', "'")
    if re.search(r'(temporar|for a while|came back|blocked again|only briefly)', t) and re.search(r'(worked|resolved|improv|could|fixed)', t):
        return 'temporary_improvement'
    if re.search(r'(worse|worsened|lost access|locked out)', t):
        return 'worsened'
    if re.search(r"(no effect|nothing works|nothing worked|(?:didn.t|doesn.t|does not) (?:work|help)|not resolved|still (?:blocked|restricted)|no improvement)", t):
        return 'no_effect'
    if re.search(r'(now I can|i can now|resolved|fixed it|worked for me|could follow again|could send messages again)', text, re.I):
        return 'resolved'
    if re.search(r'(improved|better now)', t):
        return 'improved'
    return 'unknown'


def extract_remedies(signal, text, metadata=None):
    """Keep suggestions separate from self-reported interventions and their outcomes."""
    text = plain(text)[:500]
    clauses = re.split(r'(?<=[.!?;])\s+|\s+(?=(?:someone|support|they|you)\s+(?:suggest|recommend|should|told))', text, flags=re.I)
    suggestion = re.compile(r'\b(suggest(?:ed|s)?|recommend(?:ed|s)?|you should|support told|haven.t tried|did not try|didn.t try)\b', re.I)
    suggested = [c for c in clauses if suggestion.search(c)]
    attempted = [c for c in clauses if not suggestion.search(c)]
    rows = _extract_remedies(signal, ' '.join(attempted), metadata)
    suggested_rows = _extract_remedies(signal, ' '.join(suggested), metadata) if suggested else []
    observed_types = {r['remedy_type'] for r in rows}
    for r in suggested_rows:
        if r['remedy_type'] in observed_types:
            continue
        r['reported_result'] = 'unknown'
        r['time_to_recovery'] = None
        r['observation_kind'] = 'SUGGESTION_NOT_VERIFIED_TRIED'
        rows.append(r)
    return rows


def _extract_remedies(signal, text, metadata=None):
    metadata = metadata or {}
    text = plain(text)[:500]
    lower = text.lower()
    types = [key for key, pattern in PATTERNS.items() if re.search(pattern, lower)]
    if not types and re.search(r'\b(i tried|my workaround|i solved it by)\b', lower):
        types = ['OTHER_REPORTED']
    if not types:
        return []
    # Suggestions are recorded, but cannot acquire an observed result.
    tried = bool(re.search(r"\b(i|my|we)\b", lower)) and bool(re.search(r'(waited|tried|stopped|paused|cleared|logged|reinstall|restart|gave|provided|reduced|changed|did nothing|completed|verified)', lower))
    result = outcome(text) if tried else 'unknown'
    bundle = len(types) > 1
    remedy_type = 'BUNDLE:' + '+'.join(sorted(types)) if bundle else types[0]
    risk = 'HIGH_RISK' if any(t not in LOW | MEDIUM for t in types) else 'MEDIUM_RISK' if any(t in MEDIUM for t in types) else 'LOW_RISK'
    # A quoted support agent is not official. Only explicit direct Meta guidance is separated.
    official = signal['evidence_kind'] == 'OFFICIAL_GUIDANCE' and family(signal['source_url']) == 'meta'
    provenance = 'OFFICIAL_PLATFORM_GUIDANCE' if official else 'COMMUNITY_REPORTED'
    if official:
        result = 'unknown'
    wait_match = re.search(r'\b(?:waited|waiting|pause|paused|stopped)\b[^.;]*', lower)
    wait = duration(wait_match[0]) if wait_match else None
    recovery_match = re.search(r'(?:resolved|recovered|could follow again|could send messages again|fixed it) (?:after|in) ([^.]+)', lower)
    recovery = duration(recovery_match[1]) if recovery_match and result == 'resolved' else None
    episode_ref = metadata.get('episode_reference') or signal['origin_group_id']
    episode = digest(str(signal['author_key']) + ':' + str(episode_ref))
    return [{'id': digest(signal['id'] + ':' + remedy_type), 'problem_type': signal['action_type'],
             'remedy_type': remedy_type, 'remedy_description': text[:500], 'reported_duration': wait,
             'action_reduction': next((m[0] for m in re.finditer(r'\b(?:reduced|stopped|paused|fewer actions)[^.;]*', text, re.I)), None),
             'reported_result': result, 'time_to_recovery': recovery, 'source': signal['source'],
             'source_url': signal['source_url'], 'published_at': signal['published_at'],
             'author_reference': signal['author_key'], 'evidence_excerpt': text[:500], 'confidence': 'LOW',
             'collected_at': signal['collected_at'], 'problem_signal_id': signal['id'], 'report_episode_id': episode,
             'intervention_bundle_id': digest(episode + ':' + remedy_type) if bundle else None,
             'provenance_class': provenance, 'risk_level': risk,
             'risk_reason': 'Session/identity/context may change' if risk == 'HIGH_RISK' else 'Informational classification only; operator validation required',
             'phone_farm_recommendation': 'NOT_YET_VALIDATED', 'followup_of': metadata.get('followup_of'),
             'components': types, 'content_fingerprint': signal['content_fingerprint'],
             'origin_group_id': signal['origin_group_id'], 'date_conflict': signal['date_conflict'],
             'candidate_pattern': re.sub(r'\d+', '#', lower.split('i tried', 1)[-1].strip())[:160] if types == ['OTHER_REPORTED'] else None,
             'exclusion_reasons': signal['exclusion_reasons'], 'synthetic': signal['synthetic']}]


def eligible(rows, start, end):
    return [r for r in rows if not r['exclusion_reasons'] and r['provenance_class'] == 'COMMUNITY_REPORTED'
            and r['author_reference'] and parse_time(r['published_at'])
            and (start is None or parse_time(r['published_at']) >= start)
            and parse_time(r['published_at']) <= end]


def effective_rows(reports):
    latest = {}
    for r in sorted(reports, key=lambda x: (x['published_at'], x['collected_at'], x['id'])):
        latest[(r['problem_type'], r['remedy_type'], r['author_reference'])] = r
    # Explicit followups supersede the previous observation, even when a bundle changed.
    superseded = {r['followup_of'] for r in reports if r.get('followup_of')}
    seen, result = set(), []
    for r in latest.values():
        if r['id'] in superseded:
            continue
        keys = {(r['problem_type'], r['remedy_type'], 'copy', r['content_fingerprint']),
                (r['problem_type'], r['remedy_type'], 'origin', r['origin_group_id'])}
        if not keys & seen:
            result.append(r)
            seen |= keys
    return result


def aggregate(rows):
    by = defaultdict(list)
    for r in rows:
        by[(r['problem_type'], r['remedy_type'])].append(r)
    output = defaultdict(list)
    for (problem, remedy), reports in sorted(by.items()):
        # Latest followup replaces earlier outcome for this author/problem/remedy/window.
        unique = effective_rows(reports)
        if not unique:
            continue
        counts = {field: sum(r['reported_result'] == result for r in unique) for result, field in COUNT_FIELDS.items()}
        # Failed/ongoing trials are not completed waits before reported recovery.
        qualitative_count = sum(bool(r['reported_duration']) and r['reported_duration'].get('qualitative', False) for r in unique)
        waits = [r['reported_duration'] for r in unique if r['reported_duration'] and r['reported_result'] == 'resolved'
                 and r['reported_duration']['min_hours'] is not None]
        trial_count = sum(bool(r['reported_duration']) and r['reported_result'] != 'resolved' for r in unique)
        exact = [w['min_hours'] for w in waits if w['exact']]
        bounds = {'min_hours': min(w['min_hours'] for w in waits),
                  'max_hours': None if any(w['max_hours'] is None for w in waits) else max(w['max_hours'] for w in waits),
                  'censored': any(w['censored'] for w in waits)} if waits else None
        contradiction = min(counts['reported_success_count'], counts['reported_no_effect_count'] + counts['reported_worsening_count'])
        output[problem].append({'remedy': remedy, 'independent_reports_count': len(unique), **counts,
                               'median_reported_wait_time': statistics.median(exact) if len(exact) >= 3 else None,
                               'range_reported_wait_time': bounds, 'wait_time_sample_count': len(exact),
                               'wait_time_unit': 'hours; completed wait in resolved self-reports, not time-to-recovery',
                               'trial_or_unknown_duration_count_excluded': trial_count,
                               'qualitative_duration_count': qualitative_count,
                               'distinct_sources': len({r['source'] for r in unique}),
                               'recency': {'first': min(r['published_at'] for r in unique), 'last': max(r['published_at'] for r in unique)},
                               'confidence': 'LOW', 'contradictions': {'score': contradiction,
                               'temporary_count': counts['reported_temporary_improvement_count'],
                               'followup_outcome_changes': len({r['reported_result'] for r in reports}) > 1},
                               'notes': ['Community self-reports; no causal success probability', 'Bundles counted as combinations, never component successes', 'Latest outcome per author; sparse/biased coverage'],
                               'risk_levels': sorted({r['risk_level'] for r in unique})})
    return dict(output)


def leaders(groups, rows):
    rows = effective_rows(rows)
    result = {}
    for problem, entries in groups.items():
        def top(field, minimum=1):
            maximum = max((e[field] for e in entries), default=0)
            return [e['remedy'] for e in entries if e[field] == maximum] if maximum >= minimum else None
        contradict = max((e['contradictions']['score'] for e in entries), default=0)
        recoveries = [r for r in rows if r['problem_type'] == problem and r['reported_result'] == 'resolved'
                      and r['time_to_recovery'] and r['time_to_recovery']['exact']]
        fastest = min(recoveries, key=lambda r: r['time_to_recovery']['min_hours']) if recoveries else None
        result[problem] = {'MOST_COMMON_RESPONSE': top('independent_reports_count'),
                           'MOST_SUCCESSFUL_REPORTED_RESPONSE': top('reported_success_count', 3),
                           'FASTEST_REPORTED_RECOVERY': {'remedy': fastest['remedy_type'], 'hours': fastest['time_to_recovery']['min_hours'],
                                                        'sample_count': len(recoveries), 'note': 'Self-report minimum; not expected recovery time'} if fastest else None,
                           'MOST_CONTRADICTORY_RESPONSE': [e['remedy'] for e in entries if e['contradictions']['score'] == contradict] if contradict else None,
                           'NEW_EMERGING_RESPONSE': {'status': 'INSUFFICIENT_BASELINE', 'candidates': []}}
    return result


def trends(rows, at, baseline=None):
    now = parse_time(at)
    output = {}
    for label, days in [('24h', 1), ('7d', 7), ('30d', 30), ('historical_retained', None)]:
        selected = eligible(rows, now - timedelta(days=days) if days else None, now)
        selected = effective_rows(selected)
        groups = aggregate(selected)
        patterns = defaultdict(set)
        for r in selected:
            if r.get('candidate_pattern'):
                patterns[(r['problem_type'], r['candidate_pattern'])].add(r['author_reference'])
        output[label] = {'TOP_REPORTED_REMEDIES': groups, 'trends': leaders(groups, selected),
                         'coverage_state': 'PARTIAL', 'earliest_retained_publication': min((r['published_at'] for r in selected), default=None),
                         'end': at, 'limitations': ['Non-exhaustive public evidence; no validated comparable baseline']}
        output[label]['taxonomy_candidates'] = [{'problem_type': p, 'pattern': t, 'independent_authors': len(authors),
                                                  'status': 'REVIEW_REQUIRED', 'risk_level': 'HIGH_RISK'}
                                                 for (p, t), authors in patterns.items() if len(authors) >= 3]
    # Baseline is an internal collector coverage contract, never accepted from manual evidence.
    # Current V1 has only bounded RSS and no comment census, so this gate remains closed.
    if baseline and baseline.get('verified_comparable_30d') is True:
        old = aggregate(eligible(rows, now - timedelta(days=30), now - timedelta(days=7, microseconds=1)))
        for problem, entries in output['7d']['TOP_REPORTED_REMEDIES'].items():
            previous = {e['remedy'] for e in old.get(problem, [])}
            candidates = [e['remedy'] for e in entries if e['independent_reports_count'] >= 3 and e['remedy'] not in previous]
            output['7d']['trends'][problem]['NEW_EMERGING_RESPONSE'] = {'status': 'OBSERVED' if candidates else 'NONE', 'candidates': candidates}
    for section in output.values():
        for name in ('MOST_COMMON_RESPONSE', 'MOST_SUCCESSFUL_REPORTED_RESPONSE', 'FASTEST_REPORTED_RECOVERY',
                     'MOST_CONTRADICTORY_RESPONSE', 'NEW_EMERGING_RESPONSE'):
            section[name] = {problem: values[name] for problem, values in section['trends'].items()} or None
    return output
