// js/auth-guard.js
import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

/**
 * Robust Auth Guard: Resolves user profile, updates topbar/sidebar, and prevents null errors.
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

      const userData = snap.exists() ? snap.data() : {};
      const role = userData.role || "student";
      const isFaculty = role === "faculty";
      
      const rawName = `${userData.firstName || ""} ${userData.lastName || ""}`.trim() || user.displayName || user.email.split("@")[0];
      const displayName = isFaculty ? `Prof. ${userData.lastName || rawName}` : rawName;

      // 1. Role verification check
      if (options.requiredRole && role !== options.requiredRole) {
        if (options.requiredRole === "faculty") {
          alert("Access restricted: This area requires a Faculty account.");
          window.location.replace("student-dashboard.html");
          return;
        }
      }

      // 2. Fix Dashboard link dynamically in Sidebar
      const dashboardLinks = document.querySelectorAll('.sidebar-nav a[href*="dashboard"]');
      dashboardLinks.forEach(link => {
        link.href = isFaculty ? "faculty-dashboard.html" : "student-dashboard.html";
      });

      // 3. Update User Name across all variations of topbar & sidebar elements
      const nameElements = [
        document.getElementById("topbar-user-name"),
        document.getElementById("topbar-student-name"),
        document.getElementById("faculty-display-name"),
        document.getElementById("sidebar-greeting-name"),
        document.getElementById("student-sidebar-name")
      ];

      nameElements.forEach(el => {
        if (el) el.textContent = displayName;
      });

      // 4. Update Role Badge across all variations
      const badgeElements = [
        document.getElementById("topbar-role-badge"),
        document.querySelector(".role-tag"),
        document.querySelector(".badge-role")
      ];

      badgeElements.forEach(badge => {
        if (badge) {
          badge.textContent = role.toUpperCase();
          badge.className = isFaculty ? "role-tag faculty" : "role-tag";
        }
      });

      // 5. Trigger page callback
      if (typeof options.onReady === "function") {
        options.onReady({ user, userData, role });
      }

    } catch (err) {
      console.error("Auth guard error:", err);
    }
  });
}