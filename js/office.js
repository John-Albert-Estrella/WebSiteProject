import { auth, db } from "./firebase-init.js";
import { initAuthGuard } from "./auth-guard.js";
import { uploadToCloudinary } from "./cloudinary-config.js";
import { 
  collection, query, where, getDocs, addDoc, doc, updateDoc, 
  arrayUnion, serverTimestamp, onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
let activeClassCode = urlParams.get("code") || localStorage.getItem("aimser_active_office_code");

let currentUser = null;
let currentRole = "student";
let activeClassDocId = null;
let activeClassData = null;

// DOM
const gatewayCard = document.getElementById("office-gateway-card");
const workspace = document.getElementById("office-workspace");
const formJoinOffice = document.getElementById("form-join-office");
const inpOfficeCode = document.getElementById("inp-office-code");
const btnOpenCreateOffice = document.getElementById("btn-open-create-office");
const modalCreateOffice = document.getElementById("modal-create-office");
const formCreateOfficeRoom = document.getElementById("form-create-office-room");

const officeClassName = document.getElementById("office-class-name");
const officeClassMeta = document.getElementById("office-class-meta");
const officeActiveCode = document.getElementById("office-active-code");
const btnSwitchOffice = document.getElementById("btn-switch-office");

const btnPostActivity = document.getElementById("btn-post-office-activity");
const modalCreateActivity = document.getElementById("modal-create-activity");
const formCreateActivity = document.getElementById("form-create-activity");
const activitiesGrid = document.getElementById("office-activities-grid");
const submissionsTbody = document.getElementById("office-submissions-tbody");

// Sub-Tab Switcher
document.querySelectorAll(".module-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".module-tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".module-tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    const target = document.getElementById(btn.dataset.tab);
    if (target) target.classList.add("active");
  });
});

document.querySelectorAll(".close-modal-btn").forEach(b => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".modal-backdrop-custom").forEach(m => m.style.display = "none");
  });
});

initAuthGuard({
  allowedRoles: ["student", "faculty", "admin"],
  onReady: async ({ user, userData, role }) => {
    currentUser = user;
    currentRole = role;

    const topbarRole = document.getElementById("topbar-role-badge");
    const topbarName = document.getElementById("topbar-user-name");
    const sidebarRole = document.getElementById("sidebar-role-tag");
    const sidebarName = document.getElementById("sidebar-greeting-name");

    const displayName = `${userData.firstName || ""} ${userData.lastName || ""}`.trim() || user.email;
    if (topbarName) topbarName.textContent = displayName;
    if (sidebarName) sidebarName.textContent = displayName;
    if (topbarRole) {
      topbarRole.className = `role-badge ${role}`;
      topbarRole.textContent = role.toUpperCase();
    }
    if (sidebarRole) sidebarRole.textContent = role.toUpperCase();

    if (role === "faculty" || role === "admin") {
      document.querySelectorAll(".faculty-only-control").forEach(el => el.style.display = "inline-flex");
    } else {
      document.querySelectorAll(".student-only-control").forEach(el => el.style.display = "inline-flex");
    }

    if (activeClassCode) {
      await loadClassroom(activeClassCode);
    }
  }
});

// Join Room
formJoinOffice?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = inpOfficeCode.value.trim().toUpperCase();
  if (!code) return;
  await loadClassroom(code);
});

// Switch Room
btnSwitchOffice?.addEventListener("click", () => {
  localStorage.removeItem("aimser_active_office_code");
  activeClassCode = null;
  gatewayCard.style.display = "block";
  workspace.style.display = "none";
});

// Create Room (Faculty) with 100 student cap
btnOpenCreateOffice?.addEventListener("click", () => {
  if (modalCreateOffice) modalCreateOffice.style.display = "flex";
});

formCreateOfficeRoom?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("inp-new-room-name").value.trim();
  const section = document.getElementById("inp-new-room-section").value.trim();
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const code = `AIM-${randomSuffix}`;

  await addDoc(collection(db, "classrooms"), {
    name,
    section,
    code,
    facultyUid: currentUser.uid,
    facultyEmail: currentUser.email,
    students: [],
    maxCapacity: 100,
    createdAt: serverTimestamp()
  });

  alert(`Room created! Join code: ${code}`);
  modalCreateOffice.style.display = "none";
  await loadClassroom(code);
});

async function loadClassroom(code) {
  const q = query(collection(db, "classrooms"), where("code", "==", code));
  const snap = await getDocs(q);

  if (snap.empty) {
    alert("Classroom not found.");
    return;
  }

  const cDoc = snap.docs[0];
  activeClassDocId = cDoc.id;
  activeClassData = cDoc.data();
  activeClassCode = code;
  localStorage.setItem("aimser_active_office_code", code);

  const studentList = activeClassData.students || [];
  if (currentRole === "student" && !studentList.some(s => s.uid === currentUser.uid)) {
    if (studentList.length >= 100) {
      alert("This classroom has reached its maximum capacity of 100 students.");
      return;
    }
    await updateDoc(doc(db, "classrooms", activeClassDocId), { 
      students: arrayUnion({
        uid: currentUser.uid,
        email: currentUser.email,
        joinedAt: new Date().toISOString()
      }) 
    });
    studentList.push({ uid: currentUser.uid, email: currentUser.email });
  }

  gatewayCard.style.display = "none";
  workspace.style.display = "block";

  if (officeClassName) officeClassName.textContent = activeClassData.name;
  if (officeClassMeta) officeClassMeta.textContent = `${activeClassData.section} • Instructor: ${activeClassData.facultyEmail}`;
  if (officeActiveCode) officeActiveCode.textContent = code;

  const countEl = document.getElementById("metric-enrollment-count");
  if (countEl) countEl.textContent = `${studentList.length} / 100 students`;

  initActivitiesStream();
  initSubmissionsStream();
  if (currentRole === "faculty" || currentRole === "admin") {
    initFacultyTeamBoardsWatcher();
  }
}

// Activities
btnPostActivity?.addEventListener("click", () => {
  if (modalCreateActivity) modalCreateActivity.style.display = "flex";
});

formCreateActivity?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("inp-act-title").value.trim();
  const dueDate = document.getElementById("inp-act-due").value;
  const description = document.getElementById("inp-act-desc").value.trim();

  await addDoc(collection(db, "office_activities"), {
    title,
    dueDate,
    description,
    classroomCode: activeClassCode,
    facultyUid: currentUser.uid,
    createdAt: serverTimestamp()
  });

  formCreateActivity.reset();
  modalCreateActivity.style.display = "none";
});

function initActivitiesStream() {
  const q = query(collection(db, "office_activities"), where("classroomCode", "==", activeClassCode));
  onSnapshot(q, (snap) => {
    if (!activitiesGrid) return;
    activitiesGrid.innerHTML = "";
    if (snap.empty) {
      activitiesGrid.innerHTML = `<div class="empty-state"><p>No assignments posted yet.</p></div>`;
      return;
    }
    snap.forEach((d) => {
      const a = d.data();
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card-header">
          <h4 class="card-title">${a.title}</h4>
          <span class="status-badge">Due: ${a.dueDate || "N/A"}</span>
        </div>
        <p style="font-size: 13px; color: var(--text-secondary); margin: 8px 0;">${a.description}</p>
        <div class="card-actions">
          ${currentRole === "student" ? `
            <input type="file" id="file-${d.id}" class="form-control" style="font-size: 11px;">
            <button type="button" class="btn btn-primary btn-submit-work" data-id="${d.id}" data-title="${a.title}">Submit Work</button>
          ` : `<span style="font-size: 11px; color: var(--text-tertiary);">Track submissions below</span>`}
        </div>
      `;

      card.querySelector(".btn-submit-work")?.addEventListener("click", async () => {
        const fileInput = card.querySelector(`#file-${d.id}`);
        const file = fileInput?.files[0];
        if (!file) {
          alert("Please select a file to submit.");
          return;
        }

        try {
          const fileUrl = await uploadToCloudinary(file);
          await addDoc(collection(db, "office_submissions"), {
            activityId: d.id,
            activityTitle: a.title,
            studentUid: currentUser.uid,
            studentEmail: currentUser.email,
            fileUrl,
            score: null,
            classroomCode: activeClassCode,
            createdAt: serverTimestamp()
          });
          alert("Assignment submitted successfully!");
        } catch (err) {
          alert("Upload failed: " + err.message);
        }
      });

      activitiesGrid.appendChild(card);
    });
  });
}

function initSubmissionsStream() {
  const q = query(collection(db, "office_submissions"), where("classroomCode", "==", activeClassCode));
  onSnapshot(q, (snap) => {
    if (!submissionsTbody) return;
    submissionsTbody.innerHTML = "";
    if (snap.empty) {
      submissionsTbody.innerHTML = `<tr><td colspan="6" class="empty-state">No submissions yet.</td></tr>`;
      return;
    }

    snap.forEach((d) => {
      const s = d.data();
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${s.studentEmail}</strong></td>
        <td>${s.activityTitle}</td>
        <td><a href="${s.fileUrl}" target="_blank" class="auth-link">View Asset</a></td>
        <td>${s.createdAt?.toDate ? s.createdAt.toDate().toLocaleDateString() : "Recently"}</td>
        <td>${s.score !== null ? `<span class="status-badge active">${s.score}/100</span>` : "Pending"}</td>
        <td>
          ${currentRole === "faculty" ? `
            <button type="button" class="btn btn-secondary btn-grade" style="padding: 2px 8px; font-size: 11px;">Grade</button>
          ` : `<span style="font-size: 11px; color: var(--text-tertiary);">Recorded</span>`}
        </td>
      `;

      tr.querySelector(".btn-grade")?.addEventListener("click", async () => {
        const score = prompt("Enter score (0-100):");
        if (score !== null) {
          await updateDoc(doc(db, "office_submissions", d.id), { score: parseInt(score, 10) });
        }
      });

      submissionsTbody.appendChild(tr);
    });
  });
}

function initFacultyTeamBoardsWatcher() {
  const container = document.getElementById("faculty-teamboards-container");
  const q = query(collection(db, "planner_teams"), where("linkedOfficeCode", "==", activeClassCode));

  onSnapshot(q, (snap) => {
    if (!container) return;
    container.innerHTML = "";
    if (snap.empty) {
      container.innerHTML = `<div class="empty-state"><p>No student Trello teams have linked to this office class code yet.</p></div>`;
      return;
    }

    snap.forEach((tdoc) => {
      const t = tdoc.data();
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card-header">
          <h4 class="card-title">${t.teamName}</h4>
          <span class="status-badge active">TEAM CODE: ${t.teamCode}</span>
        </div>
        <p style="font-size: 12px; color: var(--text-secondary); margin: 6px 0;">Leader: ${t.leaderEmail} • Members: ${(t.members || []).length}/15</p>
        <div style="margin-top: 10px;">
          <a href="planner.html?team=${t.teamCode}" class="btn btn-primary" style="font-size: 11px; text-decoration: none;">
            🔍 Inspect Trello Board
          </a>
        </div>
      `;
      container.appendChild(card);
    });
  });
}