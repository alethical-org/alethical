const PUBLIC_READ_ATTEMPT_TIMEOUT_MS = 5_000;
const PUBLIC_READ_ATTEMPTS = 2;

export class PublicReadTimeoutError extends Error {
  constructor() {
    super('The public data request took too long.');
    this.name = 'PublicReadTimeoutError';
  }
}

async function fetchAttempt(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  // The attempt's own timeout owns the signal handed to fetch, so a caller's
  // signal has to be forwarded onto it or it would be thrown away by the spread
  // below and cancel nothing.
  const caller = init?.signal ?? undefined;
  let stopWatchingCaller: (() => void) | undefined;
  if (caller) {
    if (caller.aborted) {
      controller.abort(caller.reason);
    } else {
      const forward = () => controller.abort(caller.reason);
      caller.addEventListener('abort', forward, { once: true });
      stopWatchingCaller = () => caller.removeEventListener('abort', forward);
    }
  }

  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new PublicReadTimeoutError());
    }, PUBLIC_READ_ATTEMPT_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      fetch(input, {
        ...init,
        signal: controller.signal,
      }),
      timedOut,
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    stopWatchingCaller?.();
  }
}

/**
 * Public GETs get 1 immediate second chance for transport or server trouble.
 * A valid 4xx answer is final: retrying it would hide an honest missing record.
 */
export async function publicReadResponse(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  for (let attempt = 0; attempt < PUBLIC_READ_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchAttempt(input, init);
      if (response.status >= 500 && response.status <= 599 && attempt === 0) {
        continue;
      }
      return response;
    } catch (error) {
      // A caller who has given up is not asking for a second chance. Retrying
      // here would send the request the reader has already moved on from.
      if (init?.signal?.aborted || attempt === PUBLIC_READ_ATTEMPTS - 1) {
        throw error;
      }
    }
  }

  throw new Error('Public read recovery ended without a response.');
}
