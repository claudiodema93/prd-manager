import { ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";
import { router } from "./router";

/**
 * Errors are masked towards the renderer, so the real cause is logged here for
 * diagnostics. Only unexpected failures are logged as errors: an `ORPCError`
 * with a 4xx status is an expected, client-caused outcome (NOT_FOUND,
 * BAD_REQUEST, CONFLICT, validation failures, ...) and must not be reported as
 * an application failure.
 *
 * Exported so the classification can be tested without wiring up a transport.
 */
export function logRpcError(error: unknown): void {
  if (error instanceof ORPCError && error.status < 500) {
    console.debug(`[ipc] RPC returned ${error.code} (${error.status}).`);

    return;
  }

  // Log name/code and message only; the full error (including `data`) may
  // contain customer data.
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : "Non-Error thrown";

  console.error(`[ipc] RPC call failed. ${name}: ${message}`);
}

export const rpcHandler: RPCHandler<Record<never, never>> = new RPCHandler(
  router,
  {
    interceptors: [
      async ({ next }) => {
        try {
          return await next();
        } catch (error) {
          logRpcError(error);

          // Renderer semantics must stay unchanged.
          throw error;
        }
      },
    ],
  }
);
