// js/admin-dashboard.js - Complete Administrator Management, Sidebar Sync & Telemetry Engine
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
import { FastCache, escapeHtml, sanitizeUrl, logAuditEvent } from "./security-utils.js";

let currentAdminUser = null;
let cachedUsers = [];
let cachedSections = [];
let cachedLogs = [];
let editingUserEmail = "";

// 1. Initialize Navigation & Modals Immediately on DOM Load
document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  applyInitialHashRoute();
  setupSearchAndFilters();
  setupRoleModal();
});

// 2. Authenticate & Enforce Administrator Clearance
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }

  try {
    const cachedProfile = FastCache.get("user_profile");
    if (cachedProfile && (cachedProfile.role || "").toLowerCase() === "admin") {
      renderAdminIdentity(user, cachedProfile);
    }

    const userSnap = await getDoc(doc(db, "users", user.uid));
    const userData = userSnap.exists() ? userSnap.data() : {};
    const role = (userData.role || "").toLowerCase();

    if (role !== "admin") {
      alert("Unauthorized Access: Administrator clearance required.");
      window.location.replace("office.html");
      return;
    }

    currentAdminUser = user;
    renderAdminIdentity(user, userData);

    // Hydrate from FastCache immediately for 0ms render
    const snapMetrics = FastCache.get("admin_metrics");
    if (snapMetrics) applyMetricsToDOM(snapMetrics);

    const snapUsers = FastCache.get("admin_users");
    if (snapUsers) {
      cachedUsers = snapUsers;
      renderUsersTable(cachedUsers);
    }

    const snapLogs = FastCache.get("admin_logs");
    if (snapLogs) {
      cachedLogs = snapLogs;
      renderAuditLogsList(cachedLogs);
    }

    // Revalidate all live Firestore collections concurrently
    await Promise.allSettled([loadMetrics(), loadUsers(), loadSections(), loadAuditLogs()]);
  } catch (err) {
    console.error("Admin initialization error:", err);
  }
});

function renderAdminIdentity(user, data) {
  const headerName = document.getElementById("header-user-name");
  const headerRole = document.getElementById("header-user-role");
  const headerAvatar = document.getElementById("header-user-avatar");

  const name = data.fullName || user.displayName || "Administrator";
  const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=1b5375&color=faf2dd`;
  const avatar = sanitizeUrl(data.avatarUrl || user.photoURL, fallback);

  if (headerName) headerName.textContent = name;
  if (headerRole) headerRole.textContent = "SYSTEM ADMIN";
  if (headerAvatar) headerAvatar.src = avatar;
}

// 3. Multi-Collection Telemetry Metrics
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

  let sectionsCount = await getSafeCount("classrooms");
  if (sectionsCount === 0) {
    sectionsCount = await getSafeCount("sections");
  }

  const teamsCount = await getSafeCount("teams");

  let logsCount = await getSafeCount("audit_logs");
  if (logsCount === 0) {
    logsCount = await getSafeCount("logs");
  }

  const metrics = { usersCount, sectionsCount, teamsCount, logsCount };
  FastCache.set("admin_metrics", metrics);
  applyMetricsToDOM(metrics);
}

function applyMetricsToDOM(metrics) {
  const elUsers = document.getElementById("stat-total-users");
  const elSections = document.getElementById("stat-total-sections");
  const elTeams = document.getElementById("stat-total-teams");
  const elLogs = document.getElementById("stat-total-logs");

  if (elUsers) elUsers.textContent = (metrics.usersCount ?? 0).toLocaleString();
  if (elSections) elSections.textContent = (metrics.sectionsCount ?? 0).toLocaleString();
  if (elTeams) elTeams.textContent = (metrics.teamsCount ?? 0).toLocaleString();
  if (elLogs) elLogs.textContent = (metrics.logsCount ?? 0).toLocaleString();
}

// 4. Telemetry & Platform Audit Trail
async function loadAuditLogs() {
  const container = document.getElementById("admin-logs-container");
  const elLogs = document.getElementById("stat-total-logs");
  if (!container) return;

  try {
    let logsSnap = null;

    try {
      const q = query(collection(db, "audit_logs"), orderBy("timestamp", "desc"), limit(100));
      logsSnap = await getDocs(q);
    } catch {
      try {
        logsSnap = await getDocs(query(collection(db, "logs"), orderBy("timestamp", "desc"), limit(100)));
      } catch {
        try {
          logsSnap = await getDocs(collection(db, "audit_logs"));
        } catch {
          logsSnap = await getDocs(collection(db, "logs"));
        }
      }
    }

    if (!logsSnap || logsSnap.empty) {
      cachedLogs = [];
      if (elLogs) elLogs.textContent = "0";
      renderAuditLogsList([]);
      return;
    }

    cachedLogs = logsSnap.docs
      .map((d) => {
        const data = d.data();
        const tsMillis = data.timestamp?.toMillis
          ? data.timestamp.toMillis()
          : data.timestamp
            ? new Date(data.timestamp).getTime()
            : 0;
        return {
          id: d.id,
          message: data.message || data.action || data.event || data.details || "System Event Recorded",
          category: data.category || "EVENT",
          tsMillis
        };
      })
      .sort((a, b) => b.tsMillis - a.tsMillis);

    FastCache.set("admin_logs", cachedLogs);
    if (elLogs) elLogs.textContent = cachedLogs.length.toLocaleString();
    renderAuditLogsList(cachedLogs);
  } catch (err) {
    console.error("Error loading audit logs:", err);
    container.innerHTML = `
      <div class="empty-state" style="padding: 2.5rem 1.5rem;">
        <i class="fas fa-exclamation-triangle" style="color: var(--warning);"></i>
        <h3>Audit Trail Unavailable</h3>
        <p style="font-size: 0.8rem;">${escapeHtml(err.message)}</p>
      </div>`;
  }
}

function renderAuditLogsList(logs) {
  const container = document.getElementById("admin-logs-container");
  if (!container) return;

  if (!logs || logs.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 2.5rem 1.5rem;">
        <i class="fas fa-clipboard-list"></i>
        <h3>No Telemetry Events Logged</h3>
        <p style="font-size: 0.8rem;">User registrations, classroom join requests, and role adjustments will stream here automatically.</p>
      </div>`;
    return;
  }

  container.innerHTML = logs
    .map((item) => {
      const formattedDate = item.tsMillis
        ? `${new Date(item.tsMillis).toLocaleDateString()}, ${new Date(item.tsMillis).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
          })}`
        : "Recent";

      return `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1rem; border-radius: var(--radius-sm); background: var(--bg-surface); border: 1px solid var(--border-subtle); font-family: var(--font-mono); font-size: 0.8125rem;">
          <div style="display: flex; align-items: center; gap: 0.65rem; word-break: break-word;">
            <span style="color: var(--danger); font-weight: 700;">[EVENT]</span>
            <span style="color: var(--text-primary);">${escapeHtml(item.message)}</span>
          </div>
          <span style="color: var(--text-tertiary); font-size: 0.75rem; white-space: nowrap; margin-left: 1rem;">${formattedDate}</span>
        </div>`;
    })
    .join("");
}

// 5. User Directory Pipeline
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
    FastCache.set("admin_users", cachedUsers);
    applyUserFilters();
  } catch (err) {
    console.error("Failed to load users:", err);
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 2rem; color: var(--danger);">Failed to load user directory: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById("admin-users-table-body");
  if (!tbody) return;

  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-secondary);">No user records found matching your filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = users
    .map((u) => {
      const role = (u.role || "student").toLowerCase();
      const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(u.fullName || "User")}&background=1b5375&color=faf2dd`;
      const avatar = sanitizeUrl(u.avatarUrl, fallback);
      const isSelf = currentAdminUser && u.uid === currentAdminUser.uid;

      let roleBadgeColor = "var(--text-secondary)";
      let roleBg = "var(--bg-surface-elevated)";
      if (role === "admin") {
        roleBadgeColor = "#ffffff";
        roleBg = "var(--aimser-blue-700)";
      } else if (role === "faculty") {
        roleBadgeColor = "#38bdf8";
        roleBg = "rgba(56, 189, 248, 0.16)";
      } else {
        roleBadgeColor = "#10b981";
        roleBg = "rgba(16, 185, 129, 0.16)";
      }

      return `
        <tr style="border-bottom: 1px solid var(--border-subtle);">
          <td style="padding: 0.75rem 1rem;">
            <div style="display: flex; align-items: center; gap: 0.65rem;">
              <img src="${avatar}" alt="" style="width: 30px; height: 30px; border-radius: 50%; object-fit: cover; border: 1px solid var(--border-medium);" />
              <span style="font-weight: 600; color: var(--text-primary);">${escapeHtml(u.fullName || "Unnamed User")} ${isSelf ? '<small style="color: var(--aimser-blue-400);">(You)</small>' : ""}</span>
            </div>
          </td>
          <td style="padding: 0.75rem 1rem; color: var(--text-secondary);">${escapeHtml(u.email || "N/A")}</td>
          <td style="padding: 0.75rem 1rem; color: var(--text-secondary);">${escapeHtml(u.department || "—")}</td>
          <td style="padding: 0.75rem 1rem;">
            <span style="display: inline-block; padding: 0.2rem 0.6rem; border-radius: 9999px; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; background: ${roleBg}; color: ${roleBadgeColor};">
              ${escapeHtml(role)}
            </span>
          </td>
          <td style="padding: 0.75rem 1rem; text-align: right;">
            <button type="button" class="btn-secondary btn-edit-role" data-uid="${u.uid}" data-name="${escapeHtml(u.fullName || u.email)}" data-email="${escapeHtml(u.email || u.uid)}" data-role="${role}" style="padding: 0.35rem 0.75rem; font-size: 0.78rem;" ${isSelf ? "disabled title='Root Administrator'" : ""}>
              <i class="fas fa-user-tag"></i> Edit Role
            </button>
          </td>
        </tr>`;
    })
    .join("");

  tbody.querySelectorAll(".btn-edit-role").forEach((btn) => {
    btn.addEventListener("click", () => {
      openRoleModal(btn.dataset.uid, btn.dataset.name, btn.dataset.email, btn.dataset.role);
    });
  });
}

// 6. Classroom Audit Pipeline
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

    container.innerHTML = cachedSections
      .map((sec) => {
        const code = sec.sectionCode || sec.code || "NO-CODE";
        const enrolledCount = (sec.students || sec.enrolled || []).length;
        const maxCap = sec.maxStudents || 100;

        return `
          <div class="glass-panel" style="display: flex; flex-direction: column; justify-content: space-between;">
            <div>
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem; gap: 0.5rem;">
                <h3 style="margin: 0; font-size: 1.05rem; color: var(--text-primary);">${escapeHtml(sec.name || sec.title || "Untitled Section")}</h3>
                <span class="badge-pill">${escapeHtml(code)}</span>
              </div>
              <p class="text-muted" style="font-size: 0.8rem; margin-bottom: 0.85rem;">
                <strong>Instructor:</strong> ${escapeHtml(sec.instructorEmail || sec.facultyEmail || sec.createdByName || "Unknown")}
              </p>
              <div style="font-size: 0.78rem; color: var(--text-secondary); line-height: 1.65;">
                <div><i class="fas fa-users" style="width: 16px;"></i> Students Enrolled: <strong>${enrolledCount} / ${maxCap}</strong></div>
                <div><i class="fas fa-tasks" style="width: 16px;"></i> Activities Published: <strong>${sec.activityCount || (sec.activities || []).length || 0}</strong></div>
              </div>
            </div>

            <div style="margin-top: 1.25rem; padding-top: 0.75rem; border-top: 1px solid var(--border-subtle); display: flex; justify-content: flex-end;">
              <button type="button" class="btn-sidebar-action btn-logout btn-delete-section" data-id="${sec.id}" data-code="${escapeHtml(code)}" data-coll="${collectionUsed}" style="width: auto; padding: 0.35rem 0.65rem; font-size: 0.75rem;">
                <i class="fas fa-trash"></i> Purge Section
              </button>
            </div>
          </div>`;
      })
      .join("");

    container.querySelectorAll(".btn-delete-section").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const coll = btn.dataset.coll;
        const code = btn.dataset.code;
        if (confirm(`Are you sure you want to permanently purge classroom section "${code}"?`)) {
          try {
            await deleteDoc(doc(db, coll, id));
            await logAuditEvent(`Admin purged classroom section ${code}`, "CLASSROOM", currentAdminUser.email);
            await Promise.all([loadSections(), loadMetrics(), loadAuditLogs()]);
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

// 7. Role Modifier Modal Engine
function setupRoleModal() {
  const modal = document.getElementById("modal-role-editor");
  const form = document.getElementById("form-update-role");
  const closeBtn = document.getElementById("btn-close-role-modal");
  const cancelBtn = document.getElementById("btn-cancel-role-modal");

  if (!modal || modal.dataset.bound) return;
  modal.dataset.bound = "true";

  const closeModal = () => {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
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

        await logAuditEvent(
          `Admin updated role for ${editingUserEmail || uid} to [${newRole}]`,
          "ROLE_CHANGE",
          currentAdminUser.email
        );

        closeModal();
        await Promise.all([loadUsers(), loadAuditLogs()]);
      } catch (err) {
        alert("Failed to update role: " + err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-save"></i> Save Clearance';
      }
    });
  }
}

function openRoleModal(uid, name, email, role) {
  editingUserEmail = email;
  const modal = document.getElementById("modal-role-editor");
  document.getElementById("edit-user-uid").value = uid;
  document.getElementById("edit-user-display").value = `${name} (${email})`;
  document.getElementById("edit-user-role-select").value = role;

  if (modal) {
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
  }
}

// 8. Synchronized Tabs, Sidebar Active Highlight & Hash Routing
function activateAdminTab(targetPanelId, clickedSidebarKey = null) {
  const tabs = document.querySelectorAll(".subnav-tab");
  const panels = document.querySelectorAll(".tab-panel");
  const sidebarBtns = document.querySelectorAll(".subnav-link");

  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === targetPanelId));
  panels.forEach((p) => p.classList.toggle("active", p.id === targetPanelId));

  const resolvedKey =
    clickedSidebarKey ||
    (targetPanelId === "panel-users"
      ? "users"
      : targetPanelId === "panel-sections"
        ? "sections"
        : "overview");

  sidebarBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.navKey === resolvedKey);
  });

  if (resolvedKey === "audit") {
    document.getElementById("audit-trail-card")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function applyInitialHashRoute() {
  const hash = window.location.hash.toLowerCase();
  if (hash === "#users") {
    activateAdminTab("panel-users", "users");
  } else if (hash === "#sections") {
    activateAdminTab("panel-sections", "sections");
  } else if (hash === "#audit") {
    activateAdminTab("panel-telemetry", "audit");
  } else {
    activateAdminTab("panel-telemetry", "overview");
  }
}

function setupTabs() {
  document.querySelectorAll(".subnav-tab").forEach((tab) => {
    if (tab.dataset.bound) return;
    tab.dataset.bound = "true";
    tab.addEventListener("click", () => {
      activateAdminTab(tab.dataset.tab);
    });
  });

  document.querySelectorAll(".subnav-link").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "true";
    btn.addEventListener("click", () => {
      activateAdminTab(btn.dataset.target, btn.dataset.navKey);
    });
  });

  document.getElementById("btn-refresh-users")?.addEventListener("click", loadUsers);
  document.getElementById("btn-refresh-sections")?.addEventListener("click", loadSections);
  document.getElementById("btn-refresh-logs")?.addEventListener("click", async () => {
    await Promise.all([loadAuditLogs(), loadMetrics()]);
  });
}

// 9. Search & Role Filtering
function applyUserFilters() {
  const term = (document.getElementById("admin-user-search")?.value || "").toLowerCase().trim();
  const roleFilter = (document.getElementById("admin-role-filter")?.value || "all").toLowerCase();

  const filtered = cachedUsers.filter((u) => {
    const uRole = (u.role || "student").toLowerCase();
    const matchesRole = roleFilter === "all" || uRole === roleFilter;
    const matchesTerm =
      !term ||
      (u.fullName && u.fullName.toLowerCase().includes(term)) ||
      (u.email && u.email.toLowerCase().includes(term)) ||
      (u.department && u.department.toLowerCase().includes(term));
    return matchesRole && matchesTerm;
  });

  renderUsersTable(filtered);
}

function setupSearchAndFilters() {
  document.getElementById("admin-user-search")?.addEventListener("input", applyUserFilters);
  document.getElementById("admin-role-filter")?.addEventListener("change", applyUserFilters);

  document.getElementById("admin-log-search")?.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) {
      renderAuditLogsList(cachedLogs);
      return;
    }
    const filtered = cachedLogs.filter((l) => (l.message || "").toLowerCase().includes(q));
    renderAuditLogsList(filtered);
  });
}