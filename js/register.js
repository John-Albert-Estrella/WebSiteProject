import { auth, db } from "./firebase-init.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { 
  doc, 
  setDoc, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// Department coordinator master passkey
const VALID_FACULTY_PASSKEY = "AIMSER_FACULTY_2026";

function setupRegistration() {
  const registerForm = document.getElementById("form-register") || document.querySelector("form");
  const btnRegister = document.getElementById("btn-register") || document.querySelector("button[type='submit']");

  if (!registerForm) {
    console.warn("Registration form not found yet.");
    return;
  }

  registerForm.onsubmit = async (e) => {
    e.preventDefault();

    // 1. Defensively extract values
    const firstName = (document.getElementById("reg-firstname") || document.getElementById("first-name"))?.value.trim() || "";
    const lastName = (document.getElementById("reg-lastname") || document.getElementById("last-name"))?.value.trim() || "";
    const email = (document.getElementById("reg-email") || document.getElementById("email"))?.value.trim() || "";
    const password = (document.getElementById("reg-password") || document.getElementById("password"))?.value || "";
    const confirmPassword = (document.getElementById("reg-confirm-password") || document.getElementById("confirm-password"))?.value || "";
    const role = document.getElementById("register-role")?.value || "student";
    const facultyCodeInput = document.getElementById("reg-faculty-code")?.value.trim() || "";
    const classroomCode = (document.getElementById("reg-classcode") || document.getElementById("class-code"))?.value.trim().toUpperCase() || "";

    // 2. Validate input fields
    if (!firstName || !lastName || !email || !password) {
      alert("Please fill out all required fields.");
      return;
    }

    if (password.length < 6) {
      alert("Password must be at least 6 characters long.");
      return;
    }

    if (confirmPassword && password !== confirmPassword) {
      alert("Passwords do not match. Please re-enter.");
      return;
    }

    // 3. Enforce Faculty Passkey Check
    if (role === "faculty") {
      if (!facultyCodeInput) {
        alert("Authorization Error: Please enter the Faculty Authorization Code.");
        return;
      }
      if (facultyCodeInput !== VALID_FACULTY_PASSKEY) {
        alert("Access Denied: Invalid Faculty Authorization Code.");
        return;
      }
    }

    // 4. Update UI loading state
    if (btnRegister) {
      btnRegister.disabled = true;
      btnRegister.textContent = "Creating Account...";
    }

    try {
      // 5. Create user in Firebase Authentication
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // 6. Write profile document in Firestore
      await setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        firstName: firstName,
        lastName: lastName,
        email: email,
        role: role,
        classroomCode: role === "student" ? classroomCode : "",
        createdAt: serverTimestamp()
      });

      alert("Registration successful! Redirecting to login...");

      // 7. Route to login relative to deployment path
      const currentPath = window.location.pathname;
      const basePath = currentPath.substring(0, currentPath.lastIndexOf("/") + 1);
      window.location.replace(basePath + "login.html");

    } catch (error) {
      console.error("Registration Error:", error);

      let message = error.message;
      if (error.code === "auth/email-already-in-use") {
        message = "This email is already in use. Please sign in instead.";
      } else if (error.code === "auth/invalid-email") {
        message = "Invalid institutional email address format.";
      } else if (error.code === "auth/weak-password") {
        message = "Password must be at least 6 characters.";
      }

      alert("Registration failed: " + message);
    } finally {
      if (btnRegister) {
        btnRegister.disabled = false;
        btnRegister.textContent = "Create Simulator Account";
      }
    }
  };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupRegistration);
} else {
  setupRegistration();
}