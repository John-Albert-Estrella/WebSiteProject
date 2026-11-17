// js/settings.js - Participant (Student & Faculty) Profile, Cloudinary Avatar Upload, Password Rotation & Bell Notifications (v=18)
import { auth, db } from "./firebase-init.js";
import {
  onAuthStateChanged,
  updateProfile,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { uploadToCloudinary } from "./cloudinary-config.js";
import { FastCache, escapeHtml, sanitizeUrl, logAuditEvent } from "./security-utils.js";

let currentUser = null;
let currentProfile = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }

  currentUser = user;

  const cached = FastCache.get("user_profile");
  if (cached) {
    currentProfile = cached;
    populateSettingsUI(user, cached);
  }

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    const data = snap.exists() ? snap.data() : {};
    const role = (data.role || cached?.role || "student").toLowerCase();

    // If an admin accidentally opens participant settings.html, route them to admin-settings.html
    if (role === "admin") {
      window.location.replace("admin-settings.html");
      return;
    }

    currentProfile = {
      uid: user.uid,
      email: user.email,
      fullName: data.fullName || user.displayName || user.email.split("@")[0],
      role,
      department: data.department || "",
      avatarUrl: data.avatarUrl || user.photoURL || ""
    };
    FastCache.set("user_profile", currentProfile);
    populateSettingsUI(user, currentProfile);
  } catch (err) {
    console.error("Settings load error:", err);
  }

  setupAvatarPreview();
  setupProfileSubmit();
  setupPasswordSubmit();
  setupPasswordVisibilityToggles();
  await loadSettingsNotificationsBell();
});

function populateSettingsUI(user, data) {
  const nameInput = document.getElementById("settings-fullname");
  const emailInput = document.getElementById("settings-email");
  const deptInput = document.getElementById("settings-department");
  const roleBadge = document.getElementById("settings-role-badge");
  const avatarPreview = document.getElementById("settings-avatar-preview");

  const resolvedName = data.fullName || user.displayName || "Member";
  const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(resolvedName)}&background=1b5375&color=faf2dd`;
  const resolvedAvatar = sanitizeUrl(data.avatarUrl || user.photoURL, fallback);

  if (nameInput) nameInput.value = resolvedName;
  if (emailInput) emailInput.value = user.email || "";
  if (deptInput) deptInput.value = data.department || "";
  if (roleBadge) roleBadge.value = (data.role || "student").toUpperCase();
  if (avatarPreview) avatarPreview.src = resolvedAvatar;
}

async function loadSettingsNotificationsBell() {
  const badge = document.getElementById("notif-badge");
  const list = document.getElementById("notifications-feed-list");
  if (!list || !currentUser) return;

  try {
    const q = query(collection(db, "notifications"), where("recipientUid", "==", currentUser.uid));
    const snap = await getDocs(q);
    const alerts = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((n) => !n.read);

    if (badge) {
      if (alerts.length > 0) {
        badge.style.display = "inline-block";
        badge.textContent = alerts.length;
      } else {
        badge.style.display = "none";
      }
    }

    if (alerts.length === 0) {
      list.innerHTML = `<div class="empty-state"><i class="fas fa-bell-slash"></i><h3>All Caught Up</h3><p>No pending account or moderation alerts.</p></div>`;
      return;
    }

    list.innerHTML = alerts
      .map(
        (n) => `
        <div class="inspector-meta-item">
          <div class="panel-toolbar">
            <strong>${escapeHtml(n.title || "Account Alert")}</strong>
            <span class="badge-pill">${escapeHtml(n.type || "ALERT")}</span>
          </div>
          <p class="text-muted">${escapeHtml(n.reason || n.detail || "Notification received.")}</p>
        </div>`
      )
      .join("");
  } catch {
    // Non-blocking
  }
}

function setupAvatarPreview() {
  const fileInput = document.getElementById("settings-avatar-input");
  const previewImg = document.getElementById("settings-avatar-preview");
  if (!fileInput || !previewImg || fileInput.dataset.bound) return;
  fileInput.dataset.bound = "true";

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("Please select a valid image file (PNG, JPG, or WebP).");
      fileInput.value = "";
      return;
    }
    previewImg.src = URL.createObjectURL(file);
  });
}

function setupProfileSubmit() {
  const form = document.getElementById("settings-profile-form");
  const submitBtn = document.getElementById("btn-save-settings-profile");
  const statusEl = document.getElementById("settings-profile-status");
  if (!form || form.dataset.bound) return;
  form.dataset.bound = "true";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fullName = document.getElementById("settings-fullname").value.trim();
    const department = document.getElementById("settings-department").value.trim();
    const fileInput = document.getElementById("settings-avatar-input");

    if (!fullName) {
      showStatus(statusEl, "Full name cannot be empty.", "error");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    showStatus(statusEl, "", "clear");

    try {
      let finalAvatarUrl = null;
      if (fileInput && fileInput.files.length > 0) {
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading Photo...';
        const uploaded = await uploadToCloudinary(fileInput.files[0], "aimser/avatars");
        finalAvatarUrl = `${uploaded}?t=${Date.now()}`;
      }

      const payload = {
        fullName,
        department,
        updatedAt: serverTimestamp()
      };
      if (finalAvatarUrl) payload.avatarUrl = finalAvatarUrl;

      await Promise.all([
        updateDoc(doc(db, "users", currentUser.uid), payload),
        updateProfile(currentUser, {
          displayName: fullName,
          ...(finalAvatarUrl ? { photoURL: finalAvatarUrl } : {})
        })
      ]);

      const updatedProfile = {
        ...(currentProfile || {}),
        uid: currentUser.uid,
        email: currentUser.email,
        fullName,
        department,
        ...(finalAvatarUrl ? { avatarUrl: finalAvatarUrl } : {})
      };
      currentProfile = updatedProfile;
      FastCache.set("user_profile", updatedProfile);
      window.dispatchEvent(new CustomEvent("aimser:profile-ready", { detail: updatedProfile }));

      if (finalAvatarUrl) {
        document.getElementById("settings-avatar-preview").src = finalAvatarUrl;
      }
      if (fileInput) fileInput.value = "";

      await logAuditEvent(`User updated profile identity (${fullName})`, "PROFILE", currentUser.email);
      showStatus(statusEl, "Profile changes saved successfully!", "success");
    } catch (err) {
      showStatus(statusEl, err.message || "Failed to save profile.", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fas fa-save"></i> Save Profile Changes';
    }
  });
}

function setupPasswordSubmit() {
  const form = document.getElementById("settings-password-form");
  const submitBtn = document.getElementById("btn-save-settings-pw");
  const statusEl = document.getElementById("settings-password-status");
  if (!form || form.dataset.bound) return;
  form.dataset.bound = "true";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const currentPw = document.getElementById("settings-current-pw").value;
    const newPw = document.getElementById("settings-new-pw").value;
    const confirmPw = document.getElementById("settings-confirm-pw").value;

    if (newPw !== confirmPw) {
      showStatus(statusEl, "New passwords do not match.", "error");
      return;
    }

    if (newPw.length < 6) {
      showStatus(statusEl, "Password must be at least 6 characters.", "error");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
    showStatus(statusEl, "", "clear");

    try {
      const cred = EmailAuthProvider.credential(currentUser.email, currentPw);
      await reauthenticateWithCredential(currentUser, cred);
      await updatePassword(currentUser, newPw);
      await logAuditEvent("User rotated account password", "SECURITY", currentUser.email);
      showStatus(statusEl, "Password updated successfully!", "success");
      form.reset();
    } catch (err) {
      const msg =
        err.code === "auth/wrong-password" || err.code === "auth/invalid-credential"
          ? "Current password is incorrect."
          : err.message || "Failed to update password.";
      showStatus(statusEl, msg, "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fas fa-lock"></i> Update Password';
    }
  });
}

function setupPasswordVisibilityToggles() {
  document.querySelectorAll(".btn-toggle-pw").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "true";
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.getAttribute("data-target"));
      const icon = btn.querySelector("i");
      if (!input) return;
      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      if (icon) {
        icon.className = isPassword ? "far fa-eye-slash" : "far fa-eye";
      }
    });
  });
}

function showStatus(el, msg, type) {
  if (!el) return;
  if (type === "clear" || !msg) {
    el.style.display = "none";
    el.textContent = "";
    el.className = "status-msg";
    return;
  }
  el.textContent = msg;
  el.className = `status-msg ${type}`;
  el.style.display = "block";
}