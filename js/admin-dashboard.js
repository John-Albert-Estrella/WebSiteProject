// js/admin-dashboard.js - Resilient Administrator Management, User Inspector, Case Library, HR Feed & Telemetry
import { auth, db } from "./firebase-init.js";
import {
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
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
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import * as CloudCfg from "./cloudinary-config.js";
import * as SecUtils from "./security-utils.js";

// Safe fallbacks so a missing named export in helper modules never blocks script execution
const FastCache = SecUtils.FastCache || {
  get: (k) => {
    try {
      return JSON.parse(sessionStorage.getItem("aimser_v2_" + k));
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      sessionStorage.setItem("aimser_v2_" + k, JSON.stringify(v));
    } catch {}
  },
  clearAll: () => {
    try {
      sessionStorage.clear();
    } catch {}
  }
};

const escapeHtml =
  SecUtils.escapeHtml ||
  ((str) =>
    String(str ?? "").replace(
      /[&<>"']/g,
      (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
    ));

const sanitizeUrl =
  SecUtils.sanitizeUrl ||
  ((url, fallback = "") => (/^https?:\/\//i.test(String(url || "").trim()) ? String(url).trim() : fallback));

const checkRateLimit = SecUtils.checkRateLimit || (() => true);

const logAuditEvent =
  SecUtils.logAuditEvent ||
  (async (message, category = "EVENT", actor = "") => {
    try {
      await addDoc(collection(db, "audit_logs"), {
        message,
        category,
        actor,
        timestamp: serverTimestamp()
      });
    } catch {}
  });

async function safeCloudinaryUpload(file, folder = "aimser/avatars") {
  const fn =
    CloudCfg.uploadToCloudinary ||
    CloudCfg.uploadImageToCloudinary ||
    CloudCfg.uploadFile ||
    CloudCfg.default;

  if (typeof fn === "function") {
    return await fn(file, folder);
  }

  const cloudName = CloudCfg.CLOUDINARY_CLOUD_NAME || CloudCfg.CLOUD_NAME || "dvh6g7k2m";
  const preset = CloudCfg.CLOUDINARY_UPLOAD_PRESET || CloudCfg.UPLOAD_PRESET || "Aimser_Avatars";
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", preset);
  formData.append("folder", folder);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: "POST",
    body: formData
  });
  const data = await res.json();
  if (!res.ok || !data.secure_url) {
    throw new Error(data.error?.message || "Cloudinary upload failed.");
  }
  return data.secure_url;
}

let currentAdminUser = null;
let adminProfile = null;
let cachedUsers = [];
let cachedSections = [];
let cachedTeams = [];
let cachedCases = [];
let cachedFeedPosts = [];
let cachedLogs = [];
let selectedUserUid = null;
let resetAvatarRequested = false;
let initialHashApplied = false;

function initAdminConsoleUI() {
  setupTabs();
  if (!initialHashApplied) {
    applyInitialHashRoute();
    initialHashApplied = true;
  }
  setupSearchAndFilters();
  setupUserInspectorPanel();
  setupAdminCaseModal();
  setupLightboxModal();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAdminConsoleUI);
} else {
  initAdminConsoleUI();
}

// Authenticate & Enforce Administrator Clearance
onAuthStateChanged(auth, async (user) => {
  initAdminConsoleUI();

  if (!user) {
    window.location.replace("login.html");
    return;
  }

  try {
    const cachedProfile = FastCache.get("user_profile");
    if (cachedProfile && (cachedProfile.role || "").toLowerCase() === "admin") {
      adminProfile = cachedProfile;
      renderAdminIdentity(user, cachedProfile);
    }

    const userSnap = await getDoc(doc(db, "users", user.uid));
    const userData = userSnap.exists() ? userSnap.data() : {};
    const role = (userData.role || "").toLowerCase();

    if (role !== "admin") {
      alert("Unauthorized Access: Administrator clearance required.");
      window.location.replace("office.html");
      return;
    }

    currentAdminUser = user;
    adminProfile = {
      uid: user.uid,
      email: user.email,
      fullName: userData.fullName || user.displayName || "Administrator",
      role: "admin",
      avatarUrl: userData.avatarUrl || user.photoURL || ""
    };
    renderAdminIdentity(user, adminProfile);

    const snapMetrics = FastCache.get("admin_metrics");
    if (snapMetrics) applyMetricsToDOM(snapMetrics);

    const snapUsers = FastCache.get("admin_users");
    if (snapUsers) {
      cachedUsers = snapUsers;
      applyUserFilters();
    }

    const snapCases = FastCache.get("admin_cases");
    if (snapCases) {
      cachedCases = snapCases;
      applyCaseFilters();
    }

    const snapFeed = FastCache.get("admin_feed_posts");
    if (snapFeed) {
      cachedFeedPosts = snapFeed;
      applyFeedFilters();
    }

    const snapLogs = FastCache.get("admin_logs");
    if (snapLogs) {
      cachedLogs = snapLogs;
      renderAuditLogsList(cachedLogs);
    }

    await Promise.allSettled([
      loadMetrics(),
      loadUsers(),
      loadSections(),
      loadTeamsCache(),
      loadCasesAdmin(),
      loadHrFeedAdmin(),
      loadAuditLogs()
    ]);
  } catch (err) {
    console.error("Admin initialization error:", err);
  }
});

function renderAdminIdentity(user, data) {
  const headerName = document.getElementById("header-user-name");
  const headerRole = document.getElementById("header-user-role");
  const headerAvatar = document.getElementById("header-user-avatar");

  const name = data.fullName || user.displayName || "Administrator";
  const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=1b5375&color=faf2dd`;
  const avatar = sanitizeUrl(data.avatarUrl || user.photoURL, fallback);

  if (headerName) headerName.textContent = name;
  if (headerRole) headerRole.textContent = "SYSTEM ADMIN";
  if (headerAvatar) headerAvatar.src = avatar;
}

function setupLightboxModal() {
  const modal = document.getElementById("modal-image-lightbox");
  document.querySelectorAll('[data-close-modal="modal-image-lightbox"]').forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "true";
    btn.addEventListener("click", () => {
      if (modal) {
        modal.classList.remove("is-open");
        modal.setAttribute("aria-hidden", "true");
      }
    });
  });
}

// Multi-Collection Telemetry Metrics
async function loadMetrics() {
  const getSafeCount = async (collName) => {
    try {
      const snap = await getDocs(collection(db, collName));
      return snap.size;
    } catch {
      return 0;
    }
  };

  const usersCount = await getSafeCount("users");

  let sectionsCount = await getSafeCount("classrooms");
  if (sectionsCount === 0) {
    sectionsCount = await getSafeCount("sections");
  }

  const teamsCount = await getSafeCount("teams");

  let logsCount = await getSafeCount("audit_logs");
  if (logsCount === 0) {
    logsCount = await getSafeCount("logs");
  }

  const metrics = { usersCount, sectionsCount, teamsCount, logsCount };
  FastCache.set("admin_metrics", metrics);
  applyMetricsToDOM(metrics);
}

function applyMetricsToDOM(metrics) {
  const elUsers = document.getElementById("stat-total-users");
  const elSections = document.getElementById("stat-total-sections");
  const elTeams = document.getElementById("stat-total-teams");
  const elLogs = document.getElementById("stat-total-logs");

  if (elUsers) elUsers.textContent = (metrics.usersCount ?? 0).toLocaleString();
  if (elSections) elSections.textContent = (metrics.sectionsCount ?? 0).toLocaleString();
  if (elTeams) elTeams.textContent = (metrics.teamsCount ?? 0).toLocaleString();
  if (elLogs) elLogs.textContent = (metrics.logsCount ?? 0).toLocaleString();
}

async function loadTeamsCache() {
  try {
    const snap = await getDocs(collection(db, "teams"));
    cachedTeams = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (selectedUserUid) {
      const activeUser = cachedUsers.find((u) => u.uid === selectedUserUid);
      if (activeUser) updateInspectorEnrollmentStats(activeUser);
    }
  } catch {
    cachedTeams = [];
  }
}

// HR Case Library & E-Modules Management Pipeline
async function loadCasesAdmin() {
  const grid = document.getElementById("admin-cases-grid");
  const banner = document.getElementById("admin-cases-status-banner");
  if (!grid) return;

  try {
    const snap = await getDocs(collection(db, "cases"));
    cachedCases = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return tB - tA;
      });

    FastCache.set("admin_cases", cachedCases);

    if (banner) {
      if (cachedCases.length > 0) {
        banner.innerHTML = `<i class="fas fa-check-circle" style="color: var(--success); margin-right: 0.45rem;"></i><strong>${cachedCases.length} published material(s) active</strong> in the HR Case Library.`;
      } else {
        banner.innerHTML = `<i class="fas fa-info-circle" style="color: var(--aimser-blue-400); margin-right: 0.45rem;"></i><strong>HR Case Library is currently empty.</strong> Click "Upload Case / E-Module" to publish Company Cases, E-Modules, or Practice Cases.`;
      }
    }

    applyCaseFilters();
  } catch (err) {
    console.error("Failed loading HR Case Library:", err);
    grid.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-exclamation-triangle" style="color: var(--danger);"></i>
        <h3>Failed to load HR Case Library</h3>
        <p style="font-size: 0.8rem;">${escapeHtml(err.message)}</p>
      </div>`;
  }
}

function applyCaseFilters() {
  const typeFilter = document.getElementById("admin-case-type-filter")?.value || "all";
  const term = (document.getElementById("admin-case-search")?.value || "").toLowerCase().trim();

  const filtered = cachedCases.filter((item) => {
    const matchesType = typeFilter === "all" || (item.type || "Company Case") === typeFilter;
    const matchesTerm =
      !term ||
      (item.title || "").toLowerCase().includes(term) ||
      (item.category || "").toLowerCase().includes(term) ||
      (item.authorName || "").toLowerCase().includes(term) ||
      (item.body || "").toLowerCase().includes(term);
    return matchesType && matchesTerm;
  });

  renderAdminCasesGrid(filtered);
}

function renderAdminCasesGrid(items) {
  const grid = document.getElementById("admin-cases-grid");
  if (!grid) return;

  if (!items || items.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-book-open"></i>
        <h3>No Cases or E-Modules Found</h3>
        <p>Click "Upload Case / E-Module" above to publish learning materials to the HR Case Library.</p>
      </div>`;
    return;
  }

  grid.innerHTML = items
    .map((item) => {
      const itemType = item.type || "Company Case";
      const hasAnswerKey = itemType === "Practice Case" && Boolean(item.answerKey);
      const authorRole = (item.authorRole || "faculty").toUpperCase();

      return `
        <article class="glass-panel" style="display:flex;flex-direction:column;justify-content:space-between;background:var(--bg-surface);">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:0.4rem;flex-wrap:wrap;margin-bottom:0.65rem;">
              <span class="badge-pill">${escapeHtml(itemType)}</span>
              <div style="display:flex;align-items:center;gap:0.4rem;">
                ${hasAnswerKey ? `<span class="badge-pill" style="background:rgba(16,185,129,0.16);color:#10b981;"><i class="fas fa-key"></i> Key Included</span>` : ""}
                <button type="button" class="btn-sidebar-action btn-logout btn-admin-del-case" data-id="${item.id}" data-title="${escapeHtml(item.title || "")}" style="width:auto;padding:0.28rem 0.6rem;font-size:0.74rem;" title="Delete Material">
                  <i class="fas fa-trash-alt"></i> Delete
                </button>
              </div>
            </div>
            <h3 style="font-size:1.02rem;margin-bottom:0.35rem;color:var(--text-primary);">${escapeHtml(item.title || "Untitled Material")}</h3>
            <div style="font-size:0.76rem;color:var(--text-tertiary);margin-bottom:0.6rem;">
              By <strong>${escapeHtml(item.authorName || "Faculty")}</strong> (${escapeHtml(authorRole)}) • ${escapeHtml(item.category || "HR Policy")}
            </div>
            <p class="text-muted" style="font-size:0.82rem;line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;">
              ${escapeHtml(item.body || "")}
            </p>
          </div>
        </article>`;
    })
    .join("");

  grid.querySelectorAll(".btn-admin-del-case").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const caseId = btn.dataset.id;
      const caseTitle = btn.dataset.title;
      if (!confirm(`Permanently delete "${caseTitle}" from the HR Case Library?`)) return;

      btn.disabled = true;
      try {
        await deleteDoc(doc(db, "cases", caseId));
        await logAuditEvent(`Admin deleted HR Case Library item "${caseTitle}"`, "HR_LIBRARY", currentAdminUser.email);
        sessionStorage.removeItem("aimser_v2_hr_library_items");
        await Promise.all([loadCasesAdmin(), loadAuditLogs()]);
      } catch (err) {
        alert("Failed to delete material: " + err.message);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function setupAdminCaseModal() {
  const openBtn = document.getElementById("btn-open-admin-case-modal");
  const modal = document.getElementById("modal-admin-create-case");
  const form = document.getElementById("form-admin-create-case");

  document.querySelectorAll('[data-close-modal="modal-admin-create-case"]').forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "true";
    btn.addEventListener("click", () => {
      if (modal) {
        modal.classList.remove("is-open");
        modal.setAttribute("aria-hidden", "true");
      }
    });
  });

  if (openBtn && modal && !openBtn.dataset.bound) {
    openBtn.dataset.bound = "true";
    openBtn.addEventListener("click", () => {
      modal.classList.add("is-open");
      modal.setAttribute("aria-hidden", "false");
    });
  }

  if (form && !form.dataset.bound) {
    form.dataset.bound = "true";
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("btn-submit-admin-case");
      const type = document.getElementById("admin-case-type").value;
      const category = document.getElementById("admin-case-category").value;
      const title = document.getElementById("admin-case-title").value.trim();
      const downloadUrl = sanitizeUrl(document.getElementById("admin-case-download-url").value.trim(), "");
      const body = document.getElementById("admin-case-body").value.trim();
      const answerKey = document.getElementById("admin-case-answer-key").value.trim();

      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publishing...';

      try {
        checkRateLimit("admin_upload_case", 8, 60000);
        await addDoc(collection(db, "cases"), {
          type,
          category,
          title,
          downloadUrl,
          body,
          answerKey,
          authorUid: currentAdminUser.uid,
          authorName: adminProfile.fullName,
          authorRole: "admin",
          createdAt: serverTimestamp()
        });

        await logAuditEvent(`Admin published ${type}: "${title}" to HR Library`, "HR_LIBRARY", currentAdminUser.email);
        sessionStorage.removeItem("aimser_v2_hr_library_items");

        if (modal) {
          modal.classList.remove("is-open");
          modal.setAttribute("aria-hidden", "true");
        }
        form.reset();
        await Promise.all([loadCasesAdmin(), loadAuditLogs()]);
      } catch (err) {
        alert("Failed to publish material: " + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Publish to HR Library';
      }
    });
  }
}

// HR Feed Summary Pipeline
async function loadHrFeedAdmin() {
  const container = document.getElementById("admin-feed-container");
  if (!container) return;

  try {
    let snap;
    try {
      snap = await getDocs(query(collection(db, "hr_feed"), orderBy("createdAt", "desc")));
    } catch {
      snap = await getDocs(collection(db, "hr_feed"));
    }

    cachedFeedPosts = snap.docs
      .map((d) => {
        const data = d.data();
        const tsMillis = data.createdAt?.toMillis
          ? data.createdAt.toMillis()
          : data.createdAt
            ? new Date(data.createdAt).getTime()
            : 0;
        return { id: d.id, ...data, tsMillis };
      })
      .sort((a, b) => b.tsMillis - a.tsMillis);

    FastCache.set("admin_feed_posts", cachedFeedPosts);
    applyFeedFilters();
  } catch (err) {
    console.error("Failed loading HR Feed for admin:", err);
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-exclamation-triangle" style="color: var(--danger);"></i>
        <h3>Failed to load HR Feed posts.</h3>
        <p style="font-size: 0.8rem;">${escapeHtml(err.message)}</p>
      </div>`;
  }
}

function applyFeedFilters() {
  const statusFilter = (document.getElementById("admin-feed-filter")?.value || "all").toLowerCase();
  const term = (document.getElementById("admin-feed-search")?.value || "").toLowerCase().trim();

  const filtered = cachedFeedPosts.filter((post) => {
    const isArchived = Boolean(post.archived);
    if (statusFilter === "active" && isArchived) return false;
    if (statusFilter === "archived" && !isArchived) return false;

    if (!term) return true;
    return (
      (post.title || "").toLowerCase().includes(term) ||
      (post.authorName || "").toLowerCase().includes(term) ||
      (post.authorEmail || "").toLowerCase().includes(term) ||
      (post.concerns || "").toLowerCase().includes(term) ||
      (post.investigation || "").toLowerCase().includes(term) ||
      (post.resolution || "").toLowerCase().includes(term)
    );
  });

  renderAdminFeedList(filtered);
}

function renderAdminFeedList(posts) {
  const container = document.getElementById("admin-feed-container");
  if (!container) return;

  if (!posts || posts.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-comments"></i>
        <h3>No HR Feed Posts Found</h3>
        <p>No workplace conflict scenarios match the selected filter.</p>
      </div>`;
    return;
  }

  container.innerHTML = posts
    .map((post) => {
      const isArchived = Boolean(post.archived);
      const authorRole = (post.authorRole || "student").toLowerCase();
      const comments = post.comments || [];
      const dateStr = post.tsMillis ? new Date(post.tsMillis).toLocaleString() : "Recent";
      const safePostImg = sanitizeUrl(post.imageUrl, "");

      const roleBadge =
        authorRole === "admin"
          ? `<span style="display:inline-block;padding:0.15rem 0.55rem;border-radius:9999px;font-size:0.68rem;font-weight:700;text-transform:uppercase;background:var(--aimser-blue-700);color:#ffffff;">ADMIN</span>`
          : authorRole === "faculty"
            ? `<span style="display:inline-block;padding:0.15rem 0.55rem;border-radius:9999px;font-size:0.68rem;font-weight:700;text-transform:uppercase;background:rgba(56,189,248,0.16);color:#38bdf8;">FACULTY</span>`
            : `<span style="display:inline-block;padding:0.15rem 0.55rem;border-radius:9999px;font-size:0.68rem;font-weight:700;text-transform:uppercase;background:rgba(16,185,129,0.16);color:#10b981;">STUDENT</span>`;

      const statusBadge = isArchived
        ? `<span class="badge-pill" style="background:rgba(245,158,11,0.18);color:var(--warning);border-color:var(--warning);">ARCHIVED</span>`
        : `<span class="badge-pill" style="background:rgba(16,185,129,0.14);color:var(--success);border-color:rgba(16,185,129,0.35);">ACTIVE</span>`;

      const postImgHtml = safePostImg
        ? `<div style="margin-bottom: 0.85rem;">
             <img src="${safePostImg}" alt="Attached post photo" class="btn-admin-lightbox" data-src="${safePostImg}" data-title="${escapeHtml(post.title || "Attached Evidence")}" style="max-height: 240px; width: 100%; object-fit: cover; border-radius: var(--radius-xs); border: 1px solid var(--border-medium); cursor: zoom-in;" />
           </div>`
        : "";

      const commentsHtml =
        comments.length === 0
          ? `<div class="text-muted" style="font-size: 0.78rem;">No comments on this post yet.</div>`
          : comments
              .map((c, idx) => {
                const cRole = (c.authorRole || "student").toLowerCase();
                const cBadge =
                  cRole === "admin"
                    ? `<span style="display:inline-block;padding:0.1rem 0.45rem;border-radius:9999px;font-size:0.64rem;font-weight:700;text-transform:uppercase;background:var(--aimser-blue-700);color:#ffffff;">ADMIN</span>`
                    : cRole === "faculty"
                      ? `<span style="display:inline-block;padding:0.1rem 0.45rem;border-radius:9999px;font-size:0.64rem;font-weight:700;text-transform:uppercase;background:rgba(56,189,248,0.16);color:#38bdf8;">FACULTY</span>`
                      : `<span style="display:inline-block;padding:0.1rem 0.45rem;border-radius:9999px;font-size:0.64rem;font-weight:700;text-transform:uppercase;background:rgba(16,185,129,0.16);color:#10b981;">STUDENT</span>`;

                const safeCommentImg = sanitizeUrl(c.imageUrl, "");
                const commentImgHtml = safeCommentImg
                  ? `<div style="margin-top: 0.4rem;">
                       <img src="${safeCommentImg}" alt="Photo comment by ${escapeHtml(c.authorName || "Member")}" class="btn-admin-lightbox" data-src="${safeCommentImg}" data-title="Photo Comment by ${escapeHtml(c.authorName || "Member")}" style="max-height: 150px; max-width: 100%; border-radius: var(--radius-xs); border: 1px solid var(--border-medium); cursor: zoom-in; object-fit: cover;" />
                     </div>`
                  : "";

                return `
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.65rem; padding: 0.55rem 0.75rem; border-radius: var(--radius-xs); background: var(--bg-canvas); border: 1px solid var(--border-subtle); font-size: 0.8rem;">
                    <div style="flex: 1; min-width: 200px;">
                      <div style="display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.2rem; flex-wrap: wrap;">
                        <strong>${escapeHtml(c.authorName || "Member")}</strong>
                        ${cBadge}
                      </div>
                      ${c.text ? `<p style="margin: 0; color: var(--text-primary); white-space: pre-wrap;">${escapeHtml(c.text)}</p>` : ""}
                      ${commentImgHtml}
                    </div>
                    <button type="button" class="btn-sidebar-action btn-logout btn-admin-del-comment" data-post-id="${post.id}" data-idx="${idx}" style="width: auto; padding: 0.24rem 0.55rem; font-size: 0.72rem;" title="Delete Comment">
                      <i class="fas fa-trash"></i>
                    </button>
                  </div>`;
              })
              .join("");

      return `
        <div class="glass-panel" style="background: var(--bg-surface); ${isArchived ? "border-color: rgba(245, 158, 11, 0.45);" : ""}">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 0.75rem;">
            <div>
              <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.25rem;">
                <h3 style="margin: 0; font-size: 1.02rem; color: var(--text-primary);">${escapeHtml(post.title || "Untitled Scenario")}</h3>
                ${statusBadge}
              </div>
              <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; font-size: 0.78rem; color: var(--text-secondary);">
                <strong>${escapeHtml(post.authorName || "Unknown")}</strong>
                ${roleBadge}
                <span>(${escapeHtml(post.authorEmail || "No email")})</span>
                <span>• ${escapeHtml(dateStr)}</span>
                <span>• <i class="far fa-comment-dots"></i> ${comments.length} comment(s)</span>
              </div>
            </div>

            <div style="display: flex; align-items: center; gap: 0.45rem;">
              <button type="button" class="btn-secondary btn-admin-archive-feed" data-id="${post.id}" data-title="${escapeHtml(post.title || "")}" data-archived="${isArchived}" style="padding: 0.36rem 0.75rem; font-size: 0.78rem;">
                <i class="fas ${isArchived ? "fa-box-open" : "fa-archive"}"></i> ${isArchived ? "Unarchive" : "Archive"}
              </button>
              <button type="button" class="btn-sidebar-action btn-logout btn-admin-del-feed" data-id="${post.id}" data-title="${escapeHtml(post.title || "")}" style="width: auto; padding: 0.36rem 0.75rem; font-size: 0.78rem;">
                <i class="fas fa-trash-alt"></i> Delete
              </button>
            </div>
          </div>

          ${postImgHtml}

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.65rem; font-size: 0.8rem; margin-bottom: 0.85rem;">
            <div style="padding: 0.65rem 0.8rem; border-radius: var(--radius-xs); background: var(--bg-canvas); border: 1px solid var(--border-subtle);">
              <strong style="color: var(--warning); display: block; font-size: 0.7rem; text-transform: uppercase; margin-bottom: 0.2rem;">Concerns</strong>
              <span style="color: var(--text-secondary);">${escapeHtml(post.concerns || "—")}</span>
            </div>
            <div style="padding: 0.65rem 0.8rem; border-radius: var(--radius-xs); background: var(--bg-canvas); border: 1px solid var(--border-subtle);">
              <strong style="color: #38bdf8; display: block; font-size: 0.7rem; text-transform: uppercase; margin-bottom: 0.2rem;">Investigation</strong>
              <span style="color: var(--text-secondary);">${escapeHtml(post.investigation || "—")}</span>
            </div>
            <div style="padding: 0.65rem 0.8rem; border-radius: var(--radius-xs); background: var(--bg-canvas); border: 1px solid var(--border-subtle);">
              <strong style="color: var(--success); display: block; font-size: 0.7rem; text-transform: uppercase; margin-bottom: 0.2rem;">Resolution</strong>
              <span style="color: var(--text-secondary);">${escapeHtml(post.resolution || "—")}</span>
            </div>
          </div>

          <div style="padding-top: 0.75rem; border-top: 1px solid var(--border-subtle);">
            <div style="font-size: 0.76rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.5rem;">
              <i class="far fa-comment-dots"></i> Comments &amp; Photo Attachments (${comments.length})
            </div>
            <div style="display: flex; flex-direction: column; gap: 0.45rem;">
              ${commentsHtml}
            </div>
          </div>
        </div>`;
    })
    .join("");

  container.querySelectorAll(".btn-admin-lightbox").forEach((img) => {
    img.addEventListener("click", () => {
      const modal = document.getElementById("modal-image-lightbox");
      const titleEl = document.getElementById("lightbox-title");
      const imgEl = document.getElementById("lightbox-img");
      if (titleEl) titleEl.textContent = img.dataset.title || "Attached Evidence";
      if (imgEl) imgEl.src = img.dataset.src;
      if (modal) {
        modal.classList.add("is-open");
        modal.setAttribute("aria-hidden", "false");
      }
    });
  });

  container.querySelectorAll(".btn-admin-del-comment").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const postId = btn.dataset.postId;
      const idx = Number(btn.dataset.idx);
      const targetPost = cachedFeedPosts.find((p) => p.id === postId);
      if (!targetPost) return;

      const comment = targetPost.comments?.[idx];
      if (!confirm(`Delete comment by ${comment?.authorName || "this user"}?`)) return;

      btn.disabled = true;
      try {
        const updatedComments = (targetPost.comments || []).filter((_, i) => i !== idx);
        await updateDoc(doc(db, "hr_feed", postId), {
          comments: updatedComments
        });

        await logAuditEvent(
          `Admin deleted comment by ${comment?.authorName || "user"} on HR Feed post "${targetPost.title}"`,
          "HR_FEED_MODERATION",
          currentAdminUser.email
        );

        sessionStorage.removeItem("aimser_v2_hr_feed_posts");
        await Promise.all([loadHrFeedAdmin(), loadAuditLogs()]);
      } catch (err) {
        alert("Failed to delete comment: " + err.message);
      } finally {
        btn.disabled = false;
      }
    });
  });

  container.querySelectorAll(".btn-admin-archive-feed").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const postId = btn.dataset.id;
      const postTitle = btn.dataset.title;
      const currentlyArchived = btn.dataset.archived === "true";
      const nextState = !currentlyArchived;

      btn.disabled = true;
      try {
        await updateDoc(doc(db, "hr_feed", postId), {
          archived: nextState,
          archivedAt: nextState ? serverTimestamp() : null,
          archivedBy: nextState ? currentAdminUser.email : null
        });

        await logAuditEvent(
          `Admin ${nextState ? "archived" : "unarchived"} HR Feed post "${postTitle}"`,
          "HR_FEED_MODERATION",
          currentAdminUser.email
        );

        sessionStorage.removeItem("aimser_v2_hr_feed_posts");
        await Promise.all([loadHrFeedAdmin(), loadAuditLogs()]);
      } catch (err) {
        alert("Failed to update archive state: " + err.message);
      } finally {
        btn.disabled = false;
      }
    });
  });

  container.querySelectorAll(".btn-admin-del-feed").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const postId = btn.dataset.id;
      const postTitle = btn.dataset.title;

      if (!confirm(`Permanently delete HR Feed post "${postTitle}"? This cannot be undone.`)) return;

      btn.disabled = true;
      try {
        await deleteDoc(doc(db, "hr_feed", postId));
        await logAuditEvent(
          `Admin permanently deleted HR Feed post "${postTitle}"`,
          "HR_FEED_MODERATION",
          currentAdminUser.email
        );

        sessionStorage.removeItem("aimser_v2_hr_feed_posts");
        await Promise.all([loadHrFeedAdmin(), loadAuditLogs()]);
      } catch (err) {
        alert("Failed to delete post: " + err.message);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

// Telemetry & Platform Audit Trail
async function loadAuditLogs() {
  const container = document.getElementById("admin-logs-container");
  const elLogs = document.getElementById("stat-total-logs");
  if (!container) return;

  try {
    let logsSnap = null;

    try {
      const q = query(collection(db, "audit_logs"), orderBy("timestamp", "desc"), limit(100));
      logsSnap = await getDocs(q);
    } catch {
      try {
        logsSnap = await getDocs(query(collection(db, "logs"), orderBy("timestamp", "desc"), limit(100)));
      } catch {
        try {
          logsSnap = await getDocs(collection(db, "audit_logs"));
        } catch {
          logsSnap = await getDocs(collection(db, "logs"));
        }
      }
    }

    if (!logsSnap || logsSnap.empty) {
      cachedLogs = [];
      if (elLogs) elLogs.textContent = "0";
      renderAuditLogsList([]);
      return;
    }

    cachedLogs = logsSnap.docs
      .map((d) => {
        const data = d.data();
        const tsMillis = data.timestamp?.toMillis
          ? data.timestamp.toMillis()
          : data.timestamp
            ? new Date(data.timestamp).getTime()
            : 0;
        return {
          id: d.id,
          message: data.message || data.action || data.event || data.details || "System Event Recorded",
          category: data.category || "EVENT",
          tsMillis
        };
      })
      .sort((a, b) => b.tsMillis - a.tsMillis);

    FastCache.set("admin_logs", cachedLogs);
    if (elLogs) elLogs.textContent = cachedLogs.length.toLocaleString();
    renderAuditLogsList(cachedLogs);
  } catch (err) {
    console.error("Error loading audit logs:", err);
    container.innerHTML = `
      <div class="empty-state" style="padding: 2.5rem 1.5rem;">
        <i class="fas fa-exclamation-triangle" style="color: var(--warning);"></i>
        <h3>Audit Trail Unavailable</h3>
        <p style="font-size: 0.8rem;">${escapeHtml(err.message)}</p>
      </div>`;
  }
}

function renderAuditLogsList(logs) {
  const container = document.getElementById("admin-logs-container");
  if (!container) return;

  if (!logs || logs.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 2.5rem 1.5rem;">
        <i class="fas fa-clipboard-list"></i>
        <h3>No Telemetry Events Logged</h3>
        <p style="font-size: 0.8rem;">User registrations, classroom join requests, and moderation events will stream here automatically.</p>
      </div>`;
    return;
  }

  container.innerHTML = logs
    .map((item) => {
      const formattedDate = item.tsMillis
        ? `${new Date(item.tsMillis).toLocaleDateString()}, ${new Date(item.tsMillis).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
          })}`
        : "Recent";

      return `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1rem; border-radius: var(--radius-sm); background: var(--bg-surface); border: 1px solid var(--border-subtle); font-family: var(--font-mono); font-size: 0.8125rem;">
          <div style="display: flex; align-items: center; gap: 0.65rem; word-break: break-word;">
            <span style="color: var(--danger); font-weight: 700;">[EVENT]</span>
            <span style="color: var(--text-primary);">${escapeHtml(item.message)}</span>
          </div>
          <span style="color: var(--text-tertiary); font-size: 0.75rem; white-space: nowrap; margin-left: 1rem;">${formattedDate}</span>
        </div>`;
    })
    .join("");
}

// User Directory Pipeline
async function loadUsers() {
  const tbody = document.getElementById("admin-users-table-body");
  if (!tbody) return;

  try {
    let snap;
    try {
      const q = query(collection(db, "users"), orderBy("createdAt", "desc"));
      snap = await getDocs(q);
    } catch {
      snap = await getDocs(collection(db, "users"));
    }

    cachedUsers = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    FastCache.set("admin_users", cachedUsers);
    applyUserFilters();

    if (selectedUserUid) {
      const refreshedUser = cachedUsers.find((u) => u.uid === selectedUserUid);
      if (refreshedUser) openUserInspector(refreshedUser.uid);
    }
  } catch (err) {
    console.error("Failed to load users:", err);
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 2rem; color: var(--danger);">Failed to load user directory: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById("admin-users-table-body");
  if (!tbody) return;

  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-secondary);">No user records found matching your filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = users
    .map((u) => {
      const role = (u.role || "student").toLowerCase();
      const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(u.fullName || "User")}&background=1b5375&color=faf2dd`;
      const avatar = sanitizeUrl(u.avatarUrl, fallback);
      const isSelf = currentAdminUser && u.uid === currentAdminUser.uid;
      const isSelected = selectedUserUid === u.uid;

      let roleBadgeColor = "var(--text-secondary)";
      let roleBg = "var(--bg-surface-elevated)";
      if (role === "admin") {
        roleBadgeColor = "#ffffff";
        roleBg = "var(--aimser-blue-700)";
      } else if (role === "faculty") {
        roleBadgeColor = "#38bdf8";
        roleBg = "rgba(56, 189, 248, 0.16)";
      } else {
        roleBadgeColor = "#10b981";
        roleBg = "rgba(16, 185, 129, 0.16)";
      }

      return `
        <tr class="admin-user-row ${isSelected ? "is-selected" : ""}" data-uid="${u.uid}" style="border-bottom: 1px solid var(--border-subtle); cursor: pointer;">
          <td style="padding: 0.75rem 1rem;">
            <div style="display: flex; align-items: center; gap: 0.65rem;">
              <img src="${avatar}" alt="" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; border: 1px solid var(--border-medium);" />
              <span style="font-weight: 600; color: var(--text-primary);">${escapeHtml(u.fullName || "Unnamed User")} ${isSelf ? '<small style="color: var(--aimser-blue-400);">(You)</small>' : ""}</span>
            </div>
          </td>
          <td style="padding: 0.75rem 1rem; color: var(--text-secondary);">${escapeHtml(u.email || "N/A")}</td>
          <td style="padding: 0.75rem 1rem; color: var(--text-secondary);">${escapeHtml(u.department || "—")}</td>
          <td style="padding: 0.75rem 1rem;">
            <span style="display: inline-block; padding: 0.2rem 0.6rem; border-radius: 9999px; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; background: ${roleBg}; color: ${roleBadgeColor};">
              ${escapeHtml(role)}
            </span>
          </td>
          <td style="padding: 0.75rem 1rem; text-align: right;">
            <button type="button" class="btn-secondary btn-inspect-user" data-uid="${u.uid}" style="padding: 0.35rem 0.75rem; font-size: 0.78rem;">
              <i class="fas fa-user-edit"></i> Inspect &amp; Edit
            </button>
          </td>
        </tr>`;
    })
    .join("");

  tbody.querySelectorAll(".admin-user-row").forEach((row) => {
    row.addEventListener("click", () => {
      openUserInspector(row.dataset.uid);
    });
  });
}

// User Profile & Details Inspector Panel
function openUserInspector(uid) {
  const userObj = cachedUsers.find((u) => u.uid === uid);
  if (!userObj) return;

  selectedUserUid = uid;
  resetAvatarRequested = false;

  const layout = document.getElementById("user-registry-layout");
  const panel = document.getElementById("user-inspector-panel");
  const statusMsg = document.getElementById("inspector-status-msg");

  if (layout) layout.classList.add("has-inspector");
  if (panel) panel.style.display = "block";
  if (statusMsg) {
    statusMsg.style.display = "none";
    statusMsg.textContent = "";
  }

  document.querySelectorAll(".admin-user-row").forEach((r) => {
    r.classList.toggle("is-selected", r.dataset.uid === uid);
  });

  const fullName = userObj.fullName || "Unnamed User";
  const email = userObj.email || "N/A";
  const role = (userObj.role || "student").toLowerCase();
  const department = userObj.department || "";
  const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=1b5375&color=faf2dd`;
  const avatarUrl = sanitizeUrl(userObj.avatarUrl, fallbackAvatar);
  const isSelf = currentAdminUser && uid === currentAdminUser.uid;

  document.getElementById("inspector-user-uid").value = uid;
  document.getElementById("inspector-avatar-preview").src = avatarUrl;
  document.getElementById("inspector-header-name").textContent = fullName;
  document.getElementById("inspector-header-role-badge").textContent = role.toUpperCase();
  document.getElementById("inspector-header-email").textContent = email;
  document.getElementById("inspector-uid-text").textContent = uid;

  let createdStr = "Recorded";
  if (userObj.createdAt?.toDate) {
    createdStr = userObj.createdAt.toDate().toLocaleDateString();
  } else if (userObj.createdAt) {
    createdStr = new Date(userObj.createdAt).toLocaleDateString();
  }
  document.getElementById("inspector-created-text").textContent = createdStr;

  document.getElementById("inspector-fullname").value = userObj.fullName || "";
  document.getElementById("inspector-department").value = department;

  const roleSelect = document.getElementById("inspector-role-select");
  const selfNote = document.getElementById("inspector-self-note");
  const deleteUserBtn = document.getElementById("btn-inspector-delete-user");

  roleSelect.value = role;
  roleSelect.disabled = Boolean(isSelf);
  if (selfNote) selfNote.style.display = isSelf ? "block" : "none";
  if (deleteUserBtn) {
    deleteUserBtn.disabled = Boolean(isSelf);
    deleteUserBtn.style.opacity = isSelf ? "0.45" : "1";
    deleteUserBtn.title = isSelf ? "Root administrator account cannot be deleted" : "Remove user profile record";
  }

  const fileInput = document.getElementById("inspector-avatar-input");
  if (fileInput) fileInput.value = "";

  updateInspectorEnrollmentStats(userObj);
}

function updateInspectorEnrollmentStats(userObj) {
  const uid = userObj.uid;
  const email = (userObj.email || "").toLowerCase();
  const role = (userObj.role || "student").toLowerCase();

  const matchingClasses = cachedSections.filter((sec) => {
    if (role === "faculty") {
      return sec.instructorId === uid || (sec.instructorEmail || "").toLowerCase() === email;
    }
    const students = sec.students || sec.enrolled || [];
    return students.some((s) =>
      typeof s === "string" ? s === uid || s.toLowerCase() === email : s.uid === uid
    );
  });

  const matchingTeams = cachedTeams.filter((t) => (t.members || []).includes(uid));

  const classLabels = matchingClasses.map((c) => c.sectionCode || c.code || c.name).join(", ");
  const teamLabels = matchingTeams.map((t) => t.name).join(", ");

  document.getElementById("inspector-classes-text").textContent =
    matchingClasses.length > 0 ? `${matchingClasses.length} (${classLabels})` : "0";
  document.getElementById("inspector-teams-text").textContent =
    matchingTeams.length > 0 ? `${matchingTeams.length} (${teamLabels})` : "0";
}

function closeUserInspector() {
  selectedUserUid = null;
  resetAvatarRequested = false;
  document.getElementById("user-registry-layout")?.classList.remove("has-inspector");
  const panel = document.getElementById("user-inspector-panel");
  if (panel) panel.style.display = "none";
  document.querySelectorAll(".admin-user-row").forEach((r) => r.classList.remove("is-selected"));
}

function setupUserInspectorPanel() {
  const closeBtn = document.getElementById("btn-close-inspector");
  const fileInput = document.getElementById("inspector-avatar-input");
  const resetPhotoBtn = document.getElementById("btn-reset-user-avatar");
  const resetPwBtn = document.getElementById("btn-inspector-reset-pw");
  const deleteUserBtn = document.getElementById("btn-inspector-delete-user");
  const previewImg = document.getElementById("inspector-avatar-preview");
  const form = document.getElementById("form-admin-edit-user");
  const statusMsg = document.getElementById("inspector-status-msg");

  if (closeBtn && !closeBtn.dataset.bound) {
    closeBtn.dataset.bound = "true";
    closeBtn.addEventListener("click", closeUserInspector);
  }

  if (fileInput && !fileInput.dataset.bound) {
    fileInput.dataset.bound = "true";
    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        alert("Please select a valid image file (PNG, JPG, or WebP).");
        fileInput.value = "";
        return;
      }
      resetAvatarRequested = false;
      previewImg.src = URL.createObjectURL(file);
    });
  }

  if (resetPhotoBtn && !resetPhotoBtn.dataset.bound) {
    resetPhotoBtn.dataset.bound = "true";
    resetPhotoBtn.addEventListener("click", () => {
      const nameVal = document.getElementById("inspector-fullname").value.trim() || "User";
      if (fileInput) fileInput.value = "";
      resetAvatarRequested = true;
      previewImg.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(nameVal)}&background=1b5375&color=faf2dd`;
    });
  }

  if (resetPwBtn && !resetPwBtn.dataset.bound) {
    resetPwBtn.dataset.bound = "true";
    resetPwBtn.addEventListener("click", async () => {
      const uid = document.getElementById("inspector-user-uid").value;
      const targetUser = cachedUsers.find((u) => u.uid === uid);
      if (!targetUser || !targetUser.email) return;

      if (!confirm(`Send a password reset email to ${targetUser.email}?`)) return;

      resetPwBtn.disabled = true;
      resetPwBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
      showInspectorStatus(statusMsg, "", "clear");

      try {
        await sendPasswordResetEmail(auth, targetUser.email);
        await logAuditEvent(
          `Admin triggered password reset email for ${targetUser.email}`,
          "SECURITY",
          currentAdminUser.email
        );
        await loadAuditLogs();
        showInspectorStatus(statusMsg, `Password reset link sent to ${targetUser.email}.`, "success");
      } catch (err) {
        showInspectorStatus(statusMsg, err.message || "Failed to send password reset email.", "error");
      } finally {
        resetPwBtn.disabled = false;
        resetPwBtn.innerHTML = '<i class="fas fa-key"></i> Password Reset';
      }
    });
  }

  if (deleteUserBtn && !deleteUserBtn.dataset.bound) {
    deleteUserBtn.dataset.bound = "true";
    deleteUserBtn.addEventListener("click", async () => {
      const uid = document.getElementById("inspector-user-uid").value;
      const targetUser = cachedUsers.find((u) => u.uid === uid);
      if (!targetUser) return;

      if (currentAdminUser && uid === currentAdminUser.uid) {
        alert("Root administrator account cannot be removed.");
        return;
      }

      const label = targetUser.email || targetUser.fullName || uid;
      if (!confirm(`Permanently remove user directory record for "${label}"?`)) return;

      deleteUserBtn.disabled = true;
      deleteUserBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Removing...';

      try {
        await deleteDoc(doc(db, "users", uid));
        await logAuditEvent(
          `Admin removed user directory record for ${label}`,
          "USER_DELETE",
          currentAdminUser.email
        );
        closeUserInspector();
        await Promise.all([loadUsers(), loadMetrics(), loadAuditLogs()]);
      } catch (err) {
        showInspectorStatus(statusMsg, err.message || "Failed to remove user record.", "error");
        deleteUserBtn.disabled = false;
        deleteUserBtn.innerHTML = '<i class="fas fa-user-times"></i> Remove Account';
      }
    });
  }

  if (form && !form.dataset.bound) {
    form.dataset.bound = "true";
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const uid = document.getElementById("inspector-user-uid").value;
      const targetUser = cachedUsers.find((u) => u.uid === uid);
      if (!targetUser) return;

      const fullName = document.getElementById("inspector-fullname").value.trim();
      const department = document.getElementById("inspector-department").value.trim();
      const newRole = document.getElementById("inspector-role-select").value;
      const saveBtn = document.getElementById("btn-save-inspector-user");

      if (!fullName) {
        showInspectorStatus(statusMsg, "Full name is required.", "error");
        return;
      }

      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
      showInspectorStatus(statusMsg, "", "clear");

      try {
        let updatedAvatarUrl = null;

        if (fileInput && fileInput.files.length > 0) {
          saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading Photo...';
          const uploadedUrl = await safeCloudinaryUpload(fileInput.files[0], "aimser/avatars");
          updatedAvatarUrl = `${uploadedUrl}?t=${Date.now()}`;
        } else if (resetAvatarRequested) {
          updatedAvatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=1b5375&color=faf2dd`;
        }

        const isSelf = currentAdminUser && uid === currentAdminUser.uid;
        const effectiveRole = isSelf ? (targetUser.role || "admin").toLowerCase() : newRole;

        const payload = {
          fullName,
          department,
          role: effectiveRole,
          updatedAt: serverTimestamp(),
          modifiedBy: currentAdminUser.email
        };

        if (updatedAvatarUrl) {
          payload.avatarUrl = updatedAvatarUrl;
        }

        await updateDoc(doc(db, "users", uid), payload);

        if (isSelf) {
          await updateProfile(currentAdminUser, {
            displayName: fullName,
            ...(updatedAvatarUrl ? { photoURL: updatedAvatarUrl } : {})
          });
          const cachedMe = FastCache.get("user_profile") || {};
          FastCache.set("user_profile", {
            ...cachedMe,
            fullName,
            department,
            ...(updatedAvatarUrl ? { avatarUrl: updatedAvatarUrl } : {})
          });
          renderAdminIdentity(currentAdminUser, {
            fullName,
            avatarUrl: updatedAvatarUrl || targetUser.avatarUrl
          });
        }

        await logAuditEvent(
          `Admin updated profile & details for ${targetUser.email || uid} (Name: "${fullName}", Role: [${effectiveRole}])`,
          "USER_PROFILE_EDIT",
          currentAdminUser.email
        );

        if (fileInput) fileInput.value = "";
        resetAvatarRequested = false;

        await Promise.all([loadUsers(), loadAuditLogs()]);
        showInspectorStatus(statusMsg, "User profile and details updated successfully!", "success");
      } catch (err) {
        console.error("Failed updating user profile:", err);
        showInspectorStatus(statusMsg, err.message || "Failed to save user details.", "error");
      } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fas fa-save"></i> Save User Details';
      }
    });
  }
}

function showInspectorStatus(el, msg, type) {
  if (!el) return;
  if (type === "clear" || !msg) {
    el.style.display = "none";
    el.textContent = "";
    el.className = "status-msg";
    return;
  }
  el.textContent = msg;
  el.className = `status-msg ${type}`;
  el.style.display = "block";
}

// Classroom Audit Pipeline
async function loadSections() {
  const container = document.getElementById("admin-sections-grid");
  if (!container) return;

  try {
    let snap;
    let collectionUsed = "classrooms";
    try {
      snap = await getDocs(collection(db, "classrooms"));
      if (snap.empty) {
        snap = await getDocs(collection(db, "sections"));
        collectionUsed = "sections";
      }
    } catch {
      snap = await getDocs(collection(db, "sections"));
      collectionUsed = "sections";
    }

    cachedSections = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (selectedUserUid) {
      const activeUser = cachedUsers.find((u) => u.uid === selectedUserUid);
      if (activeUser) updateInspectorEnrollmentStats(activeUser);
    }

    if (cachedSections.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-folder-open"></i>
          <h3>No Classrooms Found</h3>
          <p>No sections or classrooms have been registered in Firestore yet.</p>
        </div>`;
      return;
    }

    container.innerHTML = cachedSections
      .map((sec) => {
        const code = sec.sectionCode || sec.code || "NO-CODE";
        const enrolledCount = (sec.students || sec.enrolled || []).length;
        const maxCap = sec.maxStudents || 100;

        return `
          <div class="glass-panel" style="display: flex; flex-direction: column; justify-content: space-between;">
            <div>
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem; gap: 0.5rem;">
                <h3 style="margin: 0; font-size: 1.05rem; color: var(--text-primary);">${escapeHtml(sec.name || sec.title || "Untitled Section")}</h3>
                <span class="badge-pill">${escapeHtml(code)}</span>
              </div>
              <p class="text-muted" style="font-size: 0.8rem; margin-bottom: 0.85rem;">
                <strong>Instructor:</strong> ${escapeHtml(sec.instructorEmail || sec.facultyEmail || sec.createdByName || "Unknown")}
              </p>
              <div style="font-size: 0.78rem; color: var(--text-secondary); line-height: 1.65;">
                <div><i class="fas fa-users" style="width: 16px;"></i> Students Enrolled: <strong>${enrolledCount} / ${maxCap}</strong></div>
                <div><i class="fas fa-tasks" style="width: 16px;"></i> Activities Published: <strong>${sec.activityCount || (sec.activities || []).length || 0}</strong></div>
              </div>
            </div>

            <div style="margin-top: 1.25rem; padding-top: 0.75rem; border-top: 1px solid var(--border-subtle); display: flex; justify-content: flex-end;">
              <button type="button" class="btn-sidebar-action btn-logout btn-delete-section" data-id="${sec.id}" data-code="${escapeHtml(code)}" data-coll="${collectionUsed}" style="width: auto; padding: 0.35rem 0.65rem; font-size: 0.75rem;">
                <i class="fas fa-trash"></i> Purge Section
              </button>
            </div>
          </div>`;
      })
      .join("");

    container.querySelectorAll(".btn-delete-section").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const coll = btn.dataset.coll;
        const code = btn.dataset.code;
        if (confirm(`Are you sure you want to permanently purge classroom section "${code}"?`)) {
          try {
            await deleteDoc(doc(db, coll, id));
            await logAuditEvent(`Admin purged classroom section ${code}`, "CLASSROOM", currentAdminUser.email);
            await Promise.all([loadSections(), loadMetrics(), loadAuditLogs()]);
          } catch (err) {
            alert("Failed to delete section: " + err.message);
          }
        }
      });
    });
  } catch (err) {
    console.error("Error loading sections:", err);
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-exclamation-triangle" style="color: var(--danger);"></i>
        <h3>Failed to load sections.</h3>
        <p style="font-size: 0.8rem;">${escapeHtml(err.message)}</p>
      </div>`;
  }
}

// Synchronized Tabs, Sidebar Active Highlight & Hash Routing
function activateAdminTab(targetPanelId, clickedSidebarKey = null) {
  const tabs = document.querySelectorAll(".subnav-tab");
  const panels = document.querySelectorAll(".tab-panel");
  const sidebarBtns = document.querySelectorAll(".subnav-link");

  tabs.forEach((t) => {
    const isMatch = t.dataset.tab === targetPanelId;
    t.classList.toggle("active", isMatch);
    t.classList.toggle("is-active", isMatch);
  });

  panels.forEach((p) => {
    const isMatch = p.id === targetPanelId;
    p.classList.toggle("active", isMatch);
    p.classList.toggle("is-active", isMatch);
    p.style.display = isMatch ? "block" : "none";
  });

  const resolvedKey =
    clickedSidebarKey ||
    (targetPanelId === "panel-users"
      ? "users"
      : targetPanelId === "panel-sections"
        ? "sections"
        : targetPanelId === "panel-cases"
          ? "cases"
          : targetPanelId === "panel-feed"
            ? "feed"
            : "overview");

  sidebarBtns.forEach((btn) => {
    const isMatch = btn.dataset.navKey === resolvedKey;
    btn.classList.toggle("active", isMatch);
    btn.classList.toggle("is-active", isMatch);
  });

  if (resolvedKey === "audit") {
    document.getElementById("audit-trail-card")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function applyInitialHashRoute() {
  const hash = window.location.hash.toLowerCase();
  if (hash === "#users") {
    activateAdminTab("panel-users", "users");
  } else if (hash === "#sections") {
    activateAdminTab("panel-sections", "sections");
  } else if (hash === "#cases") {
    activateAdminTab("panel-cases", "cases");
  } else if (hash === "#feed") {
    activateAdminTab("panel-feed", "feed");
  } else if (hash === "#audit") {
    activateAdminTab("panel-telemetry", "audit");
  } else {
    activateAdminTab("panel-telemetry", "overview");
  }
}

function setupTabs() {
  document.querySelectorAll(".subnav-tab").forEach((tab) => {
    if (tab.dataset.bound) return;
    tab.dataset.bound = "true";
    tab.addEventListener("click", () => {
      activateAdminTab(tab.dataset.tab);
    });
  });

  document.querySelectorAll(".subnav-link").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "true";
    btn.addEventListener("click", () => {
      activateAdminTab(btn.dataset.target, btn.dataset.navKey);
    });
  });

  const bindBtn = (id, fn) => {
    const el = document.getElementById(id);
    if (el && !el.dataset.bound) {
      el.dataset.bound = "true";
      el.addEventListener("click", fn);
    }
  };

  bindBtn("btn-refresh-users", loadUsers);
  bindBtn("btn-refresh-sections", loadSections);
  bindBtn("btn-refresh-cases", loadCasesAdmin);
  bindBtn("btn-refresh-feed", loadHrFeedAdmin);
  bindBtn("btn-refresh-logs", async () => {
    await Promise.all([loadAuditLogs(), loadMetrics()]);
  });
}

// Search & Role Filtering
function applyUserFilters() {
  const term = (document.getElementById("admin-user-search")?.value || "").toLowerCase().trim();
  const roleFilter = (document.getElementById("admin-role-filter")?.value || "all").toLowerCase();

  const filtered = cachedUsers.filter((u) => {
    const uRole = (u.role || "student").toLowerCase();
    const matchesRole = roleFilter === "all" || uRole === roleFilter;
    const matchesTerm =
      !term ||
      (u.fullName && u.fullName.toLowerCase().includes(term)) ||
      (u.email && u.email.toLowerCase().includes(term)) ||
      (u.department && u.department.toLowerCase().includes(term));
    return matchesRole && matchesTerm;
  });

  renderUsersTable(filtered);
}

function setupSearchAndFilters() {
  const bindInput = (id, eventName, handler) => {
    const el = document.getElementById(id);
    if (el && !el.dataset.bound) {
      el.dataset.bound = "true";
      el.addEventListener(eventName, handler);
    }
  };

  bindInput("admin-user-search", "input", applyUserFilters);
  bindInput("admin-role-filter", "change", applyUserFilters);
  bindInput("admin-case-type-filter", "change", applyCaseFilters);
  bindInput("admin-case-search", "input", applyCaseFilters);
  bindInput("admin-feed-filter", "change", applyFeedFilters);
  bindInput("admin-feed-search", "input", applyFeedFilters);
  bindInput("admin-log-search", "input", (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) {
      renderAuditLogsList(cachedLogs);
      return;
    }
    const filtered = cachedLogs.filter((l) => (l.message || "").toLowerCase().includes(q));
    renderAuditLogsList(filtered);
  });
}