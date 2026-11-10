// js/ui-bridge.js - Centralized UI Bridge & Clean Modal Engine
import { auth } from "./firebase-init.js";
import { 
  updatePassword, 
  reauthenticateWithCredential, 
  EmailAuthProvider 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

document.addEventListener("DOMContentLoaded", () => {
  // 1. Logo fallback handler
  document.querySelectorAll(".brand-logo, .auth-logo").forEach((img) => {
    img.addEventListener("error", function () {
      if (this.src.includes("assets/")) {
        this.src = "aimser-logo.png";
      } else {
        this.style.display = "none";
      }
    });
  });

  // 2. Scoped Sub-Navigation Tab Switching
  document.querySelectorAll(".office-subnav .subnav-tab, .library-subnav .subnav-tab").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const parentContainer = btn.closest(".main-workspace");
      if (!parentContainer) return;

      const parentNav = btn.parentElement;
      parentNav.querySelectorAll(".subnav-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      parentContainer.querySelectorAll(":scope > .tab-panel").forEach((panel) => {
        panel.style.display = "none";
        panel.classList.remove("active");
      });

      const tabKey = btn.getAttribute("data-tab");
      const targetPanel = parentContainer.querySelector(`:scope > #tab-${tabKey}`);
      if (targetPanel) {
        targetPanel.style.display = "block";
        targetPanel.classList.add("active");
      }
    });
  });

  // 3. Modal Show & Hide Listeners (Opens as flex, closes as none)
  document.querySelectorAll("[data-open]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const targetId = btn.getAttribute("data-open");
      const modal = document.getElementById(targetId);
      if (modal) {
        modal.classList.add("is-open");
        modal.style.display = "flex";
      }
    });
  });

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const targetId = btn.getAttribute("data-close");
      const modal = document.getElementById(targetId) || btn.closest(".modal-backdrop");
      if (modal) {
        modal.classList.remove("is-open");
        modal.style.display = "none";
      }
    });
  });

  // Close modal when clicking outside on the backdrop
  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) {
        backdrop.classList.remove("is-open");
        backdrop.style.display = "none";
      }
    });
  });

  // 4. Password Visibility Eye Toggle
  document.querySelectorAll(".btn-toggle-pw").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-target") || (btn.id === "toggle-login-pw" ? "login-password" : "reg-password");
      const input = document.getElementById(targetId);
      const icon = btn.querySelector("i");
      if (!input || !icon) return;

      if (input.type === "password") {
        input.type = "text";
        icon.className = "far fa-eye-slash";
      } else {
        input.type = "password";
        icon.className = "far fa-eye";
      }
    });
  });

  // 5. Change Password Form Engine
  const pwForm = document.getElementById("change-password-form");
  const pwStatus = document.getElementById("password-status-message");

  if (pwForm && !pwForm.dataset.initialized) {
    pwForm.dataset.initialized = "true";
    pwForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const currentPassword = document.getElementById("current-password").value;
      const newPassword = document.getElementById("new-password").value;
      const confirmPassword = document.getElementById("confirm-new-password").value;

      if (newPassword !== confirmPassword) {
        setPwStatus("New passwords do not match.", "error");
        return;
      }

      const user = auth.currentUser;
      if (!user || !user.email) {
        setPwStatus("Active user session not found. Please log in again.", "error");
        return;
      }

      const btn = document.getElementById("btn-update-password");
      btn.disabled = true;
      btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Updating...`;

      try {
        const credential = EmailAuthProvider.credential(user.email, currentPassword);
        await reauthenticateWithCredential(user, credential);
        await updatePassword(user, newPassword);
        setPwStatus("Password updated successfully!", "success");
        pwForm.reset();
      } catch (err) {
        if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
          setPwStatus("Current password is incorrect.", "error");
        } else {
          setPwStatus(err.message || "Failed to update password.", "error");
        }
      } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fas fa-key"></i> Update Password`;
      }
    });
  }

  function setPwStatus(msg, type) {
    if (!pwStatus) return;
    pwStatus.textContent = msg;
    pwStatus.className = `status-msg ${type}`;
  }
});