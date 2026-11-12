// js/hr-library.js - Public HR Case Library, E-Modules, Practice Answer Keys & Workplace Conflict HR Feed
import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  arrayUnion,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { FastCache, escapeHtml, sanitizeUrl, checkRateLimit, logAuditEvent } from "./security-utils.js";

const DEFAULT_LIBRARY_ITEMS = [
  {
    id: "builtin-case-1",
    type: "Company Case",
    category: "Labor Law & Compliance",
    title: "Constructive Dismissal & Twin-Notice Due Process (Philippine Labor Code)",
    authorName: "AIMSER Academic Faculty",
    authorRole: "faculty",
    downloadUrl: "",
    body: "Scenario: A senior operations supervisor was reassigned indefinitely to a non-supervisory clerical post without a formal notice or hearing following a departmental audit.\n\nTask: Evaluate whether the transfer constitutes constructive dismissal under Philippine jurisprudence and outline the mandatory Twin-Notice Rule and administrative hearing steps required for valid disciplinary action.",
    answerKey: ""
  },
  {
    id: "builtin-module-2",
    type: "HR E-Module",
    category: "Recruitment & Selection",
    title: "E-Module 01: Competency-Based Behavioral Interviewing & Bias Mitigation",
    authorName: "AIMSER Academic Faculty",
    authorRole: "faculty",
    downloadUrl: "",
    body: "Learning Objectives:\n1. Structure STAR (Situation, Task, Action, Result) behavioral interview questions aligned with job competency matrices.\n2. Standardize 1-to-5 anchored rating rubrics across panel interviewers.\n3. Mitigate halo effect, confirmation bias, and affinity bias during candidate calibration.",
    answerKey: ""
  },
  {
    id: "builtin-practice-3",
    type: "Practice Case",
    category: "Compensation & Benefits",
    title: "Practice Case: Statutory Benefits, Overtime & Night Shift Differential Audit",
    authorName: "AIMSER Academic Faculty",
    authorRole: "faculty",
    downloadUrl: "",
    body: "Practice Problem:\nAn employee earning a basic daily rate of ₱800 worked 2 hours of regular overtime on a normal workday, with 1 hour falling between 10:00 PM and 11:00 PM.\n\nQuestions:\n1. What is the minimum overtime premium rate on an ordinary working day under Art. 87 of the Labor Code?\n2. What is the mandatory Night Shift Differential (NSD) rate under Art. 86?\n3. Compute the total gross pay for that shift.",
    answerKey: "1. Regular Overtime Premium: +25% of the hourly rate (1.25x).\n2. Night Shift Differential (10:00 PM – 6:00 AM): Not less than +10% of the regular wage per hour.\n3. Computation:\n- Hourly Rate = ₱800 / 8 = ₱100/hr\n- Basic 8 hrs = ₱800.00\n- Hour 1 OT (before 10 PM) = ₱100 × 1.25 = ₱125.00\n- Hour 2 OT (10 PM–11 PM with NSD) = ₱100 × 1.25 × 1.10 = ₱137.50\n- Total Gross Shift Pay = ₱1,062.50."
  }
];

let currentUser = null;
let userProfile = null;
let allLibraryItems = [];
let activeCaseItem = null;
let allFeedPosts = [];

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  currentUser = user;

  userProfile = FastCache.get("user_profile");
  if (!userProfile) {
    const snap = await getDoc(doc(db, "users", user.uid));
    const data = snap.exists() ? snap.data() : {};
    userProfile = {
      uid: user.uid,
      email: user.email,
      fullName: data.fullName || user.displayName || user.email.split("@")[0],
      role: (data.role || "student").toLowerCase()
    };
    FastCache.set("user_profile", userProfile);
  }

  if (userProfile.role === "faculty") {
    const uploadBtn = document.getElementById("btn-open-case-modal");
    if (uploadBtn) uploadBtn.style.display = "inline-flex";
  }

  bindLibraryAndFeedEvents();

  const cachedLib = FastCache.get("hr_library_items");
  if (cachedLib) {
    allLibraryItems = cachedLib;
    renderFilteredLibrary();
  }

  const cachedFeed = FastCache.get("hr_feed_posts");
  if (cachedFeed) {
    allFeedPosts = cachedFeed;
    renderFeedStream();
  }

  await Promise.all([loadLibraryItems(), loadHrFeed()]);
});

function renderRoleBadge(role) {
  const normalized = (role || "student").toLowerCase();
  const isFac = normalized === "faculty";
  const bg = isFac ? "rgba(56, 189, 248, 0.16)" : "rgba(16, 185, 129, 0.16)";
  const color = isFac ? "#38bdf8" : "#10b981";
  return `<span style="display:inline-block;padding:0.15rem 0.55rem;border-radius:9999px;font-size:0.68rem;font-weight:700;text-transform:uppercase;background:${bg};color:${color};letter-spacing:0.04em;">${escapeHtml(normalized)}</span>`;
}

async function loadLibraryItems() {
  try {
    const snap = await getDocs(collection(db, "cases"));
    const remote = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return tB - tA;
      });

    allLibraryItems = [...remote, ...DEFAULT_LIBRARY_ITEMS];
    FastCache.set("hr_library_items", allLibraryItems);
    renderFilteredLibrary();
  } catch (err) {
    console.warn("Using default library items:", err.message);
    allLibraryItems = [...DEFAULT_LIBRARY_ITEMS];
    renderFilteredLibrary();
  }
}

function renderFilteredLibrary() {
  const grid = document.getElementById("library-grid");
  if (!grid) return;

  const typeFilter = document.getElementById("library-type-filter")?.value || "all";
  const searchTerm = (document.getElementById("library-search")?.value || "").toLowerCase().trim();

  const filtered = allLibraryItems.filter((item) => {
    const matchesType = typeFilter === "all" || (item.type || "Company Case") === typeFilter;
    const matchesQuery =
      !searchTerm ||
      (item.title || "").toLowerCase().includes(searchTerm) ||
      (item.category || "").toLowerCase().includes(searchTerm) ||
      (item.body || "").toLowerCase().includes(searchTerm);
    return matchesType && matchesQuery;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state"><i class="fas fa-search"></i><h3>No Matching Materials</h3><p>Try adjusting your material type filter or search keywords.</p></div>`;
    return;
  }

  grid.innerHTML = filtered
    .map((item) => {
      const itemType = item.type || "Company Case";
      const hasAnswerKey = itemType === "Practice Case" && Boolean(item.answerKey);
      const canDelete = !item.id.startsWith("builtin-") && userProfile.role === "faculty";

      return `
        <article class="glass-panel" style="display:flex;flex-direction:column;justify-content:space-between;">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:0.4rem;flex-wrap:wrap;margin-bottom:0.65rem;">
              <span class="badge-pill">${escapeHtml(itemType)}</span>
              <div style="display:flex;align-items:center;gap:0.4rem;">
                ${hasAnswerKey ? `<span class="badge-pill" style="background:rgba(16,185,129,0.16);color:#10b981;"><i class="fas fa-key"></i> Key to Correct</span>` : ""}
                ${canDelete ? `<button type="button" class="btn-del-case" data-id="${item.id}" style="background:none;border:none;color:var(--text-tertiary);cursor:pointer;" title="Remove Material"><i class="fas fa-trash-alt"></i></button>` : ""}
              </div>
            </div>
            <h3 style="font-size:1.05rem;margin-bottom:0.4rem;color:var(--text-primary);">${escapeHtml(item.title)}</h3>
            <div style="font-size:0.76rem;color:var(--text-tertiary);margin-bottom:0.65rem;display:flex;align-items:center;gap:0.4rem;">
              <span>By ${escapeHtml(item.authorName || "Faculty")}</span>
              ${renderRoleBadge(item.authorRole || "faculty")}
            </div>
            <p class="text-muted" style="font-size:0.83rem;line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;">
              ${escapeHtml(item.body)}
            </p>
          </div>

          <div style="margin-top:1.15rem;padding-top:0.75rem;border-top:1px solid var(--border-subtle);display:flex;justify-content:space-between;align-items:center;">
            <span class="text-muted" style="font-size:0.74rem;">${escapeHtml(item.category || "HR Policy")}</span>
            <button type="button" class="btn-secondary btn-open-case-reader" data-id="${item.id}" style="padding:0.35rem 0.8rem;font-size:0.78rem;">
              <i class="fas fa-book-reader"></i> ${itemType === "Practice Case" ? "Solve & Check Key" : "Open Material"}
            </button>
          </div>
        </article>`;
    })
    .join("");

  grid.querySelectorAll(".btn-open-case-reader").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = allLibraryItems.find((i) => i.id === btn.dataset.id);
      if (target) openCaseReaderModal(target);
    });
  });

  grid.querySelectorAll(".btn-del-case").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remove this case/e-module from the HR Library?")) return;
      await deleteDoc(doc(db, "cases", btn.dataset.id));
      await loadLibraryItems();
    });
  });
}

function openCaseReaderModal(item) {
  activeCaseItem = item;
  const itemType = item.type || "Company Case";

  document.getElementById("read-case-title").textContent = item.title || "Case Study";
  document.getElementById("read-case-type").textContent = itemType;
  document.getElementById("read-case-cat").textContent = item.category || "HR Domain";
  document.getElementById("read-case-author").innerHTML = `Uploaded by <strong>${escapeHtml(item.authorName || "Faculty")}</strong> ${renderRoleBadge(item.authorRole || "faculty")}`;
  document.getElementById("read-case-body").textContent = item.body || "";

  const dlBtn = document.getElementById("read-case-download-btn");
  const safeHref = sanitizeUrl(item.downloadUrl, "");
  if (dlBtn) {
    if (safeHref) {
      dlBtn.href = safeHref;
      dlBtn.style.display = "inline-flex";
    } else {
      dlBtn.style.display = "none";
    }
  }

  const practiceBox = document.getElementById("practice-case-interactive-box");
  const revealBox = document.getElementById("answer-key-reveal-box");
  const answerInput = document.getElementById("practice-student-answer");
  const keyText = document.getElementById("read-case-answer-key");

  if (itemType === "Practice Case" && item.answerKey) {
    practiceBox.style.display = "block";
    answerInput.value = "";
    keyText.textContent = item.answerKey;
    revealBox.style.display = userProfile.role === "faculty" ? "block" : "none";
  } else {
    practiceBox.style.display = "none";
    revealBox.style.display = "none";
  }

  openModal("modal-read-case");
}

async function loadHrFeed() {
  try {
    let snap;
    try {
      snap = await getDocs(query(collection(db, "hr_feed"), orderBy("createdAt", "desc")));
    } catch {
      snap = await getDocs(collection(db, "hr_feed"));
    }

    allFeedPosts = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return tB - tA;
      });

    FastCache.set("hr_feed_posts", allFeedPosts);
    renderFeedStream();
  } catch (err) {
    console.error("Failed loading HR Feed:", err);
  }
}

function renderFeedStream() {
  const stream = document.getElementById("hr-feed-stream");
  if (!stream) return;

  if (allFeedPosts.length === 0) {
    stream.innerHTML = `
      <div class="glass-panel empty-state">
        <i class="fas fa-comments"></i>
        <h3>No Workplace Conflict Scenarios Posted Yet</h3>
        <p>Use the form above to share a workplace conflict case, investigation plan, and resolution recommendation.</p>
      </div>`;
    return;
  }

  stream.innerHTML = allFeedPosts
    .map((post) => {
      const comments = post.comments || [];
      const ts = post.createdAt?.toDate ? post.createdAt.toDate().toLocaleString() : "Recent";
      const canDeletePost = post.authorUid === currentUser.uid || userProfile.role === "faculty";

      return `
        <article class="glass-panel">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.85rem;">
            <div>
              <h3 style="font-size:1.1rem;margin-bottom:0.25rem;color:var(--text-primary);">${escapeHtml(post.title)}</h3>
              <div style="display:flex;align-items:center;gap:0.5rem;font-size:0.8rem;color:var(--text-secondary);">
                <strong>${escapeHtml(post.authorName || "Participant")}</strong>
                ${renderRoleBadge(post.authorRole || "student")}
                <span>• ${escapeHtml(ts)}</span>
              </div>
            </div>
            ${canDeletePost ? `<button type="button" class="btn-del-feed-post" data-id="${post.id}" style="background:none;border:none;color:var(--text-tertiary);cursor:pointer;" title="Delete Scenario"><i class="fas fa-trash-alt"></i></button>` : ""}
          </div>

          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:0.85rem;margin-bottom:1.15rem;">
            <div style="padding:0.8rem;border-radius:var(--radius-sm);background:var(--bg-surface);border:1px solid var(--border-subtle);">
              <div style="font-size:0.74rem;font-weight:700;text-transform:uppercase;color:var(--warning);margin-bottom:0.3rem;">1. Documented Concerns</div>
              <p style="font-size:0.84rem;line-height:1.5;margin:0;white-space:pre-wrap;">${escapeHtml(post.concerns || "")}</p>
            </div>
            <div style="padding:0.8rem;border-radius:var(--radius-sm);background:var(--bg-surface);border:1px solid var(--border-subtle);">
              <div style="font-size:0.74rem;font-weight:700;text-transform:uppercase;color:#38bdf8;margin-bottom:0.3rem;">2. Investigation Plan</div>
              <p style="font-size:0.84rem;line-height:1.5;margin:0;white-space:pre-wrap;">${escapeHtml(post.investigation || "")}</p>
            </div>
            <div style="padding:0.8rem;border-radius:var(--radius-sm);background:var(--bg-surface);border:1px solid var(--border-subtle);">
              <div style="font-size:0.74rem;font-weight:700;text-transform:uppercase;color:var(--success);margin-bottom:0.3rem;">3. Recommended Resolution</div>
              <p style="font-size:0.84rem;line-height:1.5;margin:0;white-space:pre-wrap;">${escapeHtml(post.resolution || "")}</p>
            </div>
          </div>

          <div style="padding-top:0.85rem;border-top:1px solid var(--border-subtle);">
            <div style="font-size:0.8rem;font-weight:600;margin-bottom:0.65rem;color:var(--text-secondary);">
              <i class="far fa-comment-dots"></i> Peer &amp; Faculty Opinions (${comments.length})
            </div>

            <div style="display:flex;flex-direction:column;gap:0.5rem;margin-bottom:0.75rem;">
              ${comments
                .map(
                  (c) => `
                  <div style="padding:0.6rem 0.85rem;border-radius:var(--radius-xs);background:var(--bg-canvas);border:1px solid var(--border-subtle);font-size:0.83rem;">
                    <div style="display:flex;align-items:center;gap:0.45rem;margin-bottom:0.2rem;">
                      <strong>${escapeHtml(c.authorName || "Member")}</strong>
                      ${renderRoleBadge(c.authorRole || "student")}
                    </div>
                    <p style="margin:0;color:var(--text-primary);">${escapeHtml(c.text || "")}</p>
                  </div>`
                )
                .join("")}
            </div>

            <form class="form-feed-comment" data-post-id="${post.id}" style="display:flex;gap:0.5rem;">
              <input type="text" class="form-control input-feed-comment" placeholder="Share your HR analysis, legal perspective, or opinion..." required style="font-size:0.83rem;" />
              <button type="submit" class="btn-secondary" style="padding:0.45rem 0.9rem;font-size:0.8rem;white-space:nowrap;">
                <i class="fas fa-reply"></i> Comment
              </button>
            </form>
          </div>
        </article>`;
    })
    .join("");

  stream.querySelectorAll(".btn-del-feed-post").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this workplace conflict scenario?")) return;
      await deleteDoc(doc(db, "hr_feed", btn.dataset.id));
      await loadHrFeed();
    });
  });

  stream.querySelectorAll(".form-feed-comment").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const postId = form.dataset.postId;
      const input = form.querySelector(".input-feed-comment");
      const text = input.value.trim();
      if (!text) return;

      input.disabled = true;
      try {
        checkRateLimit("feed_comment", 10, 60000);
        await updateDoc(doc(db, "hr_feed", postId), {
          comments: arrayUnion({
            authorUid: currentUser.uid,
            authorName: userProfile.fullName,
            authorRole: userProfile.role,
            text,
            createdAt: new Date().toISOString()
          })
        });
        input.value = "";
        await loadHrFeed();
      } catch (err) {
        alert(err.message);
      } finally {
        input.disabled = false;
      }
    });
  });
}

function bindLibraryAndFeedEvents() {
  document.querySelectorAll(".subnav-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".subnav-tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(tab.dataset.tab)?.classList.add("active");
    });
  });

  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
  });

  document.getElementById("library-type-filter")?.addEventListener("change", renderFilteredLibrary);
  document.getElementById("library-search")?.addEventListener("input", renderFilteredLibrary);

  document.getElementById("btn-open-case-modal")?.addEventListener("click", () => openModal("modal-case"));

  document.getElementById("form-create-case")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-case");
    const type = document.getElementById("case-type").value;
    const category = document.getElementById("case-category").value;
    const title = document.getElementById("case-title").value.trim();
    const downloadUrl = sanitizeUrl(document.getElementById("case-download-url").value.trim(), "");
    const body = document.getElementById("case-body").value.trim();
    const answerKey = document.getElementById("case-answer-key").value.trim();

    btn.disabled = true;
    try {
      checkRateLimit("upload_case", 6, 60000);
      await addDoc(collection(db, "cases"), {
        type,
        category,
        title,
        downloadUrl,
        body,
        answerKey,
        authorUid: currentUser.uid,
        authorName: userProfile.fullName,
        authorRole: userProfile.role,
        createdAt: serverTimestamp()
      });

      await logAuditEvent(`Published ${type}: "${title}" to HR Library`, "HR_LIBRARY", currentUser.email);
      closeModal("modal-case");
      e.target.reset();
      await loadLibraryItems();
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("btn-submit-practice-answer")?.addEventListener("click", async () => {
    const answer = document.getElementById("practice-student-answer").value.trim();
    if (!answer) {
      alert("Write your practice case analysis first before revealing the Key to Correct.");
      return;
    }

    document.getElementById("answer-key-reveal-box").style.display = "block";

    if (activeCaseItem && !activeCaseItem.id.startsWith("builtin-")) {
      try {
        await addDoc(collection(db, "cases", activeCaseItem.id, "practice_attempts"), {
          studentUid: currentUser.uid,
          studentName: userProfile.fullName,
          studentRole: userProfile.role,
          answer,
          submittedAt: serverTimestamp()
        });
      } catch {
        // Non-blocking save
      }
    }
  });

  document.getElementById("form-create-feed-post")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-feed-post");
    const title = document.getElementById("feed-title").value.trim();
    const concerns = document.getElementById("feed-concerns").value.trim();
    const investigation = document.getElementById("feed-investigation").value.trim();
    const resolution = document.getElementById("feed-resolution").value.trim();

    btn.disabled = true;
    try {
      checkRateLimit("create_feed_post", 6, 60000);
      await addDoc(collection(db, "hr_feed"), {
        title,
        concerns,
        investigation,
        resolution,
        authorUid: currentUser.uid,
        authorName: userProfile.fullName,
        authorEmail: currentUser.email,
        authorRole: userProfile.role,
        comments: [],
        createdAt: serverTimestamp()
      });

      await logAuditEvent(`Posted workplace conflict scenario "${title}" [${userProfile.role}]`, "HR_FEED", currentUser.email);
      e.target.reset();
      await loadHrFeed();
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
    }
  });
}

function openModal(id) {
  const m = document.getElementById(id);
  if (m) {
    m.classList.add("is-open");
    m.setAttribute("aria-hidden", "false");
  }
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) {
    m.classList.remove("is-open");
    m.setAttribute("aria-hidden", "true");
  }
}