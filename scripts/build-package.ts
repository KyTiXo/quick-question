import { spawnSync } from "node:child_process"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const externalModules = ["node-llama-cpp"]

const runBuild = (entrypoint: string, outfile: string) => {
  const result = spawnSync(
    "bun",
    [
      "build",
      "--target=node",
      ...externalModules.flatMap((moduleName) => ["--external", moduleName]),
      `--outfile=${outfile}`,
      entrypoint,
    ],
    {
      cwd: root,
      stdio: "inherit",
    }
  )

  if (result.status !== 0) {
    throw new Error(`Failed to build ${path.relative(root, entrypoint)}.`)
  }
}

await rm(path.join(root, "dist"), { force: true, recursive: true })
await mkdir(path.join(root, "dist"), { recursive: true })

runBuild(path.join(root, "src", "app", "main.ts"), path.join(root, "dist", "qq.js"))
runBuild(path.join(root, "index.ts"), path.join(root, "dist", "index.js"))
