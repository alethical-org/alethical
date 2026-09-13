import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
// Exercise the installed, patched serializer and the runtime Expo actually selects.
const { graphToSerialAssetsAsync } = require('@expo/metro-config/build/serializer/serializeChunks');
const runtimeSource = readFileSync(
  require.resolve('@expo/cli/build/metro-require/require'),
  'utf8',
);
const asyncRequireSource = readFileSync(
  require.resolve('metro-runtime/src/modules/asyncRequire'),
  'utf8',
);
const root = '/shared-screen-fixture';
const path = (name: string) => `${root}/${name}.js`;
type Link = [name: string, async?: boolean];
type Asset = {
  filename: string;
  originFilename: string;
  type: string;
  source: string;
  metadata: {
    isAsync: boolean;
    modulePaths: string[];
    paths: Record<string, Record<string, string>>;
  };
};
type Settings = {
  enabled?: boolean;
  platform?: string;
  environment?: string;
  dev?: boolean;
  exporting?: boolean;
};

function module(name: string, body: string, links: Link[] = [], script = false) {
  const code = script
    ? body
    : `__d(function(global,require,importDefault,importAll,module,exports,d){${body}\n});`;
  return {
    path: path(name),
    dependencies: new Map(
      links.map(([target, async], index) => [
        String(index),
        {
          absolutePath: path(target),
          data: { name: target, data: { asyncType: async ? 'async' : null } },
        },
      ]),
    ),
    getSource: () => Buffer.from(code),
    output: [{ type: script ? 'js/script' : 'js/module', data: { code, lineCount: 1, map: [] } }],
  };
}

async function serialize(settings: Settings = {}, sharedVersion = 1) {
  const { enabled = true, platform = 'web', environment, dev = false, exporting = true } = settings;
  const modules = [
    module(
      'index',
      `require(d[0]); module.exports = {
        loadA: () => require(d[1])(d[2], d.paths),
        loadB: () => require(d[1])(d[3], d.paths)
      };`,
      [['startup'], ['async-loader'], ['screen-a', true], ['screen-b', true]],
    ),
    module('startup', 'global.startupRuns = (global.startupRuns || 0) + 1;'),
    module('async-loader', asyncRequireSource),
    module(
      'screen-a',
      `module.exports = {
        shared: require(d[0]), startup: require(d[1]), only: require(d[2]),
        loadNested: () => require(d[3])(d[4], d.paths),
        self: require(d[5]), loadSelf: () => require(d[3])(d[6], d.paths)
      };`,
      [
        ['shared'],
        ['startup'],
        ['only-a'],
        ['async-loader'],
        ['nested', true],
        ['self'],
        ['self', true],
      ],
    ),
    module(
      'screen-b',
      'module.exports = { shared: require(d[0]), startup: require(d[1]), only: require(d[2]) };',
      [['shared'], ['startup'], ['only-b']],
    ),
    module(
      'shared',
      `global.sharedRuns = (global.sharedRuns || 0) + 1; module.exports = { version: ${sharedVersion} };`,
    ),
    module('only-a', 'module.exports = "only A";'),
    module('only-b', 'module.exports = "only B";'),
    module('nested', 'module.exports = { shared: require(d[0]), only: require(d[1]) };', [
      ['shared'],
      ['only-nested'],
    ]),
    module('only-nested', 'module.exports = "nested dependency";'),
    module('self', 'module.exports = { shared: require(d[0]) };', [['shared']]),
  ];
  const ids = new Map(modules.map((item, index) => [item.path, index]));
  const { artifacts } = await graphToSerialAssetsAsync(
    { serializer: { alethicalKeepSharedWithScreens: enabled } },
    { splitChunks: true, includeSourceMaps: false },
    path('index'),
    [module('runtime', runtimeSource, [], true)],
    {
      dependencies: new Map(modules.map((item) => [item.path, item])),
      transformOptions: { platform, dev, customTransformOptions: { environment } },
    },
    {
      projectRoot: root,
      serverRoot: root,
      dev,
      runModule: true,
      modulesOnly: false,
      includeAsyncPaths: false,
      processModuleFilter: () => true,
      createModuleId: (modulePath: string) => ids.get(modulePath),
      getRunModuleStatement: (id: number) => `__r(${id});`,
      serializerOptions: { exporting, splitChunks: true },
    },
  );
  const assets = (artifacts as Asset[]).filter((asset) => asset.type === 'js');
  const asset = (name: string) => {
    const found = assets.find((item) => item.originFilename === `${name}.js`);
    if (!found) throw new Error(`Missing ${name} artifact`);
    return found;
  };
  return { assets, asset, ids };
}

function boot(result: Awaited<ReturnType<typeof serialize>>) {
  const context = createContext({ __DEV__: false, __METRO_GLOBAL_PREFIX__: '' });
  context.global = context;
  const pending = new Map<string, Promise<void>>();
  const requested: string[] = [];
  context.__loadBundleAsync = (url: string) => {
    if (!pending.has(url)) {
      pending.set(
        url,
        Promise.resolve().then(() => {
          const asset = result.assets.find((item) => `/${item.filename}` === url);
          if (!asset) throw new Error(`Missing async artifact ${url}`);
          requested.push(url);
          runInContext(asset.source, context);
        }),
      );
    }
    return pending.get(url);
  };
  runInContext(result.asset('index').source, context);
  return { context, requested, entry: context.__r(result.ids.get(path('index'))) };
}

describe('shared modules travel with their lazy screens', () => {
  it('keeps the entry small and each screen complete without unrelated screen modules', async () => {
    const result = await serialize();
    expect(result.assets.some((item) => item.filename.includes('__common'))).toBe(false);
    expect(result.assets.filter((item) => !item.metadata.isAsync)).toEqual([result.asset('index')]);
    expect(result.asset('index').metadata.modulePaths).toEqual([
      path('index'),
      path('startup'),
      path('async-loader'),
    ]);
    for (const [screen, own, unrelated] of [
      ['screen-a', 'only-a', 'only-b'],
      ['screen-b', 'only-b', 'only-a'],
    ]) {
      const paths = result.asset(screen).metadata.modulePaths;
      expect(paths).toContain(path('shared'));
      expect(paths).toContain(path(own));
      expect(paths).not.toContain(path(unrelated));
      expect(paths).not.toContain(path('startup'));
      expect(paths).not.toContain(path('async-loader'));
      expect(paths).not.toContain(path('only-nested'));
    }
  });

  it.each(['A', 'B'])('shares one live instance when screen %s loads first', async (first) => {
    const { context, entry } = boot(await serialize());
    expect(context.sharedRuns).toBeUndefined();
    const screen = await entry[`load${first}`]();
    const other = await entry[first === 'A' ? 'loadB' : 'loadA']();
    expect(screen.shared).toBe(other.shared);
    screen.shared.changed = true;
    expect(other.shared.changed).toBe(true);
    expect(context.sharedRuns).toBe(1);
    expect(context.startupRuns).toBe(1);
  });

  it('loads a nested closure and resolves a target already inside its own screen chunk', async () => {
    const result = await serialize();
    const { context, requested, entry } = boot(result);
    const screen = await entry.loadA();
    const nested = await screen.loadNested();
    expect(nested.only).toBe('nested dependency');
    expect(nested.shared).toBe(screen.shared);
    expect((await screen.loadSelf()).default).toBe(screen.self);
    expect(context.sharedRuns).toBe(1);
    expect(requested).toEqual([
      `/${result.asset('screen-a').filename}`,
      `/${result.asset('nested').filename}`,
    ]);
    expect(
      result.asset('screen-a').metadata.paths[result.ids.get(path('screen-a'))!],
    ).toMatchObject({ [result.ids.get(path('self'))!]: `/${result.asset('screen-a').filename}` });
  });

  it('changes the affected screen and entry filenames when shared code changes', async () => {
    const before = await serialize({}, 1);
    const after = await serialize({}, 2);
    for (const name of ['index', 'screen-a', 'screen-b', 'nested']) {
      expect(after.asset(name).filename).not.toBe(before.asset(name).filename);
    }
    const { entry } = boot(after);
    expect((await entry.loadA()).shared.version).toBe(2);
  });

  it.each<Settings>([
    { enabled: false },
    { platform: 'ios' },
    { platform: 'android' },
    { dev: true },
    { exporting: false },
    { environment: 'node' },
    { environment: 'react-server' },
  ])('preserves upstream common extraction outside the opt-in export: %j', async (settings) => {
    const result = await serialize(settings);
    const common = result.assets.find((item) => item.filename.includes('__common'));
    expect(common?.metadata.modulePaths).toContain(path('shared'));
    expect(result.asset('screen-a').metadata.modulePaths).not.toContain(path('shared'));
    expect(result.asset('screen-b').metadata.modulePaths).not.toContain(path('shared'));
  });
});
