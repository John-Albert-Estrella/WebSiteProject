// js/auth-guard.js - Strict Bidirectional Route & Clearance Guard
import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const currentPath = window.location.pathname.toLowerCase();

// Route definitions
const isAuthLanding = 
  currentPath.endsWith("login.html") || 
  currentPath.endsWith("register.html") || 
  currentPath.endsWith("index.html") || 
  currentPath === "/" || 
  currentPath.endsWith("/");

const isParticipantWorkspace = 
  currentPath.includes("office.html") || 
  currentPath.includes("planner.html") || 
  currentPath.includes("hr-library.html") ||
  (currentPath.includes("settings.html") && !currentPath.includes("admin-settings.html"));

const isAdminWorkspace = 
  currentPath.includes("admin-dashboard.html") || 
  currentPath.includes("admin-settings.html");

onAuthStateChanged(auth, async (user) => {
  // 1. Unauthenticated Visitor Handling
  if (!user) {
    if (!isAuthLanding) {
      console.warn("[Auth Guard] Unauthenticated session. Redirecting to login.html...");
      window.location.replace("login.html");
    }
    return;
  }

  // 2. Authenticated Visitor on Login/Register
  if (isAuthLanding && !currentPath.endsWith("index.html")) {
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      const role = snap.exists() ? (snap.data().role || "student").toLowerCase() : "student";
      window.location.replace(role === "admin" ? "admin-dashboard.html" : "office.html");
    } catch {
      window.location.replace("office.html");
    }
    return;
  }

  // 3. Role Evaluation & Partition Enforcement
  try {
    const userDocRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userDocRef);
    const userData = userSnap.exists() ? userSnap.data() : { role: "student" };
    const userRole = (userData.role || "student").toLowerCase();

    // RULE A: Administrators MUST NOT enter participant operational classrooms
    if (userRole === "admin" && isParticipantWorkspace) {
      console.warn("[Auth Guard] Administrator detected on participant route. Redirecting to admin-dashboard.html...");
      window.location.replace("admin-dashboard.html");
      return;
    }

    // RULE B: Non-Administrators MUST NOT enter the Admin Console
    if (userRole !== "admin" && isAdminWorkspace) {
      console.warn("[Auth Guard] Non-admin clearance rejected. Redirecting to office.html...");
      window.location.replace("office.html");
      return;
    }

  } catch (error) {
    console.error("[Auth Guard Error]", error);
  }
});