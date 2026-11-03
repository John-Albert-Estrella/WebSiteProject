import { auth, db } from "./firebase-init.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

function setupLogin() {
  const loginForm = document.getElementById("form-login") || document.querySelector("form");
  const btnLogin = document.getElementById("btn-login") || document.querySelector("button[type='submit']");

  if (!loginForm) {
    console.warn("Login form not found in DOM.");
    return;
  }

  loginForm.onsubmit = async (e) => {
    e.preventDefault();

    // 1. Resolve inputs defensively
    const emailInput = document.getElementById("login-email") || document.getElementById("email") || document.querySelector("input[type='email']");
    const passwordInput = document.getElementById("login-password") || document.getElementById("password") || document.querySelector("input[type='password']");

    const email = emailInput?.value.trim() || "";
    const password = passwordInput?.value || "";

    if (!email || !password) {
      alert("Please enter both your email address and password.");
      return;
    }

    // 2. Button state
    if (btnLogin) {
      btnLogin.disabled = true;
      btnLogin.textContent = "Authenticating...";
    }

    try {
      // 3. Authenticate with Firebase Auth
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // 4. Fetch User Profile Document to check Role
      const userDocRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userDocRef);

      const currentPath = window.location.pathname;
      const basePath = currentPath.substring(0, currentPath.lastIndexOf("/") + 1);

      if (!userSnap.exists()) {
        console.warn("User has an auth record but no Firestore document. Defaulting to student.");
        window.location.replace(basePath + "student-dashboard.html");
        return;
      }

      const userData = userSnap.data();
      const role = userData.role || "student";

      // 5. Role-based redirect
      if (role === "faculty" || role === "admin") {
        window.location.replace(basePath + "faculty-dashboard.html");
      } else {
        window.location.replace(basePath + "student-dashboard.html");
      }

    } catch (error) {
      console.error("Login Error:", error);

      let message = "Invalid email or password.";
      if (error.code === "auth/user-not-found" || error.code === "auth/wrong-password" || error.code === "auth/invalid-credential") {
        message = "Incorrect email address or password. Please verify and try again.";
      } else if (error.code === "auth/invalid-email") {
        message = "The email address format is invalid.";
      } else if (error.code === "auth/too-many-requests") {
        message = "Too many failed attempts. Please wait a few minutes before trying again.";
      }

      alert("Sign In Failed: " + message);
    } finally {
      if (btnLogin) {
        btnLogin.disabled = false;
        btnLogin.textContent = "Sign In";
      }
    }
  };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupLogin);
} else {
  setupLogin();
}