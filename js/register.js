// register.js - Automatic User Registration & Firestore User Registry Sync (v=18)
import { auth, db } from "./firebase-init.js";
import {
  createUserWithEmailAndPassword,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { FastCache, checkRateLimit, logAuditEvent } from "./security-utils.js";

function showRegisterStatus(msg, type = "error") {
  const statusEl =
    document.getElementById("register-status") ||
    document.getElementById("auth-status") ||
    document.getElementById("error-message") ||
    document.querySelector(".status-msg");

  if (!statusEl) {
    if (msg && type === "error") alert(msg);
    return;
  }

  if (!msg || type === "clear") {
    statusEl.style.display = "none";
    statusEl.textContent = "";
    return;
  }

  statusEl.textContent = msg;
  statusEl.className = `status-msg ${type}`;
  statusEl.style.display = "block";
}

function initRegisterPage() {
  const form =
    document.getElementById("register-form") ||
    document.getElementById("form-register") ||
    document.querySelector("form");

  if (!form || form.dataset.bound) return;
  form.dataset.bound = "true";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fullNameInput =
      document.getElementById("reg-fullname") ||
      document.getElementById("fullname") ||
      document.getElementById("fullName") ||
      document.getElementById("register-name") ||
      form.querySelector('input[name="fullName"], input[type="text"]');

    const emailInput =
      document.getElementById("reg-email") ||
      document.getElementById("email") ||
      document.getElementById("register-email") ||
      form.querySelector('input[type="email"]');

    const passwordInput =
      document.getElementById("reg-password") ||
      document.getElementById("password") ||
      document.getElementById("register-password") ||
      form.querySelector('input[type="password"]');

    const confirmInput =
      document.getElementById("reg-confirm-password") ||
      document.getElementById("confirm-password") ||
      document.getElementById("confirmPassword");

    const roleInput =
      document.getElementById("reg-role") ||
      document.getElementById("role") ||
      form.querySelector("select");

    const deptInput =
      document.getElementById("reg-department") ||
      document.getElementById("department");

    const submitBtn =
      document.getElementById("btn-register") ||
      form.querySelector('button[type="submit"]');

    const fullName = (fullNameInput?.value || "").trim();
    const email = (emailInput?.value || "").trim().toLowerCase();
    const password = passwordInput?.value || "";
    const confirmPassword = confirmInput ? confirmInput.value : password;
    const selectedRole = (roleInput?.value || "student").toLowerCase();
    const role = selectedRole === "faculty" ? "faculty" : "student";
    const department = (deptInput?.value || "").trim();

    if (!fullName || !email || !password) {
      showRegisterStatus("Please fill in your full name, email address, and password.", "error");
      return;
    }

    if (confirmInput && password !== confirmPassword) {
      showRegisterStatus("Passwords do not match.", "error");
      return;
    }

    if (password.length < 6) {
      showRegisterStatus("Password must be at least 6 characters long.", "error");
      return;
    }

    const origBtnHtml = submitBtn ? submitBtn.innerHTML : "Create Account";
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating Account...';
    }
    showRegisterStatus("", "clear");

    // Lock auth-guard.js redirect until Firestore users/{uid} write finishes
    window.__AIMSER_REGISTERING__ = true;
    try {
      sessionStorage.setItem("aimser_registering_lock", "1");
      sessionStorage.setItem(
        "aimser_pending_registration",
        JSON.stringify({ fullName, email, role, department })
      );
    } catch {}

    try {
      checkRateLimit("register_attempt", 5, 60000);
      FastCache.clearAll();

      try {
        const sysSnap = await getDoc(doc(db, "system", "config"));
        if (sysSnap.exists() && sysSnap.data().allowRegistration === false) {
          throw new Error("New account registration is currently disabled by the system administrator.");
        }
      } catch (sysErr) {
        if (sysErr.message && sysErr.message.includes("disabled by the system administrator")) {
          throw sysErr;
        }
      }

      // 1. Create User in Firebase Authentication
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const user = cred.user;

      const defaultAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=1b5375&color=faf2dd`;

      // 2. Write User Document Directly to Firestore 'users' Collection BEFORE Redirecting
      const userRecord = {
        uid: user.uid,
        fullName,
        email,
        role,
        department,
        avatarUrl: defaultAvatar,
        createdAt: serverTimestamp(),
        registeredAt: new Date().toISOString(),
        updatedAt: serverTimestamp()
      };

      await setDoc(doc(db, "users", user.uid), userRecord, { merge: true });

      // 3. Update Auth Display Profile
      try {
        await updateProfile(user, {
          displayName: fullName,
          photoURL: defaultAvatar
        });
      } catch {}

      // 4. Cache Profile & Log Registration Event
      FastCache.set("user_profile", {
        uid: user.uid,
        fullName,
        email,
        role,
        department,
        avatarUrl: defaultAvatar
      });

      await logAuditEvent(
        `New ${role.toUpperCase()} account registered: ${fullName} (${email})`,
        "REGISTRATION",
        email
      );

      window.__AIMSER_REGISTERING__ = false;
      try {
        sessionStorage.removeItem("aimser_registering_lock");
        sessionStorage.removeItem("aimser_pending_registration");
        sessionStorage.removeItem("aimser_v2_admin_users");
      } catch {}

      showRegisterStatus("Account created! Redirecting to workspace...", "success");
      window.location.replace("office.html");
    } catch (err) {
      window.__AIMSER_REGISTERING__ = false;
      try {
        sessionStorage.removeItem("aimser_registering_lock");
      } catch {}

      console.error("Registration error:", err);
      let friendlyMsg = err.message || "Registration failed. Please try again.";
      if (err.code === "auth/email-already-in-use") {
        friendlyMsg = "This email address is already registered. Please sign in instead.";
      } else if (err.code === "auth/invalid-email") {
        friendlyMsg = "Please enter a valid email address.";
      } else if (err.code === "auth/weak-password") {
        friendlyMsg = "Password is too weak. Please use at least 6 characters.";
      }
      showRegisterStatus(friendlyMsg, "error");
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = origBtnHtml;
      }
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initRegisterPage);
} else {
  initRegisterPage();
}