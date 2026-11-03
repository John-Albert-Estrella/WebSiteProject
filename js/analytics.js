import { db } from "./firebase-init.js";
import { initAuthGuard } from "./auth-guard.js";
import { 
  collection, 
  query, 
  where, 
  getDocs,
  orderBy,
  limit,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const metricStudents = document.getElementById("metric-students");
const metricSubmissions = document.getElementById("metric-submissions");
const metricTasks = document.getElementById("metric-tasks");
const metricGrievances = document.getElementById("metric-grievances");
const logsTbody = document.getElementById("logs-tbody");

function formatSafeTime(timestamp) {
  if (!timestamp) return "Just now";
  if (typeof timestamp.toDate === "function") {
    return timestamp.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return "Just now";
}

async function calculateMetrics(classCode) {
  try {
    const studentQ = classCode 
      ? query(collection(db, "users"), where("classroomCode", "==", classCode), where("role", "==", "student"))
      : query(collection(db, "users"), where("role", "==", "student"));
    const studentSnap = await getDocs(studentQ);
    if (metricStudents) metricStudents.textContent = studentSnap.size;

    const subQ = classCode 
      ? query(collection(db, "submissions"), where("classroomCode", "==", classCode))
      : query(collection(db, "submissions"));
    const subSnap = await getDocs(subQ);
    if (metricSubmissions) metricSubmissions.textContent = subSnap.size;

    const taskQ = classCode 
      ? query(collection(db, "tasks"), where("classroomCode", "==", classCode))
      : query(collection(db, "tasks"));
    const taskSnap = await getDocs(taskQ);
    if (metricTasks) metricTasks.textContent = taskSnap.size;

    const grQ = classCode 
      ? query(collection(db, "grievances"), where("classroomCode", "==", classCode))
      : query(collection(db, "grievances"));
    const grSnap = await getDocs(grQ);
    if (metricGrievances) metricGrievances.textContent = grSnap.size;

  } catch (err) {
    console.error("Error calculating analytics metrics:", err);
  }
}

function listenToActivityLogs(classCode) {
  if (!logsTbody) return;

  const q = classCode
    ? query(collection(db, "activity_logs"), where("classroomCode", "==", classCode), orderBy("timestamp", "desc"), limit(10))
    : query(collection(db, "activity_logs"), orderBy("timestamp", "desc"), limit(10));

  onSnapshot(q, (snapshot) => {
    if (snapshot.empty) {
      logsTbody.innerHTML = `<tr><td colspan="3" class="empty-state">No simulation activities logged yet.</td></tr>`;
      return;
    }

    logsTbody.innerHTML = snapshot.docs.map(docSnap => {
      const data = docSnap.data();
      const timeStr = formatSafeTime(data.timestamp);
      return `
        <tr>
          <td style="color: var(--text-tertiary);">${timeStr}</td>
          <td><span class="status-badge" style="font-size: 11px;">${escapeHtml(data.category || "General")}</span></td>
          <td style="font-size: 13px; color: var(--text-secondary);">${escapeHtml(data.details || "")}</td>
        </tr>
      `;
    }).join("");
  }, (err) => {
    console.warn("Activity logs notice:", err);
  });
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

initAuthGuard({
  onReady: ({ userData }) => {
    const classCode = userData.classroomCode || "";
    calculateMetrics(classCode);
    listenToActivityLogs(classCode);
  }
});