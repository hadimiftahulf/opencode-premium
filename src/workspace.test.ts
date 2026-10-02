import { expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { inspectWorkspace } from "./workspace"

test("discovers arbitrary child repositories including worktree git files and reports local changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-repos-"))
  const git = async (path: string, ...args: string[]) => {
    const child = Bun.spawn(["git", "-C", path, ...args], { stdout: "pipe", stderr: "pipe" })
    const [, error, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    if (exit) throw new Error(error)
  }
  try {
    const child = join(root, "services", "arbitrary app")
    await mkdir(child, { recursive: true })
    await git(child, "init", "-b", "test")
    await writeFile(join(child, "tracked.txt"), "old\n")
    await git(child, "add", "tracked.txt")
    await git(child, "-c", "user.name=Studio test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "fixture")
    await git(child, "mv", "tracked.txt", "renamed file.txt")
    await writeFile(join(child, "new file.txt"), "new\n")
    const worktree = join(root, "secondary")
    await git(child, "worktree", "add", "-b", "secondary", worktree)
    await mkdir(join(root, "node_modules", "ignored"), { recursive: true })
    await git(join(root, "node_modules", "ignored"), "init")
    await symlink(root, join(root, "recursive-link"))
    const scan = await inspectWorkspace(root)
    expect(scan.repos.map((repo) => repo.path).sort()).toEqual(["secondary", "services/arbitrary app"])
    const changed = scan.repos.find((repo) => repo.path === "services/arbitrary app")!
    expect(changed.error).toBeUndefined()
    expect(changed.files).toContainEqual({ status: "R ", path: "renamed file.txt" })
    expect(changed.files).toContainEqual({ status: "??", path: "new file.txt" })
    expect(scan.repos.find((repo) => repo.path === "secondary")?.files).toHaveLength(0)
    expect(scan.errors).toEqual([])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("reports unreadable root and respects cancellation", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-missing-"))
  await rm(root, { recursive: true })
  expect((await inspectWorkspace(root)).errors).toHaveLength(1)
  const controller = new AbortController()
  controller.abort()
  await expect(inspectWorkspace(root, controller.signal)).rejects.toThrow()
})
