import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { BunServices } from "@effect/platform-bun"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { ConfigStore } from "@/services/config-store"

import { captureRuntime } from "./support"

const tempDirs: Array<string> = []

const makeStore = (env: Record<string, string | undefined>) =>
  Effect.runPromise(
    ConfigStore.make.pipe(
      Effect.provide(Layer.mergeAll(BunServices.layer, captureRuntime({ env }).runtimeLayer))
    )
  )

const makeTempDir = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "qq-config-"))
  tempDirs.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

describe("services/config-store", () => {
  it("reads, writes, gets, and displays config at an explicit path", async () => {
    const directory = await makeTempDir()
    const configPath = path.join(directory, "config.json")
    const store = await makeStore({
      QQ_CONFIG_PATH: configPath,
    })

    expect(await Effect.runPromise(store.read())).toEqual({})
    expect(await Effect.runPromise(store.resolvePath())).toBe(configPath)

    await Effect.runPromise(store.set("model", "qwen"))
    await Effect.runPromise(store.set("api-key", "secret"))
    await Effect.runPromise(store.set("timeout-ms", 123))

    expect(await Effect.runPromise(store.get("model"))).toBe("qwen")
    expect(await readFile(configPath, "utf8")).toContain('"model":"qwen"')
    expect(await Effect.runPromise(store.showLines())).toEqual([
      `path=${configPath}`,
      "provider=",
      "model=qwen",
      "host=",
      "api-key=***",
      "timeout-ms=123",
      "thinking=",
    ])
  })

  it("uses $HOME/.config/qq/config.json when no explicit or XDG path", async () => {
    const directory = await makeTempDir()
    const store = await makeStore({
      HOME: directory,
    })

    expect(await Effect.runPromise(store.resolvePath())).toBe(
      path.join(directory, ".config", "qq", "config.json")
    )
    expect(await Effect.runPromise(store.read())).toEqual({})
    await Effect.runPromise(store.set("model", "qwen"))
    expect(await Effect.runPromise(store.get("model"))).toBe("qwen")
  })

  it("uses xdg config paths when present", async () => {
    const directory = await makeTempDir()
    const store = await makeStore({
      XDG_CONFIG_HOME: directory,
    })

    expect(await Effect.runPromise(store.resolvePath())).toBe(
      path.join(directory, "qq", "config.json")
    )
  })

  it("fails when it cannot resolve a home directory", async () => {
    const store = await makeStore({})

    await expect(Effect.runPromise(store.resolvePath())).rejects.toThrow(
      "Could not resolve a home directory for qq config."
    )
  })

  it("rejects invalid config json", async () => {
    const directory = await makeTempDir()
    const configPath = path.join(directory, "config.json")
    await writeFile(configPath, "{ nope")
    const store = await makeStore({
      QQ_CONFIG_PATH: configPath,
    })

    await expect(Effect.runPromise(store.read())).rejects.toThrow("qq config file is invalid JSON.")
  })

  it("rejects values that cannot be encoded", async () => {
    const directory = await makeTempDir()
    const configPath = path.join(directory, "config.json")
    const store = await makeStore({
      QQ_CONFIG_PATH: configPath,
    })

    await expect(
      Effect.runPromise(store.set("model", Symbol("bad") as unknown as string))
    ).rejects.toThrow("Failed encoding qq config.")
  })

  it("exposes the live config-store layer", async () => {
    const directory = await makeTempDir()
    const configPath = path.join(directory, "config.json")
    const runtime = captureRuntime({
      env: { QQ_CONFIG_PATH: configPath },
    })
    const service = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* ConfigStore
      }).pipe(
        Effect.provide(
          ConfigStore.Live.pipe(
            Layer.provide(Layer.mergeAll(BunServices.layer, runtime.runtimeLayer))
          )
        )
      )
    )

    expect(new ConfigStore(undefined as never)).toBeInstanceOf(ConfigStore)
    expect(await Effect.runPromise(service.resolvePath())).toBe(configPath)
  })
})
