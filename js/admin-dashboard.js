// js/admin-dashboard.js - Administrator Management & Telemetry Engine
import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

let currentAdminUser = null;
let cachedUsers = [];
let cachedSections = [];

// 1. Authenticate & Enforce Clearance
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }

  try {
    const userSnap = await getDoc(doc(db, "users", user.uid));
    const userData = userSnap.exists() ? userSnap.data() : {};

    if (userData.role !== "admin") {
      alert("Unauthorized Access: Administrator clearance required.");
      window.location.replace("office.html");
      return;
    }

    currentAdminUser = user;
    renderAdminIdentity(user, userData);
    setupTabs();
    setupSearch();
    setupRoleModal();

    // Fetch metrics and collections concurrently
    await Promise.allSettled([loadMetrics(), loadUsers(), loadSections(), loadAuditLogs()]);
  } catch (err) {
    console.error("Initialization error:", err);
    window.location.replace("office.html");
  }
});

function renderAdminIdentity(user, data) {
  const headerName = document.getElementById("header-user-name");
  const headerAvatar = document.getElementById("header-user-avatar");

  const name = data.fullName || user.displayName || "Administrator";
  const avatar = data.avatarUrl || user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=1b5375&color=faf2dd`;

  if (headerName) headerName.textContent = name;
  if (headerAvatar) headerAvatar.src = avatar;
}

// 2. Safe Multi-Collection KPI Metrics
async function loadMetrics() {
  const getSafeCount = async (collName) => {
    try {
      const snap = await getDocs(collection(db, collName));
      return snap.size;
    } catch {
      return 0;
    }
  };

  const usersCount = await getSafeCount("users");
  
  // Try classrooms first, then sections
  let sectionsCount = await getSafeCount("classrooms");
  if (sectionsCount === 0) {
    sectionsCount = await getSafeCount("sections");
  }

  const teamsCount = await getSafeCount("teams");
  
  // Try audit_logs first, then logs
  let logsCount = await getSafeCount("audit_logs");
  if (logsCount === 0) {
    logsCount = await getSafeCount("logs");
  }

  const elUsers = document.getElementById("stat-total-users");
  const elSections = document.getElementById("stat-total-sections");
  const elTeams = document.getElementById("stat-total-teams");
  const elLogs = document.getElementById("stat-total-logs");

  if (elUsers) elUsers.textContent = usersCount.toLocaleString();
  if (elSections) elSections.textContent = sectionsCount.toLocaleString();
  if (elTeams) elTeams.textContent = teamsCount.toLocaleString();
  if (elLogs) elLogs.textContent = logsCount.toLocaleString();
}

// 3. Telemetry & Platform Audit Trail
async function loadAuditLogs() {
  const container = document.getElementById("admin-logs-container");
  const elLogs = document.getElementById("stat-total-logs");
  if (!container) return;

  try {
    let logsSnap = null;

    // Attempt ordered fetch on 'audit_logs'
    try {
      const q = query(collection(db, "audit_logs"), orderBy("timestamp", "desc"), limit(50));
      logsSnap = await getDocs(q);
    } catch (primaryErr) {
      console.warn("Primary audit_logs query error, attempting fallbacks...", primaryErr);
      try {
        logsSnap = await getDocs(query(collection(db, "logs"), orderBy("timestamp", "desc"), limit(50)));
      } catch {
        try {
          logsSnap = await getDocs(collection(db, "audit_logs"));
        } catch {
          logsSnap = await getDocs(collection(db, "logs"));
        }
      }
    }

    if (!logsSnap || logsSnap.empty) {
      if (elLogs) elLogs.textContent = "0";
      container.innerHTML = `
        <div class="empty-state" style="padding: 2.5rem 1.5rem;">
          <i class="fas fa-clipboard-list" style="font-size: 2rem; color: var(--text-tertiary); margin-bottom: 0.5rem; display: block;"></i>
          <h3 style="font-size: 1rem; color: var(--text-primary); margin-bottom: 0.25rem;">No Telemetry Events Logged</h3>
          <p style="font-size: 0.8rem; color: var(--text-secondary);">User registrations, classroom join requests, and role promotions will stream here automatically.</p>
        </div>`;
      return;
    }

    if (elLogs) elLogs.textContent = logsSnap.size.toLocaleString();

    container.innerHTML = logsSnap.docs.map((docSnap) => {
      const data = docSnap.data();
      const message = data.message || data.action || data.event || data.details || "System Event Recorded";
      
      let formattedDate = "Recent";
      if (data.timestamp?.toDate) {
        const d = data.timestamp.toDate();
        formattedDate = `${d.toLocaleDateString()}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
      } else if (data.timestamp) {
        const d = new Date(data.timestamp);
        formattedDate = `${d.toLocaleDateString()}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
      }

      return `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1rem; border-radius: var(--radius-sm); background: var(--bg-surface); border: 1px solid var(--border-subtle); font-family: var(--font-mono); font-size: 0.8125rem;">
          <div style="display: flex; align-items: center; gap: 0.65rem; word-break: break-word;">
            <span style="color: var(--danger); font-weight: 700;">[EVENT]</span>
            <span style="color: var(--text-primary);">${escapeHtml(message)}</span>
          </div>
          <span style="color: var(--text-tertiary); font-size: 0.75rem; white-space: nowrap; margin-left: 1rem;">${formattedDate}</span>
        </div>
      `;
    }).join("");

  } catch (err) {
    console.error("Error loading audit logs:", err);
    if (elLogs) elLogs.textContent = "0";
    container.innerHTML = `
      <div class="empty-state" style="padding: 2.5rem 1.5rem;">
        <i class="fas fa-exclamation-triangle" style="font-size: 2rem; color: var(--warning); margin-bottom: 0.5rem; display: block;"></i>
        <h3 style="font-size: 1rem; color: var(--text-primary); margin-bottom: 0.25rem;">Audit Trail Unavailable</h3>
        <p style="font-size: 0.8rem; color: var(--text-secondary);">${escapeHtml(err.message)}</p>
      </div>`;
  }
}

// 4. User Directory Pipeline
async function loadUsers() {
  const tbody = document.getElementById("admin-users-table-body");
  if (!tbody) return;

  try {
    let snap;
    try {
      const q = query(collection(db, "users"), orderBy("createdAt", "desc"));
      snap = await getDocs(q);
    } catch {
      snap = await getDocs(collection(db, "users"));
    }

    cachedUsers = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    renderUsersTable(cachedUsers);
  } catch (err) {
    console.error("Failed to load users:", err);
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 2rem; color: var(--danger);">Failed to load user directory.</td></tr>`;
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById("admin-users-table-body");
  if (!tbody) return;

  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-secondary);">No user records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = users.map((u) => {
    const role = (u.role || "student").toLowerCase();
    const avatar = u.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.fullName || "User")}&background=1b5375&color=faf2dd`;
    const isSelf = u.uid === currentAdminUser.uid;

    let roleBadgeColor = "var(--text-secondary)";
    let roleBg = "var(--bg-surface-elevated)";
    if (role === "admin") {
      roleBadgeColor = "var(--aimser-cream)";
      roleBg = "var(--aimser-blue-700)";
    } else if (role === "faculty") {
      roleBadgeColor = "#38bdf8";
      roleBg = "rgba(56, 189, 248, 0.15)";
    }

    return `
      <tr style="border-bottom: 1px solid var(--border-subtle);">
        <td style="padding: 0.75rem 1rem;">
          <div style="display: flex; align-items: center; gap: 0.65rem;">
            <img src="${avatar}" alt="" style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover; border: 1px solid var(--border-medium);" />
            <span style="font-weight: 600; color: var(--text-primary);">${escapeHtml(u.fullName || "Unnamed User")} ${isSelf ? '<small style="color: var(--aimser-blue-400);">(You)</small>' : ""}</span>
          </div>
        </td>
        <td style="padding: 0.75rem 1rem; color: var(--text-secondary);">${escapeHtml(u.email || "N/A")}</td>
        <td style="padding: 0.75rem 1rem; color: var(--text-secondary);">${escapeHtml(u.department || "—")}</td>
        <td style="padding: 0.75rem 1rem;">
          <span style="display: inline-block; padding: 0.2rem 0.6rem; border-radius: 9999px; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; background: ${roleBg}; color: ${roleBadgeColor};">
            ${role}
          </span>
        </td>
        <td style="padding: 0.75rem 1rem; text-align: right;">
          <button type="button" class="btn-secondary btn-edit-role" data-uid="${u.uid}" data-name="${escapeHtml(u.fullName || u.email)}" data-role="${role}" style="padding: 0.35rem 0.75rem; font-size: 0.78rem;" ${isSelf ? "disabled title='Root Administrator'" : ""}>
            <i class="fas fa-user-tag"></i> Edit Role
          </button>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".btn-edit-role").forEach((btn) => {
    btn.addEventListener("click", () => {
      openRoleModal(btn.dataset.uid, btn.dataset.name, btn.dataset.role);
    });
  });
}

// 5. Classroom Audit Pipeline
async function loadSections() {
  const container = document.getElementById("admin-sections-grid");
  if (!container) return;

  try {
    let snap;
    let collectionUsed = "classrooms";
    try {
      snap = await getDocs(collection(db, "classrooms"));
      if (snap.empty) {
        snap = await getDocs(collection(db, "sections"));
        collectionUsed = "sections";
      }
    } catch {
      snap = await getDocs(collection(db, "sections"));
      collectionUsed = "sections";
    }

    cachedSections = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (cachedSections.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-folder-open"></i>
          <h3>No Classrooms Found</h3>
          <p>No sections or classrooms have been registered in Firestore yet.</p>
        </div>`;
      return;
    }

    container.innerHTML = cachedSections.map((sec) => `
      <div class="glass-panel" style="display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem;">
            <h3 style="margin: 0; font-size: 1.1rem; color: var(--text-primary);">${escapeHtml(sec.name || sec.title || "Untitled Section")}</h3>
            <span class="badge-pill">${escapeHtml(sec.sectionCode || sec.code || "NO-CODE")}</span>
          </div>
          <p class="text-muted" style="font-size: 0.8rem; margin-bottom: 0.85rem;">
            <strong>Instructor:</strong> ${escapeHtml(sec.instructorEmail || sec.facultyEmail || sec.createdByName || "Unknown")}
          </p>
          <div style="font-size: 0.78rem; color: var(--text-secondary); line-height: 1.6;">
            <div><i class="fas fa-users" style="width: 16px;"></i> Students Enrolled: <strong>${(sec.students || sec.enrolled || []).length}</strong></div>
            <div><i class="fas fa-tasks" style="width: 16px;"></i> Activities Created: <strong>${sec.activityCount || (sec.activities || []).length || 0}</strong></div>
          </div>
        </div>

        <div style="margin-top: 1.25rem; padding-top: 0.75rem; border-top: 1px solid var(--border-subtle); display: flex; justify-content: flex-end;">
          <button type="button" class="btn-sidebar-action btn-logout btn-delete-section" data-id="${sec.id}" data-coll="${collectionUsed}" style="width: auto; padding: 0.35rem 0.65rem; font-size: 0.75rem;">
            <i class="fas fa-trash"></i> Purge Section
          </button>
        </div>
      </div>
    `).join("");

    container.querySelectorAll(".btn-delete-section").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const coll = btn.dataset.coll;
        if (confirm("Are you sure you want to purge this classroom section?")) {
          try {
            await deleteDoc(doc(db, coll, id));
            await loadSections();
            await loadMetrics();
          } catch (err) {
            alert("Failed to delete section: " + err.message);
          }
        }
      });
    });

  } catch (err) {
    console.error("Error loading sections:", err);
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-exclamation-triangle" style="color: var(--danger);"></i>
        <h3>Failed to load sections.</h3>
        <p style="font-size: 0.8rem;">${escapeHtml(err.message)}</p>
      </div>`;
  }
}

// 6. Role Modifier Modal Engine
function setupRoleModal() {
  const modal = document.getElementById("modal-role-editor");
  const form = document.getElementById("form-update-role");
  const closeBtn = document.getElementById("btn-close-role-modal");
  const cancelBtn = document.getElementById("btn-cancel-role-modal");

  const closeModal = () => {
    if (modal) {
      modal.classList.remove("is-open");
      modal.setAttribute("aria-hidden", "true");
    }
  };

  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  if (cancelBtn) cancelBtn.addEventListener("click", closeModal);

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const uid = document.getElementById("edit-user-uid").value;
      const newRole = document.getElementById("edit-user-role-select").value;
      const submitBtn = document.getElementById("btn-submit-role");

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

      try {
        await updateDoc(doc(db, "users", uid), {
          role: newRole,
          updatedAt: serverTimestamp(),
          roleModifiedBy: currentAdminUser.email
        });

        closeModal();
        await loadUsers();
      } catch (err) {
        alert("Failed to update role: " + err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-save"></i> Save Clearance';
      }
    });
  }
}

function openRoleModal(uid, name, role) {
  const modal = document.getElementById("modal-role-editor");
  document.getElementById("edit-user-uid").value = uid;
  document.getElementById("edit-user-display").value = name;
  document.getElementById("edit-user-role-select").value = role;

  if (modal) {
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
  }
}

// 7. Navigation Tabs & Search Handlers
function setupTabs() {
  const tabs = document.querySelectorAll(".subnav-tab");
  const panels = document.querySelectorAll(".tab-panel");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const targetId = tab.dataset.tab;

      tabs.forEach((t) => t.classList.remove("active"));
      panels.forEach((p) => p.classList.remove("active"));

      tab.classList.add("active");
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) targetPanel.classList.add("active");
    });
  });

  document.querySelectorAll(".subnav-link").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      const matchingTab = document.querySelector(`.subnav-tab[data-tab="${targetId}"]`);
      if (matchingTab) matchingTab.click();
    });
  });

  document.getElementById("btn-refresh-users")?.addEventListener("click", loadUsers);
  document.getElementById("btn-refresh-sections")?.addEventListener("click", loadSections);
  document.getElementById("btn-refresh-logs")?.addEventListener("click", loadAuditLogs);
}

function setupSearch() {
  const searchInput = document.getElementById("admin-user-search");
  if (!searchInput) return;

  searchInput.addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase().trim();
    if (!term) {
      renderUsersTable(cachedUsers);
      return;
    }

    const filtered = cachedUsers.filter((u) => 
      (u.fullName && u.fullName.toLowerCase().includes(term)) ||
      (u.email && u.email.toLowerCase().includes(term)) ||
      (u.department && u.department.toLowerCase().includes(term)) ||
      (u.role && u.role.toLowerCase().includes(term))
    );

    renderUsersTable(filtered);
  });
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}