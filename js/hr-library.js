import { auth, db } from "./firebase-init.js";
import { initAuthGuard } from "./auth-guard.js";
import { 
  collection, query, addDoc, serverTimestamp, onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

let currentUser = null;
let currentRole = "student";

const casesContainer = document.getElementById("hr-cases-container");
const btnOpenCreateCase = document.getElementById("btn-open-create-case");
const modalCreateCase = document.getElementById("modal-create-case");
const formCreateCase = document.getElementById("form-create-case");

const feedContainer = document.getElementById("hr-feed-container");
const formConflictPost = document.getElementById("form-create-conflict-post");
const inpConflictText = document.getElementById("inp-conflict-text");

// Tab Switcher
document.querySelectorAll(".module-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".module-tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".module-tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    const target = document.getElementById(btn.dataset.tab);
    if (target) target.classList.add("active");
  });
});

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

    if (role === "faculty" || role === "admin") {
      document.querySelectorAll(".faculty-only-control").forEach(el => el.style.display = "inline-flex");
    }

    initPublicCases();
    initPublicFeed();
  }
});

// Upload Case with Answer Key (Faculty)
btnOpenCreateCase?.addEventListener("click", () => {
  if (modalCreateCase) modalCreateCase.style.display = "flex";
});

formCreateCase?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("inp-case-title").value.trim();
  const body = document.getElementById("inp-case-body").value.trim();
  const question = document.getElementById("inp-case-question").value.trim();
  const key = document.getElementById("inp-case-key").value.trim();
  const explanation = document.getElementById("inp-case-explanation").value.trim();

  await addDoc(collection(db, "public_hr_cases"), {
    title,
    body,
    question,
    answerKey: key,
    explanation,
    authorName: currentUser.displayName || currentUser.email,
    authorRole: currentRole,
    createdAt: serverTimestamp()
  });

  alert("E-Module & Practice Case published to the public library!");
  formCreateCase.reset();
  modalCreateCase.style.display = "none";
});

function initPublicCases() {
  const q = query(collection(db, "public_hr_cases"));
  onSnapshot(q, (snap) => {
    if (!casesContainer) return;
    casesContainer.innerHTML = "";
    if (snap.empty) {
      casesContainer.innerHTML = `<div class="empty-state"><p>No public e-modules or cases uploaded yet.</p></div>`;
      return;
    }

    snap.forEach((cd) => {
      const c = cd.data();
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card-header">
          <div>
            <h4 class="card-title">${c.title}</h4>
            <div style="margin-top: 4px; display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 11.5px; color: var(--text-tertiary);">Uploaded by: ${c.authorName}</span>
              <span class="role-badge ${c.authorRole || "faculty"}">${(c.authorRole || "faculty").toUpperCase()}</span>
            </div>
          </div>
        </div>
        <p style="font-size: 13px; line-height: 1.5; color: var(--text-secondary); margin: 10px 0;">${c.body}</p>
        
        <!-- Practice Case Section -->
        <div class="practice-question-card">
          <strong style="color: var(--accent); font-size: 12.5px;">📝 Practice Case:</strong>
          <p style="font-size: 13px; margin: 6px 0;">${c.question}</p>
          <div style="display: flex; gap: 8px;">
            <input type="text" class="form-control inp-student-answer" placeholder="Enter your answer...">
            <button type="button" class="btn btn-primary btn-check-answer" style="font-size: 11.5px; white-space: nowrap;">Check Answer</button>
          </div>
          <div class="answer-key-box" id="box-key-${cd.id}">
            <div style="font-size: 12px; font-weight: 700; color: #10b981;">✓ Official Answer Key: ${c.answerKey}</div>
            <div style="font-size: 11.5px; color: var(--text-secondary); margin-top: 4px;">${c.explanation || ""}</div>
          </div>
        </div>
      `;

      card.querySelector(".btn-check-answer")?.addEventListener("click", () => {
        const inp = card.querySelector(".inp-student-answer");
        const studentAns = inp.value.trim().toLowerCase();
        const correctAns = (c.answerKey || "").toLowerCase();
        const keyBox = card.querySelector(`#box-key-${cd.id}`);

        if (!studentAns) {
          alert("Please type your answer before checking.");
          return;
        }

        keyBox.classList.add("revealed");
        if (studentAns === correctAns) {
          alert("🎉 Correct! Your answer matches the faculty key.");
        } else {
          alert("⚠️ Answer does not match the faculty key. Compare your reasoning with the key below.");
        }
      });

      casesContainer.appendChild(card);
    });
  });
}

// Public HR Feed
formConflictPost?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = inpConflictText.value.trim();
  if (!text) return;

  await addDoc(collection(db, "public_hr_feed"), {
    text,
    authorName: currentUser.displayName || currentUser.email,
    authorRole: currentRole,
    createdAt: serverTimestamp()
  });

  formConflictPost.reset();
});

function initPublicFeed() {
  const q = query(collection(db, "public_hr_feed"));
  onSnapshot(q, (snap) => {
    if (!feedContainer) return;
    feedContainer.innerHTML = "";
    if (snap.empty) {
      feedContainer.innerHTML = `<div class="empty-state"><p>No conflict discussions posted yet.</p></div>`;
      return;
    }

    const posts = [];
    snap.forEach(d => posts.push({ id: d.id, ...d.data() }));
    posts.sort((a, b) => (b.createdAt?.toMillis ? b.createdAt.toMillis() : 0) - (a.createdAt?.toMillis ? a.createdAt.toMillis() : 0));

    posts.forEach((p) => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card-header" style="margin-bottom: 6px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <strong style="color: var(--accent); font-size: 13.5px;">${p.authorName}</strong>
            <span class="role-badge ${p.authorRole || "student"}">${(p.authorRole || "student").toUpperCase()}</span>
          </div>
          <span style="font-size: 11px; color: var(--text-tertiary);">
            ${p.createdAt?.toDate ? p.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Just now"}
          </span>
        </div>
        <p style="font-size: 13.5px; line-height: 1.5; color: var(--text-primary); margin: 0;">${p.text}</p>
      `;
      feedContainer.appendChild(card);
    });
  });
}