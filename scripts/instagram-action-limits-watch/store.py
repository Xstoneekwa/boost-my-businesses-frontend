"""Isolated bounded local SQLite, one nonblocking process lock, protected evidence retention."""
import fcntl
import json
import os
from pathlib import Path
import sqlite3
import uuid
from datetime import timedelta
from normalize import now_iso, parse_time, classify

MARKER = 'instagram-action-limits-watch-v1'


class Store:
    def __init__(self, root, max_bytes=104857600):
        self.root = Path(root).absolute()
        self.max_bytes = max_bytes
        self.conn = None
        self.lock = None

    def size(self):
        total = 0
        for p in self.root.rglob('*'):
            if p.is_symlink():
                raise ValueError('STORAGE_SYMLINK_DENIED')
            if p.is_file():
                total += p.stat().st_size
        return total

    def check_size(self, extra=0):
        if self.size() + extra > self.max_bytes:
            raise ValueError('STORAGE_LIMIT_REACHED')

    def __enter__(self):
        if any(p.is_symlink() for p in [self.root, *self.root.parents]):
            raise ValueError('STORAGE_SYMLINK_DENIED')
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        marker = self.root / '.watcher-owner'
        if not marker.exists() and any(self.root.iterdir()):
            raise ValueError('UNOWNED_STORAGE_DIRECTORY')
        if marker.exists() and marker.read_text() != MARKER:
            raise ValueError('UNOWNED_STORAGE_DIRECTORY')
        self.check_size()
        self.lock = open(self.root / '.lock', 'a+')
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self.lock.close()
            raise ValueError('CONCURRENT_RUN_LOCKED') from None
        try:
            marker.write_text(MARKER)
            os.chmod(marker, 0o600)
            (self.root / 'reports').mkdir(mode=0o700, exist_ok=True)
            self.conn = sqlite3.connect(self.root / 'watch.sqlite3')
            os.chmod(self.root / 'watch.sqlite3', 0o600)
            self.conn.execute('PRAGMA journal_mode=DELETE')
            self.conn.execute('PRAGMA foreign_keys=ON')
            self.conn.execute('PRAGMA secure_delete=ON')
            self.conn.execute('PRAGMA max_page_count=' + str(max(1, (self.max_bytes - 16384) // 4096)))
            self.conn.executescript('''
            CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            INSERT OR IGNORE INTO metadata VALUES('schema_version','1');
            CREATE TABLE IF NOT EXISTS signals(id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS signal_versions(id INTEGER PRIMARY KEY, signal_id TEXT NOT NULL REFERENCES signals(id), data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS remedies(id TEXT PRIMARY KEY, signal_id TEXT NOT NULL REFERENCES signals(id), data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS source_checks(id INTEGER PRIMARY KEY, source_id TEXT, checked_at TEXT, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY, created_at TEXT, protected INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS report_links(report_id TEXT REFERENCES reports(id) ON DELETE CASCADE, signal_id TEXT REFERENCES signals(id), PRIMARY KEY(report_id,signal_id));
            ''')
            if self.conn.execute("SELECT value FROM metadata WHERE key='schema_version'").fetchone()[0] != '1':
                raise ValueError('UNSUPPORTED_SCHEMA_VERSION')
            self.check_size()
            return self
        except Exception:
            self.__exit__(None, None, None)
            raise

    def __exit__(self, *args):
        if self.conn:
            self.conn.close()
        if self.lock:
            self.lock.close()

    def all_signals(self):
        rows = [json.loads(row[0]) for row in self.conn.execute('SELECT data FROM signals')]
        for row in rows:
            # Revalidate the retained minimal evidence with current deterministic rules;
            # never leave an old classifier false positive admissible after a rules fix.
            row['action_type'] = classify(row['title'] + ' ' + row.get('raw_evidence', row.get('short_summary', '')))
            if row['action_type'] == 'OTHER':
                row['exclusion_reasons'] = sorted(set(row['exclusion_reasons'] + ['OTHER_SYMPTOM']))
        return rows

    def all_remedies(self):
        signals = {s['id']: s for s in self.all_signals()}
        rows = [json.loads(row[0]) for row in self.conn.execute('SELECT data FROM remedies')]
        for r in rows:
            parent = signals[r['problem_signal_id']]
            r['problem_type'] = parent['action_type']
            r['exclusion_reasons'] = sorted(set(r['exclusion_reasons'] + parent['exclusion_reasons']))
        return rows

    def latest_check(self, source_id):
        row = self.conn.execute('SELECT data FROM source_checks WHERE source_id=? ORDER BY id DESC LIMIT 1', (source_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def checks(self):
        return [json.loads(row[0]) for row in self.conn.execute('SELECT data FROM source_checks ORDER BY id')]

    def ingest(self, signals, remedies=(), checks=()):
        extra = len(json.dumps([signals, remedies, checks]).encode()) * 3 + 65536
        self.check_size(extra)
        with self.conn:
            for s in signals:
                s = dict(s)
                old = self.conn.execute('SELECT data FROM signals WHERE id=?', (s['id'],)).fetchone()
                if old:
                    previous = json.loads(old[0])
                    if any(previous.get(k) != s.get(k) for k in ('raw_evidence', 'source_url', 'published_at', 'evidence_ingest_mode')):
                        self.conn.execute('INSERT INTO signal_versions(signal_id,data) VALUES(?,?)', (s['id'], old[0]))
                    # Preserve previous provenance; changed publication metadata is a conflict.
                    s['first_collected_at'] = previous['first_collected_at']
                    s['first_seen'] = previous.get('first_seen', previous['first_collected_at'])
                    s['ingest_modes'] = sorted(set(previous['ingest_modes'] + s['ingest_modes']))
                    if previous['published_at'] != s['published_at']:
                        s['date_conflict'] = True
                        s['exclusion_reasons'] = sorted(set(s['exclusion_reasons'] + ['PUBLICATION_CONFLICT']))
                    s['date_conflict'] = s['date_conflict'] or previous['date_conflict']
                    if s['date_conflict']:
                        s['exclusion_reasons'] = sorted(set(s['exclusion_reasons'] + ['PUBLICATION_CONFLICT']))
                s['exclusion_reason'] = sorted(set(s.get('exclusion_reason', []) + s['exclusion_reasons']))
                self.conn.execute('INSERT INTO signals VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', (s['id'], json.dumps(s)))
            for r in remedies:
                if r.get('followup_of'):
                    previous = self.conn.execute('SELECT data FROM remedies WHERE id=?', (r['followup_of'],)).fetchone()
                    if not previous:
                        raise ValueError('FOLLOWUP_REFERENCE_NOT_FOUND')
                    parent = json.loads(previous[0])
                    if (parent['author_reference'] != r['author_reference'] or parent['problem_type'] != r['problem_type']
                            or not parse_time(r['published_at']) or not parse_time(parent['published_at'])
                            or parse_time(r['published_at']) <= parse_time(parent['published_at'])):
                        raise ValueError('FOLLOWUP_AUTHOR_PROBLEM_OR_DATE_MISMATCH')
                self.conn.execute('INSERT INTO remedies VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', (r['id'], r['problem_signal_id'], json.dumps(r)))
            for c in checks:
                self.conn.execute('INSERT INTO source_checks(source_id,checked_at,data) VALUES(?,?,?)', (c['source_id'], c['checked_at'], json.dumps(c)))
            self.check_size()

    def save_report(self, report, markdown):
        report_id = str(uuid.uuid4())
        encoded = json.dumps(report, ensure_ascii=False, indent=2)
        self.check_size(len(encoded.encode()) * 3 + len(markdown.encode()) + 65536)
        created = []
        try:
            with self.conn:
                self.conn.execute('INSERT INTO reports VALUES(?,?,?,?)',
                                  (report_id, report['generated_at'], int(bool(report.get('PHONE_FARM_INCIDENT'))), encoded))
                # Protect all inputs to retained correlations AND remedy aggregates, not only matches.
                for s in self.all_signals():
                    self.conn.execute('INSERT INTO report_links VALUES(?,?)', (report_id, s['id']))
                for ext, text in [('json', encoded), ('md', markdown)]:
                    p = self.root / 'reports' / (report_id + '.' + ext)
                    with p.open('x') as handle:
                        created.append(p)
                        handle.write(text)
                    os.chmod(p, 0o600)
                self.check_size()
        except Exception:
            for p in created:
                p.unlink()  # Exact files created by this failed transaction only.
            raise
        return report_id

    def retain(self, at=None, signal_days=30, report_days=90, raw_hours=72, debug_hours=72):
        now = parse_time(at or now_iso())
        debug_cut = now - timedelta(hours=debug_hours)
        raw_cut = now - timedelta(hours=raw_hours)
        signal_cut = now - timedelta(days=signal_days)
        report_cut = now - timedelta(days=report_days)
        expired = [(i,) for i, created, protected in self.conn.execute('SELECT id,created_at,protected FROM reports')
                   if not protected and parse_time(created) < report_cut]
        with self.conn:
            # Remove raw excerpts even when a compact decision summary is protected.
            def strip_raw(value):
                if isinstance(value, dict):
                    return {k: strip_raw(v) for k, v in value.items() if k not in ('raw_evidence', 'text_or_excerpt', 'raw_payload')}
                if isinstance(value, list):
                    return [strip_raw(v) for v in value]
                return value
            for table in ('signals', 'signal_versions'):
                for rowid, raw in self.conn.execute('SELECT rowid,data FROM ' + table).fetchall():
                    value = json.loads(raw)
                    when = parse_time(value.get('retrieved_at') or value.get('last_collected_at'))
                    if when and when < raw_cut:
                        self.conn.execute('UPDATE ' + table + ' SET data=? WHERE rowid=?', (json.dumps(strip_raw(value)), rowid))
            for rid, created, raw in self.conn.execute('SELECT id,created_at,data FROM reports').fetchall():
                if parse_time(created) < raw_cut:
                    value = strip_raw(json.loads(raw))
                    self.conn.execute('UPDATE reports SET data=? WHERE id=?', (json.dumps(value), rid))
                    target = self.root / 'reports' / (rid + '.json')
                    if target.is_symlink():
                        raise ValueError('STORAGE_SYMLINK_DENIED')
                    if target.exists():
                        target.write_text(json.dumps(value))
            for (rid,) in expired:
                for ext in ('json', 'md'):
                    p = self.root / 'reports' / (rid + '.' + ext)
                    if p.is_symlink():
                        raise ValueError('STORAGE_SYMLINK_DENIED')
                    p.unlink(missing_ok=True)
                self.conn.execute('DELETE FROM reports WHERE id=?', (rid,))
            for s in self.all_signals():
                if parse_time(s['last_collected_at']) < signal_cut and not self.conn.execute('SELECT 1 FROM report_links WHERE signal_id=?', (s['id'],)).fetchone():
                    self.conn.execute('DELETE FROM remedies WHERE signal_id=?', (s['id'],))
                    self.conn.execute('DELETE FROM signal_versions WHERE signal_id=?', (s['id'],))
                    self.conn.execute('DELETE FROM signals WHERE id=?', (s['id'],))
            # Keep last status of each source even after 30 days: refusals/cooldowns survive.
            self.conn.execute('DELETE FROM source_checks WHERE checked_at < ? AND id NOT IN (SELECT MAX(id) FROM source_checks GROUP BY source_id)', (debug_cut.isoformat().replace('+00:00', 'Z'),))
        return {'expired_reports': len(expired), 'bytes': self.size(), 'protected_incident_reports': True}
