// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../../data/api';
import type { reportCandidateStatement, CandidateStatement } from '../../../data/candidateClaims';
import { CandidateReportDialog } from '../CandidateReportDialog';
import { CandidateClaimPanel } from '../CandidateClaimPanel';
import type { CandidateProfileRecord } from '../types';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
vi.mock('../../../providers/AuthProvider', () => ({
  useAuth: () => ({ isLoading: false, isSignedIn: false }),
}));
vi.mock('../../../hooks/useAdminAccess', () => ({ useAdminAccess: () => ({ state: 'denied' }) }));
vi.mock('../../../hooks/useResponsive', () => ({ useResponsive: () => ({ isMobile: false }) }));
vi.mock('react-native-svg', () => ({
  default: ({ children, ...props }: React.PropsWithChildren) => <svg {...props}>{children}</svg>,
  Path: (props: React.SVGProps<SVGPathElement>) => <path {...props} />,
  Circle: (props: React.SVGProps<SVGCircleElement>) => <circle {...props} />,
}));
const statement = {
  body: 'Original statement\n\nSecond paragraph',
  updated_at: '2026-10-01T15:00:00+00:00',
  published_at: '2026-10-01T15:00:00+00:00',
  edited_at: null,
  version: 3,
};
let host: HTMLDivElement;
let trigger: HTMLButtonElement;
let root: Root;
let report: ReturnType<typeof vi.fn<typeof reportCandidateStatement>>;
let reload: ReturnType<typeof vi.fn<(signal: AbortSignal) => Promise<CandidateStatement | null>>>;
let close: ReturnType<typeof vi.fn<() => void>>;
async function mount() {
  await act(async () =>
    root.render(
      <CandidateReportDialog
        candidateId="candidate-a"
        statement={statement}
        report={report}
        onReload={reload}
        onClose={close}
      />,
    ),
  );
}
async function click(label: string) {
  const element = [...document.querySelectorAll<HTMLElement>('button, [role="button"]')].find(
    (node) => node.textContent === label || node.getAttribute('aria-label') === label,
  );
  expect(element, label).toBeTruthy();
  await act(async () => element!.click());
}
async function input(value: string) {
  const field = document.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      field,
      value,
    );
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
beforeEach(() => {
  host = document.createElement('div');
  trigger = document.createElement('button');
  trigger.textContent = 'Report this statement';
  document.body.append(host, trigger);
  trigger.focus();
  root = createRoot(host);
  report = vi.fn().mockResolvedValue({ received: true });
  reload = vi.fn();
  close = vi.fn(() => root.render(null));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  trigger.remove();
  vi.useRealTimers();
});

it('validates blank and oversized input on submit without losing text, then sends the displayed version', async () => {
  await mount();
  expect(document.activeElement).toBe(document.querySelector('textarea'));
  await click('Submit report');
  expect(document.body.textContent).toContain('Enter a reason');
  expect(report).not.toHaveBeenCalled();
  await input('x'.repeat(2001));
  await click('Submit report');
  expect(document.querySelector('textarea')!.value).toHaveLength(2001);
  expect(document.body.textContent).toContain('Shorten your reason to 2000 characters or fewer');
  await input('Please review this');
  await click('Submit report');
  expect(report).toHaveBeenCalledWith(
    'candidate-a',
    'Please review this',
    3,
    expect.any(AbortSignal),
  );
  expect(document.body.textContent?.match(/Report received/g)).toHaveLength(1);
});
it('traps keyboard focus and returns it when closed', async () => {
  await mount();
  const closeButton = document.querySelector<HTMLButtonElement>('[aria-label="Close"]')!;
  closeButton.focus();
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    ),
  );
  expect(document.activeElement?.textContent).toBe('Submit report');
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  expect(close).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(trigger);
  expect(host.inert).not.toBe(true);
});
it('keeps the submit label and size during a pending request, suppresses duplicates, and aborts on close', async () => {
  report.mockImplementation(() => new Promise(() => {}));
  await mount();
  await input('Reason');
  await click('Submit report');
  const submit = [...document.querySelectorAll<HTMLElement>('[role="button"]')].find(
    (node) => node.textContent === 'Submit report',
  )!;
  expect(submit.style.width).toBe('190px');
  expect(submit.getAttribute('aria-busy')).toBe('true');
  await click('Submit report');
  expect(report).toHaveBeenCalledOnce();
  const signal = report.mock.calls[0][3] as AbortSignal;
  await click('Close');
  expect(signal.aborted).toBe(true);
});
it('uses the server wait, retains the reason, and brings submit back automatically', async () => {
  vi.useFakeTimers();
  report.mockRejectedValue(new ApiError(429, 'limited', null, 4));
  await mount();
  await input('Keep this reason');
  await click('Submit report');
  expect(document.body.textContent).toContain('Please wait before reporting again');
  expect(document.body.textContent).not.toContain('Submit report');
  await act(async () => vi.advanceTimersByTime(3999));
  expect(document.body.textContent).not.toContain('Submit report');
  await act(async () => vi.advanceTimersByTime(1));
  expect(document.body.textContent).toContain('Submit report');
  expect(document.querySelector('textarea')!.value).toBe('Keep this reason');
});
it('reloads and displays a changed statement before sending its new version, keeping the reason', async () => {
  report.mockRejectedValueOnce(new ApiError(409, 'changed')).mockResolvedValue({ received: true });
  reload.mockResolvedValue({
    ...statement,
    body: 'New statement',
    version: 4,
    edited_at: '2026-10-03T15:00:00+00:00',
  });
  await mount();
  await input('Saved reason');
  await click('Submit report');
  expect(document.body.textContent).toContain(
    'The campaign statement changed. Review the updated statement before submitting your report.',
  );
  expect(document.body.textContent).not.toContain('Submit report');
  await click('Reload statement');
  await act(
    async () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())),
  );
  const panel = document.querySelector<HTMLElement>('section[aria-labelledby]')!;
  expect(document.activeElement).toBe(panel);
  expect(panel.textContent).toContain('Updated statement');
  expect(panel.textContent).toContain('Edited October 3, 2026');
  expect(panel.textContent).toContain('New statement');
  expect(panel.compareDocumentPosition(document.querySelector('textarea')!)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
  expect(
    document.querySelector('[aria-label="Updated campaign statement"]')?.getAttribute('tabindex'),
  ).toBe('0');
  expect(document.querySelector('textarea')!.value).toBe('Saved reason');
  // Reloading never submits; Submit report needs its own press.
  expect(report).toHaveBeenCalledTimes(1);
  await click('Submit report');
  expect(report.mock.calls[1][2]).toBe(4);
});
it('keeps reload available after failure and prevents reports after removal', async () => {
  report.mockRejectedValue(new ApiError(409, 'changed'));
  reload.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(null);
  await mount();
  await input('Saved reason');
  await click('Submit report');
  await click('Reload statement');
  expect(document.body.textContent).toContain('We couldn’t load the campaign statement');
  expect(report).toHaveBeenCalledTimes(1);
  await click('Reload statement');
  expect(document.body.textContent).toContain('The campaign statement is no longer available');
  expect(document.body.textContent).not.toContain('Submit report');
});
it('retains the reason after submission failure and retries explicitly', async () => {
  report.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ received: true });
  await mount();
  await input('Saved reason');
  await click('Submit report');
  expect(document.body.textContent).toContain('We couldn’t submit your report');
  expect(document.querySelector('textarea')!.value).toBe('Saved reason');
  await click('Try again');
  expect(report).toHaveBeenCalledTimes(2);
});

it('keeps campaign text and reporting together and isolates preview account services', async () => {
  const record = {
    candidate: { id: 'candidate-a', name: 'Candidate name' },
  } as CandidateProfileRecord;
  const services = {
    getStatement: vi.fn().mockResolvedValue({ statement }),
    getClaims: vi.fn(),
    reportStatement: report,
  };
  await act(async () =>
    root.render(
      <CandidateClaimPanel
        record={record}
        services={services}
        previewAccount="public"
        onClaim={vi.fn()}
        onManage={vi.fn()}
        onAdmin={vi.fn()}
      />,
    ),
  );
  expect(services.getClaims).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Published October 1, 2026');
  expect(host.textContent).not.toContain('Candidate name · Campaign');
  expect(host.textContent).toContain(statement.body);
  expect(host.textContent).toContain(
    'Alethical reviews requests from candidates and authorized campaign representatives.',
  );
  expect(host.textContent).toContain('Report this statement');
  expect(host.textContent).toContain(
    'Alethical verified this account’s authority to represent the campaign, not the statement’s accuracy',
  );
});
it('renders approved, pending, loading and error account actions without live requests', async () => {
  const record = {
    candidate: { id: 'candidate-a', name: 'Candidate name' },
  } as CandidateProfileRecord;
  const services = {
    getStatement: vi.fn().mockResolvedValue({ statement: null }),
    getClaims: vi.fn(),
    reportStatement: report,
  };
  for (const [state, label] of [
    ['approved', 'Manage this profile'],
    ['pending', 'View profile claim status'],
    ['loading', 'Loading profile claim status…'],
    ['error', 'We couldn’t load your profile claim status'],
  ] as const) {
    await act(async () =>
      root.render(
        <CandidateClaimPanel
          record={record}
          services={services}
          previewAccount={state}
          onClaim={vi.fn()}
          onManage={vi.fn()}
          onAdmin={vi.fn()}
        />,
      ),
    );
    expect(host.textContent).toContain(label);
    expect(host.textContent).not.toContain(
      'For candidates and authorized campaign representatives',
    );
  }
  expect(services.getClaims).not.toHaveBeenCalled();
});
