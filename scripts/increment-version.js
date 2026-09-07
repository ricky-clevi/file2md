import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// npm updates package.json and package-lock.json together. Do not create a commit/tag.
execFileSync(
  'npm',
  ['version', 'patch', '--no-git-tag-version', '--ignore-scripts'],
  {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    stdio: 'inherit'
  }
);
