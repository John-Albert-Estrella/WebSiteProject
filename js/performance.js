import { db } from "./firebase-init.js";
import { initAuthGuard } from "./auth-guard.js";
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const kpiCreatePanel = document.getElementById("kpi-create-panel");
const formCreateKpi = document.getElementById("form-create-kpi");
const kpiCyclesContainer = document.getElementById("kpi-cycles-container");

let activeRole = "student";
let activeClassCode = "";
let currentUser = null;

// Handle KPI Creation
formCreateKpi?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("kpi-title-input")?.value.trim();
  const metric = document.getElementById("kpi-metric-input")?.value.trim();

  if (!title || !metric) return;

  const btn = document.getElementById("btn-publish-kpi");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Publishing...";
  }

  try {
    await addDoc(collection(db, "kpi_cycles"), {
      title,
      metric,
      classroomCode: activeClassCode || "GLOBAL",
      authorEmail: currentUser.email,
      status: "Active",
      createdAt: serverTimestamp()
    });

    if (formCreateKpi) formCreateKpi.reset();
  } catch (err) {
    console.error("Failed to publish KPI cycle:", err);
    alert("Could not publish cycle: " + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Publish KPI Cycle";
    }
  }
});

// Real-Time KPI Cycle Listener
function listenToKpiCycles() {
  const q = activeClassCode 
    ? query(collection(db, "kpi_cycles"), where("classroomCode", "==", activeClassCode))
    : query(collection(db, "kpi_cycles"));

  onSnapshot(q, (snapshot) => {
    if (!kpiCyclesContainer) return;
    if (snapshot.empty) {
      kpiCyclesContainer.innerHTML = `<div class="empty-state"><p>No appraisal cycles currently initiated.</p></div>`;
      return;
    }

    kpiCyclesContainer.innerHTML = snapshot.docs.map(d => {
      const data = d.data();
      const dateStr = data.createdAt ? data.createdAt.toDate().toLocaleDateString() : "Active";

      return `
        <div class="card" style="padding: 18px; gap: 10px; background: var(--bg-surface);">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <h3 style="font-size: 15px; font-weight: 700; color: var(--text-primary);">${escapeHtml(data.title)}</h3>
            <span class="status-badge active">${escapeHtml(data.status || "Active")}</span>
          </div>
          <p style="font-size: 13.5px; color: var(--text-secondary); line-height: 1.45;">
            <strong>Benchmark KPI:</strong> ${escapeHtml(data.metric)}
          </p>
          <span style="font-size: 11px; color: var(--text-tertiary);">Initiated on ${dateStr} by ${escapeHtml(data.authorEmail || "Instructor")}</span>
        </div>
      `;
    }).join("");
  }, (err) => {
    console.error("Error reading KPI cycles:", err);
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

// Unified Auth Guard
initAuthGuard({
  onReady: ({ user, userData, role }) => {
    currentUser = user;
    activeRole = role;
    activeClassCode = userData.classroomCode || "";

    // Show KPI Creation form to Faculty only
    if (activeRole === "faculty" && kpiCreatePanel) {
      kpiCreatePanel.style.display = "block";
    }

    listenToKpiCycles();
  }
});