// js/settings.js - Complete Profile, Avatar, and Password Controller
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
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { uploadToCloudinary } from "./cloudinary-config.js";

let currentUser = null;

// 1. Session and Profile Bootstrap
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }
  currentUser = user;

  try {
    const userDocRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userDocRef);
    const userData = userSnap.exists() ? userSnap.data() : {};

    populateProfileUI(user, userData);
    setupAvatarPreview();
    setupProfileSubmit();
    setupPasswordSubmit();
  } catch (err) {
    console.error("Error bootstrapping settings:", err);
  }
});

// 2. Populate View Elements
function populateProfileUI(user, data) {
  const nameInput = document.getElementById("settings-fullname");
  const emailInput = document.getElementById("settings-email");
  const roleInput = document.getElementById("settings-role");
  const deptInput = document.getElementById("settings-department");
  const previewImg = document.getElementById("settings-avatar-preview");
  const headerName = document.getElementById("header-user-name");
  const headerRole = document.getElementById("header-user-role");
  const headerAvatar = document.getElementById("header-user-avatar");

  const resolvedName = data.fullName || user.displayName || user.email.split("@")[0];
  const resolvedRole = (data.role || "student").toUpperCase();
  const defaultFallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(resolvedName)}&background=1b5375&color=faf2dd`;
  const resolvedAvatar = data.avatarUrl || user.photoURL || defaultFallback;

  if (nameInput) nameInput.value = resolvedName;
  if (emailInput) emailInput.value = user.email || "";
  if (roleInput) roleInput.value = resolvedRole;
  if (deptInput) deptInput.value = data.department || "";
  if (previewImg) previewImg.src = resolvedAvatar;

  if (headerName) headerName.textContent = resolvedName;
  if (headerRole) headerRole.textContent = resolvedRole;
  if (headerAvatar) headerAvatar.src = resolvedAvatar;
}

// 3. Local Blob Preview Before Upload
function setupAvatarPreview() {
  const fileInput = document.getElementById("avatar-file-input");
  const previewImg = document.getElementById("settings-avatar-preview");

  if (!fileInput || !previewImg || fileInput.dataset.bound) return;
  fileInput.dataset.bound = "true";

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (file) {
      if (!file.type.startsWith("image/")) {
        alert("Please select a valid image file (JPG, PNG, or WebP).");
        fileInput.value = "";
        return;
      }
      // Instant browser blob preview
      previewImg.src = URL.createObjectURL(file);
    }
  });
}

// 4. Save Profile & Upload to Cloudinary
function setupProfileSubmit() {
  const profileForm = document.getElementById("profile-settings-form");
  const submitBtn = document.getElementById("btn-save-profile");
  const statusMsg = document.getElementById("profile-status-message");

  if (!profileForm || profileForm.dataset.bound) return;
  profileForm.dataset.bound = "true";

  profileForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fullName = document.getElementById("settings-fullname").value.trim();
    const department = document.getElementById("settings-department").value.trim();
    const fileInput = document.getElementById("avatar-file-input");

    if (!fullName) {
      showStatus(statusMsg, "Full Name cannot be empty.", "error");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    showStatus(statusMsg, "", "clear");

    try {
      let finalAvatarUrl = null;

      // Execute Cloudinary Upload if a new file is chosen
      if (fileInput && fileInput.files.length > 0) {
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading Image...';
        const file = fileInput.files[0];
        const uploadedUrl = await uploadToCloudinary(file, "aimser/avatars");
        
        // Append cache-buster timestamp to ensure immediate browser reload
        finalAvatarUrl = `${uploadedUrl}?t=${Date.now()}`;
      }

      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating Records...';

      // Prepare Firestore payload
      const firestorePayload = {
        fullName: fullName,
        department: department,
        updatedAt: serverTimestamp()
      };

      if (finalAvatarUrl) {
        firestorePayload.avatarUrl = finalAvatarUrl;
      }

      // Update Firestore and Firebase Auth simultaneously
      const updates = [
        updateDoc(doc(db, "users", currentUser.uid), firestorePayload),
        updateProfile(currentUser, {
          displayName: fullName,
          ...(finalAvatarUrl ? { photoURL: finalAvatarUrl } : {})
        })
      ];

      await Promise.all(updates);

      // Update in-page UI components instantly
      const headerName = document.getElementById("header-user-name");
      const headerAvatar = document.getElementById("header-user-avatar");
      const previewImg = document.getElementById("settings-avatar-preview");

      if (headerName) headerName.textContent = fullName;
      if (finalAvatarUrl) {
        if (headerAvatar) headerAvatar.src = finalAvatarUrl;
        if (previewImg) previewImg.src = finalAvatarUrl;
      }

      // Reset file input selection
      if (fileInput) fileInput.value = "";

      showStatus(statusMsg, "Profile updated successfully!", "success");
    } catch (err) {
      console.error("Profile update error:", err);
      showStatus(statusMsg, err.message || "Failed to update profile.", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fas fa-save"></i> Save Profile Changes';
    }
  });
}

// 5. Save Password Changes
function setupPasswordSubmit() {
  const pwForm = document.getElementById("password-settings-form");
  const submitBtn = document.getElementById("btn-save-password");
  const statusMsg = document.getElementById("password-status-message");

  if (!pwForm || pwForm.dataset.bound) return;
  pwForm.dataset.bound = "true";

  pwForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const currentPw = document.getElementById("settings-current-password").value;
    const newPw = document.getElementById("settings-new-password").value;
    const confirmPw = document.getElementById("settings-confirm-password").value;

    if (newPw !== confirmPw) {
      showStatus(statusMsg, "New passwords do not match.", "error");
      return;
    }

    if (newPw.length < 6) {
      showStatus(statusMsg, "New password must be at least 6 characters.", "error");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating Password...';
    showStatus(statusMsg, "", "clear");

    try {
      const credential = EmailAuthProvider.credential(currentUser.email, currentPw);
      await reauthenticateWithCredential(currentUser, credential);
      await updatePassword(currentUser, newPw);

      showStatus(statusMsg, "Password changed successfully!", "success");
      pwForm.reset();
    } catch (err) {
      console.error("Password update error:", err);
      const friendlyMessage = (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential")
        ? "Current password entered is incorrect."
        : err.message || "Failed to update password.";
      showStatus(statusMsg, friendlyMessage, "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fas fa-key"></i> Update Password';
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