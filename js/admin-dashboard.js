// js/admin-dashboard.js - Super Administrator Command Engine
import { db, auth } from "./firebase-init.js";
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
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

let currentAdminUser = null;
let allUsersCache = [];

// 1. Auth & Admin Security Guard
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }
  currentAdminUser = user;

  try {
    const profileSnap = await getDoc(doc(db, "users", user.uid));
    const role = profileSnap.exists() ? (profileSnap.data().role || "student") : "student";

    if (role !== "admin") {
      alert("Access Denied: Super Administrator privileges required.");
      window.location.replace("office.html");
      return;
    }

    // Populate header details
    const nameEl = document.getElementById("header-user-name");
    const roleEl = document.getElementById("header-user-role");
    const avatarEl = document.getElementById("header-user-avatar");
    if (nameEl) nameEl.textContent = profileSnap.data().fullName || user.email;
    if (roleEl) roleEl.textContent = "Super Administrator";
    if (avatarEl && profileSnap.data().avatarUrl) avatarEl.src = profileSnap.data().avatarUrl;

    // Load admin panels
    await Promise.all([
      loadKpiTelemetry(),
      loadUsersTable(),
      loadSectionsOverseer(),
      loadAuditLogs()
    ]);

    setupAdminListeners();
  } catch (err) {
    console.error("Admin verification error:", err);
    window.location.replace("office.html");
  }
});

// 2. Load Metric Counters
async function loadKpiTelemetry() {
  try {
    const [usersSnap, classesSnap, teamsSnap, logsSnap] = await Promise.all([
      getDocs(collection(db, "users")),
      getDocs(collection(db, "classrooms")),
      getDocs(collection(db, "planner_teams")),
      getDocs(collection(db, "activity_logs"))
    ]);

    const usersEl = document.getElementById("stat-admin-users");
    const classesEl = document.getElementById("stat-admin-classes");
    const teamsEl = document.getElementById("stat-admin-teams");
    const logsEl = document.getElementById("stat-admin-logs");

    if (usersEl) usersEl.textContent = usersSnap.size;
    if (classesEl) classesEl.textContent = classesSnap.size;
    if (teamsEl) teamsEl.textContent = teamsSnap.size;
    if (logsEl) logsEl.textContent = logsSnap.size;
  } catch (err) {
    console.warn("Telemetry loading warning:", err);
  }
}

// 3. User Directory Table & Live Search
async function loadUsersTable() {
  const tbody = document.getElementById("admin-user-table-body");
  if (!tbody) return;

  try {
    const snap = await getDocs(collection(db, "users"));
    allUsersCache = [];

    snap.forEach((d) => {
      allUsersCache.push({ id: d.id, ...d.data() });
    });

    renderUsersTable(allUsersCache);
  } catch (err) {
    console.error("Error reading users:", err);
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--danger-color); padding: 2rem;">Failed to load accounts: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById("admin-user-table-body");
  if (!tbody) return;

  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 2rem;" class="text-muted">No registered accounts found.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  users.forEach((u) => {
    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid var(--border-color)";

    const isSelf = u.id === currentAdminUser.uid;

    tr.innerHTML = `
      <td style="padding: 0.85rem 0.75rem;">
        <div style="font-weight: 600; color: var(--text-main);">${escapeHtml(u.fullName || "Unnamed User")}</div>
        <div style="font-size: 0.78rem; color: var(--text-muted);">${escapeHtml(u.email || u.id)}</div>
      </td>
      <td style="padding: 0.85rem 0.75rem; color: var(--text-muted); font-size: 0.85rem;">
        ${escapeHtml(u.department || "General Cohort")}
      </td>
      <td style="padding: 0.85rem 0.75rem;">
        <select class="user-role-select form-control" data-uid="${u.id}" ${isSelf ? "disabled" : ""} style="padding: 0.35rem 0.6rem; font-size: 0.8rem; max-width: 130px;">
          <option value="student" ${u.role === "student" ? "selected" : ""}>Student</option>
          <option value="faculty" ${u.role === "faculty" ? "selected" : ""}>Faculty</option>
          <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option>
        </select>
      </td>
      <td style="padding: 0.85rem 0.75rem;">
        ${isSelf ? `
          <span style="font-size: 0.78rem; color: var(--text-muted); font-style: italic;">Active Session</span>
        ` : `
          <button type="button" class="btn-secondary btn-purge-user" data-uid="${u.id}" style="padding: 0.35rem 0.7rem; font-size: 0.78rem; color: var(--danger-color); border-color: rgba(239, 68, 68, 0.3);">
            <i class="fas fa-trash-alt"></i> Purge
          </button>
        `}
      </td>
    `;

    // Role Change Listener
    const roleSelect = tr.querySelector(".user-role-select");
    if (roleSelect) {
      roleSelect.addEventListener("change", async (e) => {
        const newRole = e.target.value;
        if (confirm(`Change role of ${u.fullName || u.email} to ${newRole.toUpperCase()}?`)) {
          try {
            await updateDoc(doc(db, "users", u.id), {
              role: newRole,
              updatedAt: serverTimestamp()
            });
            alert("Role updated successfully.");
            loadKpiTelemetry();
          } catch (err) {
            alert("Failed to update role: " + err.message);
            roleSelect.value = u.role || "student";
          }
        } else {
          roleSelect.value = u.role || "student";
        }
      });
    }

    // Purge Account Listener
    const purgeBtn = tr.querySelector(".btn-purge-user");
    if (purgeBtn) {
      purgeBtn.addEventListener("click", async () => {
        if (confirm(`Are you sure you want to purge profile data for ${u.fullName || u.email}? This cannot be undone.`)) {
          try {
            await deleteDoc(doc(db, "users", u.id));
            tr.remove();
            loadKpiTelemetry();
          } catch (err) {
            alert("Failed to purge account record: " + err.message);
          }
        }
      });
    }

    tbody.appendChild(tr);
  });
}

// 4. Section Overseer Grid
async function loadSectionsOverseer() {
  const container = document.getElementById("admin-sections-grid");
  if (!container) return;

  try {
    const snap = await getDocs(collection(db, "classrooms"));
    if (snap.empty) {
      container.innerHTML = '<div class="empty-state"><i class="fas fa-chalkboard"></i><p>No classroom sections registered in the simulator.</p></div>';
      return;
    }

    container.innerHTML = "";
    snap.forEach((docSnap) => {
      const cls = docSnap.data();
      const div = document.createElement("div");
      div.className = "glass-panel";
      div.style.padding = "1.25rem";
      div.style.display = "flex";
      div.style.flexDirection = "column";
      div.style.justifyContent = "space-between";

      div.innerHTML = `
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
            <span class="badge-pill">Code: ${escapeHtml(cls.code || "---")}</span>
            <span style="font-size: 0.78rem; color: var(--text-muted);"><i class="fas fa-user-graduate"></i> ${(cls.students || []).length} Students</span>
          </div>
          <h3 style="margin: 0 0 0.35rem 0; font-size: 1.1rem;">${escapeHtml(cls.name)}</h3>
          <p class="text-muted" style="font-size: 0.85rem; margin: 0 0 1rem 0;">${escapeHtml(cls.description || "No course description provided.")}</p>
        </div>
        <div style="border-top: 1px solid var(--border-color); padding-top: 0.75rem; margin-top: 0.75rem; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 0.75rem; color: var(--text-muted);">Instructor UID: ${cls.facultyUid ? cls.facultyUid.substring(0, 8) + '...' : 'Unknown'}</span>
          <button type="button" class="btn-secondary btn-delete-classroom" style="color: var(--danger-color); border-color: rgba(239, 68, 68, 0.3); padding: 0.35rem 0.65rem; font-size: 0.78rem;">
            <i class="fas fa-trash"></i> Purge Section
          </button>
        </div>
      `;

      div.querySelector(".btn-delete-classroom").addEventListener("click", async () => {
        if (confirm(`Permanently purge section "${cls.name}" and delete its roster linkage?`)) {
          try {
            await deleteDoc(doc(db, "classrooms", docSnap.id));
            div.remove();
            loadKpiTelemetry();
          } catch (err) {
            alert("Failed to delete section: " + err.message);
          }
        }
      });

      container.appendChild(div);
    });
  } catch (err) {
    console.error("Error reading sections:", err);
    container.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Failed to load classroom sections.</p></div>';
  }
}

// 5. Activity & Audit Trail Stream
async function loadAuditLogs() {
  const stream = document.getElementById("admin-audit-stream");
  if (!stream) return;

  try {
    const q = query(collection(db, "activity_logs"), orderBy("timestamp", "desc"), limit(25));
    const snap = await getDocs(q);

    if (snap.empty) {
      stream.innerHTML = '<div class="empty-state"><i class="fas fa-history"></i><p>No telemetry events logged yet.</p></div>';
      return;
    }

    stream.innerHTML = "";
    snap.forEach((docSnap) => {
      const log = docSnap.data();
      const div = document.createElement("div");
      div.style.padding = "0.75rem 0";
      div.style.borderBottom = "1px solid var(--border-color)";
      div.style.display = "flex";
      div.style.justifyContent = "space-between";
      div.style.alignItems = "center";
      div.style.fontSize = "0.85rem";

      const time = log.timestamp?.toDate ? log.timestamp.toDate().toLocaleTimeString() : "Recent";

      div.innerHTML = `
        <div>
          <span style="font-weight: 600; color: #38bdf8; margin-right: 0.5rem;">[${escapeHtml(log.action || "EVENT")}]</span>
          <span>${escapeHtml(log.details || log.message || "Telemetry event")}</span>
        </div>
        <span class="text-muted" style="font-size: 0.78rem;">${time}</span>
      `;
      stream.appendChild(div);
    });
  } catch (err) {
    console.warn("Audit logs error:", err);
    stream.innerHTML = '<div class="empty-state"><i class="fas fa-stream"></i><p>System activity telemetry stream ready.</p></div>';
  }
}

// 6. Event Listeners & Search
function setupAdminListeners() {
  // Live user search filter
  const searchInput = document.getElementById("admin-user-search");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const query = e.target.value.toLowerCase().trim();
      if (!query) {
        renderUsersTable(allUsersCache);
        return;
      }
      const filtered = allUsersCache.filter((u) => {
        const name = (u.fullName || "").toLowerCase();
        const email = (u.email || "").toLowerCase();
        const role = (u.role || "").toLowerCase();
        const dept = (u.department || "").toLowerCase();
        return name.includes(query) || email.includes(query) || role.includes(query) || dept.includes(query);
      });
      renderUsersTable(filtered);
    });
  }

  // Refresh logs button
  const refreshBtn = document.getElementById("btn-refresh-logs");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      loadAuditLogs();
      loadKpiTelemetry();
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