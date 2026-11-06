// js/admin-dashboard.js
import { db } from "./firebase-init.js";
import { initAuthGuard } from "./auth-guard.js";
import { logActivity } from "./audit-logger.js";
import { 
  collection, 
  getDocs, 
  doc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const statUsers = document.getElementById("admin-stat-users");
const statFaculty = document.getElementById("admin-stat-faculty");
const statClassrooms = document.getElementById("admin-stat-classrooms");
const statSubmissions = document.getElementById("admin-stat-submissions");

const usersTbody = document.getElementById("admin-users-tbody");
const classroomsTbody = document.getElementById("admin-classrooms-tbody");
const btnRefreshUsers = document.getElementById("btn-refresh-users");

let currentAdminUser = null;

// Refresh Directory
btnRefreshUsers?.addEventListener("click", () => {
  loadAdminDirectory();
  loadClassroomSessions();
});

// Load System Metrics
async function loadMetrics() {
  try {
    const usersSnap = await getDocs(collection(db, "users"));
    if (statUsers) statUsers.textContent = usersSnap.size;

    let facultyCount = 0;
    usersSnap.forEach(d => {
      if (d.data().role === "faculty") facultyCount++;
    });
    if (statFaculty) statFaculty.textContent = facultyCount;

    const classSnap = await getDocs(query(collection(db, "classrooms"), where("active", "==", true)));
    if (statClassrooms) statClassrooms.textContent = classSnap.size;

    const subSnap = await getDocs(collection(db, "submissions"));
    if (statSubmissions) statSubmissions.textContent = subSnap.size;
  } catch (err) {
    console.error("Failed to load admin metrics:", err);
  }
}

// Load All Registered Users
async function loadAdminDirectory() {
  if (!usersTbody) return;

  try {
    const snap = await getDocs(collection(db, "users"));

    if (snap.empty) {
      usersTbody.innerHTML = `<tr><td colspan="5" class="empty-state">No users registered in the system.</td></tr>`;
      return;
    }

    let rowsHtml = "";
    snap.forEach(docSnap => {
      const data = docSnap.data();
      const uid = docSnap.id;
      const fullName = `${data.firstName || ""} ${data.lastName || ""}`.trim() || "No Name Provided";
      const email = data.email || "No Email";
      const role = data.role || "student";
      const classCode = data.classroomCode || "—";

      let badgeClass = "badge-admin-student";
      if (role === "faculty") badgeClass = "badge-admin-faculty";
      if (role === "admin") badgeClass = "badge-admin-admin";

      rowsHtml += `
        <tr>
          <td style="font-weight: 600;">${escapeHtml(fullName)}</td>
          <td style="color: var(--text-secondary);">${escapeHtml(email)}</td>
          <td><span class="badge-admin-pill ${badgeClass}">${escapeHtml(role.toUpperCase())}</span></td>
          <td style="font-family: var(--font-mono);">${escapeHtml(classCode)}</td>
          <td>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              <button type="button" class="btn btn-secondary btn-set-role" data-uid="${uid}" data-role="student" style="padding: 4px 8px; font-size: 11px;">
                Make Student
              </button>
              <button type="button" class="btn btn-secondary btn-set-role" data-uid="${uid}" data-role="faculty" style="padding: 4px 8px; font-size: 11px; color: var(--faculty-accent);">
                Make Faculty
              </button>
              <button type="button" class="btn btn-secondary btn-set-role" data-uid="${uid}" data-role="admin" style="padding: 4px 8px; font-size: 11px; color: var(--danger);">
                Make Admin
              </button>
              <button type="button" class="btn btn-secondary btn-delete-user" data-uid="${uid}" data-name="${escapeHtml(fullName)}" style="padding: 4px 8px; font-size: 11px; color: var(--danger); border-color: rgba(239, 68, 68, 0.3);">
                Delete
              </button>
            </div>
          </td>
        </tr>
      `;
    });

    usersTbody.innerHTML = rowsHtml;

    // Attach Role Modification Handlers
    document.querySelectorAll(".btn-set-role").forEach(btn => {
      btn.addEventListener("click", async () => {
        const targetUid = btn.dataset.uid;
        const targetRole = btn.dataset.role;

        try {
          await updateDoc(doc(db, "users", targetUid), {
            role: targetRole
          });

          await logActivity({
            category: "System",
            details: `Admin changed role of user ${targetUid} to ${targetRole}`,
            classroomCode: "GLOBAL",
            userEmail: currentAdminUser.email
          });

          alert(`Updated user role to ${targetRole.toUpperCase()}.`);
          loadAdminDirectory();
          loadMetrics();
        } catch (err) {
          console.error("Role update error:", err);
          alert("Could not update role: " + err.message);
        }
      });
    });

    // Attach User Deletion Handler
    document.querySelectorAll(".btn-delete-user").forEach(btn => {
      btn.addEventListener("click", async () => {
        const targetUid = btn.dataset.uid;
        const targetName = btn.dataset.name;

        if (confirm(`Permanently remove ${targetName} (${targetUid}) from Aimser?`)) {
          try {
            await deleteDoc(doc(db, "users", targetUid));
            alert("User profile record deleted from database.");
            loadAdminDirectory();
            loadMetrics();
          } catch (err) {
            console.error("User deletion error:", err);
            alert("Could not delete user: " + err.message);
          }
        }
      });
    });

  } catch (err) {
    console.error("Error reading users directory:", err);
  }
}

// Load Active Classroom Sessions
async function loadClassroomSessions() {
  if (!classroomsTbody) return;

  try {
    const snap = await getDocs(collection(db, "classrooms"));

    if (snap.empty) {
      classroomsTbody.innerHTML = `<tr><td colspan="5" class="empty-state">No classroom sessions logged in system.</td></tr>`;
      return;
    }

    let rowsHtml = "";
    snap.forEach(docSnap => {
      const data = docSnap.data();
      const facultyUid = docSnap.id;
      const code = data.code || "------";
      const isActive = data.active === true;
      const expiresAt = data.expiresAt?.toDate ? data.expiresAt.toDate().toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "Indefinite";

      rowsHtml += `
        <tr>
          <td style="font-weight: 700; font-family: var(--font-mono); color: var(--accent);">${escapeHtml(code)}</td>
          <td style="font-family: var(--font-mono); font-size: 12px; color: var(--text-tertiary);">${escapeHtml(facultyUid)}</td>
          <td>
            <span class="status-badge ${isActive ? 'active' : ''}">
              ${isActive ? "Active" : "Deactivated"}
            </span>
          </td>
          <td style="font-size: 13px; color: var(--text-secondary);">${expiresAt}</td>
          <td>
            ${isActive ? `
              <button type="button" class="btn btn-secondary btn-kill-session" data-uid="${facultyUid}" data-code="${code}" style="padding: 4px 10px; font-size: 11px; color: var(--danger);">
                Force Close Session
              </button>
            ` : `<span style="font-size: 12px; color: var(--text-tertiary);">Session Closed</span>`}
          </td>
        </tr>
      `;
    });

    classroomsTbody.innerHTML = rowsHtml;

    // Attach Session Termination Handlers
    document.querySelectorAll(".btn-kill-session").forEach(btn => {
      btn.addEventListener("click", async () => {
        const targetFacultyUid = btn.dataset.uid;
        const targetCode = btn.dataset.code;

        if (confirm(`Force deactivate session ${targetCode}?`)) {
          try {
            await updateDoc(doc(db, "classrooms", targetFacultyUid), {
              active: false
            });
            alert(`Classroom session ${targetCode} deactivated.`);
            loadClassroomSessions();
            loadMetrics();
          } catch (err) {
            console.error("Force close failed:", err);
            alert("Could not close session: " + err.message);
          }
        }
      });
    });

  } catch (err) {
    console.error("Error loading classroom sessions:", err);
  }
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

// Strict Admin Gate
initAuthGuard({
  requiredRole: "admin",
  onReady: ({ user }) => {
    currentAdminUser = user;
    loadMetrics();
    loadAdminDirectory();
    loadClassroomSessions();
  }
});