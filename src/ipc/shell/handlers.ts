import { ORPCError, os } from "@orpc/server";
import { shell } from "electron";
import { openExternalLinkInputSchema } from "./schemas";

export const openExternalLink = os
  .input(openExternalLinkInputSchema)
  .handler(async ({ input }) => {
    const { url } = input;

    try {
      await shell.openExternal(url);
    } catch (error) {
      // The URL is not echoed back: it may contain untrusted input and the
      // renderer must not see internal failure details.
      throw new ORPCError("BAD_REQUEST", {
        cause: error,
        message: "Unable to open the link.",
      });
    }

    return url;
  });
