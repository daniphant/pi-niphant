export type DelegatedPhase = "Queued" | "Planning" | "Exploring" | "Reading" | "Steering" | "Summarizing" | "Complete" | "Failed";
export type DelegatedState = "queued" | "running" | "complete" | "failed";
export type DelegatedMode = "parallel" | "sequential";

export interface DelegatedAgentDefinition {
  name: string;
  displayName: string;
  shortLabel: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  model?: string;
  outputSchema?: "repo-summary" | "plan-review" | "ownership-review";
}

export interface DelegatedAgentTask {
  agent: string;
  task: string;
  model?: string;
}

export interface DelegatedAgentResult {
  agent: string;
  displayName: string;
  success: boolean;
  summary: string;
  keyFindings: string[];
  risks: string[];
  recommendedNextSteps: string[];
  keyFiles: string[];
  rawOutput?: string;
  error?: string;
}

export interface DelegatedRunResult {
  runId: string;
  success: boolean;
  mode: DelegatedMode;
  results: DelegatedAgentResult[];
  synthesizedSummary?: string;
}

export interface ChildStatus {
  id: string;
  runId: string;
  index: number;
  agent: string;
  displayName: string;
  shortLabel: string;
  task: string;
  cwd: string;
  state: DelegatedState;
  phase: DelegatedPhase;
  startedAt?: number;
  updatedAt?: number;
  outputLogPath: string;
  resultPath: string;
  controlPath?: string;
  pid?: number;
  summary?: string;
  exitCode?: number;
  error?: string;
}

export interface RunStatus {
  runId: string;
  cwd: string;
  sessionId?: string;
  mode: DelegatedMode;
  state: DelegatedState;
  startedAt?: number;
  updatedAt?: number;
  blocking: boolean;
  synthesize: boolean;
  children: ChildStatus[];
}

export interface DelegatedControlCommand {
  type: "steer";
  message: string;
  requestedAt?: number;
  source?: string;
}

export interface RunnerConfig {
  runId: string;
  cwd: string;
  sessionId?: string;
  child: {
    id: string;
    index: number;
    task: string;
    model?: string;
    definition: DelegatedAgentDefinition;
    statusPath: string;
    resultPath: string;
    outputLogPath: string;
    controlPath: string;
  };
}
