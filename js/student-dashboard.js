import { auth, db } from "./firebase-init.js";
import { initAuthGuard } from "./auth-guard.js";
import { logActivity } from "./audit-logger.js";
import { 
  doc, 
  updateDoc, 
  collection, 
  query, 
  where, 
  getDocs,
  onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const joinCard = document.getElementById("join-classroom-card");
const formJoinClass = document.getElementById("form-join-class");
const inputClassCode = document.getElementById("input-class-code");
const btnJoinClass = document.getElementById("btn-join-class");
const displayEnrolledCode = document.getElementById("display-enrolled-code");
const displayClassDesc = document.getElementById("display-class-desc");
const badgeClassStatus = document.getElementById("badge-class-status");
const statCompletedCount = document.getElementById("stat-completed-count");

let currentStudentUid = null;
let currentStudentEmail = "";
let classroomUnsubscribe = null;

// Join Classroom Form Submission
formJoinClass?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const enteredCode = inputClassCode?.value.trim().toUpperCase();

  if (!enteredCode) {
    alert("Please enter a classroom code.");
    return;
  }

  if (btnJoinClass) {
    btnJoinClass.disabled = true;
    btnJoinClass.textContent = "Verifying...";
  }

  try {
    const q = query(
      collection(db, "classrooms"),
      where("code", "==", enteredCode),
      where("active", "==", true)
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      alert("Invalid or inactive classroom code. Please check with your instructor.");
      return;
    }

    const classroomDoc = snap.docs[0].data();
    if (classroomDoc.expiresAt && classroomDoc.expiresAt.toDate() <= new Date()) {
      alert("This classroom code has expired. Ask your instructor to regenerate a new code.");
      return;
    }

    await updateDoc(doc(db, "users", currentStudentUid), {
      classroomCode: enteredCode
    });

    await logActivity({
      category: "Enrolment",
      details: `${currentStudentEmail} enrolled into session ${enteredCode}`,
      classroomCode: enteredCode,
      userEmail: currentStudentEmail
    });

    alert(`Successfully enrolled in classroom session: ${enteredCode}`);
    window.location.reload();

  } catch (err) {
    console.error("Classroom join error:", err);
    alert("Failed to join classroom: " + err.message);
  } finally {
    if (btnJoinClass) {
      btnJoinClass.disabled = false;
      btnJoinClass.textContent = "Link Classroom";
    }
  }
});

function listenToClassroomSession(classCode) {
  if (classroomUnsubscribe) classroomUnsubscribe();

  const q = query(collection(db, "classrooms"), where("code", "==", classCode));
  classroomUnsubscribe = onSnapshot(q, (snapshot) => {
    if (snapshot.empty) {
      handleSessionExpired("Session no longer exists in database.");
      return;
    }

    const classData = snapshot.docs[0].data();
    const isStillActive = classData.active === true;
    const isNotExpired = classData.expiresAt ? classData.expiresAt.toDate() > new Date() : true;

    if (!isStillActive || !isNotExpired) {
      handleSessionExpired("Instructor has closed or completed this session.");
    } else {
      if (joinCard) joinCard.style.display = "none";
      if (displayEnrolledCode) displayEnrolledCode.textContent = classCode;
      if (displayClassDesc) displayClassDesc.textContent = "Connected to active instructor simulation session.";
      if (badgeClassStatus) {
        badgeClassStatus.textContent = "Session Active";
        badgeClassStatus.className = "status-badge active";
      }
    }
  }, (err) => {
    console.error("Error monitoring classroom session:", err);
  });
}

function handleSessionExpired(reasonText) {
  if (joinCard) joinCard.style.display = "block";
  if (displayEnrolledCode) displayEnrolledCode.textContent = "EXPIRED";
  if (displayClassDesc) displayClassDesc.textContent = reasonText + " Enter a new code above to re-link.";
  if (badgeClassStatus) {
    badgeClassStatus.textContent = "Inactive";
    badgeClassStatus.className = "status-badge";
  }
}

async function loadSubmissionCount(uid) {
  try {
    const q = query(collection(db, "submissions"), where("studentUid", "==", uid));
    const snap = await getDocs(q);
    if (statCompletedCount) statCompletedCount.textContent = snap.size;
  } catch (e) {
    console.warn("Could not load submissions count:", e);
  }
}

initAuthGuard({
  onReady: ({ user, userData }) => {
    currentStudentUid = user.uid;
    currentStudentEmail = user.email || "";

    if (userData.classroomCode) {
      listenToClassroomSession(userData.classroomCode);
    } else {
      handleSessionExpired("No classroom session linked.");
    }

    loadSubmissionCount(user.uid);
  }
});