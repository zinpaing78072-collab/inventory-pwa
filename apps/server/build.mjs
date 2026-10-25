/* Server bundle via esbuild's JS API.
 *
 * On Termux/Android, esbuild's native CLI mis-parses its own argv (it treats
 * its own binary path as an input file, then reports "Must use outdir when
 * there are multiple input files"). The JS API is unaffected, so update.sh
 * builds with this script on every platform.
 */
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: "dist/server.js",
});
