// js/planner.js - Project Planner Kanban & Team Collaboration Engine
import { db, auth } from "./firebase-init.js";
import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  arrayUnion
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { uploadToCloudinary } from "./cloudinary-config.js";

let currentTeamId = null;
let currentUser = null;
let cardsUnsubscribe = null;

// Initialize on auth ready
onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  currentUser = user;
  await loadUserTeams();
  setupPlannerEventListeners();
});

// Load all teams where current user is leader or member
async function loadUserTeams() {
  const teamSelector = document.getElementById("team-selector");
  if (!teamSelector) return;

  try {
    const q = query(
      collection(db, "planner_teams"),
      where("members", "array-contains", currentUser.uid)
    );
    const snap = await getDocs(q);

    teamSelector.innerHTML = '<option value="">Select Team Board...</option>';

    snap.forEach((docSnap) => {
      const team = docSnap.data();
      const opt = document.createElement("option");
      opt.value = docSnap.id;
      opt.textContent = `${team.name} (${team.code})`;
      teamSelector.appendChild(opt);
    });

    if (snap.docs.length > 0) {
      teamSelector.value = snap.docs[0].id;
      switchTeam(snap.docs[0].id);
    } else {
      resetBoardView();
    }
  } catch (err) {
    console.error("Error loading teams:", err);
  }
}

// Switch active team board and attach real-time snapshot listener
async function switchTeam(teamId) {
  currentTeamId = teamId;
  const activeBadge = document.getElementById("active-team-badge");
  const codeDisplay = document.getElementById("team-code-display");
  const membersCount = document.getElementById("team-members-count");

  if (!teamId) {
    resetBoardView();
    return;
  }

  try {
    const teamDoc = await getDoc(doc(db, "planner_teams", teamId));
    if (!teamDoc.exists()) return;

    const data = teamDoc.data();
    if (activeBadge) activeBadge.textContent = data.name;
    if (codeDisplay) codeDisplay.innerHTML = `Team Invite Code: <strong>${data.code}</strong>`;
    if (membersCount) membersCount.innerHTML = `<i class="fas fa-user-friends"></i> ${(data.members || []).length} / ${data.capacity || 5} Members`;

    listenToCards(teamId);
  } catch (err) {
    console.error("Error switching team:", err);
  }
}

function resetBoardView() {
  currentTeamId = null;
  const activeBadge = document.getElementById("active-team-badge");
  const codeDisplay = document.getElementById("team-code-display");
  const membersCount = document.getElementById("team-members-count");

  if (activeBadge) activeBadge.textContent = "Select or Create a Team";
  if (codeDisplay) codeDisplay.innerHTML = "Team Invite Code: <strong>---</strong>";
  if (membersCount) membersCount.innerHTML = '<i class="fas fa-user-friends"></i> 0 Members';

  ["todo", "in_progress", "review", "done"].forEach((status) => {
    const col = document.getElementById(`col-${status}`);
    const count = document.getElementById(`count-${status}`);
    if (col) col.innerHTML = '<div class="empty-state" style="padding: 1.5rem 0.5rem;"><p style="font-size: 0.85rem;">No tasks</p></div>';
    if (count) count.textContent = "0";
  });

  if (cardsUnsubscribe) cardsUnsubscribe();
}

// Listen to Kanban cards in Firestore
function listenToCards(teamId) {
  if (cardsUnsubscribe) cardsUnsubscribe();

  const q = query(
    collection(db, "planner_cards"),
    where("teamId", "==", teamId),
    orderBy("createdAt", "desc")
  );

  cardsUnsubscribe = onSnapshot(q, (snapshot) => {
    const cols = {
      todo: document.getElementById("col-todo"),
      in_progress: document.getElementById("col-in_progress"),
      review: document.getElementById("col-review"),
      done: document.getElementById("col-done")
    };

    const counts = { todo: 0, in_progress: 0, review: 0, done: 0 };

    Object.values(cols).forEach((col) => {
      if (col) col.innerHTML = "";
    });

    snapshot.forEach((docSnap) => {
      const card = docSnap.data();
      const cardId = docSnap.id;
      const status = card.status || "todo";

      if (cols[status]) {
        counts[status]++;
        cols[status].appendChild(createCardElement(cardId, card));
      }
    });

    Object.keys(counts).forEach((key) => {
      const countEl = document.getElementById(`count-${key}`);
      if (countEl) countEl.textContent = counts[key];
      if (counts[key] === 0 && cols[key]) {
        cols[key].innerHTML = '<div class="empty-state" style="padding: 1.5rem 0.5rem;"><p style="font-size: 0.85rem;">No tasks</p></div>';
      }
    });
  }, (err) => {
    console.error("Error reading cards:", err);
  });
}

function createCardElement(id, card) {
  const div = document.createElement("div");
  div.className = "planner-task-card glass-panel";
  div.style.padding = "0.85rem";
  div.style.marginBottom = "0.75rem";
  div.style.cursor = "grab";
  div.draggable = true;

  const priorityColors = {
    low: "#10b981",
    medium: "#f59e0b",
    high: "#ef4444"
  };

  div.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
      <span style="font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: ${priorityColors[card.priority] || "#38bdf8"};">
        ${card.priority || "Normal"}
      </span>
      <button type="button" class="btn-delete-card" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.85rem;">
        <i class="fas fa-trash-alt"></i>
      </button>
    </div>
    <h4 style="margin: 0 0 0.35rem 0; font-size: 0.92rem; color: var(--text-main);">${escapeHtml(card.title)}</h4>
    ${card.description ? `<p style="font-size: 0.8rem; color: var(--text-muted); margin: 0 0 0.5rem 0;">${escapeHtml(card.description)}</p>` : ""}
    ${card.attachmentUrl ? `<a href="${card.attachmentUrl}" target="_blank" rel="noopener" style="font-size: 0.78rem; color: #38bdf8; display: inline-flex; align-items: center; gap: 0.3rem; margin-bottom: 0.5rem;"><i class="fas fa-paperclip"></i> Attachment</a>` : ""}
    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem; color: var(--text-muted); border-top: 1px solid var(--border-color); padding-top: 0.5rem; margin-top: 0.5rem;">
      <span><i class="far fa-calendar-alt"></i> ${card.dueDate || "No deadline"}</span>
      <select class="card-status-select" style="background: var(--bg-surface); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.72rem; padding: 0.15rem 0.35rem;">
        <option value="todo" ${card.status === "todo" ? "selected" : ""}>To Do</option>
        <option value="in_progress" ${card.status === "in_progress" ? "selected" : ""}>In Progress</option>
        <option value="review" ${card.status === "review" ? "selected" : ""}>Review</option>
        <option value="done" ${card.status === "done" ? "selected" : ""}>Done</option>
      </select>
    </div>
  `;

  // Status changer dropdown listener
  const statusSelect = div.querySelector(".card-status-select");
  statusSelect.addEventListener("change", async (e) => {
    try {
      await updateDoc(doc(db, "planner_cards", id), {
        status: e.target.value,
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      console.error("Error updating status:", err);
    }
  });

  // Delete card listener
  const deleteBtn = div.querySelector(".btn-delete-card");
  deleteBtn.addEventListener("click", async () => {
    if (confirm("Delete this card permanently?")) {
      try {
        await deleteDoc(doc(db, "planner_cards", id));
      } catch (err) {
        console.error("Error deleting card:", err);
      }
    }
  });

  return div;
}

// Attach all modal forms and action handlers
function setupPlannerEventListeners() {
  const teamSelector = document.getElementById("team-selector");
  if (teamSelector) {
    teamSelector.addEventListener("change", (e) => {
      switchTeam(e.target.value);
    });
  }

  // 1. Form: Create Team
  const formCreateTeam = document.getElementById("form-create-team");
  if (formCreateTeam && !formCreateTeam.dataset.bound) {
    formCreateTeam.dataset.bound = "true";
    formCreateTeam.addEventListener("submit", async (e) => {
      e.preventDefault();
      const nameInput = document.getElementById("team-name-input");
      const capacityInput = document.getElementById("team-max-members");
      const submitBtn = formCreateTeam.querySelector("button[type='submit']");

      const teamName = nameInput.value.trim();
      const capacity = parseInt(capacityInput.value, 10) || 5;

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';

      try {
        const teamCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        const docRef = await addDoc(collection(db, "planner_teams"), {
          name: teamName,
          code: teamCode,
          capacity: capacity,
          leaderUid: currentUser.uid,
          members: [currentUser.uid],
          createdAt: serverTimestamp()
        });

        formCreateTeam.reset();
        closeModal("modal-create-team");
        await loadUserTeams();
        teamSelector.value = docRef.id;
        switchTeam(docRef.id);
      } catch (err) {
        console.error("Error creating team:", err);
        alert("Failed to create team: " + err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = "Create Team";
      }
    });
  }

  // 2. Form: Join Team
  const formJoinTeam = document.getElementById("form-join-team");
  if (formJoinTeam && !formJoinTeam.dataset.bound) {
    formJoinTeam.dataset.bound = "true";
    formJoinTeam.addEventListener("submit", async (e) => {
      e.preventDefault();
      const codeInput = document.getElementById("team-invite-code");
      const submitBtn = formJoinTeam.querySelector("button[type='submit']");
      const code = codeInput.value.trim().toUpperCase();

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Joining...';

      try {
        const q = query(collection(db, "planner_teams"), where("code", "==", code));
        const snap = await getDocs(q);

        if (snap.empty) {
          alert("Invalid team invite code. Team not found.");
          return;
        }

        const teamDoc = snap.docs[0];
        const teamData = teamDoc.data();

        if ((teamData.members || []).includes(currentUser.uid)) {
          alert("You are already a member of this team.");
          closeModal("modal-join-team");
          return;
        }

        if ((teamData.members || []).length >= (teamData.capacity || 5)) {
          alert("This team has reached its maximum member capacity.");
          return;
        }

        await updateDoc(doc(db, "planner_teams", teamDoc.id), {
          members: arrayUnion(currentUser.uid),
          updatedAt: serverTimestamp()
        });

        formJoinTeam.reset();
        closeModal("modal-join-team");
        await loadUserTeams();
        teamSelector.value = teamDoc.id;
        switchTeam(teamDoc.id);
      } catch (err) {
        console.error("Error joining team:", err);
        alert("Failed to join team: " + err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = "Join Team";
      }
    });
  }

  // 3. Form: Add Task Card
  const formAddCard = document.getElementById("form-add-card");
  if (formAddCard && !formAddCard.dataset.bound) {
    formAddCard.dataset.bound = "true";
    formAddCard.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentTeamId) {
        alert("Please select or create a team board first.");
        return;
      }

      const title = document.getElementById("card-title").value.trim();
      const desc = document.getElementById("card-desc").value.trim();
      const priority = document.getElementById("card-priority").value;
      const due = document.getElementById("card-due").value;
      const fileInput = document.getElementById("card-attachment");
      const submitBtn = formAddCard.querySelector("button[type='submit']");

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

      try {
        let attachmentUrl = "";
        if (fileInput && fileInput.files.length > 0) {
          submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading File...';
          attachmentUrl = await uploadToCloudinary(fileInput.files[0]);
        }

        await addDoc(collection(db, "planner_cards"), {
          teamId: currentTeamId,
          title: title,
          description: desc,
          priority: priority,
          dueDate: due || null,
          attachmentUrl: attachmentUrl || null,
          status: "todo",
          authorUid: currentUser.uid,
          createdAt: serverTimestamp()
        });

        formAddCard.reset();
        closeModal("modal-add-card");
      } catch (err) {
        console.error("Error adding card:", err);
        alert("Failed to save task card: " + err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = "Save Card";
      }
    });
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove("is-open");
    modal.style.display = "none";
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}