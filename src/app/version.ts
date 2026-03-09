import packageJson from "../../package.json" with { type: "json" }

export const VERSION = packageJson.version
export const BINARY_NAME = "qq"

export const COMPILE_TARGETS = [
  {
    bunTarget: "bun-darwin-arm64",
    output: ".dist/bun-darwin-arm64/qq",
  },
  {
    bunTarget: "bun-darwin-x64",
    output: ".dist/bun-darwin-x64/qq",
  },
  {
    bunTarget: "bun-linux-arm64",
    output: ".dist/bun-linux-arm64/qq",
  },
  {
    bunTarget: "bun-linux-x64",
    output: ".dist/bun-linux-x64/qq",
  },
  {
    bunTarget: "bun-linux-x64-baseline",
    output: ".dist/bun-linux-x64-baseline/qq",
  },
  {
    bunTarget: "bun-linux-x64-modern",
    output: ".dist/bun-linux-x64-modern/qq",
  },
  {
    bunTarget: "bun-windows-x64",
    output: ".dist/bun-windows-x64/qq.exe",
  },
  {
    bunTarget: "bun-windows-x64-baseline",
    output: ".dist/bun-windows-x64-baseline/qq.exe",
  },
  {
    bunTarget: "bun-windows-x64-modern",
    output: ".dist/bun-windows-x64-modern/qq.exe",
  },
] as const
