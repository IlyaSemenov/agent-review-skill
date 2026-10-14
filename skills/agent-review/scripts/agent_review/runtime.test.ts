import assert from "node:assert/strict"
import { existsSync, readdirSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, test } from "node:test"

import {
  ensureRuntimeDependencies,
  loadAgentex,
  RUNTIME_MANIFEST_DIR,
  type RunNpm,
  runtimeManifestHash,
} from "./runtime.ts"

async function withCacheRoot(
  run: (cacheRoot: string) => Promise<void>,
): Promise<void> {
  const cacheRoot = await mkdtemp(join(tmpdir(), "agent-review-cache-"))
  try {
    await run(cacheRoot)
  } finally {
    await rm(cacheRoot, { recursive: true, force: true })
  }
}

describe("runtime dependencies", () => {
  test("pins the development types to the runtime dependency version", async () => {
    const runtime = JSON.parse(
      await readFile(join(RUNTIME_MANIFEST_DIR, "package.json"), "utf8"),
    )
    const development = JSON.parse(
      await readFile(
        new URL("../../../../package.json", import.meta.url),
        "utf8",
      ),
    )
    assert.equal(
      development.devDependencies["@agentex/agent"],
      runtime.dependencies["@agentex/agent"],
    )
  })

  test("installs the locked manifest once into a hash-keyed directory", async () => {
    await withCacheRoot(async (cacheRoot) => {
      const calls: Array<{ args: string[]; cwd: string }> = []
      const runNpm: RunNpm = async (args, cwd) => {
        calls.push({ args, cwd })
        assert.ok(existsSync(join(cwd, "package-lock.json")))
        await writeFile(join(cwd, "installed"), "")
      }

      const installDir = await ensureRuntimeDependencies({
        timeoutMs: 1_000,
        cacheRoot,
        runNpm,
      })
      await ensureRuntimeDependencies({ timeoutMs: 1_000, cacheRoot, runNpm })

      assert.equal(installDir, join(cacheRoot, await runtimeManifestHash()))
      assert.ok(existsSync(join(installDir, "installed")))
      assert.equal(calls.length, 1)
      assert.equal(calls[0]?.args[0], "ci")
      assert.deepEqual(readdirSync(cacheRoot), [await runtimeManifestHash()])
    })
  })

  test("keeps one complete install when installs race", async () => {
    await withCacheRoot(async (cacheRoot) => {
      const runNpm: RunNpm = async (_args, cwd) => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        await writeFile(join(cwd, "installed"), "")
      }

      const [first, second] = await Promise.all([
        ensureRuntimeDependencies({ timeoutMs: 1_000, cacheRoot, runNpm }),
        ensureRuntimeDependencies({ timeoutMs: 1_000, cacheRoot, runNpm }),
      ])

      assert.equal(first, second)
      assert.ok(existsSync(join(first, "installed")))
      assert.deepEqual(readdirSync(cacheRoot), [await runtimeManifestHash()])
    })
  })

  test("loads the package from a completed install", async () => {
    await withCacheRoot(async (cacheRoot) => {
      const packageDir = join(
        cacheRoot,
        await runtimeManifestHash(),
        "node_modules/@agentex/agent",
      )
      await mkdir(join(packageDir, "dist"), { recursive: true })
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "@agentex/agent",
          type: "module",
          exports: {
            ".": { import: "./dist/index.js", default: "./dist/index.js" },
          },
        }),
      )
      await writeFile(
        join(packageDir, "dist/index.js"),
        'export const getProvider = () => "cached"\n',
      )

      const agentex = await loadAgentex({
        timeoutMs: 1_000,
        cacheRoot,
        runNpm: async () => {
          throw new Error("a completed install must not run npm")
        },
      })
      assert.equal((agentex.getProvider as unknown as () => string)(), "cached")
    })
  })

  test("removes the staging directory after a failed install", async () => {
    await withCacheRoot(async (cacheRoot) => {
      await assert.rejects(
        ensureRuntimeDependencies({
          timeoutMs: 1_000,
          cacheRoot,
          runNpm: async () => {
            throw new Error("npm error network")
          },
        }),
        /npm error network/,
      )
      assert.deepEqual(readdirSync(cacheRoot), [])
    })
  })
})
