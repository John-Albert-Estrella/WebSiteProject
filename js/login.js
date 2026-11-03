import { auth, db } from "./firebase-init.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

function setupLogin() {
  const loginForm = document.getElementById("form-login") || document.querySelector("form");
  const btnLogin = document.getElementById("btn-login") || document.querySelector("button[type='submit']");

  if (!loginForm) {
    console.warn("Login form element not found.");
    return;
  }

  loginForm.onsubmit = async (e) => {
    e.preventDefault();

    const email = (document.getElementById("login-email") || document.getElementById("email"))?.value.trim() || "";
    const password = (document.getElementById("login-password") || document.getElementById("password"))?.value || "";

    if (!email || !password) {
      alert("Please enter both your email and password.");
      return;
    }

    if (btnLogin) {
      btnLogin.disabled = true;
      btnLogin.textContent = "Authenticating...";
    }

    try {
      // 1. Authenticate with Firebase
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // 2. Fetch role from Firestore
      const userDocSnap = await getDoc(doc(db, "users", user.uid));

      const currentPath = window.location.pathname;
      const basePath = currentPath.substring(0, currentPath.lastIndexOf("/") + 1);

      if (!userDocSnap.exists()) {
        // Fallback default routing if profile document is missing
        window.location.replace(basePath + "student-dashboard.html");
        return;
      }

      const userData = userDocSnap.data();

      // 3. Route according to verified role
      if (userData.role === "faculty") {
        window.location.replace(basePath + "faculty-dashboard.html");
      } else {
        window.location.replace(basePath + "student-dashboard.html");
      }

    } catch (error) {
      console.error("Login Error details:", error);

      // Distinct error handling for API origin blocks vs wrong credentials
      if (error.code === "auth/invalid-credential" || error.code === "auth/wrong-password" || error.code === "auth/user-not-found") {
        alert("Sign In Failed: Incorrect email or password.");
      } else if (error.message && (error.message.includes("API key") || error.message.includes("requests from this referer are blocked"))) {
        alert("Origin Blocked: Use http://localhost:5500 instead of 127.0.0.1 to match your Google Cloud API key restrictions.");
      } else if (error.code === "auth/network-request-failed") {
        alert("Network Error: Could not connect to authentication servers. If you are on 127.0.0.1, switch to localhost:5500.");
      } else {
        alert("Sign In Failed: " + error.message);
      }
    } finally {
      if (btnLogin) {
        btnLogin.disabled = false;
        btnLogin.textContent = "Sign In to Simulator";
      }
    }
  };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupLogin);
} else {
  setupLogin();
}