// js/auth.js - Sign-In, Role-Based Routing, Password Reset & Policy-Enforced Registration
import { auth, db } from "./firebase-init.js";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { FastCache, checkRateLimit, logAuditEvent } from "./security-utils.js";

let currentRegistrationMode = "open"; // "open" | "faculty-only" | "locked"

document.addEventListener("DOMContentLoaded", async () => {
  setupLoginForm();
  setupForgotPasswordModal();
  if (document.getElementById("register-form")) {
    await enforceRegistrationPolicy();
    setupRegisterForm();
  }
});

function showAuthStatus(el, msg, type) {
  if (!el) return;
  if (!msg || type === "clear") {
    el.style.display = "none";
    el.textContent = "";
    el.className = "status-msg";
    return;
  }
  el.textContent = msg;
  el.className = `status-msg ${type}`;
  el.style.display = "block";
}

// 1. Sign-In Handler
function setupLoginForm() {
  const form = document.getElementById("login-form");
  const statusEl = document.getElementById("login-status");
  const submitBtn = document.getElementById("btn-login-submit");
  if (!form || form.dataset.bound) return;
  form.dataset.bound = "true";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing In...';
    showAuthStatus(statusEl, "", "clear");

    try {
      checkRateLimit("login_attempt", 8, 60000);
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const user = cred.user;

      const userSnap = await getDoc(doc(db, "users", user.uid));
      const userData = userSnap.exists() ? userSnap.data() : {};
      const role = (userData.role || "student").toLowerCase();

      const profileSnapshot = {
        uid: user.uid,
        email: user.email,
        fullName: userData.fullName || user.displayName || user.email.split("@")[0],
        role,
        department: userData.department || "",
        avatarUrl: userData.avatarUrl || user.photoURL || ""
      };

      FastCache.set("user_profile", profileSnapshot);
      await logAuditEvent(`User signed in: ${user.email} [${role}]`, "AUTH", user.email);

      window.location.replace(role === "admin" ? "admin-dashboard.html" : "office.html");
    } catch (err) {
      const friendlyMsg =
        err.code === "auth/invalid-credential" ||
        err.code === "auth/wrong-password" ||
        err.code === "auth/user-not-found"
          ? "Invalid institutional email or password."
          : err.message || "Unable to sign in.";
      showAuthStatus(statusEl, friendlyMsg, "error");
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign In';
    }
  });
}

// 2. Forgot Password Modal & Reset Email Dispatch
function setupForgotPasswordModal() {
  const openBtn = document.getElementById("btn-open-forgot-modal");
  const modal = document.getElementById("modal-forgot-pw");
  const form = document.getElementById("forgot-pw-form");
  const statusEl = document.getElementById("forgot-pw-status");
  const sendBtn = document.getElementById("btn-send-reset");

  if (openBtn && modal && !openBtn.dataset.bound) {
    openBtn.dataset.bound = "true";
    openBtn.addEventListener("click", () => {
      const typedEmail = document.getElementById("login-email")?.value.trim() || "";
      const forgotInput = document.getElementById("forgot-email");
      if (forgotInput && typedEmail) forgotInput.value = typedEmail;
      showAuthStatus(statusEl, "", "clear");
      modal.classList.add("is-open");
      modal.setAttribute("aria-hidden", "false");
    });
  }

  document.querySelectorAll('[data-close-modal="modal-forgot-pw"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      if (modal) {
        modal.classList.remove("is-open");
        modal.setAttribute("aria-hidden", "true");
      }
    });
  });

  if (form && !form.dataset.bound) {
    form.dataset.bound = "true";
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("forgot-email").value.trim();
      if (!email) return;

      sendBtn.disabled = true;
      sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
      showAuthStatus(statusEl, "", "clear");

      try {
        checkRateLimit("pw_reset_request", 4, 60000);
        await sendPasswordResetEmail(auth, email);
        showAuthStatus(statusEl, `Password reset link sent to ${email}. Check your inbox or spam folder.`, "success");
      } catch (err) {
        showAuthStatus(statusEl, err.message || "Failed to send password reset email.", "error");
      } finally {
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Reset Link';
      }
    });
  }
}

// 3. Enforce Global Registration Policy from system/config
async function enforceRegistrationPolicy() {
  const banner = document.getElementById("reg-policy-banner");
  const roleSelect = document.getElementById("reg-role");
  const form = document.getElementById("register-form");
  const submitBtn = document.getElementById("btn-register-submit");

  try {
    const configSnap = await getDoc(doc(db, "system", "config"));
    if (configSnap.exists()) {
      currentRegistrationMode = (configSnap.data().registrationMode || "open").toLowerCase();
    }
  } catch {
    currentRegistrationMode = "open";
  }

  if (currentRegistrationMode === "locked") {
    if (banner) {
      banner.style.display = "block";
      banner.innerHTML = '<i class="fas fa-lock" style="margin-right: 0.45rem;"></i><strong>Registration Closed:</strong> New account creation is currently locked by the platform administrator.';
    }
    if (form) {
      form.querySelectorAll("input, select, button").forEach((el) => {
        el.disabled = true;
      });
    }
    if (submitBtn) submitBtn.disabled = true;
  } else if (currentRegistrationMode === "faculty-only") {
    if (banner) {
      banner.style.display = "block";
      banner.innerHTML = '<i class="fas fa-info-circle" style="margin-right: 0.45rem;"></i><strong>Restricted Registration:</strong> Only Faculty accounts may register directly at this time.';
    }
    if (roleSelect) {
      const studentOpt = roleSelect.querySelector('option[value="student"]');
      if (studentOpt) studentOpt.disabled = true;
      roleSelect.value = "faculty";
    }
  }
}

// 4. Account Registration Handler
function setupRegisterForm() {
  const form = document.getElementById("register-form");
  const statusEl = document.getElementById("register-status");
  const submitBtn = document.getElementById("btn-register-submit");
  if (!form || form.dataset.bound) return;
  form.dataset.bound = "true";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (currentRegistrationMode === "locked") {
      showAuthStatus(statusEl, "Account registration is currently locked by the administrator.", "error");
      return;
    }

    const fullName = document.getElementById("reg-fullname").value.trim();
    const email = document.getElementById("reg-email").value.trim();
    const selectedRole = (document.getElementById("reg-role").value || "student").toLowerCase();
    const department = document.getElementById("reg-department").value.trim();
    const password = document.getElementById("reg-password").value;
    const confirmPassword = document.getElementById("reg-confirm-password").value;

    // Prevent privilege escalation or policy bypass
    if (selectedRole !== "student" && selectedRole !== "faculty") {
      showAuthStatus(statusEl, "Invalid account role selected.", "error");
      return;
    }

    if (currentRegistrationMode === "faculty-only" && selectedRole !== "faculty") {
      showAuthStatus(statusEl, "Registration is currently restricted to Faculty accounts only.", "error");
      return;
    }

    if (password !== confirmPassword) {
      showAuthStatus(statusEl, "Passwords do not match.", "error");
      return;
    }

    if (password.length < 6) {
      showAuthStatus(statusEl, "Password must be at least 6 characters.", "error");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating Account...';
    showAuthStatus(statusEl, "", "clear");

    try {
      checkRateLimit("register_account", 5, 60000);
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const user = cred.user;
      const defaultAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=1b5375&color=faf2dd`;

      await updateProfile(user, {
        displayName: fullName,
        photoURL: defaultAvatar
      });

      await setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        fullName,
        email: user.email,
        role: selectedRole,
        department,
        avatarUrl: defaultAvatar,
        createdAt: serverTimestamp()
      });

      const profileSnapshot = {
        uid: user.uid,
        email: user.email,
        fullName,
        role: selectedRole,
        department,
        avatarUrl: defaultAvatar
      };

      FastCache.set("user_profile", profileSnapshot);
      await logAuditEvent(`New account registered: ${user.email} [${selectedRole}]`, "REGISTER", user.email);

      window.location.replace("office.html");
    } catch (err) {
      const friendlyMsg =
        err.code === "auth/email-already-in-use"
          ? "An account with this email already exists."
          : err.message || "Failed to create account.";
      showAuthStatus(statusEl, friendlyMsg, "error");
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fas fa-user-plus"></i> Create Account';
    }
  });
}