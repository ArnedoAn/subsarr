const API_URL = typeof window !== 'undefined' 
  ? '/api' 
  : (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001');

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, options: RequestInit, retries = MAX_RETRIES): Promise<Response> {
  try {
    const response = await fetch(url, options);
    return response;
  } catch (error) {
    if (retries > 0 && (error as Error).message?.includes('ECONNREFUSED')) {
      console.log(`API connection failed, retrying in ${RETRY_DELAY_MS}ms... (${retries} retries left)`);
      await sleep(RETRY_DELAY_MS);
      return fetchWithRetry(url, options, retries - 1);
    }
    throw error;
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetchWithRetry(`${API_URL}${path}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetchWithRetry(`${API_URL}${path}`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const response = await fetchWithRetry(`${API_URL}${path}`, {
    method: 'PUT',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export { API_URL };
