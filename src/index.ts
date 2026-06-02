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
  refreshToken: string;
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

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
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

    const res = await fetch(url, {
      ...init,
      headers,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.detail || err.error || `WeezNode error: ${res.status}`);
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

  // Index Management
  createIndex(path: string, type: 'btree' | 'gin' = 'btree'): Promise<{ message: string; indexName: string }> {
    const url = `${this.client.config.baseUrl}/api/tables/${this.tableName}/indexes`;
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.client.config.apiKey,
      },
      body: JSON.stringify({ path, type }),
    }).then(async res => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.detail || err.error || `Index creation error: ${res.status}`);
      }
      return res.json();
    });
  }

  listIndexes(): Promise<Array<{ indexname: string; indexdef: string }>> {
    const url = `${this.client.config.baseUrl}/api/tables/${this.tableName}/indexes`;
    return fetch(url, {
      headers: {
        'X-API-Key': this.client.config.apiKey,
      },
    }).then(async res => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.detail || err.error || `Index listing error: ${res.status}`);
      }
      return res.json();
    });
  }

  deleteIndex(indexName: string): Promise<{ message: string }> {
    const url = `${this.client.config.baseUrl}/api/tables/${this.tableName}/indexes/${cleanPath(indexName)}`;
    return fetch(url, {
      method: 'DELETE',
      headers: {
        'X-API-Key': this.client.config.apiKey,
      },
    }).then(async res => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.detail || err.error || `Index deletion error: ${res.status}`);
      }
      return res.json();
    });
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
    const res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.client.config.apiKey,
        ...(init.headers as Record<string, string> || {}),
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.detail || err.error || `WeezNode auth error: ${res.status}`);
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
  async refreshToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const res = await this.request('token/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }) as { accessToken: string; refreshToken: string };
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

  get(): Promise<{ rules: Record<string, any> }> {
    const url = `${this.client.config.baseUrl}/api/rules`;
    return fetch(url, {
      headers: {
        'X-API-Key': this.client.config.apiKey,
      },
    }).then(async res => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.detail || err.error || `Rules error: ${res.status}`);
      }
      return res.json();
    });
  }

  update(rules: Record<string, any>): Promise<{ message: string; rules: Record<string, any> }> {
    const url = `${this.client.config.baseUrl}/api/rules`;
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.client.config.apiKey,
      },
      body: JSON.stringify({ rules }),
    }).then(async res => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.detail || err.error || `Rules error: ${res.status}`);
      }
      return res.json();
    });
  }
}

// ────────────────────────────────────────────────
// Main Client
// ────────────────────────────────────────────────

export class WeezNodeClient {
  public config: WeezNodeConfig;
  public auth: AuthClient;
  public rules: RulesClient;
  private accessToken: string | null = null;
  private refreshTokenVal: string | null = null;

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
  }

  /** Set current active session tokens */
  setSession(accessToken: string, refreshToken: string) {
    this.accessToken = accessToken;
    this.refreshTokenVal = refreshToken;
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
