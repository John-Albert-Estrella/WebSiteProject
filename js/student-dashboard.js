import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { 
  doc, 
  getDoc, 
  updateDoc, 
  collection, 
  query, 
  where, 
  getDocs 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const studentSidebarName = document.getElementById("student-sidebar-name");
const topbarStudentName = document.getElementById("topbar-student-name");
const joinCard = document.getElementById("join-classroom-card");
const formJoinClass = document.getElementById("form-join-class");
const inputClassCode = document.getElementById("input-class-code");
const btnJoinClass = document.getElementById("btn-join-class");
const displayEnrolledCode = document.getElementById("display-enrolled-code");
const displayClassDesc = document.getElementById("display-class-desc");
const badgeClassStatus = document.getElementById("badge-class-status");
const statCompletedCount = document.getElementById("stat-completed-count");
const btnLogout = document.getElementById("btn-logout");

let currentStudentUid = null;

// Logout Handler
btnLogout?.addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.replace("login.html");
  } catch (err) {
    console.error("Sign-out error:", err);
  }
});

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
    // 1. Verify code exists and is active in classrooms collection
    const q = query(
      collection(db, "classrooms"),
      where("code", "==", enteredCode),
      where("active", "==", true)
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      alert("Invalid or expired classroom code. Please check with your instructor.");
      return;
    }

    const classroomDoc = snap.docs[0].data();
    if (classroomDoc.expiresAt && classroomDoc.expiresAt.toDate() <= new Date()) {
      alert("This classroom code has expired. Ask your instructor to regenerate a code.");
      return;
    }

    // 2. Link student to this code in Firestore
    await updateDoc(doc(db, "users", currentStudentUid), {
      classroomCode: enteredCode
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

// Count completed submissions
async function loadSubmissionCount(uid) {
  try {
    const q = query(collection(db, "submissions"), where("studentUid", "==", uid));
    const snap = await getDocs(q);
    if (statCompletedCount) statCompletedCount.textContent = snap.size;
  } catch (e) {
    console.warn("Could not load submissions count:", e);
  }
}

// Auth State Guard
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }

  currentStudentUid = user.uid;

  try {
    const userDocRef = doc(db, "users", user.uid);
    const snap = await getDoc(userDocRef);

    if (!snap.exists()) {
      window.location.replace("login.html");
      return;
    }

    const data = snap.data();
    const fullName = `${data.firstName || ""} ${data.lastName || ""}`.trim() || "Student";

    if (studentSidebarName) studentSidebarName.textContent = fullName;
    if (topbarStudentName) topbarStudentName.textContent = fullName;

    // Check classroom status
    if (data.classroomCode) {
      if (joinCard) joinCard.style.display = "none";
      if (displayEnrolledCode) displayEnrolledCode.textContent = data.classroomCode;
      if (displayClassDesc) displayClassDesc.textContent = "Enrolled and linked to instructor session.";
      if (badgeClassStatus) {
        badgeClassStatus.textContent = "Enrolled";
        badgeClassStatus.className = "status-badge active";
      }
    } else {
      if (joinCard) joinCard.style.display = "block";
      if (displayEnrolledCode) displayEnrolledCode.textContent = "UNLINKED";
      if (displayClassDesc) displayClassDesc.textContent = "No classroom linked. Enter your instructor's code above.";
      if (badgeClassStatus) {
        badgeClassStatus.textContent = "Unlinked";
        badgeClassStatus.className = "status-badge";
      }
    }

    loadSubmissionCount(user.uid);

  } catch (err) {
    console.error("Error loading student profile:", err);
  }
});