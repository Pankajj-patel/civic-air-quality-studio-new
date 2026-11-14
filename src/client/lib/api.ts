const TOKEN_STORAGE_KEY = 'civic_aqi_session_token';
const ACTIVE_ORG_STORAGE_KEY = 'civic_aqi_active_org_id';

export function getStoredToken(): string | null {
  try {
    return window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage restriction errors
  }
}

export function getStoredActiveOrgId(): number | null {
  try {
    const raw = window.sessionStorage.getItem(ACTIVE_ORG_STORAGE_KEY);
    const num = Number(raw);
    return Number.isInteger(num) && num > 0 ? num : null;
  } catch {
    return null;
  }
}

export function setStoredActiveOrgId(orgId: number | null): void {
  try {
    if (orgId) {
      window.sessionStorage.setItem(ACTIVE_ORG_STORAGE_KEY, String(orgId));
    } else {
      window.sessionStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
    }
  } catch {
    // Ignore storage restriction errors
  }
}

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { organizationId?: number | null } = {},
): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers);

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const orgId = options.organizationId ?? getStoredActiveOrgId();
  if (orgId) {
    headers.set('X-Organization-Id', String(orgId));
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : null;

  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      data?.error?.code || 'REQUEST_FAILED',
      data?.error?.message || `Request failed with status ${response.status}`,
      data?.error?.details,
    );
  }

  return data as T;
}
