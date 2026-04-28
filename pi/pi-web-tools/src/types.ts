export type WebOpenFormat = "markdown" | "text" | "html";
export interface WebOpenParams { url: string; format?: WebOpenFormat; timeout?: number }
export interface FetchMetadata { url: string; status: number; statusText: string; headers: Record<string,string>; contentType: string; finalUrl: string; redirects: string[]; allowlistActive: boolean }
export interface FetchResult { metadata: FetchMetadata; body: Buffer }
export interface WebSearchParams { query: string; count?: number }
