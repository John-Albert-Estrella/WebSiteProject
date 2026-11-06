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
  updateDoc, 
  serverTimestamp, 
  orderBy, 
  onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// Cloudinary Configuration
const CLOUDINARY_CLOUD_NAME = "dzx0v4g5n";
const CLOUDINARY_UPLOAD_PRESET = "aimser_uploads";

// Query Parameters
const urlParams = new URLSearchParams(window.location.search);
const currentClassCode = urlParams.get("code");

// Header DOM
const roomName = document.getElementById("room-name");
const roomDetails = document.getElementById("room-details");
const roomCodeTag = document.getElementById("room-code-tag");
const sidebarHomeLink = document.getElementById("sidebar-home-link");
const sidebarRoleTag = document.getElementById("sidebar-role-tag");

// Feed DOM
const formPost = document.getElementById("form-create-post");
const inputPostBody = document.getElementById("input-post-body");
const postsContainer = document.getElementById("posts-container");

// Planner DOM
const btnOpenTask = document.getElementById("btn-open-task-modal");
const btnCloseTask = document.getElementById("btn-close-task-modal");
const taskModal = document.getElementById("task-modal");
const formTask = document.getElementById("form-create-task");

// Cases & Grading DOM
const casesGrid = document.getElementById("cases-grid");
const submissionsTbody = document.getElementById("submissions-tbody");
const btnOpenCreateCase = document.getElementById("btn-open-create-case");
const modalCreateCase = document.getElementById("modal-create-case");
const formCreateCase = document.getElementById("form-create-case");

const modalGrade = document.getElementById("modal-grade-submission");
const formGrade = document.getElementById("form-grade-submission");
const gradeStudentName = document.getElementById("grade-modal-student-name");
const gradeFileLink = document.getElementById("grade-file-link");
const gradeSubId = document.getElementById("grade-submission-id");
const gradeStudentUid = document.getElementById("grade-student-uid");
const gradeScoreInput = document.getElementById("grade-score-input");
const gradeNotesInput = document.getElementById("grade-notes-input");
const btnSubmitGrade = document.getElementById("btn-submit-grade");

// Student Deliverable Submission DOM
const modalStudentSubmit = document.getElementById("modal-student-submit");
const formStudentSubmit = document.getElementById("form-student-submit");
const submitCaseId = document.getElementById("student-submit-case-id");
const submitCaseTitle = document.getElementById("student-submit-case-title");
const submitModalTitle = document.getElementById("submit-modal-title");
const inpDeliverableFile = document.getElementById("inp-deliverable-file");
const inpDeliverableNotes = document.getElementById("inp-deliverable-notes");
const btnSubmitDeliverable = document.getElementById("btn-submit-deliverable");

// Recruitment DOM
const btnOpenJob = document.getElementById("btn-open-job-modal");
const modalCreateJob = document.getElementById("modal-create-job");
const formCreateJob = document.getElementById("form-create-job");
const jobOrdersContainer = document.getElementById("job-orders-container");

// Performance KPI DOM
const btnOpenKPI = document.getElementById("btn-open-kpi-modal");
const modalCreateKPI = document.getElementById("modal-create-kpi");
const formCreateKPI = document.getElementById("form-create-kpi");
const kpiCyclesTbody = document.getElementById("kpi-cycles-tbody");

// Employee Relations DOM
const btnOpenGrievance = document.getElementById("btn-open-grievance-modal");
const modalCreateGrievance = document.getElementById("modal-create-grievance");
const formCreateGrievance = document.getElementById("form-create-grievance");
const grievancesTbody = document.getElementById("grievances-tbody");

// Grievance Ruling DOM
const modalResolveGrievance = document.getElementById("modal-resolve-grievance");
const formResolveGrievance = document.getElementById("form-resolve-grievance");
const resolveGrvRef = document.getElementById("resolve-grv-ref");
const resolveGrvFacts = document.getElementById("resolve-grv-facts");
const resolveGrvId = document.getElementById("resolve-grv-id");
const grvRulingSelect = document.getElementById("grv-ruling-select");
const grvRationaleInp = document.getElementById("grv-rationale-inp");
const btnSubmitRuling = document.getElementById("btn-submit-ruling");

// Roster DOM
const roomRosterTbody = document.getElementById("room-roster-tbody");
const pendingTbody = document.getElementById("pending-tbody");
const pendingBadgeCount = document.getElementById("pending-badge-count");
const facultyPendingSection = document.getElementById("faculty-pending-section");

let currentUser = null;
let currentRole = "student";
let activeClassDocId = null;
let activeClassData = null;

// =========================================================================
// 1. TAB CONTROLS & MODAL HELPERS
// =========================================================================
document.querySelectorAll(".class-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".class-tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content-panel").forEach(p => p.classList.remove("active"));

    btn.classList.add("active");
    const targetId = btn.dataset.tab;
    const targetPanel = document.getElementById(targetId);
    if (targetPanel) targetPanel.classList.add("active");
  });
});

document.querySelectorAll(".close-modal-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".modal-backdrop-custom").forEach(m => m.style.display = "none");
  });
});

// =========================================================================
// 2. AUTH GUARD INITIALIZATION
// =========================================================================
initAuthGuard({
  allowedRoles: ["student", "faculty", "admin"],
  onReady: async ({ user, userData, role }) => {
    currentUser = user;
    currentRole = role;

    if (!currentClassCode) {
      alert("No classroom code provided in URL.");
      window.location.replace(role === "faculty" ? "faculty-dashboard.html" : "student-dashboard.html");
      return;
    }

    if (sidebarHomeLink) {
      if (role === "faculty" || role === "admin") {
        sidebarHomeLink.href = "faculty-dashboard.html";
        sidebarHomeLink.innerHTML = "📊 Faculty Dashboard";
      } else {
        sidebarHomeLink.href = "student-dashboard.html";
        sidebarHomeLink.innerHTML = "📊 My Classrooms";
      }
    }
    if (sidebarRoleTag) sidebarRoleTag.textContent = role.toUpperCase();

    // Show Faculty Controls
    if (role === "faculty" || role === "admin") {
      document.querySelectorAll(".faculty-only-control").forEach(el => el.style.display = "inline-flex");
      if (facultyPendingSection) facultyPendingSection.style.display = "block";
    }

    await loadClassroomDetails();
    initClassFeed();
    initClassPlanner();
    initClassCasesAndSubmissions();
    initRecruitment();
    initKPI();
    initRelations();
  }
});

// =========================================================================
// 3. CLASSROOM VERIFICATION
// =========================================================================
async function loadClassroomDetails() {
  try {
    const q = query(collection(db, "classrooms"), where("code", "==", currentClassCode));
    const snap = await getDocs(q);

    if (snap.empty) {
      alert("Classroom not found or was dissolved by the instructor.");
      window.location.replace(currentRole === "faculty" ? "faculty-dashboard.html" : "student-dashboard.html");
      return;
    }

    const classDoc = snap.docs[0];
    activeClassDocId = classDoc.id;
    activeClassData = classDoc.data();

    if (currentRole === "student") {
      const isEnrolled = (activeClassData.students || []).some(s => s.uid === currentUser.uid);
      if (!isEnrolled) {
        alert("You are not currently enrolled in this classroom.");
        window.location.replace("student-dashboard.html");
        return;
      }
    }

    if (roomName) roomName.textContent = activeClassData.name || "Academic Classroom";
    if (roomDetails) roomDetails.textContent = `${activeClassData.section || "Cohort"} • Instructor: ${activeClassData.facultyEmail || "Faculty"}`;
    if (roomCodeTag) roomCodeTag.textContent = currentClassCode;

    renderRoster(activeClassData.students || []);
    if (currentRole === "faculty" || currentRole === "admin") {
      renderPendingRequests(activeClassData.pendingRequests || []);
    }

  } catch (err) {
    console.error("Error loading classroom details:", err);
  }
}

// =========================================================================
// 4. ROSTER & MODERATION
// =========================================================================
function renderRoster(students) {
  if (!roomRosterTbody) return;
  roomRosterTbody.innerHTML = "";

  if (students.length === 0) {
    roomRosterTbody.innerHTML = `<tr><td colspan="4" class="empty-state">No students enrolled yet.</td></tr>`;
    return;
  }

  students.forEach((s) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${s.name || "Student"}</strong></td>
      <td>${s.email || "No email"}</td>
      <td>${s.joinedAt ? new Date(s.joinedAt).toLocaleDateString() : "Active"}</td>
      <td class="faculty-only-control">
        ${(currentRole === "faculty" || currentRole === "admin") ? `<button type="button" class="btn btn-secondary danger-action btn-remove-student" style="padding: 2px 8px; font-size: 11px;">Remove</button>` : ""}
      </td>
    `;

    tr.querySelector(".btn-remove-student")?.addEventListener("click", async () => {
      if (confirm(`Remove ${s.name || s.email} from this classroom?`)) {
        await removeStudentFromClass(s);
      }
    });

    roomRosterTbody.appendChild(tr);
  });
}

function renderPendingRequests(pending) {
  if (!pendingTbody) return;
  pendingTbody.innerHTML = "";

  if (pendingBadgeCount) {
    pendingBadgeCount.textContent = `${pending.length} Pending`;
  }

  if (pending.length === 0) {
    pendingTbody.innerHTML = `<tr><td colspan="4" class="empty-state">No pending join requests.</td></tr>`;
    return;
  }

  pending.forEach((req, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${req.name || "Student"}</strong></td>
      <td>${req.email || "No email"}</td>
      <td>${req.requestedAt ? new Date(req.requestedAt).toLocaleDateString() : "Recently"}</td>
      <td style="display: flex; gap: 6px;">
        <button type="button" class="btn btn-primary btn-appr" style="padding: 2px 8px; font-size: 11px;">✓ Approve</button>
        <button type="button" class="btn btn-secondary danger-action btn-decl" style="padding: 2px 8px; font-size: 11px;">✕ Decline</button>
      </td>
    `;

    tr.querySelector(".btn-appr")?.addEventListener("click", async () => {
      await processRequestDecision(idx, req, true);
    });

    tr.querySelector(".btn-decl")?.addEventListener("click", async () => {
      await processRequestDecision(idx, req, false);
    });

    pendingTbody.appendChild(tr);
  });
}

async function processRequestDecision(idx, student, isApproved) {
  if (!activeClassDocId) return;

  const classRef = doc(db, "classrooms", activeClassDocId);
  const snap = await getDoc(classRef);
  if (!snap.exists()) return;

  const data = snap.data();
  const pending = [...(data.pendingRequests || [])];
  const enrolled = [...(data.students || [])];

  pending.splice(idx, 1);

  try {
    if (isApproved) {
      enrolled.push({
        uid: student.uid,
        email: student.email,
        name: student.name,
        joinedAt: new Date().toISOString()
      });

      await updateDoc(classRef, { pendingRequests: pending, students: enrolled });
      await updateDoc(doc(db, "users", student.uid), {
        classroomCode: currentClassCode,
        classroomId: activeClassDocId,
        pendingClassroomCode: null,
        pendingClassroomId: null
      });

      await addDoc(collection(db, "notifications"), {
        recipientUid: student.uid,
        category: "Enrollment",
        message: `Your request to join ${data.name || currentClassCode} (${currentClassCode}) has been approved!`,
        link: `classroom.html?code=${currentClassCode}`,
        read: false,
        createdAt: serverTimestamp()
      });
    } else {
      await updateDoc(classRef, { pendingRequests: pending });
      await updateDoc(doc(db, "users", student.uid), {
        pendingClassroomCode: null,
        pendingClassroomId: null
      });
    }

    renderPendingRequests(pending);
    renderRoster(enrolled);
  } catch (err) {
    console.error("Decision error:", err);
  }
}

async function removeStudentFromClass(student) {
  if (!activeClassDocId) return;
  const classRef = doc(db, "classrooms", activeClassDocId);
  const snap = await getDoc(classRef);
  if (!snap.exists()) return;

  const enrolled = (snap.data().students || []).filter(s => s.uid !== student.uid);
  await updateDoc(classRef, { students: enrolled });

  await updateDoc(doc(db, "users", student.uid), {
    classroomCode: null,
    classroomId: null
  });

  await addDoc(collection(db, "notifications"), {
    recipientUid: student.uid,
    category: "Classroom",
    message: `You were removed from classroom ${currentClassCode} by the instructor.`,
    link: "student-dashboard.html",
    read: false,
    createdAt: serverTimestamp()
  });

  renderRoster(enrolled);
}

// =========================================================================
// 5. CLASS DISCUSSION FEED
// =========================================================================
function initClassFeed() {
  const q = query(
    collection(db, "posts"),
    where("classroomCode", "==", currentClassCode),
    orderBy("createdAt", "desc")
  );

  onSnapshot(q, (snapshot) => {
    if (!postsContainer) return;
    postsContainer.innerHTML = "";

    if (snapshot.empty) {
      postsContainer.innerHTML = `<div class="empty-state"><p>No discussions posted yet.</p></div>`;
      return;
    }

    snapshot.forEach((docSnap) => {
      const p = docSnap.data();
      const card = document.createElement("div");
      card.className = "card";
      card.style.marginBottom = "14px";
      card.innerHTML = `
        <div class="card-header" style="margin-bottom: 8px;">
          <strong style="color: var(--accent); font-size: 13.5px;">${p.authorName || p.authorEmail}</strong>
          <span style="font-size: 11px; color: var(--text-tertiary);">
            ${p.createdAt?.toDate ? p.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Just now"}
          </span>
        </div>
        <p style="font-size: 13.5px; line-height: 1.5; color: var(--text-primary); margin: 0;">${p.body || ""}</p>
      `;
      postsContainer.appendChild(card);
    });
  });

  formPost?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = inputPostBody.value.trim();
    if (!body) return;

    try {
      await addDoc(collection(db, "posts"), {
        body,
        classroomCode: currentClassCode,
        authorUid: currentUser.uid,
        authorEmail: currentUser.email,
        authorName: `${currentUser.displayName || currentUser.email}`,
        createdAt: serverTimestamp()
      });
      formPost.reset();
    } catch (err) {
      console.error("Feed error:", err);
    }
  });
}

// =========================================================================
// 6. PLANNER & KANBAN
// =========================================================================
function initClassPlanner() {
  btnOpenTask?.addEventListener("click", () => { if (taskModal) taskModal.style.display = "block"; });
  btnCloseTask?.addEventListener("click", () => { if (taskModal) taskModal.style.display = "none"; });

  const q = query(collection(db, "tasks"), where("classroomCode", "==", currentClassCode));

  onSnapshot(q, (snapshot) => {
    const todoEl = document.getElementById("tasks-todo");
    const progEl = document.getElementById("tasks-in_progress");
    const doneEl = document.getElementById("tasks-done");

    if (!todoEl || !progEl || !doneEl) return;
    todoEl.innerHTML = "";
    progEl.innerHTML = "";
    doneEl.innerHTML = "";

    let cTodo = 0, cProg = 0, cDone = 0;

    snapshot.forEach((docSnap) => {
      const t = docSnap.data();
      const card = document.createElement("div");
      card.className = "kanban-task-card";
      card.innerHTML = `
        <h4 class="kanban-task-title">${t.title || "Untitled Task"}</h4>
        ${t.description ? `<p style="font-size: 12px; color: var(--text-secondary); margin: 4px 0;">${t.description}</p>` : ""}
        <div style="margin-top: 6px; display: flex; justify-content: space-between; align-items: center;">
          <span class="status-badge" style="font-size: 10px;">${t.priority || "Medium"}</span>
          <select class="change-status-select" data-id="${docSnap.id}" style="background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--surface-border); border-radius: 4px; font-size: 11px; padding: 2px 4px;">
            <option value="todo" ${t.status === "todo" ? "selected" : ""}>To Do</option>
            <option value="in_progress" ${t.status === "in_progress" ? "selected" : ""}>In Progress</option>
            <option value="done" ${t.status === "done" ? "selected" : ""}>Done</option>
          </select>
        </div>
      `;

      card.querySelector(".change-status-select")?.addEventListener("change", async (e) => {
        await updateDoc(doc(db, "tasks", docSnap.id), { status: e.target.value });
      });

      if (t.status === "in_progress") {
        progEl.appendChild(card);
        cProg++;
      } else if (t.status === "done") {
        doneEl.appendChild(card);
        cDone++;
      } else {
        todoEl.appendChild(card);
        cTodo++;
      }
    });

    const cntTodo = document.getElementById("count-todo");
    const cntProg = document.getElementById("count-in_progress");
    const cntDone = document.getElementById("count-done");
    if (cntTodo) cntTodo.textContent = cTodo;
    if (cntProg) cntProg.textContent = cProg;
    if (cntDone) cntDone.textContent = cDone;
  });

  formTask?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("task-title")?.value.trim();
    const desc = document.getElementById("task-desc")?.value.trim();
    const priority = document.getElementById("task-priority")?.value;
    const dueDate = document.getElementById("task-due-date")?.value;

    if (!title) return;

    try {
      await addDoc(collection(db, "tasks"), {
        title,
        description: desc || "",
        priority: priority || "medium",
        dueDate: dueDate || null,
        status: "todo",
        classroomCode: currentClassCode,
        createdBy: currentUser.uid,
        createdAt: serverTimestamp()
      });
      formTask.reset();
      if (taskModal) taskModal.style.display = "none";
    } catch (err) {
      console.error("Task creation error:", err);
    }
  });
}

// =========================================================================
// 7. CASE STUDIES & GRADING
// =========================================================================
function initClassCasesAndSubmissions() {
  btnOpenCreateCase?.addEventListener("click", () => {
    if (modalCreateCase) modalCreateCase.style.display = "flex";
  });

  formCreateCase?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("case-title")?.value.trim();
    const category = document.getElementById("case-category")?.value;
    const scenario = document.getElementById("case-scenario")?.value.trim();

    if (!title || !scenario) return;

    try {
      await addDoc(collection(db, "cases"), {
        title,
        category,
        scenario,
        classroomCode: currentClassCode,
        facultyUid: currentUser.uid,
        createdAt: serverTimestamp()
      });

      await logActivity({
        category: "Case Study",
        details: `${currentUser.email} created case study "${title}"`,
        classroomCode: currentClassCode,
        userEmail: currentUser.email
      });

      formCreateCase.reset();
      if (modalCreateCase) modalCreateCase.style.display = "none";
    } catch (err) {
      console.error("Error creating case:", err);
      alert("Failed to publish case: " + err.message);
    }
  });

  const casesQ = query(collection(db, "cases"), where("classroomCode", "==", currentClassCode));
  onSnapshot(casesQ, (snapshot) => {
    if (!casesGrid) return;
    casesGrid.innerHTML = "";

    if (snapshot.empty) {
      casesGrid.innerHTML = `<div class="empty-state"><p>No case studies posted yet.</p></div>`;
      return;
    }

    snapshot.forEach((docSnap) => {
      const c = docSnap.data();
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card-header">
          <div>
            <h3 class="card-title">${c.title || "Untitled Case"}</h3>
            <p class="card-subtitle">${c.category || "General HR"}</p>
          </div>
          <span class="status-badge active">Active Case</span>
        </div>
        <p style="font-size: 13.5px; line-height: 1.5; color: var(--text-secondary); margin: 12px 0;">${c.scenario}</p>
        <div class="card-actions">
          ${currentRole === "student" 
            ? `<button type="button" class="btn btn-primary btn-submit-solution" data-id="${docSnap.id}" data-title="${c.title}">📤 Submit Solution Brief</button>`
            : `<span style="font-size: 12px; color: var(--text-tertiary);">Review submissions below</span>`}
        </div>
      `;

      card.querySelector(".btn-submit-solution")?.addEventListener("click", () => {
        if (submitCaseId) submitCaseId.value = docSnap.id;
        if (submitCaseTitle) submitCaseTitle.value = c.title;
        if (submitModalTitle) submitModalTitle.textContent = `Submit: ${c.title}`;
        if (modalStudentSubmit) modalStudentSubmit.style.display = "flex";
      });

      casesGrid.appendChild(card);
    });
  });

  formStudentSubmit?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = inpDeliverableFile?.files[0];
    const notes = inpDeliverableNotes?.value.trim();
    const caseId = submitCaseId?.value;
    const cTitle = submitCaseTitle?.value;

    if (!file || !caseId) return;

    btnSubmitDeliverable.disabled = true;
    btnSubmitDeliverable.textContent = "Uploading to Cloudinary...";

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`, {
        method: "POST",
        body: formData
      });

      const cloudinaryData = await res.json();
      const fileUrl = cloudinaryData.secure_url || URL.createObjectURL(file);

      btnSubmitDeliverable.textContent = "Saving Record...";

      await addDoc(collection(db, "submissions"), {
        caseId,
        caseTitle: cTitle,
        studentUid: currentUser.uid,
        studentEmail: currentUser.email,
        studentName: currentUser.displayName || currentUser.email,
        fileUrl,
        notes,
        status: "submitted",
        score: null,
        facultyNotes: null,
        classroomCode: currentClassCode,
        createdAt: serverTimestamp()
      });

      if (activeClassData && activeClassData.facultyUid) {
        await addDoc(collection(db, "notifications"), {
          recipientUid: activeClassData.facultyUid,
          category: "Submission",
          message: `${currentUser.displayName || currentUser.email} submitted a deliverable for "${cTitle}".`,
          link: `classroom.html?code=${currentClassCode}`,
          read: false,
          createdAt: serverTimestamp()
        });
      }

      await logActivity({
        category: "Submission",
        details: `${currentUser.email} submitted deliverable for "${cTitle}"`,
        classroomCode: currentClassCode,
        userEmail: currentUser.email
      });

      alert("Deliverable successfully submitted!");
      formStudentSubmit.reset();
      if (modalStudentSubmit) modalStudentSubmit.style.display = "none";

    } catch (err) {
      console.error("Submission failed:", err);
      alert("Submission error: " + err.message);
    } finally {
      btnSubmitDeliverable.disabled = false;
      btnSubmitDeliverable.textContent = "Submit Deliverable";
    }
  });

  const subQ = query(collection(db, "submissions"), where("classroomCode", "==", currentClassCode));
  onSnapshot(subQ, (snapshot) => {
    if (!submissionsTbody) return;
    submissionsTbody.innerHTML = "";

    if (snapshot.empty) {
      submissionsTbody.innerHTML = `<tr><td colspan="6" class="empty-state">No submissions uploaded for this classroom yet.</td></tr>`;
      return;
    }

    snapshot.forEach((docSnap) => {
      const s = docSnap.data();
      const tr = document.createElement("tr");
      const submittedDate = s.createdAt?.toDate ? s.createdAt.toDate().toLocaleDateString() : "Recently";
      const isGraded = s.status === "evaluated";

      tr.innerHTML = `
        <td><strong>${s.studentName || s.studentEmail}</strong></td>
        <td>${s.caseTitle || "Deliverable"}</td>
        <td>
          <a href="${s.fileUrl}" target="_blank" class="auth-link" style="font-size: 12px;">🔗 View Asset</a>
        </td>
        <td>${submittedDate}</td>
        <td>
          <span class="status-badge ${isGraded ? "active" : ""}">
            ${isGraded ? `${s.score} / 100` : "Pending"}
          </span>
        </td>
        <td>
          ${(currentRole === "faculty" || currentRole === "admin") ? `
            <button type="button" class="btn btn-secondary btn-open-grade" style="padding: 2px 8px; font-size: 11px;">
              ${isGraded ? "Re-evaluate" : "Score"}
            </button>
          ` : `
            <span style="font-size: 11.5px; color: var(--text-tertiary);">${isGraded ? "Graded" : "Submitted"}</span>
          `}
        </td>
      `;

      tr.querySelector(".btn-open-grade")?.addEventListener("click", () => {
        if (gradeSubId) gradeSubId.value = docSnap.id;
        if (gradeStudentUid) gradeStudentUid.value = s.studentUid;
        if (gradeStudentName) gradeStudentName.textContent = `${s.studentName || s.studentEmail} — ${s.caseTitle}`;
        if (gradeFileLink) gradeFileLink.href = s.fileUrl;
        if (gradeScoreInput) gradeScoreInput.value = s.score || "";
        if (gradeNotesInput) gradeNotesInput.value = s.facultyNotes || "";
        if (modalGrade) modalGrade.style.display = "flex";
      });

      submissionsTbody.appendChild(tr);
    });
  });

  formGrade?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submissionId = gradeSubId?.value;
    const targetStudentUid = gradeStudentUid?.value;
    const score = parseInt(gradeScoreInput?.value, 10);
    const facultyNotes = gradeNotesInput?.value.trim();

    if (!submissionId || isNaN(score)) return;

    btnSubmitGrade.disabled = true;
    btnSubmitGrade.textContent = "Publishing Evaluation...";

    try {
      await updateDoc(doc(db, "submissions", submissionId), {
        score,
        facultyNotes,
        status: "evaluated",
        evaluatedAt: serverTimestamp(),
        evaluatedBy: currentUser.email
      });

      if (targetStudentUid) {
        await addDoc(collection(db, "notifications"), {
          recipientUid: targetStudentUid,
          category: "Evaluation",
          message: `Your deliverable was graded! Score: ${score}/100. Feedback: "${facultyNotes}"`,
          link: `classroom.html?code=${currentClassCode}`,
          read: false,
          createdAt: serverTimestamp()
        });
      }

      await logActivity({
        category: "Evaluation",
        details: `${currentUser.email} evaluated submission ${submissionId} with score ${score}`,
        classroomCode: currentClassCode,
        userEmail: currentUser.email
      });

      alert("Evaluation and score saved successfully!");
      if (modalGrade) modalGrade.style.display = "none";

    } catch (err) {
      console.error("Grading failed:", err);
      alert("Failed to save grade: " + err.message);
    } finally {
      btnSubmitGrade.disabled = false;
      btnSubmitGrade.textContent = "Submit Official Evaluation";
    }
  });
}

// =========================================================================
// 8. RECRUITMENT SIMULATOR
// =========================================================================
function initRecruitment() {
  btnOpenJob?.addEventListener("click", () => {
    if (modalCreateJob) modalCreateJob.style.display = "flex";
  });

  formCreateJob?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("job-title-inp")?.value.trim();
    const department = document.getElementById("job-dept-inp")?.value.trim();
    const openings = parseInt(document.getElementById("job-openings-inp")?.value, 10);
    const description = document.getElementById("job-desc-inp")?.value.trim();

    if (!title) return;

    try {
      await addDoc(collection(db, "job_orders"), {
        title,
        department,
        openings: openings || 1,
        description,
        classroomCode: currentClassCode,
        createdAt: serverTimestamp()
      });

      await logActivity({
        category: "Recruitment",
        details: `${currentUser.email} opened job requisition for "${title}"`,
        classroomCode: currentClassCode,
        userEmail: currentUser.email
      });

      formCreateJob.reset();
      if (modalCreateJob) modalCreateJob.style.display = "none";
    } catch (err) {
      console.error("Job creation error:", err);
    }
  });

  const jobQ = query(collection(db, "job_orders"), where("classroomCode", "==", currentClassCode));
  onSnapshot(jobQ, (snapshot) => {
    if (!jobOrdersContainer) return;
    jobOrdersContainer.innerHTML = "";

    if (snapshot.empty) {
      jobOrdersContainer.innerHTML = `<div class="empty-state"><p>No requisitions posted for this section.</p></div>`;
      return;
    }

    snapshot.forEach((docSnap) => {
      const j = docSnap.data();
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card-header">
          <div>
            <h4 class="card-title">${j.title}</h4>
            <p class="card-subtitle">${j.department || "HR"} • ${j.openings || 1} Openings</p>
          </div>
          <span class="status-badge active">Open</span>
        </div>
        <p style="font-size: 13px; color: var(--text-secondary); margin-top: 8px;">${j.description || ""}</p>
        <div class="card-actions" style="margin-top: 10px;">
          ${currentRole === "student" 
            ? `<button type="button" class="btn btn-secondary btn-apply-job" data-title="${j.title}" style="font-size: 11.5px; padding: 4px 10px;">📝 Submit Candidate Shortlist</button>`
            : `<span style="font-size: 11px; color: var(--text-tertiary);">Active Requisition</span>`}
        </div>
      `;

      card.querySelector(".btn-apply-job")?.addEventListener("click", () => {
        alert(`Candidate screening rubric for "${j.title}" opened. Compare applicant competencies against this role!`);
      });

      jobOrdersContainer.appendChild(card);
    });
  });
}

// =========================================================================
// 9. PERFORMANCE MANAGEMENT (KPI REVIEWS)
// =========================================================================
function initKPI() {
  btnOpenKPI?.addEventListener("click", () => {
    if (modalCreateKPI) modalCreateKPI.style.display = "flex";
  });

  formCreateKPI?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("kpi-title-inp")?.value.trim();
    const department = document.getElementById("kpi-dept-inp")?.value.trim();
    const focus = document.getElementById("kpi-metric-inp")?.value.trim();
    const guidelines = document.getElementById("kpi-desc-inp")?.value.trim();

    if (!title) return;

    try {
      await addDoc(collection(db, "kpi_cycles"), {
        title,
        department,
        focus,
        guidelines,
        status: "In Progress",
        classroomCode: currentClassCode,
        facultyUid: currentUser.uid,
        createdAt: serverTimestamp()
      });

      await logActivity({
        category: "Performance",
        details: `${currentUser.email} launched KPI review cycle "${title}"`,
        classroomCode: currentClassCode,
        userEmail: currentUser.email
      });

      formCreateKPI.reset();
      if (modalCreateKPI) modalCreateKPI.style.display = "none";
    } catch (err) {
      console.error("Error creating KPI review cycle:", err);
    }
  });

  const kpiQ = query(collection(db, "kpi_cycles"), where("classroomCode", "==", currentClassCode));
  onSnapshot(kpiQ, (snapshot) => {
    if (!kpiCyclesTbody) return;
    kpiCyclesTbody.innerHTML = "";

    if (snapshot.empty) {
      kpiCyclesTbody.innerHTML = `<tr><td colspan="5" class="empty-state">No review cycles logged.</td></tr>`;
      return;
    }

    snapshot.forEach(d => {
      const c = d.data();
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${c.title || "Cycle"}</strong></td>
        <td>${c.department || "Operations"}</td>
        <td>${c.focus || "Quality"}</td>
        <td><span class="status-badge active">${c.status || "In Progress"}</span></td>
        <td>
          <button type="button" class="btn btn-secondary btn-inspect-kpi" style="padding: 2px 8px; font-size: 11px;">
            ${currentRole === "student" ? "Complete Scorecard" : "Inspect Metrics"}
          </button>
        </td>
      `;

      tr.querySelector(".btn-inspect-kpi")?.addEventListener("click", () => {
        alert(`Evaluation Guidelines for ${c.title}:\n\n${c.guidelines || "Complete peer appraisals and metric scoring."}`);
      });

      kpiCyclesTbody.appendChild(tr);
    });
  });
}

// =========================================================================
// 10. EMPLOYEE RELATIONS (GRIEVANCES & ARBITRATION DETERMINATIONS)
// =========================================================================
function initRelations() {
  btnOpenGrievance?.addEventListener("click", () => {
    if (modalCreateGrievance) modalCreateGrievance.style.display = "flex";
  });

  formCreateGrievance?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const ref = document.getElementById("grv-ref-inp")?.value.trim();
    const category = document.getElementById("grv-category-inp")?.value;
    const parties = document.getElementById("grv-parties-inp")?.value.trim();
    const facts = document.getElementById("grv-facts-inp")?.value.trim();

    if (!ref || !facts) return;

    try {
      await addDoc(collection(db, "grievances"), {
        ref,
        category,
        parties,
        facts,
        status: "Under Arbitration",
        classroomCode: currentClassCode,
        facultyUid: currentUser.uid,
        createdAt: serverTimestamp()
      });

      await logActivity({
        category: "Employee Relations",
        details: `${currentUser.email} filed grievance dossier ${ref} for arbitration`,
        classroomCode: currentClassCode,
        userEmail: currentUser.email
      });

      formCreateGrievance.reset();
      if (modalCreateGrievance) modalCreateGrievance.style.display = "none";
    } catch (err) {
      console.error("Error filing grievance:", err);
    }
  });

  const grievQ = query(collection(db, "grievances"), where("classroomCode", "==", currentClassCode));
  onSnapshot(grievQ, (snapshot) => {
    if (!grievancesTbody) return;
    grievancesTbody.innerHTML = "";

    if (snapshot.empty) {
      grievancesTbody.innerHTML = `<tr><td colspan="5" class="empty-state">No grievance records filed.</td></tr>`;
      return;
    }

    snapshot.forEach(d => {
      const g = d.data();
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${g.ref || "GRV-01"}</strong></td>
        <td>${g.category || "Workplace"}</td>
        <td>${g.parties || "Staff"}</td>
        <td><span class="status-badge ${g.status === "Determined" ? "active" : ""}">${g.status || "Under Arbitration"}</span></td>
        <td>
          <button type="button" class="btn btn-secondary btn-arbitrate" style="padding: 2px 8px; font-size: 11px;">
            ${g.status === "Determined" ? "View Ruling" : "Arbitrate"}
          </button>
        </td>
      `;

      tr.querySelector(".btn-arbitrate")?.addEventListener("click", () => {
        if (g.status === "Determined") {
          alert(`Official Arbitration Determination for ${g.ref}:\n\nRuling: ${g.ruling}\n\nRationale:\n${g.rationale || "None logged."}`);
        } else {
          if (resolveGrvId) resolveGrvId.value = d.id;
          if (resolveGrvRef) resolveGrvRef.textContent = `Arbitration Determination: ${g.ref} (${g.category})`;
          if (resolveGrvFacts) resolveGrvFacts.textContent = `Incident Summary: ${g.facts}`;
          if (modalResolveGrievance) modalResolveGrievance.style.display = "flex";
        }
      });

      grievancesTbody.appendChild(tr);
    });
  });

  // Submit Arbitration Ruling
  formResolveGrievance?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const gId = resolveGrvId?.value;
    const ruling = grvRulingSelect?.value;
    const rationale = grvRationaleInp?.value.trim();

    if (!gId || !rationale) return;

    btnSubmitRuling.disabled = true;
    btnSubmitRuling.textContent = "Logging Determination...";

    try {
      await updateDoc(doc(db, "grievances", gId), {
        ruling,
        rationale,
        status: "Determined",
        resolvedAt: serverTimestamp(),
        arbitrator: currentUser.email
      });

      await logActivity({
        category: "Employee Relations",
        details: `${currentUser.email} logged arbitration ruling for grievance ${gId}`,
        classroomCode: currentClassCode,
        userEmail: currentUser.email
      });

      alert("Arbitration determination successfully filed!");
      formResolveGrievance.reset();
      if (modalResolveGrievance) modalResolveGrievance.style.display = "none";

    } catch (err) {
      console.error("Determination error:", err);
      alert("Failed to submit ruling: " + err.message);
    } finally {
      btnSubmitRuling.disabled = false;
      btnSubmitRuling.textContent = "Submit Determination";
    }
  });
}