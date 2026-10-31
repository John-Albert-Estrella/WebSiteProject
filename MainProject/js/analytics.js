import { db } from "./firebase-init.js";
import { enforceAuth } from "./auth-guard.js";
import { 
  collection, 
  getDocs, 
  query, 
  where 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

enforceAuth(["faculty", "student", "admin"]);

const metricStudents = document.getElementById("metric-students");
const metricDeliverables = document.getElementById("metric-deliverables");
const metricSubmissions = document.getElementById("metric-submissions");
const metricPending = document.getElementById("metric-pending");
const logBody = document.getElementById("analytics-log-body");

async function populateAnalytics() {
  try {
    // 1. Total Enrolled Students
    const studentQuery = query(collection(db, "users"), where("role", "==", "student"));
    const studentSnap = await getDocs(studentQuery);
    if (metricStudents) metricStudents.textContent = studentSnap.size;

    // 2. Deliverables / Case studies
    const casesSnap = await getDocs(collection(db, "cases"));
    if (metricDeliverables) metricDeliverables.textContent = casesSnap.size;

    // 3. Portfolios & Pending review
    const portSnap = await getDocs(collection(db, "portfolio"));
    if (metricSubmissions) metricSubmissions.textContent = portSnap.size;

    let pending = 0;
    portSnap.forEach((docSnap) => {
      if (docSnap.data().status === "pending") pending++;
    });
    if (metricPending) metricPending.textContent = pending;

    // 4. Activity Log
    if (logBody) {
      logBody.innerHTML = "";
      let count = 0;

      casesSnap.forEach((d) => {
        if (count >= 5) return;
        const c = d.data();
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${c.createdAt ? new Date(c.createdAt.toDate()).toLocaleDateString() : "Recent"}</td>
          <td><span class="status-badge status-graded">Case Study</span></td>
          <td>Published: "${c.title}" by ${c.author || "Instructor"}</td>
        `;
        logBody.appendChild(tr);
        count++;
      });

      if (count === 0) {
        logBody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-secondary);">No simulation activities logged yet.</td></tr>`;
      }
    }
  } catch (error) {
    console.error("Analytics load error:", error);
  }
}

document.addEventListener("DOMContentLoaded", populateAnalytics);