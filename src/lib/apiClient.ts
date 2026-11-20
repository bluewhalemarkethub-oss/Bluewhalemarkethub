let cachedCsrfToken: string | null = null;

export async function ensureCsrfToken(): Promise<string> {
  if (cachedCsrfToken) return cachedCsrfToken;
  const res = await fetch('/api/security/csrf', { credentials: 'include' });
  const data = (await res.json()) as { csrfToken: string };
  cachedCsrfToken = data.csrfToken;
  return cachedCsrfToken;
}

export async function apiRequest<T>(
  url: string,
  options: {
    method?: 'GET' | 'POST' | 'DELETE';
    body?: unknown;
    jwtToken?: string | null;
  } = {},
): Promise<T> {
  const method = options.method || 'GET';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (options.jwtToken) {
    headers.Authorization = `Bearer ${options.jwtToken}`;
  }

  if (method !== 'GET') {
    headers['X-CSRF-Token'] = await ensureCsrfToken();
  }

  const res = await fetch(url, {
    method,
    headers,
    credentials: 'include',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 202) {
    const errMsg =
      typeof payload?.error === 'string'
        ? payload.error
        : typeof payload?.reason === 'string'
          ? payload.reason
          : `Request failed (${res.status})`;
    throw new Error(errMsg);
  }

  return payload as T;
}
