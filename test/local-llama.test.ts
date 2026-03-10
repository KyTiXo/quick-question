import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { NodeServices } from "@effect/platform-node"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { ConfigStore } from "@/services/config-store"
import { LocalLlama, localLlamaOps } from "@/services/local-llama"

import { captureRuntime, getEffectError } from "./support"

const tempDirs: Array<string> = []
const originalImportModule = localLlamaOps.importModule
const maxTokens = 200

const makeTempDir = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "qq-local-"))
  tempDirs.push(directory)
  return directory
}

const makeConfigStoreLayer = (configPath: string) => {
  const runtime = captureRuntime({
    env: { QQ_CONFIG_PATH: configPath },
  })

  return {
    configStoreLayer: ConfigStore.Live.pipe(
      Layer.provide(Layer.mergeAll(NodeServices.layer, runtime.runtimeLayer))
    ),
    runtimeLayer: runtime.runtimeLayer,
  }
}

const makeLocalLlama = (configPath: string) => {
  const { configStoreLayer, runtimeLayer } = makeConfigStoreLayer(configPath)

  return Effect.runPromise(
    Effect.scoped(LocalLlama.make).pipe(
      Effect.provide(Layer.mergeAll(NodeServices.layer, runtimeLayer, configStoreLayer))
    )
  )
}

afterEach(async () => {
  localLlamaOps.importModule = originalImportModule
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

describe("services/local-llama", () => {
  it("downloads hf models into the qq cache directory and reuses loaded state", async () => {
    const directory = await makeTempDir()
    const configPath = path.join(directory, "config.json")
    const calls = {
      completionCreates: 0,
      contextCreates: 0,
      generate: 0,
      loadModel: [] as string[],
      resolved: [] as Array<{ model: string; directory: string | undefined }>,
    }

    class FakeCompletion {
      constructor(_options: unknown) {
        calls.completionCreates += 1
      }

      generateCompletion(_prompt: string, options?: { maxTokens?: number; temperature?: number }) {
        calls.generate += 1
        expect(options?.maxTokens).toBe(maxTokens)
        expect(options?.temperature).toBe(0.1)
        return Promise.resolve(" local answer ")
      }

      dispose() {
        return undefined
      }
    }

    localLlamaOps.importModule = () =>
      Promise.resolve({
        LlamaCompletion: FakeCompletion,
        getLlama: () =>
          Promise.resolve({
            loadModel: ({ modelPath }: { modelPath: string }) => {
              calls.loadModel.push(modelPath)

              return Promise.resolve({
                createContext: () => {
                  calls.contextCreates += 1

                  return Promise.resolve({
                    dispose: () => Promise.resolve(undefined),
                    getSequence: () => ({ id: "sequence" }),
                  })
                },
                dispose: () => Promise.resolve(undefined),
              })
            },
          }),
        resolveModelFile: (model: string, options?: { directory?: string }) => {
          calls.resolved.push({ model, directory: options?.directory })
          return Promise.resolve(path.join(options?.directory ?? directory, "downloaded.gguf"))
        },
      }) as never

    const service = await makeLocalLlama(configPath)

    expect(
      await Effect.runPromise(
        service.generateText({
          model: "hf:unsloth/Qwen3.5-2B-GGUF/Qwen3.5-2B-Q4_K_M.gguf",
          prompt: "first",
          timeoutMs: 100,
          maxTokens,
        })
      )
    ).toBe("local answer")

    expect(
      await Effect.runPromise(
        service.generateText({
          model: "hf:unsloth/Qwen3.5-2B-GGUF/Qwen3.5-2B-Q4_K_M.gguf",
          prompt: "second",
          timeoutMs: 100,
          maxTokens,
        })
      )
    ).toBe("local answer")

    expect(calls.resolved).toEqual([
      {
        model: "hf:unsloth/Qwen3.5-2B-GGUF/Qwen3.5-2B-Q4_K_M.gguf",
        directory: path.join(directory, "models"),
      },
    ])
    expect(calls.loadModel).toEqual([path.join(directory, "models", "downloaded.gguf")])
    expect(calls.contextCreates).toBe(1)
    expect(calls.completionCreates).toBe(1)
    expect(calls.generate).toBe(2)
  })

  it("passes local file paths through to model resolution", async () => {
    const directory = await makeTempDir()
    const configPath = path.join(directory, "config.json")
    const modelPath = path.join(directory, "already.gguf")
    await writeFile(modelPath, "gguf")
    const loadModelCalls: Array<string> = []

    class FakeCompletion {
      generateCompletion() {
        return Promise.resolve("ok")
      }

      dispose() {
        return undefined
      }
    }

    localLlamaOps.importModule = () =>
      Promise.resolve({
        LlamaCompletion: FakeCompletion,
        getLlama: () =>
          Promise.resolve({
            loadModel: ({ modelPath }: { modelPath: string }) => {
              loadModelCalls.push(modelPath)

              return Promise.resolve({
                createContext: () =>
                  Promise.resolve({
                    dispose: () => Promise.resolve(undefined),
                    getSequence: () => ({ id: "sequence" }),
                  }),
                dispose: () => Promise.resolve(undefined),
              })
            },
          }),
        resolveModelFile: (model: string) => Promise.resolve(model),
      }) as never

    const service = await makeLocalLlama(configPath)

    expect(
      await Effect.runPromise(
        service.generateText({
          model: modelPath,
          prompt: "hello",
          timeoutMs: 100,
          maxTokens,
        })
      )
    ).toBe("ok")

    expect(loadModelCalls).toEqual([modelPath])
  })

  it("maps local runtime failures to model errors", async () => {
    const directory = await makeTempDir()
    const configPath = path.join(directory, "config.json")

    localLlamaOps.importModule = () => Promise.reject(new Error("missing binary"))

    const service = await makeLocalLlama(configPath)

    const prepareError = await getEffectError(
      service.generateText({
        model: "hf:unsloth/Qwen3.5-2B-GGUF/Qwen3.5-2B-Q4_K_M.gguf",
        prompt: "hello",
        timeoutMs: 100,
        maxTokens,
      })
    )
    expect((prepareError as Error).message).toContain("Failed preparing local model")

    const trustError = await getEffectError(
      service.generateText({
        model: "hf:unsloth/Qwen3.5-2B-GGUF/Qwen3.5-2B-Q4_K_M.gguf",
        prompt: "hello",
        timeoutMs: 100,
        maxTokens,
      })
    )
    expect((trustError as Error).message).toContain("bun pm trust node-llama-cpp")
  })

  it("rejects empty local completions", async () => {
    const directory = await makeTempDir()
    const configPath = path.join(directory, "config.json")

    class FakeCompletion {
      generateCompletion() {
        return Promise.resolve("   ")
      }

      dispose() {
        return undefined
      }
    }

    localLlamaOps.importModule = () =>
      Promise.resolve({
        LlamaCompletion: FakeCompletion,
        getLlama: () =>
          Promise.resolve({
            loadModel: () =>
              Promise.resolve({
                createContext: () =>
                  Promise.resolve({
                    dispose: () => Promise.resolve(undefined),
                    getSequence: () => ({ id: "sequence" }),
                  }),
                dispose: () => Promise.resolve(undefined),
              }),
          }),
        resolveModelFile: () => Promise.resolve(path.join(directory, "downloaded.gguf")),
      }) as never

    const service = await makeLocalLlama(configPath)

    const error = await getEffectError(
      service.generateText({
        model: "hf:unsloth/Qwen3.5-2B-GGUF/Qwen3.5-2B-Q4_K_M.gguf",
        prompt: "hello",
        timeoutMs: 100,
        maxTokens,
      })
    )
    expect((error as Error).message).toBe("Local provider returned an empty response.")
  })
})
