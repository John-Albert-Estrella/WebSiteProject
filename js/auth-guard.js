// js/auth-guard.js
import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

/**
 * Initializes authentication, role checks, and sidebar links across all pages.
 * @param {Object} options
 * @param {string} [options.requiredRole] - "faculty" or "student" (optional)
 * @param {Function} [options.onReady] - callback returning { user, userData }
 */
export function initAuthGuard(options = {}) {
  const btnLogout = document.getElementById("btn-logout");
  btnLogout?.addEventListener("click", async () => {
    try {
      await signOut(auth);
      window.location.replace("login.html");
    } catch (err) {
      console.error("Sign out error:", err);
    }
  });

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.replace("login.html");
      return;
    }

    try {
      const userRef = doc(db, "users", user.uid);
      const snap = await getDoc(userRef);

      if (!snap.exists()) {
        console.warn("User profile record not found in Firestore.");
        return;
      }

      const userData = snap.data();
      const role = userData.role || "student";
      const fullName = `${userData.firstName || ""} ${userData.lastName || ""}`.trim() || user.email;

      // 1. Enforce page role requirement if specified
      if (options.requiredRole && role !== options.requiredRole) {
        if (options.requiredRole === "faculty") {
          alert("Access restricted: This area requires a Faculty account.");
          window.location.replace("student-dashboard.html");
          return;
        }
      }

      // 2. Fix the Sidebar Dashboard Link dynamically
      const dashboardLink = document.querySelector('.sidebar-nav a[href*="dashboard"]');
      if (dashboardLink) {
        dashboardLink.href = role === "faculty" ? "faculty-dashboard.html" : "student-dashboard.html";
      }

      // 3. Update Sidebar Greeting & Topbar Info
      const sidebarGreeting = document.getElementById("sidebar-greeting-name");
      const facultyDisplay = document.getElementById("faculty-display-name");
      const topbarName = document.getElementById("topbar-student-name") || document.getElementById("topbar-user-name");
      const roleBadge = document.querySelector(".role-tag") || document.querySelector(".badge-role");

      if (sidebarGreeting) {
        sidebarGreeting.textContent = role === "faculty" ? `Prof. ${userData.lastName || fullName}` : fullName;
      }

      if (facultyDisplay) {
        facultyDisplay.textContent = `Prof. ${userData.lastName || fullName}`;
      }

      if (topbarName) {
        topbarName.textContent = role === "faculty" ? `Prof. ${userData.lastName || fullName}` : fullName;
      }

      if (roleBadge) {
        roleBadge.textContent = role.toUpperCase();
        if (role === "faculty") {
          roleBadge.className = "role-tag faculty";
        } else {
          roleBadge.className = "role-tag";
        }
      }

      // 4. Trigger caller logic
      if (typeof options.onReady === "function") {
        options.onReady({ user, userData, role });
      }

    } catch (err) {
      console.error("Auth guard error:", err);
    }
  });
}