// js/planner.js - Project Planner (Trello-Style Inspector, Attachments, Comments, Archive Space, Status Palette & Action Checklists)
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
import { uploadToCloudinary, resolveAndDownloadAttachment } from "./cloudinary-config.js";
import { FastCache, escapeHtml, sanitizeUrl, checkRateLimit, logAuditEvent } from "./security-utils.js";

const MAX_TEAM_CAPACITY = 15;

const DEFAULT_STATUS_COLORS = {
  todo: "#94a3b8",
  inprogress: "#3b82f6",
  review: "#f59e0b",
  done: "#10b981"
};

const STATUS_LABELS = {
  todo: "To Do",
  inprogress: "In Progress",
  review: "Under Review",
  done: "Completed"
};

let currentUser = null;
let userProfile = null;
let teams = [];
let activeTeam = null;
let currentTasks = [];
let activeTaskDetailId = null;
let showingArchivedSpace = false;
let activeStatusColors = { ...DEFAULT_STATUS_COLORS };

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

  loadSavedStatusColors(null);
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
  return `<span class="badge-pill role-badge-fixed ${isFac ? "role-pill-faculty" : "role-pill-student"}">${escapeHtml(normalized.toUpperCase())}</span>`;
}

function hexToRgba(hex, alpha = 0.16) {
  const clean = String(hex || "").replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return `rgba(148, 163, 184, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applyStatusColorsToCSS(colorsObj) {
  activeStatusColors = {
    todo: colorsObj?.todo || DEFAULT_STATUS_COLORS.todo,
    inprogress: colorsObj?.inprogress || DEFAULT_STATUS_COLORS.inprogress,
    review: colorsObj?.review || DEFAULT_STATUS_COLORS.review,
    done: colorsObj?.done || DEFAULT_STATUS_COLORS.done
  };

  const root = document.documentElement;
  Object.entries(activeStatusColors).forEach(([key, hex]) => {
    root.style.setProperty(`--status-${key}-color`, hex);
    root.style.setProperty(`--status-${key}-bg`, hexToRgba(hex, 0.18));
    root.style.setProperty(`--status-${key}-border`, hexToRgba(hex, 0.42));

    const inputEl = document.getElementById(`color-input-${key}`);
    if (inputEl) inputEl.value = hex;
  });
}

function loadSavedStatusColors(teamObj) {
  if (teamObj && teamObj.statusColors) {
    applyStatusColorsToCSS(teamObj.statusColors);
    return;
  }
  try {
    const localColors = JSON.parse(localStorage.getItem("aimser_status_colors") || "null");
    if (localColors) {
      applyStatusColorsToCSS(localColors);
      return;
    }
  } catch {
    // Ignore
  }
  applyStatusColorsToCSS(DEFAULT_STATUS_COLORS);
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
    .map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`)
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
  loadSavedStatusColors(activeTeam);

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
    renderPlannerNotifications(currentTasks);

    if (activeTaskDetailId) {
      const updated = currentTasks.find((t) => t.id === activeTaskDetailId);
      if (updated) populateTrelloTaskModal(updated);
    }
  } catch (err) {
    console.error("Error loading tasks:", err);
  }
}

function renderPlannerNotifications(tasks) {
  const badge = document.getElementById("notif-badge");
  const list = document.getElementById("notifications-feed-list");
  if (!list) return;

  const activeAlerts = tasks.filter((t) => !t.archived && t.status !== "done");
  if (badge) {
    if (activeAlerts.length > 0) {
      badge.style.display = "inline-block";
      badge.textContent = activeAlerts.length;
    } else {
      badge.style.display = "none";
    }
  }

  if (activeAlerts.length === 0) {
    list.innerHTML = `<div class="empty-state"><i class="fas fa-check-circle"></i><h3>All Team Tasks Completed</h3><p>No pending tasks or overdue milestones.</p></div>`;
    return;
  }

  list.innerHTML = activeAlerts
    .map(
      (t) => `
      <div class="inspector-meta-item">
        <div class="panel-toolbar">
          <strong class="text-ellipsis">${escapeHtml(t.title)}</strong>
          <span class="status-chip status-chip-${escapeHtml(t.status || "todo")}">
            <span class="status-dot"></span>
            <span>${escapeHtml(STATUS_LABELS[t.status] || "To Do")}</span>
          </span>
        </div>
        <p class="text-muted text-ellipsis">Assignee: ${escapeHtml(t.assigneeName || "Team")} • Due: ${escapeHtml(t.deadline || "Flexible")}</p>
      </div>`
    )
    .join("");
}

function renderKanbanTasks(tasks, teamId) {
  const activeTasks = tasks.filter((t) => !t.archived);
  const archivedTasks = tasks.filter((t) => Boolean(t.archived));

  const countTotal = document.getElementById("team-task-count");
  if (countTotal) countTotal.textContent = activeTasks.length;

  const archiveLabel = document.getElementById("archived-toggle-label");
  if (archiveLabel) {
    archiveLabel.textContent = showingArchivedSpace
      ? "Active Board"
      : `Archived (${archivedTasks.length})`;
  }

  const buckets = { todo: [], inprogress: [], review: [], done: [] };
  activeTasks.forEach((t) => {
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
        ? `<div class="kanban-empty-slot">No tasks in this stage</div>`
        : list.map((task) => buildKanbanCardHtml(task, status)).join("");

    bindKanbanCardEvents(col, teamId);
  });

  // Render Archived Tasks Grid
  const archivedGrid = document.getElementById("archived-tasks-grid");
  if (archivedGrid) {
    archivedGrid.innerHTML =
      archivedTasks.length === 0
        ? `<div class="empty-state"><i class="fas fa-box-open"></i><h3>No Archived Tasks</h3><p>Archive completed or inactive cards from the board to keep your columns compact.</p></div>`
        : archivedTasks.map((task) => buildKanbanCardHtml(task, task.status || "done", true)).join("");

    bindKanbanCardEvents(archivedGrid, teamId);
  }
}

// Builds Compact Kanban Card:
// - Edit/Archive/Delete icons pinned to upper-right corner (never shift with/without text)
// - Long text truncated with ellipsis (...)
// - Select options have bullet removed ("To Do (Not started)", "In Progress", "Under Review", "Completed (Done)")
function buildKanbanCardHtml(task, status, isArchivedCard = false) {
  const isOverdue = task.deadline && status !== "done" && new Date(task.deadline).getTime() < Date.now();
  const statusLabel = STATUS_LABELS[status] || "To Do";
  const attachCount = (task.attachments || []).length;
  const commentCount = (task.comments || []).length;

  return `
    <article class="kanban-task-card kanban-task-${status}" data-task-id="${task.id}">
      <div class="kanban-card-top-bar">
        <div class="kanban-card-badges">
          <span class="status-chip status-chip-${status}">
            <span class="status-dot"></span>
            <span>${escapeHtml(statusLabel)}</span>
          </span>
          <span class="badge-pill">${escapeHtml(task.priority || "Normal")}</span>
        </div>
        <div class="kanban-card-actions">
          <button type="button" class="btn-card-icon btn-edit-task" data-id="${task.id}" title="Edit Task">
            <i class="fas fa-pen"></i>
          </button>
          <button type="button" class="btn-card-icon btn-archive-task" data-id="${task.id}" data-archived="${Boolean(task.archived)}" title="${isArchivedCard ? "Restore to Board" : "Archive Card"}">
            <i class="fas ${isArchivedCard ? "fa-box-open" : "fa-archive"}"></i>
          </button>
          <button type="button" class="btn-card-icon btn-del-task" data-id="${task.id}" title="Delete Task">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>

      <h4 class="kanban-task-title text-ellipsis" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</h4>
      <p class="text-muted text-ellipsis" title="${escapeHtml(task.responsibility || "")}">
        ${escapeHtml(task.responsibility || "Click card to view details, attachments & comments")}
      </p>

      <div class="text-muted text-ellipsis" title="${escapeHtml(task.assigneeName || task.assignee || "Unassigned")}">
        <i class="fas fa-user-tag"></i> ${escapeHtml(task.assigneeName || task.assignee || "Unassigned")}
      </div>

      <div class="kanban-card-meta-row">
        <span class="text-muted text-ellipsis ${isOverdue ? "text-danger-strong" : ""}">
          <i class="far fa-calendar-alt"></i> Deadline: ${escapeHtml(task.deadline || "Flexible")}
        </span>
        <div class="kanban-card-counters">
          ${attachCount > 0 ? `<span title="Attachments"><i class="fas fa-paperclip"></i> ${attachCount}</span>` : ""}
          ${commentCount > 0 ? `<span title="Comments"><i class="far fa-comment"></i> ${commentCount}</span>` : ""}
        </div>
      </div>

      <select class="form-select task-status-mover status-select-${status}" data-id="${task.id}" aria-label="Change Task Status">
        <option value="todo" ${status === "todo" ? "selected" : ""}>To Do (Not started)</option>
        <option value="inprogress" ${status === "inprogress" ? "selected" : ""}>In Progress</option>
        <option value="review" ${status === "review" ? "selected" : ""}>Under Review</option>
        <option value="done" ${status === "done" ? "selected" : ""}>Completed (Done)</option>
      </select>
    </article>`;
}

function bindKanbanCardEvents(container, teamId) {
  // Clicking the card body opens the Trello-style Task Inspector modal
  container.querySelectorAll(".kanban-task-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("button") || e.target.closest("select")) return;
      const task = currentTasks.find((t) => t.id === card.getAttribute("data-task-id"));
      if (task) openTrelloTaskModal(task);
    });
  });

  container.querySelectorAll(".btn-edit-task").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const targetTask = currentTasks.find((t) => t.id === btn.dataset.id);
      if (!targetTask) return;
      document.getElementById("edit-task-id").value = targetTask.id;
      document.getElementById("edit-task-title").value = targetTask.title || "";
      document.getElementById("edit-task-assignee").value = targetTask.assigneeName || targetTask.assignee || "";
      document.getElementById("edit-task-deadline").value = targetTask.deadline || "";
      document.getElementById("edit-task-priority").value = targetTask.priority || "Normal";
      document.getElementById("edit-task-responsibility").value = targetTask.responsibility || "";
      openModal("modal-edit-task");
    });
  });

  container.querySelectorAll(".btn-archive-task").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const nextArchived = btn.dataset.archived !== "true";
      await updateDoc(doc(db, "teams", teamId, "tasks", btn.dataset.id), {
        archived: nextArchived,
        updatedAt: serverTimestamp()
      });
      await loadTasks(teamId);
    });
  });

  container.querySelectorAll(".task-status-mover").forEach((sel) => {
    sel.addEventListener("click", (e) => e.stopPropagation());
    sel.addEventListener("change", async (e) => {
      const nextStatus = e.target.value;
      const task = currentTasks.find((t) => t.id === sel.dataset.id);
      const activityEntry = {
        authorName: userProfile.fullName,
        text: `moved this card to ${STATUS_LABELS[nextStatus] || nextStatus}`,
        isSystemLog: true,
        createdAt: new Date().toISOString()
      };
      await updateDoc(doc(db, "teams", teamId, "tasks", sel.dataset.id), {
        status: nextStatus,
        comments: arrayUnion(activityEntry),
        updatedAt: serverTimestamp()
      });
      if (task) {
        await loadTasks(teamId);
      }
    });
  });

  container.querySelectorAll(".btn-del-task").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Delete this task permanently? (Tip: Use the Archive icon to store it instead.)")) return;
      await deleteDoc(doc(db, "teams", teamId, "tasks", btn.dataset.id));
      await loadTasks(teamId);
    });
  });
}

// Trello-Style Task Detail Modal (Attachments, Pictures & Activity/Comment Stream)
function openTrelloTaskModal(task) {
  activeTaskDetailId = task.id;
  populateTrelloTaskModal(task);
  openModal("modal-task-detail");
}

function populateTrelloTaskModal(task) {
  const status = task.status || "todo";
  document.getElementById("trello-detail-task-id").value = task.id;
  document.getElementById("trello-detail-title").textContent = task.title || "Task";
  document.getElementById("trello-detail-assignee").textContent = task.assigneeName || task.assignee || "Unassigned";
  document.getElementById("trello-detail-deadline").textContent = task.deadline || "Flexible";
  document.getElementById("trello-detail-priority").textContent = task.priority || "Normal";
  document.getElementById("trello-detail-desc").textContent =
    task.responsibility || "No specific responsibilities listed.";

  const statusChip = document.getElementById("trello-detail-status-chip");
  const statusText = document.getElementById("trello-detail-status-text");
  if (statusChip) statusChip.className = `status-chip status-chip-${status}`;
  if (statusText) statusText.textContent = STATUS_LABELS[status] || "To Do";

  const archiveBtn = document.getElementById("btn-trello-archive-toggle");
  if (archiveBtn) {
    const isArc = Boolean(task.archived);
    archiveBtn.innerHTML = `<i class="fas ${isArc ? "fa-box-open" : "fa-archive"}"></i> ${isArc ? "Restore to Board" : "Archive"}`;
  }

  // Render Attachments & Pictures
  const attachList = document.getElementById("trello-attachments-list");
  const attachments = task.attachments || [];
  if (attachList) {
    if (attachments.length === 0) {
      attachList.innerHTML = `<div class="text-muted">No photos or files attached yet. Click "Add Attachment / Photo" above to upload progress files.</div>`;
    } else {
      attachList.innerHTML = attachments
        .map((att) => {
          const safeUrl = sanitizeUrl(att.url, "");
          const isImg = /\.(png|jpg|jpeg|webp|gif)$/i.test(att.name || "") || safeUrl.startsWith("data:image/");
          return `
            <div class="attached-file-card">
              <div class="attached-file-meta">
                ${
                  isImg && safeUrl
                    ? `<img src="${safeUrl}" alt="${escapeHtml(att.name)}" class="reply-preview-thumb" />`
                    : `<i class="fas fa-file-alt"></i>`
                }
                <div>
                  <div class="text-ellipsis" title="${escapeHtml(att.name || "Attachment")}">${escapeHtml(att.name || "Attachment")}</div>
                  <small class="text-muted">Added by ${escapeHtml(att.uploadedBy || "Member")}</small>
                </div>
              </div>
              ${
                safeUrl
                  ? `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" download="${escapeHtml(att.name || "Attachment")}" data-filename="${escapeHtml(att.name || "Attachment")}" class="btn-secondary btn-trello-download">
                       <i class="fas fa-download"></i> Open / Download
                     </a>`
                  : ""
              }
            </div>`;
        })
        .join("");

      attachList.querySelectorAll(".btn-trello-download").forEach((link) => {
        link.addEventListener("click", async (e) => {
          const href = link.getAttribute("href") || "";
          const fName = link.getAttribute("data-filename") || "Attachment";
          if (href.startsWith("data:") || href.startsWith("https://aimser-chunked.local/")) {
            e.preventDefault();
            await resolveAndDownloadAttachment(href, fName);
          }
        });
      });
    }
  }

  // Render Comments & Activity Stream
  const commentsList = document.getElementById("trello-comments-list");
  const comments = [...(task.comments || [])].reverse();
  if (commentsList) {
    if (comments.length === 0) {
      commentsList.innerHTML = `<div class="text-muted">No comments or activity logged yet.</div>`;
    } else {
      commentsList.innerHTML = comments
        .map((c) => {
          const timeLabel = c.createdAt ? new Date(c.createdAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "Recent";
          return `
            <div class="trello-activity-item">
              <div class="roster-name-row">
                <strong class="text-ellipsis">${escapeHtml(c.authorName || "Member")}</strong>
                <small class="text-muted">${escapeHtml(timeLabel)}</small>
              </div>
              <p class="${c.isSystemLog ? "text-muted" : ""}">${escapeHtml(c.text || "")}</p>
            </div>`;
        })
        .join("");
    }
  }
}

function renderHierarchyAndPositions() {
  const grid = document.getElementById("hierarchy-members-grid");
  const assigneeSelect = document.getElementById("task-assignee");
  const editAssigneeSelect = document.getElementById("edit-task-assignee");
  if (!grid || !activeTeam) return;

  const profilesMap = activeTeam.memberProfiles || {};
  const memberUids = activeTeam.members || [];

  const membersList = memberUids.map((uid) => {
    const info = profilesMap[uid] || {};
    const isLeader = uid === activeTeam.leaderUid;
    return {
      uid,
      fullName: info.fullName || (uid === currentUser.uid ? userProfile.fullName : `Member (${uid.slice(0, 5)})`),
      roleBadge: info.roleBadge || "student",
      tier: info.tier || (isLeader ? "1 - Team Leader" : "3 - HR Specialist"),
      position: info.position || (isLeader ? "Team Leader" : "HR Project Member"),
      responsibilities:
        info.responsibilities || "Collaborate on HR simulation deliverables, action checklists, and assigned tasks."
    };
  });

  const optionsHtml = membersList
    .map((m) => `<option value="${escapeHtml(m.fullName)}">${escapeHtml(m.fullName)} (${escapeHtml(m.position)})</option>`)
    .join("");

  if (assigneeSelect) assigneeSelect.innerHTML = optionsHtml;
  if (editAssigneeSelect) editAssigneeSelect.innerHTML = optionsHtml;

  grid.innerHTML = membersList
    .map(
      (m) => `
      <div class="glass-panel">
        <div>
          <div class="roster-name-row">
            <span class="badge-pill text-ellipsis"><i class="fas fa-id-badge"></i> ${escapeHtml(m.position)}</span>
            ${renderRoleBadge(m.roleBadge)}
          </div>
          <h3 class="text-ellipsis" title="${escapeHtml(m.fullName)}">${escapeHtml(m.fullName)}</h3>
          <p class="text-muted text-clamp-2" title="${escapeHtml(m.responsibilities)}">
            <strong>Responsibilities:</strong> ${escapeHtml(m.responsibilities)}
          </p>
        </div>

        <div class="card-footer-bar">
          <span></span>
          <button type="button" class="btn-secondary btn-open-pos-modal" data-uid="${m.uid}" data-name="${escapeHtml(m.fullName)}" data-tier="${escapeHtml(m.tier)}" data-pos="${escapeHtml(m.position)}" data-resp="${escapeHtml(m.responsibilities)}">
            <i class="fas fa-user-edit"></i> Assign Position
          </button>
        </div>
      </div>`
    )
    .join("");

  grid.querySelectorAll(".btn-open-pos-modal").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById("pos-member-uid").value = btn.dataset.uid;
      document.getElementById("pos-member-name").value = btn.dataset.name;
      const tierInput = document.getElementById("pos-hierarchy-tier");
      if (tierInput) tierInput.value = btn.dataset.tier || "3 - HR Specialist";
      document.getElementById("pos-job-title").value = btn.dataset.pos;
      document.getElementById("pos-responsibilities").value = btn.dataset.resp;
      openModal("modal-assign-position");
    });
  });
}

// Action Checklists: Checked items display in reduced contrast and automatically move to the bottom of the list
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
        { title: "Role Integration: 30-60-90 Day Competency Alignment", owner: "Team Leader", dueDate: "Week 1", completed: false }
      ];
      for (const item of defaults) {
        const ref = await addDoc(collection(db, "teams", teamId, "onboarding"), { ...item, createdAt: serverTimestamp() });
        items.push({ id: ref.id, ...item });
      }
    }

    const doneCount = items.filter((i) => i.completed).length;
    const pct = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0;
    if (pctEl) pctEl.textContent = `${pct}%`;

    // Automatically sort unchecked items first and checked items to the bottom
    const sortedItems = [...items].sort((a, b) => {
      if (Boolean(a.completed) !== Boolean(b.completed)) {
        return a.completed ? 1 : -1;
      }
      return 0;
    });

    container.innerHTML = sortedItems
      .map(
        (item) => `
        <div class="inspector-meta-item panel-toolbar checklist-row ${item.completed ? "is-checked-item" : ""}">
          <label class="checklist-label-flex">
            <input type="checkbox" class="onb-checkbox" data-id="${item.id}" ${item.completed ? "checked" : ""} />
            <div class="checklist-text-wrap">
              <strong class="checklist-item-title text-ellipsis" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</strong>
              <div class="text-muted text-ellipsis">
                Owner: <strong>${escapeHtml(item.owner || "Team")}</strong> • Target: ${escapeHtml(item.dueDate || "TBD")}
              </div>
            </div>
          </label>
          <button type="button" class="btn-sidebar-action btn-logout btn-del-onb" data-id="${item.id}" title="Remove Action Item">
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
    console.error("Action checklist error:", err);
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

function toggleArchivedBoardView(forceShowArchived = null) {
  showingArchivedSpace = forceShowArchived !== null ? forceShowArchived : !showingArchivedSpace;
  document.getElementById("kanban-active-board")?.classList.toggle("is-hidden", showingArchivedSpace);
  document.getElementById("kanban-archived-space")?.classList.toggle("is-hidden", !showingArchivedSpace);
  if (activeTeam) {
    renderKanbanTasks(currentTasks, activeTeam.id);
  }
}

function bindPlannerEvents() {
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

  document.getElementById("btn-open-status-colors-modal")?.addEventListener("click", () => {
    openModal("modal-status-colors");
  });

  document.getElementById("btn-toggle-archived-tasks")?.addEventListener("click", () => {
    toggleArchivedBoardView();
  });

  document.getElementById("btn-back-to-active-board")?.addEventListener("click", () => {
    toggleArchivedBoardView(false);
  });

  // Trello Modal Archive Button
  document.getElementById("btn-trello-archive-toggle")?.addEventListener("click", async () => {
    if (!activeTeam || !activeTaskDetailId) return;
    const task = currentTasks.find((t) => t.id === activeTaskDetailId);
    if (!task) return;
    const nextArchived = !task.archived;
    await updateDoc(doc(db, "teams", activeTeam.id, "tasks", activeTaskDetailId), {
      archived: nextArchived,
      updatedAt: serverTimestamp()
    });
    await loadTasks(activeTeam.id);
  });

  // Trello Modal Attachment / Photo Upload
  const taskAttachInput = document.getElementById("task-attachment-input");
  if (taskAttachInput) {
    taskAttachInput.addEventListener("change", async () => {
      const file = taskAttachInput.files?.[0];
      if (!file || !activeTeam || !activeTaskDetailId) return;

      const labelBtn = document.querySelector('label[for="task-attachment-input"]');
      const origHtml = labelBtn ? labelBtn.innerHTML : "";
      if (labelBtn) labelBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';

      try {
        const uploadedUrl = await uploadToCloudinary(file, "aimser/planner-attachments");
        const attachmentEntry = {
          name: file.name,
          url: uploadedUrl,
          uploadedBy: userProfile.fullName,
          createdAt: new Date().toISOString()
        };
        const logEntry = {
          authorName: userProfile.fullName,
          text: `attached "${file.name}"`,
          isSystemLog: true,
          createdAt: new Date().toISOString()
        };
        await updateDoc(doc(db, "teams", activeTeam.id, "tasks", activeTaskDetailId), {
          attachments: arrayUnion(attachmentEntry),
          comments: arrayUnion(logEntry),
          updatedAt: serverTimestamp()
        });
        taskAttachInput.value = "";
        await loadTasks(activeTeam.id);
      } catch (err) {
        alert("Attachment upload failed: " + err.message);
      } finally {
        if (labelBtn) labelBtn.innerHTML = origHtml;
      }
    });
  }

  // Trello Modal Comment Form
  document.getElementById("form-task-comment")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!activeTeam || !activeTaskDetailId) return;
    const commentInput = document.getElementById("task-comment-input");
    const submitBtn = document.getElementById("btn-submit-task-comment");
    const text = commentInput.value.trim();
    if (!text) return;

    submitBtn.disabled = true;
    try {
      await updateDoc(doc(db, "teams", activeTeam.id, "tasks", activeTaskDetailId), {
        comments: arrayUnion({
          authorUid: currentUser.uid,
          authorName: userProfile.fullName,
          text,
          isSystemLog: false,
          createdAt: new Date().toISOString()
        }),
        updatedAt: serverTimestamp()
      });
      commentInput.value = "";
      await loadTasks(activeTeam.id);
    } catch (err) {
      alert("Failed to post comment: " + err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });

  ["todo", "inprogress", "review", "done"].forEach((key) => {
    document.getElementById(`color-input-${key}`)?.addEventListener("input", (e) => {
      applyStatusColorsToCSS({
        ...activeStatusColors,
        [key]: e.target.value
      });
    });
  });

  document.getElementById("btn-reset-status-colors")?.addEventListener("click", async () => {
    applyStatusColorsToCSS(DEFAULT_STATUS_COLORS);
    localStorage.setItem("aimser_status_colors", JSON.stringify(DEFAULT_STATUS_COLORS));
    if (activeTeam) {
      try {
        await updateDoc(doc(db, "teams", activeTeam.id), { statusColors: DEFAULT_STATUS_COLORS });
        activeTeam.statusColors = { ...DEFAULT_STATUS_COLORS };
      } catch {
        // Non-blocking
      }
    }
  });

  document.getElementById("form-status-colors")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const updatedColors = {
      todo: document.getElementById("color-input-todo").value || DEFAULT_STATUS_COLORS.todo,
      inprogress: document.getElementById("color-input-inprogress").value || DEFAULT_STATUS_COLORS.inprogress,
      review: document.getElementById("color-input-review").value || DEFAULT_STATUS_COLORS.review,
      done: document.getElementById("color-input-done").value || DEFAULT_STATUS_COLORS.done
    };

    applyStatusColorsToCSS(updatedColors);
    localStorage.setItem("aimser_status_colors", JSON.stringify(updatedColors));

    if (activeTeam) {
      try {
        await updateDoc(doc(db, "teams", activeTeam.id), { statusColors: updatedColors });
        activeTeam.statusColors = updatedColors;
      } catch {
        // Non-blocking
      }
    }

    closeModal("modal-status-colors");
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
        statusColors: activeStatusColors,
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
          tier: "3 - HR Specialist",
          position: "HR Project Associate",
          responsibilities: "Execute assigned project tasks and action checklist items."
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
    const priority = document.getElementById("task-priority").value;
    const responsibility = document.getElementById("task-responsibility").value.trim();

    await addDoc(collection(db, "teams", activeTeam.id, "tasks"), {
      title,
      assigneeName,
      deadline,
      priority,
      responsibility,
      status: "todo",
      archived: false,
      attachments: [],
      comments: [
        {
          authorName: userProfile.fullName,
          text: "added this card to To Do",
          isSystemLog: true,
          createdAt: new Date().toISOString()
        }
      ],
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
    const priority = document.getElementById("edit-task-priority").value;
    const responsibility = document.getElementById("edit-task-responsibility").value.trim();

    await updateDoc(doc(db, "teams", activeTeam.id, "tasks", taskId), {
      title,
      assigneeName,
      deadline,
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
    const tier = document.getElementById("pos-hierarchy-tier")?.value || "3 - HR Specialist";
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