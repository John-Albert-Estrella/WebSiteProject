import { auth, db } from "./firebase-init.js";
import { initAuthGuard } from "./auth-guard.js";
import { collection, query, where, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const activityLogsTbody = document.getElementById("activity-logs-tbody");
const scopeClassCode = document.getElementById("scope-class-code");
const breadcrumbLink = document.getElementById("breadcrumb-classroom-link");
const sidebarClassLink = document.getElementById("sidebar-class-hub-link");

const urlParams = new URLSearchParams(window.location.search);
let targetCode = urlParams.get("code");

initAuthGuard({
  allowedRoles: ["student", "faculty", "admin"],
  onReady: async ({ user, userData, role }) => {
    if (!targetCode && userData.classroomCode) {
      targetCode = userData.classroomCode;
    }

    if (!targetCode) {
      alert("No active classroom specified.");
      window.location.replace(role === "faculty" ? "faculty-dashboard.html" : "student-dashboard.html");
      return;
    }

    if (scopeClassCode) scopeClassCode.textContent = targetCode;
    if (breadcrumbLink) breadcrumbLink.href = `classroom.html?code=${targetCode}`;
    if (sidebarClassLink) sidebarClassLink.href = `classroom.html?code=${targetCode}`;

    initActivityStream();
  }
});

function initActivityStream() {
  if (!activityLogsTbody) return;

  const q = query(
    collection(db, "activity_logs"),
    where("classroomCode", "==", targetCode),
    orderBy("timestamp", "desc")
  );

  onSnapshot(q, (snapshot) => {
    activityLogsTbody.innerHTML = "";

    if (snapshot.empty) {
      activityLogsTbody.innerHTML = `<tr><td colspan="5" class="empty-state">No activity logs recorded for this section yet.</td></tr>`;
      return;
    }

    snapshot.forEach((docSnap) => {
      const a = docSnap.data();
      const tr = document.createElement("tr");
      const timeStr = a.timestamp?.toDate ? a.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Just now";

      tr.innerHTML = `
        <td style="font-size: 12px; color: var(--text-tertiary);">${timeStr}</td>
        <td><span class="status-badge" style="font-size: 11px;">${a.category || "Action"}</span></td>
        <td>${a.userEmail || "System"}</td>
        <td><strong style="color: var(--accent);">${a.classroomCode}</strong></td>
        <td style="font-size: 13px;">${a.details || ""}</td>
      `;

      activityLogsTbody.appendChild(tr);
    });
  }, (err) => {
    console.error("Telemetry stream error:", err);
    activityLogsTbody.innerHTML = `<tr><td colspan="5" class="empty-state">Telemetry unavailable: ${err.message}</td></tr>`;
  });
}