const https = require("https");
const execSync = require("child_process").execSync;

const token = "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";
const repo = "julfou7/seenit-app";

function apiReq(path, method = "GET", data = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "api.github.com",
      path, method,
      headers: {
        "User-Agent": "Node", "Authorization": `token ${token}`,
        "Accept": "application/vnd.github.v3+json",
        ...(data ? {"Content-Type": "application/json"} : {})
      }
    };
    const req = https.request(opts, res => {
      let d = ""; res.on("data", c => d+=c);
      res.on("end", () => {
        try { resolve(JSON.parse(d)); } catch(e) { resolve(d); }
      });
    });
    req.on("error", reject);
    if(data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function start() {
  console.log("Fetching latest release...");
  const release = await apiReq(`/repos/${repo}/releases/latest`);
  console.log("Release tags:", release.tag_name, release.assets.length);
}
start();
