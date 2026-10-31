import { auth, db } from "./firebase-init.js";
import { enforceAuth } from "./auth-guard.js";
import { 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc,
  doc, 
  getDoc, 
  onSnapshot, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

enforceAuth(["student", "faculty", "admin"]);

const containerTodo = document.getElementById("container-todo");
const containerInProgress = document.getElementById("container-inprogress");
const containerDone = document.getElementById("container-done");

const countTodo = document.getElementById("count-todo");
const countInProgress = document.getElementById("count-inprogress");
const countDone = document.getElementById("count-done");

const btnAddTask = document.getElementById("btn-open-task-modal");
const taskModal = document.getElementById("task-modal");
const btnModalCancel = document.getElementById("btn-modal-cancel");
const btnModalSave = document.getElementById("btn-modal-save");

const modalTitle = document.getElementById("modal-task-title");
const modalDesc = document.getElementById("modal-task-desc");
const modalPriority = document.getElementById("modal-task-priority");
const modalDue = document.getElementById("modal-task-due");

let activeClassRoom = null;
let currentUserProfile = null;

document.addEventListener("DOMContentLoaded", () => {
  // Modal toggle listeners
  if (btnAddTask) {
    btnAddTask.addEventListener("click", () => {
      if (!activeClassRoom) {
        alert("You must first create or join a class room from the Dashboard before adding tasks!");
        return;
      }
      taskModal.style.display = "block";
      modalTitle.value = "";
      modalDesc.value = "";
      modalTitle.focus();
    });
  }

  if (btnModalCancel) {
    btnModalCancel.addEventListener("click", () => {
      taskModal.style.display = "none";
    });
  }

  if (btnModalSave) {
    btnModalSave.addEventListener("click", async () => {
      const title = modalTitle.value.trim();
      const desc = modalDesc.value.trim();
      const priority = modalPriority.value;
      const due = modalDue.value;

      if (!title) {
        alert("Please enter a task title.");
        return;
      }

      btnModalSave.disabled = true;
      btnModalSave.textContent = "Saving...";

      try {
        await addDoc(collection(db, "rooms", activeClassRoom, "tasks"), {
          title: title,
          description: desc,
          priority: priority,
          dueDate: due || null,
          status: "To Do",
          createdByUid: auth.currentUser.uid,
          createdByName: `${currentUserProfile.firstName} ${currentUserProfile.lastName}`,
          createdAt: serverTimestamp()
        });

        taskModal.style.display = "none";
      } catch (err) {
        console.error("Task creation failed:", err);
        alert("Could not create task: " + err.message);
      } finally {
        btnModalSave.disabled = false;
        btnModalSave.textContent = "Create Task";
      }
    });
  }

  // Setup column drag-and-drop dropzones
  setupColumnDropZones();

  // Watch auth state
  auth.onAuthStateChanged(async (user) => {
    if (!user) return;

    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (!userDoc.exists()) return;

      currentUserProfile = userDoc.data();
      activeClassRoom = currentUserProfile.activeRoomCode || currentUserProfile.roomCode;

      if (!activeClassRoom) {
        containerTodo.innerHTML = `
          <div style="background: #fff; border: 1px dashed var(--surface-border); padding: 20px; border-radius: var(--radius-md); text-align: center;">
            <p style="color: var(--text-secondary); font-size: 13px; margin-bottom: 8px;">No active class linked.</p>
            <a href="index.html" class="btn btn-outline" style="font-size: 12px; padding: 6px 12px;">Go to Dashboard</a>
          </div>`;
        return;
      }

      // Live listen to tasks in this room
      listenToKanbanBoard(activeClassRoom);

    } catch (err) {
      console.error("Planner init error:", err);
    }
  });
});

function setupColumnDropZones() {
  [containerTodo, containerInProgress, containerDone].forEach((container) => {
    container.addEventListener("dragover", (e) => {
      e.preventDefault();
      container.classList.add("drag-over");
    });

    container.addEventListener("dragleave", () => {
      container.classList.remove("drag-over");
    });

    container.addEventListener("drop", async (e) => {
      e.preventDefault();
      container.classList.remove("drag-over");
      const taskId = e.dataTransfer.getData("text/plain");
      const targetStatus = container.parentElement.getAttribute("data-status");

      if (taskId && targetStatus && activeClassRoom) {
        try {
          await updateDoc(doc(db, "rooms", activeClassRoom, "tasks", taskId), {
            status: targetStatus,
            updatedAt: serverTimestamp()
          });
        } catch (err) {
          console.error("Error shifting task column:", err);
        }
      }
    });
  });
}

function listenToKanbanBoard(roomCode) {
  const tasksRef = collection(db, "rooms", roomCode, "tasks");

  onSnapshot(tasksRef, (snapshot) => {
    containerTodo.innerHTML = "";
    containerInProgress.innerHTML = "";
    containerDone.innerHTML = "";

    let numTodo = 0;
    let numInProg = 0;
    let numDone = 0;

    snapshot.forEach((taskDoc) => {
      const task = taskDoc.data();
      const taskId = taskDoc.id;

      const card = document.createElement("div");
      card.className = "kanban-card";
      card.draggable = true;

      let priorityColor = "var(--brand-ocean)";
      if (task.priority === "High") priorityColor = "#ef4444";
      if (task.priority === "Medium") priorityColor = "#f59e0b";

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
          <div class="task-title" style="margin: 0;">${task.title}</div>
          <span style="font-size: 10px; font-weight: 700; color: ${priorityColor}; text-transform: uppercase;">${task.priority || "Normal"}</span>
        </div>
        ${task.description ? `<p style="font-size: 12.5px; color: var(--text-secondary); line-height: 1.4; margin-bottom: 10px;">${task.description}</p>` : ''}
        <div class="task-meta">
          <span style="font-size: 11px;">📅 ${task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "No deadline"}</span>
          <div class="assignee-avatar" title="Added by: ${task.createdByName}">${(task.createdByName || "U").slice(0, 2).toUpperCase()}</div>
        </div>
      `;

      card.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", taskId);
      });

      // Quick delete on double click
      card.addEventListener("dblclick", async () => {
        if (confirm(`Delete task "${task.title}"?`)) {
          await deleteDoc(doc(db, "rooms", roomCode, "tasks", taskId));
        }
      });

      if (task.status === "To Do") {
        numTodo++;
        containerTodo.appendChild(card);
      } else if (task.status === "In Progress") {
        numInProg++;
        card.style.borderLeftColor = "#f59e0b";
        containerInProgress.appendChild(card);
      } else if (task.status === "Done") {
        numDone++;
        card.style.borderLeftColor = "#10b981";
        card.style.opacity = "0.75";
        containerDone.appendChild(card);
      }
    });

    countTodo.textContent = numTodo;
    countInProgress.textContent = numInProg;
    countDone.textContent = numDone;
  });
}