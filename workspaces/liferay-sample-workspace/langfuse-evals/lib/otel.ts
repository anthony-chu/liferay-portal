import { NodeSDK } from "@opentelemetry/sdk-node";
import { isDefaultExportSpan, LangfuseSpanProcessor } from "@langfuse/otel";

export const otelSdk = new NodeSDK({
    spanProcessors: [
        new LangfuseSpanProcessor({
            shouldExportSpan: ({ otelSpan }) =>
                otelSpan.instrumentationScope.name.startsWith("@arizeai/openinference")
                    || isDefaultExportSpan(otelSpan),
        }),
    ],
});