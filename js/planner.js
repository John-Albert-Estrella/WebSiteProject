// js/planner.js - Real-Time Team Kanban Board & Policy-Enforced Team Builder
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
import { FastCache, escapeHtml, logAuditEvent } from "./security-utils.js";

let currentUser = null;
let userProfile = null;
let teams = [];
let activeTeam = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  currentUser = user;
  userProfile = FastCache.get("user_profile") || { uid: user.uid, email: user.email, fullName: user.displayName || "Member", role: "student" };

  bindPlannerEvents();
  await loadTeams();
});

async function loadTeams() {
  const select = document.getElementById("planner-team-select");
  if (!select) return;

  const snap = await getDocs(collection(db, "teams"));
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  teams = userProfile.role === "faculty"
    ? all
    : all.filter((t) => (t.members || []).includes(currentUser.uid));

  if (teams.length === 0) {
    select.innerHTML = `<option value="">No Teams Yet</option>`;
    clearBoard();
    return;
  }

  select.innerHTML = teams.map((t) =>
    `<option value="${t.id}">${escapeHtml(t.name)} (${escapeHtml(t.inviteCode || "TEAM")})</option>`
  ).join("");

  activeTeam = teams[0];
  select.value = activeTeam.id;
  await loadTasks(activeTeam.id);
}

async function loadTasks(teamId) {
  clearBoard();
  const snap = await getDocs(collection(db, "teams", teamId, "tasks"));
  const tasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

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

    col.innerHTML = list.map((task) => `
      <div style="padding: 0.85rem; border-radius: var(--radius-sm); background: var(--bg-surface); border: 1px solid var(--border-medium);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem;">
          <span class="badge-pill" style="font-size: 0.68rem;">${escapeHtml(task.priority || "Normal")}</span>
          <button type="button" class="btn-del-task" data-id="${task.id}" style="background: none; border: none; color: var(--text-tertiary); cursor: pointer;" title="Delete Task">&times;</button>
        </div>
        <div style="font-weight: 600; font-size: 0.88rem; margin-bottom: 0.4rem; color: var(--text-primary);">${escapeHtml(task.title)}</div>
        <div class="text-muted" style="font-size: 0.75rem; margin-bottom: 0.65rem;">
          <i class="fas fa-user-circle"></i> ${escapeHtml(task.assignee || "Unassigned")}
        </div>
        <select class="form-select task-status-mover" data-id="${task.id}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;">
          <option value="todo" ${status === "todo" ? "selected" : ""}>To Do</option>
          <option value="inprogress" ${status === "inprogress" ? "selected" : ""}>In Progress</option>
          <option value="review" ${status === "review" ? "selected" : ""}>Under Review</option>
          <option value="done" ${status === "done" ? "selected" : ""}>Completed</option>
        </select>
      </div>
    `).join("");

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

function clearBoard() {
  ["todo", "inprogress", "review", "done"].forEach((s) => {
    const col = document.getElementById(`col-${s}`);
    const badge = document.getElementById(`count-${s}`);
    if (col) col.innerHTML = "";
    if (badge) badge.textContent = "0";
  });
}

function bindPlannerEvents() {
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const m = document.getElementById(btn.dataset.closeModal);
      if (m) m.classList.remove("is-open");
    });
  });

  document.getElementById("planner-team-select")?.addEventListener("change", (e) => {
    activeTeam = teams.find((t) => t.id === e.target.value) || null;
    if (activeTeam) loadTasks(activeTeam.id);
  });

  document.getElementById("btn-open-team-modal")?.addEventListener("click", () => {
    document.getElementById("modal-team")?.classList.add("is-open");
  });

  document.getElementById("btn-open-task-modal")?.addEventListener("click", () => {
    if (!activeTeam) {
      alert("Create or join a team first.");
      return;
    }
    document.getElementById("modal-task")?.classList.add("is-open");
  });

  // Create Team
  document.getElementById("form-create-team")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("new-team-name").value.trim();
    const inviteCode = "TM-" + Math.random().toString(36).substring(2, 6).toUpperCase();

    await addDoc(collection(db, "teams"), {
      name,
      inviteCode,
      members: [currentUser.uid],
      createdBy: currentUser.email,
      createdAt: serverTimestamp()
    });

    await logAuditEvent(`Created project team "${name}" (${inviteCode})`, "TEAM", currentUser.email);
    document.getElementById("modal-team")?.classList.remove("is-open");
    e.target.reset();
    await loadTeams();
  });

  // Join Team (Enforces Admin maxTeamSize policy)
  document.getElementById("form-join-team")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = document.getElementById("join-team-code").value.trim().toUpperCase();

    try {
      let maxMembers = 6;
      const cfg = await getDoc(doc(db, "system", "config"));
      if (cfg.exists() && cfg.data().maxTeamSize) {
        maxMembers = Number(cfg.data().maxTeamSize);
      }

      const snap = await getDocs(collection(db, "teams"));
      const match = snap.docs.find((d) => (d.data().inviteCode || "").toUpperCase() === code);
      if (!match) throw new Error("Invalid team invite code.");

      const members = match.data().members || [];
      if (!members.includes(currentUser.uid) && members.length >= maxMembers) {
        throw new Error(`Team capacity reached (Max ${maxMembers} members allowed by Admin Policy).`);
      }

      await updateDoc(doc(db, "teams", match.id), {
        members: arrayUnion(currentUser.uid)
      });

      document.getElementById("modal-team")?.classList.remove("is-open");
      e.target.reset();
      await loadTeams();
    } catch (err) {
      alert(err.message);
    }
  });

  // Create Task
  document.getElementById("form-create-task")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!activeTeam) return;

    const title = document.getElementById("task-title").value.trim();
    const priority = document.getElementById("task-priority").value;
    const assignee = document.getElementById("task-assignee").value.trim() || userProfile.fullName;

    await addDoc(collection(db, "teams", activeTeam.id, "tasks"), {
      title,
      priority,
      assignee,
      status: "todo",
      createdAt: serverTimestamp()
    });

    document.getElementById("modal-task")?.classList.remove("is-open");
    e.target.reset();
    await loadTasks(activeTeam.id);
  });
}