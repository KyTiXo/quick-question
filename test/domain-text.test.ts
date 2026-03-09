import { describe, expect, it } from "bun:test"

import {
  ensureTrailingNewline,
  hasPromptLikeTail,
  hasRedrawSignal,
  looksLikeBadDistillation,
  normalizeForModel,
  structuralSimilarity,
} from "@/domain/text"

describe("domain/text", () => {
  it("normalizes terminal output for models", () => {
    expect(normalizeForModel("a\r\nb\u001b[31m!\u001b[0m  \n\n\nc\r")).toBe("a\nb!\n\nc")
  })

  it("detects prompts and redraws", () => {
    expect(hasPromptLikeTail("Password:")).toBe(true)
    expect(hasPromptLikeTail("done")).toBe(false)
    expect(hasRedrawSignal("line\r")).toBe(true)
    expect(hasRedrawSignal("\u001b[2Jclear")).toBe(true)
    expect(hasRedrawSignal("\u001bcreset")).toBe(true)
    expect(hasRedrawSignal("steady")).toBe(false)
  })

  it("computes structural similarity", () => {
    expect(structuralSimilarity("", "abc")).toBe(0)
    expect(structuralSimilarity("Error 123", "error 999")).toBe(1)
    expect(structuralSimilarity("left only", "right only")).toBe(0)
  })

  it("rejects bad distillations and accepts compact summaries", () => {
    const longSource = "x".repeat(1200)

    expect(looksLikeBadDistillation("source", "")).toBe(true)
    expect(looksLikeBadDistillation("source", "Please provide more details")).toBe(true)
    expect(looksLikeBadDistillation(longSource, "y".repeat(960))).toBe(true)
    expect(looksLikeBadDistillation("abc", "abc")).toBe(true)
    expect(looksLikeBadDistillation("abc", "x".repeat(50))).toBe(true)
    expect(looksLikeBadDistillation("a long enough input", "short answer")).toBe(false)
  })

  it("ensures a trailing newline", () => {
    expect(ensureTrailingNewline("hello")).toBe("hello\n")
    expect(ensureTrailingNewline("hello\n")).toBe("hello\n")
  })
})
