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
      if (attempt === PUBLIC_READ_ATTEMPTS - 1) {
        throw error;
      }
    }
  }

  throw new Error('Public read recovery ended without a response.');
}
