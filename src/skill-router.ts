import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { tool, type Hooks, type Plugin } from "@opencode-ai/plugin"

const marker = "[studio-skill-router:v1]"
const uiSkills = ["premium-fullstack-build", "emil-design-eng", "design-taste-frontend", "redesign-existing-projects"]
const reminder = `${marker}
Ikuti instruksi sistem dan AGENTS.md proyek yang berlaku. Bahasa pengguna: Indonesia kecuali diminta lain.
Sebelum bekerja, cocokkan skill dengan operasi nyata, bukan sekadar kata dalam riwayat. Skill di bawah dimuat dari berkas asli untuk request INI; jangan load ulang salinan yang sama. Baca referensi hanya jika fase pekerjaan memerlukannya.
Untuk UI: pahami alur dan audit sebelum edit; pertahankan aturan bisnis, aksesibilitas, keyboard, dan perilaku teruji. Terapkan prinsip yang relevan dengan platform (terminal bukan web).
Setelah kompresi gunakan keputusan, tujuan, kendala, dan bukti yang tersimpan; jangan mengarang bagian yang hilang. Baca ulang sumber bila diperlukan. Jangan salin isi skill ini ke ringkasan DCP, cukup nama/path dan keputusan tugas.
Jika tugas berganti atau routing keliru, gunakan studio_skill_route. Status routing tidak membuktikan model mengikuti aturan; tetap verifikasi hasil.`

type Scope = "ui" | "general"
type State = { scope: Scope; injected: string; reason: string; observed: boolean }
type Dependencies = { load: (name: string) => Promise<{ path: string; text: string }> }

export async function loadSkill(name: string) {
  const roots = [join(homedir(), ".agents/skills"), join(homedir(), ".config/opencode/skills")]
  for (const root of roots) {
    const path = join(root, name, "SKILL.md")
    try {
      return { path, text: await readFile(path, "utf8") }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }
  throw new Error(`Skill wajib tidak ditemukan: ${name}. Periksa instalasi skill global.`)
}

export function frontendEdit(name: string, args: Record<string, unknown>) {
  if (!/(^|[._-])(edit|write|apply_patch|patch|multiedit|edit_file|write_file)$/i.test(name)) return false
  const paths = [args.filePath, args.file_path, args.path].filter((value): value is string => typeof value === "string")
  const patch = typeof args.patchText === "string" ? args.patchText : typeof args.patch === "string" ? args.patch : ""
  for (const match of patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)) paths.push(match[1])
  if (Array.isArray(args.edits)) {
    for (const edit of args.edits) if (edit && typeof edit === "object") {
      for (const key of ["filePath", "file_path", "path"]) {
        const value = (edit as Record<string, unknown>)[key]
        if (typeof value === "string") paths.push(value)
      }
    }
  }
  return paths.some((path) => /\.(?:tsx|jsx|vue|svelte|astro|html|css|scss|sass|less)$/i.test(path)
    || /(?:^|[/\\])(?:components|pages|frontend|layouts)[/\\]/i.test(path))
}

export function inferScope(text: string): Scope | undefined {
  if (/\b(?:skill|router|routing|plugin|AGENTS\.md|dcp|context|konteks)\b/i.test(text)
    && !/\b(?:redesign|landing page|desain halaman)\b/i.test(text)) return undefined
  if (/\b(?:frontend|ui\s*[/&-]?\s*ux|redesign|landing page|tampilan|layout|tipografi|avatar|komponen|dashboard)\b/i.test(text)) return "ui"
  if (/\b(?:backend.only|backend saja|database|sql|migrasi|endpoint|api saja)\b/i.test(text)) return "general"
  return undefined
}

export function createSkillRouter(dependencies: Dependencies = { load: loadSkill }) {
  const sessions = new Map<string, State>()
  const state = (id: string) => {
    const previous = sessions.get(id)
    if (previous) return previous
    if (sessions.size >= 256) sessions.delete(sessions.keys().next().value!)
    const value: State = { scope: "general", injected: "", reason: "Belum ada operasi UI terdeteksi", observed: false }
    sessions.set(id, value)
    return value
  }
  const observe = (id: string, text: string) => {
    const current = state(id)
    current.observed = true
    const scope = inferScope(text)
    if (scope && scope !== current.scope) {
      current.scope = scope
      current.injected = ""
      current.reason = "Jenis operasi pada pesan pengguna"
    }
  }
  const bundle = async (scope: Scope) => {
    const names = scope === "ui" ? uiSkills : []
    const sections = await Promise.all(names.map(async (name) => {
      const skill = await dependencies.load(name)
      if (!skill.text.trim()) throw new Error(`Skill wajib kosong: ${name}`)
      return `\n<studio-required-skill name="${name}">\nSumber: ${skill.path}\n${skill.text}\n</studio-required-skill>`
    }))
    const text = [reminder, ...sections].join("\n")
    if (text.length > 160000) throw new Error("Paket skill melampaui 160K karakter; periksa berkas skill, tidak dipotong diam-diam.")
    return { text, fingerprint: createHash("sha256").update(text).digest("hex") }
  }
  return {
    observe,
    hasObserved: (id: string) => state(id).observed,
    route(id: string, scope: Scope) {
      const current = state(id)
      current.scope = scope
      current.observed = true
      current.injected = ""
      current.reason = "Scope eksplisit studio_skill_route"
    },
    async inject(id: string, system: string[]) {
      const current = state(id)
      current.injected = ""
      const content = await bundle(current.scope)
      // Only replace our own standalone block, never host/project instructions.
      for (let index = system.length - 1; index >= 0; index--) if (system[index].startsWith(marker)) system.splice(index, 1)
      system.push(content.text)
      current.injected = content.fingerprint
    },
    async guard(id: string, name: string, args: Record<string, unknown>) {
      const current = state(id)
      const directEdit = frontendEdit(name, args)
      // Shell is opaque: while UI is active require the same loaded pack,
      // including commands that may use scripts to change frontend files.
      const shellDuringUi = current.scope === "ui" && /(^|[._-])(bash|shell)$/i.test(name)
      if (!directEdit && !shellDuringUi) return
      if (current.scope !== "ui") {
        current.scope = "ui"
        current.injected = ""
        current.reason = "Target file frontend"
      }
      const content = await bundle("ui")
      if (current.injected !== content.fingerprint) {
        throw new Error("STUDIO_SKILL_GATE: edit frontend ditunda. Skill UI lengkap akan disisipkan pada request model berikutnya; baca instruksinya lalu ulangi edit. Jangan menghindari gate lewat shell atau tool lain.")
      }
    },
    status(id: string) {
      const current = state(id)
      return { scope: current.scope, skills: current.scope === "ui" ? uiSkills : [], injected: Boolean(current.injected), reason: current.reason }
    },
    forget: (id: string) => { sessions.delete(id) },
    dispose: () => { sessions.clear() },
  }
}

export const skillRouterPlugin: Plugin = async (context) => {
  const router = createSkillRouter()
  const hooks: Hooks = {
    "chat.message": async (input, output) => {
      router.observe(input.sessionID, output.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n"))
    },
    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID) return
      if (!router.hasObserved(input.sessionID)) {
        const result = await context.client.session.messages({ path: { id: input.sessionID }, query: { limit: 20 } })
        if (result.error) throw new Error("Studio tidak dapat membaca intent sesi untuk memulihkan routing skill.")
        for (const message of result.data ?? []) {
          if (message.info.role === "user") router.observe(input.sessionID, message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n"))
        }
      }
      await router.inject(input.sessionID, output.system)
    },
    "tool.execute.before": async (input, output) => {
      await router.guard(input.sessionID, input.tool, output.args ?? {})
    },
    tool: {
      studio_skill_route: tool({
        description: "Select actual task scope or inspect automatic Studio skill routing. UI injects full mandatory skills next request. General removes UI-only skills for backend work. Never select general to bypass frontend checks.",
        args: { scope: tool.schema.enum(["ui", "general", "status"]) },
        async execute(args, context) {
          if (args.scope !== "status") router.route(context.sessionID, args.scope)
          return JSON.stringify(router.status(context.sessionID))
        },
      }),
    },
    event: async ({ event }) => {
      if (event.type === "session.deleted") router.forget(event.properties.info.id)
    },
    dispose: async () => { router.dispose() },
  }
  return hooks
}

export default { id: "saffteen-studio-skills", server: skillRouterPlugin }
