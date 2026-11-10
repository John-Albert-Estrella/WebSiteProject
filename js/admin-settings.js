// js/admin-settings.js - System Administration, Global Config, & Avatar Upload Engine
import { auth, db } from "./firebase-init.js";
import {
  onAuthStateChanged,
  updateProfile,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { uploadToCloudinary } from "./cloudinary-config.js";

let currentAdminUser = null;

// 1. Enforce Admin Clearance
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }

  try {
    const userDocRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userDocRef);
    const userData = userSnap.exists() ? userSnap.data() : {};

    if (userData.role !== "admin") {
      alert("Unauthorized Access: Administrator clearance required.");
      window.location.replace("office.html");
      return;
    }

    currentAdminUser = user;

    populateAdminUI(user, userData);
    loadSystemConfig();
    setupAvatarPreview();
    setupAdminProfileSubmit();
    setupSystemConfigSubmit();
    setupAdminPasswordSubmit();

  } catch (err) {
    console.error("Admin settings bootstrap error:", err);
    window.location.replace("office.html");
  }
});

// 2. Populate View Data
function populateAdminUI(user, data) {
  const nameInput = document.getElementById("admin-fullname");
  const emailInput = document.getElementById("admin-email");
  const avatarPreview = document.getElementById("admin-avatar-preview");
  const headerName = document.getElementById("header-user-name");
  const headerAvatar = document.getElementById("header-user-avatar");

  const resolvedName = data.fullName || user.displayName || "Administrator";
  const defaultFallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(resolvedName)}&background=1b5375&color=faf2dd`;
  const resolvedAvatar = data.avatarUrl || user.photoURL || defaultFallback;

  if (nameInput) nameInput.value = resolvedName;
  if (emailInput) emailInput.value = user.email || "";
  if (avatarPreview) avatarPreview.src = resolvedAvatar;

  if (headerName) headerName.textContent = resolvedName;
  if (headerAvatar) headerAvatar.src = resolvedAvatar;
}

// 3. Load Firestore System Config (system/config)
async function loadSystemConfig() {
  try {
    const configSnap = await getDoc(doc(db, "system", "config"));
    if (configSnap.exists()) {
      const config = configSnap.data();
      const teamSizeInput = document.getElementById("config-max-teamsize");
      const termInput = document.getElementById("config-academic-term");
      const modeSelect = document.getElementById("config-registration-mode");

      if (teamSizeInput && config.maxTeamSize) teamSizeInput.value = config.maxTeamSize;
      if (termInput && config.academicTerm) termInput.value = config.academicTerm;
      if (modeSelect && config.registrationMode) modeSelect.value = config.registrationMode;
    }
  } catch (err) {
    console.warn("Global system policies not yet initialized; using defaults:", err);
  }
}

// 4. Instant Local Avatar Preview
function setupAvatarPreview() {
  const fileInput = document.getElementById("admin-avatar-input");
  const previewImg = document.getElementById("admin-avatar-preview");

  if (!fileInput || !previewImg || fileInput.dataset.bound) return;
  fileInput.dataset.bound = "true";

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (file) {
      if (!file.type.startsWith("image/")) {
        alert("Please select a valid image file (PNG, JPG, or WebP).");
        fileInput.value = "";
        return;
      }
      previewImg.src = URL.createObjectURL(file);
    }
  });
}

// 5. Admin Profile & Cloudinary Upload Submit
function setupAdminProfileSubmit() {
  const form = document.getElementById("admin-profile-form");
  const submitBtn = document.getElementById("btn-save-admin-profile");
  const statusMsg = document.getElementById("admin-profile-status");

  if (!form || form.dataset.bound) return;
  form.dataset.bound = "true";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fullName = document.getElementById("admin-fullname").value.trim();
    const fileInput = document.getElementById("admin-avatar-input");

    if (!fullName) {
      showStatus(statusMsg, "Full name cannot be empty.", "error");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    showStatus(statusMsg, "", "clear");

    try {
      let finalAvatarUrl = null;

      if (fileInput && fileInput.files.length > 0) {
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading to Cloudinary...';
        const file = fileInput.files[0];
        const uploadedUrl = await uploadToCloudinary(file, "aimser/avatars");
        finalAvatarUrl = `${uploadedUrl}?t=${Date.now()}`;
      }

      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating System Records...';

      const firestorePayload = {
        fullName: fullName,
        updatedAt: serverTimestamp()
      };

      if (finalAvatarUrl) {
        firestorePayload.avatarUrl = finalAvatarUrl;
      }

      const updates = [
        updateDoc(doc(db, "users", currentAdminUser.uid), firestorePayload),
        updateProfile(currentAdminUser, {
          displayName: fullName,
          ...(finalAvatarUrl ? { photoURL: finalAvatarUrl } : {})
        })
      ];

      await Promise.all(updates);

      const headerName = document.getElementById("header-user-name");
      const headerAvatar = document.getElementById("header-user-avatar");
      const previewImg = document.getElementById("admin-avatar-preview");

      if (headerName) headerName.textContent = fullName;
      if (finalAvatarUrl) {
        if (headerAvatar) headerAvatar.src = finalAvatarUrl;
        if (previewImg) previewImg.src = finalAvatarUrl;
      }

      if (fileInput) fileInput.value = "";
      showStatus(statusMsg, "Administrator profile updated successfully!", "success");

    } catch (err) {
      console.error("Admin profile error:", err);
      showStatus(statusMsg, err.message || "Failed to update admin profile.", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fas fa-save"></i> Save Admin Profile';
    }
  });
}

// 6. Global Simulation Policy Update
function setupSystemConfigSubmit() {
  const form = document.getElementById("system-config-form");
  const submitBtn = document.getElementById("btn-save-system-config");
  const statusMsg = document.getElementById("system-config-status");

  if (!form || form.dataset.bound) return;
  form.dataset.bound = "true";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const maxTeamSize = parseInt(document.getElementById("config-max-teamsize").value, 10);
    const academicTerm = document.getElementById("config-academic-term").value.trim();
    const registrationMode = document.getElementById("config-registration-mode").value;

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving Policies...';
    showStatus(statusMsg, "", "clear");

    try {
      await setDoc(doc(db, "system", "config"), {
        maxTeamSize: maxTeamSize || 6,
        academicTerm: academicTerm || "Active Term",
        registrationMode: registrationMode || "open",
        updatedAt: serverTimestamp(),
        updatedBy: currentAdminUser.email
      }, { merge: true });

      showStatus(statusMsg, "Global policies saved and enforced across simulator instances!", "success");
    } catch (err) {
      console.error("Config save error:", err);
      showStatus(statusMsg, err.message || "Failed to save global configuration.", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fas fa-sliders-h"></i> Update Global Policies';
    }
  });
}

// 7. Admin Master Password Update
function setupAdminPasswordSubmit() {
  const form = document.getElementById("admin-password-form");
  const submitBtn = document.getElementById("btn-save-admin-pw");
  const statusMsg = document.getElementById("admin-password-status");

  if (!form || form.dataset.bound) return;
  form.dataset.bound = "true";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const currentPw = document.getElementById("admin-current-pw").value;
    const newPw = document.getElementById("admin-new-pw").value;
    const confirmPw = document.getElementById("admin-confirm-pw").value;

    if (newPw !== confirmPw) {
      showStatus(statusMsg, "New passwords do not match.", "error");
      return;
    }

    if (newPw.length < 6) {
      showStatus(statusMsg, "Password must be at least 6 characters.", "error");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
    showStatus(statusMsg, "", "clear");

    try {
      const credential = EmailAuthProvider.credential(currentAdminUser.email, currentPw);
      await reauthenticateWithCredential(currentAdminUser, credential);
      await updatePassword(currentAdminUser, newPw);

      showStatus(statusMsg, "Master administrator password changed successfully!", "success");
      form.reset();
    } catch (err) {
      console.error("Admin password error:", err);
      const friendly = (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential")
        ? "Current administrator password entered is incorrect."
        : err.message || "Failed to update password.";
      showStatus(statusMsg, friendly, "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fas fa-lock"></i> Update Master Password';
    }
  });
}

function showStatus(container, message, type) {
  if (!container) return;
  if (type === "clear" || !message) {
    container.style.display = "none";
    container.textContent = "";
    container.className = "status-msg";
    return;
  }
  container.textContent = message;
  container.className = `status-msg ${type}`;
  container.style.display = "block";
}