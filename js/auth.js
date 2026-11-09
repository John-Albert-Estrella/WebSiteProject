import { auth, db } from "./firebase-init.js";
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  updateProfile,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { 
  doc, 
  getDoc, 
  setDoc, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// DOM Elements - Login
const formLogin = document.getElementById("form-login");
const inputLoginEmail = document.getElementById("login-email");
const inputLoginPassword = document.getElementById("login-password");
const btnLoginSubmit = document.getElementById("btn-login-submit");

// DOM Elements - Register
const formRegister = document.getElementById("form-register");
const inputRegFirstName = document.getElementById("reg-first-name");
const inputRegLastName = document.getElementById("reg-last-name");
const inputRegEmail = document.getElementById("reg-email");
const inputRegPassword = document.getElementById("reg-password");
const selectRegRole = document.getElementById("reg-role");
const btnRegisterSubmit = document.getElementById("btn-register-submit");

// -------------------------------------------------------------
// CENTRALIZED ROUTER
// -------------------------------------------------------------
function redirectByRole(role) {
  if (role === "admin") {
    window.location.replace("admin-dashboard.html");
  } else {
    // Both faculty and student roles route directly to the Office module
    window.location.replace("office.html");
  }
}

// Auto-redirect if already signed in and browsing login or register
onAuthStateChanged(auth, async (user) => {
  if (user && (window.location.pathname.endsWith("login.html") || window.location.pathname.endsWith("register.html"))) {
    try {
      const userSnap = await getDoc(doc(db, "users", user.uid));
      if (userSnap.exists()) {
        redirectByRole(userSnap.data().role);
      }
    } catch (err) {
      console.warn("Auth check failed:", err);
    }
  }
});

// -------------------------------------------------------------
// 1. LOGIN HANDLER
// -------------------------------------------------------------
if (formLogin) {
  formLogin.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = inputLoginEmail?.value.trim();
    const password = inputLoginPassword?.value;

    if (!email || !password) {
      alert("Please enter both email and password.");
      return;
    }

    if (btnLoginSubmit) {
      btnLoginSubmit.disabled = true;
      btnLoginSubmit.textContent = "Signing In...";
    }

    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const userDocRef = doc(db, "users", cred.user.uid);
      const userSnap = await getDoc(userDocRef);

      if (!userSnap.exists()) {
        alert("Account authenticated, but user record was not found in Firestore.");
        return;
      }

      const userData = userSnap.data();
      redirectByRole(userData.role);
    } catch (error) {
      console.error("Login Error:", error);
      alert("Sign-in failed: " + error.message);
    } finally {
      if (btnLoginSubmit) {
        btnLoginSubmit.disabled = false;
        btnLoginSubmit.textContent = "Sign In";
      }
    }
  });
}

// -------------------------------------------------------------
// 2. REGISTRATION HANDLER
// -------------------------------------------------------------
if (formRegister) {
  formRegister.addEventListener("submit", async (e) => {
    e.preventDefault();

    const firstName = inputRegFirstName?.value.trim() || "";
    const lastName = inputRegLastName?.value.trim() || "";
    const email = inputRegEmail?.value.trim();
    const password = inputRegPassword?.value;
    const role = selectRegRole?.value || "student";

    if (!email || !password) {
      alert("Please fill out all required fields.");
      return;
    }

    if (password.length < 6) {
      alert("Password must be at least 6 characters long.");
      return;
    }

    if (btnRegisterSubmit) {
      btnRegisterSubmit.disabled = true;
      btnRegisterSubmit.textContent = "Creating Account...";
    }

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const displayName = `${firstName} ${lastName}`.trim() || email.split("@")[0];

      // Update Auth Profile Display Name
      await updateProfile(cred.user, { displayName });

      // Save user document into Firestore
      await setDoc(doc(db, "users", cred.user.uid), {
        uid: cred.user.uid,
        firstName,
        lastName,
        email,
        role,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      alert("Account created successfully!");
      redirectByRole(role);
    } catch (error) {
      console.error("Registration Error:", error);
      alert("Registration failed: " + error.message);
    } finally {
      if (btnRegisterSubmit) {
        btnRegisterSubmit.disabled = false;
        btnRegisterSubmit.textContent = "Register";
      }
    }
  });
}