// Build the Privy login bundle with esbuild's JS API (robust define quoting).
import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["build-src/login.js"],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2020",
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".css": "empty" },
  outfile: "public/login-bundle.js",
  legalComments: "none",
});

console.log("built public/login-bundle.js");
