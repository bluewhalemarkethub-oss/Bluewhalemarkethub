let cachedCsrfToken: string | null = null;

export class ApiUnavailableError extends Error {
  constructor(message = 'Backend API endpoint is unavailable in this environment.') {
    super(message);
    this.name = 'ApiUnavailableError';
  }
}

export class ApiRequestError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(message: string, status: number, payload: Record<string, unknown>) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.payload = payload;
  }
}

function isJsonResponse(res: Response): boolean {
  const ct = res.headers.get('content-type') || '';
  return ct.toLowerCase().includes('application/json');
}

export async function ensureCsrfToken(forceRefresh = false): Promise<string> {
  if (cachedCsrfToken && !forceRefresh) return cachedCsrfToken;
  const res = await fetch('/api/security/csrf', {
    credentials: 'include',
    cache: 'no-store',
  });
  if (res.status === 404 || res.status === 405 || !isJsonResponse(res)) {
    throw new ApiUnavailableError('Security token endpoint unavailable.');
  }
  const data = (await res.json().catch(() => ({}))) as { csrfToken?: string };
  if (!res.ok || !data.csrfToken) {
    throw new Error('Unable to initialize security session token.');
  }
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

  const send = async (forceFreshCsrf: boolean): Promise<Response> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    };

    if (options.jwtToken && options.jwtToken !== 'cookie-session') {
      headers.Authorization = `Bearer ${options.jwtToken}`;
    }

    if (method !== 'GET') {
      headers['X-CSRF-Token'] = await ensureCsrfToken(forceFreshCsrf);
    }

    return fetch(url, {
      method,
      headers,
      credentials: 'include',
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  };

  let res = await send(false);
  if (res.status === 404 || res.status === 405 || (!res.ok && !isJsonResponse(res))) {
    if (!isJsonResponse(res)) {
      throw new ApiUnavailableError(`Endpoint unavailable (${res.status}).`);
    }
  }
  if (res.ok && !isJsonResponse(res)) {
    throw new ApiUnavailableError('Received non-JSON response from API endpoint.');
  }

  let payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (
    res.status === 403 &&
    method !== 'GET' &&
    (payload?.code === 'CSRF_ERROR' || typeof payload?.error !== 'string')
  ) {
    cachedCsrfToken = null;
    res = await send(true);
    payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  }

  if (!res.ok && res.status !== 202) {
    const errMsg =
      typeof payload?.error === 'string'
        ? payload.error
        : typeof payload?.reason === 'string'
          ? payload.reason
          : `Request failed (${res.status})`;
    throw new ApiRequestError(errMsg, res.status, payload);
  }

  return payload as T;
}

export async function uploadReceiptFile(
  file: Blob,
  fileName: string,
  mimeType: string,
  options: { jwtToken?: string | null; clientUid?: string } = {},
): Promise<{
  receiptUrl: string;
  receiptFileName: string;
  mimeType: string;
  sizeBytes: number;
}> {
  const send = async (forceFreshCsrf: boolean): Promise<Response> => {
    const csrfToken = await ensureCsrfToken(forceFreshCsrf);
    const headers: Record<string, string> = {
      'Content-Type': mimeType,
      'X-File-Name': encodeURIComponent(fileName),
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRF-Token': csrfToken,
    };
    if (options.jwtToken && options.jwtToken !== 'cookie-session') {
      headers.Authorization = `Bearer ${options.jwtToken}`;
    }
    if (options.clientUid) {
      headers['X-Client-Uid'] = options.clientUid;
    }
    return fetch('/api/uploads/receipt', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: file,
    });
  };

  let res = await send(false);
  if (res.status === 404 || res.status === 405 || !isJsonResponse(res)) {
    throw new ApiUnavailableError(`Upload endpoint unavailable (${res.status}).`);
  }

  let payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (res.status === 403 && (payload?.code === 'CSRF_ERROR' || typeof payload?.error !== 'string')) {
    cachedCsrfToken = null;
    res = await send(true);
    payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  }

  if (!res.ok) {
    const errMsg =
      typeof payload?.error === 'string' ? payload.error : `Receipt upload failed (${res.status})`;
    throw new Error(errMsg);
  }

  return payload as {
    receiptUrl: string;
    receiptFileName: string;
    mimeType: string;
    sizeBytes: number;
  };
}
