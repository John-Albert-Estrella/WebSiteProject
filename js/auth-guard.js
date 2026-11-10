// js/auth-guard.js - Master Session Validator & Role Access Controller
import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// Determine path context
const currentPath = window.location.pathname.toLowerCase();
const isAuthPage = currentPath.endsWith("login.html") || currentPath.endsWith("register.html") || currentPath === "/" || currentPath.endsWith("/login");
const isAdminPage = currentPath.includes("admin-dashboard.html") || currentPath.includes("admin-settings.html");

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // If unauthenticated and trying to view a protected dashboard, redirect to login
    if (!isAuthPage) {
      window.location.replace("login.html");
    }
    return;
  }

  // Retrieve user document to inspect system role
  try {
    const userDocRef = doc(db, "users", user.uid);
    let userSnap = await getDoc(userDocRef);

    // Auto-create document if registering without profile doc
    if (!userSnap.exists()) {
      await setDoc(userDocRef, {
        email: user.email,
        fullName: user.displayName || user.email.split("@")[0],
        role: "student",
        createdAt: serverTimestamp()
      });
      userSnap = await getDoc(userDocRef);
    }

    const userData = userSnap.data();
    const role = userData.role || "student";

    // Enforce role-based boundaries
    if (isAdminPage && role !== "admin") {
      alert("Unauthorized Access: Super Administrator credentials required.");
      window.location.replace("office.html");
      return;
    }

    // If an authenticated user lands on login/register, direct them to their module
    if (isAuthPage) {
      if (role === "admin") {
        window.location.replace("admin-dashboard.html");
      } else {
        window.location.replace("office.html");
      }
      return;
    }

    // Populate user profile info into headers if present
    const headerName = document.getElementById("header-user-name");
    const headerRole = document.getElementById("header-user-role");
    const headerAvatar = document.getElementById("header-user-avatar");

    if (headerName) headerName.textContent = userData.fullName || user.email;
    if (headerRole) {
      headerRole.textContent = role === "admin" ? "Super Admin" : (role.charAt(0).toUpperCase() + role.slice(1));
    }
    if (headerAvatar && userData.avatarUrl) {
      headerAvatar.src = userData.avatarUrl;
    }

  } catch (err) {
    console.error("Auth Guard profile verification failure:", err);
  }

  // Auto-bind sign-out handlers
  document.querySelectorAll("#logout-btn, .btn-logout").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        await signOut(auth);
        window.location.replace("login.html");
      } catch (err) {
        console.error("Sign out error:", err);
      }
    });
  });

  // Highlight active sidebar item
  syncActiveSidebar();
});

export function syncActiveSidebar() {
  const path = window.location.pathname.toLowerCase();
  const navItems = document.querySelectorAll(".sidebar-nav .nav-item");

  navItems.forEach((link) => {
    link.classList.remove("active");
    const href = (link.getAttribute("href") || "").toLowerCase();
    if (href && path.includes(href) && !href.startsWith("#")) {
      link.classList.add("active");
    }
  });
}