import { spawnSync } from "node:child_process"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const cli = path.join(root, "src", "app", "main.ts")
const diff = [
  "diff --git a/src/app.ts b/src/app.ts",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,4 +1,6 @@",
  " const country = user.country",
  "+const isInUSA = country === 'US'",
  " const hidden = false",
  "+const shouldHideKlarna = hidden && isInUSA",
  "+render({ shouldHideKlarna })",
].join("\n")

const result = spawnSync("bun", ["run", cli, "what changed?"], {
  cwd: root,
  encoding: "utf8",
  input: diff,
  env: {
    ...process.env,
    QQ_TIMEOUT_MS: "90000",
  },
})

if (result.status !== 0) {
  throw new Error(result.stderr || `live smoke failed with status ${String(result.status)}`)
}

if (result.stderr !== "") {
  throw new Error(`expected empty stderr, got: ${result.stderr}`)
}

if (result.stdout.trim().length === 0 || result.stdout.trim().length >= diff.length) {
  throw new Error("live smoke produced an invalid summary")
}
