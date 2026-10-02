import { expect, test } from "bun:test"
import type { Message, Part, Session } from "@opencode-ai/sdk/v2"
import { elapsedLabel, subagentDetails } from "./subagent"

test("subagent reports its own model, active tool and actual todo counts", () => {
  const messages = [{
    info: { role: "assistant", providerID: "child-provider", modelID: "child-model" } as Message,
    parts: [{ id: "part", sessionID: "child", messageID: "message", callID: "call", type: "tool", tool: "read", state: { status: "running", input: { filePath: "child/service.ts" }, time: { start: 1000 } } } as Part],
  }]
  const result = subagentDetails({ time: { created: 1000 } } as Session, messages, [{ content: "API", status: "completed", priority: "high" }, { content: "Tests", status: "in_progress", priority: "high" }])
  expect(result.model).toBe("child-provider / child-model")
  expect(result.current).toBe(true)
  expect(result.activity?.target).toBe("child/service.ts")
  expect(result.completed).toBe(1)
  expect(result.todos).toHaveLength(2)
  expect(elapsedLabel(result.started, 62000)).toBe("1m 1d")
  expect(elapsedLabel(result.started, 3662000)).toBe("1j 1m 1d")
})

test("unreported child model and progress do not inherit parent or invent a percentage", () => {
  expect(subagentDetails(undefined, [], [])).toMatchObject({ model: "Model belum dilaporkan", current: false, activity: undefined, completed: 0, todos: [] })
  expect(elapsedLabel(undefined, Date.now())).toBe("Durasi belum tersedia")
  expect(elapsedLabel(10000, 5000)).toBe("0m 0d")
})
