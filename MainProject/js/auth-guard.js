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
      window.location.replace("login.html");
      return;
    }

    try {
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      // 2. Auth exists but no Firestore profile -> reset to login
      if (!userSnap.exists()) {
        await signOut(auth);
        window.location.replace("login.html");
        return;
      }

      const userData = userSnap.data();

      // 3. IF called from index.html (allowedRoles is empty), ALWAYS redirect to their portal
      if (allowedRoles.length === 0) {
        redirectBasedOnRole(userData.role);
        return;
      }

      // 4. Role Guard: If user visits an unauthorized page (e.g. student visits faculty-dashboard.html)
      if (!allowedRoles.includes(userData.role)) {
        redirectBasedOnRole(userData.role);
        return;
      }

      // 5. Update UI header and dynamically fix the sidebar Dashboard link
      populateUserHeader(userData);
      updateSidebarDashboardLink(userData.role);

    } catch (error) {
      console.error("Auth Guard Error:", error);
      window.location.replace("login.html");
    }
  });
}

export function redirectBasedOnRole(role) {
  switch (role) {
    case "admin":
      window.location.replace("admin.html");
      break;
    case "faculty":
      window.location.replace("faculty-dashboard.html");
      break;
    case "student":
      window.location.replace("student-dashboard.html");
      break;
    default:
      window.location.replace("login.html");
  }
}

/**
 * Automatically changes the sidebar's Dashboard link to the user's specific dashboard
 */
function updateSidebarDashboardLink(role) {
  // Find all sidebar navigation links that point to a dashboard or index.html
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
      window.location.replace("login.html");
    });
  }
}