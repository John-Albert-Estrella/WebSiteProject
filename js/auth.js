// js/auth.js - Sign-In (Blocks Removed Accounts), Role-Based Routing, Password Reset & Verified Firestore Registration (v=18)
import { auth, db } from "./firebase-init.js";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { FastCache, checkRateLimit, logAuditEvent } from "./security-utils.js";

let currentRegistrationMode = "open"; // "open" | "faculty-only" | "locked"

function initAuthControllers() {
  setupLogoFallbacks();
  setupLandingPageSessionCheck();
  setupPasswordVisibilityToggles();
  setupLoginForm();
  setupForgotPasswordModal();
  if (document.getElementById("register-form")) {
    setupRegisterForm();
    enforceRegistrationPolicy();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAuthControllers);
} else {
  initAuthControllers();
}

function setupLogoFallbacks() {
  document.querySelectorAll("#auth-brand-logo, #landing-brand-logo").forEach((img) => {
    if (img.dataset.bound) return;
    img.dataset.bound = "true";
    img.addEventListener("error", () => {
      if (img.src.includes("assets/")) {
        img.src = "aimser-logo.png";
      } else {
        img.classList.add("is-hidden");
      }
    });
  });
}

function setupLandingPageSessionCheck() {
  const profile = FastCache.get("user_profile");
  if (!profile || !profile.role) return;

  const target = profile.role.toLowerCase() === "admin" ? "admin-dashboard.html" : "office.html";
  const primaryCta = document.getElementById("hero-primary-cta");
  const navSignIn = document.getElementById("nav-signin-btn");

  if (primaryCta) {
    primaryCta.href = target;
    primaryCta.innerHTML = '<i class="fas fa-arrow-right"></i> Return to Active Workspace';
  }
  if (navSignIn) {
    navSignIn.href = target;
    navSignIn.textContent = "Open Workspace";
  }
}

function setupPasswordVisibilityToggles() {
  document.querySelectorAll(".btn-toggle-pw").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "true";
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-target");
      const input = document.getElementById(targetId);
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

// 1. Sign-In Handler (Rejects Removed Accounts & Auto-Heals Legitimate Missing Profiles)
function setupLoginForm() {
  const form = document.getElementById("login-form");
  const statusEl = document.getElementById("login-status");
  const submitBtn = document.getElementById("btn-login-submit");
  if (!form || form.dataset.bound) return;
  form.dataset.bound = "true";

  // Show message if redirected after account removal
  try {
    const kickedMsg = sessionStorage.getItem("aimser_removed_notice");
    if (kickedMsg && statusEl) {
      sessionStorage.removeItem("aimser_removed_notice");
      showAuthStatus(statusEl, kickedMsg, "error");
    }
  } catch {}

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("login-email").value.trim().toLowerCase();
    const password = document.getElementById("login-password").value;

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing In...';
    showAuthStatus(statusEl, "", "clear");

    window.__AIMSER_REGISTERING__ = true;
    try {
      sessionStorage.setItem("aimser_registering_lock", "1");
    } catch {}

    try {
      checkRateLimit("login_attempt", 8, 60000);
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const user = cred.user;

      const userRef = doc(db, "users", user.uid);
      let userSnap;
      try {
        userSnap = await getDocFromServer(userRef);
      } catch {
        userSnap = await getDoc(userRef);
      }

      let userData = {};
      if (userSnap.exists()) {
        userData = userSnap.data() || {};

        // Block sign-in if the account was removed by an Administrator
        if (userData.deleted === true || userData.status === "removed" || userData.role === "removed") {
          FastCache.clearAll();
          await signOut(auth);
          window.__AIMSER_REGISTERING__ = false;
          try {
            sessionStorage.removeItem("aimser_registering_lock");
          } catch {}
          showAuthStatus(
            statusEl,
            "This account has been removed by the system administrator and can no longer access the workspace.",
            "error"
          );
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign In';
          return;
        }
      } else {
        // Backfill missing Firestore user document for accounts created earlier
        const fallbackName = user.displayName || (user.email ? user.email.split("@")[0] : "Student");
        userData = {
          uid: user.uid,
          fullName: fallbackName,
          email: user.email || email,
          role: "student",
          department: "",
          avatarUrl:
            user.photoURL ||
            `https://ui-avatars.com/api/?name=${encodeURIComponent(fallbackName)}&background=1b5375&color=faf2dd`,
          createdAt: serverTimestamp(),
          registeredAt: new Date().toISOString(),
          updatedAt: serverTimestamp()
        };
        await setDoc(userRef, userData, { merge: true });
      }

      const role = (userData.role || "student").toLowerCase();

      const profileSnapshot = {
        uid: user.uid,
        email: user.email || email,
        fullName: userData.fullName || user.displayName || email.split("@")[0],
        role,
        department: userData.department || "",
        avatarUrl: userData.avatarUrl || user.photoURL || ""
      };

      FastCache.set("user_profile", profileSnapshot);
      await logAuditEvent(`User signed in: ${user.email || email} [${role}]`, "AUTH", user.email || email);

      window.__AIMSER_REGISTERING__ = false;
      try {
        sessionStorage.removeItem("aimser_registering_lock");
      } catch {}

      window.location.replace(role === "admin" ? "admin-dashboard.html" : "office.html");
    } catch (err) {
      window.__AIMSER_REGISTERING__ = false;
      try {
        sessionStorage.removeItem("aimser_registering_lock");
      } catch {}

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
      banner.classList.remove("is-hidden");
      banner.innerHTML = '<i class="fas fa-lock"></i> <strong>Registration Closed:</strong> New account creation is currently locked by the platform administrator.';
    }
    if (form) {
      form.querySelectorAll("input, select, button").forEach((el) => {
        el.disabled = true;
      });
    }
    if (submitBtn) submitBtn.disabled = true;
  } else if (currentRegistrationMode === "faculty-only") {
    if (banner) {
      banner.classList.remove("is-hidden");
      banner.innerHTML = '<i class="fas fa-info-circle"></i> <strong>Restricted Registration:</strong> Only Faculty accounts may register directly at this time.';
    }
    if (roleSelect) {
      const studentOpt = roleSelect.querySelector('option[value="student"]');
      if (studentOpt) studentOpt.disabled = true;
      roleSelect.value = "faculty";
    }
  }
}

// 4. Account Registration Handler (Verifies Server Write & Can Reactivate Previously Removed Accounts)
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
    const email = document.getElementById("reg-email").value.trim().toLowerCase();
    const selectedRole = (document.getElementById("reg-role").value || "student").toLowerCase();
    const department = document.getElementById("reg-department").value.trim();
    const password = document.getElementById("reg-password").value;
    const confirmPassword = document.getElementById("reg-confirm-password").value;

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

    window.__AIMSER_REGISTERING__ = true;
    try {
      sessionStorage.setItem("aimser_registering_lock", "1");
      localStorage.setItem(
        "aimser_pending_registration",
        JSON.stringify({ fullName, email, role: selectedRole, department })
      );
    } catch {}

    const defaultAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=1b5375&color=faf2dd`;

    try {
      checkRateLimit("register_account", 5, 60000);
      let user = null;

      try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        user = cred.user;
      } catch (createErr) {
        // If this email was previously removed by an Admin (still in Firebase Auth), allow re-registration if they know their password
        if (createErr.code === "auth/email-already-in-use") {
          try {
            const existingCred = await signInWithEmailAndPassword(auth, email, password);
            const existingSnap = await getDocFromServer(doc(db, "users", existingCred.user.uid));
            const existingData = existingSnap.exists() ? existingSnap.data() : {};
            if (!existingSnap.exists() || existingData.deleted === true || existingData.status === "removed") {
              user = existingCred.user;
            } else {
              await signOut(auth);
              throw createErr;
            }
          } catch {
            throw createErr;
          }
        } else {
          throw createErr;
        }
      }

      const userDocRef = doc(db, "users", user.uid);
      const userPayload = {
        uid: user.uid,
        fullName,
        email: user.email || email,
        role: selectedRole,
        department,
        avatarUrl: defaultAvatar,
        deleted: false,
        status: "active",
        createdAt: serverTimestamp(),
        registeredAt: new Date().toISOString(),
        updatedAt: serverTimestamp()
      };

      // Write profile to Firestore 'users' collection
      await setDoc(userDocRef, userPayload);

      try {
        await getDocFromServer(userDocRef);
      } catch {}

      try {
        await updateProfile(user, {
          displayName: fullName,
          photoURL: defaultAvatar
        });
      } catch {}

      const profileSnapshot = {
        uid: user.uid,
        email: user.email || email,
        fullName,
        role: selectedRole,
        department,
        avatarUrl: defaultAvatar
      };

      FastCache.set("user_profile", profileSnapshot);
      await logAuditEvent(`New account registered: ${user.email || email} (${fullName}) [${selectedRole}]`, "REGISTER", user.email || email);

      window.__AIMSER_REGISTERING__ = false;
      try {
        sessionStorage.removeItem("aimser_registering_lock");
        localStorage.removeItem("aimser_pending_registration");
      } catch {}

      window.location.replace("office.html");
    } catch (err) {
      window.__AIMSER_REGISTERING__ = false;
      try {
        sessionStorage.removeItem("aimser_registering_lock");
      } catch {}

      console.error("Registration failed:", err);
      const friendlyMsg =
        err.code === "auth/email-already-in-use"
          ? "An account with this email already exists."
          : err.code === "permission-denied"
            ? "Firestore Rules blocked creating your user profile. Please publish the updated firestore.rules in Firebase Console."
            : err.message || "Failed to create account.";
      showAuthStatus(statusEl, friendlyMsg, "error");
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fas fa-user-plus"></i> Create Account';
    }
  });
}