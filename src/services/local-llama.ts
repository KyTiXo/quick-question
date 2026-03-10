import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as ServiceMap from "effect/ServiceMap"
import { modelsDirectoryForConfigPath } from "@/domain/config"
import { ModelError } from "@/schema/errors"
import { ConfigStore } from "@/services/config-store"

type NodeLlamaModule = typeof import("node-llama-cpp")
type LlamaRuntime = Awaited<ReturnType<NodeLlamaModule["getLlama"]>>
type LocalModel = Awaited<ReturnType<LlamaRuntime["loadModel"]>>
type LocalContext = Awaited<ReturnType<LocalModel["createContext"]>>
type LocalChatSession = InstanceType<NodeLlamaModule["LlamaChatSession"]>

interface LoadedLocalModel {
  context: LocalContext
  model: LocalModel
  modelPath: string
}

const trustHint = "If you installed qq with Bun, run `bun pm trust node-llama-cpp` and retry."

const localModelError = (detail: string, cause?: unknown) => new ModelError({ detail, cause })

const resolveLocalModelError = (model: string, cause: unknown) =>
  localModelError(`Failed preparing local model "${model}". ${trustHint}`, cause)

const resolveLocalGenerationError = (cause: unknown) =>
  localModelError("Local provider failed while generating text.", cause)

const disposeLoadedLocalModel = (loaded: LoadedLocalModel) =>
  Promise.allSettled([loaded.context.dispose(), loaded.model.dispose()]).then(() => undefined)

export const localLlamaOps = {
  importModule: () => import("node-llama-cpp"),
}

export class LocalLlama extends ServiceMap.Service<LocalLlama>()("LocalLlama", {
  make: Effect.gen(function* () {
    const configStore = yield* ConfigStore
    const fs = yield* FileSystem.FileSystem
    const loadedModels = new Map<string, Promise<LoadedLocalModel>>()
    const resources = new Map<string, LoadedLocalModel>()
    let modulePromise: Promise<NodeLlamaModule> | undefined
    let llamaPromise: Promise<LlamaRuntime> | undefined

    const loadModule = () => {
      if (!modulePromise) {
        modulePromise = localLlamaOps.importModule().catch((error: unknown) => {
          modulePromise = undefined
          throw error
        })
      }

      return modulePromise
    }

    const loadLlama = () => {
      if (!llamaPromise) {
        llamaPromise = loadModule()
          .then((module) => module.getLlama())
          .catch((error: unknown) => {
            llamaPromise = undefined
            throw error
          })
      }

      return llamaPromise
    }

    const loadModel = (model: string, modelsDirectory: string) => {
      const cacheKey = `${modelsDirectory}:${model}`
      const existing = loadedModels.get(cacheKey)

      if (existing) {
        return existing
      }

      const pending = Promise.all([loadModule(), loadLlama()])
        .then(async ([module, llama]) => {
          const modelPath = await module.resolveModelFile(model, {
            directory: modelsDirectory,
            cli: false,
            download: "auto",
          })
          const loadedModel = await llama.loadModel({ modelPath })
          const context = await loadedModel.createContext()
          const loaded = {
            context,
            model: loadedModel,
            modelPath,
          } satisfies LoadedLocalModel

          resources.set(cacheKey, loaded)
          return loaded
        })
        .catch((error: unknown) => {
          loadedModels.delete(cacheKey)
          throw error
        })

      loadedModels.set(cacheKey, pending)
      return pending
    }

    return yield* Effect.acquireRelease(
      Effect.succeed({
        generateText: ({
          model,
          systemPrompt,
          prompt,
          timeoutMs,
          maxTokens,
        }: {
          model: string
          systemPrompt?: string
          prompt: string
          timeoutMs: number
          maxTokens: number
        }) =>
          Effect.gen(function* () {
            const configPath = yield* configStore
              .resolvePath()
              .pipe(
                Effect.mapError((cause) =>
                  localModelError("Failed resolving qq local model cache directory.", cause)
                )
              )
            const modelsDirectory = modelsDirectoryForConfigPath(configPath)

            yield* fs
              .makeDirectory(modelsDirectory, { recursive: true })
              .pipe(
                Effect.mapError((cause) =>
                  localModelError("Failed creating qq local model cache directory.", cause)
                )
              )

            const module = yield* Effect.tryPromise({
              try: () => loadModule(),
              catch: (cause) => resolveLocalModelError(model, cause),
            })
            const loaded = yield* Effect.tryPromise({
              try: () => loadModel(model, modelsDirectory),
              catch: (cause) => resolveLocalModelError(model, cause),
            })

            const response = yield* Effect.tryPromise({
              try: async () => {
                const controller = new AbortController()
                let session: LocalChatSession | undefined
                const timeout = setTimeout(() => {
                  controller.abort(
                    new Error(`Local provider timed out after ${String(timeoutMs)}ms.`)
                  )
                }, timeoutMs)

                try {
                  session = new module.LlamaChatSession({
                    contextSequence: loaded.context.getSequence(),
                    systemPrompt,
                    autoDisposeSequence: true,
                  })

                  const completion = await session.prompt(prompt, {
                    maxTokens,
                    temperature: 0.1,
                    trimWhitespaceSuffix: true,
                    signal: controller.signal,
                  })

                  return typeof completion === "string" ? completion : String(completion)
                } finally {
                  clearTimeout(timeout)
                  session?.dispose()
                }
              },
              catch: (cause) => resolveLocalGenerationError(cause),
            })
            const trimmed = response.trim()

            if (!trimmed) {
              return yield* Effect.fail(
                new ModelError({
                  detail: "Local provider returned an empty response.",
                })
              )
            }

            return trimmed
          }),
      }),
      () =>
        Effect.promise(() =>
          Promise.allSettled(Array.from(resources.values(), disposeLoadedLocalModel)).then(
            () => undefined
          )
        )
    )
  }),
}) {
  static Live = Layer.effect(this, this.make)
}
