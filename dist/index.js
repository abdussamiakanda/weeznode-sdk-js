function cleanPath(path) {
    return path.replace(/[^a-zA-Z0-9_/.-]/g, '');
}
// ────────────────────────────────────────────────
// QueryBuilder — chainable .from().select() style
// ────────────────────────────────────────────────
export class QueryBuilder {
    tableName;
    client;
    constructor(client, table) {
        this.client = client;
        this.tableName = cleanPath(table);
    }
    async request(path, init = {}, retry = true) {
        const url = `${this.client.config.baseUrl}/api/data/${path}`;
        const headers = {
            'Content-Type': 'application/json',
            'X-API-Key': this.client.config.apiKey,
            ...(init.headers || {}),
        };
        const token = this.client.getAccessToken();
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        let requestInit = { ...init, headers };
        // Apply request interceptors
        try {
            requestInit = await this.client.interceptors.applyRequest(url, requestInit);
        }
        catch (err) {
            await this.client.interceptors.applyError(url, requestInit, err);
            throw err;
        }
        let res;
        try {
            res = await fetch(url, requestInit);
        }
        catch (err) {
            await this.client.interceptors.applyError(url, requestInit, err);
            throw err;
        }
        // Apply response interceptors
        try {
            res = await this.client.interceptors.applyResponse(url, requestInit, res);
        }
        catch (err) {
            await this.client.interceptors.applyError(url, requestInit, err);
            throw err;
        }
        // Automatic token refresh on 401
        if (res.status === 401 && retry && this.client.getRefreshToken()) {
            try {
                await this.client.refreshAccessToken();
                return this.request(path, init, false); // retry once
            }
            catch {
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
    select(columns, options) {
        const params = new URLSearchParams();
        if (columns)
            params.set('select', columns);
        if (options) {
            if (options.select)
                params.set('select', options.select);
            if (options.order)
                params.set('order', options.order);
            if (options.limit)
                params.set('limit', String(options.limit));
            if (options.offset)
                params.set('offset', String(options.offset));
            for (const [key, value] of Object.entries(options)) {
                if (['select', 'order', 'limit', 'offset'].includes(key))
                    continue;
                if (key.startsWith('_'))
                    continue;
                params.set(key, String(value));
            }
        }
        const qs = params.toString();
        return this.request(`${this.tableName}${qs ? '?' + qs : ''}`);
    }
    selectOne(columns, options) {
        return this.select(columns, { ...options, limit: 1 }).then(rows => rows[0] || null);
    }
    insert(data) {
        return this.request(this.tableName, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }
    update(id, data) {
        return this.request(`${this.tableName}/${cleanPath(id)}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }
    delete(id) {
        return this.request(`${this.tableName}/${cleanPath(id)}`, {
            method: 'DELETE',
        });
    }
    getById(id) {
        return this.request(`${this.tableName}/${cleanPath(id)}`);
    }
    // Aggregation
    aggregate(options) {
        return this.request(`${this.tableName}/_aggregate`, {
            method: 'POST',
            body: JSON.stringify(options),
        });
    }
    // Index Management
    async indexRequest(url, init = {}) {
        let requestInit = {
            ...init,
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': this.client.config.apiKey,
                ...(init.headers || {}),
            },
        };
        const token = this.client.getAccessToken();
        if (token) {
            requestInit.headers['Authorization'] = `Bearer ${token}`;
        }
        try {
            requestInit = await this.client.interceptors.applyRequest(url, requestInit);
        }
        catch (err) {
            await this.client.interceptors.applyError(url, requestInit, err);
            throw err;
        }
        let res;
        try {
            res = await fetch(url, requestInit);
        }
        catch (err) {
            await this.client.interceptors.applyError(url, requestInit, err);
            throw err;
        }
        try {
            res = await this.client.interceptors.applyResponse(url, requestInit, res);
        }
        catch (err) {
            await this.client.interceptors.applyError(url, requestInit, err);
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
    createIndex(path, type = 'btree') {
        const url = `${this.client.config.baseUrl}/api/tables/${this.tableName}/indexes`;
        return this.indexRequest(url, {
            method: 'POST',
            body: JSON.stringify({ path, type }),
        });
    }
    listIndexes() {
        const url = `${this.client.config.baseUrl}/api/tables/${this.tableName}/indexes`;
        return this.indexRequest(url);
    }
    deleteIndex(indexName) {
        const url = `${this.client.config.baseUrl}/api/tables/${this.tableName}/indexes/${cleanPath(indexName)}`;
        return this.indexRequest(url, { method: 'DELETE' });
    }
}
// ────────────────────────────────────────────────
// AuthClient
// ────────────────────────────────────────────────
export class AuthClient {
    client;
    constructor(client) {
        this.client = client;
    }
    async request(path, init = {}) {
        const url = `${this.client.config.baseUrl}/api/auth/${path}`;
        let requestInit = {
            ...init,
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': this.client.config.apiKey,
                ...(init.headers || {}),
            },
        };
        // Apply request interceptors
        try {
            requestInit = await this.client.interceptors.applyRequest(url, requestInit);
        }
        catch (err) {
            await this.client.interceptors.applyError(url, requestInit, err);
            throw err;
        }
        let res;
        try {
            res = await fetch(url, requestInit);
        }
        catch (err) {
            await this.client.interceptors.applyError(url, requestInit, err);
            throw err;
        }
        // Apply response interceptors
        try {
            res = await this.client.interceptors.applyResponse(url, requestInit, res);
        }
        catch (err) {
            await this.client.interceptors.applyError(url, requestInit, err);
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
    async signUp(email, password, displayName, role) {
        const res = await this.request('signup', {
            method: 'POST',
            body: JSON.stringify({ email, password, displayName, role }),
        });
        this.client.setSession(res.accessToken, res.refreshToken);
        return res;
    }
    /** Log in with email + password */
    async signIn(email, password) {
        const res = await this.request('login', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
        });
        this.client.setSession(res.accessToken, res.refreshToken);
        return res;
    }
    /** Refresh the access token */
    async refreshToken(refreshToken) {
        const res = await this.request('token/refresh', {
            method: 'POST',
            body: JSON.stringify({ refreshToken }),
        });
        this.client.setSession(res.accessToken, res.refreshToken);
        return res;
    }
    /** Verify a JWT access token */
    verifyToken(accessToken) {
        return this.request('token/verify', {
            method: 'POST',
            body: JSON.stringify({ accessToken }),
        });
    }
    /** Get all users (requires admin scope API key) */
    getUsers() {
        return this.request('users');
    }
    /** Delete a user (requires admin scope API key) */
    deleteUser(userId) {
        return this.request(`users/${cleanPath(userId)}`, { method: 'DELETE' });
    }
}
// ────────────────────────────────────────────────
// RulesClient
// ────────────────────────────────────────────────
export class RulesClient {
    client;
    constructor(client) {
        this.client = client;
    }
    async request(url, init = {}) {
        let requestInit = {
            ...init,
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': this.client.config.apiKey,
                ...(init.headers || {}),
            },
        };
        try {
            requestInit = await this.client.interceptors.applyRequest(url, requestInit);
        }
        catch (err) {
            await this.client.interceptors.applyError(url, requestInit, err);
            throw err;
        }
        let res;
        try {
            res = await fetch(url, requestInit);
        }
        catch (err) {
            await this.client.interceptors.applyError(url, requestInit, err);
            throw err;
        }
        try {
            res = await this.client.interceptors.applyResponse(url, requestInit, res);
        }
        catch (err) {
            await this.client.interceptors.applyError(url, requestInit, err);
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
    get() {
        const url = `${this.client.config.baseUrl}/api/rules`;
        return this.request(url, {
            headers: {
                'X-API-Key': this.client.config.apiKey,
            },
        });
    }
    update(rules) {
        const url = `${this.client.config.baseUrl}/api/rules`;
        return this.request(url, {
            method: 'POST',
            body: JSON.stringify({ rules }),
        });
    }
}
class InterceptorManager {
    requestInterceptors = [];
    responseInterceptors = [];
    errorInterceptors = [];
    addRequest(interceptor) {
        this.requestInterceptors.push(interceptor);
        return () => {
            const idx = this.requestInterceptors.indexOf(interceptor);
            if (idx !== -1)
                this.requestInterceptors.splice(idx, 1);
        };
    }
    addResponse(interceptor) {
        this.responseInterceptors.push(interceptor);
        return () => {
            const idx = this.responseInterceptors.indexOf(interceptor);
            if (idx !== -1)
                this.responseInterceptors.splice(idx, 1);
        };
    }
    addError(interceptor) {
        this.errorInterceptors.push(interceptor);
        return () => {
            const idx = this.errorInterceptors.indexOf(interceptor);
            if (idx !== -1)
                this.errorInterceptors.splice(idx, 1);
        };
    }
    async applyRequest(url, init) {
        let result = init;
        for (const interceptor of this.requestInterceptors) {
            result = await interceptor(url, result);
        }
        return result;
    }
    async applyResponse(url, init, response) {
        let result = response;
        for (const interceptor of this.responseInterceptors) {
            result = await interceptor(url, init, result);
        }
        return result;
    }
    async applyError(url, init, error) {
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
    config;
    auth;
    rules;
    interceptors;
    accessToken = null;
    refreshTokenVal = null;
    refreshing = null;
    constructor(configOrApiKey) {
        if (typeof configOrApiKey === 'string') {
            this.config = {
                baseUrl: 'https://db.weezlab.com',
                apiKey: configOrApiKey,
            };
        }
        else {
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
        }
        catch { /* noop — localStorage may be unavailable */ }
    }
    /** Set current active session tokens */
    setSession(accessToken, refreshToken) {
        this.accessToken = accessToken;
        if (refreshToken) {
            this.refreshTokenVal = refreshToken;
            try {
                localStorage.setItem(STORAGE_KEY, refreshToken);
            }
            catch { /* noop */ }
        }
    }
    /** Get active user access token */
    getAccessToken() {
        return this.accessToken;
    }
    /** Get active user refresh token */
    getRefreshToken() {
        return this.refreshTokenVal;
    }
    /** Clear session */
    signOut() {
        this.accessToken = null;
        this.refreshTokenVal = null;
        try {
            localStorage.removeItem(STORAGE_KEY);
        }
        catch { /* noop */ }
    }
    /** Internal: refresh access token automatically on 401 */
    async refreshAccessToken() {
        if (this.refreshing)
            return this.refreshing;
        this.refreshing = this.auth.refreshToken(this.refreshTokenVal || '')
            .then(res => {
            this.accessToken = res.accessToken;
            if (res.refreshToken) {
                this.refreshTokenVal = res.refreshToken;
                try {
                    localStorage.setItem(STORAGE_KEY, res.refreshToken);
                }
                catch { /* noop */ }
            }
            return res.accessToken;
        })
            .finally(() => {
            this.refreshing = null;
        });
        return this.refreshing;
    }
    /** Start a query on a collection */
    from(collection) {
        return new QueryBuilder(this, collection);
    }
    /** Firebase-style alias to query a collection */
    collection(collectionName) {
        return this.from(collectionName);
    }
}
// ────────────────────────────────────────────────
// Convenience factory
// ────────────────────────────────────────────────
export function createClient(configOrApiKey) {
    return new WeezNodeClient(configOrApiKey);
}
