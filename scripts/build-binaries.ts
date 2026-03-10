import { spawnSync } from "node:child_process"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { COMPILE_TARGETS } from "../src/app/version"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const entrypoint = path.join(root, "src", "app", "main.ts")
const forceAllTargets = process.argv.includes("--all")

const targetsEnv = process.env.QQ_TARGETS
const targets =
  !forceAllTargets && targetsEnv
    ? COMPILE_TARGETS.filter((t) =>
        targetsEnv
          .split(",")
          .map((s) => s.trim())
          .includes(t.bunTarget)
      )
    : [...COMPILE_TARGETS]

await rm(path.join(root, ".dist"), { force: true, recursive: true })

for (const target of targets) {
  const outfile = path.join(root, target.output)
  await mkdir(path.dirname(outfile), { recursive: true })

  const result = spawnSync(
    "bun",
    ["build", "--compile", `--target=${target.bunTarget}`, `--outfile=${outfile}`, entrypoint],
    {
      cwd: root,
      stdio: "inherit",
    }
  )

  if (result.status !== 0) {
    throw new Error(`Failed to compile ${target.bunTarget}.`)
  }
}
