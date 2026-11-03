import { db } from "./firebase-init.js";
import { initAuthGuard } from "./auth-guard.js";
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const todoContainer = document.getElementById("todo-tasks");
const inProgressContainer = document.getElementById("inprogress-tasks");
const doneContainer = document.getElementById("done-tasks");

const countTodo = document.getElementById("count-todo");
const countInProgress = document.getElementById("count-inprogress");
const countDone = document.getElementById("count-done");

const btnAddTask = document.getElementById("btn-add-task");
const taskModal = document.getElementById("task-modal");
const formTask = document.getElementById("form-create-task");
const btnCancelTask = document.getElementById("btn-cancel-task");

let currentUser = null;
let currentRole = "student";
let userClassCode = "";
let tasksUnsubscribe = null;

// Modal Controls
btnAddTask?.addEventListener("click", () => {
  if (taskModal) taskModal.style.display = "block";
});

btnCancelTask?.addEventListener("click", () => {
  if (taskModal) taskModal.style.display = "none";
  if (formTask) formTask.reset();
});

// Create New Kanban Task
formTask?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("task-title-input")?.value.trim();
  const desc = document.getElementById("task-desc-input")?.value.trim();
  const phase = document.getElementById("task-phase-input")?.value || "todo";

  if (!title) return;

  try {
    await addDoc(collection(db, "tasks"), {
      title,
      description: desc,
      status: phase,
      classroomCode: userClassCode || "GLOBAL",
      creatorUid: currentUser.uid,
      creatorName: currentUser.displayName || currentUser.email,
      createdAt: serverTimestamp()
    });

    if (taskModal) taskModal.style.display = "none";
    if (formTask) formTask.reset();
  } catch (err) {
    console.error("Failed to add task:", err);
    alert("Could not create task: " + err.message);
  }
});

// Real-Time Scoped Listener
function listenToClassroomTasks() {
  if (tasksUnsubscribe) tasksUnsubscribe();

  let q;
  if (userClassCode) {
    // Scoped strictly to the active section
    q = query(collection(db, "tasks"), where("classroomCode", "==", userClassCode));
  } else {
    // Fallback for unlinked workspaces
    q = query(collection(db, "tasks"), where("creatorUid", "==", currentUser.uid));
  }

  tasksUnsubscribe = onSnapshot(q, (snapshot) => {
    let todos = [];
    let inProgress = [];
    let done = [];

    snapshot.forEach((docSnap) => {
      const task = { id: docSnap.id, ...docSnap.data() };
      if (task.status === "inprogress") {
        inProgress.push(task);
      } else if (task.status === "done") {
        done.push(task);
      } else {
        todos.push(task);
      }
    });

    renderColumn(todoContainer, todos, "todo");
    renderColumn(inProgressContainer, inProgress, "inprogress");
    renderColumn(doneContainer, done, "done");

    if (countTodo) countTodo.textContent = todos.length;
    if (countInProgress) countInProgress.textContent = inProgress.length;
    if (countDone) countDone.textContent = done.length;
  });
}

function renderColumn(container, tasks, columnType) {
  if (!container) return;
  if (tasks.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding: 24px 12px; font-size: 13px;">No tasks in this stage.</div>`;
    return;
  }

  container.innerHTML = tasks.map(task => `
    <div class="kanban-task" data-id="${task.id}">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
        <h4 style="font-size: 14px; font-weight: 700; color: var(--text-primary);">${escapeHtml(task.title)}</h4>
        <button type="button" class="btn-delete-task" data-id="${task.id}" style="background: none; border: none; color: var(--text-tertiary); cursor: pointer; font-size: 12px;" title="Delete Task">✕</button>
      </div>
      ${task.description ? `<p style="font-size: 13px; color: var(--text-secondary); line-height: 1.4;">${escapeHtml(task.description)}</p>` : ""}
      
      <!-- Quick Stage Switcher Controls -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--surface-border);">
        <span style="font-size: 11px; color: var(--text-tertiary);">${escapeHtml(task.creatorName || "Peer")}</span>
        <select class="select-task-status" data-id="${task.id}" style="padding: 3px 6px; font-size: 11px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--surface-border); border-radius: 4px;">
          <option value="todo" ${task.status === "todo" ? "selected" : ""}>To Do</option>
          <option value="inprogress" ${task.status === "inprogress" ? "selected" : ""}>In Progress</option>
          <option value="done" ${task.status === "done" ? "selected" : ""}>Done</option>
        </select>
      </div>
    </div>
  `).join("");

  // Attach Stage Change Event
  container.querySelectorAll(".select-task-status").forEach(select => {
    select.addEventListener("change", async (e) => {
      const taskId = e.target.dataset.id;
      const newStatus = e.target.value;
      try {
        await updateDoc(doc(db, "tasks", taskId), { status: newStatus });
      } catch (err) {
        console.error("Status update failed:", err);
      }
    });
  });

  // Attach Delete Event
  container.querySelectorAll(".btn-delete-task").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const taskId = e.target.dataset.id;
      if (confirm("Delete this task deliverable?")) {
        try {
          await deleteDoc(doc(db, "tasks", taskId));
        } catch (err) {
          console.error("Delete failed:", err);
        }
      }
    });
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[s]));
}

// Bootstrapping
initAuthGuard({
  onReady: ({ user, userData, role }) => {
    currentUser = user;
    currentRole = role;
    userClassCode = userData.classroomCode || "";
    listenToClassroomTasks();
  }
});