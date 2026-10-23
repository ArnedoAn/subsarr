export const API_URL = typeof window !== 'undefined' ? '/api' : (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001');

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

function delay(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function request(path: string, options: RequestInit): Promise<Response> {
  const get = options.method === 'GET';
  for (let attempt = 0; ; attempt++) {
    options.signal?.throwIfAborted();
    let response: Response;
    try {
      response = await fetch(`${API_URL}${path}`, options);
    } catch (error) {
      if (!get || attempt >= 2 || options.signal?.aborted || !(error instanceof TypeError)) throw error;
      await delay(500 * 2 ** attempt, options.signal);
      continue;
    }
    if (get && attempt < 2 && [429, 502, 503, 504].includes(response.status)) {
      await response.body?.cancel();
      await delay(500 * 2 ** attempt, options.signal);
      continue;
    }
    if (!response.ok) {
      const text = await response.text();
      const statusMessages: Record<number, string> = { 404: 'Not found', 409: 'Request conflicts with the current state', 403: 'Access denied' };
      let message = text || statusMessages[response.status] || `Request failed (${response.status})`;
      let code: string | undefined;
      try {
        const body = JSON.parse(text);
        if (Array.isArray(body.message)) message = body.message.join(', ');
        else if (typeof body.message === 'string') message = body.message;
        if (typeof body.code === 'string') code = body.code;
      } catch { /* Response may be plain text. */ }
      throw new ApiError(message, response.status, code);
    }
    return response;
  }
}

async function json<T>(path: string, options: RequestInit): Promise<T> {
  const response = await request(path, options);
  if (response.status === 204 || response.status === 205) return undefined as T;
  const text = await response.text();
  return text ? JSON.parse(text) as T : undefined as T;
}

function bodyOptions(body: unknown, options: RequestInit): RequestInit {
  const headers = new Headers(options.headers);
  const raw = body instanceof FormData || body instanceof Blob || body instanceof URLSearchParams || body instanceof ArrayBuffer || ArrayBuffer.isView(body) || typeof body === 'string';
  if (body instanceof FormData) headers.delete('Content-Type');
  else if (body !== undefined && !raw && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return { ...options, headers, body: body === undefined ? undefined : raw ? body as BodyInit : JSON.stringify(body) };
}

export function apiGet<T>(path: string, options: RequestInit = {}): Promise<T> {
  return json<T>(path, { cache: 'no-store', ...options, method: 'GET' });
}
export function apiPost<T>(path: string, body?: unknown, options: RequestInit = {}): Promise<T> {
  return json<T>(path, { cache: 'no-store', ...bodyOptions(body, options), method: 'POST' });
}
export function apiPut<T>(path: string, body: unknown, options: RequestInit = {}): Promise<T> {
  return json<T>(path, { cache: 'no-store', ...bodyOptions(body, options), method: 'PUT' });
}
export function apiDelete<T>(path: string, options: RequestInit = {}): Promise<T> {
  return json<T>(path, { cache: 'no-store', ...options, method: 'DELETE' });
}
export async function apiDownload(path: string, options: RequestInit = {}): Promise<Blob> {
  return (await request(path, { cache: 'no-store', ...options, method: 'GET' })).blob();
}
export function apiPatch<T>(path: string, body?: unknown, options: RequestInit = {}): Promise<T> {
  return json<T>(path, { cache: 'no-store', ...bodyOptions(body, options), method: 'PATCH' });
}
