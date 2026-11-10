// js/hr-library.js - Global HR Case Studies & Public Conflict Engine
import { db, auth } from "./firebase-init.js";
import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { uploadToCloudinary } from "./cloudinary-config.js";

let currentUser = null;
let userRole = "student";
let userProfile = null;
let allCasesCache = [];
let feedUnsubscribe = null;
let casesUnsubscribe = null;

// Initialize on auth state ready
onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  currentUser = user;

  try {
    const userSnap = await getDoc(doc(db, "users", user.uid));
    if (userSnap.exists()) {
      userProfile = userSnap.data();
      userRole = userProfile.role || "student";
    }
  } catch (e) {
    console.warn("Could not load user role in HR Library:", e);
  }

  updateHeaderAndRoleUI();
  listenToCases();
  listenToConflictFeed();
  setupHRLibraryEventListeners();
});

// Update role-based visibility and header chip
function updateHeaderAndRoleUI() {
  const isFacultyOrAdmin = userRole === "faculty" || userRole === "admin";
  const publishBtn = document.getElementById("btn-publish-case-modal");
  if (publishBtn) {
    publishBtn.style.display = isFacultyOrAdmin ? "inline-flex" : "none";
  }

  const nameEl = document.getElementById("header-user-name");
  const roleEl = document.getElementById("header-user-role");
  const avatarEl = document.getElementById("header-user-avatar");

  if (nameEl && userProfile) nameEl.textContent = userProfile.fullName || currentUser.email;
  if (roleEl) roleEl.textContent = userRole.charAt(0).toUpperCase() + userRole.slice(1);
  if (avatarEl && userProfile?.avatarUrl) avatarEl.src = userProfile.avatarUrl;
}

// -------------------------------------------------------------
// 1. HR Case Studies (Real-time listener & Interactive Answer Key)
// -------------------------------------------------------------
function listenToCases() {
  if (casesUnsubscribe) casesUnsubscribe();

  const q = query(
    collection(db, "public_hr_cases"),
    orderBy("createdAt", "desc")
  );

  casesUnsubscribe = onSnapshot(q, (snapshot) => {
    allCasesCache = [];
    snapshot.forEach((docSnap) => {
      allCasesCache.push({ id: docSnap.id, ...docSnap.data() });
    });
    renderCases(allCasesCache);
  }, (err) => {
    console.error("Error loading HR cases:", err);
    const grid = document.getElementById("public-cases-grid");
    if (grid) {
      grid.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>Failed to load case studies. Please try refreshing.</p></div>';
    }
  });
}

function renderCases(cases) {
  const grid = document.getElementById("public-cases-grid");
  if (!grid) return;

  if (cases.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-book-reader"></i>
        <p>No HR Case Studies published yet. Faculty members can publish one above.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = "";
  cases.forEach((item) => {
    const card = document.createElement("div");
    card.className = "glass-panel";
    card.style.display = "flex";
    card.style.flexDirection = "column";
    card.style.justifyContent = "space-between";
    card.style.padding = "1.25rem";

    const dateStr = item.createdAt?.toDate ? item.createdAt.toDate().toLocaleDateString() : "Recent";

    card.innerHTML = `
      <div>
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem; gap: 0.5rem;">
          <span class="badge-pill" style="font-size: 0.72rem;">${escapeHtml(item.category || "General HR")}</span>
          <span style="font-size: 0.75rem; color: var(--text-muted);"><i class="far fa-calendar-alt"></i> ${dateStr}</span>
        </div>
        <h3 style="margin: 0 0 0.5rem 0; font-size: 1.15rem; color: var(--text-main);">${escapeHtml(item.title)}</h3>
        <p style="font-size: 0.88rem; color: var(--text-muted); line-height: 1.5; margin: 0 0 1rem 0; white-space: pre-line;">
          ${escapeHtml(item.scenario)}
        </p>
      </div>

      <div style="border-top: 1px solid var(--border-color); padding-top: 0.85rem; margin-top: 0.85rem;">
        <div class="answer-key-box" id="answer-key-${item.id}" style="display: none; background: rgba(2, 132, 199, 0.08); border-left: 3px solid #0284c7; padding: 0.75rem; border-radius: 4px; margin-bottom: 0.75rem; font-size: 0.85rem;">
          <strong style="color: #38bdf8; display: block; margin-bottom: 0.25rem;"><i class="fas fa-key"></i> Official Resolution Key:</strong>
          <p style="margin: 0; color: var(--text-main); white-space: pre-line;">${escapeHtml(item.answerKey || "No official key provided.")}</p>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center;">
          <button type="button" class="btn-secondary btn-toggle-answer" data-id="${item.id}" style="padding: 0.4rem 0.8rem; font-size: 0.78rem;">
            <i class="fas fa-eye"></i> View Answer Key
          </button>
          <span style="font-size: 0.75rem; color: var(--text-muted);">By: ${escapeHtml(item.authorName || "Faculty")}</span>
        </div>
      </div>
    `;

    // Interactive Answer Key Toggle
    card.querySelector(".btn-toggle-answer").addEventListener("click", function () {
      const box = document.getElementById(`answer-key-${item.id}`);
      const isHidden = box.style.display === "none";
      box.style.display = isHidden ? "block" : "none";
      this.innerHTML = isHidden ? '<i class="fas fa-eye-slash"></i> Hide Answer Key' : '<i class="fas fa-eye"></i> View Answer Key';
    });

    grid.appendChild(card);
  });
}

// -------------------------------------------------------------
// 2. Public Conflict Feed (Real-time Peer Discussion & Deliberation)
// -------------------------------------------------------------
function listenToConflictFeed() {
  if (feedUnsubscribe) feedUnsubscribe();

  const q = query(
    collection(db, "public_hr_feed"),
    orderBy("createdAt", "desc")
  );

  feedUnsubscribe = onSnapshot(q, (snapshot) => {
    const stream = document.getElementById("public-conflict-stream");
    if (!stream) return;

    if (snapshot.empty) {
      stream.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-comments"></i>
          <p>No conflict scenarios posted yet. Be the first to start a discussion above!</p>
        </div>
      `;
      return;
    }

    stream.innerHTML = "";
    snapshot.forEach((docSnap) => {
      const post = docSnap.data();
      const div = document.createElement("div");
      div.className = "glass-panel";
      div.style.padding = "1.25rem";

      const timeStr = post.createdAt?.toDate ? post.createdAt.toDate().toLocaleString() : "Just now";

      div.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
          <div style="display: flex; align-items: center; gap: 0.65rem;">
            <img src="${post.authorAvatar || 'https://ui-avatars.com/api/?name=User&background=0284c7&color=fff'}" alt="Avatar" class="avatar-sm" />
            <div>
              <div style="font-weight: 600; font-size: 0.9rem; color: var(--text-main);">${escapeHtml(post.authorName || "Anonymous")}</div>
              <div style="font-size: 0.72rem; color: var(--text-muted);">${escapeHtml(post.authorRole || "Member")}</div>
            </div>
          </div>
          <span style="font-size: 0.75rem; color: var(--text-muted);"><i class="far fa-clock"></i> ${timeStr}</span>
        </div>

        <p style="font-size: 0.92rem; color: var(--text-main); line-height: 1.5; margin: 0 0 0.85rem 0; white-space: pre-line;">
          ${escapeHtml(post.content)}
        </p>

        ${post.mediaUrl ? `
          <div style="margin-bottom: 0.85rem;">
            <a href="${post.mediaUrl}" target="_blank" rel="noopener" style="display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.82rem; color: #38bdf8;">
              <i class="fas fa-paperclip"></i> View Attached Case Material
            </a>
          </div>
        ` : ""}
      `;

      stream.appendChild(div);
    });
  }, (err) => {
    console.error("Error loading conflict feed:", err);
  });
}

// -------------------------------------------------------------
// 3. Search and Form Submissions
// -------------------------------------------------------------
function setupHRLibraryEventListeners() {
  // Live case study search filter
  const searchInput = document.getElementById("case-search-input");
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = "true";
    searchInput.addEventListener("input", (e) => {
      const term = e.target.value.toLowerCase().trim();
      if (!term) {
        renderCases(allCasesCache);
        return;
      }
      const filtered = allCasesCache.filter((c) => {
        const title = (c.title || "").toLowerCase();
        const category = (c.category || "").toLowerCase();
        const scenario = (c.scenario || "").toLowerCase();
        return title.includes(term) || category.includes(term) || scenario.includes(term);
      });
      renderCases(filtered);
    });
  }

  // Form: Publish Case Study (Faculty)
  const formPublishCase = document.getElementById("form-publish-case");
  if (formPublishCase && !formPublishCase.dataset.bound) {
    formPublishCase.dataset.bound = "true";
    formPublishCase.addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = document.getElementById("case-study-title").value.trim();
      const category = document.getElementById("case-study-category").value;
      const scenario = document.getElementById("case-study-scenario").value.trim();
      const answerKey = document.getElementById("case-study-answer-key").value.trim();
      const submitBtn = document.getElementById("btn-save-case");

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publishing...';

      try {
        await addDoc(collection(db, "public_hr_cases"), {
          title,
          category,
          scenario,
          answerKey,
          authorUid: currentUser.uid,
          authorName: userProfile?.fullName || currentUser.email,
          createdAt: serverTimestamp()
        });

        formPublishCase.reset();
        const modal = document.getElementById("modal-publish-case");
        if (modal) {
          modal.classList.remove("is-open");
          modal.style.display = "none";
        }
      } catch (err) {
        console.error("Error publishing case study:", err);
        alert("Failed to publish case study: " + err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = "Publish Case";
      }
    });
  }

  // Form: Post Conflict Scenario
  const formConflict = document.getElementById("form-conflict-post");
  if (formConflict && !formConflict.dataset.bound) {
    formConflict.dataset.bound = "true";
    formConflict.addEventListener("submit", async (e) => {
      e.preventDefault();
      const content = document.getElementById("conflict-post-content").value.trim();
      const fileInput = document.getElementById("conflict-post-media");
      const submitBtn = document.getElementById("btn-submit-conflict");

      if (!content) return;

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Posting...';

      try {
        let mediaUrl = "";
        if (fileInput && fileInput.files.length > 0) {
          submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
          mediaUrl = await uploadToCloudinary(fileInput.files[0]);
        }

        await addDoc(collection(db, "public_hr_feed"), {
          content,
          mediaUrl: mediaUrl || null,
          authorUid: currentUser.uid,
          authorName: userProfile?.fullName || currentUser.email,
          authorAvatar: userProfile?.avatarUrl || null,
          authorRole: userRole,
          createdAt: serverTimestamp()
        });

        formConflict.reset();
      } catch (err) {
        console.error("Error posting scenario:", err);
        alert("Failed to post scenario: " + err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Publish Scenario';
      }
    });
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