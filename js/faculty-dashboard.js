import { auth, db } from "./firebase-init.js";
import { initAuthGuard } from "./auth-guard.js";
import { logActivity } from "./audit-logger.js";
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  getDoc,
  addDoc, 
  doc, 
  deleteDoc, 
  updateDoc,
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// DOM Elements
const btnOpenCreateModal = document.getElementById("btn-open-create-modal");
const btnCloseCreateModal = document.getElementById("btn-close-create-modal");
const createModal = document.getElementById("create-class-modal");
const formCreateClass = document.getElementById("form-create-class");
const inputClassName = document.getElementById("input-class-name");
const inputClassSection = document.getElementById("input-class-section");
const btnSubmitCreate = document.getElementById("btn-submit-create-class");

const classesGrid = document.getElementById("classes-grid");
const rosterPanel = document.getElementById("roster-panel");
const rosterHeading = document.getElementById("roster-heading");
const rosterSubheading = document.getElementById("roster-subheading");
const btnEnterWorkspace = document.getElementById("btn-enter-workspace");
const btnCopyCode = document.getElementById("btn-copy-class-code");
const btnDeleteClass = document.getElementById("btn-delete-class");

const pendingTbody = document.getElementById("pending-tbody");
const pendingBadgeCount = document.getElementById("pending-badge-count");
const rosterTbody = document.getElementById("roster-tbody");

let currentUser = null;
let selectedClassId = null;
let selectedClassCode = "";
let currentClassData = null;

// Helper: Generate unique 4-character classroom code
function generateClassCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "AIM-";
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Modal open/close controls
btnOpenCreateModal?.addEventListener("click", () => {
  if (createModal) createModal.style.display = "block";
});

btnCloseCreateModal?.addEventListener("click", () => {
  if (createModal) createModal.style.display = "none";
});

// Guard & Load
initAuthGuard({
  allowedRoles: ["faculty", "admin"],
  onReady: async ({ user }) => {
    currentUser = user;
    await loadFacultyClassrooms();
  }
});

/**
 * Loads all classrooms owned by the currently authenticated faculty member
 */
async function loadFacultyClassrooms() {
  if (!classesGrid) return;
  classesGrid.innerHTML = `<div class="empty-state"><p>Loading your classrooms...</p></div>`;

  try {
    const q = query(
      collection(db, "classrooms"), 
      where("facultyUid", "==", currentUser.uid)
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      classesGrid.innerHTML = `
        <div class="empty-state">
          <p>You have not created any classrooms yet.</p>
          <small>Click "+ Create New Class" above to set up your first section.</small>
        </div>
      `;
      if (rosterPanel) rosterPanel.style.display = "none";
      return;
    }

    classesGrid.innerHTML = "";

    snap.forEach((docSnap) => {
      const data = docSnap.data();
      const card = document.createElement("div");
      card.className = "card module-card";
      card.dataset.id = docSnap.id;

      const studentCount = Array.isArray(data.students) ? data.students.length : 0;
      const pendingCount = Array.isArray(data.pendingRequests) ? data.pendingRequests.length : 0;

      card.innerHTML = `
        <div class="card-header">
          <div>
            <h3 class="card-title">${data.name || "Untitled Course"}</h3>
            <p class="card-subtitle">${data.section || "General Section"}</p>
          </div>
          <span class="status-badge active">${data.code || "NO CODE"}</span>
        </div>
        <div style="margin-top: 12px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 13px; color: var(--text-secondary);">
            Enrolled: <strong>${studentCount}</strong>
            ${pendingCount > 0 ? `<span style="margin-left: 6px; color: #eab308; font-weight: 700;">(${pendingCount} pending)</span>` : ""}
          </span>
          <button type="button" class="btn btn-secondary view-roster-btn" style="padding: 4px 10px; font-size: 12px;">Manage</button>
        </div>
      `;

      card.addEventListener("click", () => selectClassroom(docSnap.id, data));
      classesGrid.appendChild(card);
    });

  } catch (err) {
    console.error("Error loading classrooms:", err);
    classesGrid.innerHTML = `<div class="empty-state"><p>Failed to load classrooms: ${err.message}</p></div>`;
  }
}

/**
 * Select a classroom to display join requests, active roster, and direct entry link
 */
function selectClassroom(classId, classData) {
  selectedClassId = classId;
  selectedClassCode = classData.code;
  currentClassData = classData;

  if (rosterPanel) rosterPanel.style.display = "flex";
  if (rosterHeading) rosterHeading.textContent = `${classData.name} (${classData.section})`;
  if (rosterSubheading) rosterSubheading.textContent = `Permanent Join Code: ${classData.code}`;

  if (btnEnterWorkspace) {
    btnEnterWorkspace.href = `classroom.html?code=${classData.code}`;
  }

  renderPendingTable(classData.pendingRequests || []);
  renderRosterTable(classData.students || []);

  rosterPanel?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/**
 * Renders the pending join requests with Approve and Decline actions
 */
function renderPendingTable(pendingList) {
  if (!pendingTbody) return;
  pendingTbody.innerHTML = "";

  if (pendingBadgeCount) {
    pendingBadgeCount.textContent = `${pendingList.length} Pending`;
  }

  if (pendingList.length === 0) {
    pendingTbody.innerHTML = `
      <tr>
        <td colspan="4" class="empty-state">No pending join requests for this section.</td>
      </tr>
    `;
    return;
  }

  pendingList.forEach((student, index) => {
    const tr = document.createElement("tr");
    const requestedDate = student.requestedAt ? new Date(student.requestedAt).toLocaleDateString() : "Recently";

    tr.innerHTML = `
      <td><strong>${student.name || "Student"}</strong></td>
      <td>${student.email || "No email"}</td>
      <td>${requestedDate}</td>
      <td style="display: flex; gap: 8px;">
        <button type="button" class="btn btn-primary btn-approve" data-index="${index}" style="padding: 4px 10px; font-size: 11px;">
          ✓ Approve
        </button>
        <button type="button" class="btn btn-secondary danger-action btn-decline" data-index="${index}" style="padding: 4px 10px; font-size: 11px;">
          ✕ Decline
        </button>
      </td>
    `;

    tr.querySelector(".btn-approve")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      await handleRequestDecision(index, student, true);
    });

    tr.querySelector(".btn-decline")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      await handleRequestDecision(index, student, false);
    });

    pendingTbody.appendChild(tr);
  });
}

/**
 * Handles instructor approval or decline of pending join requests
 */
async function handleRequestDecision(studentIndex, student, isApproved) {
  if (!selectedClassId) return;

  const classRef = doc(db, "classrooms", selectedClassId);
  const classSnap = await getDoc(classRef);
  if (!classSnap.exists()) return;

  const data = classSnap.data();
  const pendingRequests = [...(data.pendingRequests || [])];
  const enrolledStudents = [...(data.students || [])];

  pendingRequests.splice(studentIndex, 1);

  try {
    if (isApproved) {
      const newEnrolledEntry = {
        uid: student.uid,
        email: student.email,
        name: student.name,
        joinedAt: new Date().toISOString()
      };
      enrolledStudents.push(newEnrolledEntry);

      await updateDoc(classRef, {
        pendingRequests: pendingRequests,
        students: enrolledStudents
      });

      await updateDoc(doc(db, "users", student.uid), {
        classroomCode: selectedClassCode,
        classroomId: selectedClassId,
        pendingClassroomCode: null,
        pendingClassroomId: null,
        updatedAt: serverTimestamp()
      });

      await addDoc(collection(db, "notifications"), {
        recipientUid: student.uid,
        category: "Enrollment",
        message: `Your request to join ${data.name || selectedClassCode} (${selectedClassCode}) has been approved!`,
        link: `classroom.html?code=${selectedClassCode}`,
        read: false,
        createdAt: serverTimestamp()
      });

      await logActivity({
        category: "Classroom",
        details: `${currentUser.email} approved join request for ${student.email} into ${selectedClassCode}`,
        classroomCode: selectedClassCode,
        userEmail: currentUser.email
      });

      alert(`Approved ${student.name || student.email}!`);
    } else {
      await updateDoc(classRef, {
        pendingRequests: pendingRequests
      });

      await updateDoc(doc(db, "users", student.uid), {
        pendingClassroomCode: null,
        pendingClassroomId: null,
        updatedAt: serverTimestamp()
      });

      await addDoc(collection(db, "notifications"), {
        recipientUid: student.uid,
        category: "Enrollment",
        message: `Your request to join class ${selectedClassCode} was not approved by the instructor.`,
        link: "student-dashboard.html",
        read: false,
        createdAt: serverTimestamp()
      });

      alert(`Declined request for ${student.name || student.email}.`);
    }

    currentClassData.pendingRequests = pendingRequests;
    currentClassData.students = enrolledStudents;
    renderPendingTable(pendingRequests);
    renderRosterTable(enrolledStudents);
    await loadFacultyClassrooms();

  } catch (err) {
    console.error("Decision error:", err);
    alert("Error processing decision: " + err.message);
  }
}

/**
 * Renders the officially enrolled students table
 */
function renderRosterTable(students) {
  if (!rosterTbody) return;
  rosterTbody.innerHTML = "";

  if (students.length === 0) {
    rosterTbody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-state">No students enrolled yet. Share the code to invite students.</td>
      </tr>
    `;
    return;
  }

  students.forEach((student, index) => {
    const tr = document.createElement("tr");
    const joinedDate = student.joinedAt ? new Date(student.joinedAt).toLocaleDateString() : "N/A";

    tr.innerHTML = `
      <td><strong>${student.name || "Student"}</strong></td>
      <td>${student.email || "No email"}</td>
      <td>${joinedDate}</td>
      <td><span class="status-badge active">Enrolled</span></td>
      <td>
        <button type="button" class="btn btn-secondary danger-action remove-student-btn" data-index="${index}" style="padding: 4px 8px; font-size: 11px;">
          Remove
        </button>
      </td>
    `;

    tr.querySelector(".remove-student-btn")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      await removeStudent(index, student);
    });

    rosterTbody.appendChild(tr);
  });
}

/**
 * Create classroom form submission
 */
formCreateClass?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = inputClassName.value.trim();
  const section = inputClassSection.value.trim();

  if (!name || !section) return;

  btnSubmitCreate.disabled = true;
  btnSubmitCreate.textContent = "Creating...";

  try {
    const code = generateClassCode();

    const newClassData = {
      name,
      section,
      code,
      facultyUid: currentUser.uid,
      facultyEmail: currentUser.email,
      students: [],
      pendingRequests: [],
      createdAt: serverTimestamp()
    };

    await addDoc(collection(db, "classrooms"), newClassData);

    await logActivity({
      category: "Classroom",
      details: `${currentUser.email} created new classroom ${name} (${code})`,
      classroomCode: code,
      userEmail: currentUser.email
    });

    formCreateClass.reset();
    if (createModal) createModal.style.display = "none";
    await loadFacultyClassrooms();

  } catch (err) {
    console.error("Failed to create classroom:", err);
    alert("Could not create classroom: " + err.message);
  } finally {
    btnSubmitCreate.disabled = false;
    btnSubmitCreate.textContent = "Create Class Space";
  }
});

// Copy class join code button
btnCopyCode?.addEventListener("click", () => {
  if (!selectedClassCode) return;
  navigator.clipboard.writeText(selectedClassCode).then(() => {
    const originalText = btnCopyCode.textContent;
    btnCopyCode.textContent = "Copied!";
    setTimeout(() => {
      btnCopyCode.textContent = originalText;
    }, 2000);
  });
});

/**
 * Delete Classroom & Unlink all members
 */
btnDeleteClass?.addEventListener("click", async () => {
  if (!selectedClassId) return;

  const confirmDelete = confirm(`Are you sure you want to delete classroom code ${selectedClassCode}? All enrolled students will be unlinked.`);
  if (!confirmDelete) return;

  try {
    const classRef = doc(db, "classrooms", selectedClassId);
    const snap = await getDoc(classRef);

    if (snap.exists()) {
      const classData = snap.data();
      const allStudents = [...(classData.students || []), ...(classData.pendingRequests || [])];

      for (const student of allStudents) {
        if (student.uid) {
          try {
            await updateDoc(doc(db, "users", student.uid), {
              classroomCode: null,
              classroomId: null,
              pendingClassroomCode: null,
              pendingClassroomId: null,
              updatedAt: serverTimestamp()
            });

            await addDoc(collection(db, "notifications"), {
              recipientUid: student.uid,
              category: "Classroom",
              message: `Classroom ${selectedClassCode} has been closed by the instructor.`,
              link: "student-dashboard.html",
              read: false,
              createdAt: serverTimestamp()
            });
          } catch (e) {
            console.warn("Could not unlink student " + student.uid, e);
          }
        }
      }
    }

    await deleteDoc(classRef);

    await logActivity({
      category: "Classroom",
      details: `${currentUser.email} deleted classroom ${selectedClassCode}`,
      classroomCode: selectedClassCode,
      userEmail: currentUser.email
    });

    selectedClassId = null;
    selectedClassCode = "";
    if (rosterPanel) rosterPanel.style.display = "none";
    await loadFacultyClassrooms();

    alert("Classroom deleted successfully.");

  } catch (err) {
    console.error("Error deleting classroom:", err);
    alert("Failed to delete classroom: " + err.message);
  }
});

/**
 * Remove an enrolled student from the section
 */
async function removeStudent(studentIndex, studentData) {
  if (!selectedClassId) return;

  const confirmRemove = confirm(`Remove ${studentData.name || studentData.email} from this classroom?`);
  if (!confirmRemove) return;

  try {
    const classRef = doc(db, "classrooms", selectedClassId);
    const snap = await getDoc(classRef);
    
    if (!snap.exists()) return;
    const currentStudents = [...(snap.data().students || [])];
    currentStudents.splice(studentIndex, 1);

    await updateDoc(classRef, {
      students: currentStudents
    });

    if (studentData.uid) {
      await updateDoc(doc(db, "users", studentData.uid), {
        classroomCode: null,
        classroomId: null
      });

      await addDoc(collection(db, "notifications"), {
        recipientUid: studentData.uid,
        category: "Classroom",
        message: `You have been removed from classroom ${selectedClassCode} by the instructor.`,
        link: "student-dashboard.html",
        read: false,
        createdAt: serverTimestamp()
      });
    }

    renderRosterTable(currentStudents);

  } catch (err) {
    console.error("Error removing student:", err);
    alert("Failed to remove student: " + err.message);
  }
}