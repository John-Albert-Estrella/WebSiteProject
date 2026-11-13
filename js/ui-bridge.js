// js/ui-bridge.js - Global Header Chip Sync, Modal Pointer Guard, Password Toggles & Sign-Out Controller
import { auth } from "./firebase-init.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { FastCache, sanitizeUrl } from "./security-utils.js";

function injectModalPointerGuard() {
  if (document.getElementById("aimser-modal-pointer-guard")) return;
  const style = document.createElement("style");
  style.id = "aimser-modal-pointer-guard";
  style.textContent = `.modal-backdrop:not(.is-open) { pointer-events: none !important; }`;
  document.head.appendChild(style);
}

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

function initUiBridge() {
  injectModalPointerGuard();
  applyHeaderChip(FastCache.get("user_profile"));

  // Password visibility toggles
  document.querySelectorAll(".btn-toggle-pw").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "true";
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (!input) return;
      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      const icon = btn.querySelector("i");
      if (icon) {
        icon.className = isPassword ? "far fa-eye-slash" : "far fa-eye";
      }
    });
  });

  // Global Sign-Out button (#logout-btn only)
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn && !logoutBtn.dataset.bound) {
    logoutBtn.dataset.bound = "true";
    logoutBtn.addEventListener("click", async () => {
      logoutBtn.disabled = true;
      try {
        FastCache.clearAll();
        await signOut(auth);
      } catch (err) {
        console.error("Sign out error:", err);
      } finally {
        window.location.replace("login.html");
      }
    });
  }
}

window.addEventListener("aimser:profile-ready", (e) => {
  applyHeaderChip(e.detail);
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initUiBridge);
} else {
  initUiBridge();
}