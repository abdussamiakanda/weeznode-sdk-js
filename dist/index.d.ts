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
    refreshToken?: string;
}
export interface AuthUser {
    id: string;
    email: string;
    display_name: string | null;
    role: string;
    oauth_provider: string | null;
    created_at: string;
}
export declare class QueryBuilder<T = Record<string, unknown>> {
    private tableName;
    private client;
    constructor(client: WeezNodeClient, table: string);
    private request;
    /** Run a query or fetch documents from collection */
    select(columns?: string, options?: QueryOptions): Promise<T[]>;
    selectOne(columns?: string, options?: QueryOptions): Promise<T | null>;
    insert(data: Partial<T>): Promise<T>;
    update(id: string, data: Partial<T>): Promise<T>;
    delete(id: string): Promise<{
        message: string;
    }>;
    getById(id: string): Promise<T | null>;
    aggregate(options: {
        operation: 'count' | 'sum' | 'avg' | 'min' | 'max';
        field?: string;
        groupBy?: string;
        filter?: Record<string, string>;
    }): Promise<{
        value?: number;
        results?: Array<{
            group: string;
            value: number;
        }>;
        count?: number;
    }>;
    private indexRequest;
    createIndex(path: string, type?: 'btree' | 'gin'): Promise<{
        message: string;
        indexName: string;
    }>;
    listIndexes(): Promise<Array<{
        indexname: string;
        indexdef: string;
    }>>;
    deleteIndex(indexName: string): Promise<{
        message: string;
    }>;
}
export declare class AuthClient {
    private client;
    constructor(client: WeezNodeClient);
    private request;
    /** Register a new user */
    signUp(email: string, password: string, displayName?: string, role?: string): Promise<AuthResponse>;
    /** Log in with email + password */
    signIn(email: string, password: string): Promise<AuthResponse>;
    /** Refresh the access token */
    refreshToken(refreshToken: string): Promise<{
        accessToken: string;
        refreshToken?: string;
    }>;
    /** Verify a JWT access token */
    verifyToken(accessToken: string): Promise<{
        valid: boolean;
        user?: Record<string, unknown>;
    }>;
    /** Get all users (requires admin scope API key) */
    getUsers(): Promise<AuthUser[]>;
    /** Delete a user (requires admin scope API key) */
    deleteUser(userId: string): Promise<{
        message: string;
    }>;
}
export declare class RulesClient {
    private client;
    constructor(client: WeezNodeClient);
    private request;
    get(): Promise<{
        rules: Record<string, any>;
    }>;
    update(rules: Record<string, any>): Promise<{
        message: string;
        rules: Record<string, any>;
    }>;
}
export type RequestInterceptor = (url: string, init: RequestInit) => RequestInit | Promise<RequestInit>;
export type ResponseInterceptor = (url: string, init: RequestInit, response: Response) => Response | Promise<Response>;
export type ErrorInterceptor = (url: string, init: RequestInit, error: Error) => void | Promise<void>;
declare class InterceptorManager {
    private requestInterceptors;
    private responseInterceptors;
    private errorInterceptors;
    addRequest(interceptor: RequestInterceptor): () => void;
    addResponse(interceptor: ResponseInterceptor): () => void;
    addError(interceptor: ErrorInterceptor): () => void;
    applyRequest(url: string, init: RequestInit): Promise<RequestInit>;
    applyResponse(url: string, init: RequestInit, response: Response): Promise<Response>;
    applyError(url: string, init: RequestInit, error: Error): Promise<void>;
}
export declare class WeezNodeClient {
    config: WeezNodeConfig;
    auth: AuthClient;
    rules: RulesClient;
    interceptors: InterceptorManager;
    private accessToken;
    private refreshTokenVal;
    private refreshing;
    constructor(configOrApiKey: WeezNodeConfig | string);
    /** Set current active session tokens */
    setSession(accessToken: string, refreshToken?: string): void;
    /** Get active user access token */
    getAccessToken(): string | null;
    /** Get active user refresh token */
    getRefreshToken(): string | null;
    /** Clear session */
    signOut(): void;
    /** Internal: refresh access token automatically on 401 */
    refreshAccessToken(): Promise<string>;
    /** Start a query on a collection */
    from<T = Record<string, unknown>>(collection: string): QueryBuilder<T>;
    /** Firebase-style alias to query a collection */
    collection<T = Record<string, unknown>>(collectionName: string): QueryBuilder<T>;
}
export declare function createClient(configOrApiKey: WeezNodeConfig | string): WeezNodeClient;
export {};
