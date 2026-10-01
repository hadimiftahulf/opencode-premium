import { describe, expect, test } from "bun:test"
import { createSkillRouter, frontendEdit, inferScope } from "./skill-router"

describe("request-scoped skill routing", () => {
  const make = () => createSkillRouter({ load: async (name) => ({ path: `/skills/${name}/SKILL.md`, text: `Full instructions for ${name}` }) })

  test("injects full UI sources on every request without growing the prompt", async () => {
    const router = make()
    router.observe("a", "rapihkan tampilan dashboard")
    const system = ["Host policy", "Project AGENTS.md"]
    await router.inject("a", system)
    const first = system.join("\n")
    await router.inject("a", system)
    expect(system.join("\n")).toBe(first)
    expect(system).toHaveLength(3)
    expect(first).toContain("Full instructions for emil-design-eng")
    expect(first).toContain("Full instructions for design-taste-frontend")
    expect(first).toContain("Full instructions for redesign-existing-projects")
    const afterDcp = ["Host policy", "Compressed history is elsewhere"]
    await router.inject("a", afterDcp)
    expect(afterDcp.join("\n")).toContain("Full instructions for emil-design-eng")
    await router.guard("a", "apply_patch", { patchText: "*** Update File: src/App.tsx\n@@\n-a\n+b" })
  })

  test("unknown UI edit blocks once then recovers next request; isolated sessions", async () => {
    const router = make()
    await expect(router.guard("a", "functions.apply_patch", { patchText: "*** Add File: src/App.tsx" })).rejects.toThrow("STUDIO_SKILL_GATE")
    expect(router.status("a").scope).toBe("ui")
    expect(router.status("b").scope).toBe("general")
    await router.inject("a", [])
    await router.guard("a", "edit", { filePath: "src/App.tsx" })
    await expect(router.guard("b", "write", { filePath: "src/App.tsx" })).rejects.toThrow("STUDIO_SKILL_GATE")
  })

  test("source changes and missing skills cannot silently authorize edits", async () => {
    let text = "version 1"
    const router = createSkillRouter({ load: async () => ({ path: "/skill", text }) })
    router.route("a", "ui")
    await router.inject("a", [])
    text = "version 2"
    await expect(router.guard("a", "edit", { path: "page.vue" })).rejects.toThrow("STUDIO_SKILL_GATE")
    await router.inject("a", [])
    await router.guard("a", "edit", { path: "page.vue" })
    text = ""
    await expect(router.inject("a", [])).rejects.toThrow("kosong")
    expect(router.status("a").injected).toBe(false)
  })

  test("backend switching drops UI pack and continuing retains scope", async () => {
    const router = make()
    router.observe("a", "redesign landing page")
    router.observe("a", "lanjut bang")
    expect(router.status("a").scope).toBe("ui")
    router.observe("a", "sekarang backend saja")
    const system: string[] = []
    await router.inject("a", system)
    expect(system.join("\n")).not.toContain("Full instructions")
    await router.guard("a", "edit", { path: "src/service.ts" })
    router.dispose()
    expect(router.status("a").injected).toBe(false)
  })

  test("routing distinguishes configuration discussion from UI operation", () => {
    expect(inferScope("buat skill router untuk frontend agar konteks aman")).toBeUndefined()
    expect(inferScope("redesign landing page")).toBe("ui")
    expect(frontendEdit("read", { filePath: "src/App.tsx" })).toBe(false)
    expect(frontendEdit("docker_write_file", { path: "styles.css" })).toBe(true)
    expect(frontendEdit("patch", { patch: "*** Move to: src/components/header.ts" })).toBe(true)
    expect(frontendEdit("write", { path: "src/server.ts" })).toBe(false)
  })

  test("UI shell calls wait for current skills and restart forgets authorization", async () => {
    const router = make()
    router.route("a", "ui")
    await expect(router.guard("a", "bash", { command: "python edit.py" })).rejects.toThrow("STUDIO_SKILL_GATE")
    await router.inject("a", [])
    await router.guard("a", "bash", { command: "python edit.py" })
    router.forget("a")
    await expect(router.guard("a", "edit", { filePath: "src/App.tsx" })).rejects.toThrow("STUDIO_SKILL_GATE")
  })
})
