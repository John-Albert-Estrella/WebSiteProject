// js/hr-library.js - HR Case Studies & Reference Repository
import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  collection,
  getDocs,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { FastCache, escapeHtml } from "./security-utils.js";

const DEFAULT_CASES = [
  {
    id: "builtin-1",
    title: "Just Cause vs. Authorized Cause Termination (Labor Code Art. 297–298)",
    category: "Labor Law & Compliance",
    body: "Analyze procedural due process requirements (Twin-Notice Rule and Administrative Hearing) versus separation pay obligations during redundancy or retrenchment."
  },
  {
    id: "builtin-2",
    title: "Structured Competency-Based Interview Matrix",
    category: "Recruitment & Selection",
    body: "Design a standardized 5-point behavioral scoring rubric (STAR method) to eliminate interviewer bias for mid-level operations candidates."
  },
  {
    id: "builtin-3",
    title: "Total Rewards & Statutory Benefits Audit",
    category: "Compensation Design",
    body: "Compute accurate monthly employer/employee contributions for SSS, PhilHealth, Pag-IBIG, and 13th-month pay accruals across a 50-employee cohort."
  }
];

let allCases = [];
let userProfile = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  userProfile = FastCache.get("user_profile") || { email: user.email, role: "student" };

  if (userProfile.role === "faculty") {
    const btn = document.getElementById("btn-open-case-modal");
    if (btn) btn.style.display = "inline-flex";
  }

  bindLibraryEvents();
  await loadLibraryCases();
});

async function loadLibraryCases() {
  const cached = FastCache.get("hr_cases");
  if (cached) renderCases(cached);

  try {
    const snap = await getDocs(collection(db, "cases"));
    const remote = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    allCases = [...remote, ...DEFAULT_CASES];
    FastCache.set("hr_cases", allCases);
    renderCases(allCases);
  } catch {
    allCases = [...DEFAULT_CASES];
    renderCases(allCases);
  }
}

function renderCases(list) {
  const grid = document.getElementById("library-grid");
  if (!grid) return;

  grid.innerHTML = list.map((c) => `
    <article class="glass-panel" style="display: flex; flex-direction: column; justify-content: space-between;">
      <div>
        <span class="badge-pill" style="margin-bottom: 0.75rem; display: inline-block;">${escapeHtml(c.category || "HR Policy")}</span>
        <h3 style="font-size: 1.05rem; margin-bottom: 0.5rem; color: var(--text-primary);">${escapeHtml(c.title)}</h3>
        <p class="text-muted" style="font-size: 0.84rem; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;">
          ${escapeHtml(c.body)}
        </p>
      </div>
      <div style="margin-top: 1.25rem; padding-top: 0.75rem; border-top: 1px solid var(--border-subtle); display: flex; justify-content: flex-end;">
        <button type="button" class="btn-secondary btn-read-case" data-id="${c.id}" style="padding: 0.35rem 0.8rem; font-size: 0.78rem;">
          <i class="fas fa-book-reader"></i> Read Case Brief
        </button>
      </div>
    </article>
  `).join("");

  grid.querySelectorAll(".btn-read-case").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = allCases.find((item) => item.id === btn.dataset.id);
      if (!target) return;
      document.getElementById("read-case-title").textContent = target.title;
      document.getElementById("read-case-cat").textContent = target.category || "HR Policy";
      document.getElementById("read-case-body").textContent = target.body;
      document.getElementById("modal-read-case")?.classList.add("is-open");
    });
  });
}

function bindLibraryEvents() {
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById(btn.dataset.closeModal)?.classList.remove("is-open");
    });
  });

  document.getElementById("library-search")?.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase().trim();
    const filtered = allCases.filter((c) =>
      c.title.toLowerCase().includes(q) || (c.category || "").toLowerCase().includes(q) || c.body.toLowerCase().includes(q)
    );
    renderCases(filtered);
  });

  document.getElementById("btn-open-case-modal")?.addEventListener("click", () => {
    document.getElementById("modal-case")?.classList.add("is-open");
  });

  document.getElementById("form-create-case")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("case-title").value.trim();
    const category = document.getElementById("case-category").value;
    const body = document.getElementById("case-body").value.trim();

    await addDoc(collection(db, "cases"), {
      title,
      category,
      body,
      publishedBy: userProfile.email,
      createdAt: serverTimestamp()
    });

    document.getElementById("modal-case")?.classList.remove("is-open");
    e.target.reset();
    await loadLibraryCases();
  });
}