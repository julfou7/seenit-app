const https = require("https");
const execSync = require("child_process").execSync;

const token = "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";
const runId = 32125633138;
const repo = "julfou7/seenit-app";

function checkStatus() {
  const options = {
    hostname: "api.github.com",
    path: `/repos/${repo}/actions/runs/${runId}`,
    headers: {
      "User-Agent": "NodeJS",
      "Authorization": `token ${token}`
    }
  };
  https.get(options, (res) => {
    let data = "";
    res.on("data", c => data += c);
    res.on("end", () => {
      const json = JSON.parse(data);
      if (json.status === "completed" && json.conclusion === "success") {
        console.log("Run completed! Starting release...");
        try {
          const out = execSync("node release-apk.js v1.0.2 \"Fix Google Auth Android Loop\"", { stdio: "inherit" });
          console.log("Done.");
        } catch(e) { console.error(e); }
      } else if (json.status !== "completed") {
        console.log("Still running...");
        setTimeout(checkStatus, 15000);
      } else {
        console.log("Failed: " + json.conclusion);
      }
    });
  });
}

checkStatus();
