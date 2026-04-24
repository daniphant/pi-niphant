// These are lightweight local shims for test/typecheck ergonomics when Pi runtime
// packages are not installed in this repo. They intentionally model only the small
// subset of the API used by pi-hud and may drift from the real Pi types over time.

declare module "@mariozechner/pi-ai" {
  export type AssistantMessage = {
    usage?: {
      input?: number;
      output?: number;
      cost?: { total?: number };
    };
  };
}

declare module "@mariozechner/pi-coding-agent" {
  export type ExtensionContext = {
    model?: {
      provider?: string;
      id?: string;
      name?: string;
      contextWindow?: number;
    };
    cwd: string;
    hasUI: boolean;
    getContextUsage: () => { percent?: number } | null | undefined;
    sessionManager: {
      getBranch: () => Array<{ type: string; message: { role: string } }>;
    };
    modelRegistry: {
      getApiKeyAndHeaders: (model: unknown) => Promise<{ ok: boolean; apiKey?: string; error?: string }>;
    };
    ui: {
      setFooter: (footer?: ((
        tui: { requestRender: () => void },
        theme: { fg: (color: string, text: string) => string },
        footerData: { getGitBranch: () => string | null; onBranchChange: (listener: () => void) => () => void },
      ) => { dispose(): void; invalidate(): void; render(width: number): string[] }) | undefined) => void;
      notify: (message: string, level: string) => void;
    };
  };

  export type ExtensionAPI = {
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => void | Promise<void>) => void;
    registerCommand: (name: string, config: {
      description?: string;
      getArgumentCompletions?: (prefix: string) => Array<{ value: string; label: string }> | null;
      handler: (args: string, ctx: ExtensionContext) => void | Promise<void>;
    }) => void;
    getThinkingLevel: () => string;
  };
}

declare module "@mariozechner/pi-tui" {
  export function truncateToWidth(text: string, width: number): string;
  export function visibleWidth(text: string): number;
}
