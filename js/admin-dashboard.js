// js/admin-dashboard.js - Administrator Management, Permanent Account Removal Tombstone, Live User Registry & Bell Notifications (v=18)
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
  getDocsFromServer,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import * as CloudCfg from "./cloudinary-config.js";
import * as SecUtils from "./security-utils.js";

const FastCache = SecUtils.FastCache;
const escapeHtml = SecUtils.escapeHtml;
const sanitizeUrl = SecUtils.sanitizeUrl;
const checkRateLimit = SecUtils.checkRateLimit || (() => true);
const logAuditEvent = SecUtils.logAuditEvent;

async function safeCloudinaryUpload(file, folder = "aimser/avatars") {
  const fn =
    CloudCfg.uploadToCloudinary ||
    CloudCfg.uploadImageToCloudinary ||
    CloudCfg.uploadFile ||
    CloudCfg.default;

  if (typeof fn === "function") {
    return await fn(file, folder);
  }

  const cloudName = CloudCfg.CLOUDINARY_CLOUD_NAME || "zcco0jvg";
  const preset = CloudCfg.CLOUDINARY_AVATAR_PRESET || CloudCfg.CLOUDINARY_UPLOAD_PRESET || "Aimser_Avatars";
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", preset);
  formData.append("folder", folder);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, {
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
let usersRegistryUnsubscribe = null;

function getSafeTimestampMillis(val) {
  if (!val) return 0;
  if (typeof val.toMillis === "function") return val.toMillis();
  if (typeof val.seconds === "number") return val.seconds * 1000;
  const parsed = new Date(val).getTime();
  return isNaN(parsed) ? 0 : parsed;
}

function getDisplayUserName(u) {
  if (u.fullName && String(u.fullName).trim()) return String(u.fullName).trim();
  if (u.firstName || u.lastName) return `${u.firstName || ""} ${u.lastName || ""}`.trim();
  if (u.name && String(u.name).trim()) return String(u.name).trim();
  if (u.email && String(u.email).includes("@")) return String(u.email).split("@")[0];
  return "Unnamed User";
}

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

onAuthStateChanged(auth, async (user) => {
  initAdminConsoleUI();

  if (!user) {
    window.location.replace("login.html");
    return;
  }

  try {
    try {
      sessionStorage.removeItem("aimser_v2_admin_users");
      sessionStorage.removeItem("aimser_v2_admin_metrics");
    } catch {}

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

    await Promise.allSettled([
      loadUsers(),
      loadMetrics(),
      loadSections(),
      loadTeamsCache(),
      loadCasesAdmin(),
      loadHrFeedAdmin(),
      loadAuditLogs()
    ]);

    renderAdminNotificationsBell();
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

function renderRoleBadgePill(role) {
  const normalized = (role || "student").toLowerCase();
  if (normalized === "admin") {
    return `<span class="badge-pill role-pill-admin">ADMIN</span>`;
  }
  if (normalized === "faculty") {
    return `<span class="badge-pill role-pill-faculty">FACULTY</span>`;
  }
  return `<span class="badge-pill role-pill-student">STUDENT</span>`;
}

function renderAdminNotificationsBell() {
  const badge = document.getElementById("notif-badge");
  const list = document.getElementById("notifications-feed-list");
  if (!list) return;

  const recentEvents = cachedLogs.slice(0, 6);

  if (badge) {
    if (recentEvents.length > 0) {
      badge.style.display = "inline-block";
      badge.textContent = recentEvents.length;
    } else {
      badge.style.display = "none";
    }
  }

  if (recentEvents.length === 0) {
    list.innerHTML = `<div class="empty-state"><i class="fas fa-bell-slash"></i><h3>No Active Alerts</h3><p>Recent platform audit events will appear here.</p></div>`;
    return;
  }

  list.innerHTML = recentEvents
    .map((item) => {
      const timeStr = item.tsMillis ? new Date(item.tsMillis).toLocaleString() : "Recent";
      return `
        <div class="inspector-meta-item">
          <div class="panel-toolbar">
            <strong>${escapeHtml(item.category || "SYSTEM EVENT")}</strong>
            <span class="badge-pill">${escapeHtml(timeStr)}</span>
          </div>
          <p class="text-muted">${escapeHtml(item.message)}</p>
        </div>`;
    })
    .join("");
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

async function loadMetrics() {
  const getSafeCount = async (collName) => {
    try {
      const snap = await getDocsFromServer(collection(db, collName));
      if (collName === "users") {
        return snap.docs.filter((d) => {
          const data = d.data() || {};
          return !data.deleted && data.status !== "removed" && data.role !== "removed";
        }).length;
      }
      return snap.size;
    } catch {
      try {
        const snap = await getDocs(collection(db, collName));
        if (collName === "users") {
          return snap.docs.filter((d) => {
            const data = d.data() || {};
            return !data.deleted && data.status !== "removed" && data.role !== "removed";
          }).length;
        }
        return snap.size;
      } catch {
        return 0;
      }
    }
  };

  const usersCount = cachedUsers.length > 0 ? cachedUsers.length : await getSafeCount("users");

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

async function loadCasesAdmin() {
  const grid = document.getElementById("admin-cases-grid");
  const banner = document.getElementById("admin-cases-status-banner");
  if (!grid) return;

  try {
    const snap = await getDocs(collection(db, "cases"));
    cachedCases = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const tA = getSafeTimestampMillis(a.createdAt);
        const tB = getSafeTimestampMillis(b.createdAt);
        return tB - tA;
      });

    if (banner) {
      if (cachedCases.length > 0) {
        banner.innerHTML = `<i class="fas fa-check-circle"></i> <strong>${cachedCases.length} published material(s) active</strong> in the HR Case Library.`;
      } else {
        banner.innerHTML = `<i class="fas fa-info-circle"></i> <strong>HR Case Library is currently empty.</strong> Click "Upload Case / E-Module" to publish materials.`;
      }
    }

    applyCaseFilters();
  } catch (err) {
    console.error("Failed loading HR Case Library:", err);
    grid.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-exclamation-triangle"></i>
        <h3>Failed to load HR Case Library</h3>
        <p>${escapeHtml(err.message)}</p>
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
        <article class="glass-panel">
          <div>
            <div class="panel-toolbar">
              <span class="badge-pill">${escapeHtml(itemType)}</span>
              <div class="workspace-action-bar">
                ${hasAnswerKey ? `<span class="badge-pill role-pill-student"><i class="fas fa-key"></i> Key Included</span>` : ""}
                <button type="button" class="btn-sidebar-action btn-logout btn-admin-del-case" data-id="${item.id}" data-title="${escapeHtml(item.title || "")}" title="Delete Material">
                  <i class="fas fa-trash-alt"></i> Delete
                </button>
              </div>
            </div>
            <h3>${escapeHtml(item.title || "Untitled Material")}</h3>
            <p class="text-muted">
              By <strong>${escapeHtml(item.authorName || "Faculty")}</strong> (${escapeHtml(authorRole)})
            </p>
            <p class="text-muted">${escapeHtml(item.body || "")}</p>
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
      const categoryEl = document.getElementById("admin-case-category");
      const category = categoryEl ? categoryEl.value : type;
      const title = document.getElementById("admin-case-title").value.trim();
      const downloadUrl = sanitizeUrl(document.getElementById("admin-case-download-url").value.trim(), "");
      const body = document.getElementById("admin-case-body").value.trim();
      const answerKey = document.getElementById("admin-case-answer-key").value.trim();

      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';

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
        btn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Submit';
      }
    });
  }
}

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
        const tsMillis = getSafeTimestampMillis(data.createdAt);
        return { id: d.id, ...data, tsMillis };
      })
      .sort((a, b) => b.tsMillis - a.tsMillis);

    applyFeedFilters();
  } catch (err) {
    console.error("Failed loading HR Feed for admin:", err);
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-exclamation-triangle"></i>
        <h3>Failed to load HR Feed posts.</h3>
        <p>${escapeHtml(err.message)}</p>
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
      const comments = post.comments || [];
      const dateStr = post.tsMillis ? new Date(post.tsMillis).toLocaleString() : "Recent";
      const safePostImg = sanitizeUrl(post.imageUrl, "");

      const statusBadge = isArchived
        ? `<span class="badge-pill status-pill-archived">ARCHIVED</span>`
        : `<span class="badge-pill status-pill-active">ACTIVE</span>`;

      const postImgHtml = safePostImg
        ? `<img src="${safePostImg}" alt="Attached post photo" class="admin-post-image btn-admin-lightbox" data-src="${safePostImg}" data-title="${escapeHtml(post.title || "Attached Evidence")}" />`
        : "";

      const commentsHtml =
        comments.length === 0
          ? `<div class="text-muted">No comments on this post yet.</div>`
          : comments
              .map((c, idx) => {
                const safeCommentImg = sanitizeUrl(c.imageUrl, "");
                const commentImgHtml = safeCommentImg
                  ? `<img src="${safeCommentImg}" alt="Photo comment by ${escapeHtml(c.authorName || "Member")}" class="admin-comment-image btn-admin-lightbox" data-src="${safeCommentImg}" data-title="Photo Comment by ${escapeHtml(c.authorName || "Member")}" />`
                  : "";

                return `
                  <div class="admin-comment-row">
                    <div>
                      <div class="user-cell-flex">
                        <strong>${escapeHtml(c.authorName || "Member")}</strong>
                        ${renderRoleBadgePill(c.authorRole || "student")}
                      </div>
                      ${c.text ? `<p>${escapeHtml(c.text)}</p>` : ""}
                      ${commentImgHtml}
                    </div>
                    <button type="button" class="btn-card-icon btn-admin-del-comment" data-post-id="${post.id}" data-idx="${idx}" title="Delete Comment">
                      <i class="fas fa-trash"></i>
                    </button>
                  </div>`;
              })
              .join("");

      return `
        <div class="glass-panel ${isArchived ? "card-archived-border" : ""}">
          <div class="panel-toolbar">
            <div>
              <div class="user-cell-flex">
                <h3>${escapeHtml(post.title || "Untitled Scenario")}</h3>
                ${statusBadge}
              </div>
              <div class="user-cell-flex text-muted">
                <strong>${escapeHtml(post.authorName || "Unknown")}</strong>
                ${renderRoleBadgePill(post.authorRole || "student")}
                <span>(${escapeHtml(post.authorEmail || "No email")})</span>
                <span>• ${escapeHtml(dateStr)}</span>
                <span>• <i class="far fa-comment-dots"></i> ${comments.length} comment(s)</span>
              </div>
            </div>

            <div class="workspace-action-bar">
              <button type="button" class="btn-secondary btn-admin-archive-feed" data-id="${post.id}" data-title="${escapeHtml(post.title || "")}" data-archived="${isArchived}">
                <i class="fas ${isArchived ? "fa-box-open" : "fa-archive"}"></i> ${isArchived ? "Unarchive" : "Archive"}
              </button>
              <button type="button" class="btn-sidebar-action btn-logout btn-admin-del-feed" data-id="${post.id}" data-title="${escapeHtml(post.title || "")}">
                <i class="fas fa-trash-alt"></i> Delete
              </button>
            </div>
          </div>

          <div class="admin-post-grid">
            <div class="inspector-meta-item">
              <span>Workplace Concerns</span>
              <p>${escapeHtml(post.concerns || "—")}</p>
            </div>
            <div class="inspector-meta-item">
              <span>Investigation Plan</span>
              <p>${escapeHtml(post.investigation || "—")}</p>
            </div>
            <div class="inspector-meta-item">
              <span>Recommended Resolution</span>
              <p>${escapeHtml(post.resolution || "—")}</p>
            </div>
          </div>

          ${postImgHtml}

          <div class="card-footer-bar">
            <div class="w-full">
              <p class="text-muted"><i class="far fa-comment-dots"></i> Comments (${comments.length})</p>
              <div class="admin-comments-stack">
                ${commentsHtml}
              </div>
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

async function loadAuditLogs() {
  const container = document.getElementById("admin-logs-container");
  const elLogs = document.getElementById("stat-total-logs");
  if (!container) return;

  try {
    let logsSnap = null;

    try {
      const q = query(collection(db, "audit_logs"), orderBy("timestamp", "desc"), limit(100));
      logsSnap = await getDocsFromServer(q);
    } catch {
      try {
        logsSnap = await getDocs(query(collection(db, "audit_logs"), orderBy("timestamp", "desc"), limit(100)));
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
      renderAdminNotificationsBell();
      return;
    }

    cachedLogs = logsSnap.docs
      .map((d) => {
        const data = d.data();
        const tsMillis = getSafeTimestampMillis(data.timestamp);
        return {
          id: d.id,
          message: data.message || data.action || data.event || data.details || "System Event Recorded",
          category: data.category || "EVENT",
          tsMillis
        };
      })
      .sort((a, b) => b.tsMillis - a.tsMillis);

    if (elLogs) elLogs.textContent = cachedLogs.length.toLocaleString();
    renderAuditLogsList(cachedLogs);
    renderAdminNotificationsBell();
  } catch (err) {
    console.error("Error loading audit logs:", err);
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-exclamation-triangle"></i>
        <h3>Audit Trail Unavailable</h3>
        <p>${escapeHtml(err.message)}</p>
      </div>`;
  }
}

function renderAuditLogsList(logs) {
  const container = document.getElementById("admin-logs-container");
  if (!container) return;

  if (!logs || logs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-clipboard-list"></i>
        <h3>No Telemetry Events Logged</h3>
        <p>User registrations, classroom join requests, and moderation events will stream here automatically.</p>
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
        <div class="admin-log-item">
          <div>
            <span class="admin-log-tag">[${escapeHtml(item.category || "EVENT")}]</span>
            <span>${escapeHtml(item.message)}</span>
          </div>
          <span class="admin-log-time">${formattedDate}</span>
        </div>`;
    })
    .join("");
}

// Uncached Live Server-Backed User Registry Loader (Filters out removed tombstone accounts)
async function loadUsers() {
  const tbody = document.getElementById("admin-users-table-body");
  if (!tbody) return;

  const syncUsersToTable = (docs) => {
    cachedUsers = docs
      .map((d) => {
        const data = d.data() || {};
        const tsMillis =
          getSafeTimestampMillis(data.createdAt) ||
          getSafeTimestampMillis(data.registeredAt) ||
          getSafeTimestampMillis(data.updatedAt) ||
          0;
        return {
          uid: d.id,
          ...data,
          fullName: getDisplayUserName(data),
          _sortTs: tsMillis
        };
      })
      .filter((u) => !u.deleted && u.status !== "removed" && u.role !== "removed")
      .sort((a, b) => b._sortTs - a._sortTs);

    const elUsers = document.getElementById("stat-total-users");
    if (elUsers) elUsers.textContent = cachedUsers.length.toLocaleString();

    applyUserFilters();

    if (selectedUserUid) {
      const refreshedUser = cachedUsers.find((u) => u.uid === selectedUserUid);
      if (refreshedUser) {
        openUserInspector(refreshedUser.uid);
      } else {
        closeUserInspector();
      }
    }
  };

  if (!usersRegistryUnsubscribe) {
    usersRegistryUnsubscribe = onSnapshot(
      collection(db, "users"),
      { includeMetadataChanges: true },
      (snap) => {
        syncUsersToTable(snap.docs);
      },
      (err) => {
        console.error("Real-time users listener error:", err);
      }
    );
  }

  try {
    let snap;
    try {
      snap = await getDocsFromServer(collection(db, "users"));
    } catch {
      snap = await getDocs(collection(db, "users"));
    }
    syncUsersToTable(snap.docs);
  } catch (err) {
    console.error("Failed to load users:", err);
    tbody.innerHTML = `<tr><td colspan="5">Failed to load user directory: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById("admin-users-table-body");
  if (!tbody) return;

  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5">No user records found matching your filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = users
    .map((u) => {
      const role = (u.role || "student").toLowerCase();
      const displayName = getDisplayUserName(u);
      const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=1b5375&color=faf2dd`;
      const avatar = sanitizeUrl(u.avatarUrl, fallback);
      const isSelf = currentAdminUser && u.uid === currentAdminUser.uid;
      const isSelected = selectedUserUid === u.uid;

      return `
        <tr class="admin-user-row ${isSelected ? "is-selected" : ""}" data-uid="${u.uid}">
          <td>
            <div class="user-cell-flex">
              <img src="${avatar}" alt="" class="avatar-sm" />
              <strong>${escapeHtml(displayName)} ${isSelf ? "<small>(You)</small>" : ""}</strong>
            </div>
          </td>
          <td class="text-muted">${escapeHtml(u.email || "N/A")}</td>
          <td class="text-muted">${escapeHtml(u.department || "—")}</td>
          <td>${renderRoleBadgePill(role)}</td>
          <td class="text-right">
            <button type="button" class="btn-secondary btn-inspect-user" data-uid="${u.uid}">
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

function openUserInspector(uid) {
  const userObj = cachedUsers.find((u) => u.uid === uid);
  if (!userObj) return;

  selectedUserUid = uid;
  resetAvatarRequested = false;

  const layout = document.getElementById("user-registry-layout");
  const panel = document.getElementById("user-inspector-panel");
  const statusMsg = document.getElementById("inspector-status-msg");

  if (layout) layout.classList.add("has-inspector");
  if (panel) panel.classList.remove("is-hidden");
  if (statusMsg) {
    statusMsg.style.display = "none";
    statusMsg.textContent = "";
  }

  document.querySelectorAll(".admin-user-row").forEach((r) => {
    r.classList.toggle("is-selected", r.dataset.uid === uid);
  });

  const fullName = getDisplayUserName(userObj);
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

  const tsMillis = getSafeTimestampMillis(userObj.createdAt) || getSafeTimestampMillis(userObj.registeredAt);
  const createdStr = tsMillis ? new Date(tsMillis).toLocaleDateString() : "Recorded";
  document.getElementById("inspector-created-text").textContent = createdStr;

  document.getElementById("inspector-fullname").value = fullName;
  document.getElementById("inspector-department").value = department;

  const roleSelect = document.getElementById("inspector-role-select");
  const selfNote = document.getElementById("inspector-self-note");
  const deleteUserBtn = document.getElementById("btn-inspector-delete-user");

  roleSelect.value = role;
  roleSelect.disabled = Boolean(isSelf);
  if (selfNote) selfNote.classList.toggle("is-hidden", !isSelf);
  if (deleteUserBtn) {
    deleteUserBtn.disabled = Boolean(isSelf);
    deleteUserBtn.title = isSelf ? "Root administrator account cannot be deleted" : "Permanently revoke & remove user account";
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
  if (panel) panel.classList.add("is-hidden");
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

  // Permanent Account Removal (Writes Tombstone so Auth-Guard & Login Block Access Forever)
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
      if (!confirm(`Permanently remove account "${label}"? This user will be blocked from signing in and removed from all classrooms and teams.`)) return;

      deleteUserBtn.disabled = true;
      deleteUserBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Removing...';

      try {
        // 1. Write Tombstone Record so login.html and auth-guard.js permanently block this UID from signing back in
        await setDoc(doc(db, "users", uid), {
          uid,
          email: targetUser.email || "",
          deleted: true,
          status: "removed",
          role: "removed",
          removedAt: serverTimestamp(),
          removedBy: currentAdminUser.email
        });

        // 2. Also scrub user from any enrolled classrooms and planner teams
        const targetEmail = (targetUser.email || "").toLowerCase();
        const cleanupPromises = [];

        cachedSections.forEach((sec) => {
          const students = sec.students || [];
          const enrolled = sec.enrolled || [];
          const hasStudent =
            students.some((s) => (typeof s === "string" ? s === uid || s.toLowerCase() === targetEmail : s.uid === uid)) ||
            enrolled.some((s) => (typeof s === "string" ? s === uid || s.toLowerCase() === targetEmail : s.uid === uid));

          if (hasStudent) {
            const nextStudents = students.filter((s) =>
              typeof s === "string" ? s !== uid && s.toLowerCase() !== targetEmail : s.uid !== uid
            );
            const nextEnrolled = enrolled.filter((s) =>
              typeof s === "string" ? s !== uid && s.toLowerCase() !== targetEmail : s.uid !== uid
            );
            cleanupPromises.push(
              updateDoc(doc(db, "classrooms", sec.id), {
                students: nextStudents,
                enrolled: nextEnrolled
              }).catch(() => {})
            );
          }
        });

        cachedTeams.forEach((team) => {
          if ((team.members || []).includes(uid)) {
            const nextMembers = (team.members || []).filter((m) => m !== uid);
            cleanupPromises.push(
              updateDoc(doc(db, "teams", team.id), {
                members: nextMembers
              }).catch(() => {})
            );
          }
        });

        await Promise.allSettled(cleanupPromises);

        await logAuditEvent(
          `Admin permanently removed account and revoked sign-in access for ${label}`,
          "USER_DELETE",
          currentAdminUser.email
        );

        closeUserInspector();
        await Promise.all([loadUsers(), loadMetrics(), loadSections(), loadTeamsCache(), loadAuditLogs()]);
      } catch (err) {
        showInspectorStatus(statusMsg, err.message || "Failed to remove user record.", "error");
      } finally {
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
          <div class="glass-panel">
            <div>
              <div class="panel-toolbar">
                <h3>${escapeHtml(sec.name || sec.title || "Untitled Section")}</h3>
                <span class="badge-pill code-mono">${escapeHtml(code)}</span>
              </div>
              <p class="text-muted">
                <strong>Instructor:</strong> ${escapeHtml(sec.instructorEmail || sec.facultyEmail || sec.createdByName || "Unknown")}
              </p>
              <div class="text-muted">
                <div><i class="fas fa-users"></i> Students Enrolled: <strong>${enrolledCount} / ${maxCap}</strong></div>
                <div><i class="fas fa-tasks"></i> Activities Published: <strong>${sec.activityCount || (sec.activities || []).length || 0}</strong></div>
              </div>
            </div>

            <div class="card-footer-bar">
              <span></span>
              <button type="button" class="btn-sidebar-action btn-logout btn-delete-section" data-id="${sec.id}" data-code="${escapeHtml(code)}" data-coll="${collectionUsed}">
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
        <i class="fas fa-exclamation-triangle"></i>
        <h3>Failed to load sections.</h3>
        <p>${escapeHtml(err.message)}</p>
      </div>`;
  }
}

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

  bindBtn("btn-refresh-users", async () => {
    await Promise.all([loadUsers(), loadMetrics()]);
  });
  bindBtn("btn-refresh-sections", loadSections);
  bindBtn("btn-refresh-cases", loadCasesAdmin);
  bindBtn("btn-refresh-feed", loadHrFeedAdmin);
  bindBtn("btn-refresh-logs", async () => {
    await Promise.all([loadAuditLogs(), loadMetrics()]);
  });
}

function applyUserFilters() {
  const term = (document.getElementById("admin-user-search")?.value || "").toLowerCase().trim();
  const roleFilter = (document.getElementById("admin-role-filter")?.value || "all").toLowerCase();

  const filtered = cachedUsers.filter((u) => {
    const uRole = (u.role || "student").toLowerCase();
    const matchesRole = roleFilter === "all" || uRole === roleFilter;
    const displayName = getDisplayUserName(u).toLowerCase();
    const matchesTerm =
      !term ||
      displayName.includes(term) ||
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