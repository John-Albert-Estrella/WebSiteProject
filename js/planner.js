// js/planner.js - Project Planner (15-Member Capacity, Positions, Hierarchy, Deadlines, Kanban Edit & Onboarding)
import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  arrayUnion,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { FastCache, escapeHtml, checkRateLimit, logAuditEvent } from "./security-utils.js";

const MAX_TEAM_CAPACITY = 15;

let currentUser = null;
let userProfile = null;
let teams = [];
let activeTeam = null;
let currentTasks = [];

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
      role: (data.role || "student").toLowerCase()
    };
    FastCache.set("user_profile", userProfile);
  }

  bindPlannerEvents();

  const cachedTeams = FastCache.get("planner_teams");
  if (cachedTeams && cachedTeams.length > 0) {
    teams = cachedTeams;
    await populateTeamDropdown();
  }

  await loadTeams();
});

function renderRoleBadge(role) {
  const normalized = (role || "student").toLowerCase();
  const isFac = normalized === "faculty";
  const bg = isFac ? "rgba(56, 189, 248, 0.16)" : "rgba(16, 185, 129, 0.16)";
  const color = isFac ? "#38bdf8" : "#10b981";
  return `<span style="display:inline-block;padding:0.15rem 0.55rem;border-radius:9999px;font-size:0.68rem;font-weight:700;text-transform:uppercase;background:${bg};color:${color};letter-spacing:0.04em;">${escapeHtml(normalized)}</span>`;
}

async function loadTeams() {
  try {
    const snap = await getDocs(collection(db, "teams"));
    const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    teams = all.filter((t) => (t.members || []).includes(currentUser.uid));
    FastCache.set("planner_teams", teams);
    await populateTeamDropdown();
  } catch (err) {
    console.error("Failed loading teams:", err);
  }
}

async function populateTeamDropdown() {
  const select = document.getElementById("planner-team-select");
  if (!select) return;

  if (teams.length === 0) {
    select.innerHTML = `<option value="">No Team Rooms Joined</option>`;
    clearPlannerViews();
    return;
  }

  select.innerHTML = teams
    .map((t) => `<option value="${t.id}">${escapeHtml(t.name)} (${escapeHtml(t.inviteCode || "TEAM")})</option>`)
    .join("");

  const savedTeamId = localStorage.getItem("aimser_active_team");
  const target = teams.find((t) => t.id === savedTeamId) || teams[0];
  select.value = target.id;
  await selectTeam(target.id);
}

async function selectTeam(teamId) {
  activeTeam = teams.find((t) => t.id === teamId) || null;
  if (!activeTeam) {
    clearPlannerViews();
    return;
  }

  localStorage.setItem("aimser_active_team", teamId);

  const members = activeTeam.members || [];
  document.getElementById("team-invite-code").textContent = activeTeam.inviteCode || "—";
  document.getElementById("team-member-count").textContent = `${members.length} / ${MAX_TEAM_CAPACITY}`;

  renderHierarchyAndPositions();
  await Promise.all([loadTasks(teamId), loadOnboardingChecklist(teamId)]);
}

async function loadTasks(teamId) {
  const cachedTasks = FastCache.get(`planner_tasks_${teamId}`);
  if (cachedTasks) {
    currentTasks = cachedTasks;
    renderKanbanTasks(currentTasks, teamId);
  }

  try {
    const snap = await getDocs(collection(db, "teams", teamId, "tasks"));
    currentTasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    FastCache.set(`planner_tasks_${teamId}`, currentTasks);
    renderKanbanTasks(currentTasks, teamId);
  } catch (err) {
    console.error("Error loading tasks:", err);
  }
}

function renderKanbanTasks(tasks, teamId) {
  const countTotal = document.getElementById("team-task-count");
  if (countTotal) countTotal.textContent = tasks.length;

  const buckets = { todo: [], inprogress: [], review: [], done: [] };
  tasks.forEach((t) => {
    const status = buckets[t.status] ? t.status : "todo";
    buckets[status].push(t);
  });

  Object.entries(buckets).forEach(([status, list]) => {
    const col = document.getElementById(`col-${status}`);
    const badge = document.getElementById(`count-${status}`);
    if (badge) badge.textContent = list.length;
    if (!col) return;

    col.innerHTML =
      list.length === 0
        ? `<div class="text-muted" style="text-align:center;padding:1.5rem 0.5rem;font-size:0.8rem;border:1px dashed var(--border-subtle);border-radius:var(--radius-sm);">No tasks in this stage</div>`
        : list
            .map((task) => {
              const isOverdue = task.deadline && status !== "done" && new Date(task.deadline).getTime() < Date.now();
              const dueColor = isOverdue ? "var(--danger)" : "var(--text-tertiary)";

              return `
                <div style="padding:0.85rem;border-radius:var(--radius-sm);background:var(--bg-surface);border:1px solid var(--border-medium);">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem;gap:0.35rem;">
                    <span class="badge-pill" style="font-size:0.68rem;">${escapeHtml(task.positionTag || task.priority || "Task")}</span>
                    <div style="display:flex;align-items:center;gap:0.45rem;">
                      <button type="button" class="btn-edit-task" data-id="${task.id}" style="background:none;border:none;color:var(--aimser-blue-400);cursor:pointer;font-size:0.8rem;" title="Edit Task"><i class="fas fa-pen"></i></button>
                      <button type="button" class="btn-del-task" data-id="${task.id}" style="background:none;border:none;color:var(--text-tertiary);cursor:pointer;font-size:1rem;" title="Remove Task">&times;</button>
                    </div>
                  </div>
                  <div style="font-weight:600;font-size:0.9rem;margin-bottom:0.35rem;color:var(--text-primary);">${escapeHtml(task.title)}</div>
                  ${task.responsibility ? `<p class="text-muted" style="font-size:0.78rem;line-height:1.4;margin-bottom:0.5rem;">${escapeHtml(task.responsibility)}</p>` : ""}
                  <div style="font-size:0.75rem;color:var(--text-secondary);margin-bottom:0.3rem;">
                    <i class="fas fa-user-tag"></i> ${escapeHtml(task.assigneeName || task.assignee || "Unassigned")}
                  </div>
                  <div style="font-size:0.74rem;color:${dueColor};margin-bottom:0.65rem;">
                    <i class="far fa-calendar-alt"></i> Deadline: ${escapeHtml(task.deadline || "Flexible")} ${isOverdue ? "(Overdue)" : ""}
                  </div>
                  <select class="form-select task-status-mover" data-id="${task.id}" style="padding:0.28rem 0.5rem;font-size:0.75rem;">
                    <option value="todo" ${status === "todo" ? "selected" : ""}>To Do</option>
                    <option value="inprogress" ${status === "inprogress" ? "selected" : ""}>In Progress</option>
                    <option value="review" ${status === "review" ? "selected" : ""}>Under Review</option>
                    <option value="done" ${status === "done" ? "selected" : ""}>Completed</option>
                  </select>
                </div>`;
            })
            .join("");

    col.querySelectorAll(".btn-edit-task").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetTask = currentTasks.find((t) => t.id === btn.dataset.id);
        if (!targetTask) return;
        document.getElementById("edit-task-id").value = targetTask.id;
        document.getElementById("edit-task-title").value = targetTask.title || "";
        document.getElementById("edit-task-assignee").value = targetTask.assigneeName || targetTask.assignee || "";
        document.getElementById("edit-task-deadline").value = targetTask.deadline || "";
        document.getElementById("edit-task-position-tag").value = targetTask.positionTag || "";
        document.getElementById("edit-task-priority").value = targetTask.priority || "Normal";
        document.getElementById("edit-task-responsibility").value = targetTask.responsibility || "";
        openModal("modal-edit-task");
      });
    });

    col.querySelectorAll(".task-status-mover").forEach((sel) => {
      sel.addEventListener("change", async (e) => {
        await updateDoc(doc(db, "teams", teamId, "tasks", sel.dataset.id), {
          status: e.target.value,
          updatedAt: serverTimestamp()
        });
        await loadTasks(teamId);
      });
    });

    col.querySelectorAll(".btn-del-task").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await deleteDoc(doc(db, "teams", teamId, "tasks", btn.dataset.id));
        await loadTasks(teamId);
      });
    });
  });
}

function renderHierarchyAndPositions() {
  const grid = document.getElementById("hierarchy-members-grid");
  const assigneeSelect = document.getElementById("task-assignee");
  const editAssigneeSelect = document.getElementById("edit-task-assignee");
  if (!grid || !activeTeam) return;

  const profilesMap = activeTeam.memberProfiles || {};
  const memberUids = activeTeam.members || [];

  const membersList = memberUids
    .map((uid) => {
      const info = profilesMap[uid] || {};
      const isLeader = uid === activeTeam.leaderUid;
      return {
        uid,
        fullName: info.fullName || (uid === currentUser.uid ? userProfile.fullName : `Member (${uid.slice(0, 5)})`),
        roleBadge: info.roleBadge || "student",
        tier: info.tier || (isLeader ? "1 - Team Leader" : "4 - Project Associate"),
        position: info.position || (isLeader ? "Team Leader" : "HR Project Member"),
        responsibilities: info.responsibilities || "Collaborate on HR simulation deliverables, onboarding workflows, and assigned tasks."
      };
    })
    .sort((a, b) => a.tier.localeCompare(b.tier));

  const optionsHtml = membersList
    .map((m) => `<option value="${escapeHtml(m.fullName)}">${escapeHtml(m.fullName)} (${escapeHtml(m.position)})</option>`)
    .join("");

  if (assigneeSelect) assigneeSelect.innerHTML = optionsHtml;
  if (editAssigneeSelect) editAssigneeSelect.innerHTML = optionsHtml;

  grid.innerHTML = membersList
    .map(
      (m) => `
      <div class="glass-panel" style="display:flex;flex-direction:column;justify-content:space-between;">
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.65rem;gap:0.4rem;flex-wrap:wrap;">
            <span class="badge-pill">${escapeHtml(m.tier)}</span>
            ${renderRoleBadge(m.roleBadge)}
          </div>
          <h3 style="font-size:1.05rem;margin-bottom:0.2rem;">${escapeHtml(m.fullName)}</h3>
          <div style="font-size:0.84rem;font-weight:600;color:#38bdf8;margin-bottom:0.65rem;">
            <i class="fas fa-id-badge"></i> ${escapeHtml(m.position)}
          </div>
          <p class="text-muted" style="font-size:0.82rem;line-height:1.5;">
            <strong>Responsibilities:</strong> ${escapeHtml(m.responsibilities)}
          </p>
        </div>

        <div style="margin-top:1rem;padding-top:0.75rem;border-top:1px solid var(--border-subtle);display:flex;justify-content:flex-end;">
          <button type="button" class="btn-secondary btn-open-pos-modal" data-uid="${m.uid}" data-name="${escapeHtml(m.fullName)}" data-tier="${escapeHtml(m.tier)}" data-pos="${escapeHtml(m.position)}" data-resp="${escapeHtml(m.responsibilities)}" style="padding:0.35rem 0.75rem;font-size:0.78rem;">
            <i class="fas fa-user-edit"></i> Assign Position &amp; Duties
          </button>
        </div>
      </div>`
    )
    .join("");

  grid.querySelectorAll(".btn-open-pos-modal").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById("pos-member-uid").value = btn.dataset.uid;
      document.getElementById("pos-member-name").value = btn.dataset.name;
      document.getElementById("pos-hierarchy-tier").value = btn.dataset.tier;
      document.getElementById("pos-job-title").value = btn.dataset.pos;
      document.getElementById("pos-responsibilities").value = btn.dataset.resp;
      openModal("modal-assign-position");
    });
  });
}

async function loadOnboardingChecklist(teamId) {
  const container = document.getElementById("onboarding-checklist-container");
  const pctEl = document.getElementById("team-onboarding-pct");
  if (!container) return;

  try {
    const snap = await getDocs(collection(db, "teams", teamId, "onboarding"));
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (items.length === 0) {
      const defaults = [
        { title: "Pre-Boarding: Employment Contract & Statutory Requirements Audit", owner: "HR Recruitment Lead", dueDate: "Day 1", completed: false },
        { title: "Orientation: Company Culture, Code of Conduct & Policy Briefing", owner: "HR Operations Specialist", dueDate: "Day 2", completed: false },
        { title: "Role Integration: 30-60-90 Day KPI & Competency Alignment", owner: "Team Leader", dueDate: "Week 1", completed: false }
      ];
      for (const item of defaults) {
        const ref = await addDoc(collection(db, "teams", teamId, "onboarding"), { ...item, createdAt: serverTimestamp() });
        items.push({ id: ref.id, ...item });
      }
    }

    const doneCount = items.filter((i) => i.completed).length;
    const pct = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0;
    if (pctEl) pctEl.textContent = `${pct}%`;

    container.innerHTML = items
      .map(
        (item) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:0.85rem 1rem;border-radius:var(--radius-sm);background:var(--bg-surface);border:1px solid var(--border-medium);gap:1rem;">
          <label style="display:flex;align-items:center;gap:0.75rem;cursor:pointer;flex:1;">
            <input type="checkbox" class="onb-checkbox" data-id="${item.id}" ${item.completed ? "checked" : ""} style="width:18px;height:18px;accent-color:var(--success);" />
            <div>
              <div style="font-weight:600;font-size:0.9rem;text-decoration:${item.completed ? "line-through" : "none"};color:${item.completed ? "var(--text-tertiary)" : "var(--text-primary)"};">
                ${escapeHtml(item.title)}
              </div>
              <div class="text-muted" style="font-size:0.76rem;">
                Owner: <strong>${escapeHtml(item.owner || "Team")}</strong> • Target: ${escapeHtml(item.dueDate || "TBD")}
              </div>
            </div>
          </label>
          <button type="button" class="btn-sidebar-action btn-logout btn-del-onb" data-id="${item.id}" style="width:auto;padding:0.3rem 0.6rem;font-size:0.75rem;">
            <i class="fas fa-trash"></i>
          </button>
        </div>`
      )
      .join("");

    container.querySelectorAll(".onb-checkbox").forEach((cb) => {
      cb.addEventListener("change", async () => {
        await updateDoc(doc(db, "teams", teamId, "onboarding", cb.dataset.id), {
          completed: cb.checked
        });
        await loadOnboardingChecklist(teamId);
      });
    });

    container.querySelectorAll(".btn-del-onb").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await deleteDoc(doc(db, "teams", teamId, "onboarding", btn.dataset.id));
        await loadOnboardingChecklist(teamId);
      });
    });
  } catch (err) {
    console.error("Onboarding checklist error:", err);
  }
}

function clearPlannerViews() {
  document.getElementById("team-invite-code").textContent = "—";
  document.getElementById("team-member-count").textContent = `0 / ${MAX_TEAM_CAPACITY}`;
  document.getElementById("team-task-count").textContent = "0";
  document.getElementById("team-onboarding-pct").textContent = "0%";
  ["todo", "inprogress", "review", "done"].forEach((s) => {
    const col = document.getElementById(`col-${s}`);
    const badge = document.getElementById(`count-${s}`);
    if (col) col.innerHTML = "";
    if (badge) badge.textContent = "0";
  });
  const grid = document.getElementById("hierarchy-members-grid");
  if (grid) {
    grid.innerHTML = `<div class="empty-state"><i class="fas fa-users"></i><h3>No Team Room Active</h3><p>Click "Create / Join Team" above to start a team workspace (1 Team Leader + up to 14 members).</p></div>`;
  }
}

function bindPlannerEvents() {
  document.querySelectorAll(".subnav-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".subnav-tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(tab.dataset.tab)?.classList.add("active");
    });
  });

  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
  });

  document.getElementById("planner-team-select")?.addEventListener("change", (e) => {
    if (e.target.value) selectTeam(e.target.value);
  });

  document.getElementById("btn-open-team-modal")?.addEventListener("click", () => openModal("modal-team"));

  document.getElementById("btn-open-task-modal")?.addEventListener("click", () => {
    if (!activeTeam) {
      alert("Create or join a team room first.");
      return;
    }
    openModal("modal-task");
  });

  document.getElementById("btn-open-onboarding-modal")?.addEventListener("click", () => {
    if (!activeTeam) {
      alert("Create or join a team room first.");
      return;
    }
    openModal("modal-onboarding-item");
  });

  document.getElementById("form-create-team")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("new-team-name").value.trim();
    const projectScope = document.getElementById("new-team-project").value.trim();
    const inviteCode = "TM-" + Math.random().toString(36).substring(2, 6).toUpperCase();

    try {
      checkRateLimit("create_team", 5, 60000);
      const docRef = await addDoc(collection(db, "teams"), {
        name,
        projectScope,
        inviteCode,
        leaderUid: currentUser.uid,
        maxMembers: MAX_TEAM_CAPACITY,
        members: [currentUser.uid],
        memberProfiles: {
          [currentUser.uid]: {
            fullName: userProfile.fullName,
            roleBadge: userProfile.role,
            tier: "1 - Team Leader",
            position: "Team Leader",
            responsibilities: `Lead "${projectScope}" and coordinate team deliverables.`
          }
        },
        createdBy: currentUser.email,
        createdAt: serverTimestamp()
      });

      await logAuditEvent(`Created team room "${name}" (${inviteCode})`, "TEAM", currentUser.email);
      localStorage.setItem("aimser_active_team", docRef.id);
      closeModal("modal-team");
      e.target.reset();
      alert(`Team Room Created! Share Room Code: ${inviteCode} (1 Team Leader + up to 14 members).`);
      await loadTeams();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById("form-join-team")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = document.getElementById("join-team-code").value.trim().toUpperCase();

    try {
      checkRateLimit("join_team", 6, 60000);
      const snap = await getDocs(collection(db, "teams"));
      const match = snap.docs.find((d) => (d.data().inviteCode || "").toUpperCase() === code);
      if (!match) throw new Error(`No team room found with code "${code}".`);

      const teamData = match.data();
      const members = teamData.members || [];

      if (members.includes(currentUser.uid)) {
        throw new Error("You are already a member of this team room.");
      }

      if (members.length >= MAX_TEAM_CAPACITY) {
        throw new Error(`Team room capacity reached (Maximum ${MAX_TEAM_CAPACITY} members: 1 Team Leader + 14 members).`);
      }

      await updateDoc(doc(db, "teams", match.id), {
        members: arrayUnion(currentUser.uid),
        [`memberProfiles.${currentUser.uid}`]: {
          fullName: userProfile.fullName,
          roleBadge: userProfile.role,
          tier: "4 - Project Associate",
          position: "HR Project Associate",
          responsibilities: "Execute assigned project tasks and onboarding checklist items."
        }
      });

      await logAuditEvent(`${currentUser.email} joined team room ${code}`, "TEAM", currentUser.email);
      localStorage.setItem("aimser_active_team", match.id);
      closeModal("modal-team");
      e.target.reset();
      await loadTeams();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById("form-create-task")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!activeTeam) return;

    const title = document.getElementById("task-title").value.trim();
    const assigneeName = document.getElementById("task-assignee").value;
    const deadline = document.getElementById("task-deadline").value;
    const positionTag = document.getElementById("task-position-tag").value.trim();
    const priority = document.getElementById("task-priority").value;
    const responsibility = document.getElementById("task-responsibility").value.trim();

    await addDoc(collection(db, "teams", activeTeam.id, "tasks"), {
      title,
      assigneeName,
      deadline,
      positionTag,
      priority,
      responsibility,
      status: "todo",
      createdAt: serverTimestamp()
    });

    closeModal("modal-task");
    e.target.reset();
    await loadTasks(activeTeam.id);
  });

  document.getElementById("form-edit-task")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!activeTeam) return;

    const taskId = document.getElementById("edit-task-id").value;
    const title = document.getElementById("edit-task-title").value.trim();
    const assigneeName = document.getElementById("edit-task-assignee").value;
    const deadline = document.getElementById("edit-task-deadline").value;
    const positionTag = document.getElementById("edit-task-position-tag").value.trim();
    const priority = document.getElementById("edit-task-priority").value;
    const responsibility = document.getElementById("edit-task-responsibility").value.trim();

    await updateDoc(doc(db, "teams", activeTeam.id, "tasks", taskId), {
      title,
      assigneeName,
      deadline,
      positionTag,
      priority,
      responsibility,
      updatedAt: serverTimestamp()
    });

    closeModal("modal-edit-task");
    await loadTasks(activeTeam.id);
  });

  document.getElementById("form-assign-position")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!activeTeam) return;

    const uid = document.getElementById("pos-member-uid").value;
    const name = document.getElementById("pos-member-name").value;
    const tier = document.getElementById("pos-hierarchy-tier").value;
    const position = document.getElementById("pos-job-title").value.trim();
    const responsibilities = document.getElementById("pos-responsibilities").value.trim();

    const existingBadge =
      activeTeam.memberProfiles?.[uid]?.roleBadge || (uid === currentUser.uid ? userProfile.role : "student");

    await updateDoc(doc(db, "teams", activeTeam.id), {
      [`memberProfiles.${uid}`]: {
        fullName: name,
        roleBadge: existingBadge,
        tier,
        position,
        responsibilities
      }
    });

    closeModal("modal-assign-position");
    await loadTeams();
  });

  document.getElementById("form-add-onboarding")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!activeTeam) return;

    const title = document.getElementById("onb-step-title").value.trim();
    const owner = document.getElementById("onb-owner").value.trim();
    const dueDate = document.getElementById("onb-due-date").value;

    await addDoc(collection(db, "teams", activeTeam.id, "onboarding"), {
      title,
      owner,
      dueDate,
      completed: false,
      createdAt: serverTimestamp()
    });

    closeModal("modal-onboarding-item");
    e.target.reset();
    await loadOnboardingChecklist(activeTeam.id);
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