import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.some(arg => !['--dry-run', '--skip-increment'].includes(arg))) {
  throw new Error('Supported flags: --dry-run, --skip-increment');
}
const dryRun = args.includes('--dry-run');
const run = (command, commandArgs) =>
  execFileSync(command, commandArgs, { cwd, stdio: 'inherit' });
// Validate before modifying the version. npm publish otherwise reruns these checks.
run('npm', ['run', 'prepublishOnly']);
if (dryRun) {
  // Preview the exact package locally, even when its current version is published.
  run('npm', ['pack', '--dry-run', '--ignore-scripts']);
} else {
  run('npm', ['whoami']);
  if (!args.includes('--skip-increment')) {
    run(process.execPath, ['scripts/increment-version.js']);
  }
  run('npm', ['publish', '--access=public', '--ignore-scripts']);
}
