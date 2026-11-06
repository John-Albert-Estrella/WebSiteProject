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
  onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const CLOUDINARY_CLOUD_NAME = "dzx0v4g5n";
const CLOUDINARY_UPLOAD_PRESET = "aimser_uploads";

const urlParams = new URLSearchParams(window.location.search);
const currentClassCode = urlParams.get("code");

// Header DOM
const roomName = document.getElementById("room-name");
const roomDetails = document.getElementById("room-details");
const roomCodeTag = document.getElementById("room-code-tag");
const sidebarHomeLink = document.getElementById("sidebar-home-link");
const sidebarRoleTag = document.getElementById("sidebar-role-tag");
const linkExitHub = document.getElementById("link-exit-hub");

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

const modalStudentSubmit = document.getElementById("modal-student-submit");
const formStudentSubmit = document.getElementById("form-student-submit");
const submitCaseId = document.getElementById("student-submit-case-id");
const submitCaseTitle = document.getElementById("student-submit-case-title");
const submitModalTitle = document.getElementById("submit-modal-title");
const inpDeliverableFile = document.getElementById("inp-deliverable-file");
const inpDeliverableNotes = document.getElementById("inp-deliverable-notes");
const btnSubmitDeliverable = document.getElementById("btn-submit-deliverable");

// Recruitment Sandbox DOM
const jobOrdersContainer = document.getElementById("job-orders-container");
const candidateSandbox = document.getElementById("candidate-sandbox-container");
const selectedJobHeader = document.getElementById("selected-job-header");
const modalScreenCandidate = document.getElementById("modal-screen-candidate");
const formScreenCandidate = document.getElementById("form-screen-candidate");
const screenCandidateName = document.getElementById("screen-candidate-name");
const screenDecisionLabel = document.getElementById("screen-decision-label");
const screenCandidateDecision = document.getElementById("screen-candidate-decision");
const screenJustification = document.getElementById("screen-justification");
const btnOpenJob = document.getElementById("btn-open-job-modal");
const modalCreateJob = document.getElementById("modal-create-job");
const formCreateJob = document.getElementById("form-create-job");

// Performance KPI DOM
const btnOpenKPI = document.getElementById("btn-open-kpi-modal");
const modalCreateKPI = document.getElementById("modal-create-kpi");
const formCreateKPI = document.getElementById("form-create-kpi");
const kpiCyclesTbody = document.getElementById("kpi-cycles-tbody");

// Relations DOM
const btnOpenGrievance = document.getElementById("btn-open-grievance-modal");
const modalCreateGrievance = document.getElementById("modal-create-grievance");
const formCreateGrievance = document.getElementById("form-create-grievance");
const grievancesTbody = document.getElementById("grievances-tbody");

const modalResolveGrievance = document.getElementById("modal-resolve-grievance");
const formResolveGrievance = document.getElementById("form-resolve-grievance");
const resolveGrvRef = document.getElementById("resolve-grv-ref");
const resolveGrvFacts = document.getElementById("resolve-grv-facts");
const resolveGrvId = document.getElementById("resolve-grv-id");
const grvRulingSelect = document.getElementById("grv-ruling-select");
const grvRationaleInp = document.getElementById("grv-rationale-inp");
const btnSubmitRuling = document.getElementById("btn-submit-ruling");

// Calendar DOM
const calMonthTitle = document.getElementById("cal-month-title");
const canvasMonthBody = document.getElementById("canvas-month-body");
const miniCalTitle = document.getElementById("mini-cal-title");
const miniCalBody = document.getElementById("mini-cal-body");
const btnCalToday = document.getElementById("btn-cal-today");
const btnCalPrev = document.getElementById("btn-cal-prev");
const btnCalNext = document.getElementById("btn-cal-next");
const calViewMonth = document.getElementById("cal-view-month");
const calViewAgenda = document.getElementById("cal-view-agenda");

// Roster DOM
const roomRosterTbody = document.getElementById("room-roster-tbody");
const pendingTbody = document.getElementById("pending-tbody");
const pendingBadgeCount = document.getElementById("pending-badge-count");
const facultyPendingSection = document.getElementById("faculty-pending-section");

let currentUser = null;
let currentRole = "student";
let activeClassDocId = null;
let activeClassData = null;

let calendarDate = new Date();
let currentCalendarView = "month";
let cachedCalendarItems = [];

// =========================================================================
// 1. THE 4 ENTERPRISE PILLARS NAVIGATION CONTROLLER
// =========================================================================
document.querySelectorAll(".pillar-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".pillar-tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".pillar-viewport-panel").forEach(p => p.classList.remove("active"));

    btn.classList.add("active");
    const pillarId = btn.dataset.pillar;
    const targetPanel = document.getElementById(pillarId);
    if (targetPanel) targetPanel.classList.add("active");

    if (pillarId === "pillar-schedule") {
      if (currentCalendarView === "agenda") renderCanvasAgenda();
      else renderCanvasCalendar();
    }
  });
});

// Sub-Pillars for Sandboxes
document.querySelectorAll(".sandbox-pill-btn").forEach((pill) => {
  pill.addEventListener("click", () => {
    document.querySelectorAll(".sandbox-pill-btn").forEach(p => p.classList.remove("active"));
    document.querySelectorAll(".sandbox-subpanel").forEach(sp => sp.classList.remove("active"));

    pill.classList.add("active");
    const subId = pill.dataset.sub;
    const targetSub = document.getElementById(subId);
    if (targetSub) targetSub.classList.add("active");
  });
});

// Modal close button handlers
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

    // Role-dependent routing
    const targetHome = (role === "faculty" || role === "admin") ? "faculty-dashboard.html" : "student-dashboard.html";
    if (sidebarHomeLink) {
      sidebarHomeLink.href = targetHome;
      sidebarHomeLink.innerHTML = (role === "faculty" || role === "admin") ? "📊 Faculty Dashboard" : "📊 My Classrooms";
    }
    if (linkExitHub) {
      linkExitHub.href = targetHome;
      linkExitHub.textContent = (role === "faculty" || role === "admin") ? "← Exit to Faculty Dashboard" : "← Exit to My Classrooms";
    }
    if (sidebarRoleTag) sidebarRoleTag.textContent = role.toUpperCase();

    const calUser = document.getElementById("cal-filter-user");
    const calClass = document.getElementById("cal-filter-class");
    if (calUser) calUser.textContent = `${userData.lastName || ""}, ${userData.firstName || user.email}`;
    if (calClass) calClass.textContent = currentClassCode;

    if (role === "faculty" || role === "admin") {
      document.querySelectorAll(".faculty-only-control").forEach(el => el.style.display = "inline-flex");
      if (facultyPendingSection) facultyPendingSection.style.display = "block";
    }

    await loadClassroomDetails();
    initCanvasCalendar();
    initClassFeed();
    initClassPlanner();
    initClassCasesAndSubmissions();
    initRecruitmentSandbox();
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
// 4. PILLAR 1: CANVAS CALENDAR & AGENDA ENGINE
// =========================================================================
function initCanvasCalendar() {
  btnCalToday?.addEventListener("click", () => {
    calendarDate = new Date();
    if (currentCalendarView === "agenda") renderCanvasAgenda();
    else renderCanvasCalendar();
  });

  btnCalPrev?.addEventListener("click", () => {
    calendarDate.setMonth(calendarDate.getMonth() - 1);
    if (currentCalendarView === "agenda") renderCanvasAgenda();
    else renderCanvasCalendar();
  });

  btnCalNext?.addEventListener("click", () => {
    calendarDate.setMonth(calendarDate.getMonth() + 1);
    if (currentCalendarView === "agenda") renderCanvasAgenda();
    else renderCanvasCalendar();
  });

  setupCalendarViewToggles();

  const tasksQ = query(collection(db, "tasks"), where("classroomCode", "==", currentClassCode));
  const casesQ = query(collection(db, "cases"), where("classroomCode", "==", currentClassCode));

  onSnapshot(tasksQ, (tSnap) => {
    const tasks = tSnap.docs.map(d => ({ ...d.data(), id: d.id, type: "task" }));
    onSnapshot(casesQ, (cSnap) => {
      const cases = cSnap.docs.map(d => ({ ...d.data(), id: d.id, type: "case" }));
      cachedCalendarItems = [...tasks, ...cases];

      if (currentCalendarView === "agenda") {
        renderCanvasAgenda();
      } else {
        renderCanvasCalendar();
      }
    });
  });
}

function setupCalendarViewToggles() {
  document.querySelectorAll(".calendar-view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".calendar-view-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      currentCalendarView = btn.dataset.view;

      if (currentCalendarView === "agenda") {
        if (calViewMonth) calViewMonth.style.display = "none";
        if (calViewAgenda) calViewAgenda.style.display = "flex";
        renderCanvasAgenda();
      } else {
        if (calViewAgenda) calViewAgenda.style.display = "none";
        if (calViewMonth) calViewMonth.style.display = "block";
        renderCanvasCalendar();
      }
    });
  });
}

function renderCanvasCalendar() {
  if (!canvasMonthBody) return;

  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const monthName = calendarDate.toLocaleString("default", { month: "long" });

  if (calMonthTitle) calMonthTitle.textContent = `${monthName} ${year}`;
  if (miniCalTitle) miniCalTitle.textContent = `${monthName} ${year}`;

  canvasMonthBody.innerHTML = `
    <div class="canvas-day-header">Sun</div>
    <div class="canvas-day-header">Mon</div>
    <div class="canvas-day-header">Tue</div>
    <div class="canvas-day-header">Wed</div>
    <div class="canvas-day-header">Thu</div>
    <div class="canvas-day-header">Fri</div>
    <div class="canvas-day-header">Sat</div>
  `;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDaysInMonth = new Date(year, month, 0).getDate();
  const now = new Date();

  for (let i = firstDay - 1; i >= 0; i--) {
    const day = prevDaysInMonth - i;
    const cell = document.createElement("div");
    cell.className = "canvas-cell other-month";
    cell.innerHTML = `<span class="canvas-cell-number">${day}</span>`;
    canvasMonthBody.appendChild(cell);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement("div");
    const isToday = now.getFullYear() === year && now.getMonth() === month && now.getDate() === d;
    cell.className = `canvas-cell ${isToday ? "today-cell" : ""}`;
    cell.innerHTML = `<span class="canvas-cell-number">${d}</span>`;

    const monthStr = String(month + 1).padStart(2, "0");
    const dayStr = String(d).padStart(2, "0");
    const dateStr = `${year}-${monthStr}-${dayStr}`;

    const dayItems = cachedCalendarItems.filter(item => {
      return item.dueDate === dateStr || (item.createdAt?.toDate && item.createdAt.toDate().toISOString().startsWith(dateStr));
    });

    dayItems.forEach(item => {
      const ev = document.createElement("div");
      const isPast = new Date(dateStr) < new Date(now.setHours(0,0,0,0));
      ev.className = `canvas-event-item ${isPast ? "event-overdue" : ""}`;
      ev.textContent = `• ${item.title}`;
      cell.appendChild(ev);
    });

    canvasMonthBody.appendChild(cell);
  }

  renderMiniCalendar(year, month, now);
}

function renderMiniCalendar(year, month, now) {
  if (!miniCalBody) return;
  miniCalBody.innerHTML = "";

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement("div");
    miniCalBody.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement("div");
    const isToday = now.getFullYear() === year && now.getMonth() === month && now.getDate() === d;
    cell.className = `mini-day-cell ${isToday ? "today-circle" : ""}`;
    cell.textContent = d;
    miniCalBody.appendChild(cell);
  }
}

function renderCanvasAgenda() {
  if (!calViewAgenda) return;
  calViewAgenda.innerHTML = "";

  if (cachedCalendarItems.length === 0) {
    calViewAgenda.innerHTML = `<div class="card agenda-empty-state"><p>No deliverables or tasks scheduled for this classroom.</p></div>`;
    return;
  }

  const normalized = cachedCalendarItems.map((item) => {
    let dateStr = item.dueDate || "";
    if (!dateStr && item.createdAt?.toDate) {
      dateStr = item.createdAt.toDate().toISOString().split("T")[0];
    }
    return { ...item, normalizedDate: dateStr || "No Date" };
  });

  normalized.sort((a, b) => {
    if (a.normalizedDate === "No Date") return 1;
    if (b.normalizedDate === "No Date") return -1;
    return new Date(a.normalizedDate) - new Date(b.normalizedDate);
  });

  const grouped = {};
  normalized.forEach((item) => {
    if (!grouped[item.normalizedDate]) grouped[item.normalizedDate] = [];
    grouped[item.normalizedDate].push(item);
  });

  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];

  Object.keys(grouped).forEach((dateKey) => {
    const items = grouped[dateKey];
    const groupCard = document.createElement("div");
    groupCard.className = "agenda-date-group";

    let dateTitle = "Unscheduled";
    let isToday = false;

    if (dateKey !== "No Date") {
      const parsedDate = new Date(dateKey + "T00:00:00");
      isToday = dateKey === todayStr;
      dateTitle = parsedDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });
    }

    groupCard.innerHTML = `
      <div class="agenda-date-header">
        <div class="agenda-date-title">
          <span>${dateTitle}</span>
          ${isToday ? `<span class="today-tag">TODAY</span>` : ""}
        </div>
        <span style="font-size: 11px; color: var(--text-tertiary); font-weight: 600;">
          ${items.length} ${items.length === 1 ? "Item" : "Items"}
        </span>
      </div>
      <div class="agenda-items-list" id="agenda-list-${dateKey}"></div>
    `;

    const listContainer = groupCard.querySelector(`#agenda-list-${dateKey}`);

    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "agenda-row-item";
      const isCase = item.type === "case";
      const isPast = dateKey !== "No Date" && new Date(dateKey) < new Date(todayStr);

      let statusBadge = "";
      if (item.status === "done" || item.status === "evaluated") {
        statusBadge = `<span class="status-badge active">✓ Completed</span>`;
      } else if (isPast) {
        statusBadge = `<span class="badge-overdue">🔴 Overdue</span>`;
      } else if (isToday) {
        statusBadge = `<span class="badge-due-soon">🟡 Due Today</span>`;
      } else {
        statusBadge = `<span class="status-badge">${item.status || "Assigned"}</span>`;
      }

      row.innerHTML = `
        <div class="agenda-time-col">11:59 PM</div>
        <div class="agenda-content-col">
          <div class="agenda-item-title">
            <span class="${isCase ? "agenda-badge-case" : "agenda-badge-task"}">${isCase ? "CASE BRIEF" : "PLANNER TASK"}</span>
            <span>${item.title}</span>
          </div>
          <div class="agenda-item-desc">${item.category || item.description || "Class deliverable."}</div>
        </div>
        <div class="agenda-status-col">${statusBadge}</div>
      `;

      row.addEventListener("click", () => {
        document.querySelector('[data-pillar="pillar-cases"]')?.click();
      });

      listContainer.appendChild(row);
    });

    calViewAgenda.appendChild(groupCard);
  });
}

// =========================================================================
// 5. PILLAR 1: DISCUSSION FEED (WITH CLIENT-SIDE SORTING)
// =========================================================================
function initClassFeed() {
  const q = query(collection(db, "posts"), where("classroomCode", "==", currentClassCode));

  onSnapshot(q, (snapshot) => {
    if (!postsContainer) return;
    postsContainer.innerHTML = "";

    if (snapshot.empty) {
      postsContainer.innerHTML = `<div class="empty-state"><p>No discussions posted yet.</p></div>`;
      return;
    }

    const posts = [];
    snapshot.forEach(d => posts.push({ id: d.id, ...d.data() }));

    posts.sort((a, b) => {
      const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
      const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
      return timeB - timeA;
    });

    posts.forEach((p) => {
      const card = document.createElement("div");
      card.className = "card";
      card.style.marginBottom = "14px";

      let timeDisplay = "Just now";
      if (p.createdAt?.toDate) {
        timeDisplay = p.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else if (p.createdAt) {
        timeDisplay = new Date(p.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }

      card.innerHTML = `
        <div class="card-header" style="margin-bottom: 8px;">
          <strong style="color: var(--accent); font-size: 13.5px;">${p.authorName || p.authorEmail}</strong>
          <span style="font-size: 11px; color: var(--text-tertiary);">${timeDisplay}</span>
        </div>
        <p style="font-size: 13.5px; line-height: 1.5; color: var(--text-primary); margin: 0;">${p.body || ""}</p>
        
        <div class="comments-container">
          <div class="comments-list" id="comments-list-${p.id}"></div>
          <form class="comment-input-row" data-postid="${p.id}">
            <input type="text" placeholder="Write a reply or counter-argument..." required>
            <button type="submit" class="btn btn-secondary" style="padding: 4px 10px; font-size: 11.5px;">Reply</button>
          </form>
        </div>
      `;

      const commentsQ = query(collection(db, "posts", p.id, "comments"));
      onSnapshot(commentsQ, (cSnap) => {
        const cList = card.querySelector(`#comments-list-${p.id}`);
        if (!cList) return;
        cList.innerHTML = "";

        const comments = [];
        cSnap.forEach(cd => comments.push({ id: cd.id, ...cd.data() }));

        comments.sort((a, b) => {
          const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
          const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
          return tA - tB;
        });

        comments.forEach((c) => {
          const bubble = document.createElement("div");
          bubble.className = "comment-bubble";
          bubble.innerHTML = `
            <div class="comment-header">
              <strong>${c.authorName}</strong>
              <span>${c.createdAt?.toDate ? c.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Just now"}</span>
            </div>
            <div>${c.text}</div>
          `;
          cList.appendChild(bubble);
        });
      });

      card.querySelector(".comment-input-row")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const input = e.target.querySelector("input");
        const text = input.value.trim();
        if (!text) return;

        await addDoc(collection(db, "posts", p.id, "comments"), {
          text,
          authorUid: currentUser.uid,
          authorName: currentUser.displayName || currentUser.email,
          createdAt: serverTimestamp()
        });
        input.value = "";
      });

      postsContainer.appendChild(card);
    });
  });

  formPost?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = inputPostBody.value.trim();
    if (!body) return;

    await addDoc(collection(db, "posts"), {
      body,
      classroomCode: currentClassCode,
      authorUid: currentUser.uid,
      authorEmail: currentUser.email,
      authorName: `${currentUser.displayName || currentUser.email}`,
      createdAt: serverTimestamp()
    });
    formPost.reset();
  });
}

// =========================================================================
// 6. PILLAR 2: TASKS & CASES (WITH COUNTDOWN WARNINGS)
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
    todoEl.innerHTML = ""; progEl.innerHTML = ""; doneEl.innerHTML = "";
    let cTodo = 0, cProg = 0, cDone = 0;
    const now = new Date().getTime();

    snapshot.forEach((docSnap) => {
      const t = docSnap.data();
      const card = document.createElement("div");
      card.className = "kanban-task-card";

      let deadlineBadge = "";
      if (t.dueDate) {
        const dueTime = new Date(t.dueDate).getTime();
        const hoursRemaining = (dueTime - now) / (1000 * 60 * 60);

        if (hoursRemaining < 0) {
          deadlineBadge = `<span class="badge-overdue">🔴 Overdue</span>`;
        } else if (hoursRemaining <= 48) {
          deadlineBadge = `<span class="badge-due-soon">🟡 Due Soon (${Math.round(hoursRemaining)}h)</span>`;
        } else {
          deadlineBadge = `<span style="font-size: 10px; color: var(--text-tertiary);">Due: ${t.dueDate}</span>`;
        }
      }

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
          <h4 class="kanban-task-title">${t.title || "Untitled Task"}</h4>
          ${deadlineBadge}
        </div>
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

      if (t.status === "in_progress") { progEl.appendChild(card); cProg++; }
      else if (t.status === "done") { doneEl.appendChild(card); cDone++; }
      else { todoEl.appendChild(card); cTodo++; }
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
  });
}

function initClassCasesAndSubmissions() {
  btnOpenCreateCase?.addEventListener("click", () => {
    if (modalCreateCase) modalCreateCase.style.display = "flex";
  });

  formCreateCase?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("case-title")?.value.trim();
    const category = document.getElementById("case-category")?.value;
    const dueDate = document.getElementById("case-due-date")?.value;
    const scenario = document.getElementById("case-scenario")?.value.trim();

    if (!title || !scenario) return;

    await addDoc(collection(db, "cases"), {
      title,
      category,
      dueDate: dueDate || null,
      scenario,
      classroomCode: currentClassCode,
      facultyUid: currentUser.uid,
      createdAt: serverTimestamp()
    });

    formCreateCase.reset();
    if (modalCreateCase) modalCreateCase.style.display = "none";
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
            <p class="card-subtitle">${c.category || "General HR"} ${c.dueDate ? `• Deadline: ${c.dueDate}` : ""}</p>
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

      const data = await res.json();
      const fileUrl = data.secure_url || URL.createObjectURL(file);

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

      alert("Deliverable successfully submitted!");
      formStudentSubmit.reset();
      if (modalStudentSubmit) modalStudentSubmit.style.display = "none";
    } catch (err) {
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
      submissionsTbody.innerHTML = `<tr><td colspan="6" class="empty-state">No submissions uploaded yet.</td></tr>`;
      return;
    }

    snapshot.forEach((docSnap) => {
      const s = docSnap.data();
      const tr = document.createElement("tr");
      const isGraded = s.status === "evaluated";

      tr.innerHTML = `
        <td><strong>${s.studentName || s.studentEmail}</strong></td>
        <td>${s.caseTitle}</td>
        <td><a href="${s.fileUrl}" target="_blank" class="auth-link">🔗 View File</a></td>
        <td>${s.createdAt?.toDate ? s.createdAt.toDate().toLocaleDateString() : "Recently"}</td>
        <td><span class="status-badge ${isGraded ? "active" : ""}">${isGraded ? `${s.score}/100` : "Pending"}</span></td>
        <td>
          ${(currentRole === "faculty" || currentRole === "admin") ? `
            <button type="button" class="btn btn-secondary btn-open-grade" style="padding: 2px 8px; font-size: 11px;">
              ${isGraded ? "Re-evaluate" : "Score"}
            </button>
          ` : `<span style="font-size: 11.5px; color: var(--text-tertiary);">${isGraded ? "Graded" : "Submitted"}</span>`}
        </td>
      `;

      tr.querySelector(".btn-open-grade")?.addEventListener("click", () => {
        if (gradeSubId) gradeSubId.value = docSnap.id;
        if (gradeStudentUid) gradeStudentUid.value = s.studentUid;
        if (gradeStudentName) gradeStudentName.textContent = `${s.studentName} — ${s.caseTitle}`;
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
        link: `portfolio.html?code=${currentClassCode}`,
        read: false,
        createdAt: serverTimestamp()
      });
    }

    alert("Evaluation published!");
    if (modalGrade) modalGrade.style.display = "none";
  });
}

// =========================================================================
// 7. PILLAR 3: HR SANDBOXES (RECRUITMENT, KPI, RELATIONS)
// =========================================================================
const MOCK_CANDIDATES = [
  { name: "Alyssa Reyes", gpa: "3.85 GPA", exp: "2 Yrs HR Intern", skills: "Talent Sourcing, Workday, Behavioral Interviews" },
  { name: "Marcus Chen", gpa: "3.40 GPA", exp: "1 Yr Recruitment Associate", skills: "LinkedIn Recruiter, Full-Lifecycle Hiring" },
  { name: "Danielle Santos", gpa: "3.10 GPA", exp: "Career Switcher / Admin", skills: "Onboarding Logistics, Documentation" }
];

function initRecruitmentSandbox() {
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

    await addDoc(collection(db, "job_orders"), {
      title,
      department,
      openings: openings || 1,
      description,
      classroomCode: currentClassCode,
      createdAt: serverTimestamp()
    });

    formCreateJob.reset();
    if (modalCreateJob) modalCreateJob.style.display = "none";
  });

  const jobQ = query(collection(db, "job_orders"), where("classroomCode", "==", currentClassCode));
  onSnapshot(jobQ, (snapshot) => {
    if (!jobOrdersContainer) return;
    jobOrdersContainer.innerHTML = "";

    if (snapshot.empty) {
      jobOrdersContainer.innerHTML = `<div class="empty-state"><p>No requisitions posted yet.</p></div>`;
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
          <button type="button" class="btn btn-primary btn-load-sandbox" style="font-size: 11.5px; padding: 4px 10px;">
            🔍 Screen Candidates
          </button>
        </div>
      `;

      card.querySelector(".btn-load-sandbox")?.addEventListener("click", () => {
        loadCandidatePool(j.title);
      });

      jobOrdersContainer.appendChild(card);
    });
  });
}

function loadCandidatePool(jobTitle) {
  if (!candidateSandbox) return;
  if (selectedJobHeader) selectedJobHeader.textContent = `Active Screening: ${jobTitle}`;

  candidateSandbox.innerHTML = `<div class="candidate-grid" id="cand-grid"></div>`;
  const grid = candidateSandbox.querySelector("#cand-grid");

  MOCK_CANDIDATES.forEach(c => {
    const cCard = document.createElement("div");
    cCard.className = "candidate-card";
    cCard.innerHTML = `
      <div>
        <h4 style="font-size: 13px; font-weight: 700; color: var(--text-primary);">${c.name}</h4>
        <div class="candidate-stats">
          <div>🎓 <strong>Academic:</strong> ${c.gpa}</div>
          <div>💼 <strong>Experience:</strong> ${c.exp}</div>
          <div>🛠️ <strong>Key Competencies:</strong> ${c.skills}</div>
        </div>
      </div>
      <div class="candidate-actions">
        <button type="button" class="btn btn-primary btn-advance" style="background: #10b981;">Advance</button>
        <button type="button" class="btn btn-secondary btn-hold" style="background: #eab308; color: #000;">Hold</button>
        <button type="button" class="btn btn-secondary danger-action btn-reject">Reject</button>
      </div>
    `;

    cCard.querySelector(".btn-advance")?.addEventListener("click", () => triggerScreenModal(c.name, "Advance to Interview"));
    cCard.querySelector(".btn-hold")?.addEventListener("click", () => triggerScreenModal(c.name, "Place on Hold"));
    cCard.querySelector(".btn-reject")?.addEventListener("click", () => triggerScreenModal(c.name, "Reject Candidate"));

    grid.appendChild(cCard);
  });
}

function triggerScreenModal(candidateName, decision) {
  if (screenCandidateName) screenCandidateName.textContent = `Candidate: ${candidateName}`;
  if (screenDecisionLabel) screenDecisionLabel.textContent = `Action: ${decision}`;
  if (screenCandidateDecision) screenCandidateDecision.value = decision;
  if (modalScreenCandidate) modalScreenCandidate.style.display = "flex";
}

formScreenCandidate?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const decision = screenCandidateDecision.value;
  const rationale = screenJustification.value.trim();

  await addDoc(collection(db, "screening_evaluations"), {
    classroomCode: currentClassCode,
    studentUid: currentUser.uid,
    decision,
    rationale,
    submittedAt: serverTimestamp()
  });

  alert("Candidate screening determination logged successfully!");
  formScreenCandidate.reset();
  if (modalScreenCandidate) modalScreenCandidate.style.display = "none";
});

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

    formCreateKPI.reset();
    if (modalCreateKPI) modalCreateKPI.style.display = "none";
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

    formCreateGrievance.reset();
    if (modalCreateGrievance) modalCreateGrievance.style.display = "none";
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
          alert(`Official Determination for ${g.ref}:\n\nRuling: ${g.ruling}\n\nRationale:\n${g.rationale || "None logged."}`);
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

      alert("Arbitration determination successfully filed!");
      formResolveGrievance.reset();
      if (modalResolveGrievance) modalResolveGrievance.style.display = "none";
    } catch (err) {
      alert("Failed to submit ruling: " + err.message);
    } finally {
      btnSubmitRuling.disabled = false;
      btnSubmitRuling.textContent = "Submit Determination";
    }
  });
}

// =========================================================================
// 8. PILLAR 4: ROSTER & REQUESTS
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
    pendingTbody.innerHTML = `<tr><td colspan="4" class="empty-state">No pending requests.</td></tr>`;
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