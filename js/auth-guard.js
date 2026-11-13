// js/auth-guard.js - Zero-Buffer Route Protection with Loop Circuit Breaker
import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { FastCache } from "./security-utils.js";

const rawPath = window.location.pathname.toLowerCase();
const cleanPath = rawPath.replace(/\.html$/, "").replace(/\/$/, "") || "/";

const isAuthLanding =
  rawPath.endsWith("/") ||
  cleanPath === "/" ||
  cleanPath.endsWith("/login") ||
  cleanPath.endsWith("/register") ||
  cleanPath.endsWith("/index");

const isStudentFacultyOnlyWorkspace =
  cleanPath.endsWith("/office") ||
  cleanPath.endsWith("/planner") ||
  (cleanPath.endsWith("/settings") && !cleanPath.endsWith("/admin-settings"));

const isAdminWorkspace =
  cleanPath.endsWith("/admin-dashboard") ||
  cleanPath.endsWith("/admin-settings");

function safeRedirect(targetUrl) {
  try {
    const now = Date.now();
    const history = JSON.parse(sessionStorage.getItem("aimser_nav_guard") || "[]")
      .filter((t) => now - t < 4000);

    if (history.length >= 3) {
      console.error("[Auth Guard] Redirect loop halted safely.");
      sessionStorage.removeItem("aimser_nav_guard");
      FastCache.clearAll();
      return;
    }

    history.push(now);
    sessionStorage.setItem("aimser_nav_guard", JSON.stringify(history));
  } catch {
    // Ignore storage restrictions
  }
  window.location.replace(targetUrl);
}

// 1. Synchronous Fast-Path Role Partition Check
const cachedProfile = FastCache.get("user_profile");
if (cachedProfile && cachedProfile.role) {
  const role = cachedProfile.role.toLowerCase();
  if (role === "admin" && isStudentFacultyOnlyWorkspace) {
    safeRedirect("admin-dashboard.html");
  } else if (role !== "admin" && isAdminWorkspace) {
    safeRedirect("office.html");
  }
}

// 2. Firebase Auth & Firestore Revalidation
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    FastCache.clearAll();
    if (!isAuthLanding) {
      safeRedirect("login.html");
    }
    return;
  }

  try {
    const userSnap = await getDoc(doc(db, "users", user.uid));
    const userData = userSnap.exists() ? userSnap.data() : { role: "student" };
    const userRole = (userData.role || "student").toLowerCase();

    const profileSnapshot = {
      uid: user.uid,
      email: user.email,
      fullName: userData.fullName || user.displayName || user.email.split("@")[0],
      role: userRole,
      department: userData.department || "",
      avatarUrl: userData.avatarUrl || user.photoURL || ""
    };

    FastCache.set("user_profile", profileSnapshot);
    window.dispatchEvent(new CustomEvent("aimser:profile-ready", { detail: profileSnapshot }));

    if (cleanPath.endsWith("/login") || cleanPath.endsWith("/register")) {
      safeRedirect(userRole === "admin" ? "admin-dashboard.html" : "office.html");
      return;
    }

    if (userRole === "admin" && isStudentFacultyOnlyWorkspace) {
      safeRedirect("admin-dashboard.html");
      return;
    }

    if (userRole !== "admin" && isAdminWorkspace) {
      safeRedirect("office.html");
      return;
    }
  } catch (error) {
    console.error("[Auth Guard Error]", error);
  }
});