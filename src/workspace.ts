import { readdir } from "node:fs/promises"
import { join, relative } from "node:path"

const ignored = new Set(["node_modules", ".git", ".next", ".cache", "vendor", "dist", "build", ".venv", "Pods"])
export async function inspectWorkspace(root: string, signal?: AbortSignal) {
  const repos: { path: string; branch: string; files: { status: string; path: string }[]; error?: string }[] = []
  const queue = [{ path: root, depth: 0 }]
  let visited = 0
  let depthLimited = false
  const errors: string[] = []
  while (queue.length && visited < 300) {
    signal?.throwIfAborted()
    const current = queue.shift()!
    visited++
    let entries
    try { entries = await readdir(current.path, { withFileTypes: true }) }
    catch { errors.push(`Tidak dapat membaca ${relative(root, current.path) || "."}`); continue }
    if (entries.some((entry) => entry.name === ".git")) {
      const child = Bun.spawn(["git", "-C", current.path, "status", "--porcelain=v1", "-z", "--branch", "--untracked-files=normal"], { stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } })
      const abort = () => { child.kill() }
      signal?.addEventListener("abort", abort, { once: true })
      const timeout = setTimeout(() => child.kill(), 5000)
      try {
        const [output, , exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
        const records = output.split("\0")
        const branch = records.shift()?.replace(/^## /, "") ?? ""
        const files: { status: string; path: string }[] = []
        for (let i = 0; i < records.length; i++) {
          const record = records[i]
          if (!record) continue
          files.push({ status: record.slice(0, 2), path: record.slice(3) })
          if (/[RC]/.test(record.slice(0, 2))) i++
        }
        repos.push({ path: relative(root, current.path) || ".", branch, files, ...(exit !== 0 ? { error: "Git tidak tersedia, gagal, atau melewati batas waktu" } : {}) })
      } finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort) }
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink() && !ignored.has(entry.name) && !entry.name.startsWith(".")) {
        if (current.depth < 4) queue.push({ path: join(current.path, entry.name), depth: current.depth + 1 })
        else depthLimited = true
      }
    }
  }
  return { repos, errors, limited: queue.length > 0 || depthLimited, visited }
}
