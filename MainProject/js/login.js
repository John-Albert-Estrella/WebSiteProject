import { auth, db } from "./firebase-init.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { redirectBasedOnRole } from "./auth-guard.js";

const loginForm = document.getElementById('loginForm');

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const submitBtn = loginForm.querySelector('button[type="submit"]');

  submitBtn.innerText = "Verifying...";
  submitBtn.disabled = true;

  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Fetch account role from Firestore
    const userDoc = await getDoc(doc(db, "users", user.uid));
    
    if (!userDoc.exists()) {
      throw new Error("User record not found in database.");
    }

    const userData = userDoc.data();
    redirectBasedOnRole(userData.role);

  } catch (error) {
    console.error("Login Error:", error);
    alert(error.message || "Invalid credentials.");
    submitBtn.innerText = "Sign In";
    submitBtn.disabled = false;
  }
});