// js/auth-guard.js - Zero-Buffer Route Protection & Role Isolation (Clean URL + .html Compatible)
import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { FastCache } from "./security-utils.js";

const rawPath = window.location.pathname.toLowerCase();
const cleanPath = rawPath.replace(/\.html$/, "").replace(/\/$/, "") || "/";

// Matches both Vercel clean URLs (/login) and GitHub Pages URLs (/repo/login.html)
const isAuthLanding =
  rawPath.endsWith("/") ||
  cleanPath === "/" ||
  cleanPath.endsWith("/login") ||
  cleanPath.endsWith("/register") ||
  cleanPath.endsWith("/index");

const isParticipantWorkspace =
  cleanPath.endsWith("/office") ||
  cleanPath.endsWith("/planner") ||
  cleanPath.endsWith("/hr-library") ||
  (cleanPath.endsWith("/settings") && !cleanPath.endsWith("/admin-settings"));

const isAdminWorkspace =
  cleanPath.endsWith("/admin-dashboard") ||
  cleanPath.endsWith("/admin-settings");

// 1. Synchronous Fast-Path Check (Eliminates redirect flicker)
const cachedProfile = FastCache.get("user_profile");
if (cachedProfile && cachedProfile.role) {
  const role = cachedProfile.role.toLowerCase();
  if (role === "admin" && isParticipantWorkspace) {
    window.location.replace("admin-dashboard.html");
  } else if (role !== "admin" && isAdminWorkspace) {
    window.location.replace("office.html");
  }
}

// 2. Cryptographic Firebase Auth & Firestore Revalidation
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    FastCache.clearAll();
    if (!isAuthLanding) {
      window.location.replace("login.html");
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

    if (isAuthLanding && !cleanPath.endsWith("/index") && cleanPath !== "/" && !rawPath.endsWith("/")) {
      window.location.replace(userRole === "admin" ? "admin-dashboard.html" : "office.html");
      return;
    }

    if (userRole === "admin" && isParticipantWorkspace) {
      window.location.replace("admin-dashboard.html");
      return;
    }

    if (userRole !== "admin" && isAdminWorkspace) {
      window.location.replace("office.html");
      return;
    }
  } catch (error) {
    console.error("[Auth Guard Error]", error);
  }
});