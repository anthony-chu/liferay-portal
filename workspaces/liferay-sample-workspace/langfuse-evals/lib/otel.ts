import { NodeSDK } from "@opentelemetry/sdk-node";
import { isDefaultExportSpan, LangfuseSpanProcessor } from "@langfuse/otel";

import { LANGFUSE_CONFIG } from "./langfuse.ts";

export const otelSdk = new NodeSDK({
    spanProcessors: [
        new LangfuseSpanProcessor({
            ...LANGFUSE_CONFIG,
            shouldExportSpan: ({ otelSpan }) =>
                otelSpan.instrumentationScope.name.startsWith("@arizeai/openinference")
                    || isDefaultExportSpan(otelSpan),
        }),
    ],
});
