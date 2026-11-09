import { auth, db } from "./firebase-init.js";
import { initAuthGuard } from "./auth-guard.js";
import { 
  collection, query, where, getDocs, addDoc, doc, updateDoc, 
  arrayUnion, serverTimestamp, onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
let activeTeamCode = urlParams.get("team") || localStorage.getItem("aimser_active_team_code");

let currentUser = null;
let currentRole = "student";
let activeTeamDocId = null;
let activeTeamData = null;

// DOM
const gatewayCard = document.getElementById("team-gateway-card");
const workspace = document.getElementById("team-workspace");
const formJoinTeam = document.getElementById("form-join-team");
const inpTeamCode = document.getElementById("inp-team-code");
const btnOpenCreateTeam = document.getElementById("btn-open-create-team");
const modalCreateTeam = document.getElementById("modal-create-team");
const formCreateTeam = document.getElementById("form-create-team");

const activeTeamName = document.getElementById("active-team-name");
const activeTeamMeta = document.getElementById("active-team-meta");
const activeTeamCodeTag = document.getElementById("active-team-code");
const btnSwitchTeam = document.getElementById("btn-switch-team");

const hierarchyContainer = document.getElementById("team-hierarchy-container");
const btnOpenAssignRole = document.getElementById("btn-open-assign-role");
const modalAssignRole = document.getElementById("modal-assign-role");
const formAssignRole = document.getElementById("form-assign-role");

const btnOpenAddCard = document.getElementById("btn-open-add-card");
const modalAddCard = document.getElementById("modal-add-card");
const formCreateCard = document.getElementById("form-create-card");

const colTodo = document.getElementById("column-todo");
const colProg = document.getElementById("column-in_progress");
const colDone = document.getElementById("column-done");

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

    if (activeTeamCode) {
      await loadTeam(activeTeamCode);
    }
  }
});

// Join Team
formJoinTeam?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = inpTeamCode.value.trim().toUpperCase();
  if (!code) return;
  await loadTeam(code);
});

btnSwitchTeam?.addEventListener("click", () => {
  localStorage.removeItem("aimser_active_team_code");
  activeTeamCode = null;
  gatewayCard.style.display = "block";
  workspace.style.display = "none";
});

// Create Team Room (Max 15 members: 1 leader + 14 members)
btnOpenCreateTeam?.addEventListener("click", () => {
  if (modalCreateTeam) modalCreateTeam.style.display = "flex";
});

formCreateTeam?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const teamName = document.getElementById("inp-new-team-name").value.trim();
  const linkedOfficeCode = document.getElementById("inp-link-office-code").value.trim().toUpperCase() || null;
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const teamCode = `TEAM-${randomSuffix}`;

  await addDoc(collection(db, "planner_teams"), {
    teamName,
    teamCode,
    linkedOfficeCode,
    leaderUid: currentUser.uid,
    leaderEmail: currentUser.email,
    maxMembers: 15,
    members: [{ uid: currentUser.uid, email: currentUser.email, role: "Team Leader" }],
    hierarchy: [{ name: currentUser.email.split("@")[0], position: "Project Manager (Leader)" }],
    createdAt: serverTimestamp()
  });

  alert(`Team created! Share code: ${teamCode}`);
  modalCreateTeam.style.display = "none";
  await loadTeam(teamCode);
});

async function loadTeam(code) {
  const q = query(collection(db, "planner_teams"), where("teamCode", "==", code));
  const snap = await getDocs(q);

  if (snap.empty) {
    alert("Team board not found.");
    return;
  }

  const tDoc = snap.docs[0];
  activeTeamDocId = tDoc.id;
  activeTeamData = tDoc.data();
  activeTeamCode = code;
  localStorage.setItem("aimser_active_team_code", code);

  const memberList = activeTeamData.members || [];
  if (!memberList.some(m => m.uid === currentUser.uid)) {
    if (memberList.length >= 15) {
      alert("This team has reached the maximum of 15 members.");
      return;
    }
    const newMember = { uid: currentUser.uid, email: currentUser.email, role: "Member" };
    await updateDoc(doc(db, "planner_teams", activeTeamDocId), { 
      members: arrayUnion(newMember) 
    });
    memberList.push(newMember);
  }

  gatewayCard.style.display = "none";
  workspace.style.display = "block";

  if (activeTeamName) activeTeamName.textContent = activeTeamData.teamName;
  if (activeTeamMeta) activeTeamMeta.textContent = `Members: ${memberList.length}/15 • Leader: ${activeTeamData.leaderEmail}`;
  if (activeTeamCodeTag) activeTeamCodeTag.textContent = code;

  renderHierarchy(activeTeamData.hierarchy || []);
  initCardsStream();
}

function renderHierarchy(hierarchy) {
  if (!hierarchyContainer) return;
  hierarchyContainer.innerHTML = "";
  hierarchy.forEach(h => {
    const pill = document.createElement("span");
    pill.className = "hierarchy-pill";
    pill.innerHTML = `👤 <strong>${h.name}</strong>: ${h.position}`;
    hierarchyContainer.appendChild(pill);
  });
}

// Assign Position
btnOpenAssignRole?.addEventListener("click", () => {
  if (modalAssignRole) modalAssignRole.style.display = "flex";
});

formAssignRole?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("role-member-name").value.trim();
  const position = document.getElementById("role-title").value;

  const newEntry = { name, position };
  await updateDoc(doc(db, "planner_teams", activeTeamDocId), { 
    hierarchy: arrayUnion(newEntry) 
  });
  
  if (!activeTeamData.hierarchy) activeTeamData.hierarchy = [];
  activeTeamData.hierarchy.push(newEntry);
  renderHierarchy(activeTeamData.hierarchy);

  modalAssignRole.style.display = "none";
  formAssignRole.reset();
});

// Cards / Kanban
btnOpenAddCard?.addEventListener("click", () => {
  if (modalAddCard) modalAddCard.style.display = "flex";
});

formCreateCard?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("card-title").value.trim();
  const assignee = document.getElementById("card-assignee").value.trim();
  const dueDate = document.getElementById("card-due").value;
  const description = document.getElementById("card-desc").value.trim();

  await addDoc(collection(db, "planner_cards"), {
    teamCode: activeTeamCode,
    title,
    assignee: assignee || "Unassigned",
    dueDate,
    description,
    status: "todo",
    createdAt: serverTimestamp()
  });

  formCreateCard.reset();
  modalAddCard.style.display = "none";
});

function initCardsStream() {
  const q = query(collection(db, "planner_cards"), where("teamCode", "==", activeTeamCode));
  onSnapshot(q, (snap) => {
    if (!colTodo || !colProg || !colDone) return;
    colTodo.innerHTML = ""; colProg.innerHTML = ""; colDone.innerHTML = "";

    let cTodo = 0, cProg = 0, cDone = 0;

    snap.forEach((cd) => {
      const card = cd.data();
      const el = document.createElement("div");
      el.className = "trello-card";
      el.innerHTML = `
        <h4 class="trello-card-title">${card.title}</h4>
        <div style="font-size: 11.5px; color: var(--text-secondary);">${card.description || ""}</div>
        <div class="trello-card-meta">
          <span>👤 ${card.assignee}</span>
          <span>📅 ${card.dueDate}</span>
        </div>
        <div style="display: flex; gap: 4px; margin-top: 6px;">
          <select class="change-status" data-id="${cd.id}" style="background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--surface-border); font-size: 11px; padding: 2px 4px; border-radius: 4px;">
            <option value="todo" ${card.status === "todo" ? "selected" : ""}>To Do</option>
            <option value="in_progress" ${card.status === "in_progress" ? "selected" : ""}>In Progress</option>
            <option value="done" ${card.status === "done" ? "selected" : ""}>Done</option>
          </select>
        </div>
      `;

      el.querySelector(".change-status")?.addEventListener("change", async (e) => {
        await updateDoc(doc(db, "planner_cards", cd.id), { status: e.target.value });
      });

      if (card.status === "in_progress") { colProg.appendChild(el); cProg++; }
      else if (card.status === "done") { colDone.appendChild(el); cDone++; }
      else { colTodo.appendChild(el); cTodo++; }
    });

    document.getElementById("count-todo").textContent = cTodo;
    document.getElementById("count-in_progress").textContent = cProg;
    document.getElementById("count-done").textContent = cDone;
  });
}