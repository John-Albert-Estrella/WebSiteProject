import { auth, db } from "./firebase-init.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { logActivity } from "./audit-logger.js";

// DOM Elements - Perfectly matched to register.html IDs
const formRegister = document.getElementById("form-register");
const inputFirstName = document.getElementById("reg-first-name");
const inputLastName = document.getElementById("reg-last-name");
const inputEmail = document.getElementById("reg-email");
const inputPassword = document.getElementById("reg-password");
const inputConfirmPassword = document.getElementById("reg-confirm-password");
const btnSubmit = document.getElementById("btn-submit-register");
const errorBox = document.getElementById("register-error-box");

// Password Visibility Toggle Logic
document.querySelectorAll(".btn-toggle-password").forEach((btn) => {
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
  if (!errorBox) {
    alert(message);
    return;
  }
  errorBox.style.display = "block";
  errorBox.textContent = message;
  errorBox.className = "settings-alert-banner danger";
  errorBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

formRegister?.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (errorBox) errorBox.style.display = "none";

  const firstName = inputFirstName?.value.trim();
  const lastName = inputLastName?.value.trim();
  const email = inputEmail?.value.trim().toLowerCase();
  const password = inputPassword?.value;
  const confirmPassword = inputConfirmPassword?.value;

  // Validation
  if (!firstName || !lastName || !email || !password || !confirmPassword) {
    showError("Please fill out all required fields.");
    return;
  }

  if (password !== confirmPassword) {
    showError("Passwords do not match.");
    return;
  }

  if (password.length < 6) {
    showError("Password must be at least 6 characters long.");
    return;
  }

  btnSubmit.disabled = true;
  btnSubmit.textContent = "Registering Account...";

  try {
    // 1. Create User in Firebase Auth
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // 2. Default initial role: student (admins promote via Admin Console)
    const initialRole = "student";

    // 3. Create User Profile in Firestore
    await setDoc(doc(db, "users", user.uid), {
      firstName,
      lastName,
      email,
      role: initialRole,
      classroomCode: null,
      classroomId: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    // 4. Log Audit Activity
    await logActivity({
      category: "Authentication",
      details: `New account registered: ${email} (${firstName} ${lastName}) with role [${initialRole}]`,
      classroomCode: "GLOBAL",
      userEmail: email
    });

    // 5. Route to Student Dashboard
    window.location.replace("student-dashboard.html");

  } catch (err) {
    console.error("Registration error:", err);
    let message = "Could not complete registration. Please try again.";

    if (err.code === "auth/email-already-in-use") {
      message = "An account with this institutional email already exists. Please sign in.";
    } else if (err.code === "auth/invalid-email") {
      message = "Please enter a valid institutional email address.";
    } else if (err.code === "auth/weak-password") {
      message = "Password should be at least 6 characters.";
    } else if (err.code === "auth/network-request-failed") {
      message = "Network error. Please check your internet connection.";
    } else if (err.message) {
      message = err.message;
    }

    showError(message);
    btnSubmit.disabled = false;
    btnSubmit.textContent = "Complete Registration";
  }
});