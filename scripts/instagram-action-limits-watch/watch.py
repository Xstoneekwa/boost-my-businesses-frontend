#!/usr/bin/env python3
"""Local informational CLI; never imports Phone Farm services.

collect --once sends durable normalized batches when COMPASS_INGESTION_URL and
BOTAPP_RELAY_API_KEY are configured in the process environment. Endpoint must be
HTTPS /api/instagram-dashboard/compass/signals; redirects are never followed.
Without endpoint: NOT_CONFIGURED, bounded pending batches retained for retry.
Retention runs on each invocation, including before a failed delivery retry.
No scheduler, Fleet execution, or live source qualification is installed here.
"""
import argparse
import json
import os
from pathlib import Path
import sys
import sqlite3
from normalize import normalize, now_iso, safe_input
from remedies import extract_remedies
from correlate import build_report, markdown_report
from sources import collect_source, PinnedHTTPS
from urllib.parse import urlsplit
from normalize import digest
from store import Store

BASE = Path(__file__).resolve().parent


def read_json(path):
    p = Path(path)
    if p.stat().st_size > 524288:
        raise ValueError('INPUT_TOO_LARGE')
    with p.open() as handle:
        return safe_input(json.load(handle))


def import_items(payload, mode='MANUAL', at=None):
    items = payload if isinstance(payload, list) else [payload]
    if not items or len(items) > 100:
        raise ValueError('IMPORT_BATCH_LIMIT_100')
    signals, remedies = [], []
    for item in items:
        s = normalize(item, mode, at)
        signals.append(s)
        remedies.extend(extract_remedies(s, item['text_or_excerpt'], item))
    return signals, remedies


BACKEND_PATH = '/api/instagram-dashboard/compass/signals'
MAX_BATCH_BYTES = 524288


def post_backend(endpoint, key, payload):
    url = urlsplit(endpoint)
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.port not in (None, 443) or url.path != BACKEND_PATH or url.query or url.fragment:
        raise ValueError('INVALID_BACKEND_INGESTION_ENDPOINT')
    body = json.dumps(payload, sort_keys=True).encode()
    if len(body) > MAX_BATCH_BYTES or not key:
        raise ValueError('INVALID_BACKEND_BATCH_OR_AUTH')
    connection = PinnedHTTPS(url.hostname, timeout=20)
    try:
        connection.request('POST', url.path, body=body, headers={'Content-Type': 'application/json', 'x-botapp-relay-key': key})
        response = connection.getresponse()
        raw = response.read(65537)
        if response.status not in (200, 202) or len(raw) > 65536:
            raise ValueError('BACKEND_INGESTION_REJECTED')
        receipt = json.loads(raw)
        if receipt.get('ok') is not True or receipt.get('data', {}).get('signalsAccepted') != len(payload['signals']):
            raise ValueError('BACKEND_RECEIPT_INVALID')
    finally:
        connection.close()


def publish_pending(store, endpoint, key, transport=post_backend):
    if not endpoint:
        return 'NOT_CONFIGURED'
    pending = store.conn.execute("SELECT key,value FROM metadata WHERE key LIKE 'outbox:%' ORDER BY key LIMIT 10").fetchall()
    for batch_key, value in pending:
        transport(endpoint, key, json.loads(value))
        with store.conn:
            store.conn.execute('DELETE FROM metadata WHERE key=?', (batch_key,))
    return 'PASS'


def queue_collection(store, signals, checks):
    # Durable batches stay intact on timeout; delivery IDs are deterministic.
    if store.conn.execute("SELECT count(*) FROM metadata WHERE key LIKE 'outbox:%'").fetchone()[0] >= 10:
        raise ValueError('BACKEND_OUTBOX_FULL')
    batches = []
    for offset in range(0, max(1, len(signals)), 50):
        payload = {'signals': [{k: v for k, v in s.items() if k not in ('raw_evidence', 'notes')} for s in signals[offset:offset+50]],
                   'source_checks': checks if offset == 0 else []}
        raw = json.dumps(payload, sort_keys=True)
        if len(raw.encode()) > MAX_BATCH_BYTES:
            raise ValueError('BACKEND_BATCH_TOO_LARGE')
        batches.append(('outbox:' + digest(raw), raw))
    if store.conn.execute("SELECT count(*) FROM metadata WHERE key LIKE 'outbox:%'").fetchone()[0] + len(batches) > 10:
        raise ValueError('BACKEND_OUTBOX_FULL')
    store.check_size(sum(len(raw.encode()) for _,raw in batches) * 2)
    with store.conn:
        store.conn.executemany('INSERT OR IGNORE INTO metadata(key,value) VALUES(?,?)', batches)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', help='Dedicated empty/owned watcher directory only')
    sub = parser.add_subparsers(dest='command', required=True)
    collect = sub.add_parser('collect', help='One bounded public RSS collection; no scheduler')
    collect.add_argument('--once', action='store_true', required=True)
    imp = sub.add_parser('import-evidence', help='Offline public evidence import; no URL fetching')
    imp.add_argument('--file', required=True)
    for command in ('report', 'correlate'):
        p = sub.add_parser(command)
        p.add_argument('--incident', required=command == 'correlate')
        p.add_argument('--policy')
        p.add_argument('--include-synthetic', action='store_true', help='Demonstration only; explicit banner')
    args = parser.parse_args(argv)
    config = json.loads((BASE / 'config.json').read_text())
    if config['external_cost_eur'] != 0:
        raise ValueError('NONZERO_COST_CONFIG_DENIED')
    os.umask(0o077)
    # Validate all operator input before opening or mutating storage.
    imported = import_items(read_json(args.file)) if args.command == 'import-evidence' else None
    incident = read_json(args.incident) if getattr(args, 'incident', None) else None
    policy = read_json(args.policy) if getattr(args, 'policy', None) else None
    if args.command in ('report', 'correlate'):
        build_report([], [], [], incident, policy)
    with Store(args.data_dir or config['data_dir'], config['max_storage_bytes']) as store:
        store.retain(signal_days=config['signal_retention_days'], report_days=config['report_retention_days'], raw_hours=config['raw_retention_hours'], debug_hours=config['debug_retention_hours'])
        if args.command == 'collect':
            endpoint = os.environ.get('COMPASS_INGESTION_URL', '')
            relay_key = os.environ.get('BOTAPP_RELAY_API_KEY', '')
            publish_pending(store, endpoint, relay_key)
            checks, signals, remedies = [], [], []
            for source in config['sources']:
                check, items = collect_source(config, source, store.latest_check(source['id']))
                rejected = 0
                for item in items:
                    try:
                        ss, rr = import_items(item, 'AUTOMATIC', check['checked_at'])
                        signals += ss
                        remedies += rr
                    except (ValueError, TypeError):
                        rejected += 1
                check['rejected_entries'] = rejected
                checks.append(check)
            queue_collection(store, signals, checks)
            store.ingest(signals, remedies, checks)
            delivery = publish_pending(store, endpoint, relay_key)
            result = {'command': 'collect', 'collected_at': now_iso(), 'source_checks': checks,
                      'signals_processed': len(signals), 'remedies_processed': len(remedies), 'external_cost_eur': 0, 'backend_delivery': delivery}
        elif args.command == 'import-evidence':
            signals, remedies = imported
            store.ingest(signals, remedies)
            result = {'command': 'import-evidence', 'ingest_mode': 'MANUAL', 'signals_processed': len(signals),
                      'retained_signals': len(store.all_signals()), 'remedies_processed': len(remedies), 'external_cost_eur': 0}
        else:
            signals = [s for s in store.all_signals() if args.include_synthetic or not s['synthetic']]
            ids = {s['id'] for s in signals}
            remedies = [r for r in store.all_remedies() if r['problem_signal_id'] in ids]
            result = build_report(signals, remedies, store.checks(), incident, policy)
            report_id = store.save_report(result, markdown_report(result))
            result = {'report_id': report_id, 'json_path': str(store.root / 'reports' / (report_id + '.json')),
                      'markdown_path': str(store.root / 'reports' / (report_id + '.md')),
                      'EXTERNAL_PROBLEM_VERDICT': result['EXTERNAL_PROBLEM_VERDICT'],
                      'EXTERNAL_SIGNAL_STRENGTH': result['EXTERNAL_SIGNAL_STRENGTH']}
        result['storage'] = store.retain(signal_days=config['signal_retention_days'], report_days=config['report_retention_days'], raw_hours=config['raw_retention_hours'], debug_hours=config['debug_retention_hours'])
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, sqlite3.Error) as error:
        # Local validation errors only; no raw content, credentials or stack traces printed.
        print(json.dumps({'status': 'ERROR', 'reason': str(error) if isinstance(error, ValueError) else type(error).__name__}), file=sys.stderr)
        sys.exit(2)
