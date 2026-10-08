// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  BaseNavigationContainer,
  createNavigatorFactory,
  createNavigationContainerRef,
  useNavigationBuilder,
  usePreventRemove,
  type NavigationAction,
  type StackRouterOptions,
  type DefaultNavigatorOptions,
  type StackNavigationState,
  type ParamListBase,
  type StackActionHelpers,
} from '@react-navigation/core';
import { StackRouter } from '@react-navigation/routers';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { candidateEditorId, candidateEditorRouter } from '../candidateEditorRouter';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

type Options = DefaultNavigatorOptions<
  ParamListBase,
  string | undefined,
  StackNavigationState<ParamListBase>,
  object,
  {},
  StackActionHelpers<ParamListBase>
> &
  StackRouterOptions;

// The real navigation router, event emitter and usePreventRemove are essential:
// a mocked navigation.navigate would miss the draft-loss bug this reproduces.
function TestNavigator(props: Options) {
  const { state, descriptors, NavigationContent } = useNavigationBuilder(StackRouter, props);
  return (
    <NavigationContent>{descriptors[state.routes[state.index].key].render()}</NavigationContent>
  );
}
const Stack = createNavigatorFactory(TestNavigator)();
const nav = createNavigationContainerRef<{
  Home: undefined;
  CandidateManage: { candidateId: string };
  CandidateProfile: { candidateId: string };
}>();
function Editor() {
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<NavigationAction | null>(null);
  usePreventRemove(Boolean(draft), ({ data }) => setPending(data.action));
  return (
    <>
      <input
        aria-label="Statement"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button onClick={() => nav.navigate('CandidateProfile', { candidateId: 'a' })}>
        View public profile
      </button>
      <button onClick={() => nav.navigate('Home')}>Home</button>
      <button onClick={() => nav.navigate('CandidateManage', { candidateId: 'b' })}>
        Another candidate
      </button>
      {pending ? (
        <div role="dialog">
          You have unsaved changes
          <button onClick={() => setPending(null)}>Keep editing</button>
          <button onClick={() => nav.dispatch(pending)}>Discard changes</button>
        </div>
      ) : null}
    </>
  );
}
let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <BaseNavigationContainer ref={nav}>
        <Stack.Navigator initialRouteName="Home" UNSTABLE_router={candidateEditorRouter}>
          <Stack.Screen name="Home">{() => <p>Home screen</p>}</Stack.Screen>
          <Stack.Screen name="CandidateManage" component={Editor} getId={candidateEditorId} />
          <Stack.Screen name="CandidateProfile">{() => <p>Public profile</p>}</Stack.Screen>
        </Stack.Navigator>
      </BaseNavigationContainer>,
    );
  });
  await act(async () => nav.navigate('CandidateManage', { candidateId: 'a' }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function click(label: string) {
  const button = Array.from(host.querySelectorAll('button')).find(
    (item) => item.textContent === label,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
async function typeDraft() {
  const input = host.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      'Keep this draft',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it.each(['View public profile', 'Home', 'Another candidate'])(
  'protects an unsaved draft when leaving through %s',
  async (label) => {
    await typeDraft();
    await click(label);
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain(
      'You have unsaved changes',
    );
    expect(nav.getCurrentRoute()?.params).toEqual({ candidateId: 'a' });
    await click('Keep editing');
    expect(host.querySelector<HTMLInputElement>('input')?.value).toBe('Keep this draft');
    await click(label);
    await click('Discard changes');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(
      nav
        .getRootState()
        .routes.some(
          (route) =>
            route.name === 'CandidateManage' &&
            (route.params as { candidateId?: string })?.candidateId === 'a',
        ),
    ).toBe(false);
  },
);
it('lets a clean editor leave without a warning', async () => {
  await click('View public profile');
  expect(host.textContent).toBe('Public profile');
});
