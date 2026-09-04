import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import * as esbuild from "esbuild";

const OUT = "dist";
const html = readFileSync("index.html", "utf8");
const imports = JSON.parse(
  html.slice(html.indexOf("{", html.indexOf("importmap")), html.indexOf("</script>", html.indexOf("importmap"))),
).imports;

const fromMap = (spec) => {
  if (imports[spec]) return imports[spec].replace(/^\.\//, "");
  for (const key of Object.keys(imports).filter((k) => k.endsWith("/"))) {
    if (spec.startsWith(key)) return (imports[key] + spec.slice(key.length)).replace(/^\.\//, "");
  }
  return null;
};

// esbuild has no notion of import maps, so resolve bare specifiers the way the browser would
const importMapPlugin = {
  name: "import-map",
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, (args) => {
      const target = fromMap(args.path);
      return target ? { path: path.resolve(target) } : null;
    });
  },
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const js = await esbuild.build({
  entryPoints: ["main.js"],
  outfile: path.join(OUT, "main.js"),
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  legalComments: "none",
  plugins: [importMapPlugin],
  metafile: true,
});

for (const [src, out] of [
  ["css/styles.css", "css/styles.css"],
  ["node_modules/guspira/css/gui.css", "css/gui.css"],
]) {
  await esbuild.build({
    entryPoints: [src],
    outfile: path.join(OUT, out),
    minify: true,
  });
}

// loaded outside the module graph, or fetched by URL at run time
const copies = [
  "third_party/ammo.wasm.js",
  "third_party/ammo.wasm.wasm",
  "assets/GoogleSansFlex-Black.ttf",
  "assets/spruit_sunrise_2k.hdr.jpg",
  "assets/freesound_community-thump1-108128.mp3",
  "assets/freesound_community-glass-balcony-window-thump-96702.mp3",
];
let extra = 0;
for (const file of copies) {
  if (!existsSync(file)) throw new Error(`missing runtime file: ${file}`);
  const dest = path.join(OUT, file);
  mkdirSync(path.dirname(dest), { recursive: true });
  const data = readFileSync(file);
  writeFileSync(dest, data);
  extra += data.length;
}

writeFileSync(
  path.join(OUT, "index.html"),
  html
    .replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, "")
    .replace("./node_modules/guspira/css/gui.css", "./css/gui.css"),
);

const bundled = Object.values(js.metafile.outputs)[0].bytes;
const inputs = Object.keys(js.metafile.inputs).length;
console.log(`bundled ${inputs} modules -> ${(bundled / 1024).toFixed(0)} KB minified`);
console.log(`plus ${copies.length} runtime files, ${(extra / 1048576).toFixed(1)} MB`);
