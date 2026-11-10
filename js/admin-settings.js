// js/admin-settings.js - Isolated Admin Settings & System Controls
import { db, auth } from "./firebase-init.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import {
  onAuthStateChanged,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

let currentAdminUser = null;

// Auth Guard: Only Super Admin allowed
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }
  currentAdminUser = user;

  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    const role = userDoc.exists() ? userDoc.data().role : "student";

    if (role !== "admin") {
      alert("Unauthorized Access. Redirecting...");
      window.location.replace("office.html");
      return;
    }

    // Populate admin profile chip
    const nameEl = document.getElementById("header-user-name");
    const avatarEl = document.getElementById("header-user-avatar");
    if (nameEl) nameEl.textContent = userDoc.data().fullName || user.email;
    if (avatarEl && userDoc.data().avatarUrl) avatarEl.src = userDoc.data().avatarUrl;

    await loadPlatformConfig();
    setupAdminSettingsHandlers();
  } catch (err) {
    console.error("Admin Settings check failed:", err);
    window.location.replace("office.html");
  }
});

// Load System Configurations from Firestore (/system/platform_config)
async function loadPlatformConfig() {
  try {
    const configSnap = await getDoc(doc(db, "system", "platform_config"));
    if (configSnap.exists()) {
      const data = configSnap.data();
      const maintMode = document.getElementById("setting-maintenance-mode");
      const allowReg = document.getElementById("setting-allow-reg");
      const maxTeam = document.getElementById("setting-max-team-size");

      if (maintMode && data.maintenanceMode) maintMode.value = data.maintenanceMode;
      if (allowReg && data.registrationStatus) allowReg.value = data.registrationStatus;
      if (maxTeam && data.defaultMaxTeamSize) maxTeam.value = data.defaultMaxTeamSize;
    }
  } catch (e) {
    console.warn("Could not load platform config document, using defaults:", e);
  }
}

// Bind Isolated Form Submissions
function setupAdminSettingsHandlers() {
  // 1. Platform Settings Form
  const platformForm = document.getElementById("admin-platform-settings-form");
  const platformStatus = document.getElementById("platform-status-message");

  if (platformForm && !platformForm.dataset.bound) {
    platformForm.dataset.bound = "true";
    platformForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const maintMode = document.getElementById("setting-maintenance-mode").value;
      const allowReg = document.getElementById("setting-allow-reg").value;
      const maxTeam = parseInt(document.getElementById("setting-max-team-size").value, 10) || 5;
      const submitBtn = document.getElementById("btn-save-platform-settings");

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

      try {
        await setDoc(doc(db, "system", "platform_config"), {
          maintenanceMode: maintMode,
          registrationStatus: allowReg,
          defaultMaxTeamSize: maxTeam,
          updatedBy: currentAdminUser.email,
          updatedAt: serverTimestamp()
        }, { merge: true });

        if (platformStatus) {
          platformStatus.textContent = "Platform controls saved successfully!";
          platformStatus.className = "status-msg success";
        }
      } catch (err) {
        console.error("Error saving platform config:", err);
        if (platformStatus) {
          platformStatus.textContent = "Failed to save: " + err.message;
          platformStatus.className = "status-msg error";
        }
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-save"></i> Save Platform Controls';
      }
    });
  }

  // 2. Isolated Admin Password Change Form
  const adminPwForm = document.getElementById("admin-password-form");
  const adminPwStatus = document.getElementById("admin-password-status");

  if (adminPwForm && !adminPwForm.dataset.bound) {
    adminPwForm.dataset.bound = "true";
    adminPwForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const currentPw = document.getElementById("admin-current-password").value;
      const newPw = document.getElementById("admin-new-password").value;
      const confirmPw = document.getElementById("admin-confirm-password").value;
      const submitBtn = document.getElementById("btn-update-admin-password");

      if (newPw !== confirmPw) {
        if (adminPwStatus) {
          adminPwStatus.textContent = "New passwords do not match.";
          adminPwStatus.className = "status-msg error";
        }
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';

      try {
        const cred = EmailAuthProvider.credential(currentAdminUser.email, currentPw);
        await reauthenticateWithCredential(currentAdminUser, cred);
        await updatePassword(currentAdminUser, newPw);

        if (adminPwStatus) {
          adminPwStatus.textContent = "Admin password updated successfully!";
          adminPwStatus.className = "status-msg success";
        }
        adminPwForm.reset();
      } catch (err) {
        console.error("Admin password update error:", err);
        if (adminPwStatus) {
          adminPwStatus.textContent = (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential")
            ? "Current password is incorrect."
            : err.message || "Failed to update password.";
          adminPwStatus.className = "status-msg error";
        }
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-key"></i> Update Admin Password';
      }
    });
  }
}