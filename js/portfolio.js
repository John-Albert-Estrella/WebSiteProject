import { auth, db } from "./firebase-init.js";
import { initAuthGuard } from "./auth-guard.js";
import { collection, query, where, getDocs, orderBy } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const portfolioTbody = document.getElementById("portfolio-tbody");
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
      portfolioTbody.innerHTML = `<tr><td colspan="5" class="empty-state">No evaluated submissions yet. Complete case deliverables to earn grades!</td></tr>`;
      return;
    }

    portfolioTbody.innerHTML = "";

    snap.forEach((docSnap) => {
      const s = docSnap.data();
      const tr = document.createElement("tr");
      const submittedDate = s.createdAt?.toDate ? s.createdAt.toDate().toLocaleDateString() : "Recently";

      tr.innerHTML = `
        <td><strong>${s.caseTitle || "Case Scenario"}</strong></td>
        <td><a href="${s.fileUrl}" target="_blank" class="auth-link">🔗 View File</a></td>
        <td>${submittedDate}</td>
        <td><span class="status-badge active" style="font-size: 13px;">${s.score} / 100</span></td>
        <td style="font-size: 13px; color: var(--text-secondary);">${s.facultyNotes || "Approved deliverable."}</td>
      `;
      portfolioTbody.appendChild(tr);
    });

  } catch (err) {
    console.error("Portfolio error:", err);
    portfolioTbody.innerHTML = `<tr><td colspan="5" class="empty-state">Failed to load deliverables: ${err.message}</td></tr>`;
  }
}