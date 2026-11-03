// js/auth-guard.js
import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

/**
 * Universal Auth Guard:
 * 1. Synchronizes user profile across all pages
 * 2. Automatically highlights the current page in the sidebar
 * 3. Dynamically routes Dashboard link based on role
 * 4. Cleanses stale or expired classroom sessions in Firestore
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

      // 1. Enforce Role Restriction if required by page
      if (options.requiredRole && role !== options.requiredRole) {
        if (options.requiredRole === "faculty") {
          alert("Access restricted: This area requires a Faculty account.");
          window.location.replace("student-dashboard.html");
          return;
        }
      }

      // 2. Automatic Sidebar Active Link Matching & Dynamic Dashboard Target
      const currentPath = window.location.pathname.toLowerCase();
      const currentPage = currentPath.substring(currentPath.lastIndexOf("/") + 1) || "index.html";

      const sidebarLinks = document.querySelectorAll(".sidebar-nav .nav-item");
      sidebarLinks.forEach(link => {
        const href = (link.getAttribute("href") || "").toLowerCase();

        // Dynamically point Dashboard to role target
        if (href.includes("dashboard")) {
          link.href = isFaculty ? "faculty-dashboard.html" : "student-dashboard.html";
        }

        // Auto-highlight active nav item based on filename
        if (href && (currentPage === href || (currentPage === "" && href.includes("dashboard")))) {
          link.classList.add("active");
        } else {
          link.classList.remove("active");
        }
      });

      // 3. Update Display Name across all DOM variations
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

      // 4. Update Role Badge across all DOM variations
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

      // 5. Stale Classroom Code Sanitation (If code no longer valid in classrooms collection)
      if (!isFaculty && userData.classroomCode) {
        verifyAndCleanStaleCode(user.uid, userData.classroomCode);
      }

      // 6. Trigger page callback
      if (typeof options.onReady === "function") {
        options.onReady({ user, userData, role });
      }

    } catch (err) {
      console.error("Auth guard initialization error:", err);
    }
  });
}

/**
 * Checks if the student's stored classroom session is dead.
 * If expired/inactive, clears classroomCode to keep other pages isolated.
 */
async function verifyAndCleanStaleCode(studentUid, code) {
  try {
    const q = query(collection(db, "classrooms"), where("code", "==", code));
    const snap = await getDocs(q);

    let isDead = false;
    if (snap.empty) {
      isDead = true;
    } else {
      const classData = snap.docs[0].data();
      const isExpired = classData.expiresAt ? classData.expiresAt.toDate() <= new Date() : false;
      if (!classData.active || isExpired) {
        isDead = true;
      }
    }

    if (isDead) {
      console.warn(`Classroom code ${code} is inactive or expired. Resetting session.`);
      await updateDoc(doc(db, "users", studentUid), {
        classroomCode: ""
      });
    }
  } catch (e) {
    // Suppress non-critical cleanup failures
    console.warn("Could not verify session freshness:", e);
  }
}