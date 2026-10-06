// SPDX-License-Identifier: MIT
// QuickJS runner for an unmodified subset of JetStream 3.0.
import * as std from 'std';
import * as os from 'os';

const base = scriptArgs[0].replace(/[^/]*$/, '');
function read(path) {
    const contents = std.loadFile(path);
    if (contents === null) throw new Error(`Cannot read ${path}`);
    return contents;
}
const manifest = typeof bundledManifest !== 'undefined'
    ? bundledManifest : JSON.parse(read(base + 'manifest.json'));
function sourceFor(entry) {
    return typeof bundledSources !== 'undefined' ? bundledSources[entry.name]
        : entry.files.map(file => read(base + 'upstream/' + file)).join('\n;\n');
}

function usage() {
    print('Usage: qjs jetstream/run.js [--list] [--test NAME[,NAME...]]');
    print('       [--iterations N] [--repeat N] [--json]');
    print('Defaults: all benchmarks, 3 iterations, 1 fresh-instance repeat.');
    print('Times are milliseconds; this is not an official JetStream score.');
}
function positiveInteger(text, flag) {
    if (!/^[1-9][0-9]*$/.test(text) || !Number.isSafeInteger(Number(text)))
        throw new Error(`${flag} requires a positive safe integer`);
    return Number(text);
}
function options() {
    const result = {iterations: 3, repeat: 1, json: false};
    for (let i = 1; i < scriptArgs.length; ++i) {
        const flag = scriptArgs[i];
        if (flag === '--help' || flag === '-h') { usage(); std.exit(0); }
        else if (flag === '--list') result.list = true;
        else if (flag === '--json') result.json = true;
        else if (['--test', '--iterations', '--repeat'].includes(flag)) {
            const value = scriptArgs[++i];
            if (value === undefined) throw new Error(`Missing value for ${flag}`);
            if (flag === '--test') result.names = value.split(',');
            else result[flag.slice(2)] = positiveInteger(value, flag);
        } else throw new Error(`Unknown option: ${flag}`);
    }
    if (result.names) {
        for (const name of result.names)
            if (!manifest.benchmarks.some(entry => entry.name === name))
                throw new Error(`Unknown benchmark: ${name}`);
    }
    return result;
}

// JetStreamDriver.js's Robert Jenkins generator, reset AFTER preparation,
// exactly as in the upstream preIterationCode. Installed before source loading.
function deterministicRandom() {
    let seed = 49734321;
    const random = () => {
        seed = ((seed + 0x7ed55d16) + (seed << 12)) & 0xffffffff;
        seed = ((seed ^ 0xc761c23c) ^ (seed >>> 19)) & 0xffffffff;
        seed = ((seed + 0x165667b1) + (seed << 5)) & 0xffffffff;
        seed = ((seed + 0xd3a2646c) ^ (seed << 9)) & 0xffffffff;
        seed = ((seed + 0xfd7046c5) + (seed << 3)) & 0xffffffff;
        seed = ((seed ^ 0xb55a4f09) ^ (seed >>> 16)) & 0xffffffff;
        return (seed >>> 0) / 0x100000000;
    };
    random.__resetSeed = () => { seed = 49734321; };
    return random;
}

async function run(entry, opts, repeat) {
    const originalRandom = Math.random;
    const originalBenchmark = Object.getOwnPropertyDescriptor(globalThis, 'Benchmark');
    const originalPerformance = Object.getOwnPropertyDescriptor(globalThis, 'performance');
    try {
        if (entry.deterministicRandom) Math.random = deterministicRandom();
        globalThis.performance = {now: os.now};
        delete globalThis.Benchmark;
        // Function scope keeps each workload's declarations independent. Some
        // browserify bundles export their class through globalThis.Benchmark.
        const loadStart = os.now();
        const BenchmarkClass = std.evalScript('(function () {\n' + sourceFor(entry)
            + '\n;return typeof Benchmark !== "undefined" ? Benchmark : globalThis.Benchmark;\n})()');
        const loadMs = os.now() - loadStart;
        if (typeof BenchmarkClass !== 'function') throw new Error('No Benchmark class');
        const setupStart = os.now();
        const benchmark = new BenchmarkClass({iterationCount: opts.iterations});
        const setupMs = os.now() - setupStart;
        const samples = [];
        for (let i = 0; i < opts.iterations; ++i) {
            // Match DefaultBenchmark (sync) and AsyncBenchmark (await) separately
            // to avoid adding a Promise job to synchronous measurements.
            const preparation = benchmark.prepareForNextIteration?.();
            if (preparation && typeof preparation.then === 'function') await preparation;
            if (entry.deterministicRandom) Math.random.__resetSeed();
            const start = os.now();
            const result = benchmark.runIteration(i);
            if (result && typeof result.then === 'function') await result;
            samples.push(os.now() - start);
        }
        await benchmark.validate?.(opts.iterations);
        const sorted = samples.slice().sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        return {name: entry.name, repeat, iterations: opts.iterations, load_ms: loadMs,
            setup_ms: setupMs, first_ms: samples[0], min_ms: sorted[0],
            median_ms: sorted.length % 2 ? sorted[middle] : (sorted[middle-1] + sorted[middle]) / 2,
            mean_ms: samples.reduce((a,b) => a+b, 0) / samples.length,
            samples_ms: samples, status: 'pass'};
    } finally {
        Math.random = originalRandom;
        if (originalBenchmark) Object.defineProperty(globalThis, 'Benchmark', originalBenchmark);
        else delete globalThis.Benchmark;
        if (originalPerformance) Object.defineProperty(globalThis, 'performance', originalPerformance);
        else delete globalThis.performance;
    }
}

async function main() {
    const opts = options();
    const selected = manifest.benchmarks.filter(entry => !opts.names || opts.names.includes(entry.name));
    if (opts.list) {
        for (const entry of selected) print(`${entry.name}\t${entry.group}`);
        return;
    }
    const results = [];
    let failures = 0;
    if (!opts.json) print('Benchmark                         repeat    first ms   median ms     mean ms');
    for (const entry of selected) {
        for (let repeat = 1; repeat <= opts.repeat; ++repeat) {
            try {
                const result = await run(entry, opts, repeat);
                results.push(result);
                if (!opts.json) print(`${entry.name.padEnd(34)} ${String(repeat).padStart(3)} ${result.first_ms.toFixed(3).padStart(11)} ${result.median_ms.toFixed(3).padStart(11)} ${result.mean_ms.toFixed(3).padStart(11)}`);
            } catch (error) {
                ++failures;
                const message = String(error) + (error.stack ? '\n' + error.stack : '');
                results.push({name: entry.name, repeat, status: 'fail', error: message});
                std.err.puts(`FAIL ${entry.name}: ${message}\n`);
            }
            // Collection is outside measured iterations. Repeats re-evaluate
            // source and construct fresh objects, but share the QuickJS process.
            std.gc();
        }
    }
    if (opts.json) print(JSON.stringify({suite: manifest.suite, revision: manifest.revision,
        iterations: opts.iterations, repeat: opts.repeat, results}, null, 2));
    else print(`\n${results.length - failures} passed, ${failures} failed (QuickJS subset; no official score).`);
    if (failures) std.exit(1);
}
main().catch(error => { std.err.puts(String(error) + (error.stack ? '\n' + error.stack : '') + '\n'); std.exit(1); });
