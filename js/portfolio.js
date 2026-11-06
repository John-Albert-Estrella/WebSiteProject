import { auth, db } from "./firebase-init.js";
import { initAuthGuard } from "./auth-guard.js";
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const portfolioTbody = document.getElementById("portfolio-tbody");
const scopeClassCode = document.getElementById("scope-class-code");
const breadcrumbLink = document.getElementById("breadcrumb-classroom-link");
const sidebarClassLink = document.getElementById("sidebar-class-hub-link");
const avgStat = document.getElementById("portfolio-average-stat");
const countStat = document.getElementById("portfolio-count-stat");
const btnPrintSummary = document.getElementById("btn-print-summary");

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

    await loadEvaluatedPortfolio(user.uid, role);
  }
});

async function loadEvaluatedPortfolio(uid, role) {
  if (!portfolioTbody) return;
  portfolioTbody.innerHTML = `<tr><td colspan="5" class="empty-state">Loading evaluated deliverables...</td></tr>`;

  try {
    let q;
    if (role === "student") {
      q = query(
        collection(db, "submissions"),
        where("classroomCode", "==", targetCode),
        where("studentUid", "==", uid),
        where("status", "==", "evaluated")
      );
    } else {
      q = query(
        collection(db, "submissions"),
        where("classroomCode", "==", targetCode),
        where("status", "==", "evaluated")
      );
    }

    const snap = await getDocs(q);

    if (snap.empty) {
      portfolioTbody.innerHTML = `<tr><td colspan="5" class="empty-state">No evaluated deliverables yet.</td></tr>`;
      if (avgStat) avgStat.textContent = "N/A";
      if (countStat) countStat.textContent = "0";
      return;
    }

    portfolioTbody.innerHTML = "";
    let totalScore = 0;

    snap.forEach((docSnap) => {
      const s = docSnap.data();
      const tr = document.createElement("tr");
      const submittedDate = s.createdAt?.toDate ? s.createdAt.toDate().toLocaleDateString() : "Recently";
      totalScore += (s.score || 0);

      tr.innerHTML = `
        <td><strong>${s.caseTitle || "Case Scenario"}</strong></td>
        <td><a href="${s.fileUrl}" target="_blank" class="auth-link">🔗 View File</a></td>
        <td>${submittedDate}</td>
        <td><span class="status-badge active" style="font-size: 13px;">${s.score} / 100</span></td>
        <td style="font-size: 13px; color: var(--text-secondary);">${s.facultyNotes || "Approved deliverable."}</td>
      `;
      portfolioTbody.appendChild(tr);
    });

    const average = Math.round(totalScore / snap.size);
    if (avgStat) avgStat.textContent = `${average}%`;
    if (countStat) countStat.textContent = snap.size;

  } catch (err) {
    console.error("Portfolio error:", err);
    portfolioTbody.innerHTML = `<tr><td colspan="5" class="empty-state">Failed to load deliverables: ${err.message}</td></tr>`;
  }
}

// Download Evaluation Summary Report Trigger
btnPrintSummary?.addEventListener("click", () => {
  window.print();
});