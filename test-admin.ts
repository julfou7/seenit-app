import { adminDb } from "./src/lib/firebase-admin.ts";
async function run() {
  try {
    const snap = await adminDb.collection("users").limit(1).get();
    console.log("Success! Docs:", snap.size);
  } catch(e) {
    console.error("Error:", e);
  }
}
run();
