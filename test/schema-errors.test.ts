import { describe, expect, it } from "bun:test"

import { ConfigStoreError, DistillError, ModelError, UsageError } from "@/schema/errors"

describe("schema/errors", () => {
  it("exposes error messages", () => {
    expect(new UsageError({ detail: "usage", exitCode: 2 }).message).toBe("usage")
    expect(new ConfigStoreError({ detail: "config" }).message).toBe("config")
    expect(new ModelError({ detail: "model" }).message).toBe("model")
    expect(new DistillError({ detail: "distill" }).message).toBe("distill")
  })

  it("exposes error detail with and without cause", () => {
    const inner = new Error("inner cause")
    expect(new UsageError({ detail: "usage", exitCode: 2, cause: inner }).detail).toBe("usage")
    expect(new ConfigStoreError({ detail: "config", cause: inner }).detail).toBe("config")
    expect(new ModelError({ detail: "model", cause: inner }).detail).toBe("model")
    expect(new DistillError({ detail: "distill", cause: inner }).detail).toBe("distill")

    expect(new UsageError({ detail: "usage2", exitCode: 1 }).detail).toBe("usage2")
    expect(new ConfigStoreError({ detail: "config2" }).detail).toBe("config2")
    expect(new ModelError({ detail: "model2" }).detail).toBe("model2")
    expect(new DistillError({ detail: "distill2" }).detail).toBe("distill2")
  })
})
