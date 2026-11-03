import { auth, db } from "./firebase-init.js";
import { enforceAuth } from "./auth-guard.js";
import { 
  collection, 
  addDoc, 
  getDoc, 
  doc, 
  onSnapshot, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

enforceAuth(["faculty", "student", "admin"]);

const kpiPanel = document.getElementById("kpi-setup-panel");
const appraisalPanel = document.getElementById("self-appraisal-panel");

const reviewTitle = document.getElementById("review-title");
const kpiMetricName = document.getElementById("kpi-metric-name");
const btnSaveKpi = document.getElementById("btn-save-kpi");

const appraisalText = document.getElementById("appraisal-achievements");
const btnSubmitAppraisal = document.getElementById("btn-submit-appraisal");

document.addEventListener("DOMContentLoaded", () => {
  auth.onAuthStateChanged(async (user) => {
    if (!user) return;

    try {
      const userSnap = await getDoc(doc(db, "users", user.uid));
      if (!userSnap.exists()) return;

      const userData = userSnap.data();
      const isFaculty = userData.role === "faculty" || userData.role === "admin";

      // 1. Role-based panel display
      if (isFaculty && kpiPanel) {
        kpiPanel.style.display = "block";
      } else if (!isFaculty && appraisalPanel) {
        appraisalPanel.style.display = "block";
      }

      // 2. Faculty: Save New Appraisal Cycle & Key KPI
      if (btnSaveKpi) {
        btnSaveKpi.addEventListener("click", async () => {
          const title = reviewTitle.value.trim();
          const metric = kpiMetricName.value.trim();

          if (!title || !metric) {
            alert("Please fill in both the cycle title and metric name.");
            return;
          }

          btnSaveKpi.disabled = true;
          try {
            await addDoc(collection(db, "performance_cycles"), {
              title,
              metric,
              facultyUid: user.uid,
              facultyName: `${userData.firstName} ${userData.lastName}`,
              createdAt: serverTimestamp()
            });

            alert("Appraisal cycle published to students!");
            reviewTitle.value = "";
            kpiMetricName.value = "";
          } catch (err) {
            console.error("Error creating performance cycle:", err);
            alert("Error: " + err.message);
          } finally {
            btnSaveKpi.disabled = false;
          }
        });
      }

      // 3. Student: Submit Self-Appraisal
      if (btnSubmitAppraisal) {
        btnSubmitAppraisal.addEventListener("click", async () => {
          const content = appraisalText.value.trim();
          if (!content) {
            alert("Please detail your achievements before submitting.");
            return;
          }

          btnSubmitAppraisal.disabled = true;
          try {
            await addDoc(collection(db, "appraisals"), {
              studentUid: user.uid,
              studentName: `${userData.firstName} ${userData.lastName}`,
              achievements: content,
              submittedAt: serverTimestamp()
            });

            alert("Self-appraisal submitted for faculty review!");
            appraisalText.value = "";
          } catch (err) {
            console.error("Error submitting appraisal:", err);
            alert("Error: " + err.message);
          } finally {
            btnSubmitAppraisal.disabled = false;
          }
        });
      }

      // 4. Live Display of Active Performance Cycles
      renderPerformanceStream(isFaculty);

    } catch (err) {
      console.error("Performance engine error:", err);
    }
  });
});

function renderPerformanceStream(isFaculty) {
  const container = document.querySelector(".page-container");
  const streamCard = document.createElement("div");
  streamCard.className = "card";
  streamCard.style.marginTop = "24px";
  streamCard.innerHTML = `<h3 style="margin-bottom: 16px;">Active Appraisal Benchmarks & Submissions</h3><div id="perf-list">Loading...</div>`;
  container.appendChild(streamCard);

  const perfList = streamCard.querySelector("#perf-list");

  onSnapshot(collection(db, "performance_cycles"), (snapshot) => {
    perfList.innerHTML = "";

    if (snapshot.empty) {
      perfList.innerHTML = `<p style="color: var(--text-secondary); font-size: 13px;">No appraisal cycles currently initiated.</p>`;
      return;
    }

    snapshot.forEach((docSnap) => {
      const cycle = docSnap.data();
      const item = document.createElement("div");
      item.style.padding = "14px";
      item.style.borderBottom = "1px solid var(--surface-border)";
      item.style.display = "flex";
      item.style.justifyContent = "space-between";
      item.style.alignItems = "center";
      item.innerHTML = `
        <div>
          <h4 style="margin: 0;">${cycle.title}</h4>
          <p style="font-size: 12.5px; color: var(--text-secondary); margin-top: 4px;">Metric: <strong>${cycle.metric}</strong> • By: ${cycle.facultyName}</p>
        </div>
        <span class="status-badge status-graded">Cycle Active</span>
      `;
      perfList.appendChild(item);
    });
  });
}