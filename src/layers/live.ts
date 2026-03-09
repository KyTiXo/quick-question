import * as Layer from "effect/Layer"
import { AppRuntime } from "@/platform/runtime"
import { ConfigStore } from "@/services/config-store"
import { DistillEngine } from "@/services/distill-engine"
import { ModelGateway } from "@/services/model-gateway"
import { RuntimeConfig } from "@/services/runtime-config"

const RuntimeLive = AppRuntime.Live
const ConfigStoreLive = ConfigStore.Live.pipe(Layer.provide(RuntimeLive))
const ModelGatewayLive = ModelGateway.Live

export const Live = Layer.mergeAll(
  RuntimeLive,
  ConfigStoreLive,
  ModelGatewayLive,
  RuntimeConfig.Live.pipe(Layer.provide(Layer.mergeAll(RuntimeLive, ConfigStoreLive))),
  DistillEngine.Live.pipe(Layer.provide(Layer.mergeAll(RuntimeLive, ModelGatewayLive)))
)
