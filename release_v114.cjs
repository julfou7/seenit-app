const https = require("https");
const execSync = require("child_process").execSync;

const token = "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";
const repo = "julfou7/seenit-app";
const targetRunId = "32154133443";

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
  console.log("Monitoring target run v1.1.4:", targetRunId);

  async function checkStatus() {
    const run = await apiReq(`/repos/${repo}/actions/runs/${targetRunId}`);
    console.log(`Current Status: ${run.status}, Conclusion: ${run.conclusion}`);
    if (run.status === "completed") {
      if (run.conclusion === "success") {
        console.log("GitHub Action finished with success! Deploying release v1.1.4...");
        await deployRelease(targetRunId);
      } else {
        console.log("GitHub Action failed with conclusion:", run.conclusion);
      }
    } else {
      setTimeout(checkStatus, 10000);
    }
  }

  async function deployRelease(rId) {
    try {
      const rels = await apiReq(`/repos/${repo}/releases`);
      const existingRel = Array.isArray(rels) ? rels.find(r => r.tag_name === "v1.1.4") : null;
      if (existingRel) {
        console.log("Deleting previous release ID:", existingRel.id);
        await apiReq(`/repos/${repo}/releases/${existingRel.id}`, "DELETE");
        try { await apiReq(`/repos/${repo}/git/refs/tags/v1.1.4`, "DELETE"); } catch(e){}
      }

      const arts = await apiReq(`/repos/${repo}/actions/runs/${rId}/artifacts`);
      const art = arts.artifacts[0];
      console.log("Artifact ID:", art.id);
      
      execSync(`curl -L -H "Authorization: token ${token}" -o app.zip https://api.github.com/repos/${repo}/actions/artifacts/${art.id}/zip`);
      execSync("unzip -o app.zip -d app-release-v114");
      
      const release = await apiReq(`/repos/${repo}/releases`, "POST", {
        tag_name: "v1.1.4", name: "v1.1.4", body: "Nouveautés v1.1.4 :\n- Correction complète de la connexion Google Auth (Intégration de @capacitor/browser / Chrome Custom Tabs) : résout l'erreur 400 et empêche le masquage de la barre de statut supérieure.\n- Utilisation de la clé de signature permanente debug.keystore pour des mises à jour fluides."
      });
      console.log("Created Release ID:", release.id);
      
      execSync(`curl -X POST -H "Authorization: token ${token}" -H "Content-Type: application/vnd.android.package-archive" --data-binary @app-release-v114/app-debug.apk "https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=SeenIt-v1.1.4.apk"`);
      console.log("Release v1.1.4 completed successfully!");
    } catch(e) {
      console.error("Error during release v1.1.4:", e);
    }
  }

  checkStatus();
}
start();
