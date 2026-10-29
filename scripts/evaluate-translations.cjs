#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { setTimeout: sleep } = require('node:timers/promises');

const root = path.resolve(__dirname, '..');
const HELP = `Subsarr subtitle evaluation (no AI calls by default)
Offline: node scripts/evaluate-translations.cjs --candidate-dir <dir> [--input <caseId>]
Live:    node scripts/evaluate-translations.cjs --live --endpoint <url> --provider <provider> --model <model> [--input <caseId>] [--quality-mode fast|balanced|review] [--allow-budget-override]
Candidates: <caseId>.<format>, or <caseId>.reference.<format> (reference-as-candidate).
Requires installed backend dependencies. JSON report is printed to stdout.
Offline exit code 1 means structural/terminology failure; readability warnings do not fail.
Live mode explicitly consumes provider quota; omitted --input runs every corpus case.
`;

function loadScorer() {
  // Reuse the exact backend parser and workspace quality evaluator. Transpile
  // only this synchronous import graph, without building or starting the app.
  const backendRequire = createRequire(path.join(root, 'backend/package.json'));
  const ts = backendRequire('typescript');
  const previous = require.extensions['.ts'];
  require.extensions['.ts'] = (module, filename) => {
    if (!filename.startsWith(path.join(root, 'backend/src') + path.sep))
      throw new Error('Evaluation loader only accepts backend source modules');
    const source = fs.readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
      fileName: filename,
    });
    module._compile(compiled.outputText, filename);
  };
  try {
    return require(path.join(root, 'backend/src/evaluation/evaluation-scoring.ts'));
  } finally {
    if (previous) require.extensions['.ts'] = previous;
    else delete require.extensions['.ts'];
  }
}

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  const flags = { '--live': true, '--allow-budget-override': true, '--help': true };
  const values = { '--candidate-dir': true, '--input': true, '--endpoint': true, '--provider': true, '--model': true, '--quality-mode': true };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (Object.hasOwn(options, argument)) throw new Error(`Duplicate option: ${argument}`);
    if (Object.hasOwn(flags, argument)) options[argument] = true;
    else if (Object.hasOwn(values, argument) && args[index + 1] && !args[index + 1].startsWith('--')) options[argument] = args[++index];
    else throw new Error(`Unknown option or missing value: ${argument}`);
  }
  if (options['--help']) { process.stdout.write(HELP); return; }
  const corpusDirectory = process.env.SUBSYNC_EVALUATION_CORPUS_DIR ?? path.join(root, 'backend/benchmarks/subtitles/v1');
  const corpus = JSON.parse(fs.readFileSync(path.join(corpusDirectory, 'corpus.json'), 'utf8'));
  const cases = options['--input'] ? corpus.cases.filter((entry) => entry.id === options['--input']) : corpus.cases;
  if (!cases.length) throw new Error('Unknown corpus case');
  if (options['--live']) {
    if (options['--candidate-dir']) throw new Error('--candidate-dir cannot be used with --live');
    for (const required of ['--endpoint', '--provider', '--model'])
      if (!options[required]) throw new Error(`Live mode requires ${required}`);
    const endpoint = new URL(options['--endpoint']);
    if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('Endpoint must use HTTP(S)');
    if (endpoint.username || endpoint.password) throw new Error('Credentials must not be embedded in endpoint URL');
    const base = endpoint.href.replace(/\/$/, '');
    const request = async (route, body, signal) => {
      const response = await fetch(`${base}${route}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`Evaluation API ${response.status}: ${await response.text()}`);
      return response.json();
    };
    const reports = [];
    for (const testCase of cases) {
      const controller = new AbortController();
      const interrupt = () => controller.abort(new Error('Interrupted'));
      process.once('SIGINT', interrupt);
      let id;
      let terminal = false;
      try {
        const created = await request('/evaluations/run', {
          caseId: testCase.id, provider: options['--provider'], model: options['--model'],
          qualityMode: options['--quality-mode'] ?? 'fast',
          allowBudgetOverride: options['--allow-budget-override'] ?? false,
        });
        id = created.id;
        while (true) {
          controller.signal.throwIfAborted();
          const status = await request(`/evaluations/${encodeURIComponent(id)}`, undefined, controller.signal);
          if (status.status === 'completed') {
            terminal = true;
            const report = await request(`/evaluations/${encodeURIComponent(id)}/report`, undefined, controller.signal);
            reports.push(report);
            if (!report.score.passed) process.exitCode = 1;
            break;
          }
          if (status.status === 'failed' || status.status === 'cancelled') {
            terminal = true;
            throw new Error(status.error ?? `Evaluation ${status.status}`);
          }
          await sleep(500, undefined, { signal: controller.signal });
        }
      } finally {
        process.removeListener('SIGINT', interrupt);
        if (id && !terminal) await request(`/evaluations/${encodeURIComponent(id)}/cancel`, {}).catch((error) => process.stderr.write(`Cancellation failed: ${error.message}\n`));
      }
    }
    process.stdout.write(JSON.stringify({ mode: 'live', corpusVersion: corpus.version, reports }, null, 2) + '\n');
    return;
  }
  for (const option of ['--endpoint', '--provider', '--model', '--quality-mode', '--allow-budget-override'])
    if (options[option] !== undefined) throw new Error(`${option} requires explicit --live`);
  if (!options['--candidate-dir']) throw new Error('Offline mode requires --candidate-dir');
  const scorer = loadScorer();
  const directory = path.resolve(options['--candidate-dir']);
  const results = cases.map((testCase) => {
    const { source, reference } = scorer.loadEvaluationCase(testCase);
    const candidatePath = [path.join(directory, `${testCase.id}.${testCase.format}`), path.join(directory, testCase.reference)].find((filename) => fs.existsSync(filename));
    if (!candidatePath) throw new Error(`Missing candidate for ${testCase.id}`);
    return scorer.scoreEvaluation(testCase, source, reference, fs.readFileSync(candidatePath, 'utf8'));
  });
  process.stdout.write(JSON.stringify({
    mode: 'offline', corpusVersion: corpus.version, limitations: corpus.limitations,
    humanReview: corpus.rubric.map((criterion) => ({ ...criterion, score: null })),
    actual: { latencyMs: null, responseCostUsd: null, providerResponses: [], note: 'Offline scoring performs no provider requests.' },
    results,
  }, null, 2) + '\n');
  if (results.some((result) => !result.passed)) process.exitCode = 1;
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
