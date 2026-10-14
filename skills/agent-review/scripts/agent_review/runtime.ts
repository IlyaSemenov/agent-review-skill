import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
} from "node:fs/promises"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { join } from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

import { OperationalError } from "./core.ts"

export type Agentex = typeof import("@agentex/agent")

export const RUNTIME_MANIFEST_DIR = fileURLToPath(
  new URL("./runtime/", import.meta.url),
)
const MANIFEST_FILES = ["package.json", "package-lock.json"] as const

export type RunNpm = (
  args: string[],
  cwd: string,
  timeoutMs: number,
) => Promise<void>

/**
 * Loads `@agentex/agent` from the runtime dependency cache, installing the locked dependency set on first use.
 * Replace this module with a pinned `npx -y` invocation only once an agentex binary covers every reviewer and lost-session detection: https://github.com/dynamismlabs/agentex/issues/3
 */
export async function loadAgentex(options: {
  timeoutMs: number
  cacheRoot?: string
  runNpm?: RunNpm
}): Promise<Agentex> {
  const installDir = await ensureRuntimeDependencies(options)
  const require = createRequire(join(installDir, "package.json"))
  const entry = require.resolve("@agentex/agent")
  return (await import(pathToFileURL(entry).href)) as Agentex
}

/**
 * Installs the locked runtime dependency set into a cache directory keyed by its manifest hash and returns that directory.
 * Installation runs in a temporary sibling directory that is atomically renamed into place, so concurrent helpers never observe a partial install.
 */
export async function ensureRuntimeDependencies(options: {
  timeoutMs: number
  cacheRoot?: string
  runNpm?: RunNpm
}): Promise<string> {
  const {
    timeoutMs,
    cacheRoot = defaultCacheRoot(),
    runNpm = runNpmCommand,
  } = options
  const installDir = join(cacheRoot, await runtimeManifestHash())
  if (existsSync(installDir)) return installDir

  await mkdir(cacheRoot, { recursive: true })
  const stagingDir = await mkdtemp(join(cacheRoot, ".install-"))
  try {
    for (const file of MANIFEST_FILES) {
      await copyFile(join(RUNTIME_MANIFEST_DIR, file), join(stagingDir, file))
    }
    await runNpm(
      [
        "ci",
        "--omit=dev",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--loglevel=error",
      ],
      stagingDir,
      timeoutMs,
    )
    try {
      await rename(stagingDir, installDir)
    } catch (error) {
      // A concurrent helper may have completed the same install first.
      if (!existsSync(installDir)) throw error
    }
  } finally {
    await rm(stagingDir, { recursive: true, force: true })
  }
  return installDir
}

export async function runtimeManifestHash(): Promise<string> {
  const hash = createHash("sha256")
  for (const file of MANIFEST_FILES) {
    hash.update(await readFile(join(RUNTIME_MANIFEST_DIR, file)))
    hash.update("\0")
  }
  return hash.digest("hex").slice(0, 16)
}

function defaultCacheRoot(): string {
  const cacheHome = process.env.XDG_CACHE_HOME || join(homedir(), ".cache")
  return join(cacheHome, "agent-review")
}

async function runNpmCommand(
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("npm", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    let timedOut = false
    let spawnError: Error | undefined
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 1_000)
    }, timeoutMs)

    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      output += chunk
    })
    child.stderr.on("data", (chunk: string) => {
      output += chunk
    })
    child.on("error", (error) => {
      spawnError = error
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer)
      if (timedOut) {
        reject(
          new OperationalError(
            "timeout",
            "Installing the helper runtime dependencies exceeded the review deadline.",
          ),
        )
      } else if (spawnError !== undefined) {
        reject(spawnError)
      } else if (code !== 0) {
        reject(
          new Error(
            `Installing the helper runtime dependencies failed: ${output.trim() || `npm exited with code ${code}`}`,
          ),
        )
      } else {
        resolve()
      }
    })
  })
}
