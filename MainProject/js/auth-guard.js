import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

/**
 * Global Route Guard & Dynamic Role Manager
 * @param {Array<string>} allowedRoles - e.g. ['faculty'], ['student'], ['admin']
 */
export function enforceAuth(allowedRoles = []) {
  onAuthStateChanged(auth, async (user) => {
    // 1. Not signed in -> send to login
    if (!user) {
      safeRedirect("login.html");
      return;
    }

    try {
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      // 2. Auth exists but no Firestore profile -> reset to login
      if (!userSnap.exists()) {
        await signOut(auth);
        safeRedirect("login.html");
        return;
      }

      const userData = userSnap.data();

      // 3. Root index check (allowedRoles empty) -> redirect based on role
      if (allowedRoles.length === 0) {
        redirectBasedOnRole(userData.role);
        return;
      }

      // 4. Role Guard: prevent cross-portal unauthorized visits
      if (!allowedRoles.includes(userData.role)) {
        redirectBasedOnRole(userData.role);
        return;
      }

      // 5. Populate layout topbar & fix dynamic navigation links
      populateUserHeader(userData);
      updateSidebarDashboardLink(userData.role);

    } catch (error) {
      console.error("Auth Guard Error:", error);
      safeRedirect("login.html");
    }
  });
}

export function redirectBasedOnRole(role) {
  switch (role) {
    case "admin":
      safeRedirect("admin.html");
      break;
    case "faculty":
      safeRedirect("faculty-dashboard.html");
      break;
    case "student":
      safeRedirect("student-dashboard.html");
      break;
    default:
      safeRedirect("login.html");
  }
}

/**
 * Ensures safe relative redirects that work in local dev and GitHub Pages subfolders
 */
function safeRedirect(targetPage) {
  const currentPath = window.location.pathname;
  // If already on the target page, do nothing to avoid infinite redirect loops
  if (currentPath.endsWith(targetPage)) return;

  const basePath = currentPath.substring(0, currentPath.lastIndexOf("/") + 1);
  window.location.replace(basePath + targetPage);
}

function updateSidebarDashboardLink(role) {
  const dashboardLink = document.querySelector('.sidebar-nav a[href="index.html"], .sidebar-nav a[href$="-dashboard.html"]');
  if (dashboardLink) {
    if (role === "faculty" || role === "admin") {
      dashboardLink.setAttribute("href", "faculty-dashboard.html");
    } else if (role === "student") {
      dashboardLink.setAttribute("href", "student-dashboard.html");
    }
  }
}

function populateUserHeader(userData) {
  const nameEl = document.getElementById("header-user-name");
  const roleEl = document.getElementById("header-user-role");

  if (nameEl) nameEl.textContent = `${userData.firstName} ${userData.lastName}`;
  if (roleEl) roleEl.textContent = userData.role.toUpperCase();

  const logoutBtn = document.getElementById("btn-logout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await signOut(auth);
      safeRedirect("login.html");
    });
  }
}