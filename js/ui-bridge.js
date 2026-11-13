// js/ui-bridge.js - Global Header Chip Sync, Theme/Sign-Out Delegation & Password Toggles
import { auth } from "./firebase-init.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import * as SecUtils from "./security-utils.js";

const FastCache = SecUtils.FastCache || {
  get: (k) => {
    try {
      return JSON.parse(sessionStorage.getItem("aimser_v2_" + k));
    } catch {
      return null;
    }
  },
  clearAll: () => {
    try {
      sessionStorage.clear();
    } catch {}
  }
};

const sanitizeUrl =
  SecUtils.sanitizeUrl ||
  ((url, fallback = "") => (/^https?:\/\//i.test(String(url || "").trim()) ? String(url).trim() : fallback));

function applyHeaderChip(profile) {
  if (!profile) return;
  const nameEl = document.getElementById("header-user-name");
  const roleEl = document.getElementById("header-user-role");
  const avatarEl = document.getElementById("header-user-avatar");

  const displayName = profile.fullName || profile.email?.split("@")[0] || "Member";
  const roleLabel = (profile.role || "student").toUpperCase();
  const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=1b5375&color=faf2dd`;

  if (nameEl) nameEl.textContent = displayName;
  if (roleEl) roleEl.textContent = roleLabel === "ADMIN" ? "SYSTEM ADMIN" : roleLabel;
  if (avatarEl) avatarEl.src = sanitizeUrl(profile.avatarUrl, fallback);
}

// Global document-level delegation so Sign Out and Password Toggles never fail to bind
document.addEventListener("click", async (e) => {
  const togglePwBtn = e.target.closest(".btn-toggle-pw");
  if (togglePwBtn) {
    const input = document.getElementById(togglePwBtn.dataset.target);
    if (input) {
      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      const icon = togglePwBtn.querySelector("i");
      if (icon) icon.className = isPassword ? "far fa-eye-slash" : "far fa-eye";
    }
    return;
  }

  const logoutBtn = e.target.closest("#logout-btn");
  if (logoutBtn) {
    logoutBtn.disabled = true;
    try {
      FastCache.clearAll();
      await signOut(auth);
    } catch (err) {
      console.error("Sign out error:", err);
    } finally {
      window.location.replace("login.html");
    }
  }
});

window.addEventListener("aimser:profile-ready", (e) => {
  applyHeaderChip(e.detail);
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => applyHeaderChip(FastCache.get("user_profile")));
} else {
  applyHeaderChip(FastCache.get("user_profile"));
}