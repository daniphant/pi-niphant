import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import type { ChildStatus, DelegatedAgentResult, DelegatedControlCommand, RunnerConfig } from "./schema.ts";
import { extractJsonObject, safeReadJson, writeJsonAtomic } from "./utils.ts";

function updateChildStatus(config: RunnerConfig, patch: Partial<ChildStatus>): void {
  const current = safeReadJson<ChildStatus>(config.child.statusPath);
  const now = Date.now();
  writeJsonAtomic(config.child.statusPath, {
    id: config.child.id,
    runId: config.runId,
    index: config.child.index,
    agent: config.child.definition.name,
    displayName: config.child.definition.displayName,
    shortLabel: config.child.definition.shortLabel,
    task: config.child.task,
    cwd: config.cwd,
    state: current?.state ?? "queued",
    phase: current?.phase ?? "Queued",
    startedAt: current?.startedAt ?? now,
    updatedAt: now,
    outputLogPath: config.child.outputLogPath,
    resultPath: config.child.resultPath,
    controlPath: config.child.controlPath,
    pid: current?.pid ?? process.pid,
    ...current,
    ...patch,
  });
}

function buildPrompt(config: RunnerConfig): string {
  return [
    config.child.definition.systemPrompt,
    "",
    `Task: ${config.child.task}`,
  ].join("\n");
}

function parseAgentResult(
  config: RunnerConfig,
  rawText: string,
  stderr: string,
  completed: boolean,
): DelegatedAgentResult {
  const raw = rawText.trim() || stderr.trim();
  const extracted = extractJsonObject(raw);
  if (!extracted) {
    return {
      agent: config.child.definition.name,
      displayName: config.child.definition.displayName,
      success: false,
      summary: raw || "Delegated agent exited without usable JSON output.",
      keyFindings: [],
      risks: ["Delegated agent did not return valid JSON output."],
      recommendedNextSteps: ["Inspect the delegated agent output log."],
      keyFiles: [],
      rawOutput: raw,
      error: "Invalid JSON output",
    };
  }

  try {
    const parsed = JSON.parse(extracted) as Omit<DelegatedAgentResult, "agent" | "displayName" | "success"> & { success?: boolean };
    return {
      agent: config.child.definition.name,
      displayName: config.child.definition.displayName,
      success: completed && parsed.success !== false,
      summary: parsed.summary ?? "",
      keyFindings: Array.isArray(parsed.keyFindings) ? parsed.keyFindings.map(String) : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks.map(String) : [],
      recommendedNextSteps: Array.isArray(parsed.recommendedNextSteps) ? parsed.recommendedNextSteps.map(String) : [],
      keyFiles: Array.isArray(parsed.keyFiles) ? parsed.keyFiles.map(String) : [],
      rawOutput: raw,
      error: completed ? undefined : "Delegated run did not complete successfully",
    };
  } catch (error) {
    return {
      agent: config.child.definition.name,
      displayName: config.child.definition.displayName,
      success: false,
      summary: raw || "Failed to parse delegated agent output.",
      keyFindings: [],
      risks: [error instanceof Error ? error.message : String(error)],
      recommendedNextSteps: ["Inspect the delegated agent output log."],
      keyFiles: [],
      rawOutput: raw,
      error: "Malformed JSON output",
    };
  }
}

interface RpcResponse {
  type: "response";
  id?: string;
  command?: string;
  success?: boolean;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function run(config: RunnerConfig): Promise<void> {
  fs.mkdirSync(path.dirname(config.child.outputLogPath), { recursive: true });
  fs.mkdirSync(path.dirname(config.child.resultPath), { recursive: true });
  fs.mkdirSync(path.dirname(config.child.controlPath), { recursive: true });
  fs.writeFileSync(config.child.outputLogPath, "", "utf8");
  fs.writeFileSync(config.child.controlPath, "", { encoding: "utf8", flag: "a" });

  updateChildStatus(config, { state: "running", phase: "Planning", pid: process.pid });

  const args = [
    "--mode",
    "rpc",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--tools",
    config.child.definition.tools.join(","),
  ];

  if (config.child.model) args.push("--model", config.child.model);

  let cancelledMessage: string | null = null;
  let runtimeError: string | null = null;
  let childClosed = false;
  let childExitCode = 1;
  let agentFinished = false;

  const child = spawn("pi", args, {
    cwd: config.cwd,
    env: {
      ...process.env,
      PI_OFFLINE: process.env.PI_OFFLINE ?? "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const outputStream = fs.createWriteStream(config.child.outputLogPath, { flags: "a" });

  const appendLogLine = (line: string) => {
    outputStream.write(`${line.replace(/\s+$/g, "")}\n`);
  };

  const requestCancel = (message: string) => {
    if (cancelledMessage) return;
    cancelledMessage = message;
    updateChildStatus(config, {
      state: "failed",
      phase: "Failed",
      summary: message,
      error: message,
      pid: process.pid,
    });
    try {
      child.stdin.write(`${JSON.stringify({ type: "abort" })}\n`);
    } catch {}
    try {
      child.kill("SIGTERM");
    } catch {}
  };

  const onSignal = () => requestCancel("Cancelled by user.");
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);

  let assistantText = "";
  let assistantLineBuffer = "";
  let stdoutBuffer = "";
  let stderr = "";

  const flushAssistantBuffer = (force = false) => {
    if (!assistantLineBuffer) return;
    if (!force && assistantLineBuffer.length < 120 && !assistantLineBuffer.includes("\n")) return;
    const parts = assistantLineBuffer.split(/\r?\n/);
    assistantLineBuffer = parts.pop() ?? "";
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed) appendLogLine(`assistant> ${trimmed}`);
    }
    if (force && assistantLineBuffer.trim()) {
      appendLogLine(`assistant> ${assistantLineBuffer.trim()}`);
      assistantLineBuffer = "";
    }
  };

  const updatePhaseForTool = (toolName: string) => {
    const phase = toolName === "read" || toolName === "grep" || toolName === "find" || toolName === "ls"
      ? "Reading"
      : toolName === "bash"
        ? "Exploring"
        : "Summarizing";
    updateChildStatus(config, { state: "running", phase });
  };

  const pendingResponses = new Map<string, {
    resolve: (response: RpcResponse) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();

  let nextCommandId = 0;

  const rejectPendingResponses = (reason: string) => {
    for (const [id, pending] of pendingResponses) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
      pendingResponses.delete(id);
    }
  };

  const sendRpcCommand = (command: Record<string, unknown>, timeoutMs = 15_000): Promise<RpcResponse> => {
    const id = `cmd-${Date.now().toString(36)}-${(++nextCommandId).toString(36)}`;
    const payload = { id, ...command };

    return new Promise<RpcResponse>((resolve, reject) => {
      if (child.stdin.destroyed || childClosed) {
        reject(new Error("Delegated agent process is not accepting commands."));
        return;
      }

      const timeout = setTimeout(() => {
        pendingResponses.delete(id);
        reject(new Error(`Timed out waiting for RPC response: ${String(command.type ?? "unknown")}`));
      }, timeoutMs);

      pendingResponses.set(id, { resolve, reject, timeout });
      child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) return;
        clearTimeout(timeout);
        pendingResponses.delete(id);
        reject(error);
      });
    });
  };

  const handleRpcEvent = (event: Record<string, unknown>) => {
    switch (event.type) {
      case "agent_start": {
        updateChildStatus(config, { state: "running", phase: "Exploring" });
        break;
      }
      case "agent_end": {
        agentFinished = true;
        break;
      }
      case "turn_start": {
        updateChildStatus(config, { state: "running", phase: "Exploring" });
        break;
      }
      case "tool_execution_start": {
        const toolName = typeof event.toolName === "string" ? event.toolName : "unknown";
        updatePhaseForTool(toolName);
        const rawArgs = event.args === undefined ? "" : ` ${JSON.stringify(event.args).slice(0, 180)}`;
        appendLogLine(`tool> ${toolName}${rawArgs}`);
        break;
      }
      case "tool_execution_update": {
        const toolName = typeof event.toolName === "string" ? event.toolName : "unknown";
        updatePhaseForTool(toolName);
        appendLogLine(`tool> ${toolName} update`);
        break;
      }
      case "tool_execution_end": {
        const toolName = typeof event.toolName === "string" ? event.toolName : "unknown";
        const isError = event.isError === true;
        updateChildStatus(config, { state: "running", phase: "Summarizing" });
        appendLogLine(`tool> ${toolName} ${isError ? "error" : "done"}`);
        break;
      }
      case "message_update": {
        const assistantMessageEvent = isRecord(event.assistantMessageEvent)
          ? event.assistantMessageEvent
          : undefined;
        const delta = assistantMessageEvent?.delta;
        if (typeof delta === "string" && delta.length > 0) {
          assistantText += delta;
          assistantLineBuffer += delta;
          flushAssistantBuffer();
          updateChildStatus(config, { state: "running", phase: "Summarizing" });
        }
        break;
      }
      case "message_end": {
        flushAssistantBuffer(true);
        break;
      }
      case "extension_error": {
        const errorText = typeof event.error === "string" ? event.error : "Unknown extension error";
        appendLogLine(`rpc> extension_error ${errorText}`);
        break;
      }
      default:
        break;
    }
  };

  const handleRpcLine = (line: string) => {
    if (!line.trim()) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      appendLogLine(line);
      return;
    }

    if (!isRecord(parsed)) {
      appendLogLine(line);
      return;
    }

    if (parsed.type === "response") {
      const response: RpcResponse = {
        type: "response",
        id: typeof parsed.id === "string" ? parsed.id : undefined,
        command: typeof parsed.command === "string" ? parsed.command : undefined,
        success: typeof parsed.success === "boolean" ? parsed.success : undefined,
        error: typeof parsed.error === "string" ? parsed.error : undefined,
      };
      const responseId = response.id;
      if (!responseId) return;
      const pending = pendingResponses.get(responseId);
      if (!pending) return;
      pendingResponses.delete(responseId);
      clearTimeout(pending.timeout);
      pending.resolve(response);
      return;
    }

    handleRpcEvent(parsed);
  };

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();
    let newlineIndex = stdoutBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      let line = stdoutBuffer.slice(0, newlineIndex);
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      handleRpcLine(line);
      newlineIndex = stdoutBuffer.indexOf("\n");
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stderr += text;
    appendLogLine(`stderr> ${text.trimEnd()}`);
  });

  const childClosePromise = new Promise<number>((resolve) => {
    child.on("close", (code) => {
      childClosed = true;
      childExitCode = code ?? 1;
      rejectPendingResponses("Delegated agent process closed.");
      resolve(childExitCode);
    });
  });

  child.on("error", (error) => {
    const message = error instanceof Error ? error.message : String(error);
    stderr += `\n${message}`;
    appendLogLine(`stderr> ${message}`);
  });

  let controlOffset = 0;

  const steeringQueue: string[] = [];
  let steeringInFlight = false;

  const processSteeringQueue = async () => {
    if (steeringInFlight) return;
    steeringInFlight = true;
    try {
      while (steeringQueue.length > 0 && !agentFinished && !cancelledMessage) {
        const message = steeringQueue.shift();
        if (!message) continue;
        appendLogLine(`steer> ${message}`);
        updateChildStatus(config, { state: "running", phase: "Steering" });

        try {
          const response = await sendRpcCommand({ type: "steer", message }, 12_000);
          if (response.success === false) {
            const reason = response.error || "Steer command rejected";
            appendLogLine(`steer> rejected ${reason}`);
            updateChildStatus(config, { state: "running", phase: "Exploring" });
            continue;
          }
          appendLogLine("steer> delivered");
          updateChildStatus(config, { state: "running", phase: "Exploring" });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          appendLogLine(`steer> failed ${message}`);
          updateChildStatus(config, { state: "running", phase: "Exploring" });
        }
      }
    } finally {
      steeringInFlight = false;
    }
  };

  const enqueueSteer = (instruction: string) => {
    const trimmed = instruction.trim();
    if (!trimmed) return;
    steeringQueue.push(trimmed);
    void processSteeringQueue();
  };

  const drainControlCommands = () => {
    if (agentFinished || cancelledMessage) return;

    let stat;
    try {
      stat = fs.statSync(config.child.controlPath);
    } catch {
      return;
    }

    if (stat.size <= controlOffset) return;

    const chunkSize = stat.size - controlOffset;
    const buffer = Buffer.alloc(chunkSize);
    const fd = fs.openSync(config.child.controlPath, "r");
    try {
      fs.readSync(fd, buffer, 0, chunkSize, controlOffset);
    } finally {
      fs.closeSync(fd);
    }

    controlOffset = stat.size;
    const lines = buffer.toString("utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      try {
        const command = JSON.parse(line) as DelegatedControlCommand;
        if (command.type !== "steer" || typeof command.message !== "string") continue;
        enqueueSteer(command.message);
      } catch {
        appendLogLine(`control> ignored malformed command: ${line.slice(0, 120)}`);
      }
    }
  };

  const controlPoller = setInterval(drainControlCommands, 350);
  controlPoller.unref?.();

  const waitForChildClose = async (timeoutMs: number): Promise<number | null> => {
    return new Promise<number | null>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(null);
      }, timeoutMs);
      childClosePromise.then((exitCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(exitCode);
      }).catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(null);
      });
    });
  };

  try {
    const promptResponse = await sendRpcCommand({
      type: "prompt",
      message: buildPrompt(config),
    }, 25_000);

    if (promptResponse.success === false) {
      throw new Error(promptResponse.error || "Delegated prompt was rejected.");
    }

    appendLogLine(`session> ${config.child.definition.displayName} started`);
    updateChildStatus(config, { state: "running", phase: "Exploring" });

    while (!agentFinished && !cancelledMessage) {
      if (childClosed) break;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    if (!cancelledMessage && !agentFinished && childClosed) {
      throw new Error("Delegated agent exited before finishing.");
    }
  } catch (error) {
    if (!cancelledMessage) {
      runtimeError = error instanceof Error ? error.message : String(error);
      appendLogLine(`error> ${runtimeError}`);
    }
  } finally {
    clearInterval(controlPoller);

    if (!childClosed) {
      try {
        child.kill("SIGTERM");
      } catch {}
    }

    let exitCode = await waitForChildClose(1_500);
    if (exitCode === null && !childClosed) {
      try {
        child.kill("SIGKILL");
      } catch {}
      exitCode = await waitForChildClose(1_500);
    }
    childExitCode = exitCode ?? childExitCode;

    flushAssistantBuffer(true);
    if (stdoutBuffer.trim()) {
      handleRpcLine(stdoutBuffer.trim());
      stdoutBuffer = "";
    }

    outputStream.end();
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
  }

  const completed = !cancelledMessage && !runtimeError && agentFinished;

  const result = cancelledMessage
    ? {
        agent: config.child.definition.name,
        displayName: config.child.definition.displayName,
        success: false,
        summary: cancelledMessage,
        keyFindings: [],
        risks: [cancelledMessage],
        recommendedNextSteps: [],
        keyFiles: [],
        rawOutput: assistantText.trim() || stderr.trim(),
        error: cancelledMessage,
      }
    : runtimeError
      ? {
          agent: config.child.definition.name,
          displayName: config.child.definition.displayName,
          success: false,
          summary: runtimeError,
          keyFindings: [],
          risks: [runtimeError],
          recommendedNextSteps: ["Inspect the delegated agent output log."],
          keyFiles: [],
          rawOutput: assistantText.trim() || stderr.trim(),
          error: runtimeError,
        }
      : parseAgentResult(config, assistantText, stderr, completed);

  if (!result.summary && completed) result.summary = "Completed without a summary.";

  const effectiveExitCode = completed ? 0 : childExitCode;
  updateChildStatus(config, {
    state: result.success ? "complete" : "failed",
    phase: result.success ? "Complete" : "Failed",
    summary: result.summary,
    error: result.error,
    exitCode: effectiveExitCode,
  });

  writeJsonAtomic(config.child.resultPath, result);
}

const configPath = process.argv[2];
if (!configPath) {
  process.stderr.write("Missing runner config path\n");
  process.exit(1);
}

const raw = fs.readFileSync(configPath, "utf8");
const config = JSON.parse(raw) as RunnerConfig;
try {
  fs.unlinkSync(configPath);
} catch {}

run(config).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  updateChildStatus(config, {
    state: "failed",
    phase: "Failed",
    summary: message,
    error: message,
  });
  writeJsonAtomic(config.child.resultPath, {
    agent: config.child.definition.name,
    displayName: config.child.definition.displayName,
    success: false,
    summary: message,
    keyFindings: [],
    risks: [message],
    recommendedNextSteps: ["Inspect the delegated agent output log."],
    keyFiles: [],
    error: message,
  } satisfies DelegatedAgentResult);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
