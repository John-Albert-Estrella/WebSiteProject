// js/office.js - Office Workspace (Dashboard, Analytics, Portfolio 6-Metrics, Locked Submissions, Deadlines & Notifications)
import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  arrayUnion,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { uploadToCloudinary } from "./cloudinary-config.js";
import { FastCache, escapeHtml, sanitizeUrl, checkRateLimit, logAuditEvent } from "./security-utils.js";

const MAX_CLASS_STUDENTS = 100;

let currentUser = null;
let userProfile = null;
let classrooms = [];
let activeClassroom = null;
let currentActivities = [];
let allSubmissionsMap = new Map();
let notificationsQueue = [];
let warningNotifications = [];
let currentPortfolioData = { goals: "", devPlan: "", selfFeedback: "", artifacts: [] };
let studentAbsenteeismRate = "0%";

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  currentUser = user;

  userProfile = FastCache.get("user_profile");
  if (!userProfile) {
    const snap = await getDoc(doc(db, "users", user.uid));
    const data = snap.exists() ? snap.data() : {};
    userProfile = {
      uid: user.uid,
      email: user.email,
      fullName: data.fullName || user.displayName || user.email.split("@")[0],
      role: (data.role || "student").toLowerCase(),
      department: data.department || "",
      avatarUrl: data.avatarUrl || user.photoURL || ""
    };
    FastCache.set("user_profile", userProfile);
  }

  configureRoleViews();
  bindOfficeEvents();

  await loadModerationWarningsIntoBell();

  const cachedRooms = FastCache.get("office_classrooms");
  if (cachedRooms && cachedRooms.length > 0) {
    classrooms = cachedRooms;
    await populateClassroomDropdown();
  }

  await loadUserClassrooms();
});

function renderRoleBadge(role) {
  const normalized = (role || "student").toLowerCase();
  const isFac = normalized === "faculty";
  const bg = isFac ? "rgba(56, 189, 248, 0.16)" : "rgba(16, 185, 129, 0.16)";
  const color = isFac ? "#38bdf8" : "#10b981";
  return `<span class="badge-pill" style="background:${bg};color:${color};border-color:transparent;">${escapeHtml(normalized.toUpperCase())}</span>`;
}

function configureRoleViews() {
  const isFaculty = userProfile.role === "faculty";

  const roomCodeCard = document.getElementById("card-room-code");
  if (roomCodeCard) {
    roomCodeCard.style.display = isFaculty ? "" : "none";
  }

  const actionLabel = document.getElementById("classroom-action-label");
  const newActBtn = document.getElementById("btn-open-new-activity");
  const exportBtn = document.getElementById("btn-export-report");
  const fourthLabel = document.getElementById("stat-fourth-label");

  if (actionLabel) actionLabel.textContent = isFaculty ? "Create Class Room" : "Join Class Room";
  if (newActBtn) newActBtn.style.display = isFaculty ? "inline-flex" : "none";
  if (exportBtn) exportBtn.style.display = isFaculty ? "inline-flex" : "none";
  if (fourthLabel) fourthLabel.textContent = isFaculty ? "Class Avg & Completion" : "Personal Avg Score";

  const facAnalytics = document.getElementById("faculty-analytics-view");
  const stuAnalytics = document.getElementById("student-analytics-view");
  const facPortfolio = document.getElementById("faculty-portfolio-view");
  const stuPortfolio = document.getElementById("student-portfolio-view");

  if (facAnalytics) facAnalytics.style.display = isFaculty ? "block" : "none";
  if (stuAnalytics) stuAnalytics.style.display = isFaculty ? "none" : "flex";
  if (facPortfolio) facPortfolio.style.display = isFaculty ? "block" : "none";
  if (stuPortfolio) stuPortfolio.style.display = isFaculty ? "none" : "flex";
}

async function loadModerationWarningsIntoBell() {
  if (!currentUser) return;
  try {
    const q = query(collection(db, "notifications"), where("recipientUid", "==", currentUser.uid));
    const snap = await getDocs(q);
    warningNotifications = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((n) => !n.read && n.type === "MODERATION_WARNING")
      .map((w) => ({
        id: w.id,
        type: "WARNING",
        title: w.title || "HR Feed Moderation Warning",
        detail: `${w.reason || "Comment moderated by administrator."}${w.postTitle ? ` (Post: "${w.postTitle}")` : ""}`
      }));
  } catch {
    warningNotifications = [];
  }
  renderNotificationsBell();
}

async function loadUserClassrooms() {
  try {
    const snap = await getDocs(collection(db, "classrooms"));
    const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (userProfile.role === "faculty") {
      classrooms = all.filter((c) => c.instructorId === currentUser.uid || c.instructorEmail === currentUser.email);
    } else {
      classrooms = all.filter((c) => {
        const students = c.students || c.enrolled || [];
        return students.some((s) =>
          typeof s === "string" ? s === currentUser.uid || s === currentUser.email : s.uid === currentUser.uid
        );
      });
    }

    FastCache.set("office_classrooms", classrooms);
    await populateClassroomDropdown();
  } catch (err) {
    console.error("Error loading classrooms:", err);
  }
}

async function populateClassroomDropdown() {
  const select = document.getElementById("active-classroom-select");
  if (!select) return;

  if (classrooms.length === 0) {
    select.innerHTML = `<option value="">No Active Classrooms</option>`;
    renderEmptyWorkspace();
    renderNotificationsBell();
    return;
  }

  const isFaculty = userProfile.role === "faculty";
  select.innerHTML = classrooms
    .map((c) => {
      const codeSuffix = isFaculty ? ` (${escapeHtml(c.sectionCode || c.code || "AIM")})` : "";
      return `<option value="${c.id}">${escapeHtml(c.name || "Classroom")}${codeSuffix}</option>`;
    })
    .join("");

  const savedId = localStorage.getItem("aimser_active_classroom");
  const target = classrooms.find((c) => c.id === savedId) || classrooms[0];
  select.value = target.id;
  await selectClassroom(target.id);
}

async function selectClassroom(classroomId) {
  activeClassroom = classrooms.find((c) => c.id === classroomId) || null;
  if (!activeClassroom) {
    renderEmptyWorkspace();
    return;
  }

  localStorage.setItem("aimser_active_classroom", classroomId);
  notificationsQueue = [];

  const code = activeClassroom.sectionCode || activeClassroom.code || "N/A";
  const students = activeClassroom.students || activeClassroom.enrolled || [];

  const codeEl = document.getElementById("stat-section-code");
  if (codeEl) codeEl.textContent = code;
  document.getElementById("stat-member-count").textContent = `${students.length} / ${MAX_CLASS_STUDENTS}`;
  document.getElementById("active-classroom-title").textContent = activeClassroom.name || "Classroom Activities";

  const periodText = activeClassroom.appraisalPeriod || "Not configured yet";
  const kpisText = activeClassroom.appraisalKpis || "Awaiting instructor KPI setup.";
  const elPeriod = document.getElementById("appraisal-period-text");
  const elKpis = document.getElementById("appraisal-kpis-text");
  const elStuKpi = document.getElementById("student-kpi-text");
  if (elPeriod) elPeriod.textContent = periodText;
  if (elKpis) elKpis.textContent = kpisText;
  if (elStuKpi) elStuKpi.textContent = `${periodText} — ${kpisText}`;

  if (userProfile.role === "student") {
    await loadStudentAnalyticsReport(classroomId);
  }

  await Promise.all([
    loadClassroomActivitiesAndSubmissions(classroomId, students),
    loadRosterAndRequests(classroomId, students),
    loadPortfolioData(classroomId, students),
    loadModerationWarningsIntoBell()
  ]);

  if (userProfile.role !== "faculty") {
    updateStudentPortfolioMetricsAndView();
  }

  renderNotificationsBell();
}

async function loadClassroomActivitiesAndSubmissions(classroomId, students) {
  const container = document.getElementById("activities-container");
  if (!container) return;

  const cachedActs = FastCache.get(`acts_${classroomId}`);
  if (cachedActs) {
    currentActivities = cachedActs;
    renderActivitiesGrid();
  }

  try {
    const mergedMap = new Map();

    try {
      const subSnap = await getDocs(collection(db, "classrooms", classroomId, "activities"));
      subSnap.docs.forEach((d) => mergedMap.set(d.id, { id: d.id, source: "sub", ...d.data() }));
    } catch {
      // Subcollection optional
    }

    try {
      const rootSnap = await getDocs(collection(db, "activities"));
      rootSnap.docs.forEach((d) => {
        const data = d.data();
        if (data.classroomId === classroomId || data.sectionId === classroomId) {
          mergedMap.set(d.id, { id: d.id, source: "root", ...data });
        }
      });
    } catch {
      // Root optional
    }

    currentActivities = Array.from(mergedMap.values()).sort((a, b) => {
      const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return tB - tA;
    });

    FastCache.set(`acts_${classroomId}`, currentActivities);
    document.getElementById("stat-activity-count").textContent = currentActivities.length;

    allSubmissionsMap.clear();
    await Promise.all(
      currentActivities.map(async (act) => {
        try {
          const subSnap = await getDocs(collection(db, "classrooms", classroomId, "activities", act.id, "submissions"));
          const subs = subSnap.docs.map((s) => ({ id: s.id, ...s.data() }));
          allSubmissionsMap.set(act.id, subs);
        } catch {
          allSubmissionsMap.set(act.id, []);
        }
      })
    );

    checkDeadlinesAndBuildNotifications();
    renderActivitiesGrid();
    computeAnalyticsView(students);
    if (userProfile.role !== "faculty") {
      updateStudentPortfolioMetricsAndView();
    }
  } catch (err) {
    console.error("Failed loading activities:", err);
    container.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Unable to load activities</h3></div>`;
  }
}

function isActivityPastDeadline(act) {
  if (!act || !act.dueDate) return false;
  const dueMs = new Date(act.dueDate).getTime();
  return !isNaN(dueMs) && Date.now() > dueMs;
}

function checkDeadlinesAndBuildNotifications() {
  const banner = document.getElementById("deadline-reminders-banner");
  const now = Date.now();
  const urgentReminders = [];

  currentActivities.forEach((act) => {
    if (!act.dueDate) return;
    const dueMs = new Date(act.dueDate).getTime();
    if (isNaN(dueMs)) return;

    const hoursLeft = (dueMs - now) / (1000 * 60 * 60);
    const subs = allSubmissionsMap.get(act.id) || [];
    const mySub = subs.find((s) => s.studentUid === currentUser.uid || s.id === currentUser.uid);

    if (userProfile.role === "student") {
      if (mySub && mySub.score !== undefined && mySub.score !== null) {
        notificationsQueue.push({
          type: "GRADE",
          title: `Graded: ${act.title}`,
          detail: `Score: ${mySub.score}/${act.maxScore || 100} — "${mySub.feedback || "Reviewed by instructor."}"`
        });
      }
      if (!mySub && hoursLeft > 0 && hoursLeft <= 72) {
        const msg = `"${act.title}" closes in ${Math.ceil(hoursLeft)} hour(s) (${new Date(dueMs).toLocaleString()}).`;
        urgentReminders.push(msg);
        notificationsQueue.push({ type: "DEADLINE", title: `Upcoming Deadline: ${act.title}`, detail: msg });
      } else if (!mySub && hoursLeft <= 0) {
        notificationsQueue.push({
          type: "CLOSED",
          title: `Closed & Missing: ${act.title}`,
          detail: `Activity closed automatically when the deadline passed on ${new Date(dueMs).toLocaleString()}.`
        });
      }
    } else {
      const ungraded = subs.filter((s) => s.score === undefined || s.score === null);
      if (ungraded.length > 0) {
        notificationsQueue.push({
          type: "SUBMISSION",
          title: `${ungraded.length} Ungraded Submission(s)`,
          detail: `Activity: "${act.title}" awaiting rubric evaluation.`
        });
      }
    }
  });

  if (banner) {
    if (urgentReminders.length > 0) {
      banner.style.display = "block";
      banner.innerHTML = `<i class="fas fa-clock" style="color:var(--warning);margin-right:0.5rem;"></i><strong>Deadline Reminder:</strong> ${escapeHtml(urgentReminders[0])}`;
    } else {
      banner.style.display = "none";
    }
  }
}

function renderActivitiesGrid() {
  const container = document.getElementById("activities-container");
  if (!container) return;

  if (currentActivities.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-clipboard-check"></i>
        <h3>No Activities Published Yet</h3>
        <p>${userProfile.role === "faculty" ? "Click 'Post Activity & Rubric' to assign an HR simulation task." : "Your instructor has not posted activities for this class yet."}</p>
      </div>`;
    return;
  }

  container.innerHTML = currentActivities
    .map((act) => {
      const subs = allSubmissionsMap.get(act.id) || [];
      const maxPts = act.maxScore || 100;
      const pastDue = isActivityPastDeadline(act);
      const dueDisplay = act.dueDate
        ? new Date(act.dueDate).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
        : "Open";

      let statusHtml = "";
      let buttonLabel = "Open";

      if (userProfile.role === "faculty") {
        statusHtml = `<span style="font-size:0.75rem;color:var(--text-secondary);">Submissions: <strong>${subs.length}</strong> ${pastDue ? "• <strong style='color:var(--danger);'>Closed</strong>" : ""}</span>`;
        buttonLabel = "Grade & Review";
      } else {
        const mySub = subs.find((s) => s.studentUid === currentUser.uid || s.id === currentUser.uid);
        if (mySub && mySub.score !== undefined && mySub.score !== null) {
          statusHtml = `<span style="font-size:0.75rem;color:var(--success);font-weight:700;"><i class="fas fa-check-circle"></i> Graded: ${mySub.score}/${maxPts}</span>`;
          buttonLabel = "View Graded Output";
        } else if (mySub) {
          const isUnlocked = Boolean(mySub.allowEdit) && !pastDue;
          statusHtml = `<span style="font-size:0.75rem;color:#38bdf8;font-weight:600;"><i class="fas ${isUnlocked ? "fa-unlock" : "fa-lock"}"></i> Submitted ${isUnlocked ? "(Edit Allowed)" : "(Locked)"}</span>`;
          buttonLabel = isUnlocked ? "Edit Submission" : "View Submission";
        } else if (pastDue) {
          statusHtml = `<span style="font-size:0.75rem;color:var(--danger);font-weight:700;"><i class="fas fa-ban"></i> Closed (Missing)</span>`;
          buttonLabel = "View Closed Activity";
        } else {
          statusHtml = `<span style="font-size:0.75rem;color:var(--warning);font-weight:600;">Pending Submission</span>`;
          buttonLabel = "Submit";
        }
      }

      const deleteBtnHtml =
        userProfile.role === "faculty"
          ? `<button type="button" class="btn-del-activity" data-id="${act.id}" data-source="${act.source || "sub"}" style="background:none;border:none;color:var(--text-tertiary);cursor:pointer;font-size:0.95rem;" title="Delete Activity"><i class="fas fa-trash-alt"></i></button>`
          : "";

      return `
        <article class="glass-panel portfolio-output-card" data-act-id="${act.id}" style="display:flex;flex-direction:column;justify-content:space-between;">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.65rem;gap:0.5rem;flex-wrap:wrap;">
              <span class="badge-pill">${escapeHtml(act.category || "HR Simulation")}</span>
              <div style="display:flex;align-items:center;gap:0.5rem;">
                <span class="text-muted" style="font-size:0.74rem;${pastDue ? "color:var(--danger)!important;font-weight:600;" : ""}"><i class="far fa-clock"></i> ${escapeHtml(dueDisplay)}</span>
                ${deleteBtnHtml}
              </div>
            </div>
            <h3 style="font-size:1.05rem;margin-bottom:0.45rem;color:var(--text-primary);">${escapeHtml(act.title || "Untitled Activity")}</h3>
            <p class="text-muted" style="font-size:0.83rem;line-height:1.5;margin-bottom:0.6rem;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;">
              ${escapeHtml(act.instructions || act.description || "")}
            </p>
            <div style="font-size:0.74rem;color:var(--text-tertiary);">
              <i class="fas fa-list-check"></i> Rubric: ${escapeHtml(act.rubric || "Standard HR Evaluation")} (${maxPts} pts)
            </div>
          </div>

          <div style="margin-top:1.15rem;padding-top:0.75rem;border-top:1px solid var(--border-subtle);display:flex;justify-content:space-between;align-items:center;">
            ${statusHtml}
            <button type="button" class="btn-secondary btn-open-act-detail" data-id="${act.id}" style="padding:0.35rem 0.8rem;font-size:0.78rem;">
              <i class="fas fa-folder-open"></i> ${buttonLabel}
            </button>
          </div>
        </article>`;
    })
    .join("");

  container.querySelectorAll(".btn-open-act-detail").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const act = currentActivities.find((a) => a.id === btn.dataset.id);
      if (act) openActivityDetailModal(act);
    });
  });

  container.querySelectorAll("article[data-act-id]").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      const act = currentActivities.find((a) => a.id === card.dataset.actId);
      if (act) openActivityDetailModal(act);
    });
  });

  container.querySelectorAll(".btn-del-activity").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Delete this activity and its records?")) return;
      const actId = btn.dataset.id;
      const src = btn.dataset.source;
      try {
        if (src === "root") {
          await deleteDoc(doc(db, "activities", actId));
        } else {
          await deleteDoc(doc(db, "classrooms", activeClassroom.id, "activities", actId));
        }
        await loadClassroomActivitiesAndSubmissions(activeClassroom.id, activeClassroom.students || []);
      } catch (err) {
        alert("Failed to delete activity: " + err.message);
      }
    });
  });
}

function openActivityDetailModal(act) {
  const maxPts = act.maxScore || 100;
  const pastDue = isActivityPastDeadline(act);

  document.getElementById("detail-act-id").value = act.id;
  document.getElementById("detail-act-title").textContent = act.title || "Activity";
  document.getElementById("detail-act-badge").textContent = act.category || "HR Simulation";
  document.getElementById("detail-act-due").textContent = act.dueDate
    ? `Deadline: ${new Date(act.dueDate).toLocaleString()} ${pastDue ? "(CLOSED)" : ""}`
    : "Deadline: Open";
  document.getElementById("detail-act-points").textContent = `${maxPts} pts`;
  document.getElementById("detail-act-rubric").textContent = act.rubric || "Standard Rubric Evaluation";
  document.getElementById("detail-act-desc").textContent = act.instructions || act.description || "";

  const stuSection = document.getElementById("student-submission-section");
  const facSection = document.getElementById("faculty-submissions-section");
  const subs = allSubmissionsMap.get(act.id) || [];

  if (userProfile.role === "faculty") {
    stuSection.style.display = "none";
    facSection.style.display = "block";
    renderFacultySubmissionsList(act, subs);
  } else {
    facSection.style.display = "none";
    stuSection.style.display = "block";

    const mySub = subs.find((s) => s.studentUid === currentUser.uid || s.id === currentUser.uid);
    const notesInput = document.getElementById("deliverable-notes");
    const fileInput = document.getElementById("deliverable-file-input");
    const fileInfo = document.getElementById("deliverable-attached-file-info");
    const saveBtn = document.getElementById("btn-save-deliverable");
    const gradeBox = document.getElementById("student-grade-feedback-box");
    const closedNotice = document.getElementById("activity-closed-notice");
    const closedText = document.getElementById("activity-closed-text");

    notesInput.value = mySub ? mySub.notes || "" : "";
    if (fileInput) fileInput.value = "";

    // Display attached document link if already uploaded
    if (fileInfo) {
      const safeFileUrl = sanitizeUrl(mySub?.fileUrl, "");
      if (safeFileUrl) {
        fileInfo.style.display = "block";
        fileInfo.innerHTML = `<i class="fas fa-paperclip"></i> Submitted Document: <a href="${safeFileUrl}" target="_blank" rel="noopener noreferrer" style="color:var(--aimser-blue-400);font-weight:600;">${escapeHtml(mySub.fileName || "View Attached File")}</a>`;
      } else {
        fileInfo.style.display = "none";
        fileInfo.innerHTML = "";
      }
    }

    // Show graded feedback details
    if (mySub && mySub.score !== undefined && mySub.score !== null) {
      gradeBox.style.display = "block";
      document.getElementById("student-awarded-score").textContent = `${mySub.score} / ${maxPts}`;
      document.getElementById("student-awarded-feedback").textContent = mySub.feedback || "Reviewed by instructor.";
    } else {
      gradeBox.style.display = "none";
    }

    // Enforce automatic deadline closure AND submission lock (students cannot edit/remove once submitted unless unlocked by faculty)
    const isSubmittedAndLocked = Boolean(mySub) && !mySub.allowEdit;
    const isLocked = pastDue || isSubmittedAndLocked;

    if (closedNotice && closedText) {
      if (pastDue) {
        closedNotice.style.display = "block";
        closedText.textContent = "This activity is closed because the deadline has passed. Submissions and edits are no longer accepted.";
      } else if (isSubmittedAndLocked) {
        closedNotice.style.display = "block";
        closedText.textContent = "Your output has been submitted and locked. Submitted documents cannot be edited or removed unless unlocked by your instructor.";
      } else {
        closedNotice.style.display = "none";
      }
    }

    notesInput.disabled = isLocked;
    if (fileInput) fileInput.disabled = isLocked;
    if (saveBtn) {
      saveBtn.disabled = isLocked;
      saveBtn.style.display = isLocked ? "none" : "inline-flex";
      saveBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit';
    }
  }

  openModal("modal-activity-detail");
}

function renderFacultySubmissionsList(act, subs) {
  const listEl = document.getElementById("faculty-submissions-list");
  const maxPts = act.maxScore || 100;

  if (subs.length === 0) {
    listEl.innerHTML = `<div class="empty-state" style="padding:1.5rem;"><p>No student outputs submitted for this activity yet.</p></div>`;
    return;
  }

  listEl.innerHTML = subs
    .map((sub) => {
      const subId = sub.studentUid || sub.id;
      const currentScore = sub.score !== undefined && sub.score !== null ? sub.score : "";
      const currentFeedback = sub.feedback || "";
      const safeFileUrl = sanitizeUrl(sub.fileUrl, "");
      const allowEdit = Boolean(sub.allowEdit);

      const fileAttachmentHtml = safeFileUrl
        ? `<div style="margin-bottom:0.65rem;">
             <a href="${safeFileUrl}" target="_blank" rel="noopener noreferrer" class="btn-secondary" style="padding:0.32rem 0.7rem;font-size:0.76rem;">
               <i class="fas fa-file-download"></i> Open Attached File (${escapeHtml(sub.fileName || "Document")})
             </a>
           </div>`
        : "";

      return `
        <div class="inspector-meta-item" style="padding:0.9rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.45rem;flex-wrap:wrap;gap:0.4rem;">
            <div style="display:flex;align-items:center;gap:0.45rem;">
              <strong>${escapeHtml(sub.studentName || sub.studentEmail)}</strong>
              ${renderRoleBadge("student")}
            </div>
            <div style="display:flex;align-items:center;gap:0.5rem;">
              <button type="button" class="btn-secondary btn-toggle-sub-lock" data-act-id="${act.id}" data-sub-id="${subId}" data-allow="${allowEdit}" style="padding:0.25rem 0.6rem;font-size:0.72rem;">
                <i class="fas ${allowEdit ? "fa-lock" : "fa-unlock"}"></i> ${allowEdit ? "Lock Submission" : "Allow Resubmission"}
              </button>
            </div>
          </div>
          <p style="font-size:0.84rem;white-space:pre-wrap;color:var(--text-primary);background:var(--bg-canvas);padding:0.65rem;border-radius:var(--radius-xs);margin-bottom:0.65rem;">${escapeHtml(sub.notes || "")}</p>
          ${fileAttachmentHtml}
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">
            <input type="number" class="form-control input-rubric-score" data-sub-id="${subId}" min="0" max="${maxPts}" value="${currentScore}" placeholder="Score / ${maxPts}" style="width:120px;" />
            <input type="text" class="form-control input-rubric-feedback" data-sub-id="${subId}" value="${escapeHtml(currentFeedback)}" placeholder="Rubric evaluation feedback..." style="flex:1;min-width:180px;" />
            <button type="button" class="btn-primary btn-save-rubric-grade" data-act-id="${act.id}" data-sub-id="${subId}" data-student="${escapeHtml(sub.studentEmail || subId)}">
              <i class="fas fa-check"></i> Save Grade
            </button>
          </div>
        </div>`;
    })
    .join("");

  listEl.querySelectorAll(".btn-toggle-sub-lock").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const subId = btn.dataset.subId;
      const actId = btn.dataset.actId;
      const nextAllow = btn.dataset.allow !== "true";
      btn.disabled = true;
      try {
        await updateDoc(doc(db, "classrooms", activeClassroom.id, "activities", actId, "submissions", subId), {
          allowEdit: nextAllow
        });
        await loadClassroomActivitiesAndSubmissions(activeClassroom.id, activeClassroom.students || []);
        const updatedSubs = allSubmissionsMap.get(actId) || [];
        renderFacultySubmissionsList(act, updatedSubs);
      } catch (err) {
        alert("Failed to update submission lock: " + err.message);
      } finally {
        btn.disabled = false;
      }
    });
  });

  listEl.querySelectorAll(".btn-save-rubric-grade").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const subId = btn.dataset.subId;
      const actId = btn.dataset.actId;
      const scoreInput = listEl.querySelector(`.input-rubric-score[data-sub-id="${subId}"]`);
      const fbInput = listEl.querySelector(`.input-rubric-feedback[data-sub-id="${subId}"]`);

      const numericScore = Number(scoreInput.value);
      if (isNaN(numericScore) || numericScore < 0 || numericScore > maxPts) {
        alert(`Please enter a valid score between 0 and ${maxPts}.`);
        return;
      }

      btn.disabled = true;
      try {
        await updateDoc(doc(db, "classrooms", activeClassroom.id, "activities", actId, "submissions", subId), {
          score: numericScore,
          feedback: fbInput.value.trim(),
          allowEdit: false,
          gradedBy: currentUser.email,
          gradedAt: serverTimestamp()
        });
        await logAuditEvent(`Faculty graded ${btn.dataset.student} (${numericScore}/${maxPts}) on "${act.title}"`, "GRADING", currentUser.email);
        btn.innerHTML = '<i class="fas fa-check-double"></i> Saved';
        await loadClassroomActivitiesAndSubmissions(activeClassroom.id, activeClassroom.students || []);
      } catch (err) {
        alert("Failed to save grade: " + err.message);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function computeAnalyticsView(students) {
  const totalActs = currentActivities.length;

  if (userProfile.role === "faculty") {
    const totalPossible = students.length * totalActs;
    let totalSubmitted = 0;
    let gradedCount = 0;
    let pctSum = 0;

    const studentStats = students.map((st) => {
      const uid = typeof st === "string" ? st : st.uid;
      const name = typeof st === "string" ? st : st.fullName || st.email || uid;
      const email = typeof st === "object" ? st.email || "" : "";

      let completed = 0;
      let studentScorePctSum = 0;
      let studentGradedCount = 0;

      currentActivities.forEach((act) => {
        const subs = allSubmissionsMap.get(act.id) || [];
        const match = subs.find((s) => s.studentUid === uid || s.id === uid);
        if (match) {
          completed++;
          totalSubmitted++;
          if (match.score !== undefined && match.score !== null) {
            const pct = (Number(match.score) / (act.maxScore || 100)) * 100;
            studentScorePctSum += pct;
            studentGradedCount++;
            pctSum += pct;
            gradedCount++;
          }
        }
      });

      const compPct = totalActs > 0 ? Math.round((completed / totalActs) * 100) : 0;
      const avgPct = studentGradedCount > 0 ? (studentScorePctSum / studentGradedCount).toFixed(1) + "%" : "—";
      return { name, email, completed, compPct, avgPct };
    });

    const overallComp = totalPossible > 0 ? Math.round((totalSubmitted / totalPossible) * 100) : 0;
    const classAvg = gradedCount > 0 ? (pctSum / gradedCount).toFixed(1) + "%" : "—";

    document.getElementById("fac-completion-rate").textContent = `${overallComp}%`;
    document.getElementById("fac-class-avg").textContent = classAvg;
    document.getElementById("fac-graded-count").textContent = gradedCount;
    document.getElementById("stat-avg-score").textContent = `${classAvg} (${overallComp}%)`;

    const tbody = document.getElementById("faculty-analytics-tbody");
    if (tbody) {
      tbody.innerHTML =
        studentStats.length === 0
          ? `<tr><td colspan="5" style="text-align:center;padding:1.5rem;color:var(--text-secondary);">No students enrolled yet.</td></tr>`
          : studentStats
              .map(
                (row) => `
              <tr style="border-bottom:1px solid var(--border-subtle);">
                <td style="padding:0.75rem 1rem;"><strong>${escapeHtml(row.name)}</strong><br><small class="text-muted">${escapeHtml(row.email)}</small></td>
                <td style="padding:0.75rem 1rem;">${renderRoleBadge("student")}</td>
                <td style="padding:0.75rem 1rem;">${row.completed} / ${totalActs}</td>
                <td style="padding:0.75rem 1rem;">${row.compPct}%</td>
                <td style="padding:0.75rem 1rem;font-weight:700;">${row.avgPct}</td>
              </tr>`
              )
              .join("");
    }
  } else {
    let mySubmitted = 0;
    let myPctSum = 0;
    let myGraded = 0;

    currentActivities.forEach((act) => {
      const subs = allSubmissionsMap.get(act.id) || [];
      const match = subs.find((s) => s.studentUid === currentUser.uid || s.id === currentUser.uid);
      if (match) {
        mySubmitted++;
        if (match.score !== undefined && match.score !== null) {
          myPctSum += (Number(match.score) / (act.maxScore || 100)) * 100;
          myGraded++;
        }
      }
    });

    const myComp = totalActs > 0 ? Math.round((mySubmitted / totalActs) * 100) : 0;
    const myAvg = myGraded > 0 ? (myPctSum / myGraded).toFixed(1) + "%" : "—";

    document.getElementById("stu-completion-rate").textContent = `${myComp}%`;
    document.getElementById("stu-avg-score").textContent = myAvg;
    document.getElementById("stu-submitted-count").textContent = `${mySubmitted} / ${totalActs}`;
    document.getElementById("stat-avg-score").textContent = myAvg;
  }
}

async function loadStudentAnalyticsReport(classroomId) {
  try {
    const snap = await getDoc(doc(db, "classrooms", classroomId, "analytics_reports", currentUser.uid));
    if (snap.exists()) {
      const r = snap.data();
      document.getElementById("res-turnover-rate").textContent = r.turnoverRate || "7.50%";
      document.getElementById("res-absenteeism-rate").textContent = r.absenteeismRate || "1.82%";
      document.getElementById("res-training-cost").textContent = r.trainingCost || "₱3,000";
      document.getElementById("res-recruitment-cost").textContent = r.recruitmentCost || "₱7,500";
      studentAbsenteeismRate = r.absenteeismRate || "1.82%";
    }
  } catch {
    studentAbsenteeismRate = "0%";
  }
}

async function loadPortfolioData(classroomId, students) {
  if (userProfile.role === "faculty") {
    const grid = document.getElementById("class-portfolios-grid");
    if (!grid) return;

    try {
      const snap = await getDocs(collection(db, "classrooms", classroomId, "portfolios"));
      const portfolioMap = new Map();
      snap.docs.forEach((d) => portfolioMap.set(d.id, { uid: d.id, ...d.data() }));

      students.forEach((st) => {
        const uid = typeof st === "string" ? st : st.uid;
        if (uid && !portfolioMap.has(uid)) {
          portfolioMap.set(uid, {
            uid,
            studentName: typeof st === "object" ? st.fullName || st.email : st,
            studentEmail: typeof st === "object" ? st.email || "" : "",
            goals: "",
            devPlan: "",
            selfFeedback: "",
            artifacts: []
          });
        }
      });

      const portfolios = Array.from(portfolioMap.values());

      if (portfolios.length === 0) {
        grid.innerHTML = `<div class="empty-state"><i class="fas fa-briefcase"></i><h3>No Enrolled Students Yet</h3><p>Share your class room code so students can build their HR portfolios.</p></div>`;
        return;
      }

      grid.innerHTML = portfolios
        .map((p) => {
          const artifacts = p.artifacts || [];
          return `
            <div class="glass-panel" style="display:flex;flex-direction:column;justify-content:space-between;">
              <div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
                  <strong>${escapeHtml(p.studentName || p.studentEmail || p.uid)}</strong>
                  ${renderRoleBadge("student")}
                </div>
                <div style="font-size:0.82rem;margin-bottom:0.5rem;"><strong>Career Goals:</strong> ${escapeHtml(p.goals || "Not yet submitted")}</div>
                <div style="font-size:0.82rem;margin-bottom:0.5rem;"><strong>Development Plan:</strong> ${escapeHtml(p.devPlan || "Not yet submitted")}</div>
                <div style="font-size:0.82rem;margin-bottom:0.75rem;"><strong>Self-Feedback:</strong> ${escapeHtml(p.selfFeedback || "—")}</div>
                <div style="font-size:0.8rem;margin-bottom:0.75rem;">
                  <strong>Portfolio Outputs (${artifacts.length}):</strong>
                  <ul style="margin:0.35rem 0 0 1.1rem;padding:0;">
                    ${artifacts.map((a) => `<li><strong>${escapeHtml(a.title)}:</strong> ${escapeHtml(a.link)}</li>`).join("") || "<li>None added</li>"}
                  </ul>
                </div>
              </div>

              <div style="padding-top:0.75rem;border-top:1px solid var(--border-subtle);display:flex;flex-direction:column;gap:0.45rem;">
                <div style="display:flex;gap:0.45rem;">
                  <input type="number" class="form-control port-grade-input" data-uid="${p.uid}" min="0" max="100" value="${p.facultyScore ?? ""}" placeholder="Score / 100" style="width:110px;" />
                  <input type="text" class="form-control port-fb-input" data-uid="${p.uid}" value="${escapeHtml(p.facultyFeedback || "")}" placeholder="Portfolio feedback..." style="flex:1;" />
                </div>
                <button type="button" class="btn-primary btn-grade-portfolio" data-uid="${p.uid}" data-name="${escapeHtml(p.studentName || p.uid)}">
                  <i class="fas fa-award"></i> Save Portfolio Grade &amp; Feedback
                </button>
              </div>
            </div>`;
        })
        .join("");

      grid.querySelectorAll(".btn-grade-portfolio").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const uid = btn.dataset.uid;
          const scoreVal = Number(grid.querySelector(`.port-grade-input[data-uid="${uid}"]`).value);
          const fbVal = grid.querySelector(`.port-fb-input[data-uid="${uid}"]`).value.trim();

          if (isNaN(scoreVal) || scoreVal < 0 || scoreVal > 100) {
            alert("Enter a valid portfolio score (0–100).");
            return;
          }

          btn.disabled = true;
          try {
            await setDoc(
              doc(db, "classrooms", classroomId, "portfolios", uid),
              { facultyScore: scoreVal, facultyFeedback: fbVal, gradedBy: currentUser.email, gradedAt: serverTimestamp() },
              { merge: true }
            );
            await logAuditEvent(`Graded HR portfolio for ${btn.dataset.name} (${scoreVal}/100)`, "PORTFOLIO", currentUser.email);
            btn.innerHTML = '<i class="fas fa-check"></i> Saved';
          } catch (err) {
            alert(err.message);
          } finally {
            btn.disabled = false;
          }
        });
      });
    } catch (err) {
      console.error("Faculty portfolio load error:", err);
    }
  } else {
    try {
      const snap = await getDoc(doc(db, "classrooms", classroomId, "portfolios", currentUser.uid));
      currentPortfolioData = snap.exists() ? snap.data() : { artifacts: [] };

      document.getElementById("port-goals").value = currentPortfolioData.goals || "";
      document.getElementById("port-devplan").value = currentPortfolioData.devPlan || "";
      document.getElementById("port-self-feedback").value = currentPortfolioData.selfFeedback || "";

      if (currentPortfolioData.facultyScore !== undefined && currentPortfolioData.facultyScore !== null) {
        notificationsQueue.push({
          type: "PORTFOLIO",
          title: `Portfolio Evaluated: ${currentPortfolioData.facultyScore}/100`,
          detail: currentPortfolioData.facultyFeedback || "Instructor reviewed your HR portfolio."
        });
      }

      updateStudentPortfolioMetricsAndView();
    } catch (err) {
      console.error("Student portfolio load error:", err);
    }
  }
}

// Compute 6 Required Student Portfolio Metrics & Render Filterable/Sortable Output Cards
function updateStudentPortfolioMetricsAndView() {
  const totalActivities = currentActivities.length;
  let completedCount = 0;
  let missingCount = 0;
  let gradedCount = 0;
  let scorePctSum = 0;

  const unifiedItems = [];

  currentActivities.forEach((act) => {
    const subs = allSubmissionsMap.get(act.id) || [];
    const mySub = subs.find((s) => s.studentUid === currentUser?.uid || s.id === currentUser?.uid);
    const pastDue = isActivityPastDeadline(act);
    const createdMs = act.createdAt?.toMillis ? act.createdAt.toMillis() : 0;

    if (mySub) {
      completedCount++;
      const isGraded = mySub.score !== undefined && mySub.score !== null;
      if (isGraded) {
        gradedCount++;
        scorePctSum += (Number(mySub.score) / (act.maxScore || 100)) * 100;
      }
      unifiedItems.push({
        kind: "activity",
        actId: act.id,
        title: act.title || "Classroom Activity",
        category: act.category || "Activity",
        status: isGraded ? "graded" : "submitted",
        scoreText: isGraded ? `${mySub.score} / ${act.maxScore || 100}` : "Submitted (Pending Grade)",
        summary: mySub.notes || act.instructions || "",
        feedback: mySub.feedback || "",
        fileName: mySub.fileName || "",
        timestamp: mySub.submittedAt?.toMillis ? mySub.submittedAt.toMillis() : createdMs
      });
    } else {
      if (pastDue) {
        missingCount++;
      }
      unifiedItems.push({
        kind: "activity",
        actId: act.id,
        title: act.title || "Classroom Activity",
        category: act.category || "Activity",
        status: pastDue ? "missing" : "pending",
        scoreText: pastDue ? "Missing (Closed)" : "Pending Submission",
        summary: act.instructions || "",
        feedback: "",
        fileName: "",
        timestamp: createdMs
      });
    }
  });

  const completionRate = totalActivities > 0 ? Math.round((completedCount / totalActivities) * 100) : 0;
  const avgScore = gradedCount > 0 ? (scorePctSum / gradedCount).toFixed(1) + "%" : "—";
  const computedAbsenteeism =
    studentAbsenteeismRate && studentAbsenteeismRate !== "0%"
      ? studentAbsenteeismRate
      : totalActivities > 0
      ? ((missingCount / totalActivities) * 100).toFixed(1) + "%"
      : "0%";

  const elAbs = document.getElementById("port-metric-absenteeism");
  const elMiss = document.getElementById("port-metric-missing");
  const elComp = document.getElementById("port-metric-completed");
  const elTot = document.getElementById("port-metric-total");
  const elRate = document.getElementById("port-metric-rate");
  const elAvg = document.getElementById("port-metric-avg");

  if (elAbs) elAbs.textContent = computedAbsenteeism;
  if (elMiss) elMiss.textContent = String(missingCount);
  if (elComp) elComp.textContent = String(completedCount);
  if (elTot) elTot.textContent = String(totalActivities);
  if (elRate) elRate.textContent = `${completionRate}%`;
  if (elAvg) elAvg.textContent = avgScore;

  // Include custom portfolio outputs
  const customArtifacts = currentPortfolioData?.artifacts || [];
  customArtifacts.forEach((art, idx) => {
    unifiedItems.push({
      kind: "artifact",
      artifactIdx: idx,
      title: art.title || "Portfolio Output",
      category: "Portfolio Output",
      status: "submitted",
      scoreText: "Stored Output",
      summary: art.link || "",
      feedback: "",
      fileName: "",
      timestamp: art.createdAt ? new Date(art.createdAt).getTime() : 0
    });
  });

  renderStudentPortfolioItemsList(unifiedItems);
}

function renderStudentPortfolioItemsList(items) {
  const container = document.getElementById("student-portfolio-items");
  if (!container) return;

  const searchVal = (document.getElementById("portfolio-search-input")?.value || "").toLowerCase().trim();
  const sortMode = document.getElementById("portfolio-sort-select")?.value || "newest";

  let filtered = items.filter((item) => {
    if (sortMode === "graded" && item.status !== "graded") return false;
    if (sortMode === "missing" && item.status !== "missing" && item.status !== "pending") return false;
    if (!searchVal) return true;
    return (
      (item.title || "").toLowerCase().includes(searchVal) ||
      (item.category || "").toLowerCase().includes(searchVal) ||
      (item.summary || "").toLowerCase().includes(searchVal)
    );
  });

  filtered.sort((a, b) => {
    if (sortMode === "oldest") return (a.timestamp || 0) - (b.timestamp || 0);
    return (b.timestamp || 0) - (a.timestamp || 0);
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-folder-open"></i>
        <h3>No Matching Portfolio Outputs</h3>
        <p>Submit classroom activities or click "Add Output" above to build your portfolio.</p>
      </div>`;
    return;
  }

  container.innerHTML = filtered
    .map((item) => {
      let badgeColor = "";
      if (item.status === "graded") badgeColor = "background:rgba(16,185,129,0.16);color:var(--success);border-color:var(--success);";
      else if (item.status === "missing") badgeColor = "background:rgba(239,68,68,0.16);color:var(--danger);border-color:var(--danger);";
      else if (item.status === "pending") badgeColor = "background:rgba(245,158,11,0.16);color:var(--warning);border-color:var(--warning);";

      if (item.kind === "activity") {
        return `
          <article class="glass-panel portfolio-output-card" data-port-act-id="${item.actId}" style="display:flex;flex-direction:column;justify-content:space-between;">
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;gap:0.4rem;flex-wrap:wrap;margin-bottom:0.55rem;">
                <span class="badge-pill">${escapeHtml(item.category)}</span>
                <span class="badge-pill" style="${badgeColor}">${escapeHtml(item.scoreText)}</span>
              </div>
              <h3 style="font-size:1rem;margin-bottom:0.35rem;">${escapeHtml(item.title)}</h3>
              <p class="text-muted" style="font-size:0.82rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:0.5rem;">
                ${escapeHtml(item.summary || "Click to inspect activity and rubric details.")}
              </p>
              ${item.feedback ? `<div style="font-size:0.78rem;color:var(--success);"><strong>Feedback:</strong> ${escapeHtml(item.feedback)}</div>` : ""}
            </div>
            <div style="margin-top:0.9rem;padding-top:0.65rem;border-top:1px solid var(--border-subtle);display:flex;justify-content:space-between;align-items:center;">
              <span class="text-muted" style="font-size:0.74rem;">${item.fileName ? `<i class="fas fa-paperclip"></i> ${escapeHtml(item.fileName)}` : "Click to view graded details"}</span>
              <i class="fas fa-chevron-right" style="color:var(--aimser-blue-400);font-size:0.8rem;"></i>
            </div>
          </article>`;
      }

      return `
        <article class="glass-panel portfolio-output-card" style="display:flex;flex-direction:column;justify-content:space-between;">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.55rem;">
              <span class="badge-pill">Portfolio Output</span>
              <span class="badge-pill">Locked</span>
            </div>
            <h3 style="font-size:1rem;margin-bottom:0.35rem;">${escapeHtml(item.title)}</h3>
            <p class="text-muted" style="font-size:0.82rem;word-break:break-word;">${escapeHtml(item.summary)}</p>
          </div>
        </article>`;
    })
    .join("");

  container.querySelectorAll("[data-port-act-id]").forEach((card) => {
    card.addEventListener("click", () => {
      const targetAct = currentActivities.find((a) => a.id === card.getAttribute("data-port-act-id"));
      if (targetAct) openActivityDetailModal(targetAct);
    });
  });
}

async function loadRosterAndRequests(classroomId, students) {
  const rosterEl = document.getElementById("roster-list-container");
  const reqWrapper = document.getElementById("join-requests-wrapper");
  const reqList = document.getElementById("join-requests-list");

  if (rosterEl) {
    const instructorCard = `
      <div class="glass-panel" style="display:flex;align-items:center;gap:0.75rem;padding:0.9rem 1rem;border:1px solid var(--aimser-blue-500);">
        <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(activeClassroom.instructorEmail || "Faculty")}&background=1b5375&color=faf2dd" alt="" class="avatar-sm" />
        <div>
          <div style="font-weight:600;font-size:0.9rem;display:flex;align-items:center;gap:0.45rem;">
            <span>${escapeHtml(activeClassroom.instructorName || activeClassroom.instructorEmail || "Class Instructor")}</span>
            ${renderRoleBadge("faculty")}
          </div>
          <div class="text-muted" style="font-size:0.75rem;">${escapeHtml(activeClassroom.instructorEmail || "")}</div>
        </div>
      </div>`;

    const studentCards = students
      .map((s) => {
        const label = typeof s === "string" ? s : s.fullName || s.email || s.uid;
        const email = typeof s === "object" ? s.email || "" : "";
        return `
          <div class="glass-panel" style="display:flex;align-items:center;gap:0.75rem;padding:0.9rem 1rem;">
            <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(label)}&background=1b5375&color=faf2dd" alt="" class="avatar-sm" />
            <div>
              <div style="font-weight:600;font-size:0.9rem;display:flex;align-items:center;gap:0.45rem;">
                <span>${escapeHtml(label)}</span>
                ${renderRoleBadge("student")}
              </div>
              <div class="text-muted" style="font-size:0.75rem;">${escapeHtml(email || "Enrolled Student")}</div>
            </div>
          </div>`;
      })
      .join("");

    rosterEl.innerHTML = instructorCard + studentCards;
  }

  if (userProfile.role === "faculty" && reqWrapper && reqList) {
    try {
      const q = query(collection(db, "join_requests"), where("classroomId", "==", classroomId));
      const snap = await getDocs(q);
      const pending = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => r.status === "pending");

      if (pending.length === 0) {
        reqWrapper.style.display = "none";
      } else {
        reqWrapper.style.display = "block";
        reqList.innerHTML = pending
          .map(
            (req) => `
            <div class="inspector-meta-item" style="display:flex;justify-content:space-between;align-items:center;">
              <div style="display:flex;align-items:center;gap:0.5rem;">
                <strong>${escapeHtml(req.studentName || req.studentEmail)}</strong>
                ${renderRoleBadge("student")}
                <span class="text-muted" style="font-size:0.8rem;">(${escapeHtml(req.studentEmail)})</span>
              </div>
              <div style="display:flex;gap:0.5rem;">
                <button type="button" class="btn-primary btn-approve-req" data-req-id="${req.id}" data-uid="${req.studentUid}" data-name="${escapeHtml(req.studentName || req.studentEmail)}" data-email="${escapeHtml(req.studentEmail)}">
                  <i class="fas fa-check"></i> Approve
                </button>
                <button type="button" class="btn-sidebar-action btn-logout btn-reject-req" data-req-id="${req.id}" style="width:auto;">
                  Decline
                </button>
              </div>
            </div>`
          )
          .join("");

        reqList.querySelectorAll(".btn-approve-req").forEach((btn) => {
          btn.addEventListener("click", async () => {
            if ((activeClassroom.students || []).length >= MAX_CLASS_STUDENTS) {
              alert(`Class capacity limit reached (${MAX_CLASS_STUDENTS} students maximum).`);
              return;
            }
            btn.disabled = true;
            await updateDoc(doc(db, "classrooms", classroomId), {
              students: arrayUnion({
                uid: btn.dataset.uid,
                fullName: btn.dataset.name,
                email: btn.dataset.email,
                role: "student"
              })
            });
            await updateDoc(doc(db, "join_requests", btn.dataset.reqId), { status: "approved" });
            await logAuditEvent(`Approved ${btn.dataset.email} into class ${activeClassroom.sectionCode}`, "CLASSROOM", userProfile.email);
            await loadUserClassrooms();
          });
        });

        reqList.querySelectorAll(".btn-reject-req").forEach((btn) => {
          btn.addEventListener("click", async () => {
            btn.disabled = true;
            await deleteDoc(doc(db, "join_requests", btn.dataset.reqId));
            await selectClassroom(classroomId);
          });
        });
      }
    } catch (err) {
      console.warn("Join requests check:", err.message);
    }
  }
}

function renderNotificationsBell() {
  const badge = document.getElementById("notif-badge");
  const list = document.getElementById("notifications-feed-list");
  const merged = [...warningNotifications, ...notificationsQueue];

  if (badge) {
    if (merged.length > 0) {
      badge.style.display = "inline-block";
      badge.textContent = merged.length;
    } else {
      badge.style.display = "none";
    }
  }

  if (list) {
    list.innerHTML =
      merged.length === 0
        ? `<div class="empty-state" style="padding:1.5rem;"><i class="fas fa-bell-slash"></i><h3>All Caught Up</h3><p>No pending deadline reminders or new notifications.</p></div>`
        : merged
            .map((n) => {
              const isWarning = n.type === "WARNING";
              const borderStyle = isWarning
                ? "border:1px solid var(--danger);background:rgba(239,68,68,0.1);"
                : "border:1px solid var(--border-subtle);background:var(--bg-surface-elevated);";
              return `
                <div style="padding:0.75rem 0.9rem;border-radius:var(--radius-sm);${borderStyle}">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem;gap:0.4rem;">
                    <strong style="font-size:0.84rem;${isWarning ? "color:var(--danger);" : ""}">${escapeHtml(n.title)}</strong>
                    <span class="badge-pill" style="font-size:0.65rem;">${escapeHtml(n.type)}</span>
                  </div>
                  <p class="text-muted" style="font-size:0.78rem;margin:0;">${escapeHtml(n.detail)}</p>
                </div>`;
            })
            .join("");
  }
}

function renderEmptyWorkspace() {
  const codeEl = document.getElementById("stat-section-code");
  if (codeEl) codeEl.textContent = "—";
  document.getElementById("stat-member-count").textContent = `0 / ${MAX_CLASS_STUDENTS}`;
  document.getElementById("stat-activity-count").textContent = "0";
  document.getElementById("stat-avg-score").textContent = "—";
  document.getElementById("activities-container").innerHTML = `
    <div class="empty-state">
      <i class="fas fa-chalkboard-teacher"></i>
      <h3>No Classroom Room Selected</h3>
      <p>${userProfile.role === "faculty" ? "Click 'Create Class Room' above to generate a room code (up to 100 students)." : "Click 'Join Class Room' above and enter your instructor's room code."}</p>
    </div>`;
}

function bindOfficeEvents() {
  document.getElementById("active-classroom-select")?.addEventListener("change", (e) => {
    if (e.target.value) selectClassroom(e.target.value);
  });

  document.getElementById("btn-refresh-office")?.addEventListener("click", () => {
    if (activeClassroom) selectClassroom(activeClassroom.id);
    else loadModerationWarningsIntoBell();
  });

  document.getElementById("portfolio-search-input")?.addEventListener("input", () => {
    updateStudentPortfolioMetricsAndView();
  });

  document.getElementById("portfolio-sort-select")?.addEventListener("change", () => {
    updateStudentPortfolioMetricsAndView();
  });

  document.getElementById("btn-open-classroom-action")?.addEventListener("click", () => {
    const isFaculty = userProfile.role === "faculty";
    document.getElementById("modal-classroom-title").textContent = isFaculty ? "Create Class Room (100 Students Max)" : "Join Class Room";
    document.getElementById("form-create-classroom").style.display = isFaculty ? "block" : "none";
    document.getElementById("form-join-classroom").style.display = isFaculty ? "none" : "block";
    openModal("modal-classroom");
  });

  document.getElementById("form-create-classroom")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-create-class");
    const name = document.getElementById("new-class-name").value.trim();
    const description = document.getElementById("new-class-desc").value.trim();
    const code = "AIM-" + Math.random().toString(36).substring(2, 6).toUpperCase();

    btn.disabled = true;
    try {
      checkRateLimit("create_class", 5, 60000);
      const docRef = await addDoc(collection(db, "classrooms"), {
        name,
        description,
        sectionCode: code,
        maxStudents: MAX_CLASS_STUDENTS,
        instructorId: currentUser.uid,
        instructorName: userProfile.fullName,
        instructorEmail: currentUser.email,
        students: [],
        activityCount: 0,
        createdAt: serverTimestamp()
      });
      await logAuditEvent(`Faculty ${currentUser.email} created class room ${name} (${code})`, "CLASSROOM", currentUser.email);
      localStorage.setItem("aimser_active_classroom", docRef.id);
      closeModal("modal-classroom");
      e.target.reset();
      alert(`Class Room Created! Share Room Code: ${code} (Up to 100 students).`);
      await loadUserClassrooms();
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("form-join-classroom")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-join-class");
    const code = document.getElementById("join-class-code").value.trim().toUpperCase();

    btn.disabled = true;
    try {
      checkRateLimit("join_class", 5, 60000);
      const snap = await getDocs(collection(db, "classrooms"));
      const match = snap.docs.find((d) => (d.data().sectionCode || d.data().code || "").toUpperCase() === code);
      if (!match) throw new Error(`No classroom found with room code "${code}".`);

      const roomData = match.data();
      const enrolled = roomData.students || [];
      if (enrolled.length >= MAX_CLASS_STUDENTS) {
        throw new Error(`This class room has reached its maximum capacity of ${MAX_CLASS_STUDENTS} students.`);
      }

      const alreadyIn = enrolled.some((s) => (typeof s === "string" ? s === currentUser.uid : s.uid === currentUser.uid));
      if (alreadyIn) {
        throw new Error("You are already enrolled in this classroom.");
      }

      const existingReqSnap = await getDocs(query(collection(db, "join_requests"), where("classroomId", "==", match.id)));
      const duplicateReq = existingReqSnap.docs.some(
        (d) => d.data().studentUid === currentUser.uid && d.data().status === "pending"
      );
      if (duplicateReq) {
        throw new Error("You already have a pending join request for this class.");
      }

      await addDoc(collection(db, "join_requests"), {
        classroomId: match.id,
        sectionCode: code,
        studentUid: currentUser.uid,
        studentName: userProfile.fullName,
        studentEmail: currentUser.email,
        status: "pending",
        createdAt: serverTimestamp()
      });

      await logAuditEvent(`${currentUser.email} submitted join request for class ${code}`, "JOIN_REQUEST", currentUser.email);
      alert(`Join request sent for "${roomData.name}". Awaiting faculty approval.`);
      closeModal("modal-classroom");
      e.target.reset();
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("btn-open-new-activity")?.addEventListener("click", () => {
    if (!activeClassroom) {
      alert("Please create or select a class room first.");
      return;
    }
    openModal("modal-activity");
  });

  document.getElementById("form-create-activity")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!activeClassroom) return;
    const btn = document.getElementById("btn-submit-activity");

    const title = document.getElementById("act-title").value.trim();
    const category = document.getElementById("act-category").value;
    const dueDate = document.getElementById("act-due-date").value;
    const maxScore = Number(document.getElementById("act-max-score").value) || 100;
    const rubric = document.getElementById("act-rubric").value.trim();
    const instructions = document.getElementById("act-instructions").value.trim();

    btn.disabled = true;
    try {
      checkRateLimit("create_act", 8, 60000);
      await addDoc(collection(db, "classrooms", activeClassroom.id, "activities"), {
        title,
        category,
        dueDate,
        maxScore,
        rubric,
        instructions,
        classroomId: activeClassroom.id,
        createdBy: currentUser.email,
        createdAt: serverTimestamp()
      });

      await updateDoc(doc(db, "classrooms", activeClassroom.id), {
        activityCount: currentActivities.length + 1
      });

      await logAuditEvent(`Published activity "${title}" in ${activeClassroom.sectionCode}`, "ACTIVITY", currentUser.email);
      closeModal("modal-activity");
      e.target.reset();
      await loadClassroomActivitiesAndSubmissions(activeClassroom.id, activeClassroom.students || []);
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("btn-export-report")?.addEventListener("click", () => {
    if (!activeClassroom) return;
    const rows = [["Activity Title", "Domain", "Deadline", "Max Points", "Submissions Count", "Average Score"]];

    currentActivities.forEach((act) => {
      const subs = allSubmissionsMap.get(act.id) || [];
      const graded = subs.filter((s) => s.score !== undefined && s.score !== null);
      const avg = graded.length > 0 ? (graded.reduce((sum, s) => sum + Number(s.score), 0) / graded.length).toFixed(2) : "N/A";
      rows.push([
        `"${(act.title || "").replace(/"/g, '""')}"`,
        `"${act.category || ""}"`,
        `"${act.dueDate || "Open"}"`,
        act.maxScore || 100,
        subs.length,
        avg
      ]);
    });

    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeClassroom.sectionCode || "AIMSER"}_Activity_Report.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Student Submission Handler (Enforces Deadline Closure, File Upload, and Permanent Lock Unless Unlocked by Faculty)
  document.getElementById("form-submit-deliverable")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!activeClassroom) return;

    const btn = document.getElementById("btn-save-deliverable");
    const actId = document.getElementById("detail-act-id").value;
    const notes = document.getElementById("deliverable-notes").value.trim();
    const fileInput = document.getElementById("deliverable-file-input");
    const selectedFile = fileInput?.files?.[0] || null;

    const act = currentActivities.find((a) => a.id === actId);
    if (isActivityPastDeadline(act)) {
      alert("This activity is closed because the deadline has already passed.");
      return;
    }

    const subs = allSubmissionsMap.get(actId) || [];
    const existingSub = subs.find((s) => s.studentUid === currentUser.uid || s.id === currentUser.uid);
    if (existingSub && !existingSub.allowEdit) {
      alert("Your submission is already locked and cannot be edited or removed unless unlocked by your instructor.");
      return;
    }

    btn.disabled = true;
    btn.innerHTML = selectedFile
      ? '<i class="fas fa-spinner fa-spin"></i> Uploading Document...'
      : '<i class="fas fa-spinner fa-spin"></i> Submitting...';

    try {
      let fileUrl = existingSub?.fileUrl || "";
      let fileName = existingSub?.fileName || "";

      if (selectedFile) {
        fileUrl = await uploadToCloudinary(selectedFile, "aimser/submissions");
        fileName = selectedFile.name;
      }

      await setDoc(
        doc(db, "classrooms", activeClassroom.id, "activities", actId, "submissions", currentUser.uid),
        {
          studentUid: currentUser.uid,
          studentName: userProfile.fullName,
          studentEmail: currentUser.email,
          notes,
          fileUrl,
          fileName,
          allowEdit: false,
          submittedAt: serverTimestamp()
        },
        { merge: true }
      );

      await logAuditEvent(`${currentUser.email} submitted output for activity ${actId}`, "SUBMISSION", currentUser.email);
      closeModal("modal-activity-detail");
      await loadClassroomActivitiesAndSubmissions(activeClassroom.id, activeClassroom.students || []);
    } catch (err) {
      alert("Submission failed: " + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit';
    }
  });

  document.getElementById("form-hr-analytics")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const headcount = Math.max(1, Number(document.getElementById("an-total-headcount").value));
    const separations = Math.max(0, Number(document.getElementById("an-separations").value));
    const absentDays = Math.max(0, Number(document.getElementById("an-absent-days").value));
    const workDays = Math.max(1, Number(document.getElementById("an-work-days").value));
    const trainBudget = Math.max(0, Number(document.getElementById("an-training-budget").value));
    const trainedStaff = Math.max(1, Number(document.getElementById("an-trained-staff").value));
    const recruitSpend = Math.max(0, Number(document.getElementById("an-recruitment-spend").value));
    const newHires = Math.max(1, Number(document.getElementById("an-new-hires").value));

    const turnoverRate = ((separations / headcount) * 100).toFixed(2) + "%";
    const absenteeismRate = ((absentDays / (headcount * workDays)) * 100).toFixed(2) + "%";
    const trainingCost = "₱" + Math.round(trainBudget / trainedStaff).toLocaleString();
    const recruitmentCost = "₱" + Math.round(recruitSpend / newHires).toLocaleString();

    document.getElementById("res-turnover-rate").textContent = turnoverRate;
    document.getElementById("res-absenteeism-rate").textContent = absenteeismRate;
    document.getElementById("res-training-cost").textContent = trainingCost;
    document.getElementById("res-recruitment-cost").textContent = recruitmentCost;

    studentAbsenteeismRate = absenteeismRate;
    updateStudentPortfolioMetricsAndView();

    if (activeClassroom) {
      await setDoc(doc(db, "classrooms", activeClassroom.id, "analytics_reports", currentUser.uid), {
        studentUid: currentUser.uid,
        studentEmail: currentUser.email,
        turnoverRate,
        absenteeismRate,
        trainingCost,
        recruitmentCost,
        updatedAt: serverTimestamp()
      });
      await logAuditEvent(`${currentUser.email} saved HR Analytics simulation report`, "ANALYTICS", currentUser.email);
      alert("HR Workforce Analytics metrics computed and saved!");
    }
  });

  document.getElementById("btn-open-kpi-modal")?.addEventListener("click", () => {
    if (!activeClassroom) return;
    document.getElementById("kpi-period-name").value = activeClassroom.appraisalPeriod || "";
    document.getElementById("kpi-criteria-list").value = activeClassroom.appraisalKpis || "";
    openModal("modal-kpi-setup");
  });

  document.getElementById("form-set-kpis")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!activeClassroom) return;
    const period = document.getElementById("kpi-period-name").value.trim();
    const kpis = document.getElementById("kpi-criteria-list").value.trim();

    await updateDoc(doc(db, "classrooms", activeClassroom.id), {
      appraisalPeriod: period,
      appraisalKpis: kpis
    });
    activeClassroom.appraisalPeriod = period;
    activeClassroom.appraisalKpis = kpis;

    document.getElementById("appraisal-period-text").textContent = period;
    document.getElementById("appraisal-kpis-text").textContent = kpis;
    closeModal("modal-kpi-setup");
    await logAuditEvent(`Updated class KPIs & appraisal period for ${activeClassroom.sectionCode}`, "PORTFOLIO", currentUser.email);
  });

  document.getElementById("form-student-devplan")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!activeClassroom) {
      alert("Join a classroom first to save your portfolio.");
      return;
    }

    const goals = document.getElementById("port-goals").value.trim();
    const devPlan = document.getElementById("port-devplan").value.trim();
    const selfFeedback = document.getElementById("port-self-feedback").value.trim();

    await setDoc(
      doc(db, "classrooms", activeClassroom.id, "portfolios", currentUser.uid),
      {
        studentUid: currentUser.uid,
        studentName: userProfile.fullName,
        studentEmail: currentUser.email,
        goals,
        devPlan,
        selfFeedback,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
    alert("Personal goals and development plan saved to your Portfolio!");
  });

  document.getElementById("btn-add-portfolio-item")?.addEventListener("click", () => {
    if (!activeClassroom) {
      alert("Join a classroom first.");
      return;
    }
    openModal("modal-portfolio-artifact");
  });

  document.getElementById("form-add-portfolio-item")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!activeClassroom) return;
    const title = document.getElementById("art-title").value.trim();
    const link = document.getElementById("art-link").value.trim();

    await setDoc(
      doc(db, "classrooms", activeClassroom.id, "portfolios", currentUser.uid),
      {
        studentUid: currentUser.uid,
        studentName: userProfile.fullName,
        studentEmail: currentUser.email,
        artifacts: arrayUnion({ title, link, createdAt: new Date().toISOString() })
      },
      { merge: true }
    );
    closeModal("modal-portfolio-artifact");
    e.target.reset();
    await loadPortfolioData(activeClassroom.id, []);
  });
} 

function openModal(id) {
  const m = document.getElementById(id);
  if (m) {
    m.classList.add("is-open");
    m.setAttribute("aria-hidden", "false");
  }
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) {
    m.classList.remove("is-open");
    m.setAttribute("aria-hidden", "true");
  }
}