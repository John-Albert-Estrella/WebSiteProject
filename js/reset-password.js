import { auth, db } from "./firebase-init.js";
import { 
  verifyPasswordResetCode, 
  confirmPasswordReset 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  updateDoc, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const formConfirm = document.getElementById("form-confirm-password");
const newPassInput = document.getElementById("inp-new-password");
const confirmPassInput = document.getElementById("inp-confirm-password");
const btnSave = document.getElementById("btn-save-password");
const alertBox = document.getElementById("reset-alert-box");
const emailTargetLabel = document.getElementById("user-email-target");

// Password Visibility Toggles
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

function showAlert(message, isError = false) {
  if (!alertBox) return;
  alertBox.style.display = "block";
  alertBox.textContent = message;

  if (isError) {
    alertBox.style.background = "var(--danger-bg)";
    alertBox.style.color = "var(--danger)";
    alertBox.style.border = "1px solid rgba(248, 113, 113, 0.4)";
  } else {
    alertBox.style.background = "var(--success-bg)";
    alertBox.style.color = "var(--success)";
    alertBox.style.border = "1px solid rgba(52, 211, 153, 0.4)";
  }
}

// 1. Extract oobCode from URL query parameters (sent by Firebase email)
const urlParams = new URLSearchParams(window.location.search);
const oobCode = urlParams.get("oobCode");

let confirmedEmail = "";

async function initResetSession() {
  if (!oobCode) {
    showAlert("No password reset token detected. Please request a new recovery link.", true);
    if (formConfirm) formConfirm.style.display = "none";
    return;
  }

  try {
    // 2. Verify validity of the single-use token with Firebase Authentication
    confirmedEmail = await verifyPasswordResetCode(auth, oobCode);
    if (emailTargetLabel) {
      emailTargetLabel.textContent = `Resetting password for: ${confirmedEmail}`;
    }
  } catch (err) {
    console.error("Token verification failed:", err);
    showAlert("This recovery link has expired or has already been used. Please request a new one.", true);
    if (formConfirm) formConfirm.style.display = "none";
  }
}

initResetSession();

// 3. Confirm and Overwrite Password in Firebase Auth
formConfirm?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const newPassword = newPassInput.value;
  const confirmPassword = confirmPassInput.value;

  if (newPassword !== confirmPassword) {
    showAlert("Passwords do not match.", true);
    return;
  }

  if (newPassword.length < 6) {
    showAlert("Password must be at least 6 characters.", true);
    return;
  }

  btnSave.disabled = true;
  btnSave.textContent = "Updating Password...";

  try {
    // Direct Google Firebase Auth password update
    await confirmPasswordReset(auth, oobCode, newPassword);

    // Optional: Log update timestamp in Firestore profile
    try {
      const q = query(collection(db, "users"), where("email", "==", confirmedEmail));
      const snap = await getDocs(q);
      if (!snap.empty) {
        await updateDoc(snap.docs[0].ref, {
          lastPasswordReset: serverTimestamp()
        });
      }
    } catch (ignore) {
      // Non-blocking metadata log
    }

    showAlert("Password successfully updated! Redirecting to sign in...", false);

    setTimeout(() => {
      window.location.replace("login.html");
    }, 2000);

  } catch (err) {
    console.error("Failed to confirm password reset:", err);
    showAlert("Failed to update password: " + (err.message || "Token expired."), true);
    btnSave.disabled = false;
    btnSave.textContent = "Update Account Password";
  }
});