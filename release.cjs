const https = require("https");
const execSync = require("child_process").execSync;
const fs = require("fs");

const token = "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";
const runId = 32125633138;
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
      res.on("end", () => resolve(JSON.parse(d)));
    });
    if(data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function run() {
  const arts = await apiReq(`/repos/${repo}/actions/runs/${runId}/artifacts`);
  const art = arts.artifacts[0];
  console.log("Artifact ID:", art.id);
  execSync(`curl -L -H "Authorization: token ${token}" -o app.zip https://api.github.com/repos/${repo}/actions/artifacts/${art.id}/zip`);
  execSync("unzip -o app.zip -d app-release");
  
  const release = await apiReq(`/repos/${repo}/releases`, "POST", {
    tag_name: "v1.0.2", name: "v1.0.2", body: "Fix Google Auth Android Loop"
  });
  console.log("Release ID:", release.id);
  
  execSync(`curl -X POST -H "Authorization: token ${token}" -H "Content-Type: application/vnd.android.package-archive" --data-binary @app-release/app-debug.apk "https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=SeenIt-v1.0.2.apk"`);
  console.log("Done");
}

run();
