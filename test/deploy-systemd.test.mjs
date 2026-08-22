import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function fixture(t, { healthFailure = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'cycleo-mcp-deploy-'));
  t.after(() => rm(root, { recursive: true }));
  const deployRoot = join(root, 'deploy');
  const releaseRoot = join(deployRoot, 'releases');
  const previousRelease = join(releaseRoot, 'previous');
  const shims = join(root, 'bin');
  const archive = join(deployRoot, 'release.tar.gz');
  const releaseId = 'a'.repeat(40);
  const expectedRelease = join(releaseRoot, releaseId);
  const events = join(root, 'events');

  await mkdir(previousRelease, { recursive: true });
  await mkdir(shims);
  await symlink(previousRelease, join(deployRoot, 'current'));
  await run('tar', ['--create', '--gzip', '--file', archive, 'package.json', 'package-lock.json', 'src', 'README.md', 'docs'], { cwd: repository });

  await writeFile(join(shims, 'systemctl'), `#!/usr/bin/env bash
if [[ "$1" == "show" ]]; then
  echo "path=/usr/bin/node ; argv[]=/usr/bin/node $EXPECTED_ENTRYPOINT"
  exit 0
fi
if [[ "$1" == "restart" ]]; then
  echo restart >> "$EVENTS"
  exit 0
fi
exit 0
`, { mode: 0o755 });
  await writeFile(join(shims, 'sudo'), '#!/usr/bin/env bash\nshift\nexec "$@"\n', { mode: 0o755 });
  await writeFile(join(shims, 'curl'), `#!/usr/bin/env bash
if [[ "$FORCE_HEALTH_FAILURE" == "1" ]]; then exit 1; fi
[[ "$(readlink -f "$DEPLOY_ROOT/current")" == "$EXPECTED_RELEASE" ]]
`, { mode: 0o755 });
  await writeFile(join(shims, 'sleep'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });

  return {
    archive,
    deployRoot,
    previousRelease,
    releaseId,
    expectedRelease,
    environment: {
      ...process.env,
      PATH: `${shims}:${process.env.PATH}`,
      DEPLOY_ROOT: deployRoot,
      EVENTS: events,
      EXPECTED_ENTRYPOINT: `${deployRoot}/current/src/server.mjs`,
      EXPECTED_RELEASE: expectedRelease,
      FORCE_HEALTH_FAILURE: healthFailure ? '1' : '0',
      npm_config_cache: join(root, 'npm-cache')
    }
  };
}

test('systemd deployment switches to a verified release', { skip: process.platform !== 'linux' }, async (t) => {
  const context = await fixture(t);
  await run('bash', [
    'ops/deploy-systemd.sh', context.archive, context.deployRoot, 'cycleo-mcp.service',
    context.releaseId, 'http://127.0.0.1:8787/healthz'
  ], { cwd: repository, env: context.environment });
  assert.equal(await readlink(join(context.deployRoot, 'current')), context.expectedRelease);
});

test('systemd deployment restores the previous release after a failed health check', { skip: process.platform !== 'linux' }, async (t) => {
  const context = await fixture(t, { healthFailure: true });
  await assert.rejects(run('bash', [
    'ops/deploy-systemd.sh', context.archive, context.deployRoot, 'cycleo-mcp.service',
    context.releaseId, 'http://127.0.0.1:8787/healthz'
  ], { cwd: repository, env: context.environment }), { code: 1 });
  assert.equal(resolve(context.deployRoot, await readlink(join(context.deployRoot, 'current'))), context.previousRelease);
});
