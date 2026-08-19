// 完整 packument 查询 + GitHub README
const pkg = await fetch("https://registry.npmmirror.com/dshmarket").then((r) => r.json());
const latest = pkg["dist-tags"]?.latest;
const v = pkg.versions?.[latest] || {};
console.log("== dshmarket", latest);
console.log("description:", v.description);
console.log("homepage:", v.homepage);
console.log("repo:", v.repository?.url);
console.log("bin:", JSON.stringify(v.bin));
console.log("dependencies:", JSON.stringify(v.dependencies));
console.log("dsh:", JSON.stringify(v.dsh));
console.log("files:", JSON.stringify(v.files));
console.log("keywords:", JSON.stringify(v.keywords));
console.log("scripts:", JSON.stringify(v.scripts));
console.log("readme head:");
console.log((v.readme || "").slice(0, 3000));
