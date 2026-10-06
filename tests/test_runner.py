# SPDX-License-Identifier: MIT
"""Integration checks for the QuickJS runner; no third-party test framework."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
QJS = shutil.which(os.environ.get('QJS', 'qjs'))
if QJS is None:
    raise SystemExit('Set QJS to a QuickJS executable')
QJS = str(Path(QJS).resolve())


class RunnerTests(unittest.TestCase):
    def invoke(self, script, *args):
        return subprocess.run([QJS, str(script), *args], text=True,
                              capture_output=True, cwd='/tmp', timeout=60)

    def test_real_workloads_repeat_and_async(self):
        result = self.invoke(ROOT / 'jetstream/run.js', '--test',
                             'lazy-collections,doxbee-async,sync-fs',
                             '--iterations', '2', '--repeat', '2', '--json')
        self.assertEqual(result.returncode, 0, result.stderr)
        rows = json.loads(result.stdout)['results']
        self.assertEqual(len(rows), 6)
        for row in rows:
            self.assertEqual(row['status'], 'pass')
            self.assertEqual(len(row['samples_ms']), 2)
            self.assertTrue(all(x >= 0 for x in row['samples_ms']))

    def test_invalid_options(self):
        for args in [('--test', 'missing'), ('--iterations', '0'),
                     ('--iterations', '1.5'), ('--repeat',), ('--unknown',)]:
            with self.subTest(args=args):
                result = self.invoke(ROOT / 'jetstream/run.js', *args)
                self.assertNotEqual(result.returncode, 0)
                self.assertTrue(result.stderr)

    def test_lifecycle_and_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            suite = Path(directory)
            shutil.copyfile(ROOT / 'jetstream/run.js', suite / 'run.js')
            (suite / 'upstream').mkdir()
            # Check awaited preparation, per-iteration RNG reset, iteration
            # indices, constructor arguments, and final validation together.
            good = '''class Benchmark {
                constructor(args) { this.n = args.iterationCount; this.i = 0; }
                async prepareForNextIteration() {
                    await Promise.resolve(); this.ready = true; Math.random();
                }
                async runIteration(i) {
                    await Promise.resolve();
                    if (!this.ready || i !== this.i++) throw Error('lifecycle');
                    this.ready = false;
                    const value = Math.random();
                    if (this.seed !== undefined && value !== this.seed) throw Error('RNG');
                    this.seed = value;
                }
                validate(n) { if (n !== this.n || n !== this.i) throw Error('count'); }
            }'''
            fixtures = {'good': good,
                        'invalid': 'class Benchmark { runIteration() {} validate() { throw Error("validation failure"); } }',
                        'rejected': 'class Benchmark { runIteration() { return Promise.reject(Error("async failure")); } }',
                        'sync': 'class Benchmark { runIteration() { if (Math.random.__resetSeed) throw Error("RNG leaked"); } }'}
            entries = []
            for name, source in fixtures.items():
                (suite / 'upstream' / (name + '.js')).write_text(source)
                entries.append(dict(name=name, files=[name + '.js'], group='test',
                                    deterministicRandom=name == 'good'))
            (suite / 'manifest.json').write_text(json.dumps(dict(suite='fixture', revision='test', benchmarks=entries)))
            result = self.invoke(suite / 'run.js', '--iterations', '3', '--json')
            self.assertEqual(result.returncode, 1)
            rows = json.loads(result.stdout)['results']
            self.assertEqual([row['status'] for row in rows], ['pass', 'fail', 'fail', 'pass'])
            self.assertIn('validation failure', rows[1]['error'])
            self.assertIn('async failure', rows[2]['error'])

    def test_combined_is_portable(self):
        subprocess.run(['python3', str(ROOT / 'tools/build-combined.py')],
                       check=True, capture_output=True)
        with tempfile.TemporaryDirectory() as directory:
            portable = Path(directory) / 'standalone.js'
            shutil.copyfile(ROOT / 'build/jetstream.js', portable)
            args = ('--test', 'bigint-bigdenary,richards', '--iterations', '2', '--json')
            result = self.invoke(portable, *args)
            reference = self.invoke(ROOT / 'jetstream/run.js', *args)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(reference.returncode, 0, reference.stderr)
            data = json.loads(result.stdout)
            expected = json.loads(reference.stdout)
            self.assertEqual(data['revision'], expected['revision'])
            self.assertEqual([(r['name'], r['status']) for r in data['results']],
                             [(r['name'], r['status']) for r in expected['results']])


if __name__ == '__main__':
    unittest.main()
