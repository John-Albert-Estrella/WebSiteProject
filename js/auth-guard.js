// js/auth-guard.js - Zero-Buffer Route Protection, Header Hydration & Sign-Out Handler[cite: 1]
import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { FastCache, sanitizeUrl, logAuditEvent } from "./security-utils.js";

const rawPath = window.location.pathname.toLowerCase();
const cleanPath = rawPath.replace(/\.html$/, "").replace(/\/$/, "") || "/";

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
  cleanPath.endsWith("/admin-hr-feed") ||
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
    // Ignore storage restrictions[cite: 1]
  }
  window.location.replace(targetUrl);
}

function hydrateWorkspaceHeader(profile) {
  if (!profile) return;
  const nameEl = document.getElementById("header-user-name");
  const roleEl = document.getElementById("header-user-role");
  const avatarEl = document.getElementById("header-user-avatar");

  const resolvedName = profile.fullName || "Member";
  const resolvedRole = (profile.role || "student").toUpperCase();
  const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(resolvedName)}&background=1b5375&color=faf2dd`;
  const resolvedAvatar = sanitizeUrl(profile.avatarUrl, fallbackAvatar);

  if (nameEl) nameEl.textContent = resolvedName;
  if (roleEl) roleEl.textContent = resolvedRole === "ADMIN" ? "SYSTEM ADMIN" : resolvedRole;
  if (avatarEl) avatarEl.src = resolvedAvatar;
}

function bindGlobalLogoutButton() {
  const logoutBtn = document.getElementById("logout-btn");
  if (!logoutBtn || logoutBtn.dataset.bound) return;
  logoutBtn.dataset.bound = "true";

  logoutBtn.addEventListener("click", async () => {
    logoutBtn.disabled = true;
    try {
      const currentEmail = auth.currentUser?.email || FastCache.get("user_profile")?.email || "user";
      await logAuditEvent(`User signed out: ${currentEmail}`, "AUTH", currentEmail);
    } catch {
      // Non-blocking audit log
    }
    FastCache.clearAll();
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Sign-out error:", err);
    }
    window.location.replace("login.html");
  });
}

// 1. Synchronous Fast-Path Role Partition Check & Instant Header Hydration[cite: 1]
const cachedProfile = FastCache.get("user_profile");
if (cachedProfile && cachedProfile.role) {
  const role = cachedProfile.role.toLowerCase();
  if (role === "admin" && isParticipantWorkspace) {
    safeRedirect(cleanPath.endsWith("/hr-library") ? "admin-hr-feed.html" : "admin-dashboard.html");
  } else if (role !== "admin" && isAdminWorkspace) {
    safeRedirect("office.html");
  } else {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => hydrateWorkspaceHeader(cachedProfile));
    } else {
      hydrateWorkspaceHeader(cachedProfile);
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindGlobalLogoutButton);
} else {
  bindGlobalLogoutButton();
}

window.addEventListener("aimser:profile-ready", (e) => {
  if (e.detail) hydrateWorkspaceHeader(e.detail);
});

// 2. Firebase Auth & Firestore Revalidation[cite: 1]
onAuthStateChanged(auth, async (user) => {
  bindGlobalLogoutButton();

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
    hydrateWorkspaceHeader(profileSnapshot);
    window.dispatchEvent(new CustomEvent("aimser:profile-ready", { detail: profileSnapshot }));

    if (cleanPath.endsWith("/login") || cleanPath.endsWith("/register")) {
      safeRedirect(userRole === "admin" ? "admin-dashboard.html" : "office.html");
      return;
    }

    if (userRole === "admin" && isParticipantWorkspace) {
      safeRedirect(cleanPath.endsWith("/hr-library") ? "admin-hr-feed.html" : "admin-dashboard.html");
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