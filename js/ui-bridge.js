// js/ui-bridge.js - Global UI Hydration, Modals, Password Toggles & Sign-Out
import { auth } from "./firebase-init.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { FastCache, sanitizeUrl } from "./security-utils.js";

function hydrateHeaderFromProfile(profile) {
  if (!profile) return;
  const headerName = document.getElementById("header-user-name");
  const headerRole = document.getElementById("header-user-role");
  const headerAvatar = document.getElementById("header-user-avatar");

  const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.fullName || "User")}&background=1b5375&color=faf2dd`;

  if (headerName) headerName.textContent = profile.fullName;
  if (headerRole) headerRole.textContent = (profile.role || "Member").toUpperCase();
  if (headerAvatar) headerAvatar.src = sanitizeUrl(profile.avatarUrl, fallbackAvatar);
}

// 1. Immediate 0ms hydration on script load
hydrateHeaderFromProfile(FastCache.get("user_profile"));

// 2. Sync when background Firebase check completes
window.addEventListener("aimser:profile-ready", (e) => {
  hydrateHeaderFromProfile(e.detail);
});

// 3. Global DOM Controls
document.addEventListener("DOMContentLoaded", () => {
  hydrateHeaderFromProfile(FastCache.get("user_profile"));

  // Sign Out Handler
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn && !logoutBtn.dataset.bound) {
    logoutBtn.dataset.bound = "true";
    logoutBtn.addEventListener("click", async () => {
      logoutBtn.disabled = true;
      logoutBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Signing Out...</span>';
      FastCache.clearAll();
      try {
        await signOut(auth);
      } finally {
        window.location.replace("login.html");
      }
    });
  }

  // Password Visibility Toggles
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
        icon.classList.toggle("fa-eye", !isPassword);
        icon.classList.toggle("fa-eye-slash", isPassword);
      }
    });
  });

  // Close Modals on Backdrop Click or ESC
  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) {
        backdrop.classList.remove("is-open");
        backdrop.setAttribute("aria-hidden", "true");
      }
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-backdrop.is-open").forEach((m) => {
        m.classList.remove("is-open");
        m.setAttribute("aria-hidden", "true");
      });
    }
  });
});