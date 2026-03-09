import { describe, expect, it } from "bun:test"

import { BINARY_NAME, COMPILE_TARGETS, VERSION } from "@/app/version"
import packageJson from "../package.json" with { type: "json" }

describe("app/version", () => {
  it("defines compile targets including windows artifacts", () => {
    expect(VERSION).toBe(packageJson.version)
    expect(BINARY_NAME).toBe("qq")
    expect(COMPILE_TARGETS.map((target) => target.bunTarget)).toEqual([
      "bun-darwin-arm64",
      "bun-darwin-x64",
      "bun-linux-arm64",
      "bun-linux-x64",
      "bun-linux-x64-baseline",
      "bun-linux-x64-modern",
      "bun-windows-x64",
      "bun-windows-x64-baseline",
      "bun-windows-x64-modern",
    ])
    expect(COMPILE_TARGETS.at(-1)?.output).toBe(".dist/bun-windows-x64-modern/qq.exe")
  })
})
