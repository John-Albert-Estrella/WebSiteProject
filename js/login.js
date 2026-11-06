import { auth, db } from "./firebase-init.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const formLogin = document.getElementById("form-login");
const inputEmail = document.getElementById("login-email");
const inputPassword = document.getElementById("login-password");
const btnSubmit = document.getElementById("btn-submit-login");
const errorBox = document.getElementById("login-error-box");

// Password Censoring / Uncensoring Toggle Handlers
document.querySelectorAll(".btn-toggle-password").forEach(btn => {
  btn.addEventListener("click", () => {
    const targetId = btn.dataset.target;
    const input = document.getElementById(targetId);
    if (!input) return;

    if (input.type === "password") {
      input.type = "text";
      btn.textContent = "🙈";
    } else {
      input.type = "password";
      btn.textContent = "👁️";
    }
  });
});

function showError(message) {
  if (!errorBox) return;
  errorBox.style.display = "block";
  errorBox.textContent = message;
}

formLogin?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = inputEmail.value.trim();
  const password = inputPassword.value;

  if (!email || !password) return;

  btnSubmit.disabled = true;
  btnSubmit.textContent = "Signing In...";
  if (errorBox) errorBox.style.display = "none";

  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    const userDoc = await getDoc(doc(db, "users", user.uid));
    const role = userDoc.exists() ? userDoc.data().role : "student";

    if (role === "admin") {
      window.location.replace("admin-dashboard.html");
    } else if (role === "faculty") {
      window.location.replace("faculty-dashboard.html");
    } else {
      window.location.replace("student-dashboard.html");
    }
  } catch (err) {
    console.error("Login failure:", err);
    let errorMsg = "Failed to sign in. Please check your email and password.";
    if (err.code === "auth/invalid-credential" || err.code === "auth/user-not-found" || err.code === "auth/wrong-password") {
      errorMsg = "Invalid email or password. Please verify your credentials.";
    } else if (err.code === "auth/too-many-requests") {
      errorMsg = "Account temporarily locked due to multiple failed attempts. Try again later or reset password.";
    }
    showError(errorMsg);
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.textContent = "Sign In to Simulator";
  }
});