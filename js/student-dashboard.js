import { auth, db } from "./firebase-init.js";
import { initAuthGuard } from "./auth-guard.js";
import { logActivity } from "./audit-logger.js";
import { 
  doc, 
  getDoc, 
  updateDoc, 
  arrayUnion, 
  collection, 
  query, 
  where, 
  getDocs, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// DOM Elements
const joinCard = document.getElementById("join-classroom-card");
const formJoin = document.getElementById("form-join-class");
const inputCode = document.getElementById("input-class-code");
const btnJoin = document.getElementById("btn-join-class");

const displayClassDesc = document.getElementById("display-class-desc");
const displayEnrolledCode = document.getElementById("display-enrolled-code");
const badgeClassStatus = document.getElementById("badge-class-status");
const statCompletedCount = document.getElementById("stat-completed-count");

initAuthGuard({
  allowedRoles: ["student", "faculty", "admin"],
  onReady: async ({ user, userData, role }) => {
    // Prevent Dashboard Overlap: Immediately route non-students to their respective management views
    if (role === "admin") {
      window.location.replace("admin-dashboard.html");
      return;
    }
    if (role === "faculty") {
      window.location.replace("faculty-dashboard.html");
      return;
    }

    // Setup student dashboard data
    await renderEnrolledSection(userData);
    await countCompletedCases(user.uid);
    setupJoinForm(user, userData);
  }
});

/**
 * Renders active classroom affiliation or prompts student to link a code.
 */
async function renderEnrolledSection(userData) {
  const classroomCode = userData.classroomCode;

  if (classroomCode) {
    if (joinCard) joinCard.style.display = "none";
    if (displayEnrolledCode) displayEnrolledCode.textContent = classroomCode;
    if (badgeClassStatus) {
      badgeClassStatus.textContent = "ENROLLED";
      badgeClassStatus.className = "status-badge active";
    }

    try {
      const classQ = query(collection(db, "classrooms"), where("code", "==", classroomCode));
      const classSnap = await getDocs(classQ);

      if (!classSnap.empty) {
        const classData = classSnap.docs[0].data();
        if (displayClassDesc) {
          displayClassDesc.textContent = `${classData.name || "Academic Classroom"} (${classData.section || "Active Cohort"})`;
        }
      } else {
        if (displayClassDesc) {
          displayClassDesc.textContent = "Linked to session code " + classroomCode;
        }
      }
    } catch (err) {
      console.error("Failed to load classroom details:", err);
      if (displayClassDesc) displayClassDesc.textContent = "Enrolled Section: " + classroomCode;
    }
  } else {
    if (joinCard) joinCard.style.display = "block";
    if (displayEnrolledCode) displayEnrolledCode.textContent = "UNLINKED";
    if (badgeClassStatus) {
      badgeClassStatus.textContent = "UNLINKED";
      badgeClassStatus.className = "status-badge";
    }
    if (displayClassDesc) {
      displayClassDesc.textContent = "No classroom linked. Enter a new classroom code to join.";
    }
  }
}

/**
 * Queries completed/graded submissions for the current student.
 */
async function countCompletedCases(studentUid) {
  if (!statCompletedCount) return;

  try {
    const subQ = query(
      collection(db, "submissions"), 
      where("studentUid", "==", studentUid),
      where("status", "==", "evaluated")
    );
    const subSnap = await getDocs(subQ);
    statCompletedCount.textContent = subSnap.size;
  } catch (err) {
    console.error("Failed to fetch completed cases:", err);
    statCompletedCount.textContent = "0";
  }
}

/**
 * Handles permanent section linking by validating join codes and updating rosters.
 */
function setupJoinForm(user, userData) {
  formJoin?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const enteredCode = inputCode.value.trim().toUpperCase();

    if (!enteredCode) return;

    btnJoin.disabled = true;
    btnJoin.textContent = "Verifying Code...";

    try {
      // 1. Locate active classroom by permanent code
      const classQ = query(collection(db, "classrooms"), where("code", "==", enteredCode));
      const classSnap = await getDocs(classQ);

      if (classSnap.empty) {
        alert("Invalid Classroom Code. Please verify with your instructor.");
        btnJoin.disabled = false;
        btnJoin.textContent = "Link Classroom";
        return;
      }

      const classroomDoc = classSnap.docs[0];
      const classroomRef = classroomDoc.ref;
      const classroomData = classroomDoc.data();

      // 2. Add student to classroom's enrolled array
      const studentEntry = {
        uid: user.uid,
        email: user.email,
        name: `${userData.firstName || ""} ${userData.lastName || ""}`.trim() || user.email,
        joinedAt: new Date().toISOString()
      };

      await updateDoc(classroomRef, {
        students: arrayUnion(studentEntry)
      });

      // 3. Update student user document
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        classroomCode: enteredCode,
        classroomId: classroomDoc.id,
        updatedAt: serverTimestamp()
      });

      // 4. Log telemetry activity
      await logActivity({
        category: "Classroom",
        details: `${user.email} joined classroom ${enteredCode} (${classroomData.name || "Course"})`,
        classroomCode: enteredCode,
        userEmail: user.email
      });

      alert(`Successfully enrolled in ${classroomData.name || enteredCode}!`);
      window.location.reload();

    } catch (err) {
      console.error("Classroom join error:", err);
      alert("Failed to join classroom: " + err.message);
      btnJoin.disabled = false;
      btnJoin.textContent = "Link Classroom";
    }
  });
}