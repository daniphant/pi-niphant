#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const DEFAULT_ROOT = path.join(os.tmpdir(), "pi-github-repo-checkouts");
const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

function printHelp() {
  console.log(`prepare-github-repo-checkout.mjs

Usage:
  node prepare-github-repo-checkout.mjs --repo <repo> [--ref <ref>] [--pr <number>] [--dir-root <path>] [--dry-run]

Examples:
  node prepare-github-repo-checkout.mjs --repo vercel/next.js
  node prepare-github-repo-checkout.mjs --repo vercel/next.js --ref canary
  node prepare-github-repo-checkout.mjs --repo https://github.com/vercel/next.js
  node prepare-github-repo-checkout.mjs --repo https://github.com/owner/repo/pull/123
  node prepare-github-repo-checkout.mjs --repo owner/repo@main --dry-run
`);
}

function parseArgs(argv) {
  const args = {
    repo: undefined,
    ref: undefined,
    pr: undefined,
    dirRoot: DEFAULT_ROOT,
    dryRun: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    switch (current) {
      case "--repo":
        args.repo = argv[index + 1];
        index += 1;
        break;
      case "--ref":
        args.ref = argv[index + 1];
        index += 1;
        break;
      case "--pr":
        args.pr = argv[index + 1];
        index += 1;
        break;
      case "--dir-root":
        args.dirRoot = argv[index + 1];
        index += 1;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${current}`);
    }
  }

  return args;
}

function cleanRepoName(value) {
  return value.replace(/\.git$/u, "");
}

function sanitizePathSegment(value) {
  return value.replace(/[^a-zA-Z0-9._-]/gu, "-");
}

function parseRepoReference(repoInput) {
  const input = repoInput.trim();

  if (!input) {
    throw new Error("Repository input cannot be empty.");
  }

  const sshMatch = input.match(/^git@github\.com:([^/\s]+)\/([^\s]+?)(?:\.git)?$/u);
  if (sshMatch) {
    const owner = sshMatch[1];
    const repo = cleanRepoName(sshMatch[2]);

    return {
      input,
      owner,
      repo,
      remoteUrl: `https://github.com/${owner}/${repo}.git`,
      inferredRef: undefined,
      inferredPr: undefined,
      source: "ssh-url"
    };
  }

  if (input.startsWith("http://") || input.startsWith("https://")) {
    const url = new URL(input);
    if (!GITHUB_HOSTS.has(url.hostname)) {
      throw new Error(`Only github.com URLs are supported. Received host: ${url.hostname}`);
    }

    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 2) {
      throw new Error(`GitHub URL is missing owner/repo information: ${input}`);
    }

    const owner = segments[0];
    const repo = cleanRepoName(segments[1]);
    let inferredRef;
    let inferredPr;

    if (segments[2] === "pull" && /^\d+$/u.test(segments[3] ?? "")) {
      inferredPr = segments[3];
    }

    if (segments[2] === "commit" && segments[3]) {
      inferredRef = segments[3];
    }

    if (segments[2] === "tree" && segments.length === 4) {
      inferredRef = segments[3];
    }

    return {
      input,
      owner,
      repo,
      remoteUrl: `https://github.com/${owner}/${repo}.git`,
      inferredRef,
      inferredPr,
      source: "https-url"
    };
  }

  const shorthandMatch = input.match(/^([^/\s]+)\/([^@\s]+?)(?:\.git)?(?:@(.+))?$/u);
  if (shorthandMatch) {
    const owner = shorthandMatch[1];
    const repo = cleanRepoName(shorthandMatch[2]);
    const inferredRef = shorthandMatch[3] || undefined;

    return {
      input,
      owner,
      repo,
      remoteUrl: `https://github.com/${owner}/${repo}.git`,
      inferredRef,
      inferredPr: undefined,
      source: inferredRef ? "owner-repo-at-ref" : "owner-repo"
    };
  }

  throw new Error(
    "Unsupported repository input. Use a GitHub URL, PR URL, SSH URL, or owner/repo shorthand."
  );
}

async function runGit(args, options = {}) {
  try {
    const result = await execFile("git", args, {
      cwd: options.cwd,
      maxBuffer: 10 * 1024 * 1024
    });

    return {
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim()
    };
  } catch (error) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : "";
    const message = stderr || stdout || error.message;
    const command = ["git", ...args].join(" ");
    const cwdText = options.cwd ? ` (cwd: ${options.cwd})` : "";
    throw new Error(`${command} failed${cwdText}: ${message}`);
  }
}

async function gitRefExists(cwd, ref) {
  try {
    await runGit(["show-ref", "--verify", "--quiet", ref], { cwd });
    return true;
  } catch {
    return false;
  }
}

async function gitCommitExists(cwd, ref) {
  try {
    await runGit(["rev-parse", "--verify", `${ref}^{commit}`], { cwd });
    return true;
  } catch {
    return false;
  }
}

async function gitRepoExists(cloneDir) {
  try {
    await access(path.join(cloneDir, ".git"));
    return true;
  } catch {
    return false;
  }
}

async function ensureCheckoutRepo(cloneDir, remoteUrl) {
  await mkdir(path.dirname(cloneDir), { recursive: true });

  if (await gitRepoExists(cloneDir)) {
    await runGit(["remote", "set-url", "origin", remoteUrl], { cwd: cloneDir });
  } else {
    await runGit(["clone", remoteUrl, cloneDir]);
  }

  await runGit(["fetch", "--tags", "--prune", "origin"], { cwd: cloneDir });
}

async function getDefaultBranch(cloneDir) {
  try {
    const { stdout } = await runGit(["symbolic-ref", "refs/remotes/origin/HEAD", "--short"], {
      cwd: cloneDir
    });

    return stdout.replace(/^origin\//u, "");
  } catch {
    const { stdout } = await runGit(["remote", "show", "origin"], { cwd: cloneDir });
    const match = stdout.match(/HEAD branch: (.+)$/mu);

    if (!match) {
      throw new Error(`Unable to determine default branch for ${cloneDir}`);
    }

    return match[1].trim();
  }
}

async function checkoutTarget(cloneDir, options) {
  const { ref, pr, defaultBranch } = options;

  await runGit(["reset", "--hard", "HEAD"], { cwd: cloneDir });
  await runGit(["clean", "-fd"], { cwd: cloneDir });

  if (pr) {
    const localBranch = `pr-${pr}`;
    await runGit(["fetch", "origin", `pull/${pr}/head:${localBranch}`], { cwd: cloneDir });
    await runGit(["checkout", localBranch], { cwd: cloneDir });

    return {
      checkoutType: "pull-request",
      requestedRef: undefined,
      requestedPr: pr,
      resolvedRef: localBranch
    };
  }

  if (ref) {
    if (await gitRefExists(cloneDir, `refs/remotes/origin/${ref}`)) {
      await runGit(["checkout", "-B", ref, `origin/${ref}`], { cwd: cloneDir });

      return {
        checkoutType: "branch",
        requestedRef: ref,
        requestedPr: undefined,
        resolvedRef: ref
      };
    }

    if (await gitRefExists(cloneDir, `refs/tags/${ref}`)) {
      await runGit(["checkout", "--detach", `refs/tags/${ref}`], { cwd: cloneDir });

      return {
        checkoutType: "tag",
        requestedRef: ref,
        requestedPr: undefined,
        resolvedRef: ref
      };
    }

    if (await gitCommitExists(cloneDir, ref)) {
      await runGit(["checkout", "--detach", ref], { cwd: cloneDir });

      return {
        checkoutType: "commit",
        requestedRef: ref,
        requestedPr: undefined,
        resolvedRef: ref
      };
    }

    throw new Error(`Could not resolve ref '${ref}' as a remote branch, tag, or commit.`);
  }

  await runGit(["checkout", "-B", defaultBranch, `origin/${defaultBranch}`], { cwd: cloneDir });

  return {
    checkoutType: "default-branch",
    requestedRef: undefined,
    requestedPr: undefined,
    resolvedRef: defaultBranch
  };
}

async function getHeadSha(cloneDir) {
  const { stdout } = await runGit(["rev-parse", "HEAD"], { cwd: cloneDir });
  return stdout;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.repo) {
    printHelp();
    throw new Error("Missing required argument: --repo");
  }

  if (args.ref && args.pr) {
    throw new Error("Use either --ref or --pr, not both.");
  }

  if (args.pr && !/^\d+$/u.test(args.pr)) {
    throw new Error("--pr must be a numeric GitHub pull request number.");
  }

  const parsedRepo = parseRepoReference(args.repo);
  const requestedRef = args.ref ?? parsedRepo.inferredRef;
  const requestedPr = args.pr ?? parsedRepo.inferredPr;
  const cloneDir = path.join(
    path.resolve(args.dirRoot),
    `${sanitizePathSegment(parsedRepo.owner)}__${sanitizePathSegment(parsedRepo.repo)}`
  );

  const baseResult = {
    input: parsedRepo.input,
    source: parsedRepo.source,
    owner: parsedRepo.owner,
    repo: parsedRepo.repo,
    remoteUrl: parsedRepo.remoteUrl,
    cloneDir,
    requestedRef: requestedRef || undefined,
    requestedPr: requestedPr || undefined
  };

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          ...baseResult,
          dryRun: true
        },
        null,
        2
      )
    );
    return;
  }

  await ensureCheckoutRepo(cloneDir, parsedRepo.remoteUrl);
  const defaultBranch = await getDefaultBranch(cloneDir);
  const checkout = await checkoutTarget(cloneDir, {
    ref: requestedRef,
    pr: requestedPr,
    defaultBranch
  });
  const commitSha = await getHeadSha(cloneDir);

  console.log(
    JSON.stringify(
      {
        ...baseResult,
        dryRun: false,
        defaultBranch,
        checkoutType: checkout.checkoutType,
        resolvedRef: checkout.resolvedRef,
        commitSha
      },
      null,
      2
    )
  );
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
