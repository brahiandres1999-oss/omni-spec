// Zero-dependency coverage gate: runs the built-in Node test runner with the
// experimental coverage reporter, emits LCOV and enforces a line-coverage floor.
import { mkdir, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const outputDir = fileURLToPath(new URL('../coverage/', import.meta.url));
const lcovPath = fileURLToPath(new URL('../coverage/lcov.info', import.meta.url));
const minimum = Number(process.env.COVERAGE_MIN ?? 85);

await mkdir(outputDir, { recursive: true });
await rm(lcovPath, { force: true });

const result = spawnSync(
  process.execPath,
  [
    '--test',
    '--test-concurrency=1',
    '--experimental-test-coverage',
    '--test-reporter=spec',
    '--test-reporter=lcov',
    '--test-reporter-destination=stdout',
    `--test-reporter-destination=${lcovPath}`,
  ],
  { cwd: root, stdio: 'inherit', windowsHide: true },
);

if (result.status !== 0) {
  console.error(JSON.stringify({ coverage: 'NOT_EVALUATED', reason: 'Test run failed' }));
  process.exit(result.status ?? 1);
}

const report = await readFile(lcovPath, 'utf8');
let linesFound = 0;
let linesHit = 0;
let branchesFound = 0;
let branchesHit = 0;
for (const line of report.split(/\r?\n/)) {
  if (line.startsWith('LF:')) linesFound += Number(line.slice(3));
  else if (line.startsWith('LH:')) linesHit += Number(line.slice(3));
  else if (line.startsWith('BRF:')) branchesFound += Number(line.slice(4));
  else if (line.startsWith('BRH:')) branchesHit += Number(line.slice(4));
}

const lineCoverage = linesFound ? (linesHit / linesFound) * 100 : 0;
const branchCoverage = branchesFound ? (branchesHit / branchesFound) * 100 : 0;
const passed = lineCoverage >= minimum;

console.log(
  JSON.stringify(
    {
      lineCoverage: Number(lineCoverage.toFixed(2)),
      branchCoverage: Number(branchCoverage.toFixed(2)),
      coveredLines: linesHit,
      totalLines: linesFound,
      minimumLineCoverage: minimum,
      lcov: 'coverage/lcov.info',
      passed,
    },
    null,
    2,
  ),
);

if (!passed) {
  console.error(`Line coverage ${lineCoverage.toFixed(2)}% is below the required ${minimum}%.`);
  process.exit(1);
}
