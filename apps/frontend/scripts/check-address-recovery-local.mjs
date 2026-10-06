// Manual, isolated release-browser checks. No .env, backend or vendor service.
import { execFileSync, spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { setTimeout as pause } from 'node:timers/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(frontend, '../..');
export function cleanEnvironment(source = process.env) {
  const env = Object.fromEntries(
    [
      'PATH',
      'HOME',
      'TMPDIR',
      'TEMP',
      'TMP',
      'SYSTEMROOT',
      'LANG',
      'LC_ALL',
      'PLAYWRIGHT_BROWSERS_PATH',
    ]
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]]),
  );
  return {
    ...env,
    CI: '1',
    NODE_ENV: 'production',
    EXPO_NO_DOTENV: '1',
    EXPO_NO_TELEMETRY: '1',
    EXPO_OFFLINE: '1',
    EXPO_PUBLIC_API_URL: 'http://fixture.invalid',
  };
}
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};
export function exportServer(directory) {
  return createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      return response.end();
    }
    try {
      const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const candidate = resolve(directory, `.${path}`);
      if (candidate !== directory && !candidate.startsWith(`${directory}${sep}`)) {
        response.writeHead(403);
        return response.end();
      }
      let file = candidate;
      let info = await stat(file).catch(() => null);
      if ((!info || !info.isFile()) && !extname(path) && !path.startsWith('/api/')) {
        file = resolve(directory, 'index.html');
        info = await stat(file);
      }
      if (!info?.isFile()) {
        response.writeHead(404);
        return response.end();
      }
      const actual = await realpath(file);
      if (!actual.startsWith(`${directory}${sep}`)) {
        response.writeHead(403);
        return response.end();
      }
      response.writeHead(200, {
        'Content-Type': types[extname(file)] ?? 'application/octet-stream',
        'Content-Length': info.size,
        'Cache-Control': 'no-store',
      });
      if (request.method === 'HEAD') return response.end();
      const stream = createReadStream(actual);
      stream.on('error', () => response.destroy());
      stream.pipe(response);
    } catch {
      response.writeHead(400);
      response.end();
    }
  });
}
async function main() {
  let directory;
  let server;
  let child;
  let ownedGroup;
  let signal;
  let killTimer;
  const stopChild = (name) => {
    if (!ownedGroup) return;
    try {
      if (process.platform === 'win32') child?.kill(name);
      else process.kill(-ownedGroup, name);
    } catch {
      /* This owned group already exited. */
    }
  };
  const clearOwnedGroup = async () => {
    stopChild('SIGKILL');
    const deadline = Date.now() + 3000;
    while (ownedGroup && process.platform !== 'win32') {
      try {
        process.kill(-ownedGroup, 0);
      } catch (error) {
        if (error.code === 'ESRCH') break;
        if (error.code !== 'EPERM') throw error;
        // macOS can report EPERM while a killed group disappears. Do not
        // mistake that for success if any live member still belongs to it.
        const members = execFileSync('ps', ['-axo', 'pgid=,stat='], {
          encoding: 'utf8',
          env,
        });
        if (
          !members.split('\n').some((line) => {
            const [group, status] = line.trim().split(/\s+/);
            return Number(group) === ownedGroup && !status?.startsWith('Z');
          })
        )
          break;
      }
      if (Date.now() >= deadline)
        throw new Error('Owned process group did not exit; temporary export retained');
      await pause(20);
    }
    ownedGroup = undefined;
    clearTimeout(killTimer);
    killTimer = undefined;
  };
  const onSignal = (name) => {
    signal = name;
    stopChild(name);
    killTimer ??= setTimeout(() => stopChild('SIGKILL'), 3000);
    killTimer.unref();
  };
  const handlers = ['SIGINT', 'SIGTERM'].map((name) => {
    const handler = () => onSignal(name);
    process.on(name, handler);
    return [name, handler];
  });
  const env = cleanEnvironment();
  const run = (args, extra = {}) =>
    new Promise((yes, no) => {
      if (signal) return no(new Error('Local checks interrupted'));
      child = spawn(process.execPath, args, {
        cwd: frontend,
        env: { ...env, ...extra },
        stdio: 'inherit',
        detached: process.platform !== 'win32',
      });
      ownedGroup = child.pid;
      child.once('error', (error) => {
        child = null;
        no(error);
      });
      child.once('exit', async (code) => {
        child = null;
        try {
          // Clean this phase before another child can replace its group ID.
          await clearOwnedGroup();
        } catch (error) {
          return no(error);
        }
        if (signal || code !== 0)
          no(new Error(signal ? 'Local checks interrupted' : 'Local check failed'));
        else yes();
      });
    });
  try {
    const onlyIndex = process.argv.indexOf('--only');
    const filter = process.argv[onlyIndex + 1];
    if (onlyIndex >= 0 && (!filter?.trim() || filter.startsWith('--')))
      throw new Error('--only needs a nonempty check-name filter');
    directory = await realpath(await mkdtemp(resolve(tmpdir(), 'alethical-address-check-')));
    const exported = resolve(directory, 'export');
    const cache = resolve(directory, 'cache');
    await mkdir(cache);
    env.TMPDIR = cache;
    env.TEMP = cache;
    env.TMP = cache;
    await run([
      resolve(repo, 'node_modules/expo/bin/cli'),
      'export',
      '--platform',
      'web',
      '--output-dir',
      exported,
    ]);
    if (signal) throw new Error('Local checks interrupted');
    server = exportServer(exported);
    await new Promise((yes, no) => {
      server.once('error', no);
      server.listen(0, '127.0.0.1', yes);
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    // The export is built once; each engine gets fresh isolated contexts.
    const args = process.argv.slice(2);
    for (const engine of args.includes('--firefox')
      ? ['--firefox']
      : args.includes('--webkit')
        ? ['--webkit']
        : ['', '--webkit']) {
      await run(
        [
          resolve(frontend, 'scripts/check-address-recovery.mjs'),
          ...(engine ? [engine] : []),
          ...args.filter((arg) => !['--webkit', '--firefox'].includes(arg)),
        ],
        { BASE_URL: base },
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Local check failed');
    process.exitCode = signal === 'SIGINT' ? 130 : signal ? 143 : 1;
  } finally {
    await clearOwnedGroup();
    if (server) {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    }
    if (directory) await rm(directory, { recursive: true, force: true });
    clearTimeout(killTimer);
    for (const [name, handler] of handlers) process.off(name, handler);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
