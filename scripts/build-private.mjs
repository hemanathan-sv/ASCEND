import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, join, relative } from "node:path";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
// Always build tracked root sources. Never package a stale dist/index.html.
const frontendRoot = root;
const output = resolve(root,"dist");
if (relative(root,output) !== "dist") throw new Error("Unsafe build directory");
await rm(output,{recursive:true,force:true});
const files = [
  ["/", "index.html", "text/html; charset=utf-8"],
  ["/index.html", "index.html", "text/html; charset=utf-8"],
  ["/style.css", "style.css", "text/css; charset=utf-8"],
  ["/app.js", "app.js", "text/javascript; charset=utf-8"],
  ["/state.mjs", "state.mjs", "text/javascript; charset=utf-8"],
];
const assets = await Promise.all(files.map(async ([path, file, type]) =>
  [path, { body: file === "index.html" ? (await readFile(join(frontendRoot,file),"utf8")).replace("</head>", '<meta name="ascend-shared-required" content="true"></head>') : await readFile(join(frontendRoot,file),"utf8"), type }]
));
const apiModule = await readFile(join(root, "server", "shared.mjs"), "utf8");
const schemaSource = (await readFile(join(root,"state.mjs"),"utf8")).replace(/^export /gm,"");
const apiSource = schemaSource + "\n" + apiModule.replace(/^import .*;\n/gm,"").replace(/^export \{.*;\n/gm,"").replace(/^export /gm,"");
const worker = `
${apiSource}
const assets = new Map(${JSON.stringify(assets)});
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/shared") return handleShared(request, env);
    if (!request.headers.get("oai-authenticated-user-id")?.trim())
      return new Response("Sign in to ASCEND", { status: 401, headers: { "cache-control": "no-store" } });
    const asset = assets.get(url.pathname);
    if (!asset) return new Response("Not found", { status: 404 });
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Method not allowed", { status: 405 });
    const headers = {
      "content-type": asset.type,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    };
    return new Response(request.method === "HEAD" ? null : asset.body, { headers });
  }
};
`;
const distServer = join(root, "dist", "server");
const distManifest = join(root, "dist", ".openai");
await mkdir(distServer, { recursive: true });
await mkdir(distManifest, { recursive: true });
await writeFile(join(distServer, "index.js"), worker);
await writeFile(join(distManifest, "hosting.json"), await readFile(join(root, ".openai", "hosting.json")));
console.log("Prepared ASCEND private Worker with secure sync API and embedded assets.");
