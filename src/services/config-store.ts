import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as ServiceMap from "effect/ServiceMap"
import { configFieldByKey, envKeys, maskSecret, trimToUndefined } from "@/domain/config"
import { AppRuntime } from "@/platform/runtime"
import { decodePersistedConfigJson, encodePersistedConfigJson } from "@/schema/config"
import { ConfigStoreError } from "@/schema/errors"

const configPathForEnv = (path: Path.Path, env: Record<string, string | undefined>) => {
  const explicit = trimToUndefined(env[envKeys.configPath])

  if (explicit) {
    return Effect.succeed(explicit)
  }

  const xdg = trimToUndefined(env.XDG_CONFIG_HOME)

  if (xdg) {
    return Effect.succeed(path.join(xdg, "qq", "config.json"))
  }

  const home = trimToUndefined(env.HOME)

  if (!home) {
    return Effect.fail(
      new ConfigStoreError({
        detail: "Could not resolve a home directory for qq config.",
      })
    )
  }

  return Effect.succeed(path.join(home, ".config", "qq", "config.json"))
}

const mapFsError = (detail: string) => (cause: unknown) => new ConfigStoreError({ detail, cause })

export class ConfigStore extends ServiceMap.Service<ConfigStore>()("ConfigStore", {
  make: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const runtime = yield* AppRuntime

    const resolvePath = Effect.gen(function* () {
      const env = yield* runtime.getEnv
      return yield* configPathForEnv(path, env)
    })

    const read = Effect.gen(function* () {
      const configPath = yield* resolvePath
      const exists = yield* fs
        .exists(configPath)
        .pipe(Effect.mapError(mapFsError("Failed checking qq config path.")))

      if (!exists) {
        return {}
      }

      const raw = yield* fs
        .readFileString(configPath)
        .pipe(Effect.mapError(mapFsError("Failed reading qq config file.")))

      return yield* decodePersistedConfigJson(raw).pipe(
        Effect.mapError(
          (cause) =>
            new ConfigStoreError({
              detail: "qq config file is invalid JSON.",
              cause,
            })
        )
      )
    })

    const write = (config: Parameters<typeof encodePersistedConfigJson>[0]) =>
      Effect.gen(function* () {
        const configPath = yield* resolvePath
        const encoded = yield* encodePersistedConfigJson(config).pipe(
          Effect.mapError(
            (cause) =>
              new ConfigStoreError({
                detail: "Failed encoding qq config.",
                cause,
              })
          )
        )

        yield* fs
          .makeDirectory(path.dirname(configPath), { recursive: true })
          .pipe(Effect.mapError(mapFsError("Failed creating qq config directory.")))
        yield* fs
          .writeFileString(configPath, `${encoded}\n`)
          .pipe(Effect.mapError(mapFsError("Failed writing qq config file.")))
      })

    return {
      resolvePath: () => resolvePath,
      read: () => read,
      get: (key: keyof typeof configFieldByKey) =>
        read.pipe(Effect.map((config) => config[configFieldByKey[key]])),
      set: (key: keyof typeof configFieldByKey, value: string | number | boolean) =>
        Effect.gen(function* () {
          const current = yield* read
          const field = configFieldByKey[key]
          const next = {
            ...current,
            [field]: value,
          }

          yield* write(next)
        }),
      showLines: () =>
        Effect.gen(function* () {
          const configPath = yield* resolvePath
          const config = yield* read

          return [
            `path=${configPath}`,
            `provider=${config.provider ?? ""}`,
            `model=${config.model ?? ""}`,
            `host=${config.host ?? ""}`,
            `api-key=${maskSecret(config.apiKey ?? "")}`,
            `timeout-ms=${config.timeoutMs ?? ""}`,
            `thinking=${config.thinking ?? ""}`,
          ]
        }),
    }
  }),
}) {
  static Live = Layer.effect(this, this.make)
}
