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
  addDoc,
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

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
    if (role === "admin") {
      window.location.replace("admin-dashboard.html");
      return;
    }
    if (role === "faculty") {
      window.location.replace("faculty-dashboard.html");
      return;
    }

    await renderEnrolledSection(user, userData);
    await countCompletedCases(user.uid);
    setupJoinForm(user, userData);
  }
});

async function renderEnrolledSection(user, userData) {
  const classroomCode = userData.classroomCode;
  const pendingCode = userData.pendingClassroomCode;

  if (classroomCode) {
    try {
      const classQ = query(collection(db, "classrooms"), where("code", "==", classroomCode));
      const classSnap = await getDocs(classQ);

      // Auto-cleanup: If the classroom was deleted by faculty, unlink the student immediately
      if (classSnap.empty) {
        await updateDoc(doc(db, "users", user.uid), {
          classroomCode: null,
          classroomId: null,
          updatedAt: serverTimestamp()
        });
        showUnlinkedUI();
        return;
      }

      const classData = classSnap.docs[0].data();
      
      // Verify student is actually present in the classroom's student roster
      const isEnrolled = (classData.students || []).some(s => s.uid === user.uid);
      if (!isEnrolled) {
        await updateDoc(doc(db, "users", user.uid), {
          classroomCode: null,
          classroomId: null,
          updatedAt: serverTimestamp()
        });
        showUnlinkedUI();
        return;
      }

      // Valid Active Enrollment
      if (joinCard) joinCard.style.display = "none";
      if (displayEnrolledCode) displayEnrolledCode.textContent = classroomCode;
      if (badgeClassStatus) {
        badgeClassStatus.textContent = "ENROLLED";
        badgeClassStatus.className = "status-badge active";
        badgeClassStatus.style.background = "";
        badgeClassStatus.style.color = "";
        badgeClassStatus.style.borderColor = "";
      }
      if (displayClassDesc) {
        displayClassDesc.textContent = `${classData.name || "Academic Classroom"} (${classData.section || "Cohort"})`;
      }

    } catch (err) {
      console.error("Failed to verify classroom records:", err);
      showUnlinkedUI();
    }

  } else if (pendingCode) {
    // Check if the pending class was deleted while waiting
    try {
      const pendingQ = query(collection(db, "classrooms"), where("code", "==", pendingCode));
      const pendingSnap = await getDocs(pendingQ);

      if (pendingSnap.empty) {
        await updateDoc(doc(db, "users", user.uid), {
          pendingClassroomCode: null,
          pendingClassroomId: null,
          updatedAt: serverTimestamp()
        });
        showUnlinkedUI();
        return;
      }
    } catch (e) {
      console.error(e);
    }

    if (joinCard) joinCard.style.display = "none";
    if (displayEnrolledCode) displayEnrolledCode.textContent = pendingCode;
    if (badgeClassStatus) {
      badgeClassStatus.textContent = "APPROVAL PENDING";
      badgeClassStatus.className = "status-badge";
      badgeClassStatus.style.background = "rgba(234, 179, 8, 0.15)";
      badgeClassStatus.style.color = "#eab308";
      badgeClassStatus.style.borderColor = "rgba(234, 179, 8, 0.3)";
    }
    if (displayClassDesc) {
      displayClassDesc.textContent = `Join request sent for ${pendingCode}. Waiting for faculty instructor approval.`;
    }
  } else {
    showUnlinkedUI();
  }
}

function showUnlinkedUI() {
  if (joinCard) joinCard.style.display = "block";
  if (displayEnrolledCode) displayEnrolledCode.textContent = "UNLINKED";
  if (badgeClassStatus) {
    badgeClassStatus.textContent = "UNLINKED";
    badgeClassStatus.className = "status-badge";
    badgeClassStatus.style.background = "";
    badgeClassStatus.style.color = "";
    badgeClassStatus.style.borderColor = "";
  }
  if (displayClassDesc) {
    displayClassDesc.textContent = "No classroom linked. Enter a join code to request enrollment.";
  }
}

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

function setupJoinForm(user, userData) {
  formJoin?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const enteredCode = inputCode.value.trim().toUpperCase();

    if (!enteredCode) return;

    btnJoin.disabled = true;
    btnJoin.textContent = "Verifying Code...";

    try {
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

      const alreadyEnrolled = (classroomData.students || []).some(s => s.uid === user.uid);
      if (alreadyEnrolled) {
        alert("You are already enrolled in this classroom.");
        btnJoin.disabled = false;
        btnJoin.textContent = "Link Classroom";
        return;
      }

      const alreadyPending = (classroomData.pendingRequests || []).some(s => s.uid === user.uid);
      if (alreadyPending) {
        alert("You already have a pending join request for this classroom.");
        btnJoin.disabled = false;
        btnJoin.textContent = "Link Classroom";
        return;
      }

      const studentName = `${userData.firstName || ""} ${userData.lastName || ""}`.trim() || user.email;

      const requestEntry = {
        uid: user.uid,
        email: user.email,
        name: studentName,
        requestedAt: new Date().toISOString()
      };

      await updateDoc(classroomRef, {
        pendingRequests: arrayUnion(requestEntry)
      });

      await updateDoc(doc(db, "users", user.uid), {
        pendingClassroomCode: enteredCode,
        pendingClassroomId: classroomDoc.id,
        updatedAt: serverTimestamp()
      });

      if (classroomData.facultyUid) {
        await addDoc(collection(db, "notifications"), {
          recipientUid: classroomData.facultyUid,
          category: "Classroom",
          message: `${studentName} requested to join your class ${classroomData.name} (${enteredCode}).`,
          link: "faculty-dashboard.html",
          read: false,
          createdAt: serverTimestamp()
        });
      }

      await logActivity({
        category: "Classroom",
        details: `${user.email} submitted join request for class ${enteredCode}`,
        classroomCode: enteredCode,
        userEmail: user.email
      });

      alert(`Join request submitted! The instructor (${classroomData.facultyEmail || "Faculty"}) must approve your request before you can access the class.`);
      window.location.reload();

    } catch (err) {
      console.error("Join request error:", err);
      alert("Failed to request enrollment: " + err.message);
      btnJoin.disabled = false;
      btnJoin.textContent = "Link Classroom";
    }
  });
}