// js/admin-dashboard.js - Admin Command Center Functionality Engine
import { db, auth } from "./firebase-init.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  orderBy,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

let currentAdminUser = null;
let allUsersCache = [];

// Initialize once user is verified as admin
onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  currentAdminUser = user;

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    const role = snap.exists() ? snap.data().role : "student";

    if (role !== "admin") {
      return; // auth-guard handles the redirect
    }

    // Run core data sync
    await Promise.all([
      loadAdminKpis(),
      loadGlobalUsers(),
      loadAllClassrooms(),
      loadAuditTelemetry()
    ]);

    setupAdminTabSwitching();
    setupAdminSearch();
  } catch (err) {
    console.error("Error bootstrapping Admin Console:", err);
  }
});

// 1. KPI Telemetry Counters
async function loadAdminKpis() {
  try {
    const [uSnap, cSnap, tSnap, lSnap] = await Promise.all([
      getDocs(collection(db, "users")),
      getDocs(collection(db, "classrooms")),
      getDocs(collection(db, "planner_teams")),
      getDocs(collection(db, "activity_logs"))
    ]);

    const uEl = document.getElementById("stat-admin-users");
    const cEl = document.getElementById("stat-admin-classes");
    const tEl = document.getElementById("stat-admin-teams");
    const lEl = document.getElementById("stat-admin-logs");

    if (uEl) uEl.textContent = uSnap.size;
    if (cEl) cEl.textContent = cSnap.size;
    if (tEl) tEl.textContent = tSnap.size;
    if (lEl) lEl.textContent = lSnap.size;
  } catch (err) {
    console.warn("KPI error:", err);
  }
}

// 2. Global Account Directory Table
async function loadGlobalUsers() {
  const tbody = document.getElementById("admin-user-table-body");
  if (!tbody) return;

  try {
    const snap = await getDocs(collection(db, "users"));
    allUsersCache = [];

    snap.forEach((d) => {
      allUsersCache.push({ id: d.id, ...d.data() });
    });

    renderUsers(allUsersCache);
  } catch (err) {
    console.error("Failed to load users:", err);
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--danger-color); padding: 2rem;">Error fetching user database: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderUsers(usersList) {
  const tbody = document.getElementById("admin-user-table-body");
  if (!tbody) return;

  if (usersList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 2rem;" class="text-muted">No accounts match the search criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  usersList.forEach((u) => {
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
          <span style="font-size: 0.78rem; color: var(--text-muted); font-style: italic;">Current Session</span>
        ` : `
          <button type="button" class="btn-secondary btn-purge-user" data-uid="${u.id}" style="padding: 0.35rem 0.7rem; font-size: 0.78rem; color: var(--danger-color); border-color: rgba(239, 68, 68, 0.3);">
            <i class="fas fa-trash-alt"></i> Purge
          </button>
        `}
      </td>
    `;

    // Role modifier listener
    const select = tr.querySelector(".user-role-select");
    if (select) {
      select.addEventListener("change", async (e) => {
        const nextRole = e.target.value;
        if (confirm(`Change role of ${u.fullName || u.email} to ${nextRole.toUpperCase()}?`)) {
          try {
            await updateDoc(doc(db, "users", u.id), {
              role: nextRole,
              updatedAt: serverTimestamp()
            });

            // Log action to audit stream
            await logAdminAction("ROLE_CHANGE", `Changed ${u.email} to ${nextRole}`);
            loadAdminKpis();
          } catch (err) {
            alert("Could not update role: " + err.message);
            select.value = u.role || "student";
          }
        } else {
          select.value = u.role || "student";
        }
      });
    }

    // Account purge listener
    const purgeBtn = tr.querySelector(".btn-purge-user");
    if (purgeBtn) {
      purgeBtn.addEventListener("click", async () => {
        if (confirm(`Permanently remove profile data for ${u.fullName || u.email}? This cannot be undone.`)) {
          try {
            await deleteDoc(doc(db, "users", u.id));
            await logAdminAction("USER_PURGE", `Purged profile data for ${u.email}`);
            tr.remove();
            loadAdminKpis();
          } catch (err) {
            alert("Could not purge user: " + err.message);
          }
        }
      });
    }

    tbody.appendChild(tr);
  });
}

// 3. Global Classroom Section Overseer
async function loadAllClassrooms() {
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
          <span style="font-size: 0.75rem; color: var(--text-muted);">Faculty: ${cls.facultyUid ? cls.facultyUid.substring(0, 8) + '...' : 'Unknown'}</span>
          <button type="button" class="btn-secondary btn-delete-classroom" style="color: var(--danger-color); border-color: rgba(239, 68, 68, 0.3); padding: 0.35rem 0.65rem; font-size: 0.78rem;">
            <i class="fas fa-trash"></i> Purge Section
          </button>
        </div>
      `;

      div.querySelector(".btn-delete-classroom").addEventListener("click", async () => {
        if (confirm(`Purge classroom section "${cls.name}"? All enrolled student associations will be severed.`)) {
          try {
            await deleteDoc(doc(db, "classrooms", docSnap.id));
            await logAdminAction("SECTION_PURGE", `Deleted section ${cls.name} (${cls.code})`);
            div.remove();
            loadAdminKpis();
          } catch (err) {
            alert("Failed to delete section: " + err.message);
          }
        }
      });

      container.appendChild(div);
    });
  } catch (err) {
    console.error("Error reading sections:", err);
    container.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Could not load sections.</p></div>';
  }
}

// 4. Audit Trail Logger & Viewer
async function loadAuditTelemetry() {
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

      const time = log.timestamp?.toDate ? log.timestamp.toDate().toLocaleString() : "Recent";

      div.innerHTML = `
        <div>
          <span style="font-weight: 700; color: #ef4444; margin-right: 0.5rem;">[${escapeHtml(log.action || "EVENT")}]</span>
          <span>${escapeHtml(log.details || log.message || "Admin event")}</span>
        </div>
        <span class="text-muted" style="font-size: 0.78rem;">${time}</span>
      `;
      stream.appendChild(div);
    });
  } catch (err) {
    console.warn("Audit logs error:", err);
  }
}

async function logAdminAction(action, details) {
  try {
    await addDoc(collection(db, "activity_logs"), {
      action: action,
      details: details,
      adminUid: currentAdminUser.uid,
      adminEmail: currentAdminUser.email,
      timestamp: serverTimestamp()
    });
  } catch (err) {
    console.warn("Could not record audit log:", err);
  }
}

// 5. Tab & Search Handlers
function setupAdminTabSwitching() {
  const tabs = document.querySelectorAll("#admin-tabs .subnav-tab, .admin-tab-link");

  tabs.forEach((tab) => {
    tab.addEventListener("click", (e) => {
      e.preventDefault();
      const targetKey = tab.getAttribute("data-tab");
      if (!targetKey) return;

      // Update subnav buttons
      document.querySelectorAll("#admin-tabs .subnav-tab").forEach((b) => {
        b.classList.toggle("active", b.getAttribute("data-tab") === targetKey);
      });

      // Update active panels
      document.querySelectorAll(".tab-panel").forEach((panel) => {
        panel.style.display = "none";
        panel.classList.remove("active");
      });

      const targetPanel = document.getElementById(`tab-${targetKey}`);
      if (targetPanel) {
        targetPanel.style.display = "block";
        targetPanel.classList.add("active");
      }
    });
  });

  const refreshBtn = document.getElementById("btn-refresh-logs");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      loadAuditTelemetry();
      loadAdminKpis();
    });
  }
}

function setupAdminSearch() {
  const searchInput = document.getElementById("admin-user-search");
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = "true";
    searchInput.addEventListener("input", (e) => {
      const term = e.target.value.toLowerCase().trim();
      if (!term) {
        renderUsers(allUsersCache);
        return;
      }

      const filtered = allUsersCache.filter((u) => {
        const name = (u.fullName || "").toLowerCase();
        const email = (u.email || "").toLowerCase();
        const role = (u.role || "").toLowerCase();
        const dept = (u.department || "").toLowerCase();
        return name.includes(term) || email.includes(term) || role.includes(term) || dept.includes(term);
      });

      renderUsers(filtered);
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