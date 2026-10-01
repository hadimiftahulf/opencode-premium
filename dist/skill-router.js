// @bun
// src/skill-router.ts
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { createHash } from "crypto";
import { tool } from "@opencode-ai/plugin";
var marker = "[studio-skill-router:v1]";
var uiSkills = ["premium-fullstack-build", "emil-design-eng", "design-taste-frontend", "redesign-existing-projects"];
var reminder = `${marker}
Ikuti instruksi sistem dan AGENTS.md proyek yang berlaku. Bahasa pengguna: Indonesia kecuali diminta lain.
Sebelum bekerja, cocokkan skill dengan operasi nyata, bukan sekadar kata dalam riwayat. Skill di bawah dimuat dari berkas asli untuk request INI; jangan load ulang salinan yang sama. Baca referensi hanya jika fase pekerjaan memerlukannya.
Untuk UI: pahami alur dan audit sebelum edit; pertahankan aturan bisnis, aksesibilitas, keyboard, dan perilaku teruji. Terapkan prinsip yang relevan dengan platform (terminal bukan web).
Setelah kompresi gunakan keputusan, tujuan, kendala, dan bukti yang tersimpan; jangan mengarang bagian yang hilang. Baca ulang sumber bila diperlukan. Jangan salin isi skill ini ke ringkasan DCP, cukup nama/path dan keputusan tugas.
Jika tugas berganti atau routing keliru, gunakan studio_skill_route. Status routing tidak membuktikan model mengikuti aturan; tetap verifikasi hasil.`;
async function loadSkill(name) {
  const roots = [join(homedir(), ".agents/skills"), join(homedir(), ".config/opencode/skills")];
  for (const root of roots) {
    const path = join(root, name, "SKILL.md");
    try {
      return { path, text: await readFile(path, "utf8") };
    } catch (error) {
      if (error.code !== "ENOENT")
        throw error;
    }
  }
  throw new Error(`Skill wajib tidak ditemukan: ${name}. Periksa instalasi skill global.`);
}
function frontendEdit(name, args) {
  if (!/(^|[._-])(edit|write|apply_patch|patch|multiedit|edit_file|write_file)$/i.test(name))
    return false;
  const paths = [args.filePath, args.file_path, args.path].filter((value) => typeof value === "string");
  const patch = typeof args.patchText === "string" ? args.patchText : typeof args.patch === "string" ? args.patch : "";
  for (const match of patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm))
    paths.push(match[1]);
  if (Array.isArray(args.edits)) {
    for (const edit of args.edits)
      if (edit && typeof edit === "object") {
        for (const key of ["filePath", "file_path", "path"]) {
          const value = edit[key];
          if (typeof value === "string")
            paths.push(value);
        }
      }
  }
  return paths.some((path) => /\.(?:tsx|jsx|vue|svelte|astro|html|css|scss|sass|less)$/i.test(path) || /(?:^|[/\\])(?:components|pages|frontend|layouts)[/\\]/i.test(path));
}
function inferScope(text) {
  if (/\b(?:skill|router|routing|plugin|AGENTS\.md|dcp|context|konteks)\b/i.test(text) && !/\b(?:redesign|landing page|desain halaman)\b/i.test(text))
    return;
  if (/\b(?:frontend|ui\s*[/&-]?\s*ux|redesign|landing page|tampilan|layout|tipografi|avatar|komponen|dashboard)\b/i.test(text))
    return "ui";
  if (/\b(?:backend.only|backend saja|database|sql|migrasi|endpoint|api saja)\b/i.test(text))
    return "general";
  return;
}
function createSkillRouter(dependencies = { load: loadSkill }) {
  const sessions = new Map;
  const state = (id) => {
    const previous = sessions.get(id);
    if (previous)
      return previous;
    if (sessions.size >= 256)
      sessions.delete(sessions.keys().next().value);
    const value = { scope: "general", injected: "", reason: "Belum ada operasi UI terdeteksi", observed: false };
    sessions.set(id, value);
    return value;
  };
  const observe = (id, text) => {
    const current = state(id);
    current.observed = true;
    const scope = inferScope(text);
    if (scope && scope !== current.scope) {
      current.scope = scope;
      current.injected = "";
      current.reason = "Jenis operasi pada pesan pengguna";
    }
  };
  const bundle = async (scope) => {
    const names = scope === "ui" ? uiSkills : [];
    const sections = await Promise.all(names.map(async (name) => {
      const skill = await dependencies.load(name);
      if (!skill.text.trim())
        throw new Error(`Skill wajib kosong: ${name}`);
      return `
<studio-required-skill name="${name}">
Sumber: ${skill.path}
${skill.text}
</studio-required-skill>`;
    }));
    const text = [reminder, ...sections].join(`
`);
    if (text.length > 160000)
      throw new Error("Paket skill melampaui 160K karakter; periksa berkas skill, tidak dipotong diam-diam.");
    return { text, fingerprint: createHash("sha256").update(text).digest("hex") };
  };
  return {
    observe,
    hasObserved: (id) => state(id).observed,
    route(id, scope) {
      const current = state(id);
      current.scope = scope;
      current.observed = true;
      current.injected = "";
      current.reason = "Scope eksplisit studio_skill_route";
    },
    async inject(id, system) {
      const current = state(id);
      current.injected = "";
      const content = await bundle(current.scope);
      for (let index = system.length - 1;index >= 0; index--)
        if (system[index].startsWith(marker))
          system.splice(index, 1);
      system.push(content.text);
      current.injected = content.fingerprint;
    },
    async guard(id, name, args) {
      const current = state(id);
      const directEdit = frontendEdit(name, args);
      const shellDuringUi = current.scope === "ui" && /(^|[._-])(bash|shell)$/i.test(name);
      if (!directEdit && !shellDuringUi)
        return;
      if (current.scope !== "ui") {
        current.scope = "ui";
        current.injected = "";
        current.reason = "Target file frontend";
      }
      const content = await bundle("ui");
      if (current.injected !== content.fingerprint) {
        throw new Error("STUDIO_SKILL_GATE: edit frontend ditunda. Skill UI lengkap akan disisipkan pada request model berikutnya; baca instruksinya lalu ulangi edit. Jangan menghindari gate lewat shell atau tool lain.");
      }
    },
    status(id) {
      const current = state(id);
      return { scope: current.scope, skills: current.scope === "ui" ? uiSkills : [], injected: Boolean(current.injected), reason: current.reason };
    },
    forget: (id) => {
      sessions.delete(id);
    },
    dispose: () => {
      sessions.clear();
    }
  };
}
var skillRouterPlugin = async (context) => {
  const router = createSkillRouter();
  const hooks = {
    "chat.message": async (input, output) => {
      router.observe(input.sessionID, output.parts.filter((part) => part.type === "text").map((part) => part.text).join(`
`));
    },
    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID)
        return;
      if (!router.hasObserved(input.sessionID)) {
        const result = await context.client.session.messages({ path: { id: input.sessionID }, query: { limit: 20 } });
        if (result.error)
          throw new Error("Studio tidak dapat membaca intent sesi untuk memulihkan routing skill.");
        for (const message of result.data ?? []) {
          if (message.info.role === "user")
            router.observe(input.sessionID, message.parts.filter((part) => part.type === "text").map((part) => part.text).join(`
`));
        }
      }
      await router.inject(input.sessionID, output.system);
    },
    "tool.execute.before": async (input, output) => {
      await router.guard(input.sessionID, input.tool, output.args ?? {});
    },
    tool: {
      studio_skill_route: tool({
        description: "Select actual task scope or inspect automatic Studio skill routing. UI injects full mandatory skills next request. General removes UI-only skills for backend work. Never select general to bypass frontend checks.",
        args: { scope: tool.schema.enum(["ui", "general", "status"]) },
        async execute(args, context) {
          if (args.scope !== "status")
            router.route(context.sessionID, args.scope);
          return JSON.stringify(router.status(context.sessionID));
        }
      })
    },
    event: async ({ event }) => {
      if (event.type === "session.deleted")
        router.forget(event.properties.info.id);
    },
    dispose: async () => {
      router.dispose();
    }
  };
  return hooks;
};
var skill_router_default = { id: "saffteen-studio-skills", server: skillRouterPlugin };
export {
  createSkillRouter,
  skill_router_default as default,
  frontendEdit,
  inferScope,
  loadSkill,
  skillRouterPlugin
};
