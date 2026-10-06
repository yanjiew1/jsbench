#!/usr/bin/env python3
"""Build a movable QuickJS script; never download or modify upstream sources."""
# SPDX-License-Identifier: MIT
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
suite = root / 'jetstream'
manifest = json.loads((suite / 'manifest.json').read_text())
sources = {}
for entry in manifest['benchmarks']:
    parts = []
    for name in entry['files']:
        data = (suite / 'upstream' / name).read_bytes()
        if hashlib.sha256(data).hexdigest() != manifest['sha256'][name]:
            raise SystemExit(f'Upstream checksum mismatch: {name}')
        parts.append(data.decode('utf-8'))
    sources[entry['name']] = '\n;\n'.join(parts)
out = root / 'build' / 'jetstream.js'
out.parent.mkdir(exist_ok=True)
runner = (suite / 'run.js').read_text()
imports = "import * as std from 'std';\nimport * as os from 'os';\n"
runner = runner.replace(imports, '')
out.write_text(imports + '// Generated JetStream 3.0 subset. See upstream source notices below.\n'
    + '// Runner/tools LICENSE:\n' + ''.join('// ' + line + '\n' for line in (root / 'LICENSE').read_text().splitlines())
    + '// Upstream LICENSE:\n' + ''.join('// ' + line + '\n' for line in (suite / 'upstream' / 'LICENSE').read_text().splitlines())
    + 'const bundledManifest = ' + json.dumps(manifest) + ';\n'
    + 'const bundledSources = ' + json.dumps(sources, ensure_ascii=True) + ';\n'
    + runner)
print(out)
