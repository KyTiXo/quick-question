import { describe, expect, it } from "bun:test"

import {
  configFieldByKey,
  configKeys,
  DEFAULT_HOST,
  DEFAULT_MODEL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_PROVIDER,
  DEFAULT_TIMEOUT_MS,
  defaultHostFor,
  envKeys,
  falsyValues,
  joinQuestion,
  maskSecret,
  normalizeHost,
  providerValues,
  trimToUndefined,
  truthyValues,
} from "@/domain/config"

describe("domain/config", () => {
  it("exposes defaults and config metadata", () => {
    expect(DEFAULT_PROVIDER).toBe("ollama")
    expect(DEFAULT_MODEL).toBe("qwen3.5:2b")
    expect(DEFAULT_HOST).toBe("http://127.0.0.1:11434")
    expect(DEFAULT_OPENAI_BASE_URL).toBe("https://api.openai.com/v1")
    expect(DEFAULT_TIMEOUT_MS).toBe(90_000)
    expect(configKeys).toEqual(["provider", "model", "host", "api-key", "timeout-ms", "thinking"])
    expect(providerValues).toEqual(["ollama", "openai"])
    expect(configFieldByKey["api-key"]).toBe("apiKey")
    expect(envKeys.openAiApiKey).toBe("OPENAI_API_KEY")
  })

  it("normalizes basic config helpers", () => {
    expect(joinQuestion([" what", "changed? "])).toBe("what changed?")
    expect(maskSecret("secret")).toBe("***")
    expect(maskSecret("")).toBe("")
    expect(trimToUndefined("  value  ")).toBe("value")
    expect(trimToUndefined("   ")).toBeUndefined()
    expect(normalizeHost(" https://api.example.com/// ")).toBe("https://api.example.com")
  })

  it("picks provider hosts and truthy sets", () => {
    expect(defaultHostFor("ollama")).toBe(DEFAULT_HOST)
    expect(defaultHostFor("openai")).toBe(DEFAULT_OPENAI_BASE_URL)
    expect(truthyValues.has("yes")).toBe(true)
    expect(falsyValues.has("off")).toBe(true)
  })
})
