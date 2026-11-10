// js/auth.js - Authentication Engine & Session Dispatcher
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

document.addEventListener("DOMContentLoaded", () => {
  setupLoginForm();
  setupRegisterForm();
  setupForgotPassword();
});

// -------------------------------------------------------------
// 1. Sign In Flow
// -------------------------------------------------------------
function setupLoginForm() {
  const loginForm = document.getElementById("login-form");
  const submitBtn = document.getElementById("login-submit-btn");
  const statusMsg = document.getElementById("auth-status-message");

  if (!loginForm) return;

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const emailInput = document.getElementById("login-email");
    const passInput = document.getElementById("login-password");

    const email = emailInput ? emailInput.value.trim() : "";
    const password = passInput ? passInput.value : "";

    // Clear previous errors
    showStatus("", "clear");

    // Client-side quick check
    if (!email || !password) {
      showStatus("Please enter both your email and password.", "error");
      return;
    }

    // Set UI to loading state
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Authenticating...';
    }

    try {
      console.log("Attempting sign-in for:", email);
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      showStatus("Sign-in successful! Redirecting...", "success");

      // Verify user role in Firestore to determine destination
      let destination = "office.html";
      try {
        const userDocRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userDocRef);

        if (userSnap.exists()) {
          const userData = userSnap.data();
          if (userData.role === "admin") {
            destination = "admin-dashboard.html";
          }
        } else {
          // Self-heal: ensure user document exists
          await setDoc(userDocRef, {
            email: user.email,
            fullName: user.displayName || user.email.split("@")[0],
            role: "student",
            createdAt: serverTimestamp()
          });
        }
      } catch (err) {
        console.warn("Could not query user role, defaulting to office.html:", err);
      }

      // Smooth redirection
      setTimeout(() => {
        window.location.replace(destination);
      }, 500);

    } catch (error) {
      console.error("Sign-in error:", error);
      const friendlyMessage = getFriendlyAuthError(error.code, error.message);
      showStatus(friendlyMessage, "error");

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign In to Simulator';
      }
    }
  });
}

// -------------------------------------------------------------
// 2. Registration Flow
// -------------------------------------------------------------
function setupRegisterForm() {
  const registerForm = document.getElementById("register-form");
  const submitBtn = document.getElementById("reg-submit-btn");

  if (!registerForm) return;

  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fullNameInput = document.getElementById("reg-fullname");
    const emailInput = document.getElementById("reg-email");
    const roleInput = document.getElementById("reg-role");
    const passwordInput = document.getElementById("reg-password");

    const fullName = fullNameInput ? fullNameInput.value.trim() : "";
    const email = emailInput ? emailInput.value.trim() : "";
    const role = roleInput ? roleInput.value : "student";
    const password = passwordInput ? passwordInput.value : "";

    showStatus("", "clear");

    if (!fullName || !email || !password) {
      showStatus("Please complete all required fields.", "error");
      return;
    }

    if (password.length < 6) {
      showStatus("Password must be at least 6 characters.", "error");
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating Account...';
    }

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      await updateProfile(user, { displayName: fullName });

      // Save initial profile record in Firestore
      await setDoc(doc(db, "users", user.uid), {
        fullName: fullName,
        email: email,
        role: role,
        department: "",
        createdAt: serverTimestamp()
      });

      showStatus("Account created successfully! Redirecting to workspace...", "success");

      setTimeout(() => {
        window.location.replace(role === "admin" ? "admin-dashboard.html" : "office.html");
      }, 700);

    } catch (error) {
      console.error("Registration error:", error);
      const friendlyMessage = getFriendlyAuthError(error.code, error.message);
      showStatus(friendlyMessage, "error");

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = "Create Account";
      }
    }
  });
}

// -------------------------------------------------------------
// 3. Forgot Password Flow
// -------------------------------------------------------------
function setupForgotPassword() {
  const forgotLink = document.getElementById("forgot-password-link");
  if (!forgotLink) return;

  forgotLink.addEventListener("click", async (e) => {
    e.preventDefault();
    const emailInput = document.getElementById("login-email");
    const email = emailInput ? emailInput.value.trim() : "";

    if (!email) {
      showStatus("Please enter your email above, then click 'Forgot Password?'.", "error");
      if (emailInput) emailInput.focus();
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email);
      showStatus(`Password reset link sent to ${email}. Check your inbox or spam folder.`, "success");
    } catch (error) {
      console.error("Reset password error:", error);
      const msg = getFriendlyAuthError(error.code, error.message);
      showStatus(msg, "error");
    }
  });
}

// -------------------------------------------------------------
// Helpers: Error Translation & UI Notification Banner
// -------------------------------------------------------------
function showStatus(message, type) {
  const statusMsg = document.getElementById("auth-status-message");
  if (!statusMsg) return;

  if (type === "clear" || !message) {
    statusMsg.style.display = "none";
    statusMsg.textContent = "";
    statusMsg.className = "status-msg";
    return;
  }

  statusMsg.textContent = message;
  statusMsg.className = `status-msg ${type}`;
  statusMsg.style.display = "block";
}

function getFriendlyAuthError(code, defaultMsg) {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Invalid email or password. Please double check and try again.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/user-disabled":
      return "This account has been disabled. Please contact your instructor or administrator.";
    case "auth/email-already-in-use":
      return "An account with this email already exists. Please sign in instead.";
    case "auth/weak-password":
      return "Password is too weak. Please choose at least 6 characters.";
    case "auth/network-request-failed":
      return "Network error. Please verify your internet connection.";
    case "auth/too-many-requests":
      return "Too many failed attempts. Access to this account has been temporarily disabled. Please reset your password or try again later.";
    default:
      return defaultMsg || "An authentication error occurred. Please try again.";
  }
}