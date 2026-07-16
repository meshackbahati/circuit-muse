"""
Tests for the compile-job deduplication logic in routes/compile.py.

Covers:
- _job_key() stability across invocations + variance with content/board
- _purge_expired_jobs() cleans both COMPILE_JOBS and JOB_BY_KEY consistently

Does NOT exercise the full FastAPI route or the ESP-IDF toolchain — those are
covered by integration tests. This file is fast (no I/O, no toolchain).

Run from the repo root:
    python -m pytest test/backend/unit/test_compile_dedup.py -v
"""

import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent / 'backend'))

from app.api.routes import compile as compile_module


class JobKeyTests(unittest.TestCase):
    def setUp(self):
        # Reset module-level state before each test so they don't leak.
        compile_module.COMPILE_JOBS.clear()
        compile_module.JOB_BY_KEY.clear()

    def test_key_stable_across_invocations(self):
        files = [{'name': 'sketch.ino', 'content': 'void setup(){}'}]
        k1 = compile_module._job_key(files, 'esp32:esp32:esp32')
        k2 = compile_module._job_key(files, 'esp32:esp32:esp32')
        self.assertEqual(k1, k2)

    def test_key_changes_with_content(self):
        k1 = compile_module._job_key(
            [{'name': 'sketch.ino', 'content': 'void setup(){}'}],
            'esp32:esp32:esp32',
        )
        k2 = compile_module._job_key(
            [{'name': 'sketch.ino', 'content': 'void loop(){}'}],
            'esp32:esp32:esp32',
        )
        self.assertNotEqual(k1, k2)

    def test_key_changes_with_filename(self):
        k1 = compile_module._job_key(
            [{'name': 'sketch.ino', 'content': 'X'}],
            'esp32:esp32:esp32',
        )
        k2 = compile_module._job_key(
            [{'name': 'other.ino', 'content': 'X'}],
            'esp32:esp32:esp32',
        )
        self.assertNotEqual(k1, k2)

    def test_key_changes_with_board(self):
        files = [{'name': 'sketch.ino', 'content': 'X'}]
        k1 = compile_module._job_key(files, 'esp32:esp32:esp32')
        k2 = compile_module._job_key(files, 'esp32:esp32:esp32c3')
        self.assertNotEqual(k1, k2)

    def test_key_independent_of_file_order(self):
        files_a = [
            {'name': 'a.ino', 'content': 'X'},
            {'name': 'b.h', 'content': 'Y'},
        ]
        files_b = [
            {'name': 'b.h', 'content': 'Y'},
            {'name': 'a.ino', 'content': 'X'},
        ]
        k1 = compile_module._job_key(files_a, 'esp32:esp32:esp32')
        k2 = compile_module._job_key(files_b, 'esp32:esp32:esp32')
        self.assertEqual(k1, k2)


class PurgeExpiredJobsTests(unittest.TestCase):
    def setUp(self):
        compile_module.COMPILE_JOBS.clear()
        compile_module.JOB_BY_KEY.clear()

    def test_purge_drops_done_jobs_past_ttl(self):
        old_finished = time.time() - compile_module.JOB_TTL_S - 10
        compile_module.COMPILE_JOBS['old-id'] = {
            'state': 'done',
            'started_at': old_finished - 60,
            'finished_at': old_finished,
            'key': 'k1',
        }
        compile_module.JOB_BY_KEY['k1'] = 'old-id'

        compile_module._purge_expired_jobs()

        self.assertNotIn('old-id', compile_module.COMPILE_JOBS)
        self.assertNotIn('k1', compile_module.JOB_BY_KEY)

    def test_purge_keeps_running_jobs(self):
        # No finished_at; state=running. Should never be purged.
        compile_module.COMPILE_JOBS['running-id'] = {
            'state': 'running',
            'started_at': time.time() - 10000,
            'key': 'k2',
        }
        compile_module.JOB_BY_KEY['k2'] = 'running-id'

        compile_module._purge_expired_jobs()

        self.assertIn('running-id', compile_module.COMPILE_JOBS)
        self.assertIn('k2', compile_module.JOB_BY_KEY)

    def test_purge_does_not_evict_key_pointing_at_newer_job(self):
        # Edge case: an old finished job and a newer running job share the
        # same key. JOB_BY_KEY[key] points at the newer one. Purging the old
        # job must NOT clear the key (it would orphan the running job from
        # future dedup hits).
        old_finished = time.time() - compile_module.JOB_TTL_S - 10
        compile_module.COMPILE_JOBS['old-id'] = {
            'state': 'done',
            'started_at': old_finished - 60,
            'finished_at': old_finished,
            'key': 'shared-key',
        }
        compile_module.COMPILE_JOBS['new-id'] = {
            'state': 'running',
            'started_at': time.time() - 5,
            'key': 'shared-key',
        }
        compile_module.JOB_BY_KEY['shared-key'] = 'new-id'

        compile_module._purge_expired_jobs()

        self.assertNotIn('old-id', compile_module.COMPILE_JOBS)
        self.assertIn('new-id', compile_module.COMPILE_JOBS)
        # Crucially, the key still points at the running job.
        self.assertEqual(compile_module.JOB_BY_KEY.get('shared-key'), 'new-id')


if __name__ == '__main__':
    unittest.main()
