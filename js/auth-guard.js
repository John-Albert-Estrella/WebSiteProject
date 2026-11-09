import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { initNotifications } from "./notifications.js";

export function synchronizeSidebar(role, currentPath) {
  const sidebarNav = document.querySelector(".sidebar-nav");
  if (!sidebarNav) return;

  const allNavLinks = sidebarNav.querySelectorAll(".nav-item");
  const fileName = currentPath.substring(currentPath.lastIndexOf("/") + 1) || "index.html";

  allNavLinks.forEach((link) => {
    const linkHref = link.getAttribute("href");
    if (linkHref && fileName.includes(linkHref.split("?")[0])) {
      link.classList.add("active");
    } else {
      link.classList.remove("active");
    }
  });
}

export function initAuthGuard({ allowedRoles = [], onReady = null } = {}) {
  const currentPath = window.location.pathname;

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.replace("login.html");
      return;
    }

    try {
      const userDocRef = doc(db, "users", user.uid);
      const userDocSnap = await getDoc(userDocRef);

      if (!userDocSnap.exists()) {
        await signOut(auth);
        window.location.replace("login.html");
        return;
      }

      const userData = userDocSnap.data();
      const role = userData.role || "student";

      if (allowedRoles.length > 0 && !allowedRoles.includes(role)) {
        if (role === "admin") {
          window.location.replace("admin-dashboard.html");
        } else {
          window.location.replace("office.html");
        }
        return;
      }

      const fullName = `${userData.firstName || ""} ${userData.lastName || ""}`.trim() || user.email;
      
      const topbarName = document.getElementById("topbar-user-name");
      const topbarBadge = document.getElementById("topbar-role-badge");
      const sidebarName = document.getElementById("sidebar-greeting-name");

      if (topbarName) topbarName.textContent = fullName;
      if (sidebarName) sidebarName.textContent = fullName;
      
      if (topbarBadge) {
        topbarBadge.textContent = role.toUpperCase();
        topbarBadge.className = `role-badge ${role}`;
      }

      synchronizeSidebar(role, currentPath);
      initNotifications(user);

      if (typeof onReady === "function") {
        onReady({ user, userData, role });
      }

    } catch (err) {
      console.error("Auth guard error:", err);
      await signOut(auth);
      window.location.replace("login.html");
    }
  });
}