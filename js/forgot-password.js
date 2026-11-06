import { auth, db } from "./firebase-init.js";
import { sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const formReset = document.getElementById("form-forgot-password");
const emailInput = document.getElementById("reset-email");
const btnSubmit = document.getElementById("btn-submit-reset");
const alertBox = document.getElementById("recovery-alert");

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

formReset?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = emailInput?.value.trim().toLowerCase();

  if (!email) {
    showAlert("Please enter your institutional email address.", true);
    return;
  }

  btnSubmit.disabled = true;
  btnSubmit.textContent = "Verifying account...";

  try {
    // 1. Verify that user is registered in Firestore
    const usersQ = query(collection(db, "users"), where("email", "==", email));
    const userSnap = await getDocs(usersQ);

    if (userSnap.empty) {
      showAlert("No account registered with this institutional email.", true);
      btnSubmit.disabled = false;
      btnSubmit.textContent = "Send Recovery Link to Email";
      return;
    }

    btnSubmit.textContent = "Sending link...";

    // 2. Direct the email link to your custom reset-password.html page
    const currentOrigin = window.location.origin;
    const currentPath = window.location.pathname;
    const targetUrl = currentOrigin + currentPath.replace("forgot-password.html", "reset-password.html");

    const actionCodeSettings = {
      url: targetUrl,
      handleCodeInApp: false
    };

    await sendPasswordResetEmail(auth, email, actionCodeSettings);

    showAlert(`Password recovery link dispatched to ${email}! Please check your Inbox and Spam folder.`, false);
    formReset.reset();

    // Cooldown timer to prevent accidental double-clicks that revoke previous tokens
    let countdown = 30;
    const interval = setInterval(() => {
      btnSubmit.textContent = `Wait ${countdown}s before requesting again`;
      countdown--;
      if (countdown < 0) {
        clearInterval(interval);
        btnSubmit.disabled = false;
        btnSubmit.textContent = "Send Recovery Link to Email";
      }
    }, 1000);

  } catch (err) {
    console.error("Password reset failure:", err);
    let errorMsg = "Could not send recovery link. Please try again later.";

    if (err.code === "auth/user-not-found") {
      errorMsg = "No account found matching this email address.";
    } else if (err.code === "auth/invalid-email") {
      errorMsg = "Please enter a valid institutional email format.";
    } else if (err.code === "auth/too-many-requests") {
      errorMsg = "Too many reset attempts. Please wait 10 minutes before requesting again.";
    } else if (err.code === "auth/unauthorized-continue-uri") {
      errorMsg = "Domain not whitelisted in Firebase Console. Add your domain under Authorized Domains.";
    }

    showAlert(errorMsg, true);
    btnSubmit.disabled = false;
    btnSubmit.textContent = "Send Recovery Link to Email";
  }
});