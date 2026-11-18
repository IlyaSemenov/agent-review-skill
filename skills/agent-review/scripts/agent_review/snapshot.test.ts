import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import process from "node:process"
import { afterEach, beforeEach, describe, test } from "node:test"

import { snapshotWorkingTree, takeRoundSnapshot } from "./snapshot.ts"

let dir: string

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim()
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "agent-review-snapshot-test-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("snapshotWorkingTree", () => {
  test("returns undefined outside a Git work tree", async () => {
    assert.equal(await snapshotWorkingTree(dir), undefined)
  })

  test("records new, deleted, and untracked files without touching the index", async () => {
    git("init", "--quiet")
    await writeFile(join(dir, "tracked.txt"), "one\n")
    await writeFile(join(dir, "deleted.txt"), "deleted\n")
    git("add", "tracked.txt", "deleted.txt")
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init")
    await writeFile(join(dir, "tracked.txt"), "staged\n")
    git("add", "tracked.txt")
    await writeFile(join(dir, ".gitignore"), "ignored.txt\n")
    await writeFile(join(dir, "ignored.txt"), "ignored\n")
    const index = git("ls-files", "--stage")

    const before = await snapshotWorkingTree(dir)
    await writeFile(join(dir, "tracked.txt"), "staged\nedited\n")
    await rm(join(dir, "deleted.txt"))
    await mkdir(join(dir, "sub"))
    await writeFile(join(dir, "sub", "new.txt"), "new\n")
    const after = await snapshotWorkingTree(join(dir, "sub"))

    assert.ok(before && after)
    assert.equal(
      git("diff", "--name-status", before, after),
      "D\tdeleted.txt\nA\tsub/new.txt\nM\ttracked.txt",
    )
    assert.equal(git("ls-files", "--stage"), index)
    assert.doesNotMatch(git("ls-tree", "--name-only", after), /ignored\.txt/)
    assert.deepEqual(
      (await readdir(join(dir, ".git"))).filter((name) =>
        name.startsWith("agent-review-snapshot-"),
      ),
      [],
    )
  })

  test("does not run Git hooks", async () => {
    git("init", "--quiet")
    git("config", "core.hooksPath", ".git/hooks")
    const marker = join(dir, ".git", "hook-ran")
    const hook = join(dir, ".git", "hooks", "post-index-change")
    await writeFile(hook, `#!/bin/sh\ntouch "${marker}"\n`)
    await chmod(hook, 0o755)
    await writeFile(join(dir, "file.txt"), "content\n")
    git("add", "--intent-to-add", "file.txt")
    assert.ok(existsSync(marker))
    await rm(marker)

    assert.ok(await snapshotWorkingTree(dir))
    assert.equal(existsSync(marker), false)
  })

  test("keeps the temporary index out of the snapshot when the index is inside the working tree", async () => {
    git("init", "--quiet")
    await writeFile(join(dir, "file.txt"), "content\n")
    const index = process.env.GIT_INDEX_FILE
    process.env.GIT_INDEX_FILE = join(dir, "custom-index")
    try {
      const tree = await snapshotWorkingTree(dir)
      assert.ok(tree)
      assert.equal(git("ls-tree", "--name-only", tree), "file.txt")
    } finally {
      if (index === undefined) delete process.env.GIT_INDEX_FILE
      else process.env.GIT_INDEX_FILE = index
    }
  })

  test("snapshots a repository without an index", async () => {
    git("init", "--quiet")
    await writeFile(join(dir, "file.txt"), "content\n")
    const tree = await snapshotWorkingTree(dir)
    assert.ok(tree)
    assert.equal(git("ls-tree", "--name-only", tree), "file.txt")
  })
})

describe("takeRoundSnapshot", () => {
  test("returns the changes since an existing snapshot", async () => {
    git("init", "--quiet")
    await writeFile(join(dir, "file.txt"), "one\n")
    const first = await takeRoundSnapshot({ cwd: dir, timeoutMs: 10_000 })
    assert.ok(first.snapshot)
    await writeFile(join(dir, "file.txt"), "two\n")
    const second = await takeRoundSnapshot({
      cwd: dir,
      since: first.snapshot,
      timeoutMs: 10_000,
    })
    assert.ok(second.snapshot)
    assert.notEqual(second.snapshot, first.snapshot)
    assert.deepEqual(second, {
      snapshot: second.snapshot,
      changes: { from: first.snapshot, to: second.snapshot },
    })
  })

  test("reports a previous snapshot that is missing or is not a tree", async () => {
    git("init", "--quiet")
    await writeFile(join(dir, "file.txt"), "content\n")
    const blob = git("hash-object", "-w", "file.txt")
    git("add", "file.txt")
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init")
    const commit = git("rev-parse", "HEAD")
    for (const since of ["0".repeat(40), blob, commit]) {
      const result = await takeRoundSnapshot({
        cwd: dir,
        since,
        timeoutMs: 10_000,
      })
      assert.ok(result.snapshot)
      assert.equal(result.changes, undefined)
      assert.match(result.error ?? "", /missing or is not a tree/)
    }
  })

  test("reports an error when Git cannot start", async () => {
    const result = await takeRoundSnapshot({
      cwd: join(dir, "missing"),
      timeoutMs: 10_000,
    })
    assert.equal(result.snapshot, undefined)
    assert.match(result.error ?? "", /ENOENT/)
  })

  test("reports a Git configuration error instead of treating it as no repository", async () => {
    git("init", "--quiet")
    git("config", "core.filemode", "bogus")
    const result = await takeRoundSnapshot({ cwd: dir, timeoutMs: 10_000 })
    assert.equal(result.snapshot, undefined)
    assert.match(result.error ?? "", /bad boolean config value/)
  })
})
