// js/loader.js - 3D Telemetry Animation & Session Routing Controller
import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const fillEl = document.getElementById("telemetry-fill");
const statusEl = document.getElementById("telemetry-status");
const percentEl = document.getElementById("telemetry-percent");

let progress = 0;
let destination = "login.html";
let authResolved = false;

// 1. Telemetry Step Definitions
const telemetryStages = [
  { at: 20, text: "Calibrating Spatial Engine..." },
  { at: 45, text: "Synchronizing Firestore Ledger..." },
  { at: 70, text: "Verifying Cryptographic Tokens..." },
  { at: 90, text: "Connecting Workspace Nexus..." },
  { at: 100, text: "Session Validated. Redirecting..." }
];

// 2. Continuous Telemetry Progress Animation
const progressInterval = setInterval(() => {
  if (progress < 90 || (authResolved && progress < 100)) {
    progress += Math.floor(Math.random() * 4) + 2;
    if (progress > 100) progress = 100;

    if (fillEl) fillEl.style.width = `${progress}%`;
    if (percentEl) percentEl.textContent = `${progress}%`;

    const currentStage = telemetryStages.find((stage) => progress <= stage.at);
    if (currentStage && statusEl) {
      statusEl.textContent = currentStage.text;
    }
  }

  // Once 100% and auth verified, smooth exit
  if (progress >= 100 && authResolved) {
    clearInterval(progressInterval);
    setTimeout(() => {
      document.body.style.transition = "opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1), transform 0.4s ease";
      document.body.style.opacity = "0";
      document.body.style.transform = "scale(1.04)";
      setTimeout(() => {
        window.location.replace(destination);
      }, 400);
    }, 200);
  }
}, 35);

// 3. Authenticated Session Check
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    destination = "login.html";
    authResolved = true;
    return;
  }

  try {
    const userSnap = await getDoc(doc(db, "users", user.uid));
    const role = userSnap.exists() ? (userSnap.data().role || "student") : "student";

    if (role === "admin") {
      destination = "admin-dashboard.html";
    } else {
      destination = "office.html";
    }
  } catch (err) {
    console.warn("Session retrieval fallback:", err);
    destination = "office.html";
  } finally {
    authResolved = true;
  }
});