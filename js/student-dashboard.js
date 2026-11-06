import { auth, db } from "./firebase-init.js";
import { initAuthGuard } from "./auth-guard.js";
import { logActivity } from "./audit-logger.js";
import { 
  doc, 
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
const displayContainer = document.getElementById("classroom-display-container");

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

    await renderClassroomCard(user, userData);
    setupJoinForm(user, userData);
  }
});

async function renderClassroomCard(user, userData) {
  const classroomCode = userData.classroomCode;
  const pendingCode = userData.pendingClassroomCode;
  displayContainer.innerHTML = "";

  if (classroomCode) {
    try {
      const q = query(collection(db, "classrooms"), where("code", "==", classroomCode));
      const snap = await getDocs(q);

      if (snap.empty) {
        // Classroom deleted
        await updateDoc(doc(db, "users", user.uid), {
          classroomCode: null,
          classroomId: null,
          updatedAt: serverTimestamp()
        });
        if (joinCard) joinCard.style.display = "block";
        return;
      }

      const classData = snap.docs[0].data();
      const isEnrolled = (classData.students || []).some(s => s.uid === user.uid);

      if (!isEnrolled) {
        await updateDoc(doc(db, "users", user.uid), {
          classroomCode: null,
          classroomId: null,
          updatedAt: serverTimestamp()
        });
        if (joinCard) joinCard.style.display = "block";
        return;
      }

      // Hide join card and show active classroom entry button
      if (joinCard) joinCard.style.display = "none";

      const card = document.createElement("div");
      card.className = "card class-entry-card";
      card.innerHTML = `
        <div class="card-header">
          <div>
            <h2 class="card-title">${classData.name || "Academic Classroom"}</h2>
            <p class="card-subtitle">${classData.section || "Active Cohort"} • Instructor: ${classData.facultyEmail || "Faculty"}</p>
          </div>
          <span class="status-badge active">ENROLLED</span>
        </div>
        <p style="font-size: 13.5px; color: var(--text-secondary); margin: 12px 0;">
          Permanent Section Code: <strong style="color: var(--accent);">${classroomCode}</strong>
        </p>
        <div class="card-actions">
          <a href="classroom.html?code=${classroomCode}" class="btn btn-primary" style="text-decoration: none;">
            🚀 Enter Classroom Workspace
          </a>
        </div>
      `;

      displayContainer.appendChild(card);

    } catch (err) {
      console.error("Error verifying class:", err);
    }

  } else if (pendingCode) {
    if (joinCard) joinCard.style.display = "none";

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-header">
        <div>
          <h2 class="card-title">Join Request Pending</h2>
          <p class="card-subtitle">Waiting for instructor approval for section <strong>${pendingCode}</strong>.</p>
        </div>
        <span class="status-badge" style="background: rgba(234, 179, 8, 0.15); color: #eab308; border-color: rgba(234, 179, 8, 0.3);">
          PENDING
        </span>
      </div>
      <p style="font-size: 13.5px; color: var(--text-secondary); margin-top: 8px;">
        You will receive a notification and full module access once your instructor accepts your request.
      </p>
    `;

    displayContainer.appendChild(card);
  } else {
    if (joinCard) joinCard.style.display = "block";
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
        btnJoin.textContent = "Submit Join Request";
        return;
      }

      const classroomDoc = classSnap.docs[0];
      const classroomRef = classroomDoc.ref;
      const classroomData = classroomDoc.data();

      const alreadyEnrolled = (classroomData.students || []).some(s => s.uid === user.uid);
      if (alreadyEnrolled) {
        alert("You are already enrolled in this classroom.");
        btnJoin.disabled = false;
        btnJoin.textContent = "Submit Join Request";
        return;
      }

      const alreadyPending = (classroomData.pendingRequests || []).some(s => s.uid === user.uid);
      if (alreadyPending) {
        alert("You already have a pending join request for this classroom.");
        btnJoin.disabled = false;
        btnJoin.textContent = "Submit Join Request";
        return;
      }

      const studentName = `${userData.firstName || ""} ${userData.lastName || ""}`.trim() || user.email;

      await updateDoc(classroomRef, {
        pendingRequests: arrayUnion({
          uid: user.uid,
          email: user.email,
          name: studentName,
          requestedAt: new Date().toISOString()
        })
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
          message: `${studentName} requested to join class ${classroomData.name} (${enteredCode}).`,
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

      alert(`Join request submitted! You will be notified once approved.`);
      window.location.reload();

    } catch (err) {
      console.error("Join request error:", err);
      alert("Failed to submit request: " + err.message);
      btnJoin.disabled = false;
      btnJoin.textContent = "Submit Join Request";
    }
  });
}