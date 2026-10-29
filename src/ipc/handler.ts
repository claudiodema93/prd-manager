import { RPCHandler } from "@orpc/server/message-port";
import { router } from "./router";

export const rpcHandler: RPCHandler<Record<never, never>> = new RPCHandler(
  router,
  {
    interceptors: [
      async ({ next }) => {
        try {
          return await next();
        } catch (error) {
          // Errors are masked towards the renderer; log the real cause here.
          console.error("[ipc] RPC call failed.", error);
          throw error;
        }
      },
    ],
  }
);
