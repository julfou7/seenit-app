const https = require("https");
const execSync = require("child_process").execSync;

const token = "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";
const runId = 32137234485;
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

async function checkStatus() {
  const run = await apiReq(`/repos/${repo}/actions/runs/${runId}`);
  console.log(`Current Status: ${run.status}, Conclusion: ${run.conclusion}`);
  if (run.status === "completed") {
    if (run.conclusion === "success") {
      console.log("GitHub Action finished with success! Deploying release v1.0.5...");
      await deployRelease();
    } else {
      console.log("GitHub Action failed with conclusion:", run.conclusion);
    }
  } else {
    setTimeout(checkStatus, 15000);
  }
}

async function deployRelease() {
  try {
    const arts = await apiReq(`/repos/${repo}/actions/runs/${runId}/artifacts`);
    const art = arts.artifacts[0];
    console.log("Artifact ID:", art.id);
    
    execSync(`curl -L -H "Authorization: token ${token}" -o app.zip https://api.github.com/repos/${repo}/actions/artifacts/${art.id}/zip`);
    execSync("unzip -o app.zip -d app-release-v105");
    
    const release = await apiReq(`/repos/${repo}/releases`, "POST", {
      tag_name: "v1.0.5", name: "v1.0.5", body: "Fix Firebase argument-error by reverting initializeAuth to getAuth on Android"
    });
    console.log("Created Release ID:", release.id);
    
    execSync(`curl -X POST -H "Authorization: token ${token}" -H "Content-Type: application/vnd.android.package-archive" --data-binary @app-release-v105/app-debug.apk "https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=SeenIt-v1.0.5.apk"`);
    console.log("Release v1.0.5 completed successfully!");
  } catch(e) {
    console.error("Error during release:", e);
  }
}

checkStatus();
