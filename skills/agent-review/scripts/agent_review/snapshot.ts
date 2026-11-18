import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { copyFile, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import process from "node:process"
import { promisify } from "node:util"

import { errorMessage } from "./core.ts"

const execFileAsync = promisify(execFile)

/** A Git object name: SHA-1 or SHA-256 in lowercase hex. */
export const SNAPSHOT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

/** The working-tree state of one round: its snapshot, the changes since the previous one, or why either is missing. */
type RoundSnapshot = {
  snapshot?: string
  changes?: { from: string; to: string }
  error?: string
}

/**
 * Records the working tree at `cwd` for one round and, given the previous round's snapshot, the range of changes since it.
 * Never throws: a failure leaves out what it prevented and describes itself in `error`.
 */
export async function takeRoundSnapshot(options: {
  cwd: string
  since?: string
  timeoutMs: number
}): Promise<RoundSnapshot> {
  const { cwd, since, timeoutMs } = options
  const signal = AbortSignal.timeout(timeoutMs)
  const describeFailure = (action: string, error: unknown) =>
    signal.aborted
      ? `Git did not ${action} within ${Math.ceil(timeoutMs / 1_000)} seconds`
      : `Git could not ${action}: ${errorMessage(error).trim()}`

  let snapshot: string | undefined
  try {
    snapshot = await snapshotWorkingTree(cwd, signal)
  } catch (error) {
    return { error: describeFailure("record the snapshot", error) }
  }
  if (since === undefined) return { snapshot }
  if (snapshot === undefined) {
    return {
      error:
        "--since-snapshot was given, but the review working directory is not in a Git work tree",
    }
  }
  try {
    if (!(await isTree(cwd, since, signal))) {
      return {
        snapshot,
        error: `The previous snapshot ${since} is missing or is not a tree`,
      }
    }
  } catch (error) {
    return {
      snapshot,
      error: describeFailure("look up the previous snapshot", error),
    }
  }
  return { snapshot, changes: { from: since, to: snapshot } }
}

/**
 * Records the working tree, including untracked files that are not ignored, as a Git tree object and returns its name, or `undefined` outside a Git work tree.
 * Stages into a temporary copy of the index with hooks disabled, so Git leaves the repository's index and working tree untouched; clean and process filters configured in the repository still run.
 */
export async function snapshotWorkingTree(
  cwd: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (!(await isInsideWorkTree(cwd, signal))) return undefined
  const indexPath = resolve(
    cwd,
    await runGit(cwd, ["rev-parse", "--git-path", "index"], { signal }),
  )
  // The Git directory keeps the temporary index out of the snapshot, unlike a system temporary directory or an inherited GIT_INDEX_FILE inside the working tree.
  const tempIndex = join(
    await runGit(cwd, ["rev-parse", "--absolute-git-dir"], { signal }),
    `agent-review-snapshot-${randomBytes(6).toString("hex")}.index`,
  )
  try {
    try {
      await copyFile(indexPath, tempIndex)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    const env = { GIT_INDEX_FILE: tempIndex }
    await runGit(cwd, ["add", "--all"], { env, signal })
    return await runGit(cwd, ["write-tree"], { env, signal })
  } finally {
    await rm(tempIndex, { force: true })
  }
}

/** Checks whether `name` is itself a tree object, not a commit or tag that peels to one. */
async function isTree(
  cwd: string,
  name: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    return (
      (await runGit(
        cwd,
        ["rev-parse", "--verify", "--quiet", `${name}^{tree}`],
        { signal },
      )) === name
    )
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return false
    throw error
  }
}

async function isInsideWorkTree(
  cwd: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    return (
      (await runGit(cwd, ["rev-parse", "--is-inside-work-tree"], {
        signal,
      })) === "true"
    )
  } catch (error) {
    if (
      /not a git repository/.test(
        String((error as { stderr?: unknown }).stderr),
      )
    )
      return false
    throw error
  }
}

async function runGit(
  cwd: string,
  args: string[],
  options: { env?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["-c", "core.hooksPath=/dev/null", ...args],
    {
      cwd,
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: "0",
        LC_ALL: "C",
        ...options.env,
      },
      maxBuffer: 16 * 1024 * 1024,
      signal: options.signal,
    },
  )
  return stdout.trim()
}
