export class WebToolError extends Error { constructor(message: string, public code = "WEB_TOOL_ERROR") { super(message); } }
export class ConfigError extends WebToolError { constructor(message: string) { super(message, "CONFIG_ERROR"); } }
export class NetworkSafetyError extends WebToolError { constructor(message: string) { super(message, "NETWORK_SAFETY_ERROR"); } }
export class FetchError extends WebToolError { constructor(message: string) { super(message, "FETCH_ERROR"); } }
