// js/hr-library.js - Public HR Case Library, E-Modules, HR Feed Photo Upload (Posts & Comments) & Moderation Alerts
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
  where,
  orderBy,
  arrayUnion,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { uploadToCloudinary } from "./cloudinary-config.js";
import { FastCache, escapeHtml, sanitizeUrl, checkRateLimit, logAuditEvent } from "./security-utils.js";

let currentUser = null;
let userProfile = null;
let allLibraryItems = [];
let activeCaseItem = null;
let allFeedPosts = [];
let currentFeedView = "active";

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

  const role = (userProfile.role || "student").toLowerCase();
  if (role === "faculty" || role === "admin") {
    const uploadBtn = document.getElementById("btn-open-case-modal");
    if (uploadBtn) uploadBtn.style.display = "inline-flex";
  }

  bindLibraryAndFeedEvents();

  const cachedLib = FastCache.get("hr_library_items");
  if (Array.isArray(cachedLib)) {
    allLibraryItems = cachedLib.filter((item) => !String(item.id || "").startsWith("builtin-"));
    FastCache.set("hr_library_items", allLibraryItems);
    renderFilteredLibrary();
  }

  const cachedFeed = FastCache.get("hr_feed_posts");
  if (Array.isArray(cachedFeed)) {
    allFeedPosts = cachedFeed;
    renderFeedStream();
  }

  await Promise.all([loadLibraryItems(), loadHrFeed(), loadUserModerationWarnings()]);
});

function renderRoleBadge(role) {
  const normalized = (role || "student").toLowerCase();
  if (normalized === "admin") {
    return `<span style="display:inline-block;padding:0.15rem 0.55rem;border-radius:9999px;font-size:0.68rem;font-weight:700;text-transform:uppercase;background:var(--aimser-blue-700);color:#ffffff;letter-spacing:0.04em;">ADMIN</span>`;
  }
  const isFac = normalized === "faculty";
  const bg = isFac ? "rgba(56, 189, 248, 0.16)" : "rgba(16, 185, 129, 0.16)";
  const color = isFac ? "#38bdf8" : "#10b981";
  return `<span style="display:inline-block;padding:0.15rem 0.55rem;border-radius:9999px;font-size:0.68rem;font-weight:700;text-transform:uppercase;background:${bg};color:${color};letter-spacing:0.04em;">${escapeHtml(normalized)}</span>`;
}

// 1. Load & Display Admin Moderation Warnings Issued to Current User
async function loadUserModerationWarnings() {
  const container = document.getElementById("user-warnings-container");
  if (!container || !currentUser) return;

  try {
    const q = query(collection(db, "notifications"), where("recipientUid", "==", currentUser.uid));
    const snap = await getDocs(q);
    const unreadWarnings = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((n) => !n.read && n.type === "MODERATION_WARNING");

    if (unreadWarnings.length === 0) {
      container.style.display = "none";
      container.innerHTML = "";
      return;
    }

    container.style.display = "flex";
    container.innerHTML = unreadWarnings
      .map(
        (w) => `
        <div class="glass-panel" style="border: 1px solid var(--danger); background: rgba(239, 68, 68, 0.12); padding: 1rem 1.25rem; display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 240px;">
            <div style="display: flex; align-items: center; gap: 0.5rem; color: var(--danger); font-weight: 700; font-size: 0.92rem; margin-bottom: 0.3rem;">
              <i class="fas fa-exclamation-triangle"></i>
              <span>${escapeHtml(w.title || "Administrator Policy Warning")}</span>
            </div>
            <p style="margin: 0 0 0.35rem; font-size: 0.85rem; color: var(--text-primary);">
              <strong>Moderation Notice:</strong> ${escapeHtml(w.reason || "Your comment violated HR Feed discussion guidelines.")}
            </p>
            ${
              w.commentExcerpt
                ? `<div style="font-size: 0.78rem; color: var(--text-secondary); background: var(--bg-canvas); padding: 0.45rem 0.7rem; border-radius: var(--radius-xs); border-left: 3px solid var(--danger);">
                     Moderated comment on <em>"${escapeHtml(w.postTitle || "HR Feed")}"</em>: "${escapeHtml(w.commentExcerpt)}"
                   </div>`
                : ""
            }
          </div>
          <button type="button" class="btn-secondary btn-ack-warning" data-id="${w.id}" style="padding: 0.4rem 0.85rem; font-size: 0.78rem; border-color: var(--danger); color: var(--text-primary);">
            <i class="fas fa-check"></i> Acknowledge Warning
          </button>
        </div>`
      )
      .join("");

    container.querySelectorAll(".btn-ack-warning").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await updateDoc(doc(db, "notifications", btn.dataset.id), {
            read: true,
            acknowledgedAt: serverTimestamp()
          });
          await loadUserModerationWarnings();
        } catch (err) {
          alert("Failed to dismiss warning: " + err.message);
        } finally {
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    console.warn("Moderation warnings check skipped:", err.message);
  }
}

// 2. Public HR Case Library, E-Modules & Practice Cases
async function loadLibraryItems() {
  try {
    const snap = await getDocs(collection(db, "cases"));
    allLibraryItems = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return tB - tA;
      });

    FastCache.set("hr_library_items", allLibraryItems);
    renderFilteredLibrary();
  } catch (err) {
    console.error("Failed loading HR Case Library:", err);
    allLibraryItems = [];
    renderFilteredLibrary();
  }
}

function renderFilteredLibrary() {
  const grid = document.getElementById("library-grid");
  if (!grid) return;

  const typeFilter = document.getElementById("library-type-filter")?.value || "all";
  const searchTerm = (document.getElementById("library-search")?.value || "").toLowerCase().trim();
  const role = (userProfile?.role || "student").toLowerCase();

  if (allLibraryItems.length === 0) {
    const canUpload = role === "faculty" || role === "admin";
    grid.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-book-open"></i>
        <h3>No Cases or E-Modules Published Yet</h3>
        <p>${canUpload ? 'Click "Upload Case / E-Module" above to publish learning materials to the library.' : "Faculty and administrators have not published any cases or e-modules yet."}</p>
      </div>`;
    return;
  }

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
      const canDelete = role === "faculty" || role === "admin";

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
  const role = (userProfile?.role || "student").toLowerCase();

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
    revealBox.style.display = role === "faculty" || role === "admin" ? "block" : "none";
  } else {
    practiceBox.style.display = "none";
    revealBox.style.display = "none";
  }

  openModal("modal-read-case");
}

// 3. HR Feed: Workplace Conflict Scenarios with Post & Comment Photo Attachments
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
  if (!stream || !currentUser) return;

  const isAdmin = (userProfile?.role || "").toLowerCase() === "admin";
  const searchQuery = (document.getElementById("feed-search-input")?.value || "").toLowerCase().trim();

  const visiblePosts = allFeedPosts.filter((post) => {
    const isPoster = post.authorUid === currentUser.uid;
    const isArchived = Boolean(post.archived);

    if (currentFeedView === "archived") {
      if (!isArchived) return false;
      if (!isPoster && !isAdmin) return false;
    } else {
      if (isArchived) return false;
    }

    if (!searchQuery) return true;
    return (
      (post.title || "").toLowerCase().includes(searchQuery) ||
      (post.concerns || "").toLowerCase().includes(searchQuery) ||
      (post.investigation || "").toLowerCase().includes(searchQuery) ||
      (post.resolution || "").toLowerCase().includes(searchQuery) ||
      (post.authorName || "").toLowerCase().includes(searchQuery)
    );
  });

  if (visiblePosts.length === 0) {
    const emptyTitle =
      currentFeedView === "archived"
        ? "No Archived Conflict Scenarios"
        : "No Active Workplace Conflict Scenarios";
    const emptyDesc =
      currentFeedView === "archived"
        ? "Archived posts you authored appear here."
        : "Use the form above to share a workplace conflict case, photo evidence, investigation plan, and resolution.";

    stream.innerHTML = `
      <div class="glass-panel empty-state">
        <i class="fas ${currentFeedView === "archived" ? "fa-archive" : "fa-comments"}"></i>
        <h3>${emptyTitle}</h3>
        <p>${emptyDesc}</p>
      </div>`;
    return;
  }

  stream.innerHTML = visiblePosts
    .map((post) => {
      const comments = post.comments || [];
      const ts = post.createdAt?.toDate ? post.createdAt.toDate().toLocaleString() : "Recent";
      const isPoster = post.authorUid === currentUser.uid;
      const isArchived = Boolean(post.archived);
      const safeImage = sanitizeUrl(post.imageUrl, "");

      const canModeratePost = isPoster || isAdmin;

      const moderationControlsHtml = canModeratePost
        ? `
          <div style="display:flex;align-items:center;gap:0.45rem;">
            <button type="button" class="btn-secondary btn-archive-feed-post" data-id="${post.id}" data-title="${escapeHtml(post.title || "")}" data-archived="${isArchived}" style="padding:0.32rem 0.7rem;font-size:0.75rem;">
              <i class="fas ${isArchived ? "fa-box-open" : "fa-archive"}"></i> ${isArchived ? "Unarchive" : "Archive"}
            </button>
            <button type="button" class="btn-sidebar-action btn-logout btn-del-feed-post" data-id="${post.id}" data-title="${escapeHtml(post.title || "")}" style="width:auto;padding:0.32rem 0.7rem;font-size:0.75rem;">
              <i class="fas fa-trash-alt"></i> Delete
            </button>
          </div>`
        : "";

      const imageBlockHtml = safeImage
        ? `
          <div style="margin-bottom: 1.15rem;">
            <img src="${safeImage}" alt="Supporting attachment for ${escapeHtml(post.title || "scenario")}" class="btn-open-lightbox" data-src="${safeImage}" data-title="${escapeHtml(post.title || "Attached Evidence")}" style="max-height: 320px; width: 100%; object-fit: cover; border-radius: var(--radius-sm); border: 1px solid var(--border-medium); cursor: zoom-in;" />
          </div>`
        : "";

      return `
        <article class="glass-panel" style="${isArchived ? "border-color: var(--warning); opacity: 0.92;" : ""}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:0.65rem;margin-bottom:0.85rem;">
            <div>
              <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.25rem;">
                <h3 style="font-size:1.1rem;margin:0;color:var(--text-primary);">${escapeHtml(post.title)}</h3>
                ${isArchived ? `<span class="badge-pill" style="background:rgba(245,158,11,0.18);color:var(--warning);border-color:var(--warning);">ARCHIVED</span>` : ""}
              </div>
              <div style="display:flex;align-items:center;gap:0.5rem;font-size:0.8rem;color:var(--text-secondary);">
                <strong>${escapeHtml(post.authorName || "Participant")}</strong>
                ${renderRoleBadge(post.authorRole || "student")}
                <span>• ${escapeHtml(ts)}</span>
              </div>
            </div>
            ${moderationControlsHtml}
          </div>

          ${imageBlockHtml}

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
                .map((c) => {
                  const safeCommentImg = sanitizeUrl(c.imageUrl, "");
                  const commentImgHtml = safeCommentImg
                    ? `<div style="margin-top:0.45rem;">
                         <img src="${safeCommentImg}" alt="Comment attachment" class="btn-open-lightbox" data-src="${safeCommentImg}" data-title="Comment Photo by ${escapeHtml(c.authorName || "Member")}" style="max-height:180px;max-width:100%;border-radius:var(--radius-xs);border:1px solid var(--border-medium);cursor:zoom-in;object-fit:cover;" />
                       </div>`
                    : "";

                  return `
                    <div style="padding:0.6rem 0.85rem;border-radius:var(--radius-xs);background:var(--bg-canvas);border:1px solid var(--border-subtle);font-size:0.83rem;">
                      <div style="display:flex;align-items:center;gap:0.45rem;margin-bottom:0.2rem;">
                        <strong>${escapeHtml(c.authorName || "Member")}</strong>
                        ${renderRoleBadge(c.authorRole || "student")}
                      </div>
                      ${c.text ? `<p style="margin:0;color:var(--text-primary);white-space:pre-wrap;">${escapeHtml(c.text)}</p>` : ""}
                      ${commentImgHtml}
                    </div>`;
                })
                .join("")}
            </div>

            ${
              isArchived
                ? `<div class="text-muted" style="font-size:0.78rem;font-style:italic;">This post is archived. Unarchive it to reopen comments.</div>`
                : `<form class="form-feed-comment" data-post-id="${post.id}" style="display:flex;flex-direction:column;gap:0.5rem;">
                     <div style="display:flex;gap:0.5rem;align-items:center;">
                       <input type="text" class="form-control input-feed-comment" placeholder="Share your HR analysis, legal perspective, or opinion..." style="font-size:0.83rem;flex:1;" />
                       <label class="btn-secondary" style="padding:0.45rem 0.75rem;font-size:0.8rem;cursor:pointer;margin:0;white-space:nowrap;" title="Attach Photo to Comment">
                         <i class="fas fa-camera"></i>
                         <input type="file" class="input-comment-image" accept="image/png,image/jpeg,image/webp" style="display:none;" />
                       </label>
                       <button type="submit" class="btn-secondary btn-submit-comment" style="padding:0.45rem 0.9rem;font-size:0.8rem;white-space:nowrap;">
                         <i class="fas fa-reply"></i> Comment
                       </button>
                     </div>
                     <div class="comment-preview-strip" style="display:none;align-items:center;gap:0.6rem;padding:0.4rem 0.65rem;border-radius:var(--radius-xs);background:var(--bg-surface);border:1px solid var(--border-subtle);width:fit-content;">
                       <img class="comment-preview-img" src="" alt="Comment Preview" style="height:44px;width:44px;object-fit:cover;border-radius:4px;" />
                       <span class="comment-preview-name text-muted" style="font-size:0.75rem;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>
                       <button type="button" class="btn-clear-comment-img" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.9rem;line-height:1;" title="Remove Photo">&times;</button>
                     </div>
                   </form>`
            }
          </div>
        </article>`;
    })
    .join("");

  // Lightbox Image Click (Posts & Comments)
  stream.querySelectorAll(".btn-open-lightbox").forEach((img) => {
    img.addEventListener("click", () => {
      document.getElementById("lightbox-title").textContent = img.dataset.title || "Attached Evidence";
      document.getElementById("lightbox-img").src = img.dataset.src;
      openModal("modal-image-lightbox");
    });
  });

  // Archive / Unarchive Handler
  stream.querySelectorAll(".btn-archive-feed-post").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const postId = btn.dataset.id;
      const postTitle = btn.dataset.title;
      const currentlyArchived = btn.dataset.archived === "true";
      const targetPost = allFeedPosts.find((p) => p.id === postId);

      if (!targetPost) return;
      if (targetPost.authorUid !== currentUser.uid && (userProfile?.role || "").toLowerCase() !== "admin") {
        alert("Permission denied: Only the original poster or an Administrator can archive this post.");
        return;
      }

      btn.disabled = true;
      try {
        const nextArchivedState = !currentlyArchived;
        await updateDoc(doc(db, "hr_feed", postId), {
          archived: nextArchivedState,
          archivedAt: nextArchivedState ? serverTimestamp() : null,
          archivedBy: nextArchivedState ? currentUser.email : null
        });

        await logAuditEvent(
          `${nextArchivedState ? "Archived" : "Unarchived"} HR Feed post "${postTitle}" [${userProfile.role}]`,
          "HR_FEED",
          currentUser.email
        );
        await loadHrFeed();
      } catch (err) {
        alert("Unable to update archive status: " + err.message);
      } finally {
        btn.disabled = false;
      }
    });
  });

  // Delete Handler
  stream.querySelectorAll(".btn-del-feed-post").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const postId = btn.dataset.id;
      const postTitle = btn.dataset.title;
      const targetPost = allFeedPosts.find((p) => p.id === postId);

      if (!targetPost) return;
      if (targetPost.authorUid !== currentUser.uid && (userProfile?.role || "").toLowerCase() !== "admin") {
        alert("Permission denied: Only the original poster or an Administrator can delete this post.");
        return;
      }

      if (!confirm(`Permanently delete "${postTitle}"? This action cannot be undone.`)) return;

      btn.disabled = true;
      try {
        await deleteDoc(doc(db, "hr_feed", postId));
        await logAuditEvent(
          `Deleted HR Feed post "${postTitle}" [${userProfile.role}]`,
          "HR_FEED",
          currentUser.email
        );
        await loadHrFeed();
      } catch (err) {
        alert("Unable to delete post: " + err.message);
      } finally {
        btn.disabled = false;
      }
    });
  });

  // Comment Photo Preview, Clear & Submit Handlers
  stream.querySelectorAll(".form-feed-comment").forEach((form) => {
    const fileInput = form.querySelector(".input-comment-image");
    const previewStrip = form.querySelector(".comment-preview-strip");
    const previewImg = form.querySelector(".comment-preview-img");
    const previewName = form.querySelector(".comment-preview-name");
    const clearBtn = form.querySelector(".btn-clear-comment-img");

    if (fileInput && previewStrip && previewImg && previewName) {
      fileInput.addEventListener("change", () => {
        const file = fileInput.files[0];
        if (!file) {
          previewStrip.style.display = "none";
          return;
        }
        if (!file.type.startsWith("image/")) {
          alert("Please select a valid image file (PNG, JPG, or WebP).");
          fileInput.value = "";
          previewStrip.style.display = "none";
          return;
        }
        previewImg.src = URL.createObjectURL(file);
        previewName.textContent = file.name;
        previewStrip.style.display = "flex";
      });
    }

    if (clearBtn && fileInput && previewStrip) {
      clearBtn.addEventListener("click", () => {
        fileInput.value = "";
        if (previewImg) previewImg.src = "";
        previewStrip.style.display = "none";
      });
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const postId = form.dataset.postId;
      const input = form.querySelector(".input-feed-comment");
      const submitBtn = form.querySelector(".btn-submit-comment");
      const text = input.value.trim();
      const imageFile = fileInput?.files?.[0] || null;

      if (!text && !imageFile) {
        alert("Please write a comment or attach a photo.");
        return;
      }

      input.disabled = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = imageFile
          ? '<i class="fas fa-spinner fa-spin"></i> Uploading...'
          : '<i class="fas fa-spinner fa-spin"></i> Posting...';
      }

      try {
        checkRateLimit("feed_comment", 10, 60000);

        let commentImageUrl = "";
        if (imageFile) {
          commentImageUrl = await uploadToCloudinary(imageFile, "aimser/hr-feed-comments");
        }

        await updateDoc(doc(db, "hr_feed", postId), {
          comments: arrayUnion({
            authorUid: currentUser.uid,
            authorName: userProfile.fullName,
            authorEmail: currentUser.email,
            authorRole: userProfile.role,
            text,
            imageUrl: commentImageUrl,
            createdAt: new Date().toISOString()
          })
        });

        input.value = "";
        if (fileInput) fileInput.value = "";
        if (previewStrip) previewStrip.style.display = "none";
        await loadHrFeed();
      } catch (err) {
        alert(err.message);
      } finally {
        input.disabled = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<i class="fas fa-reply"></i> Comment';
        }
      }
    });
  });
}

// 4. Event Bindings & Photo Preview
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

  document.querySelectorAll(".feed-view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentFeedView = btn.dataset.feedView;
      document.querySelectorAll(".feed-view-btn").forEach((b) => {
        const isCurrent = b.dataset.feedView === currentFeedView;
        b.classList.toggle("active", isCurrent);
        b.style.borderColor = isCurrent ? "var(--aimser-blue-500)" : "var(--border-medium)";
      });
      renderFeedStream();
    });
  });

  document.getElementById("feed-search-input")?.addEventListener("input", renderFeedStream);

  const feedImgInput = document.getElementById("feed-image-input");
  const clearImgBtn = document.getElementById("btn-clear-feed-image");
  const previewBox = document.getElementById("feed-image-preview-box");
  const previewImg = document.getElementById("feed-image-preview");

  if (feedImgInput) {
    feedImgInput.addEventListener("change", () => {
      const file = feedImgInput.files[0];
      if (!file) {
        previewBox.style.display = "none";
        clearImgBtn.style.display = "none";
        return;
      }
      if (!file.type.startsWith("image/")) {
        alert("Please select a valid image file (PNG, JPG, or WebP).");
        feedImgInput.value = "";
        return;
      }
      previewImg.src = URL.createObjectURL(file);
      previewBox.style.display = "block";
      clearImgBtn.style.display = "inline-flex";
    });
  }

  if (clearImgBtn) {
    clearImgBtn.addEventListener("click", () => {
      if (feedImgInput) feedImgInput.value = "";
      previewImg.src = "";
      previewBox.style.display = "none";
      clearImgBtn.style.display = "none";
    });
  }

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

    if (activeCaseItem) {
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
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publishing...';

    try {
      checkRateLimit("create_feed_post", 6, 60000);

      let uploadedImageUrl = "";
      if (feedImgInput && feedImgInput.files.length > 0) {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading Photo...';
        uploadedImageUrl = await uploadToCloudinary(feedImgInput.files[0], "aimser/hr-feed");
      }

      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving Scenario...';
      await addDoc(collection(db, "hr_feed"), {
        title,
        concerns,
        investigation,
        resolution,
        imageUrl: uploadedImageUrl,
        authorUid: currentUser.uid,
        authorName: userProfile.fullName,
        authorEmail: currentUser.email,
        authorRole: userProfile.role,
        archived: false,
        comments: [],
        createdAt: serverTimestamp()
      });

      await logAuditEvent(`Posted workplace conflict scenario "${title}" [${userProfile.role}]`, "HR_FEED", currentUser.email);
      e.target.reset();
      if (previewBox) previewBox.style.display = "none";
      if (clearImgBtn) clearImgBtn.style.display = "none";
      currentFeedView = "active";
      await loadHrFeed();
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-paper-plane"></i> Publish Conflict Scenario to HR Feed';
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