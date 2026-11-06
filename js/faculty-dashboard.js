import { auth, db } from "./firebase-init.js";
import { initAuthGuard } from "./auth-guard.js";
import { logActivity } from "./audit-logger.js";
import { 
  collection, 
  query, 
  where, 
  getDocs, 
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
const rosterTbody = document.getElementById("roster-tbody");
const btnCopyCode = document.getElementById("btn-copy-class-code");
const btnDeleteClass = document.getElementById("btn-delete-class");

let currentUser = null;
let selectedClassId = null;
let selectedClassCode = "";

// Helper to generate clean unique 6-character classroom code
function generateClassCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "AIM-";
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Modal controls
btnOpenCreateModal?.addEventListener("click", () => {
  if (createModal) createModal.style.display = "block";
});

btnCloseCreateModal?.addEventListener("click", () => {
  if (createModal) createModal.style.display = "none";
});

// Initialize via Auth Guard
initAuthGuard({
  allowedRoles: ["faculty", "admin"],
  onReady: async ({ user, userData, role }) => {
    currentUser = user;
    await loadFacultyClassrooms();
  }
});

/**
 * Loads ONLY the classrooms created by the currently authenticated faculty/admin.
 */
async function loadFacultyClassrooms() {
  if (!classesGrid) return;
  classesGrid.innerHTML = `<div class="empty-state"><p>Loading your classrooms...</p></div>`;

  try {
    // Strictly filter classrooms by the current user's UID
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

      card.innerHTML = `
        <div class="card-header">
          <div>
            <h3 class="card-title">${data.name || "Untitled Course"}</h3>
            <p class="card-subtitle">${data.section || "General Section"}</p>
          </div>
          <span class="status-badge active">${data.code || "NO CODE"}</span>
        </div>
        <div style="margin-top: 12px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 13px; color: var(--text-secondary);">Enrolled: <strong>${studentCount}</strong></span>
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
 * Displays roster details and management actions for a selected class
 */
function selectClassroom(classId, classData) {
  selectedClassId = classId;
  selectedClassCode = classData.code;

  if (rosterPanel) rosterPanel.style.display = "block";
  if (rosterHeading) rosterHeading.textContent = `${classData.name} (${classData.section})`;
  if (rosterSubheading) rosterSubheading.textContent = `Permanent Join Code: ${classData.code}`;

  renderRosterTable(classData.students || []);

  rosterPanel?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/**
 * Populates the enrolled students table with options to remove students
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
 * Creates a brand new classroom section
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
      createdAt: serverTimestamp()
    };

    const docRef = await addDoc(collection(db, "classrooms"), newClassData);

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

/**
 * Copy join code to clipboard
 */
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
 * Deletes the currently selected classroom
 */
btnDeleteClass?.addEventListener("click", async () => {
  if (!selectedClassId) return;

  const confirmDelete = confirm(`Are you sure you want to delete classroom code ${selectedClassCode}? This action cannot be undone.`);
  if (!confirmDelete) return;

  try {
    await deleteDoc(doc(db, "classrooms", selectedClassId));
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

  } catch (err) {
    console.error("Error deleting classroom:", err);
    alert("Failed to delete classroom: " + err.message);
  }
});

/**
 * Removes a student from a classroom roster
 */
async function removeStudent(studentIndex, studentData) {
  if (!selectedClassId) return;

  const confirmRemove = confirm(`Remove ${studentData.name || studentData.email} from this classroom?`);
  if (!confirmRemove) return;

  try {
    const classRef = doc(db, "classrooms", selectedClassId);
    const snap = await getDocs(query(collection(db, "classrooms"), where("code", "==", selectedClassCode)));
    
    if (snap.empty) return;
    const currentStudents = snap.docs[0].data().students || [];
    currentStudents.splice(studentIndex, 1);

    await updateDoc(classRef, {
      students: currentStudents
    });

    // Also unassign classroomCode on the student's user document if UID is available
    if (studentData.uid) {
      await updateDoc(doc(db, "users", studentData.uid), {
        classroomCode: null,
        classroomId: null
      });
    }

    renderRosterTable(currentStudents);

  } catch (err) {
    console.error("Error removing student:", err);
    alert("Failed to remove student: " + err.message);
  }
}