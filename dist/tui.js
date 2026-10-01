// @bun
// src/tui.tsx
import { memo as _$memo } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, untrack } from "solid-js";

// src/model.ts
function activityDetail(tool) {
  const input = tool.state.input;
  const clean = (value) => typeof value === "string" ? value.split("").map((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159 ? " " : char).join("").replace(/(?:Bearer\s+\S+|(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+)/gi, "[disamarkan]").replace(/\s+/g, " ").trim().slice(0, 120) : "";
  const labels = { read: "Membaca berkas", edit: "Mengubah berkas", write: "Menulis berkas", glob: "Mencari berkas", grep: "Menelusuri kode", search: "Mencari informasi", bash: "Menjalankan perintah", task: "Delegasi agent", subagent: "Delegasi agent" };
  const action = labels[tool.tool] ?? clean(tool.tool);
  const target = clean(input.description) || clean(input.filePath ?? input.file_path ?? input.path) || clean(input.title);
  const status = { pending: "Antre", running: "Berjalan", completed: "Selesai", error: "Gagal" }[tool.state.status];
  const background = tool.state.status === "completed" && tool.state.metadata.background === true;
  const duration = tool.state.status === "completed" || tool.state.status === "error" ? ` \xB7 ${Math.max(0, (tool.state.time.end - tool.state.time.start) / 1000).toFixed(1)} dtk` : "";
  const result = tool.state.status === "error" ? "Periksa detail kegagalan di percakapan." : background ? "Peluncuran selesai; status anak dipantau terpisah." : tool.state.status === "completed" ? `Tool selesai${duration}.` : "";
  return { action, target, status: background ? "Diluncurkan" : status, result };
}
function compact(value) {
  if (!Number.isFinite(value) || value < 0)
    return "\u2014";
  return Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}
function sessionMetrics(api, id) {
  const messages = api.state.session.messages(id);
  const latest = [...messages].reverse().find((message) => message.role === "assistant");
  const model = latest?.role === "assistant" ? latest.modelID : undefined;
  const provider = latest?.role === "assistant" ? latest.providerID : undefined;
  const reported = [...messages].reverse().find((message) => message.role === "assistant" && message.modelID === model && message.providerID === provider && [message.tokens.input, message.tokens.output, message.tokens.reasoning, message.tokens.cache.read, message.tokens.cache.write].some((value) => Number.isFinite(value) && value > 0));
  const tokens = reported?.role === "assistant" ? reported.tokens : undefined;
  const used = tokens ? [tokens.input, tokens.output, tokens.reasoning, tokens.cache.read, tokens.cache.write].reduce((sum, value) => sum + (Number.isFinite(value) && value > 0 ? value : 0), 0) : undefined;
  const limit = api.state.provider.find((item) => item.id === provider)?.models[model ?? ""]?.limit.context;
  return {
    model: model ?? "Menunggu respons",
    provider: provider ?? "Belum ada penggunaan",
    agent: latest?.role === "assistant" ? latest.agent : undefined,
    used,
    percent: used !== undefined && limit && limit > 0 ? Math.round(used / limit * 100) : undefined,
    cost: messages.reduce((total, message) => total + (message.role === "assistant" ? message.cost : 0), 0)
  };
}
function sidebarActivity(api, id) {
  const tools = api.state.session.messages(id).flatMap((message) => api.state.part(message.id).filter((part) => part.type === "tool"));
  const servers = [...api.state.mcp()].sort((a, b) => b.name.length - a.name.length);
  const active = tools.filter((tool) => tool.state.status === "running" || tool.state.status === "pending");
  const mcpName = (name) => servers.find((server) => {
    const key = server.name.replace(/[^a-zA-Z0-9_-]/g, "_");
    return [server.name, key].some((prefix) => name.startsWith(`${prefix}_`) || name.startsWith(`${prefix}-`));
  })?.name;
  const mcp = servers.flatMap((server) => {
    const calls = active.filter((tool) => mcpName(tool.tool) === server.name);
    return calls.length ? [{ name: server.name, calls }] : [];
  });
  const agents = tools.filter((tool) => tool.tool === "task" || tool.tool === "subagent").flatMap((tool) => {
    const metadata = tool.state.status === "pending" ? undefined : tool.state.metadata;
    const child = typeof metadata?.sessionId === "string" ? metadata.sessionId : undefined;
    const status = child ? api.state.session.status(child) : undefined;
    const waiting = child ? api.state.session.permission(child).length + api.state.session.question(child).length : 0;
    const running = status ? status.type !== "idle" : tool.state.status === "running" || tool.state.status === "pending";
    if (!running && !waiting)
      return [];
    return [{
      id: child ?? tool.callID,
      name: typeof tool.state.input.subagent_type === "string" ? tool.state.input.subagent_type : "subagent",
      label: waiting ? "Menunggu jawaban" : status?.type === "retry" ? "Mencoba ulang" : "Bekerja",
      target: activityDetail(tool).target
    }];
  }).filter((agent, index, list) => list.findIndex((item) => item.id === agent.id) === index);
  const todos = api.state.session.todo(id);
  return {
    mcp,
    latest: tools.at(-1),
    current: active.at(-1),
    agents,
    tools: active.filter((tool) => !mcpName(tool.tool) && tool.tool !== "task" && tool.tool !== "subagent"),
    todos: todos.filter((todo) => todo.status === "in_progress" || todo.status === "pending").sort((a, b) => Number(b.status === "in_progress") - Number(a.status === "in_progress")),
    completed: todos.filter((todo) => todo.status === "completed").length,
    total: todos.length,
    attention: api.state.session.permission(id).length + api.state.session.question(id).length,
    status: api.state.session.status(id)
  };
}
function avatarState(activity, compacting = false) {
  const state = (pose, label, moving = false) => ({ pose, label, moving });
  if (activity.attention)
    return state("wait", "Menunggu jawaban");
  if (compacting)
    return state("compact", "Meringkas konteks", true);
  if (activity.status?.type === "retry")
    return state("wait", "Mencoba ulang");
  if (activity.current?.state.status === "pending")
    return state("wait", "Menunggu tool");
  if (activity.current) {
    if (activity.mcp.some((server) => server.calls.some((call) => call.callID === activity.current?.callID)))
      return state("connect", "Mengakses MCP", true);
    const name = activity.current.tool.toLowerCase();
    if (/^(read|glob|grep|search|list|webfetch)$/.test(name))
      return state("read", "Menelusuri", true);
    if (/^(edit|write|apply_patch|multiedit)$/.test(name))
      return state("write", "Menyusun kode", true);
    if (/^(task|subagent)$/.test(name))
      return state("delegate-wait", "Menunggu hasil subagent", true);
    return state("run", "Menjalankan tool", true);
  }
  if (activity.agents.length)
    return state("delegate-wait", `Menunggu ${activity.agents.length} subagent`, true);
  if (activity.status?.type === "busy")
    return state("run", "Memproses respons", true);
  if (activity.latest?.state.status === "error")
    return state("error", "Tool terakhir gagal");
  if (activity.latest)
    return state("done", "Selesai \xB7 istirahat dulu");
  return state("idle", "Santai \xB7 rehat dulu");
}
var avatarPalette = {
  hair: "#c8d3df",
  hairLight: "#edf3fa",
  hairEdge: "#93a5ba",
  trim: "#20272b",
  trimLight: "#374347",
  skin: "#d6a17d",
  skinLight: "#efc49b",
  skinShade: "#aa735e",
  ink: "#20292d",
  shirt: "#526b6c",
  shirtLight: "#78918d",
  shirtShade: "#455c60",
  chair: "#243246",
  chairEdge: "#456078",
  accent: "#9cdec5",
  keyboard: "#a6b8c2",
  keys: "#e2e9e4",
  keyShade: "#536773",
  shadow: "#25363b",
  metal: "#869ca5",
  paperShade: "#bbc7cb",
  amber: "#edcd96",
  red: "#f29b9b",
  coffee: "#69442e",
  smoke: "#b8c6c4",
  lens: "#7ebbc6"
};
function avatarFrame(pose, frame) {
  const cycle = Number.isFinite(frame) ? Math.abs(Math.floor(frame)) % 24 : 0;
  const phase = cycle % 4;
  const smoking = cycle >= 16;
  const pixels = Array.from({ length: 28 }, () => Array(28).fill(undefined));
  const paint = (x, y, width, height, color) => {
    for (let row = y;row < y + height; row++)
      for (let col = x;col < x + width; col++)
        if (pixels[row] && col >= 0 && col < 28)
          pixels[row][col] = avatarPalette[color];
  };
  const hair = (x, y, profile) => {
    const rows = profile ? [
      "  hhhh   ",
      " hlllhhh ",
      "hhhhhlhhh",
      "shhhhh hh",
      "sshhhh h ",
      " sshss   ",
      "  sss    "
    ] : [
      "   hhhhhh   ",
      " hhhllllhhh ",
      "hhhhhhhlhhhh",
      "shhhh  hhhhs",
      "shh     hhss",
      " s     hh s ",
      " s        s "
    ];
    rows.forEach((row, dy) => [...row].forEach((pixel, dx) => {
      if (pixel !== " ")
        paint(x + dx, y + dy, 1, 1, pixel === "l" ? "hairLight" : pixel === "s" ? "hairEdge" : "hair");
    }));
  };
  const head = (dx, dy, working = false) => {
    const p = (x, y, w, h, color) => paint(x + dx, y + dy, w, h, color);
    p(9, 4, 10, 8, "skinShade");
    p(12, 4, 4, 2, "skinLight");
    p(10, 5, 8, 7, "skin");
    p(10, 6, 6, 4, "skinLight");
    p(17, 6, 1, 6, "skinShade");
    p(10, 11, 8, 2, "skinShade");
    p(11, 12, 6, 1, "trimLight");
    p(12, 12, 4, 1, "trim");
    hair(8 + dx, 1 + dy, false);
    p(10, 7, 3, 1, "trim");
    p(15, 7, 3, 1, "trim");
    const gaze = working ? 1 : 0;
    p(10 + gaze, 8, 2, phase === 2 ? 1 : 2, "ink");
    p(15 + gaze, 8, 2, phase === 2 ? 1 : 2, "ink");
    if (phase !== 2) {
      p(10 + gaze, 8, 1, 1, "keys");
      p(15 + gaze, 8, 1, 1, "keys");
    }
    p(13, 10, 1, 1, "skinShade");
    p(13, 11, pose === "done" ? 3 : 2, 1, "trimLight");
  };
  if (pose === "compact") {
    paint(2, 27, 25, 1, "shadow");
    paint(5, 20, 3, 6, "chairEdge");
    paint(10, 20, 3, 6, "chair");
    paint(5, 21, 1, 4, "metal");
    paint(10, 21, 1, 4, "keyShade");
    paint(4, 26, 4, 1, "trimLight");
    paint(10, 26, 5, 1, "trimLight");
    paint(5, 14, 8, 6, "shirt");
    paint(5, 15, 1, 4, "shirtLight");
    paint(12, 15, 1, 5, "shirtShade");
    paint(5, 20, 8, 1, "shirtShade");
    paint(5, 13, 8, 2, "shirtLight");
    paint(7, 14, 4, 1, "shirtShade");
    head(-6, 0, true);
    paint(7, 15, 1, 3, "accent");
    paint(10, 15, 1, 3, "accent");
    paint(20, 19, 6, 7, "keyShade");
    paint(20, 18, 6, 2, "ink");
    paint(19, 18, 8, 1, "shirtLight");
    paint(21, 19, 4, 1, "trim");
    paint(21, 20, 1, 5, "shirtLight");
    paint(24, 20, 1, 5, "shirtShade");
    const step = cycle % 12;
    const arm = (joints, light) => {
      for (let i = 1;i < joints.length; i++) {
        const [ax, ay] = joints[i - 1];
        const [bx, by] = joints[i];
        const distance = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
        for (let t = 0;t <= distance; t++) {
          const x = Math.round(ax + (bx - ax) * t / distance);
          const y = Math.round(ay + (by - ay) * t / distance);
          paint(x, y, 2, 2, "shirtShade");
          paint(x, y, 2, 1, light ? "shirtLight" : "shirt");
        }
      }
    };
    const wrist = step < 3 ? [14, 16] : step < 5 ? [14, 12] : step < 8 ? [16, 13] : [14, 17];
    arm([[12, 14], [14, 15], wrist], false);
    paint(wrist[0] + 1, wrist[1], 2, 2, "skinLight");
    if (step < 3) {
      arm([[3, 14], [3, 19], [11, 18]], true);
      paint(12, 18, 2, 2, "skin");
    } else {
      arm([[3, 14], [2, 17], [3, 20]], true);
      paint(3, 21, 2, 2, "skinLight");
    }
    if (cycle >= 12) {
      paint(21, 20, 3, 2, "keys");
      paint(23, 21, 2, 1, "paperShade");
    }
    if (step < 3) {
      paint(14, 17, 4 - step, 3 - Math.floor(step / 2), "keys");
      paint(15, 18, 1, 1, "paperShade");
    } else if (step < 5) {
      paint(16, 11, 2, 2, "keys");
      paint(17, 12, 1, 1, "paperShade");
    } else if (step < 10) {
      const path = [[18, 10], [21, 8], [23, 10], [23, 13], [23, 16]];
      const [x, y] = path[step - 5];
      paint(x, y, 2, 2, "keys");
      paint(x + 1, y + 1, 1, 1, "keyShade");
    } else {
      paint(22, 19 + (step === 10 ? 0 : 1), 3, 1, "keys");
      paint(23, 20, 1, 1, "paperShade");
    }
    return pixels;
  }
  if (["read", "write", "run", "connect", "delegate", "delegate-wait"].includes(pose)) {
    paint(2, 25, 24, 2, "shadow");
    paint(16, 4, 11, 11, "trimLight");
    paint(17, 5, 9, 9, "ink");
    paint(26, 5, 1, 10, "trim");
    paint(17, 14, 9, 1, "trimLight");
    paint(24, 14, 1, 1, "accent");
    paint(20, 15, 2, 3, "keyShade");
    paint(18, 18, 7, 1, "metal");
    paint(20, 15, 1, 3, "metal");
    if (pose === "read") {
      paint(17, 5, 6, 1, "lens");
      for (let row = 0;row < 3; row++) {
        paint(17, 7 + row * 2, 1, 1, row === phase % 3 ? "accent" : "keyShade");
        paint(19, 7 + row * 2, row === phase % 3 ? 4 : 3, 1, row === phase % 3 ? "keys" : "lens");
      }
      paint(23, 8 + phase, 1, 1, "keys");
    } else if (pose === "write") {
      for (let row = 0;row < 3; row++) {
        paint(17, 6 + row * 2, 1, 1, "accent");
        paint(19, 6 + row * 2, row === 2 ? 1 + phase : 4, 1, row === 1 ? "lens" : "keys");
      }
      paint(20 + phase, 11, 1, 1, "accent");
    } else if (pose === "run") {
      paint(17, 6, 1, 1, "accent");
      paint(18, 7, 1, 1, "accent");
      paint(17, 8, 1, 1, "accent");
      paint(20, 8, 1 + phase, 1, "keys");
      paint(17, 11, 6, 1, "keyShade");
      paint(17, 11, 1 + phase, 1, "accent");
    } else if (pose === "connect") {
      paint(17, 6, 2, 2, "lens");
      paint(22, 10, 2, 2, "accent");
      paint(18, 8, 1, 3, "keyShade");
      paint(18, 10, 4, 1, "keyShade");
      paint(18 + phase, 10, 1, 1, "keys");
    } else if (pose === "delegate-wait") {
      paint(18, 6, 5, 1, "amber");
      paint(19, 7, 3, 1, "lens");
      paint(20, 8, 1, 2, "amber");
      paint(19, 10, 3, 1, "lens");
      paint(18, 11, 5, 1, "amber");
      paint(19 + phase % 3, 12, 1, 1, "keys");
    } else {
      paint(20, 5, 2, 2, "accent");
      paint(20, 7, 1, 3, "lens");
      paint(17, 9, 7, 1, "lens");
      for (let node = 0;node < 3; node++)
        paint(17 + node * 3, 11, 1, 2, node === phase % 3 ? "keys" : "accent");
    }
    paint(0, 12, 4, 10, "chair");
    paint(1, 10, 3, 3, "chair");
    paint(1, 11, 2, 1, "chairEdge");
    paint(0, 13, 1, 8, "chairEdge");
    paint(1, 14, 1, 3, "accent");
    paint(0, 21, 3, 2, "chairEdge");
    paint(2, 23, 10, 1, "chair");
    paint(2, 24, 3, 1, "chairEdge");
    paint(5, 24, 1, 3, "keyShade");
    paint(2, 27, 8, 1, "chairEdge");
    paint(7, 22, 3, 4, "ink");
    paint(11, 22, 3, 4, "trimLight");
    paint(7, 26, 4, 1, "trim");
    paint(11, 26, 4, 1, "trim");
    paint(5, 15, 7, 8, "shirt");
    paint(4, 16, 1, 6, "shirtLight");
    paint(11, 17, 1, 5, "shirtShade");
    paint(6, 13, 5, 2, "skinShade");
    paint(4, 14, 9, 1, "shirtLight");
    paint(5, 15, 7, 1, "keyShade");
    paint(6, 16, 1, 2, "shirtLight");
    paint(10, 16, 1, 2, "shirtLight");
    head(-6, 1, true);
    paint(13, 20, 11, 2, "keyboard");
    for (let key = 0;key < 5; key++)
      paint(14 + key * 2, 20, 1, 1, "keys");
    paint(16, 21, 5, 1, "keys");
    paint(25, 19, 3, 3, "trim");
    paint(26, 18, 1, 1, "keyboard");
    paint(25, 19, 3, 2, "keyboard");
    paint(26, 19, 1, 1, "ink");
    paint(26, 21, 1, 1, "keyShade");
    paint(12, 22, 16, 1, "metal");
    paint(12, 23, 16, 1, "trimLight");
    paint(16, 24, 1, 3, "trimLight");
    paint(26, 24, 1, 3, "trimLight");
    const leftTap = pose === "write" && !smoking ? phase % 2 : 0;
    const rightTap = pose === "write" && !smoking ? (phase + 1) % 2 : 0;
    const sleeve = (joints, near) => {
      const path = [];
      for (let i = 1;i < joints.length; i++) {
        const [ax, ay] = joints[i - 1];
        const [bx, by] = joints[i];
        const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
        for (let t = 0;t <= steps; t++)
          path.push([
            Math.round(ax + (bx - ax) * t / Math.max(1, steps)),
            Math.round(ay + (by - ay) * t / Math.max(1, steps))
          ]);
      }
      for (const [x, y] of path)
        paint(x - 1, y - 1, 3, 3, "shirtShade");
      for (const [x, y] of path)
        paint(x - 1, y - 1, 3, 2, "shirt");
      if (near)
        for (const [x, y] of path)
          paint(x - 1, y - 1, 1, 1, "shirtLight");
      const [x, y] = joints[joints.length - 1];
      paint(x, y - 1, 1, 2, "shirtLight");
    };
    const palm = (x, y) => {
      paint(x, y - 1, 3, 2, "skin");
      paint(x, y - 1, 2, 1, "skinLight");
      paint(x + 2, y, 1, 1, "skinShade");
    };
    const rightX = pose === "write" ? 19 : 23;
    if (!smoking) {
      sleeve([[11, 16], [14, 18], [rightX - 1, 19 + rightTap]], false);
      palm(rightX, 19 + rightTap);
    } else if (cycle < 20) {
      sleeve([[11, 16], [14, 17], [12, 14]], false);
      palm(11, 13);
    } else {
      sleeve([[11, 16], [14, 18], [16, 18]], false);
      palm(17, 18);
    }
    sleeve([[5, 16], [6, 20], [13, 19 + leftTap]], true);
    palm(14, 19 + leftTap);
    paint(14, 21, 10, 1, "keyboard");
    paint(16, 21, 5, 1, "keys");
    if (smoking) {
      if (cycle < 20) {
        paint(9, 12, 4, 1, "keys");
        paint(13, 12, 1, 1, "amber");
      } else {
        paint(19, 17, 2, 1, "keys");
        paint(21, 17, 1, 1, "amber");
        paint(9, 12, 4, 2, "smoke");
        paint(12, 10 - phase % 2, 4, 3, "smoke");
        paint(15, 7 - phase % 2, 5, 4, "smoke");
        paint(18, 4 - phase % 2, 4, 3, "smoke");
      }
    }
    return pixels;
  }
  paint(5, 25, 20, 2, "shadow");
  paint(6, 14, 16, 10, "shirtShade");
  paint(5, 16, 16, 7, "shirt");
  paint(6, 16, 3, 5, "shirtLight");
  paint(18, 15, 4, 8, "shirtShade");
  paint(11, 12, 6, 4, "skinShade");
  paint(11, 13, 5, 2, "skin");
  paint(8, 13, 12, 3, "shirtLight");
  paint(9, 14, 10, 3, "shirtShade");
  paint(8, 15, 2, 2, "shirtLight");
  paint(18, 15, 2, 2, "shirtLight");
  head(0, 0);
  paint(9, 14, 3, 2, "shirtLight");
  paint(16, 14, 3, 2, "shirt");
  paint(11, 16, 1, 4, "accent");
  paint(17, 16, 1, 4, "accent");
  paint(14, 16, 1, 4, "shirtShade");
  paint(19, 17, 2, 1, "accent");
  paint(7, 18, 1, 4, "shirtShade");
  paint(10, 20, 7, 1, "trim");
  paint(10, 21, 1, 2, "shirtLight");
  paint(16, 21, 1, 2, "shirtShade");
  paint(7, 23, 12, 1, "trimLight");
  if (pose === "error") {
    paint(10, 7, 2, 1, "trim");
    paint(15, 7, 2, 1, "trim");
  }
  if (pose === "idle" || pose === "done") {
    const inhale = phase < 2;
    paint(5, 18, 5, 4, "shirtLight");
    paint(8, 21, 4, 2, "skin");
    paint(18, inhale ? 13 : 17, 4, 5, "shirt");
    paint(inhale ? 16 : 20, inhale ? 12 : 17, 3, 2, "skinLight");
    paint(inhale ? 15 : 22, inhale ? 11 : 16, 4, 1, "keys");
    paint(inhale ? 19 : 26, inhale ? 11 : 16, 1, 1, phase === 1 ? "red" : "amber");
    if (!inhale) {
      paint(15, 11, 4, 2, "smoke");
      paint(18, 9, 4, 3, "smoke");
      paint(21, 6 - (phase - 2), 5, 4, "smoke");
      paint(23, 3 - (phase - 2), 4, 4, "smoke");
    }
    paint(10, 22, 9, 2, "shirtShade");
    return pixels;
  }
  if (pose === "wait" || pose === "error") {
    paint(6, 19, 13, 3, "shirtLight");
    paint(16, 15, 3, 6, "shirt");
    paint(14, 13, 4, 3, "skinLight");
    paint(8, 20, 4, 2, "skin");
    paint(23, 7, 1, 4, pose === "error" ? "red" : "amber");
    paint(23, 12 + phase % 2, 1, 1, pose === "error" ? "red" : "amber");
    return pixels;
  }
  return pixels;
}

// src/tui.tsx
function retainActivity(source, key, session, delay = 4000) {
  const [rows, setRows] = createSignal([]);
  let scope = session();
  createEffect(() => {
    const id = session();
    const items = source();
    const now = Date.now();
    const previous = id === scope ? untrack(rows) : [];
    scope = id;
    const keys = new Set(items.map(key));
    setRows([...items.map((item) => ({
      item
    })), ...previous.filter((row) => !keys.has(key(row.item))).map((row) => ({
      ...row,
      ended: row.ended ?? now
    })).filter((row) => now - row.ended < delay)]);
  });
  createEffect(() => {
    const deadlines = rows().flatMap((row) => row.ended === undefined ? [] : [row.ended + delay]);
    if (!deadlines.length)
      return;
    const timer = setTimeout(() => setRows((previous) => previous.filter((row) => row.ended === undefined || Date.now() < row.ended + delay)), Math.max(0, Math.min(...deadlines) - Date.now()));
    onCleanup(() => clearTimeout(timer));
  });
  return rows;
}
async function desktopNotification(input) {
  const {
    default: notifier
  } = await import("node-notifier");
  await new Promise((resolve, reject) => {
    notifier.notify({
      ...input,
      sound: false,
      timeout: 10
    }, (error) => error ? reject(error) : resolve());
  });
}
function visualFeedback(api, send = desktopNotification) {
  let disposed = false;
  let warned = false;
  const desktop = async (title, message, test = false) => {
    try {
      await send({
        title,
        message
      });
      if (test && !disposed)
        api.ui.toast({
          variant: "info",
          message: "Permintaan notifikasi dikirim ke OS. Periksa banner dan izin notifikasi desktop."
        });
    } catch {
      if (!disposed && (!warned || test))
        api.ui.toast({
          variant: "warning",
          message: "Notifikasi desktop gagal dikirim. Periksa izin OS; Linux memerlukan notify-send dan sesi desktop."
        });
      warned = true;
    }
  };
  const seen = new Set;
  const busy = new Set;
  const show = (key, title, message, variant, duration = 6000) => {
    if (seen.has(key))
      return;
    seen.add(key);
    if (seen.size > 128)
      seen.delete(seen.values().next().value);
    api.ui.toast({
      title,
      message,
      variant,
      duration
    });
    desktop(title, message);
  };
  const off = [api.event.on("permission.asked", ({
    properties
  }) => show(`permission:${properties.sessionID}:${properties.id}`, "Studio \xB7 Izin diperlukan", "Tinjau permintaan di dialog izin sesi terkait. Belum ada izin diberikan.", "warning", 1e4)), api.event.on("question.asked", ({
    properties
  }) => show(`question:${properties.sessionID}:${properties.id}`, "Studio \xB7 Ada pertanyaan", "AI menunggu pilihan atau jawaban kamu. Buka dialog pertanyaan sesi terkait.", "info", 1e4)), api.event.on("permission.replied", ({
    properties
  }) => show(`permission-reply:${properties.sessionID}:${properties.requestID}`, "Studio \xB7 Keputusan izin", properties.reply === "reject" ? "Permintaan izin ditolak." : "Izin diberikan sesuai pilihan kamu.", properties.reply === "reject" ? "warning" : "success")), api.event.on("question.replied", ({
    properties
  }) => show(`question-reply:${properties.sessionID}:${properties.requestID}`, "Studio \xB7 Jawaban diterima", "Pilihan kamu sudah dikirim ke AI.", "success")), api.event.on("question.rejected", ({
    properties
  }) => show(`question-reply:${properties.sessionID}:${properties.requestID}`, "Studio \xB7 Pertanyaan dibatalkan", "Dialog pertanyaan telah ditutup tanpa jawaban.", "info")), api.event.on("session.status", ({
    properties
  }) => {
    if (properties.status.type !== "idle") {
      busy.add(properties.sessionID);
      return;
    }
    if (!busy.delete(properties.sessionID))
      return;
    api.ui.toast({
      title: "Studio \xB7 Respons siap",
      message: "AI selesai merespons. Periksa hasil atau saran di percakapan.",
      variant: "info",
      duration: 6000
    });
    desktop("Studio \xB7 Respons siap", "AI selesai merespons. Periksa hasil atau saran di percakapan.");
  }), api.event.on("session.error", ({
    properties
  }) => {
    if (properties.sessionID)
      busy.delete(properties.sessionID);
    api.ui.toast({
      title: "Studio \xB7 Ada kendala",
      message: "Periksa pesan error di percakapan untuk langkah berikutnya.",
      variant: "error",
      duration: 1e4
    });
    desktop("Studio \xB7 Ada kendala", "Periksa pesan error di percakapan untuk langkah berikutnya.");
  })];
  const command = api.command?.register(() => [{
    title: "Studio: tes popup notifikasi",
    value: "studio.popup.test",
    category: "Studio",
    slash: {
      name: "studio-popup-test"
    },
    onSelect: (dialog) => {
      dialog?.clear();
      api.ui.toast({
        title: "Studio \xB7 Popup aktif",
        message: "Notifikasi visual tetap terlihat meski suara tidak terdengar.",
        variant: "info",
        duration: 1e4
      });
    }
  }, {
    title: "Studio: tes notifikasi desktop",
    value: "studio.desktop.test",
    category: "Studio",
    slash: {
      name: "studio-desktop-test"
    },
    onSelect: async (dialog) => {
      dialog?.clear();
      await desktop("Studio \xB7 Tes desktop", "Notifikasi ini dikirim ke desktop, bukan hanya terminal.", true);
    }
  }]);
  api.lifecycle.onDispose(() => {
    disposed = true;
    off.forEach((dispose) => dispose());
    command?.();
    seen.clear();
    busy.clear();
  });
}
function attentionFeedback(api) {
  const seen = new Set;
  let warned = false;
  const play = async (name, message, test = false) => {
    try {
      const result = await api.attention.notify({
        message,
        notification: false,
        sound: {
          name,
          when: "always"
        }
      });
      if (test || !result.sound && !warned) {
        warned = !result.sound;
        api.ui.toast({
          variant: result.sound ? "info" : "warning",
          message: result.sound ? "Pemutar menerima suara. Pastikan terdengar di perangkat keluaran kamu." : `Suara tidak diputar (${result.skipped ?? "periksa pengaturan audio"}).`
        });
      }
    } catch {
      if (!warned)
        api.ui.toast({
          variant: "warning",
          message: "Pemutar suara gagal. Periksa pengaturan audio."
        });
      warned = true;
    }
  };
  const reply = (key, rejected, message) => {
    if (seen.has(key))
      return;
    seen.add(key);
    if (seen.size > 128)
      seen.delete(seen.values().next().value);
    play(rejected ? "error" : "default", message);
  };
  const off = [api.event.on("permission.replied", (event) => reply(`permission:${event.properties.sessionID}:${event.properties.requestID}`, event.properties.reply === "reject", event.properties.reply === "reject" ? "Izin ditolak" : "Izin diberikan")), api.event.on("question.replied", (event) => reply(`question:${event.properties.sessionID}:${event.properties.requestID}`, false, "Jawaban diterima")), api.event.on("question.rejected", (event) => reply(`question:${event.properties.sessionID}:${event.properties.requestID}`, true, "Pertanyaan dibatalkan"))];
  const command = api.command?.register(() => [{
    title: "Studio: tes suara perhatian",
    value: "studio.sound.test",
    category: "Studio",
    slash: {
      name: "studio-sound-test"
    },
    onSelect: async (dialog) => {
      dialog?.clear();
      await play("question", "Tes suara pertanyaan", true);
    }
  }]);
  api.lifecycle.onDispose(() => {
    off.forEach((dispose) => dispose());
    command?.();
    seen.clear();
  });
}
function compactionMonitor(api) {
  const [tools, setTools] = createSignal({});
  const [sessions, setSessions] = createSignal({});
  const clearTools = (id) => setTools((previous) => Object.fromEntries(Object.entries(previous).filter(([, session]) => session !== id)));
  const clear = (id, message) => setSessions((previous) => {
    if (message && previous[id] !== message)
      return previous;
    const next = {
      ...previous
    };
    delete next[id];
    return next;
  });
  const off = [api.event.on("session.next.compaction.started", (event) => setSessions((previous) => ({
    ...previous,
    [event.properties.sessionID]: event.properties.messageID
  }))), api.event.on("session.next.compaction.ended", (event) => clear(event.properties.sessionID, event.properties.messageID)), api.event.on("session.compacted", (event) => clear(event.properties.sessionID)), api.event.on("message.part.updated", ({
    properties
  }) => {
    const part = properties.part;
    if (part.type !== "tool" || !/(^|[._-])(compress|compact|prune)$/.test(part.tool))
      return;
    const key = `${part.sessionID}:${part.callID}`;
    setTools((previous) => {
      const next = {
        ...previous
      };
      if (part.state.status === "pending" || part.state.status === "running")
        next[key] = part.sessionID;
      else
        delete next[key];
      return next;
    });
  }), api.event.on("session.status", (event) => {
    if (event.properties.status.type === "idle") {
      clear(event.properties.sessionID);
      clearTools(event.properties.sessionID);
    }
  }), api.event.on("session.error", (event) => {
    if (event.properties.sessionID) {
      clear(event.properties.sessionID);
      clearTools(event.properties.sessionID);
    }
  })];
  api.lifecycle.onDispose(() => {
    off.forEach((dispose) => dispose());
    setTools({});
    setSessions({});
  });
  return (id) => Boolean(sessions()[id]) || Object.values(tools()).includes(id);
}
function waitingReason(api, id, activity, compacting = false) {
  if (api.state.session.permission(id).length)
    return "Menunggu izin kamu";
  if (api.state.session.question(id).length)
    return "Menunggu pilihan / jawaban kamu";
  if (compacting)
    return "Meringkas konteks percakapan";
  if (activity.status?.type === "retry")
    return "Menunggu percobaan ulang model";
  if (activity.current?.tool === "task" || activity.current?.tool === "subagent" || !activity.current && activity.agents.length)
    return "Menunggu hasil subagent";
  if (activity.current)
    return `${activity.current.state.status === "pending" ? "Mengantre" : "Menunggu hasil"} \xB7 ${activityDetail(activity.current).action}`;
  if (activity.status?.type === "busy")
    return "Menunggu respons model";
  return "";
}
function ObservedWait(props) {
  const [seconds, setSeconds] = createSignal(0);
  createEffect(() => {
    const reason = props.reason;
    const session = props.session;
    setSeconds(0);
    if (!reason || !session)
      return;
    const start = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    onCleanup(() => clearInterval(timer));
  });
  return _$createComponent(Show, {
    get when() {
      return props.reason;
    },
    get children() {
      var _el$ = _$createElement("text"), _el$2 = _$createTextNode(` \xB7 `), _el$3 = _$createTextNode(` dtk teramati`);
      _$insertNode(_el$, _el$2);
      _$insertNode(_el$, _el$3);
      _$setProp(_el$, "wrapMode", "word");
      _$insert(_el$, () => props.reason, _el$2);
      _$insert(_el$, seconds, _el$3);
      return _el$;
    }
  });
}
function holdKeyboardPose(source, duration = 5000, compactDuration = 7200, session = () => "") {
  const [pose, setPose] = createSignal(source().pose);
  let scope = session();
  let started = Date.now();
  createEffect(() => {
    const next = source().pose;
    const id = session();
    const previous = untrack(pose);
    if (id !== scope) {
      scope = id;
      started = Date.now();
      setPose(next);
      return;
    }
    const remaining = (previous === "compact" ? compactDuration : duration) - (Date.now() - started);
    const urgent = next === "error" || next === "wait" && source().label === "Menunggu jawaban";
    const interrupt = urgent || previous !== "compact" && next === "wait";
    if ((previous === "write" || previous === "compact") && next !== previous && remaining > 0 && !interrupt && next !== "compact") {
      const timer = setTimeout(() => {
        started = Date.now();
        setPose(source().pose);
      }, remaining);
      onCleanup(() => clearTimeout(timer));
      return;
    }
    if (next !== previous)
      started = Date.now();
    setPose(next);
  });
  return pose;
}
function Companion(props) {
  const state = createMemo(() => avatarState(props.activity, props.compacting), undefined, {
    equals: (previous, next) => previous.pose === next.pose && previous.label === next.label && previous.moving === next.moving
  });
  const pose = holdKeyboardPose(state, 5000, 7200, () => {
    const route = props.api.route?.current;
    return route?.name === "session" ? String(route.params?.sessionID ?? "home") : "home";
  });
  const [frame, setFrame] = createSignal(0);
  const size = useTerminalDimensions();
  createEffect(() => {
    const current = pose();
    setFrame(0);
    if (props.motion === false)
      return;
    const timer = setInterval(() => setFrame((value) => (value + 1) % 24), ["idle", "done", "wait", "error"].includes(current) ? 900 : 300);
    onCleanup(() => clearInterval(timer));
  });
  const theme = () => props.api.theme.current;
  const pixels = createMemo(() => avatarFrame(pose(), frame()));
  const mini = () => props.mini || size().height < 28;
  const rows = createMemo(() => Array.from({
    length: mini() ? 7 : 14
  }, (_, index) => index));
  const columns = createMemo(() => Array.from({
    length: mini() ? 14 : 28
  }, (_, index) => index));
  const pixel = (row, col) => {
    if (!mini())
      return pixels()[row][col];
    const block = [pixels()[row * 2][col * 2], pixels()[row * 2][col * 2 + 1], pixels()[row * 2 + 1][col * 2], pixels()[row * 2 + 1][col * 2 + 1]];
    return block.find((color) => color !== undefined);
  };
  return (() => {
    var _el$4 = _$createElement("box"), _el$5 = _$createElement("box");
    _$insertNode(_el$4, _el$5);
    _$setProp(_el$4, "gap", 0);
    _$setProp(_el$4, "flexShrink", 0);
    _$setProp(_el$5, "alignItems", "center");
    _$setProp(_el$5, "flexShrink", 0);
    _$insert(_el$5, _$createComponent(For, {
      get each() {
        return rows();
      },
      children: (row) => (() => {
        var _el$8 = _$createElement("text");
        _$setProp(_el$8, "height", 1);
        _$setProp(_el$8, "flexShrink", 0);
        _$insert(_el$8, _$createComponent(For, {
          get each() {
            return columns();
          },
          children: (col) => (() => {
            var _el$9 = _$createElement("span");
            _$insertNode(_el$9, _$createTextNode(`\u2580`));
            _$effect((_$p) => _$setProp(_el$9, "style", {
              fg: pixel(row * 2, col) ?? theme().backgroundPanel,
              bg: pixel(row * 2 + 1, col) ?? theme().backgroundPanel
            }, _$p));
            return _el$9;
          })()
        }));
        return _el$8;
      })()
    }));
    _$insert(_el$4, _$createComponent(Show, {
      get when() {
        return !props.portraitOnly;
      },
      get children() {
        return [(() => {
          var _el$6 = _$createElement("text"), _el$7 = _$createElement("b");
          _$insertNode(_el$6, _el$7);
          _$insert(_el$7, () => state().label);
          _$effect((_$p) => _$setProp(_el$6, "fg", theme().text, _$p));
          return _el$6;
        })(), _$createComponent(Show, {
          get when() {
            return props.activity.latest;
          },
          children: (latest) => (() => {
            var _el$1 = _$createElement("box"), _el$10 = _$createElement("text"), _el$11 = _$createTextNode(`Aktivitas terakhir \xB7 `), _el$12 = _$createElement("text"), _el$13 = _$createElement("b");
            _$insertNode(_el$1, _el$10);
            _$insertNode(_el$1, _el$12);
            _$insertNode(_el$10, _el$11);
            _$insert(_el$10, () => activityDetail(latest()).status, null);
            _$insertNode(_el$12, _el$13);
            _$setProp(_el$12, "wrapMode", "word");
            _$insert(_el$13, () => activityDetail(latest()).action);
            _$insert(_el$1, _$createComponent(Show, {
              get when() {
                return activityDetail(latest()).target;
              },
              get children() {
                var _el$14 = _$createElement("text");
                _$setProp(_el$14, "wrapMode", "char");
                _$insert(_el$14, () => activityDetail(latest()).target);
                _$effect((_$p) => _$setProp(_el$14, "fg", theme().text, _$p));
                return _el$14;
              }
            }), null);
            _$insert(_el$1, _$createComponent(Show, {
              get when() {
                return activityDetail(latest()).result;
              },
              get children() {
                var _el$15 = _$createElement("text");
                _$setProp(_el$15, "wrapMode", "word");
                _$insert(_el$15, () => activityDetail(latest()).result);
                _$effect((_$p) => _$setProp(_el$15, "fg", theme().textMuted, _$p));
                return _el$15;
              }
            }), null);
            _$effect((_p$) => {
              var _v$ = theme().textMuted, _v$2 = theme().text;
              _v$ !== _p$.e && (_p$.e = _$setProp(_el$10, "fg", _v$, _p$.e));
              _v$2 !== _p$.t && (_p$.t = _$setProp(_el$12, "fg", _v$2, _p$.t));
              return _p$;
            }, {
              e: undefined,
              t: undefined
            });
            return _el$1;
          })()
        })];
      }
    }), null);
    _$effect((_$p) => _$setProp(_el$5, "height", mini() ? 7 : 14, _$p));
    return _el$4;
  })();
}
function Welcome(props) {
  const size = useTerminalDimensions();
  const theme = () => props.api.theme.current;
  const narrow = () => size().width < 70;
  const [phrase, setPhrase] = createSignal(0);
  const phrases = ["Mau ngerjain apa hari ini gan? Sini gua bantu beresin.", "Ada bug bandel? Ceritain, kita telusuri bareng.", "Mau bikin fitur baru? Kasih idenya, kita mulai.", "Bawa kodenya, gan. Kita rapihin satu per satu."];
  createEffect(() => {
    if (props.motion === false)
      return;
    const timer = setInterval(() => setPhrase((value) => (value + 1) % phrases.length), props.speechInterval ?? 6500);
    onCleanup(() => clearInterval(timer));
  });
  const idle = {
    mcp: [],
    agents: [],
    tools: [],
    todos: [],
    completed: 0,
    total: 0,
    attention: 0,
    status: {
      type: "idle"
    },
    latest: undefined,
    current: undefined
  };
  return (() => {
    var _el$16 = _$createElement("box"), _el$17 = _$createElement("text"), _el$18 = _$createElement("b"), _el$19 = _$createElement("box"), _el$20 = _$createElement("box"), _el$21 = _$createElement("box"), _el$22 = _$createElement("text"), _el$24 = _$createElement("text");
    _$insertNode(_el$16, _el$17);
    _$insertNode(_el$16, _el$19);
    _$setProp(_el$16, "width", "100%");
    _$setProp(_el$16, "maxWidth", 96);
    _$setProp(_el$16, "paddingLeft", 2);
    _$setProp(_el$16, "paddingRight", 2);
    _$setProp(_el$16, "gap", 1);
    _$setProp(_el$16, "flexShrink", 0);
    _$insertNode(_el$17, _el$18);
    _$insert(_el$18, () => narrow() ? "S / STUDIO" : "S A F F T E E N   /   S T U D I O");
    _$insertNode(_el$19, _el$20);
    _$insertNode(_el$19, _el$21);
    _$setProp(_el$19, "alignItems", "center");
    _$setProp(_el$19, "gap", 1);
    _$setProp(_el$20, "flexShrink", 0);
    _$insert(_el$20, _$createComponent(Companion, {
      get api() {
        return props.api;
      },
      activity: idle,
      get motion() {
        return props.motion;
      },
      get mini() {
        return narrow() || size().height < 32;
      },
      portraitOnly: true
    }));
    _$insertNode(_el$21, _el$22);
    _$insertNode(_el$21, _el$24);
    _$setProp(_el$21, "flexGrow", 1);
    _$setProp(_el$21, "flexShrink", 1);
    _$setProp(_el$21, "minWidth", 0);
    _$insertNode(_el$22, _$createTextNode(`Santai \xB7 siap bantu`));
    _$setProp(_el$24, "wrapMode", "word");
    _$insert(_el$24, () => phrases[phrase()]);
    _$insert(_el$16, _$createComponent(Show, {
      get when() {
        return !narrow();
      },
      get children() {
        var _el$25 = _$createElement("text");
        _$insertNode(_el$25, _$createTextNode(`Bangun, telusuri, dan perbaiki kode. Mulai dari satu instruksi.`));
        _$effect((_$p) => _$setProp(_el$25, "fg", theme().textMuted, _$p));
        return _el$25;
      }
    }), null);
    _$effect((_p$) => {
      var _v$3 = theme().primary, _v$4 = narrow() && size().height >= 40 ? "column" : "row", _v$5 = narrow() || size().height < 32 ? 14 : 28, _v$6 = theme().textMuted, _v$7 = theme().text;
      _v$3 !== _p$.e && (_p$.e = _$setProp(_el$17, "fg", _v$3, _p$.e));
      _v$4 !== _p$.t && (_p$.t = _$setProp(_el$19, "flexDirection", _v$4, _p$.t));
      _v$5 !== _p$.a && (_p$.a = _$setProp(_el$20, "width", _v$5, _p$.a));
      _v$6 !== _p$.o && (_p$.o = _$setProp(_el$22, "fg", _v$6, _p$.o));
      _v$7 !== _p$.i && (_p$.i = _$setProp(_el$24, "fg", _v$7, _p$.i));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined
    });
    return _el$16;
  })();
}
function InfoCard(props) {
  const [open, setOpen] = createSignal(props.api.kv.get(`studio.card.${props.name}`, props.initialOpen ?? false));
  const theme = () => props.api.theme.current;
  const toggle = () => {
    const next = !open();
    setOpen(next);
    props.api.kv.set(`studio.card.${props.name}`, next);
  };
  const unregister = props.api.command?.register(() => [{
    title: `Studio: ${open() ? "tutup" : "buka"} ${props.title}`,
    value: `studio.card.${props.name}`,
    category: "Studio",
    slash: {
      name: `studio-${props.name}`
    },
    onSelect: (dialog) => {
      toggle();
      dialog?.clear();
    }
  }]);
  if (unregister)
    onCleanup(unregister);
  return (() => {
    var _el$27 = _$createElement("box"), _el$28 = _$createElement("box"), _el$29 = _$createElement("text"), _el$30 = _$createElement("b"), _el$31 = _$createTextNode(` `), _el$32 = _$createElement("text");
    _$insertNode(_el$27, _el$28);
    _$setProp(_el$27, "paddingLeft", 1);
    _$setProp(_el$27, "paddingRight", 1);
    _$insertNode(_el$28, _el$29);
    _$insertNode(_el$28, _el$32);
    _$setProp(_el$28, "onMouseDown", (event) => {
      if (event.button === 0) {
        event.stopPropagation();
        toggle();
      }
    });
    _$insertNode(_el$29, _el$30);
    _$insertNode(_el$30, _el$31);
    _$insert(_el$30, () => open() ? "\u25BE" : "\u25B8", _el$31);
    _$insert(_el$30, () => props.title, null);
    _$setProp(_el$32, "wrapMode", "word");
    _$insert(_el$32, () => props.summary);
    _$insert(_el$27, _$createComponent(Show, {
      get when() {
        return open();
      },
      get children() {
        var _el$33 = _$createElement("box");
        _$setProp(_el$33, "paddingTop", 1);
        _$setProp(_el$33, "paddingBottom", 1);
        _$insert(_el$33, () => props.children);
        return _el$33;
      }
    }), null);
    _$effect((_p$) => {
      var _v$8 = theme().backgroundElement, _v$9 = theme().primary, _v$0 = theme().textMuted;
      _v$8 !== _p$.e && (_p$.e = _$setProp(_el$27, "backgroundColor", _v$8, _p$.e));
      _v$9 !== _p$.t && (_p$.t = _$setProp(_el$29, "fg", _v$9, _p$.t));
      _v$0 !== _p$.a && (_p$.a = _$setProp(_el$32, "fg", _v$0, _p$.a));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined
    });
    return _el$27;
  })();
}
function Overview(props) {
  const theme = () => props.api.theme.current;
  const data = createMemo(() => sessionMetrics(props.api, props.id));
  const activity = createMemo(() => sidebarActivity(props.api, props.id));
  const calls = createMemo(() => new Map(props.api.state.session.messages(props.id).flatMap((message) => props.api.state.part(message.id).filter((part) => part.type === "tool")).map((part) => [part.callID, part])));
  const detail = (tool) => activityDetail(calls().get(tool.callID) ?? tool);
  const mcp = retainActivity(() => activity().mcp, (server) => server.name, () => props.id);
  const agents = retainActivity(() => activity().agents, (agent) => agent.id, () => props.id);
  const tools = retainActivity(() => activity().tools, (tool) => tool.callID, () => props.id);
  const todos = retainActivity(() => activity().todos, (todo) => todo.content, () => props.id);
  const size = useTerminalDimensions();
  const limit = () => size().height < 35 ? 2 : 4;
  return (() => {
    var _el$34 = _$createElement("box"), _el$35 = _$createElement("box"), _el$36 = _$createElement("text"), _el$37 = _$createElement("b"), _el$38 = _$createElement("text"), _el$39 = _$createTextNode(` \xB7 `);
    _$insertNode(_el$34, _el$35);
    _$setProp(_el$34, "gap", 1);
    _$setProp(_el$34, "flexShrink", 0);
    _$insertNode(_el$35, _el$36);
    _$insertNode(_el$35, _el$38);
    _$insertNode(_el$36, _el$37);
    _$setProp(_el$36, "wrapMode", "char");
    _$insert(_el$37, () => data().model);
    _$insertNode(_el$38, _el$39);
    _$insert(_el$38, () => data().agent ?? "Sesi baru", _el$39);
    _$insert(_el$38, (() => {
      var _c$ = _$memo(() => activity().status?.type === "busy");
      return () => _c$() ? "Bekerja" : activity().status?.type === "retry" ? "Mencoba ulang" : "Siap";
    })(), null);
    _$insert(_el$35, _$createComponent(Show, {
      get when() {
        return data().used !== undefined;
      },
      get children() {
        var _el$40 = _$createElement("text"), _el$41 = _$createTextNode(` token \xB7 laporan model terakhir`);
        _$insertNode(_el$40, _el$41);
        _$insert(_el$40, () => compact(data().used ?? 0), _el$41);
        _$effect((_$p) => _$setProp(_el$40, "fg", theme().textMuted, _$p));
        return _el$40;
      }
    }), null);
    _$insert(_el$35, _$createComponent(Show, {
      get when() {
        return data().used !== undefined;
      },
      get children() {
        var _el$42 = _$createElement("text");
        _$insertNode(_el$42, _$createTextNode(`Bukan ukuran konteks sesudah DCP.`));
        _$effect((_$p) => _$setProp(_el$42, "fg", theme().textMuted, _$p));
        return _el$42;
      }
    }), null);
    _$insert(_el$35, _$createComponent(Show, {
      get when() {
        return data().cost > 0;
      },
      get children() {
        var _el$44 = _$createElement("text"), _el$45 = _$createTextNode(`$`), _el$46 = _$createTextNode(` tercatat`);
        _$insertNode(_el$44, _el$45);
        _$insertNode(_el$44, _el$46);
        _$insert(_el$44, () => data().cost.toFixed(4), _el$46);
        _$effect((_$p) => _$setProp(_el$44, "fg", theme().textMuted, _$p));
        return _el$44;
      }
    }), null);
    _$insert(_el$34, _$createComponent(ObservedWait, {
      get reason() {
        return waitingReason(props.api, props.id, activity(), props.compacting);
      },
      get session() {
        return props.id;
      }
    }), null);
    _$insert(_el$34, _$createComponent(Companion, {
      get api() {
        return props.api;
      },
      get activity() {
        return activity();
      },
      get motion() {
        return props.motion;
      },
      get compacting() {
        return props.compacting;
      },
      get mini() {
        return props.mini;
      }
    }), null);
    _$insert(_el$34, _$createComponent(Show, {
      get when() {
        return activity().attention > 0;
      },
      get children() {
        var _el$47 = _$createElement("box"), _el$48 = _$createElement("text"), _el$49 = _$createElement("b"), _el$50 = _$createTextNode(`Butuh jawaban \xB7 `), _el$51 = _$createElement("text");
        _$insertNode(_el$47, _el$48);
        _$insertNode(_el$47, _el$51);
        _$insertNode(_el$48, _el$49);
        _$insertNode(_el$49, _el$50);
        _$insert(_el$49, () => activity().attention, null);
        _$insertNode(_el$51, _$createTextNode(`Periksa permintaan di percakapan.`));
        _$effect((_p$) => {
          var _v$1 = theme().warning, _v$10 = theme().textMuted;
          _v$1 !== _p$.e && (_p$.e = _$setProp(_el$48, "fg", _v$1, _p$.e));
          _v$10 !== _p$.t && (_p$.t = _$setProp(_el$51, "fg", _v$10, _p$.t));
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$47;
      }
    }), null);
    _$insert(_el$34, _$createComponent(Show, {
      get when() {
        return mcp().length > 0;
      },
      get children() {
        var _el$53 = _$createElement("box"), _el$54 = _$createElement("text"), _el$55 = _$createElement("b");
        _$insertNode(_el$53, _el$54);
        _$insertNode(_el$54, _el$55);
        _$insertNode(_el$55, _$createTextNode(`MCP sedang dipakai / terakhir`));
        _$insert(_el$53, _$createComponent(For, {
          get each() {
            return mcp().slice(0, limit());
          },
          children: (row) => (() => {
            var _el$106 = _$createElement("box"), _el$107 = _$createElement("text"), _el$108 = _$createTextNode(` \xB7 `);
            _$insertNode(_el$106, _el$107);
            _$insertNode(_el$107, _el$108);
            _$setProp(_el$107, "wrapMode", "char");
            _$insert(_el$107, () => row.item.name, _el$108);
            _$insert(_el$107, (() => {
              var _c$2 = _$memo(() => row.ended === undefined);
              return () => _c$2() ? `${row.item.calls.length} panggilan` : "Baru berakhir";
            })(), null);
            _$insert(_el$106, _$createComponent(For, {
              get each() {
                return row.item.calls.slice(0, 2);
              },
              children: (call) => (() => {
                var _el$109 = _$createElement("text"), _el$110 = _$createTextNode(` \xB7 `);
                _$insertNode(_el$109, _el$110);
                _$setProp(_el$109, "wrapMode", "word");
                _$insert(_el$109, () => detail(call).status, _el$110);
                _$insert(_el$109, () => detail(call).action, null);
                _$insert(_el$109, (() => {
                  var _c$3 = _$memo(() => !!detail(call).target);
                  return () => _c$3() ? ` \xB7 ${detail(call).target}` : "";
                })(), null);
                _$effect((_$p) => _$setProp(_el$109, "fg", theme().textMuted, _$p));
                return _el$109;
              })()
            }), null);
            _$effect((_$p) => _$setProp(_el$107, "fg", theme().text, _$p));
            return _el$106;
          })()
        }), null);
        _$insert(_el$53, _$createComponent(Show, {
          get when() {
            return mcp().length > limit();
          },
          get children() {
            var _el$57 = _$createElement("text"), _el$58 = _$createTextNode(`+`), _el$59 = _$createTextNode(` MCP lainnya`);
            _$insertNode(_el$57, _el$58);
            _$insertNode(_el$57, _el$59);
            _$insert(_el$57, () => mcp().length - limit(), _el$59);
            _$effect((_$p) => _$setProp(_el$57, "fg", theme().textMuted, _$p));
            return _el$57;
          }
        }), null);
        _$effect((_$p) => _$setProp(_el$54, "fg", theme().primary, _$p));
        return _el$53;
      }
    }), null);
    _$insert(_el$34, _$createComponent(Show, {
      get when() {
        return agents().length > 0;
      },
      get children() {
        var _el$60 = _$createElement("box"), _el$61 = _$createElement("text"), _el$62 = _$createElement("b"), _el$63 = _$createTextNode(`Subagent \xB7 `);
        _$insertNode(_el$60, _el$61);
        _$insertNode(_el$61, _el$62);
        _$insertNode(_el$62, _el$63);
        _$insert(_el$62, () => agents().length, null);
        _$insert(_el$60, _$createComponent(For, {
          get each() {
            return agents().slice(0, limit());
          },
          children: (row) => (() => {
            var _el$111 = _$createElement("box"), _el$112 = _$createElement("text"), _el$113 = _$createTextNode(` \xB7 `);
            _$insertNode(_el$111, _el$112);
            _$insertNode(_el$112, _el$113);
            _$setProp(_el$112, "wrapMode", "char");
            _$insert(_el$112, () => row.item.name, _el$113);
            _$insert(_el$112, (() => {
              var _c$4 = _$memo(() => row.ended === undefined);
              return () => _c$4() ? row.item.label : "Baru berakhir";
            })(), null);
            _$insert(_el$111, _$createComponent(Show, {
              get when() {
                return row.item.target;
              },
              get children() {
                var _el$114 = _$createElement("text");
                _$setProp(_el$114, "wrapMode", "word");
                _$insert(_el$114, () => row.item.target);
                _$effect((_$p) => _$setProp(_el$114, "fg", theme().textMuted, _$p));
                return _el$114;
              }
            }), null);
            _$effect((_$p) => _$setProp(_el$112, "fg", theme().text, _$p));
            return _el$111;
          })()
        }), null);
        _$insert(_el$60, _$createComponent(Show, {
          get when() {
            return agents().length > limit();
          },
          get children() {
            var _el$64 = _$createElement("text"), _el$65 = _$createTextNode(`+`), _el$66 = _$createTextNode(` agent lainnya`);
            _$insertNode(_el$64, _el$65);
            _$insertNode(_el$64, _el$66);
            _$insert(_el$64, () => agents().length - limit(), _el$66);
            _$effect((_$p) => _$setProp(_el$64, "fg", theme().textMuted, _$p));
            return _el$64;
          }
        }), null);
        _$effect((_$p) => _$setProp(_el$61, "fg", theme().primary, _$p));
        return _el$60;
      }
    }), null);
    _$insert(_el$34, _$createComponent(Show, {
      get when() {
        return tools().length > 0;
      },
      get children() {
        var _el$67 = _$createElement("box"), _el$68 = _$createElement("text"), _el$69 = _$createElement("b");
        _$insertNode(_el$67, _el$68);
        _$insertNode(_el$68, _el$69);
        _$insertNode(_el$69, _$createTextNode(`Aktivitas tool`));
        _$insert(_el$67, _$createComponent(For, {
          get each() {
            return tools().slice(0, limit());
          },
          children: (row) => (() => {
            var _el$115 = _$createElement("text"), _el$116 = _$createTextNode(` \xB7 `);
            _$insertNode(_el$115, _el$116);
            _$setProp(_el$115, "wrapMode", "word");
            _$insert(_el$115, () => detail(row.item).action, _el$116);
            _$insert(_el$115, () => detail(row.item).status, null);
            _$insert(_el$115, (() => {
              var _c$5 = _$memo(() => !!detail(row.item).target);
              return () => _c$5() ? ` \xB7 ${detail(row.item).target}` : "";
            })(), null);
            _$effect((_$p) => _$setProp(_el$115, "fg", theme().text, _$p));
            return _el$115;
          })()
        }), null);
        _$insert(_el$67, _$createComponent(Show, {
          get when() {
            return tools().length > limit();
          },
          get children() {
            var _el$71 = _$createElement("text"), _el$72 = _$createTextNode(`+`), _el$73 = _$createTextNode(` tool lainnya`);
            _$insertNode(_el$71, _el$72);
            _$insertNode(_el$71, _el$73);
            _$insert(_el$71, () => tools().length - limit(), _el$73);
            _$effect((_$p) => _$setProp(_el$71, "fg", theme().textMuted, _$p));
            return _el$71;
          }
        }), null);
        _$effect((_$p) => _$setProp(_el$68, "fg", theme().primary, _$p));
        return _el$67;
      }
    }), null);
    _$insert(_el$34, _$createComponent(Show, {
      get when() {
        return todos().length > 0;
      },
      get children() {
        var _el$74 = _$createElement("box"), _el$75 = _$createElement("text"), _el$76 = _$createElement("b"), _el$77 = _$createTextNode(`Rencana \xB7 `), _el$78 = _$createTextNode(`/`);
        _$insertNode(_el$74, _el$75);
        _$insertNode(_el$75, _el$76);
        _$insertNode(_el$76, _el$77);
        _$insertNode(_el$76, _el$78);
        _$insert(_el$76, () => activity().completed, _el$78);
        _$insert(_el$76, () => activity().total, null);
        _$insert(_el$74, _$createComponent(For, {
          get each() {
            return todos().slice(0, limit());
          },
          children: (row) => (() => {
            var _el$117 = _$createElement("text");
            _$setProp(_el$117, "wrapMode", "word");
            _$insert(_el$117, (() => {
              var _c$6 = _$memo(() => row.ended !== undefined);
              return () => _c$6() ? "Baru berakhir \xB7 " : row.item.status === "in_progress" ? "> " : "\xB7 ";
            })(), null);
            _$insert(_el$117, () => row.item.content, null);
            _$effect((_$p) => _$setProp(_el$117, "fg", row.ended === undefined && row.item.status === "in_progress" ? theme().text : theme().textMuted, _$p));
            return _el$117;
          })()
        }), null);
        _$insert(_el$74, _$createComponent(Show, {
          get when() {
            return todos().length > limit();
          },
          get children() {
            var _el$79 = _$createElement("text"), _el$80 = _$createTextNode(`+`), _el$81 = _$createTextNode(` tugas berikutnya`);
            _$insertNode(_el$79, _el$80);
            _$insertNode(_el$79, _el$81);
            _$insert(_el$79, () => todos().length - limit(), _el$81);
            _$effect((_$p) => _$setProp(_el$79, "fg", theme().textMuted, _$p));
            return _el$79;
          }
        }), null);
        _$effect((_$p) => _$setProp(_el$75, "fg", theme().primary, _$p));
        return _el$74;
      }
    }), null);
    _$insert(_el$34, _$createComponent(InfoCard, {
      get api() {
        return props.api;
      },
      name: "result",
      title: "Hasil terakhir",
      get summary() {
        return _$memo(() => !!activity().latest)() ? `${activityDetail(activity().latest).action} \xB7 ${activityDetail(activity().latest).status}` : "Belum ada hasil tool";
      },
      get children() {
        return [_$createComponent(Show, {
          get when() {
            return activity().latest;
          },
          children: (latest) => (() => {
            var _el$118 = _$createElement("box"), _el$119 = _$createElement("text"), _el$120 = _$createElement("text");
            _$insertNode(_el$118, _el$119);
            _$insertNode(_el$118, _el$120);
            _$setProp(_el$119, "wrapMode", "word");
            _$insert(_el$119, () => activityDetail(latest()).target || activityDetail(latest()).action);
            _$setProp(_el$120, "wrapMode", "word");
            _$insert(_el$120, () => activityDetail(latest()).result || "Masih diproses; belum ada hasil akhir.");
            _$effect((_p$) => {
              var _v$13 = theme().text, _v$14 = theme().textMuted;
              _v$13 !== _p$.e && (_p$.e = _$setProp(_el$119, "fg", _v$13, _p$.e));
              _v$14 !== _p$.t && (_p$.t = _$setProp(_el$120, "fg", _v$14, _p$.t));
              return _p$;
            }, {
              e: undefined,
              t: undefined
            });
            return _el$118;
          })()
        }), (() => {
          var _el$82 = _$createElement("text"), _el$83 = _$createTextNode(` berkas berubah di sesi ini \xB7 `), _el$84 = _$createTextNode(` tugas tersisa`);
          _$insertNode(_el$82, _el$83);
          _$insertNode(_el$82, _el$84);
          _$insert(_el$82, () => props.api.state.session.diff(props.id).length, _el$83);
          _$insert(_el$82, () => activity().todos.length, _el$84);
          _$effect((_$p) => _$setProp(_el$82, "fg", theme().textMuted, _$p));
          return _el$82;
        })(), (() => {
          var _el$85 = _$createElement("text");
          _$insertNode(_el$85, _$createTextNode(`Hasil tes: lihat keluaran pengujian di percakapan; status tool bukan bukti tes lulus.`));
          _$setProp(_el$85, "wrapMode", "word");
          _$effect((_$p) => _$setProp(_el$85, "fg", theme().textMuted, _$p));
          return _el$85;
        })()];
      }
    }), null);
    _$insert(_el$34, _$createComponent(InfoCard, {
      get api() {
        return props.api;
      },
      name: "context",
      title: "Laporan token provider",
      get summary() {
        return _$memo(() => data().used === undefined)() ? "Token belum dilaporkan" : `${compact(data().used ?? NaN)} token \xB7 laporan terakhir`;
      },
      get children() {
        return [(() => {
          var _el$87 = _$createElement("text");
          _$setProp(_el$87, "wrapMode", "char");
          _$insert(_el$87, () => data().model);
          _$effect((_$p) => _$setProp(_el$87, "fg", theme().text, _$p));
          return _el$87;
        })(), (() => {
          var _el$88 = _$createElement("text"), _el$89 = _$createTextNode(`Provider \xB7 `);
          _$insertNode(_el$88, _el$89);
          _$setProp(_el$88, "wrapMode", "char");
          _$insert(_el$88, () => data().provider, null);
          _$effect((_$p) => _$setProp(_el$88, "fg", theme().textMuted, _$p));
          return _el$88;
        })(), (() => {
          var _el$90 = _$createElement("text");
          _$insertNode(_el$90, _$createTextNode(`Konteks aktif DCP \xB7 belum diukur`));
          _$effect((_$p) => _$setProp(_el$90, "fg", theme().textMuted, _$p));
          return _el$90;
        })(), (() => {
          var _el$92 = _$createElement("text");
          _$insertNode(_el$92, _$createTextNode(`Laporan ini menjumlahkan input, output, reasoning, dan cache dari pesan model terakhir yang melaporkan penggunaan.`));
          _$setProp(_el$92, "wrapMode", "word");
          _$effect((_$p) => _$setProp(_el$92, "fg", theme().textMuted, _$p));
          return _el$92;
        })(), (() => {
          var _el$94 = _$createElement("text");
          _$insertNode(_el$94, _$createTextNode(`Periksa /dcp untuk statistik kompresi. Angka provider bukan ukuran pesan yang akan dikirim sesudah DCP.`));
          _$setProp(_el$94, "wrapMode", "word");
          _$effect((_$p) => _$setProp(_el$94, "fg", theme().textMuted, _$p));
          return _el$94;
        })(), (() => {
          var _el$96 = _$createElement("text"), _el$97 = _$createTextNode(`Biaya tercatat \xB7 $`);
          _$insertNode(_el$96, _el$97);
          _$insert(_el$96, () => data().cost.toFixed(4), null);
          _$effect((_$p) => _$setProp(_el$96, "fg", theme().textMuted, _$p));
          return _el$96;
        })()];
      }
    }), null);
    _$insert(_el$34, _$createComponent(InfoCard, {
      get api() {
        return props.api;
      },
      name: "progress",
      title: "Progres tugas",
      get summary() {
        return `${activity().completed}/${activity().total} selesai \xB7 ${activity().todos.length} tersisa`;
      },
      get children() {
        return _$createComponent(Show, {
          get when() {
            return activity().total > 0;
          },
          get fallback() {
            return (() => {
              var _el$121 = _$createElement("text");
              _$insertNode(_el$121, _$createTextNode(`Belum ada daftar tugas di sesi ini.`));
              _$effect((_$p) => _$setProp(_el$121, "fg", theme().textMuted, _$p));
              return _el$121;
            })();
          },
          get children() {
            return [(() => {
              var _el$98 = _$createElement("text"), _el$99 = _$createTextNode(` berjalan \xB7 `), _el$100 = _$createTextNode(` antre`);
              _$insertNode(_el$98, _el$99);
              _$insertNode(_el$98, _el$100);
              _$insert(_el$98, () => activity().todos.filter((todo) => todo.status === "in_progress").length, _el$99);
              _$insert(_el$98, () => activity().todos.filter((todo) => todo.status === "pending").length, _el$100);
              _$effect((_$p) => _$setProp(_el$98, "fg", theme().textMuted, _$p));
              return _el$98;
            })(), _$createComponent(For, {
              get each() {
                return props.api.state.session.todo(props.id).filter((todo) => todo.status === "completed");
              },
              children: (todo) => (() => {
                var _el$123 = _$createElement("text"), _el$124 = _$createTextNode(`Selesai \xB7 `);
                _$insertNode(_el$123, _el$124);
                _$setProp(_el$123, "wrapMode", "word");
                _$insert(_el$123, () => todo.content, null);
                _$effect((_$p) => _$setProp(_el$123, "fg", theme().textMuted, _$p));
                return _el$123;
              })()
            }), _$createComponent(Show, {
              get when() {
                return activity().todos.length > 0;
              },
              get children() {
                var _el$101 = _$createElement("text");
                _$insertNode(_el$101, _$createTextNode(`Tugas aktif ditampilkan di Rencana.`));
                _$effect((_$p) => _$setProp(_el$101, "fg", theme().textMuted, _$p));
                return _el$101;
              }
            })];
          }
        });
      }
    }), null);
    _$insert(_el$34, _$createComponent(InfoCard, {
      get api() {
        return props.api;
      },
      name: "connections",
      title: "Koneksi MCP",
      get summary() {
        return `${props.api.state.mcp().filter((server) => server.status === "connected").length}/${props.api.state.mcp().length} terhubung`;
      },
      get children() {
        return [(() => {
          var _el$103 = _$createElement("text");
          _$insertNode(_el$103, _$createTextNode(`Terhubung bukan berarti sedang dipakai.`));
          _$effect((_$p) => _$setProp(_el$103, "fg", theme().textMuted, _$p));
          return _el$103;
        })(), _$createComponent(For, {
          get each() {
            return props.api.state.mcp();
          },
          get fallback() {
            return (() => {
              var _el$125 = _$createElement("text");
              _$insertNode(_el$125, _$createTextNode(`Tidak ada server MCP.`));
              _$effect((_$p) => _$setProp(_el$125, "fg", theme().textMuted, _$p));
              return _el$125;
            })();
          },
          children: (server) => (() => {
            var _el$127 = _$createElement("text"), _el$128 = _$createTextNode(` \xB7 `);
            _$insertNode(_el$127, _el$128);
            _$setProp(_el$127, "wrapMode", "char");
            _$insert(_el$127, () => server.name, _el$128);
            _$insert(_el$127, () => server.status, null);
            _$effect((_$p) => _$setProp(_el$127, "fg", server.status === "connected" ? theme().text : theme().warning, _$p));
            return _el$127;
          })()
        })];
      }
    }), null);
    _$insert(_el$34, _$createComponent(InfoCard, {
      get api() {
        return props.api;
      },
      name: "files",
      title: "Ruang kerja & berkas",
      get summary() {
        return `${props.api.state.vcs?.branch ?? "lokal"} \xB7 ${props.api.state.session.diff(props.id).length} berkas`;
      },
      get children() {
        return [(() => {
          var _el$105 = _$createElement("text");
          _$setProp(_el$105, "wrapMode", "char");
          _$insert(_el$105, () => props.api.state.path.directory);
          _$effect((_$p) => _$setProp(_el$105, "fg", theme().textMuted, _$p));
          return _el$105;
        })(), _$createComponent(For, {
          get each() {
            return props.api.state.session.diff(props.id);
          },
          get fallback() {
            return (() => {
              var _el$129 = _$createElement("text");
              _$insertNode(_el$129, _$createTextNode(`Belum ada perubahan berkas di sesi ini.`));
              _$effect((_$p) => _$setProp(_el$129, "fg", theme().textMuted, _$p));
              return _el$129;
            })();
          },
          children: (file) => (() => {
            var _el$131 = _$createElement("box"), _el$132 = _$createElement("text"), _el$133 = _$createElement("text"), _el$134 = _$createTextNode(`+`), _el$135 = _$createTextNode(` / -`);
            _$insertNode(_el$131, _el$132);
            _$insertNode(_el$131, _el$133);
            _$setProp(_el$132, "wrapMode", "char");
            _$insert(_el$132, () => file.file);
            _$insertNode(_el$133, _el$134);
            _$insertNode(_el$133, _el$135);
            _$insert(_el$133, () => file.additions, _el$135);
            _$insert(_el$133, () => file.deletions, null);
            _$effect((_p$) => {
              var _v$15 = theme().text, _v$16 = theme().textMuted;
              _v$15 !== _p$.e && (_p$.e = _$setProp(_el$132, "fg", _v$15, _p$.e));
              _v$16 !== _p$.t && (_p$.t = _$setProp(_el$133, "fg", _v$16, _p$.t));
              return _p$;
            }, {
              e: undefined,
              t: undefined
            });
            return _el$131;
          })()
        })];
      }
    }), null);
    _$effect((_p$) => {
      var _v$11 = theme().text, _v$12 = theme().textMuted;
      _v$11 !== _p$.e && (_p$.e = _$setProp(_el$36, "fg", _v$11, _p$.e));
      _v$12 !== _p$.t && (_p$.t = _$setProp(_el$38, "fg", _v$12, _p$.t));
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$34;
  })();
}
function SidebarPresence(props) {
  onMount(() => props.visible(true));
  onCleanup(() => props.visible(false));
  return props.children;
}
function ResponsiveDock(props) {
  const size = useTerminalDimensions();
  const activity = createMemo(() => sidebarActivity(props.api, props.id));
  const data = createMemo(() => sessionMetrics(props.api, props.id));
  const theme = () => props.api.theme.current;
  const open = () => props.api.ui.dialog.replace(() => _$createComponent(props.api.ui.Dialog, {
    onClose: () => props.api.ui.dialog.clear(),
    get children() {
      var _el$136 = _$createElement("box"), _el$137 = _$createElement("text"), _el$138 = _$createElement("b"), _el$140 = _$createTextNode(` \xB7 Esc tutup`), _el$141 = _$createElement("scrollbox");
      _$insertNode(_el$136, _el$137);
      _$insertNode(_el$136, _el$141);
      _$setProp(_el$136, "padding", 1);
      _$insertNode(_el$137, _el$138);
      _$insertNode(_el$137, _el$140);
      _$insertNode(_el$138, _$createTextNode(`Studio \xB7 Detail sesi`));
      _$insert(_el$141, _$createComponent(Overview, {
        get api() {
          return props.api;
        },
        get id() {
          return props.id;
        },
        get motion() {
          return props.motion;
        },
        get compacting() {
          return props.compacting;
        },
        mini: true
      }));
      _$effect((_p$) => {
        var _v$17 = theme().primary, _v$18 = Math.max(5, size().height - 10);
        _v$17 !== _p$.e && (_p$.e = _$setProp(_el$137, "fg", _v$17, _p$.e));
        _v$18 !== _p$.t && (_p$.t = _$setProp(_el$141, "height", _v$18, _p$.t));
        return _p$;
      }, {
        e: undefined,
        t: undefined
      });
      return _el$136;
    }
  }));
  const unregister = props.api.command?.register(() => [{
    title: "Studio: buka seluruh informasi sesi",
    value: "studio.panel",
    category: "Studio",
    slash: {
      name: "studio-panel"
    },
    onSelect: () => open()
  }]);
  if (unregister)
    onCleanup(unregister);
  return _$createComponent(Show, {
    get when() {
      return !props.sidebarVisible;
    },
    get children() {
      var _el$142 = _$createElement("box"), _el$143 = _$createElement("box"), _el$144 = _$createElement("box"), _el$145 = _$createElement("text"), _el$146 = _$createElement("b"), _el$147 = _$createTextNode(`STUDIO \xB7 `), _el$148 = _$createElement("text"), _el$149 = _$createElement("text"), _el$150 = _$createElement("text"), _el$151 = _$createElement("text"), _el$152 = _$createElement("text"), _el$153 = _$createElement("box"), _el$154 = _$createElement("text");
      _$insertNode(_el$142, _el$143);
      _$insertNode(_el$142, _el$144);
      _$setProp(_el$142, "flexDirection", "row");
      _$setProp(_el$142, "width", "100%");
      _$setProp(_el$142, "height", 8);
      _$setProp(_el$142, "flexShrink", 0);
      _$setProp(_el$142, "gap", 1);
      _$setProp(_el$142, "paddingLeft", 1);
      _$setProp(_el$142, "paddingRight", 1);
      _$setProp(_el$143, "width", 14);
      _$setProp(_el$143, "flexShrink", 0);
      _$insert(_el$143, _$createComponent(Companion, {
        get api() {
          return props.api;
        },
        get activity() {
          return activity();
        },
        get motion() {
          return props.motion;
        },
        get compacting() {
          return props.compacting;
        },
        mini: true,
        portraitOnly: true
      }));
      _$insertNode(_el$144, _el$145);
      _$insertNode(_el$144, _el$148);
      _$insertNode(_el$144, _el$149);
      _$insertNode(_el$144, _el$150);
      _$insertNode(_el$144, _el$151);
      _$insertNode(_el$144, _el$152);
      _$insertNode(_el$144, _el$153);
      _$setProp(_el$144, "flexGrow", 1);
      _$setProp(_el$144, "minWidth", 0);
      _$setProp(_el$144, "flexShrink", 1);
      _$insertNode(_el$145, _el$146);
      _$setProp(_el$145, "height", 1);
      _$insertNode(_el$146, _el$147);
      _$insert(_el$146, () => data().agent ?? "Sesi", null);
      _$setProp(_el$148, "height", 1);
      _$insert(_el$148, () => avatarState(activity(), props.compacting).label);
      _$setProp(_el$149, "height", 1);
      _$insert(_el$149, () => data().model, null);
      _$insert(_el$149, (() => {
        var _c$7 = _$memo(() => data().used === undefined);
        return () => _c$7() ? "" : ` \xB7 ${compact(data().used ?? NaN)} token (laporan)`;
      })(), null);
      _$setProp(_el$150, "height", 1);
      _$insert(_el$150, (() => {
        var _c$8 = _$memo(() => !!activity().attention);
        return () => _c$8() ? `${activity().attention} permintaan menunggu jawaban` : `MCP ${activity().mcp.length} aktif \xB7 Agent ${activity().agents.length} \xB7 Tugas ${activity().completed}/${activity().total}`;
      })());
      _$setProp(_el$151, "height", 1);
      _$insert(_el$151, (() => {
        var _c$9 = _$memo(() => !!activity().latest);
        return () => _c$9() ? `${activityDetail(activity().latest).status} \xB7 ${activityDetail(activity().latest).action}` : "Belum ada aktivitas tool";
      })());
      _$setProp(_el$152, "height", 1);
      _$insert(_el$152, (() => {
        var _c$0 = _$memo(() => !!activity().latest);
        return () => _c$0() ? activityDetail(activity().latest).target : "";
      })());
      _$insertNode(_el$153, _el$154);
      _$setProp(_el$153, "onMouseDown", (event) => {
        if (event.button === 0) {
          event.stopPropagation();
          open();
        }
      });
      _$insertNode(_el$154, _$createTextNode(`/studio-panel \xB7 detail`));
      _$setProp(_el$154, "height", 1);
      _$effect((_p$) => {
        var _v$19 = theme().backgroundPanel, _v$20 = theme().primary, _v$21 = theme().text, _v$22 = theme().textMuted, _v$23 = activity().attention ? theme().warning : theme().textMuted, _v$24 = theme().text, _v$25 = theme().textMuted, _v$26 = theme().primary;
        _v$19 !== _p$.e && (_p$.e = _$setProp(_el$142, "backgroundColor", _v$19, _p$.e));
        _v$20 !== _p$.t && (_p$.t = _$setProp(_el$145, "fg", _v$20, _p$.t));
        _v$21 !== _p$.a && (_p$.a = _$setProp(_el$148, "fg", _v$21, _p$.a));
        _v$22 !== _p$.o && (_p$.o = _$setProp(_el$149, "fg", _v$22, _p$.o));
        _v$23 !== _p$.i && (_p$.i = _$setProp(_el$150, "fg", _v$23, _p$.i));
        _v$24 !== _p$.n && (_p$.n = _$setProp(_el$151, "fg", _v$24, _p$.n));
        _v$25 !== _p$.s && (_p$.s = _$setProp(_el$152, "fg", _v$25, _p$.s));
        _v$26 !== _p$.h && (_p$.h = _$setProp(_el$154, "fg", _v$26, _p$.h));
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined,
        o: undefined,
        i: undefined,
        n: undefined,
        s: undefined,
        h: undefined
      });
      return _el$142;
    }
  });
}
function StatusBar(props) {
  const size = useTerminalDimensions();
  const theme = () => props.api.theme.current;
  const mcp = () => props.api.state.mcp();
  const plugins = () => props.api.plugins.list().filter((item) => item.source !== "internal");
  return (() => {
    var _el$156 = _$createElement("box"), _el$157 = _$createElement("text"), _el$158 = _$createElement("b"), _el$165 = _$createElement("text");
    _$insertNode(_el$156, _el$157);
    _$insertNode(_el$156, _el$165);
    _$setProp(_el$156, "flexDirection", "row");
    _$setProp(_el$156, "justifyContent", "space-between");
    _$setProp(_el$156, "paddingLeft", 1);
    _$setProp(_el$156, "paddingRight", 1);
    _$setProp(_el$156, "width", "100%");
    _$insertNode(_el$157, _el$158);
    _$insertNode(_el$158, _$createTextNode(`STUDIO`));
    _$insert(_el$156, _$createComponent(Show, {
      get when() {
        return size().width >= 65;
      },
      get children() {
        var _el$160 = _$createElement("text"), _el$161 = _$createTextNode(`/`), _el$162 = _$createTextNode(` MCP \xB7 `), _el$163 = _$createTextNode(`/`), _el$164 = _$createTextNode(` plugin TUI aktif`);
        _$insertNode(_el$160, _el$161);
        _$insertNode(_el$160, _el$162);
        _$insertNode(_el$160, _el$163);
        _$insertNode(_el$160, _el$164);
        _$insert(_el$160, () => mcp().filter((item) => item.status === "connected").length, _el$161);
        _$insert(_el$160, () => mcp().length, _el$162);
        _$insert(_el$160, () => plugins().filter((item) => item.active).length, _el$163);
        _$insert(_el$160, () => plugins().length, _el$164);
        _$effect((_$p) => _$setProp(_el$160, "fg", theme().textMuted, _$p));
        return _el$160;
      }
    }), _el$165);
    _$insert(_el$165, () => props.api.state.vcs?.branch ?? "lokal");
    _$effect((_p$) => {
      var _v$27 = theme().backgroundPanel, _v$28 = theme().primary, _v$29 = theme().textMuted;
      _v$27 !== _p$.e && (_p$.e = _$setProp(_el$156, "backgroundColor", _v$27, _p$.e));
      _v$28 !== _p$.t && (_p$.t = _$setProp(_el$157, "fg", _v$28, _p$.t));
      _v$29 !== _p$.a && (_p$.a = _$setProp(_el$165, "fg", _v$29, _p$.a));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined
    });
    return _el$156;
  })();
}
var plugin = {
  id: "saffteen-studio",
  tui: async (api, options) => {
    attentionFeedback(api);
    visualFeedback(api);
    const compacting = compactionMonitor(api);
    const [sidebarVisible, setSidebarVisible] = createSignal(false);
    const sessionID = () => {
      const route = api.route.current;
      return route.name === "session" && typeof route.params?.sessionID === "string" ? route.params.sessionID : undefined;
    };
    const [motion, setMotion] = createSignal(options?.motion !== false);
    const unregister = api.command?.register(() => [{
      title: motion() ? "Studio: matikan animasi avatar" : "Studio: aktifkan animasi avatar",
      value: "studio.avatar.motion",
      category: "Studio",
      slash: {
        name: "studio-motion"
      },
      onSelect: (dialog) => {
        setMotion((value) => !value);
        dialog?.clear();
      }
    }]);
    if (unregister)
      api.lifecycle.onDispose(unregister);
    api.slots.register({
      order: 10,
      slots: {
        home_logo() {
          return _$createComponent(Welcome, {
            api,
            get motion() {
              return motion();
            }
          });
        },
        home_bottom() {
          return (() => {
            var _el$166 = _$createElement("box"), _el$167 = _$createElement("text");
            _$insertNode(_el$166, _el$167);
            _$setProp(_el$166, "width", "100%");
            _$setProp(_el$166, "maxWidth", 96);
            _$setProp(_el$166, "paddingLeft", 2);
            _$setProp(_el$166, "paddingRight", 2);
            _$setProp(_el$166, "marginTop", 1);
            _$insertNode(_el$167, _$createTextNode(`/ perintah \xB7 @ berkas & agent \xB7 ! shell`));
            _$effect((_$p) => _$setProp(_el$167, "fg", api.theme.current.textMuted, _$p));
            return _el$166;
          })();
        },
        home_footer() {
          return (() => {
            var _el$169 = _$createElement("text"), _el$170 = _$createTextNode(`SAFFTEEN STUDIO / OpenCode `);
            _$insertNode(_el$169, _el$170);
            _$insert(_el$169, () => api.app.version, null);
            _$effect((_$p) => _$setProp(_el$169, "fg", api.theme.current.textMuted, _$p));
            return _el$169;
          })();
        },
        sidebar_title(_ctx, props) {
          return (() => {
            var _el$171 = _$createElement("box"), _el$172 = _$createElement("text"), _el$173 = _$createElement("b"), _el$175 = _$createElement("text"), _el$176 = _$createElement("b");
            _$insertNode(_el$171, _el$172);
            _$insertNode(_el$171, _el$175);
            _$setProp(_el$171, "gap", 1);
            _$setProp(_el$171, "paddingBottom", 1);
            _$insertNode(_el$172, _el$173);
            _$insertNode(_el$173, _$createTextNode(`STUDIO / SESI`));
            _$insertNode(_el$175, _el$176);
            _$setProp(_el$175, "wrapMode", "word");
            _$insert(_el$176, () => props.title);
            _$insert(_el$171, _$createComponent(Show, {
              get when() {
                return props.share_url;
              },
              get children() {
                var _el$177 = _$createElement("text");
                _$setProp(_el$177, "wrapMode", "char");
                _$insert(_el$177, () => props.share_url);
                _$effect((_$p) => _$setProp(_el$177, "fg", api.theme.current.textMuted, _$p));
                return _el$177;
              }
            }), null);
            _$effect((_p$) => {
              var _v$30 = api.theme.current.primary, _v$31 = api.theme.current.text;
              _v$30 !== _p$.e && (_p$.e = _$setProp(_el$172, "fg", _v$30, _p$.e));
              _v$31 !== _p$.t && (_p$.t = _$setProp(_el$175, "fg", _v$31, _p$.t));
              return _p$;
            }, {
              e: undefined,
              t: undefined
            });
            return _el$171;
          })();
        },
        sidebar_content(_ctx, props) {
          return _$createComponent(SidebarPresence, {
            visible: setSidebarVisible,
            get children() {
              return _$createComponent(Overview, {
                api,
                get id() {
                  return props.session_id;
                },
                get motion() {
                  return motion();
                },
                get compacting() {
                  return compacting(props.session_id);
                }
              });
            }
          });
        },
        sidebar_footer() {
          return (() => {
            var _el$178 = _$createElement("text");
            _$insertNode(_el$178, _$createTextNode(`SAFFTEEN STUDIO \xB7 0.1`));
            _$effect((_$p) => _$setProp(_el$178, "fg", api.theme.current.textMuted, _$p));
            return _el$178;
          })();
        },
        app_bottom() {
          return (() => {
            var _el$180 = _$createElement("box");
            _$setProp(_el$180, "flexShrink", 0);
            _$insert(_el$180, _$createComponent(Show, {
              get when() {
                return sessionID();
              },
              children: (id) => _$createComponent(ResponsiveDock, {
                api,
                get id() {
                  return id();
                },
                get sidebarVisible() {
                  return sidebarVisible();
                },
                get motion() {
                  return motion();
                },
                get compacting() {
                  return compacting(id());
                }
              })
            }), null);
            _$insert(_el$180, _$createComponent(StatusBar, {
              api
            }), null);
            return _el$180;
          })();
        }
      }
    });
  }
};
var tui_default = plugin;
export {
  Companion,
  InfoCard,
  ObservedWait,
  Overview,
  ResponsiveDock,
  SidebarPresence,
  Welcome,
  attentionFeedback,
  compactionMonitor,
  tui_default as default,
  desktopNotification,
  holdKeyboardPose,
  retainActivity,
  visualFeedback,
  waitingReason
};
