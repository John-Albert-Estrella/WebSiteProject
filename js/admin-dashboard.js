import { auth, db } from "./firebase-init.js";
import { initAuthGuard } from "./auth-guard.js";
import { logActivity } from "./audit-logger.js";
import { 
  collection, 
  query, 
  onSnapshot, 
  doc, 
  getDoc,
  updateDoc, 
  deleteDoc, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// Metric DOM
const statStudents = document.getElementById("stat-total-students");
const statFaculty = document.getElementById("stat-total-faculty");
const statClasses = document.getElementById("stat-total-classes");
const statLogs = document.getElementById("stat-total-logs");

// User Table DOM
const usersTbody = document.getElementById("users-tbody");
const userSearchInput = document.getElementById("user-search-input");
const userRoleFilter = document.getElementById("user-role-filter");

// Classrooms & Logs DOM
const adminClassesTbody = document.getElementById("admin-classes-tbody");
const adminAuditTbody = document.getElementById("admin-audit-tbody");

let currentUser = null;
let cachedUsers = [];
let cachedClassrooms = [];

initAuthGuard({
  allowedRoles: ["admin"],
  onReady: ({ user }) => {
    currentUser = user;
    initUsersStream();
    initClassroomsStream();
    initTelemetryStream();
  }
});

// =========================================================================
// 1. USERS DIRECTORY & ROLE MANAGEMENT
// =========================================================================
function initUsersStream() {
  const usersQ = query(collection(db, "users"));

  onSnapshot(usersQ, (snapshot) => {
    cachedUsers = [];
    let studentCount = 0;
    let facultyCount = 0;

    snapshot.forEach((docSnap) => {
      const u = { id: docSnap.id, ...docSnap.data() };
      cachedUsers.push(u);

      if (u.role === "student") studentCount++;
      else if (u.role === "faculty") facultyCount++;
    });

    if (statStudents) statStudents.textContent = studentCount;
    if (statFaculty) statFaculty.textContent = facultyCount;

    renderUsersTable();
  }, (err) => {
    console.error("Users listener error:", err);
  });

  userSearchInput?.addEventListener("input", renderUsersTable);
  userRoleFilter?.addEventListener("change", renderUsersTable);
}

function renderUsersTable() {
  if (!usersTbody) return;
  usersTbody.innerHTML = "";

  const searchTerm = userSearchInput?.value.toLowerCase().trim() || "";
  const roleFilter = userRoleFilter?.value || "all";

  const filtered = cachedUsers.filter((u) => {
    const fullName = `${u.firstName || ""} ${u.lastName || ""}`.toLowerCase();
    const email = (u.email || "").toLowerCase();
    const matchesSearch = fullName.includes(searchTerm) || email.includes(searchTerm);
    const matchesRole = roleFilter === "all" || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  if (filtered.length === 0) {
    usersTbody.innerHTML = `<tr><td colspan="6" class="empty-state">No matching user accounts found.</td></tr>`;
    return;
  }

  filtered.forEach((u) => {
    const tr = document.createElement("tr");
    const nameDisplay = `${u.firstName || ""} ${u.lastName || ""}`.trim() || "Institutional User";
    const isSelf = u.id === currentUser.uid;

    tr.innerHTML = `
      <td><strong>${nameDisplay}</strong></td>
      <td>${u.email || "No Email"}</td>
      <td>
        <span class="role-tag ${u.role || "student"}">${(u.role || "student").toUpperCase()}</span>
      </td>
      <td>
        ${u.classroomCode 
          ? `<span class="status-badge active">${u.classroomCode}</span>` 
          : `<span style="font-size: 11.5px; color: var(--text-tertiary);">Unlinked</span>`}
      </td>
      <td>
        <select class="role-select-inline" data-uid="${u.id}" ${isSelf ? "disabled" : ""}>
          <option value="student" ${u.role === "student" ? "selected" : ""}>Student</option>
          <option value="faculty" ${u.role === "faculty" ? "selected" : ""}>Faculty</option>
          <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option>
        </select>
      </td>
      <td>
        <button type="button" class="btn btn-secondary danger-action btn-del-user" data-uid="${u.id}" ${isSelf ? "disabled" : ""} style="padding: 3px 8px; font-size: 11px;">
          Delete Record
        </button>
      </td>
    `;

    // Role elevation handler
    tr.querySelector(".role-select-inline")?.addEventListener("change", async (e) => {
      const newRole = e.target.value;
      if (confirm(`Change ${u.email}'s role to ${newRole.toUpperCase()}?`)) {
        await updateUserRole(u.id, u.email, newRole);
      } else {
        e.target.value = u.role || "student";
      }
    });

    // Account document delete handler
    tr.querySelector(".btn-del-user")?.addEventListener("click", async () => {
      if (confirm(`Permanently remove Firestore profile for ${u.email}? Note: Remember to remove from Firebase Authentication if purging completely.`)) {
        await deleteUserRecord(u.id, u.email);
      }
    });

    usersTbody.appendChild(tr);
  });
}

async function updateUserRole(userId, userEmail, newRole) {
  try {
    await updateDoc(doc(db, "users", userId), {
      role: newRole,
      updatedAt: serverTimestamp()
    });

    await logActivity({
      category: "Administration",
      details: `Admin ${currentUser.email} updated role of ${userEmail} to [${newRole}]`,
      classroomCode: "GLOBAL",
      userEmail: currentUser.email
    });

    alert(`Role updated to ${newRole.toUpperCase()}.`);
  } catch (err) {
    console.error("Role update error:", err);
    alert("Failed to update role: " + err.message);
  }
}

async function deleteUserRecord(userId, userEmail) {
  try {
    await deleteDoc(doc(db, "users", userId));

    await logActivity({
      category: "Administration",
      details: `Admin ${currentUser.email} deleted user document for ${userEmail}`,
      classroomCode: "GLOBAL",
      userEmail: currentUser.email
    });

    alert("User document removed from Firestore.");
  } catch (err) {
    console.error("User deletion error:", err);
    alert("Failed to delete user: " + err.message);
  }
}

// =========================================================================
// 2. INSTITUTIONAL CLASSROOM DIRECTORY & PURGE
// =========================================================================
function initClassroomsStream() {
  const classQ = query(collection(db, "classrooms"));

  onSnapshot(classQ, (snapshot) => {
    cachedClassrooms = [];
    if (statClasses) statClasses.textContent = snapshot.size;

    if (!adminClassesTbody) return;
    adminClassesTbody.innerHTML = "";

    if (snapshot.empty) {
      adminClassesTbody.innerHTML = `<tr><td colspan="7" class="empty-state">No classroom spaces created yet.</td></tr>`;
      return;
    }

    snapshot.forEach((docSnap) => {
      const c = { id: docSnap.id, ...docSnap.data() };
      cachedClassrooms.push(c);

      const enrolledCount = Array.isArray(c.students) ? c.students.length : 0;
      const pendingCount = Array.isArray(c.pendingRequests) ? c.pendingRequests.length : 0;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${c.name || "Untitled Class"}</strong></td>
        <td>${c.section || "N/A"}</td>
        <td><span class="status-badge active" style="letter-spacing: 1px;">${c.code}</span></td>
        <td>${c.facultyEmail || "Instructor"}</td>
        <td>${enrolledCount} enrolled</td>
        <td>
          ${pendingCount > 0 
            ? `<span style="color: #ef4444; font-weight: 700;">${pendingCount} pending</span>` 
            : `<span style="color: var(--text-tertiary);">0</span>`}
        </td>
        <td style="display: flex; gap: 6px;">
          <a href="classroom.html?code=${c.code}" class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px; text-decoration: none;">Inspect</a>
          <button type="button" class="btn btn-secondary danger-action btn-purge-class" data-id="${c.id}" data-code="${c.code}" style="padding: 3px 8px; font-size: 11px;">
            Purge
          </button>
        </td>
      `;

      tr.querySelector(".btn-purge-class")?.addEventListener("click", async () => {
        if (confirm(`Purge classroom ${c.name} (${c.code})? All enrolled students will be unlinked automatically.`)) {
          await purgeClassroom(c.id, c.code, c);
        }
      });

      adminClassesTbody.appendChild(tr);
    });
  }, (err) => {
    console.error("Classrooms listener error:", err);
  });
}

async function purgeClassroom(classId, classCode, classData) {
  try {
    const allMembers = [...(classData.students || []), ...(classData.pendingRequests || [])];

    // Unlink every enrolled or pending student
    for (const member of allMembers) {
      if (member.uid) {
        try {
          await updateDoc(doc(db, "users", member.uid), {
            classroomCode: null,
            classroomId: null,
            pendingClassroomCode: null,
            pendingClassroomId: null,
            updatedAt: serverTimestamp()
          });
        } catch (e) {
          console.warn("Could not unlink user " + member.uid, e);
        }
      }
    }

    await deleteDoc(doc(db, "classrooms", classId));

    await logActivity({
      category: "Administration",
      details: `Admin ${currentUser.email} purged classroom ${classCode}`,
      classroomCode: classCode,
      userEmail: currentUser.email
    });

    alert(`Classroom ${classCode} deleted and all member linkages cleared.`);
  } catch (err) {
    console.error("Classroom purge error:", err);
    alert("Failed to purge classroom: " + err.message);
  }
}

// =========================================================================
// 3. REAL-TIME AUDIT TELEMETRY STREAM
// =========================================================================
function initTelemetryStream() {
  const auditQ = query(collection(db, "activity_logs"));

  onSnapshot(auditQ, (snapshot) => {
    if (statLogs) statLogs.textContent = snapshot.size;

    if (!adminAuditTbody) return;
    adminAuditTbody.innerHTML = "";

    if (snapshot.empty) {
      adminAuditTbody.innerHTML = `<tr><td colspan="5" class="empty-state">No audit logs logged in Firestore.</td></tr>`;
      return;
    }

    const logs = [];
    snapshot.forEach(d => logs.push({ id: d.id, ...d.data() }));

    // Client-side sort (newest first) to bypass composite index requirement
    logs.sort((a, b) => {
      const timeA = a.timestamp?.toMillis ? a.timestamp.toMillis() : (a.timestamp ? new Date(a.timestamp).getTime() : 0);
      const timeB = b.timestamp?.toMillis ? b.timestamp.toMillis() : (b.timestamp ? new Date(b.timestamp).getTime() : 0);
      return timeB - timeA;
    });

    // Show most recent 50 events
    logs.slice(0, 50).forEach((l) => {
      const tr = document.createElement("tr");
      let timeStr = "Recently";
      if (l.timestamp?.toDate) {
        timeStr = l.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      } else if (l.timestamp) {
        timeStr = new Date(l.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      }

      tr.innerHTML = `
        <td style="font-size: 11px; color: var(--text-tertiary);">${timeStr}</td>
        <td><span class="status-badge" style="font-size: 10px;">${l.category || "Action"}</span></td>
        <td>${l.userEmail || "System"}</td>
        <td><strong style="color: var(--accent);">${l.classroomCode || "GLOBAL"}</strong></td>
        <td style="font-size: 12.5px;">${l.details || ""}</td>
      `;
      adminAuditTbody.appendChild(tr);
    });
  }, (err) => {
    console.error("Audit listener error:", err);
  });
}