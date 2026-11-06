import { auth, db } from "./firebase-init.js";
import { initAuthGuard } from "./auth-guard.js";
import { logActivity } from "./audit-logger.js";
import { 
  doc, 
  updateDoc, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { 
  EmailAuthProvider, 
  reauthenticateWithCredential, 
  updatePassword,
  signOut 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const alertBox = document.getElementById("settings-alert-box");

const themeDarkOpt = document.getElementById("theme-dark-opt");
const themeLightOpt = document.getElementById("theme-light-opt");

const formProfile = document.getElementById("form-update-profile");
const inputFirstName = document.getElementById("setting-first-name");
const inputLastName = document.getElementById("setting-last-name");
const inputEmail = document.getElementById("setting-email");
const btnSaveProfile = document.getElementById("btn-save-profile");

const formPassword = document.getElementById("form-update-password");
const inputCurrentPass = document.getElementById("setting-current-pass");
const inputNewPass = document.getElementById("setting-new-pass");
const inputConfirmPass = document.getElementById("setting-confirm-pass");
const btnSavePassword = document.getElementById("btn-save-password");

const btnLogoutSettings = document.getElementById("btn-logout-settings");

let currentUser = null;

function showAlert(message, isError = false) {
  if (!alertBox) return;
  alertBox.style.display = "block";
  alertBox.textContent = message;
  alertBox.className = `settings-alert-banner ${isError ? "danger" : "success"}`;
  alertBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function syncThemeCards() {
  const currentTheme = document.documentElement.getAttribute("data-theme") || localStorage.getItem("aimser-theme") || "dark";
  
  if (currentTheme === "light") {
    themeLightOpt?.classList.add("active");
    themeDarkOpt?.classList.remove("active");
  } else {
    themeDarkOpt?.classList.add("active");
    themeLightOpt?.classList.remove("active");
  }
}

function applyTheme(themeName) {
  document.documentElement.setAttribute("data-theme", themeName);
  localStorage.setItem("aimser-theme", themeName);
  syncThemeCards();
}

themeDarkOpt?.addEventListener("click", () => applyTheme("dark"));
themeLightOpt?.addEventListener("click", () => applyTheme("light"));

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

formProfile?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const firstName = inputFirstName?.value.trim();
  const lastName = inputLastName?.value.trim();

  if (!firstName || !lastName) {
    showAlert("First and last names cannot be blank.", true);
    return;
  }

  btnSaveProfile.disabled = true;
  btnSaveProfile.textContent = "Saving...";

  try {
    const userRef = doc(db, "users", currentUser.uid);
    await updateDoc(userRef, {
      firstName,
      lastName,
      updatedAt: serverTimestamp()
    });

    await logActivity({
      category: "System",
      details: `${currentUser.email} updated profile names to ${firstName} ${lastName}`,
      classroomCode: "GLOBAL",
      userEmail: currentUser.email
    });

    showAlert("Profile details updated successfully!", false);

    const fullName = `${firstName} ${lastName}`;
    const topbarName = document.getElementById("topbar-user-name");
    const sidebarName = document.getElementById("sidebar-greeting-name");
    if (topbarName) topbarName.textContent = fullName;
    if (sidebarName) sidebarName.textContent = fullName;

  } catch (err) {
    console.error("Profile update failed:", err);
    showAlert("Failed to update profile: " + err.message, true);
  } finally {
    btnSaveProfile.disabled = false;
    btnSaveProfile.textContent = "Save Profile Changes";
  }
});

formPassword?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const currentPass = inputCurrentPass.value;
  const newPass = inputNewPass.value;
  const confirmPass = inputConfirmPass.value;

  if (newPass !== confirmPass) {
    showAlert("New passwords do not match.", true);
    return;
  }

  if (newPass.length < 6) {
    showAlert("New password must be at least 6 characters.", true);
    return;
  }

  btnSavePassword.disabled = true;
  btnSavePassword.textContent = "Updating...";

  try {
    const credential = EmailAuthProvider.credential(currentUser.email, currentPass);
    await reauthenticateWithCredential(auth.currentUser, credential);
    await updatePassword(auth.currentUser, newPass);

    await logActivity({
      category: "System",
      details: `${currentUser.email} changed their account password via Settings`,
      classroomCode: "GLOBAL",
      userEmail: currentUser.email
    });

    showAlert("Password successfully updated in Firebase Authentication!", false);
    formPassword.reset();

  } catch (err) {
    console.error("Password update error:", err);
    let msg = "Failed to change password: " + err.message;
    if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
      msg = "Current password entered is incorrect.";
    }
    showAlert(msg, true);
  } finally {
    btnSavePassword.disabled = false;
    btnSavePassword.textContent = "Update Password";
  }
});

// Dedicated Sign Out Handler in Settings
btnLogoutSettings?.addEventListener("click", async () => {
  const confirmed = confirm("Are you sure you want to end your simulator session and sign out?");
  if (!confirmed) return;

  try {
    await signOut(auth);
    window.location.replace("login.html");
  } catch (err) {
    console.error("Sign-out failure:", err);
    showAlert("Failed to sign out: " + err.message, true);
  }
});

initAuthGuard({
  onReady: ({ user, userData }) => {
    currentUser = user;

    if (inputFirstName) inputFirstName.value = userData.firstName || "";
    if (inputLastName) inputLastName.value = userData.lastName || "";
    if (inputEmail) inputEmail.value = user.email || "";

    syncThemeCards();
  }
});