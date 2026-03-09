import path from "node:path"

import { COMPILE_TARGETS } from "../src/app/version"

const root = path.resolve(import.meta.dir, "..")
const missing: string[] = []

for (const target of COMPILE_TARGETS) {
  const outfile = path.join(root, target.output)
  const exists = await Bun.file(outfile).exists()
  if (!exists) {
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
