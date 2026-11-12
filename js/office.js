// js/office.js - Complete Office Workspace, Activities, Classrooms & Join Approval Engine
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
import { FastCache, escapeHtml, checkRateLimit, logAuditEvent } from "./security-utils.js";

let currentUser = null;
let userProfile = null;
let classrooms = [];
let activeClassroom = null;
let currentActivities = [];

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  currentUser = user;

  // Use cached profile first for 0ms role UI setup, then verify
  userProfile = FastCache.get("user_profile");
  if (!userProfile) {
    const snap = await getDoc(doc(db, "users", user.uid));
    const data = snap.exists() ? snap.data() : {};
    userProfile = {
      uid: user.uid,
      email: user.email,
      fullName: data.fullName || user.displayName || user.email.split("@")[0],
      role: (data.role || "student").toLowerCase(),
      avatarUrl: data.avatarUrl || user.photoURL || ""
    };
    FastCache.set("user_profile", userProfile);
  }

  configureRoleControls();
  bindUIEvents();
  await loadUserClassrooms();
});

function configureRoleControls() {
  const isFaculty = userProfile.role === "faculty";
  const actionLabel = document.getElementById("classroom-action-label");
  const newActBtn = document.getElementById("btn-open-new-activity");

  if (actionLabel) actionLabel.textContent = isFaculty ? "Create Section" : "Join Class";
  if (newActBtn) newActBtn.style.display = isFaculty ? "inline-flex" : "none";
}

async function loadUserClassrooms() {
  const select = document.getElementById("active-classroom-select");
  if (!select) return;

  try {
    const snap = await getDocs(collection(db, "classrooms"));
    const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (userProfile.role === "faculty") {
      classrooms = all.filter((c) => c.instructorId === currentUser.uid || c.instructorEmail === currentUser.email);
    } else {
      classrooms = all.filter((c) => {
        const students = c.students || c.enrolled || [];
        return students.some((s) => (typeof s === "string" ? s === currentUser.uid || s === currentUser.email : s.uid === currentUser.uid));
      });
    }

    if (classrooms.length === 0) {
      select.innerHTML = `<option value="">No Active Classrooms</option>`;
      renderEmptyWorkspace();
      return;
    }

    select.innerHTML = classrooms.map((c) =>
      `<option value="${c.id}">${escapeHtml(c.name || "Classroom")} (${escapeHtml(c.sectionCode || c.code || "AIM")})</option>`
    ).join("");

    const savedId = localStorage.getItem("aimser_active_classroom");
    const target = classrooms.find((c) => c.id === savedId) || classrooms[0];
    select.value = target.id;
    await selectClassroom(target.id);
  } catch (err) {
    console.error("Error loading classrooms:", err);
  }
}

async function selectClassroom(classroomId) {
  activeClassroom = classrooms.find((c) => c.id === classroomId) || null;
  if (!activeClassroom) {
    renderEmptyWorkspace();
    return;
  }

  localStorage.setItem("aimser_active_classroom", classroomId);

  const code = activeClassroom.sectionCode || activeClassroom.code || "N/A";
  const students = activeClassroom.students || activeClassroom.enrolled || [];

  document.getElementById("stat-section-code").textContent = code;
  document.getElementById("stat-member-count").textContent = students.length;
  document.getElementById("active-classroom-title").textContent = activeClassroom.name || "Classroom Activities";
  document.getElementById("active-classroom-desc").textContent = activeClassroom.description || `Section Code: ${code} • Instructor: ${activeClassroom.instructorEmail || "Faculty"}`;

  await Promise.all([
    loadClassroomActivities(classroomId),
    loadRosterAndRequests(classroomId, students)
  ]);
}

/**
 * Loads activities from BOTH subcollection 'classrooms/{id}/activities' AND root 'activities'
 * so legacy and newly created activities are guaranteed to render.
 */
async function loadClassroomActivities(classroomId) {
  const container = document.getElementById("activities-container");
  const countEl = document.getElementById("stat-activity-count");
  if (!container) return;

  // Render cached activities instantly if available
  const cachedActs = FastCache.get(`acts_${classroomId}`);
  if (cachedActs) {
    renderActivitiesList(cachedActs);
  }

  try {
    const mergedMap = new Map();

    // Source 1: Subcollection classrooms/{id}/activities
    try {
      const subSnap = await getDocs(collection(db, "classrooms", classroomId, "activities"));
      subSnap.docs.forEach((d) => mergedMap.set(d.id, { id: d.id, source: "sub", ...d.data() }));
    } catch {
      // Subcollection may not exist yet
    }

    // Source 2: Top-level activities collection filtered by classroomId or sectionId
    try {
      const rootSnap = await getDocs(collection(db, "activities"));
      rootSnap.docs.forEach((d) => {
        const data = d.data();
        if (data.classroomId === classroomId || data.sectionId === classroomId) {
          mergedMap.set(d.id, { id: d.id, source: "root", ...data });
        }
      });
    } catch {
      // Root collection optional
    }

    currentActivities = Array.from(mergedMap.values()).sort((a, b) => {
      const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return tB - tA;
    });

    FastCache.set(`acts_${classroomId}`, currentActivities);
    if (countEl) countEl.textContent = currentActivities.length;
    renderActivitiesList(currentActivities);
  } catch (err) {
    console.error("Failed loading activities:", err);
    container.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Unable to load activities</h3></div>`;
  }
}

function renderActivitiesList(activities) {
  const container = document.getElementById("activities-container");
  const countEl = document.getElementById("stat-activity-count");
  if (countEl) countEl.textContent = activities.length;

  if (!activities || activities.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-clipboard-check"></i>
        <h3>No Activities Published Yet</h3>
        <p>${userProfile.role === "faculty" ? "Click 'Post Activity' above to assign an HR simulation case." : "Your instructor has not posted activities for this section yet."}</p>
      </div>`;
    return;
  }

  container.innerHTML = activities.map((act) => `
    <article class="glass-panel" style="display: flex; flex-direction: column; justify-content: space-between;">
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; gap: 0.5rem;">
          <span class="badge-pill">${escapeHtml(act.category || "HR Simulation")}</span>
          <span class="text-muted" style="font-size: 0.75rem;"><i class="far fa-calendar-alt"></i> Due: ${escapeHtml(act.dueDate || "Open")}</span>
        </div>
        <h3 style="font-size: 1.05rem; margin-bottom: 0.5rem; color: var(--text-primary);">${escapeHtml(act.title || "Untitled Activity")}</h3>
        <p class="text-muted" style="font-size: 0.84rem; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;">
          ${escapeHtml(act.instructions || act.description || "")}
        </p>
      </div>

      <div style="margin-top: 1.25rem; padding-top: 0.75rem; border-top: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 0.75rem; color: var(--text-tertiary);">Status: <strong style="color: var(--success);">Active</strong></span>
        <button type="button" class="btn-secondary btn-open-act-detail" data-id="${act.id}" style="padding: 0.35rem 0.8rem; font-size: 0.78rem;">
          <i class="fas fa-folder-open"></i> Open Workspace
        </button>
      </div>
    </article>
  `).join("");

  container.querySelectorAll(".btn-open-act-detail").forEach((btn) => {
    btn.addEventListener("click", () => {
      const act = currentActivities.find((a) => a.id === btn.dataset.id);
      if (act) openActivityDetailModal(act);
    });
  });
}

async function loadRosterAndRequests(classroomId, students) {
  const rosterEl = document.getElementById("roster-list-container");
  const reqWrapper = document.getElementById("join-requests-wrapper");
  const reqList = document.getElementById("join-requests-list");
  const pendingEl = document.getElementById("stat-pending-count");

  // Render Roster
  if (rosterEl) {
    if (students.length === 0) {
      rosterEl.innerHTML = `<div class="empty-state"><i class="fas fa-user-friends"></i><h3>No Students Enrolled</h3><p>Share section code <strong>${escapeHtml(activeClassroom.sectionCode || "")}</strong> with your class.</p></div>`;
    } else {
      rosterEl.innerHTML = students.map((s) => {
        const label = typeof s === "string" ? s : (s.fullName || s.email || s.uid);
        const email = typeof s === "object" ? (s.email || "") : "";
        return `
          <div class="glass-panel" style="display: flex; align-items: center; gap: 0.75rem; padding: 0.9rem 1rem;">
            <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(label)}&background=1b5375&color=faf2dd" alt="" class="avatar-sm" />
            <div>
              <div style="font-weight: 600; font-size: 0.9rem;">${escapeHtml(label)}</div>
              <div class="text-muted" style="font-size: 0.75rem;">${escapeHtml(email || "Enrolled Participant")}</div>
            </div>
          </div>`;
      }).join("");
    }
  }

  // Load Pending Join Requests (Faculty Only)
  if (userProfile.role === "faculty" && reqWrapper && reqList) {
    try {
      const q = query(collection(db, "join_requests"), where("classroomId", "==", classroomId));
      const snap = await getDocs(q);
      const pending = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => r.status === "pending");

      if (pendingEl) pendingEl.textContent = pending.length;
      if (pending.length === 0) {
        reqWrapper.style.display = "none";
      } else {
        reqWrapper.style.display = "block";
        reqList.innerHTML = pending.map((req) => `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1rem; border-radius: var(--radius-sm); background: var(--bg-surface); border: 1px solid var(--border-medium);">
            <div>
              <strong>${escapeHtml(req.studentName || req.studentEmail)}</strong>
              <span class="text-muted" style="font-size: 0.8rem; margin-left: 0.5rem;">(${escapeHtml(req.studentEmail)})</span>
            </div>
            <div style="display: flex; gap: 0.5rem;">
              <button type="button" class="btn-primary btn-approve-req" data-req-id="${req.id}" data-uid="${req.studentUid}" data-name="${escapeHtml(req.studentName || req.studentEmail)}" data-email="${escapeHtml(req.studentEmail)}" style="padding: 0.35rem 0.75rem; font-size: 0.78rem;">
                <i class="fas fa-check"></i> Approve
              </button>
              <button type="button" class="btn-sidebar-action btn-logout btn-reject-req" data-req-id="${req.id}" style="width: auto; padding: 0.35rem 0.75rem; font-size: 0.78rem;">
                Decline
              </button>
            </div>
          </div>
        `).join("");

        reqList.querySelectorAll(".btn-approve-req").forEach((btn) => {
          btn.addEventListener("click", async () => {
            btn.disabled = true;
            await updateDoc(doc(db, "classrooms", classroomId), {
              students: arrayUnion({
                uid: btn.dataset.uid,
                fullName: btn.dataset.name,
                email: btn.dataset.email
              })
            });
            await updateDoc(doc(db, "join_requests", btn.dataset.reqId), { status: "approved" });
            await logAuditEvent(`Approved ${btn.dataset.email} into ${activeClassroom.sectionCode}`, "CLASSROOM", userProfile.email);
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
      console.warn("Join request check skipped:", err.message);
    }
  }
}

function renderEmptyWorkspace() {
  document.getElementById("stat-section-code").textContent = "—";
  document.getElementById("stat-activity-count").textContent = "0";
  document.getElementById("stat-member-count").textContent = "0";
  document.getElementById("activities-container").innerHTML = `
    <div class="empty-state">
      <i class="fas fa-chalkboard-teacher"></i>
      <h3>No Classroom Selected</h3>
      <p>${userProfile.role === "faculty" ? "Click 'Create Section' in the header to launch your first HR simulation classroom." : "Click 'Join Class' in the header and enter your instructor's class code."}</p>
    </div>`;
}

function openActivityDetailModal(act) {
  document.getElementById("detail-act-id").value = act.id;
  document.getElementById("detail-act-title").textContent = act.title || "Activity";
  document.getElementById("detail-act-badge").textContent = act.category || "HR Simulation";
  document.getElementById("detail-act-due").textContent = `Due: ${act.dueDate || "Open"}`;
  document.getElementById("detail-act-desc").textContent = act.instructions || act.description || "";
  document.getElementById("deliverable-notes").value = "";
  openModal("modal-activity-detail");
}

function bindUIEvents() {
  // Subnav Tabs
  document.querySelectorAll(".subnav-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".subnav-tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(tab.dataset.tab)?.classList.add("active");
    });
  });

  // Modal Close Buttons
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
  });

  // Switch Classroom Dropdown
  document.getElementById("active-classroom-select")?.addEventListener("change", (e) => {
    if (e.target.value) selectClassroom(e.target.value);
  });

  // Refresh Button
  document.getElementById("btn-refresh-office")?.addEventListener("click", () => {
    if (activeClassroom) selectClassroom(activeClassroom.id);
  });

  // Open Create/Join Classroom Modal
  document.getElementById("btn-open-classroom-action")?.addEventListener("click", () => {
    const isFaculty = userProfile.role === "faculty";
    document.getElementById("modal-classroom-title").textContent = isFaculty ? "Create New Classroom Section" : "Join Classroom Section";
    document.getElementById("form-create-classroom").style.display = isFaculty ? "block" : "none";
    document.getElementById("form-join-classroom").style.display = isFaculty ? "none" : "block";
    openModal("modal-classroom");
  });

  // Submit Create Classroom (Faculty)
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
        instructorId: currentUser.uid,
        instructorEmail: currentUser.email,
        students: [],
        activityCount: 0,
        createdAt: serverTimestamp()
      });
      await logAuditEvent(`Faculty ${currentUser.email} created classroom ${name} (${code})`, "CLASSROOM", currentUser.email);
      localStorage.setItem("aimser_active_classroom", docRef.id);
      closeModal("modal-classroom");
      e.target.reset();
      await loadUserClassrooms();
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // Submit Join Classroom Request (Student)
  document.getElementById("form-join-classroom")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-join-class");
    const code = document.getElementById("join-class-code").value.trim().toUpperCase();

    btn.disabled = true;
    try {
      checkRateLimit("join_class", 5, 60000);
      const snap = await getDocs(collection(db, "classrooms"));
      const match = snap.docs.find((d) => (d.data().sectionCode || d.data().code || "").toUpperCase() === code);
      if (!match) throw new Error(`No classroom found with code "${code}".`);

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
      alert(`Join request sent for ${match.data().name}. Awaiting faculty approval.`);
      closeModal("modal-classroom");
      e.target.reset();
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // Open Publish Activity Modal
  document.getElementById("btn-open-new-activity")?.addEventListener("click", () => {
    if (!activeClassroom) {
      alert("Please create or select a classroom first.");
      return;
    }
    openModal("modal-activity");
  });

  // Submit New Activity
  document.getElementById("form-create-activity")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!activeClassroom) return;
    const btn = document.getElementById("btn-submit-activity");

    const title = document.getElementById("act-title").value.trim();
    const category = document.getElementById("act-category").value;
    const dueDate = document.getElementById("act-due-date").value;
    const instructions = document.getElementById("act-instructions").value.trim();

    btn.disabled = true;
    try {
      checkRateLimit("create_act", 8, 60000);
      await addDoc(collection(db, "classrooms", activeClassroom.id, "activities"), {
        title,
        category,
        dueDate,
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
      await loadClassroomActivities(activeClassroom.id);
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // Submit Activity Deliverable
  document.getElementById("form-submit-deliverable")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!activeClassroom) return;
    const btn = document.getElementById("btn-save-deliverable");
    const actId = document.getElementById("detail-act-id").value;
    const notes = document.getElementById("deliverable-notes").value.trim();

    btn.disabled = true;
    try {
      await setDoc(doc(db, "classrooms", activeClassroom.id, "activities", actId, "submissions", currentUser.uid), {
        studentUid: currentUser.uid,
        studentName: userProfile.fullName,
        studentEmail: currentUser.email,
        notes,
        submittedAt: serverTimestamp()
      });
      await logAuditEvent(`${currentUser.email} submitted deliverable for activity ${actId}`, "SUBMISSION", currentUser.email);
      alert("Deliverable submitted successfully!");
      closeModal("modal-activity-detail");
    } catch (err) {
      alert("Submission failed: " + err.message);
    } finally {
      btn.disabled = false;
    }
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