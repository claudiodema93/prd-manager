import { z } from "zod";

/**
 * Schemes that may be handed to `shell.openExternal`.
 *
 * Anything else (`file:`, `javascript:`, `data:`, `smb:`, custom app schemes,
 * ...) is rejected: the renderer can call this procedure with arbitrary
 * strings and `shell.openExternal` delegates to the operating system, so an
 * overly permissive schema turns IPC input into an arbitrary protocol launch.
 *
 * There is currently no deep-link / custom protocol registered by the app, so
 * only the two web schemes are allowed.
 */
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);

const MAX_URL_LENGTH = 4096;

export const openExternalLinkInputSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "URL must not be empty")
    .max(MAX_URL_LENGTH, "URL is too long")
    .superRefine((value, ctx) => {
      let parsed: URL;

      try {
        parsed = new URL(value);
      } catch {
        ctx.addIssue({
          code: "custom",
          input: value,
          message: "Must be a valid absolute URL",
        });

        return;
      }

      if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
        ctx.addIssue({
          code: "custom",
          input: value,
          message: `Unsupported URL scheme "${parsed.protocol}"; only http and https are allowed`,
        });
      }
    }),
});
