/**
 * The Firefox MV2 path: MV2 has no MAIN world for content scripts, so the hook goes in as
 * an injected file. On Chrome entrypoints/page.content.ts has already installed it and
 * this call is a no-op.
 */
import { installPageHook } from "../lib/page-hook.ts";

export default defineUnlistedScript(() => {
  installPageHook();
});
