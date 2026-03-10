import { describe, expect, it } from "bun:test"
import { Prompt } from "effect/unstable/ai"
import {
  buildBatchPrompt,
  buildWatchPrompt,
  renderPrompt,
  splitPromptForLocalChat,
} from "@/domain/prompt"

describe("domain/prompt", () => {
  it("renders string and structured prompt messages", () => {
    const rendered = renderPrompt([
      Prompt.makeMessage("system", { content: "rules" }),
      Prompt.makeMessage("assistant", {
        content: [
          Prompt.makePart("text", { text: "text" }),
          Prompt.makePart("reasoning", { text: "reasoning" }),
          Prompt.makePart("file", {
            fileName: "report.txt",
            mediaType: "text/plain",
            data: new Uint8Array([1]),
          }),
          Prompt.makePart("tool-call", {
            id: "call-1",
            name: "run",
            params: { cwd: "." },
            providerExecuted: false,
          }),
          Prompt.makePart("tool-result", {
            id: "call-1",
            name: "run",
            isFailure: false,
            result: "ok",
          }),
          Prompt.makePart("tool-approval-request", {
            approvalId: "approval-1",
            toolCallId: "call-1",
          }),
        ],
      }),
      Prompt.makeMessage("tool", {
        content: [
          Prompt.makePart("tool-approval-response", {
            approvalId: "approval-1",
            approved: true,
          }),
        ],
      }),
    ])

    expect(rendered).toContain("SYSTEM:\nrules")
    expect(rendered).toContain("[file report.txt]")
    expect(rendered).toContain("[tool-call run]")
    expect(rendered).toContain("[tool-result run]")
    expect(rendered).toContain("[tool-approval-request]")
    expect(rendered).toContain("[tool-approval-response]")
  })

  it("builds batch and watch prompts", () => {
    const batch = renderPrompt(buildBatchPrompt("what changed?", "diff"))
    const watch = renderPrompt(buildWatchPrompt("what changed?", "before", "after"))
    const local = splitPromptForLocalChat(buildBatchPrompt("what changed?", "diff"))

    expect(batch).toContain("Question: what changed?\n\nCommand output:\ndiff")
    expect(batch).toContain("quick-question: Insufficient information")
    expect(watch).toContain("Previous cycle:\nbefore")
    expect(watch).toContain("Current cycle:\nafter")
    expect(local.systemPrompt).toContain("You compress command output")
    expect(local.prompt).toBe("Question: what changed?\n\nCommand output:\ndiff")
  })
})
