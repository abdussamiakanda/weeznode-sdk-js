function cleanPath(path: string): string {
  return path.replace(/[^a-zA-Z0-9_/.-]/g, '');
}

export interface WeezNodeConfig {
  /** Base URL of the WeezNode backend */
  baseUrl?: string;
  /** Project API key */
  apiKey: string;
}

export interface QueryOptions {
  select?: string;
  order?: string;
  limit?: number;
  offset?: number;
  [filter: string]: string | number | undefined;
}

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    display_name?: string;
    role: string;
  };
  accessToken: string;
  refreshToken?: string; // optional — backend may send via HttpOnly cookie
}

export interface AuthUser {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  oauth_provider: string | null;
  created_at: string;
}

// ────────────────────────────────────────────────
// QueryBuilder — chainable .from().select() style
// ────────────────────────────────────────────────

export class QueryBuilder<T = Record<string, unknown>> {
  private tableName: string;
  private client: WeezNodeClient;

  constructor(client: WeezNodeClient, table: string) {
    this.client = client;
    this.tableName = cleanPath(table);
  }

  private async request(path: string, init: RequestInit = {}, retry = true): Promise<unknown> {
    const url = `${this.client.config.baseUrl}/api/data/${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Key': this.client.config.apiKey,
      ...(init.headers as Record<string, string> || {}),
    };

    const token = this.client.getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let requestInit: RequestInit = { ...init, headers };
    
    // Apply request interceptors
    try {
      requestInit = await this.client.interceptors.applyRequest(url, requestInit);
    } catch (err) {
      await this.client.interceptors.applyError(url, requestInit, err as Error);
      throw err;
    }

    let res: Response;
    try {
      res = await fetch(url, requestInit);
    } catch (err) {
      await this.client.interceptors.applyError(url, requestInit, err as Error);
      throw err;
    }

    // Apply response interceptors
    try {
      res = await this.client.interceptors.applyResponse(url, requestInit, res);
    } catch (err) {
      await this.client.interceptors.applyError(url, requestInit, err as Error);
      throw err;
    }

    // Automatic token refresh on 401
    if (res.status === 401 && retry && this.client.getRefreshToken()) {
      try {
        await this.client.refreshAccessToken();
        return this.request(path, init, false); // retry once
      } catch {
        // refresh failed — fall through to error handling
      }
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      const error = new Error(err.detail || err.error || `WeezNode error: ${res.status}`);
      await this.client.interceptors.applyError(url, requestInit, error);
      throw error;
    }
    return res.json();
  }

  /** Run a query or fetch documents from collection */
  select(columns?: string, options?: QueryOptions): Promise<T[]> {
    const params = new URLSearchParams();
    if (columns) params.set('select', columns);
    if (options) {
      if (options.select) params.set('select', options.select);
      if (options.order) params.set('order', options.order);
      if (options.limit) params.set('limit', String(options.limit));
      if (options.offset) params.set('offset', String(options.offset));
      for (const [key, value] of Object.entries(options)) {
        if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
        if (key.startsWith('_')) continue;
        params.set(key, String(value));
      }
    }
    const qs = params.toString();
    return this.request(`${this.tableName}${qs ? '?' + qs : ''}`) as Promise<T[]>;
  }

  selectOne(columns?: string, options?: QueryOptions): Promise<T | null> {
    return this.select(columns, { ...options, limit: 1 }).then(rows => rows[0] || null);
  }

  insert(data: Partial<T>): Promise<T> {
    return this.request(this.tableName, {
      method: 'POST',
      body: JSON.stringify(data),
    }) as Promise<T>;
  }

  update(id: string, data: Partial<T>): Promise<T> {
    return this.request(`${this.tableName}/${cleanPath(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }) as Promise<T>;
  }

  delete(id: string): Promise<{ message: string }> {
    return this.request(`${this.tableName}/${cleanPath(id)}`, {
      method: 'DELETE',
    }) as Promise<{ message: string }>;
  }

  getById(id: string): Promise<T | null> {
    return this.request(`${this.tableName}/${cleanPath(id)}`) as Promise<T | null>;
  }

  // Aggregation
  aggregate(options: {
    operation: 'count' | 'sum' | 'avg' | 'min' | 'max';
    field?: string;
    groupBy?: string;
    filter?: Record<string, string>;
  }): Promise<{ value?: number; results?: Array<{ group: string; value: number }>; count?: number }> {
    return this.request(`${this.tableName}/_aggregate`, {
      method: 'POST',
      body: JSON.stringify(options),
    }) as Promise<{ value?: number; results?: Array<{ group: string; value: number }>; count?: number }>;
  }

  // Index Management
  private async indexRequest(url: string, init: RequestInit = {}): Promise<unknown> {
    let requestInit: RequestInit = {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.client.config.apiKey,
        ...(init.headers as Record<string, string> || {}),
      },
    };

    const token = this.client.getAccessToken();
    if (token) {
      (requestInit.headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }

    try {
      requestInit = await this.client.interceptors.applyRequest(url, requestInit);
    } catch (err) {
      await this.client.interceptors.applyError(url, requestInit, err as Error);
      throw err;
    }

    let res: Response;
    try {
      res = await fetch(url, requestInit);
    } catch (err) {
      await this.client.interceptors.applyError(url, requestInit, err as Error);
      throw err;
    }

    try {
      res = await this.client.interceptors.applyResponse(url, requestInit, res);
    } catch (err) {
      await this.client.interceptors.applyError(url, requestInit, err as Error);
      throw err;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      const error = new Error(err.detail || err.error || `Index error: ${res.status}`);
      await this.client.interceptors.applyError(url, requestInit, error);
      throw error;
    }
    return res.json();
  }

  createIndex(path: string, type: 'btree' | 'gin' = 'btree'): Promise<{ message: string; indexName: string }> {
    const url = `${this.client.config.baseUrl}/api/tables/${this.tableName}/indexes`;
    return this.indexRequest(url, {
      method: 'POST',
      body: JSON.stringify({ path, type }),
    }) as Promise<{ message: string; indexName: string }>;
  }

  listIndexes(): Promise<Array<{ indexname: string; indexdef: string }>> {
    const url = `${this.client.config.baseUrl}/api/tables/${this.tableName}/indexes`;
    return this.indexRequest(url) as Promise<Array<{ indexname: string; indexdef: string }>>;
  }

  deleteIndex(indexName: string): Promise<{ message: string }> {
    const url = `${this.client.config.baseUrl}/api/tables/${this.tableName}/indexes/${cleanPath(indexName)}`;
    return this.indexRequest(url, { method: 'DELETE' }) as Promise<{ message: string }>;
  }
}

// ────────────────────────────────────────────────
// AuthClient
// ────────────────────────────────────────────────

export class AuthClient {
  private client: WeezNodeClient;

  constructor(client: WeezNodeClient) {
    this.client = client;
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const url = `${this.client.config.baseUrl}/api/auth/${path}`;
    let requestInit: RequestInit = {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.client.config.apiKey,
        ...(init.headers as Record<string, string> || {}),
      },
    };

    // Apply request interceptors
    try {
      requestInit = await this.client.interceptors.applyRequest(url, requestInit);
    } catch (err) {
      await this.client.interceptors.applyError(url, requestInit, err as Error);
      throw err;
    }

    let res: Response;
    try {
      res = await fetch(url, requestInit);
    } catch (err) {
      await this.client.interceptors.applyError(url, requestInit, err as Error);
      throw err;
    }

    // Apply response interceptors
    try {
      res = await this.client.interceptors.applyResponse(url, requestInit, res);
    } catch (err) {
      await this.client.interceptors.applyError(url, requestInit, err as Error);
      throw err;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      const error = new Error(err.detail || err.error || `WeezNode auth error: ${res.status}`);
      await this.client.interceptors.applyError(url, requestInit, error);
      throw error;
    }
    return res.json();
  }

  /** Register a new user */
  async signUp(email: string, password: string, displayName?: string, role?: string): Promise<AuthResponse> {
    const res = await this.request('signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName, role }),
    }) as AuthResponse;
    this.client.setSession(res.accessToken, res.refreshToken);
    return res;
  }

  /** Log in with email + password */
  async signIn(email: string, password: string): Promise<AuthResponse> {
    const res = await this.request('login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }) as AuthResponse;
    this.client.setSession(res.accessToken, res.refreshToken);
    return res;
  }

  /** Refresh the access token */
  async refreshToken(refreshToken: string): Promise<{ accessToken: string; refreshToken?: string }> {
    const res = await this.request('token/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }) as { accessToken: string; refreshToken?: string };
    this.client.setSession(res.accessToken, res.refreshToken);
    return res;
  }

  /** Verify a JWT access token */
  verifyToken(accessToken: string): Promise<{ valid: boolean; user?: Record<string, unknown> }> {
    return this.request('token/verify', {
      method: 'POST',
      body: JSON.stringify({ accessToken }),
    }) as Promise<{ valid: boolean; user?: Record<string, unknown> }>;
  }

  /** Get all users (requires admin scope API key) */
  getUsers(): Promise<AuthUser[]> {
    return this.request('users') as Promise<AuthUser[]>;
  }

  /** Delete a user (requires admin scope API key) */
  deleteUser(userId: string): Promise<{ message: string }> {
    return this.request(`users/${cleanPath(userId)}`, { method: 'DELETE' }) as Promise<{ message: string }>;
  }
}

// ────────────────────────────────────────────────
// RulesClient
// ────────────────────────────────────────────────

export class RulesClient {
  private client: WeezNodeClient;

  constructor(client: WeezNodeClient) {
    this.client = client;
  }

  private async request(url: string, init: RequestInit = {}): Promise<unknown> {
    let requestInit: RequestInit = {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.client.config.apiKey,
        ...(init.headers as Record<string, string> || {}),
      },
    };

    try {
      requestInit = await this.client.interceptors.applyRequest(url, requestInit);
    } catch (err) {
      await this.client.interceptors.applyError(url, requestInit, err as Error);
      throw err;
    }

    let res: Response;
    try {
      res = await fetch(url, requestInit);
    } catch (err) {
      await this.client.interceptors.applyError(url, requestInit, err as Error);
      throw err;
    }

    try {
      res = await this.client.interceptors.applyResponse(url, requestInit, res);
    } catch (err) {
      await this.client.interceptors.applyError(url, requestInit, err as Error);
      throw err;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      const error = new Error(err.detail || err.error || `Rules error: ${res.status}`);
      await this.client.interceptors.applyError(url, requestInit, error);
      throw error;
    }
    return res.json();
  }

  get(): Promise<{ rules: Record<string, any> }> {
    const url = `${this.client.config.baseUrl}/api/rules`;
    return this.request(url, {
      headers: {
        'X-API-Key': this.client.config.apiKey,
      },
    }) as Promise<{ rules: Record<string, any> }>;
  }

  update(rules: Record<string, any>): Promise<{ message: string; rules: Record<string, any> }> {
    const url = `${this.client.config.baseUrl}/api/rules`;
    return this.request(url, {
      method: 'POST',
      body: JSON.stringify({ rules }),
    }) as Promise<{ message: string; rules: Record<string, any> }>;
  }
}

// ────────────────────────────────────────────────
// Interceptor System
// ────────────────────────────────────────────────

export type RequestInterceptor = (
  url: string,
  init: RequestInit
) => RequestInit | Promise<RequestInit>;

export type ResponseInterceptor = (
  url: string,
  init: RequestInit,
  response: Response
) => Response | Promise<Response>;

export type ErrorInterceptor = (
  url: string,
  init: RequestInit,
  error: Error
) => void | Promise<void>;

class InterceptorManager {
  private requestInterceptors: RequestInterceptor[] = [];
  private responseInterceptors: ResponseInterceptor[] = [];
  private errorInterceptors: ErrorInterceptor[] = [];

  addRequest(interceptor: RequestInterceptor): () => void {
    this.requestInterceptors.push(interceptor);
    return () => {
      const idx = this.requestInterceptors.indexOf(interceptor);
      if (idx !== -1) this.requestInterceptors.splice(idx, 1);
    };
  }

  addResponse(interceptor: ResponseInterceptor): () => void {
    this.responseInterceptors.push(interceptor);
    return () => {
      const idx = this.responseInterceptors.indexOf(interceptor);
      if (idx !== -1) this.responseInterceptors.splice(idx, 1);
    };
  }

  addError(interceptor: ErrorInterceptor): () => void {
    this.errorInterceptors.push(interceptor);
    return () => {
      const idx = this.errorInterceptors.indexOf(interceptor);
      if (idx !== -1) this.errorInterceptors.splice(idx, 1);
    };
  }

  async applyRequest(url: string, init: RequestInit): Promise<RequestInit> {
    let result = init;
    for (const interceptor of this.requestInterceptors) {
      result = await interceptor(url, result);
    }
    return result;
  }

  async applyResponse(url: string, init: RequestInit, response: Response): Promise<Response> {
    let result = response;
    for (const interceptor of this.responseInterceptors) {
      result = await interceptor(url, init, result);
    }
    return result;
  }

  async applyError(url: string, init: RequestInit, error: Error): Promise<void> {
    for (const interceptor of this.errorInterceptors) {
      await interceptor(url, init, error);
    }
  }
}

// ────────────────────────────────────────────────
// Main Client
// ────────────────────────────────────────────────

const STORAGE_KEY = 'weeznode_rt';

export class WeezNodeClient {
  public config: WeezNodeConfig;
  public auth: AuthClient;
  public rules: RulesClient;
  public interceptors: InterceptorManager;
  private accessToken: string | null = null;
  private refreshTokenVal: string | null = null;
  private refreshing: Promise<string> | null = null;

  constructor(configOrApiKey: WeezNodeConfig | string) {
    if (typeof configOrApiKey === 'string') {
      this.config = {
        baseUrl: 'https://db.weezlab.com',
        apiKey: configOrApiKey,
      };
    } else {
      this.config = {
        baseUrl: configOrApiKey.baseUrl || 'https://db.weezlab.com',
        apiKey: configOrApiKey.apiKey,
      };
    }
    this.auth = new AuthClient(this);
    this.rules = new RulesClient(this);
    this.interceptors = new InterceptorManager();
    // Restore refresh token from localStorage if available
    try {
      this.refreshTokenVal = localStorage.getItem(STORAGE_KEY);
    } catch { /* noop — localStorage may be unavailable */ }
  }

  /** Set current active session tokens */
  setSession(accessToken: string, refreshToken?: string) {
    this.accessToken = accessToken;
    if (refreshToken) {
      this.refreshTokenVal = refreshToken;
      try {
        localStorage.setItem(STORAGE_KEY, refreshToken);
      } catch { /* noop */ }
    }
  }

  /** Get active user access token */
  getAccessToken(): string | null {
    return this.accessToken;
  }

  /** Get active user refresh token */
  getRefreshToken(): string | null {
    return this.refreshTokenVal;
  }

  /** Clear session */
  signOut() {
    this.accessToken = null;
    this.refreshTokenVal = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch { /* noop */ }
  }

  /** Internal: refresh access token automatically on 401 */
  async refreshAccessToken(): Promise<string> {
    if (this.refreshing) return this.refreshing;

    this.refreshing = this.auth.refreshToken(this.refreshTokenVal || '')
      .then(res => {
        this.accessToken = res.accessToken;
        if (res.refreshToken) {
          this.refreshTokenVal = res.refreshToken;
          try { localStorage.setItem(STORAGE_KEY, res.refreshToken); } catch { /* noop */ }
        }
        return res.accessToken;
      })
      .finally(() => {
        this.refreshing = null;
      });

    return this.refreshing;
  }

  /** Start a query on a collection */
  from<T = Record<string, unknown>>(collection: string): QueryBuilder<T> {
    return new QueryBuilder<T>(this, collection);
  }

  /** Firebase-style alias to query a collection */
  collection<T = Record<string, unknown>>(collectionName: string): QueryBuilder<T> {
    return this.from<T>(collectionName);
  }
}

// ────────────────────────────────────────────────
// Convenience factory
// ────────────────────────────────────────────────

export function createClient(configOrApiKey: WeezNodeConfig | string): WeezNodeClient {
  return new WeezNodeClient(configOrApiKey);
}
