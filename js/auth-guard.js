// js/auth-guard.js - Zero-Buffer Route Protection, Registration Write Lock & Auto-Heal User Registry Sync (v=18)
import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
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
    // Ignore storage restrictions
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

// 1. Synchronous Fast-Path Role Partition Check & Instant Header Hydration
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

// 2. Firebase Auth & Firestore Revalidation + Auto-Heal Registry Sync
onAuthStateChanged(auth, async (user) => {
  bindGlobalLogoutButton();

  // Wait if auth.js is actively writing the new user to Firestore on register.html
  if (
    window.__AIMSER_REGISTERING__ ||
    sessionStorage.getItem("aimser_registering_lock") === "1"
  ) {
    return;
  }

  if (!user) {
    FastCache.clearAll();
    if (!isAuthLanding) {
      safeRedirect("login.html");
    }
    return;
  }

  try {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    let pendingReg = null;
    try {
      pendingReg = JSON.parse(localStorage.getItem("aimser_pending_registration") || "null");
    } catch {}

    let userData = {};
    if (userSnap.exists()) {
      userData = userSnap.data() || {};
      const resolvedFullName =
        userData.fullName ||
        (userData.firstName ? `${userData.firstName} ${userData.lastName || ""}`.trim() : "") ||
        pendingReg?.fullName ||
        user.displayName ||
        (user.email ? user.email.split("@")[0] : "Member");

      if (!userData.fullName || !userData.email || !userData.uid) {
        const healedFields = {
          uid: user.uid,
          email: userData.email || user.email || pendingReg?.email || "",
          fullName: resolvedFullName,
          role: (userData.role || pendingReg?.role || "student").toLowerCase(),
          department: userData.department || pendingReg?.department || "",
          updatedAt: serverTimestamp()
        };
        userData = { ...userData, ...healedFields };
        try {
          await setDoc(userRef, healedFields, { merge: true });
        } catch {}
      }
    } else {
      // Automatically create the missing Firestore users/{uid} document so it appears in the Admin User Registry
      const fallbackName =
        pendingReg?.fullName ||
        cachedProfile?.fullName ||
        user.displayName ||
        (user.email ? user.email.split("@")[0] : "Student");
      const fallbackRole = (pendingReg?.role || cachedProfile?.role || "student").toLowerCase();
      const fallbackDept = pendingReg?.department || cachedProfile?.department || "";

      userData = {
        uid: user.uid,
        email: user.email || pendingReg?.email || "",
        fullName: fallbackName,
        role: fallbackRole,
        department: fallbackDept,
        avatarUrl:
          user.photoURL ||
          `https://ui-avatars.com/api/?name=${encodeURIComponent(fallbackName)}&background=1b5375&color=faf2dd`,
        createdAt: serverTimestamp(),
        registeredAt: new Date().toISOString(),
        updatedAt: serverTimestamp()
      };
      try {
        await setDoc(userRef, userData, { merge: true });
        localStorage.removeItem("aimser_pending_registration");
      } catch (writeErr) {
        console.error("[Auth Guard] Failed to auto-heal user document in Firestore:", writeErr);
      }
    }

    const userRole = (userData.role || "student").toLowerCase();

    const profileSnapshot = {
      uid: user.uid,
      email: user.email || userData.email || "",
      fullName: userData.fullName || user.displayName || (user.email ? user.email.split("@")[0] : "Member"),
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