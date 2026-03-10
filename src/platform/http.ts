import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { AiError } from "effect/unstable/ai"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import { ModelError } from "@/schema/errors"

const toModelError = (description: string, cause?: unknown) =>
  new ModelError({ detail: description, cause })

const parseJson = (text: string) =>
  Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: (cause) => toModelError("Provider returned invalid JSON.", cause),
  })

export const requestJson = <S extends Schema.Top>({
  url,
  headers,
  body,
  timeoutMs,
  schema,
  module,
  method,
}: {
  url: URL
  headers?: Record<string, string>
  body: unknown
  timeoutMs: number
  schema: S
  module: string
  method: string
}) =>
  Effect.gen(function* () {
    const request = HttpClientRequest.post(url).pipe(
      HttpClientRequest.setHeaders({
        "content-type": "application/json",
        ...headers,
      }),
      HttpClientRequest.acceptJson,
      HttpClientRequest.bodyJsonUnsafe(body)
    )
    const requestFailure = (cause: unknown) => {
      const aiError = AiError.make({
        module,
        method,
        reason: new AiError.UnknownError({
          description: "Request failed before receiving a response.",
        }),
      })

      return toModelError(aiError.message, cause)
    }
    const response = yield* HttpClient.execute(request).pipe(
      Effect.timeoutOrElse({
        duration: timeoutMs,
        onTimeout: () =>
          Effect.fail(requestFailure(new Error(`Request timed out after ${String(timeoutMs)}ms.`))),
      }),
      Effect.mapError(requestFailure)
    )
    const rawText = yield* response.text.pipe(
      Effect.mapError((cause) => toModelError("Failed reading provider response.", cause))
    )

    if (response.status < 200 || response.status >= 300) {
      const body = yield* parseJson(rawText).pipe(Effect.orElseSucceed(() => rawText))
      const aiError = AiError.make({
        module,
        method,
        reason: AiError.reasonFromHttpStatus({
          status: response.status,
          body,
        }),
      })

      return yield* toModelError(aiError.message, body)
    }

    const payload = yield* parseJson(rawText)

    return yield* Schema.decodeUnknownEffect(schema)(payload).pipe(
      Effect.mapError((cause) => {
        const aiError = AiError.make({
          module,
          method,
          reason: AiError.InvalidOutputError.fromSchemaError(cause),
        })

        return toModelError(aiError.message, payload)
      })
    )
  })
