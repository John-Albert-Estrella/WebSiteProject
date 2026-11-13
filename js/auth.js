// js/auth.js - Hardened Authentication, Password Recovery & Registration Policy Gatekeeper
import { auth, db } from "./firebase-init.js";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { FastCache, checkRateLimit, logAuditEvent } from "./security-utils.js";

document.addEventListener("DOMContentLoaded", () => {
  setupLoginForm();
  setupForgotPasswordModal();
  setupRegisterForm();
});

function setupLoginForm() {
  const form = document.getElementById("login-form");
  if (!form) return;

  const statusEl = document.getElementById("auth-status-message") || document.getElementById("login-error");
  const submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = (document.getElementById("login-email")?.value || "").trim().toLowerCase();
    const password = document.getElementById("login-password")?.value || "";

    try {
      checkRateLimit("auth_login", 6, 60000);
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Authenticating...';
      }
      setAuthStatus(statusEl, "", "clear");

      const cred = await signInWithEmailAndPassword(auth, email, password);
      const userSnap = await getDoc(doc(db, "users", cred.user.uid));
      const userData = userSnap.exists() ? userSnap.data() : { role: "student" };
      const role = (userData.role || "student").toLowerCase();

      FastCache.set("user_profile", {
        uid: cred.user.uid,
        email: cred.user.email,
        fullName: userData.fullName || cred.user.displayName || email.split("@")[0],
        role,
        department: userData.department || "",
        avatarUrl: userData.avatarUrl || cred.user.photoURL || ""
      });

      await logAuditEvent(`User signed in: ${email} [${role}]`, "AUTH", email);
      window.location.replace(role === "admin" ? "admin-dashboard.html" : "office.html");
    } catch (err) {
      const msg =
        err.code === "auth/invalid-credential" || err.code === "auth/wrong-password"
          ? "Invalid institutional email or password."
          : err.message || "Authentication failed.";
      setAuthStatus(statusEl, msg, "error");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign In';
      }
    }
  });
}

function setupForgotPasswordModal() {
  const openBtn = document.getElementById("btn-open-forgot-pw");
  const modal = document.getElementById("modal-forgot-password");
  const form = document.getElementById("forgot-password-form");
  const statusEl = document.getElementById("forgot-status-message");
  const forgotEmailInput = document.getElementById("forgot-email");
  const submitBtn = document.getElementById("btn-submit-forgot-pw");

  if (!openBtn || !modal || !form) return;

  openBtn.addEventListener("click", () => {
    const typedLoginEmail = (document.getElementById("login-email")?.value || "").trim();
    if (forgotEmailInput && typedLoginEmail) {
      forgotEmailInput.value = typedLoginEmail;
    }
    setAuthStatus(statusEl, "", "clear");
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    forgotEmailInput?.focus();
  });

  document.querySelectorAll('[data-close-modal="modal-forgot-password"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      modal.classList.remove("is-open");
      modal.setAttribute("aria-hidden", "true");
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = (forgotEmailInput?.value || "").trim().toLowerCase();
    if (!email) return;

    try {
      checkRateLimit("auth_pw_reset", 3, 60000);
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
      }
      setAuthStatus(statusEl, "", "clear");

      await sendPasswordResetEmail(auth, email);
      await logAuditEvent(`Password reset link requested for ${email}`, "SECURITY", email);

      setAuthStatus(
        statusEl,
        "If an account exists for that email, a password reset link has been sent. Please check your inbox and spam folder.",
        "success"
      );
      form.reset();
    } catch (err) {
      // Prevent account enumeration if user-not-found is returned
      if (err.code === "auth/user-not-found") {
        setAuthStatus(
          statusEl,
          "If an account exists for that email, a password reset link has been sent. Please check your inbox and spam folder.",
          "success"
        );
        form.reset();
      } else {
        const msg =
          err.code === "auth/invalid-email"
            ? "Please enter a valid institutional email address."
            : err.message || "Unable to send password reset email.";
        setAuthStatus(statusEl, msg, "error");
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Reset Link';
      }
    }
  });
}

function setupRegisterForm() {
  const form = document.getElementById("register-form");
  if (!form) return;

  const statusEl = document.getElementById("auth-status-message") || document.getElementById("register-error");
  const submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fullName = (document.getElementById("register-fullname")?.value || "").trim();
    const email = (document.getElementById("register-email")?.value || "").trim().toLowerCase();
    const department = (document.getElementById("register-department")?.value || "").trim();
    const roleSelect = document.getElementById("register-role");
    const requestedRole = roleSelect ? roleSelect.value.toLowerCase() : "student";
    const password = document.getElementById("register-password")?.value || "";
    const confirmPw = document.getElementById("register-confirm-password")?.value;

    if (confirmPw !== undefined && password !== confirmPw) {
      setAuthStatus(statusEl, "Passwords do not match.", "error");
      return;
    }

    if (password.length < 6) {
      setAuthStatus(statusEl, "Password must be at least 6 characters.", "error");
      return;
    }

    const safeRole = requestedRole === "faculty" ? "faculty" : "student";

    try {
      checkRateLimit("auth_register", 4, 60000);
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying System Policy...';
      }
      setAuthStatus(statusEl, "", "clear");

      try {
        const configSnap = await getDoc(doc(db, "system", "config"));
        if (configSnap.exists()) {
          const mode = configSnap.data().registrationMode || "open";
          if (mode === "locked") {
            throw new Error("Registration is currently locked by the System Administrator.");
          }
          if (mode === "faculty-only" && safeRole !== "faculty") {
            throw new Error("Self-registration is restricted to Faculty accounts. Contact your instructor.");
          }
        }
      } catch (policyErr) {
        if (policyErr.message.includes("Administrator") || policyErr.message.includes("Faculty")) {
          throw policyErr;
        }
      }

      if (submitBtn) {
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating Account...';
      }

      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const defaultAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=1b5375&color=faf2dd`;

      await updateProfile(cred.user, {
        displayName: fullName,
        photoURL: defaultAvatar
      });

      await setDoc(doc(db, "users", cred.user.uid), {
        uid: cred.user.uid,
        fullName,
        email,
        department,
        role: safeRole,
        avatarUrl: defaultAvatar,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      FastCache.set("user_profile", {
        uid: cred.user.uid,
        email,
        fullName,
        role: safeRole,
        department,
        avatarUrl: defaultAvatar
      });

      await logAuditEvent(`New account registered: ${email} (${fullName}) as [${safeRole}]`, "REGISTRATION", email);
      window.location.replace("office.html");
    } catch (err) {
      const msg =
        err.code === "auth/email-already-in-use"
          ? "This institutional email is already registered."
          : err.message || "Registration failed.";
      setAuthStatus(statusEl, msg, "error");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-user-plus"></i> Create Account';
      }
    }
  });
}

function setAuthStatus(el, msg, type) {
  if (!el) return;
  if (type === "clear" || !msg) {
    el.style.display = "none";
    el.textContent = "";
    return;
  }
  el.textContent = msg;
  el.className = `status-msg ${type}`;
  el.style.display = "block";
}