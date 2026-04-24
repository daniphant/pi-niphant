import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { homedir } from "node:os";

interface MdCommand {
  name: string;
  path: string;
  description: string;
  template: string;
  frontmatter: Record<string, string>;
}

function parseFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
  if (!raw.startsWith("---\n")) return { frontmatter: {}, body: raw };
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: {}, body: raw };
  const fmRaw = raw.slice(4, end).trim();
  const body = raw.slice(end + 4).replace(/^\s*\n/, "");
  const frontmatter: Record<string, string> = {};
  for (const line of fmRaw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) frontmatter[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return { frontmatter, body };
}

function listMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...listMarkdown(path));
    else if (entry.endsWith(".md")) files.push(path);
  }
  return files;
}

function loadCommands(cwd: string): MdCommand[] {
  const dirs = [
    join(homedir(), ".pi", "agent", "commands"),
    join(homedir(), ".config", "opencode", "commands"),
    join(cwd, ".pi", "commands"),
    join(cwd, ".agents", "commands"),
    join(cwd, ".opencode", "commands"),
  ];
  const seen = new Set<string>();
  const commands: MdCommand[] = [];
  for (const dir of dirs) {
    for (const path of listMarkdown(dir)) {
      const name = basename(path, ".md");
      if (seen.has(name)) continue;
      seen.add(name);
      const { frontmatter, body } = parseFrontmatter(readFileSync(path, "utf8"));
      const firstLine = body.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "Markdown command";
      commands.push({ name, path, description: frontmatter.description ?? firstLine, template: body.trim(), frontmatter });
    }
  }
  return commands;
}

function shellWords(args: string): string[] {
  return (args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []).map((p) => p.replace(/^['"]|['"]$/g, ""));
}

function expand(template: string, args: string): string {
  const words = shellWords(args);
  let out = template.replace(/\$ARGUMENTS|\$@/g, args.trim());
  out = out.replace(/\$([1-9][0-9]*)/g, (_m, n) => words[Number(n) - 1] ?? "");
  out = out.replace(/\$\{@:([1-9][0-9]*)(?::([0-9]+))?\}/g, (_m, start, len) => {
    const idx = Number(start) - 1;
    const count = len == null ? undefined : Number(len);
    return words.slice(idx, count == null ? undefined : idx + count).join(" ");
  });
  return out;
}

export default function markdownCommands(pi: ExtensionAPI) {
  const cwd = process.cwd();
  const commands = loadCommands(cwd);

  for (const command of commands) {
    pi.registerCommand(command.name, {
      description: `${command.description} (${command.path})`,
      handler: async (args, ctx) => {
        if (!ctx.isIdle()) {
          ctx.ui.notify("Agent is busy; queueing markdown command as follow-up.", "info");
          pi.sendUserMessage(expand(command.template, args), { deliverAs: "followUp" });
          return;
        }
        pi.sendUserMessage(expand(command.template, args));
      },
    });
  }

  pi.registerCommand("markdown-commands", {
    description: "List markdown command files loaded from .pi/.agents/.opencode commands directories",
    handler: async (_args, ctx) => {
      const current = loadCommands(ctx.cwd);
      if (!current.length) {
        ctx.ui.notify("No markdown commands found.", "info");
        return;
      }
      ctx.ui.notify(current.map((cmd) => `/${cmd.name} — ${cmd.description}\n  ${resolve(cmd.path)}`).join("\n"), "info");
    },
  });
}
