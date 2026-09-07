import { execFileSync } from 'node:child_process';

// Verify authentication without reading or printing tokens.
try {
  execFileSync('npm', ['whoami'], { stdio: 'inherit' });
} catch {
  console.error(
    'Run npm login or configure an npm publish token, then try again.'
  );
  process.exitCode = 1;
}
