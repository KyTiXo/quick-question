import { access } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { COMPILE_TARGETS } from "../src/app/version"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const missing: string[] = []

for (const target of COMPILE_TARGETS) {
  const outfile = path.join(root, target.output)
  try {
    await access(outfile)
  } catch {
    missing.push(target.output)
  }
}

if (missing.length) {
  console.error("[qq] Missing required dist artifacts:")
  for (const file of missing) {
    console.error(`- ${file}`)
  }
  process.exit(1)
}

console.log("[qq] All required dist artifacts are present.")
