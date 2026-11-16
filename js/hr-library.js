// js/hr-library.js - Public HR Case Library, Direct Document Upload, Facebook-Style HR Feed & Bell Notifications
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
let unreadModerationWarnings = [];

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
    if (uploadBtn) uploadBtn.classList.remove("is-hidden");
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
  renderLibraryBellNotifications();
});

function renderRoleBadge(role) {
  const normalized = (role || "student").toLowerCase();
  if (normalized === "admin") {
    return `<span class="badge-pill role-pill-admin">ADMIN</span>`;
  }
  const isFac = normalized === "faculty";
  return `<span class="badge-pill ${isFac ? "role-pill-faculty" : "role-pill-student"}">${escapeHtml(normalized.toUpperCase())}</span>`;
}

async function loadUserModerationWarnings() {
  const container = document.getElementById("user-warnings-container");
  if (!container || !currentUser) return;

  try {
    const q = query(collection(db, "notifications"), where("recipientUid", "==", currentUser.uid));
    const snap = await getDocs(q);
    unreadModerationWarnings = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((n) => !n.read && n.type === "MODERATION_WARNING");

    if (unreadModerationWarnings.length === 0) {
      container.classList.add("is-hidden");
      container.innerHTML = "";
      return;
    }

    container.classList.remove("is-hidden");
    container.innerHTML = unreadModerationWarnings
      .map(
        (w) => `
        <div class="glass-panel submission-lock-banner panel-toolbar">
          <div>
            <strong><i class="fas fa-exclamation-triangle"></i> ${escapeHtml(w.title || "Administrator Policy Warning")}</strong>
            <p class="text-muted">
              <strong>Moderation Notice:</strong> ${escapeHtml(w.reason || "Your comment violated HR Feed discussion guidelines.")}
            </p>
            ${
              w.commentExcerpt
                ? `<div class="faculty-sub-notes">Moderated comment on "${escapeHtml(w.postTitle || "HR Feed")}": "${escapeHtml(w.commentExcerpt)}"</div>`
                : ""
            }
          </div>
          <button type="button" class="btn-secondary btn-ack-warning" data-id="${w.id}">
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
          renderLibraryBellNotifications();
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

function renderLibraryBellNotifications() {
  const badge = document.getElementById("notif-badge");
  const list = document.getElementById("notifications-feed-list");
  if (!list) return;

  const recentFeedAlerts = allFeedPosts.slice(0, 4).map((p) => ({
    title: `HR Feed: ${p.title || "Workplace Scenario"}`,
    type: "FORUM",
    detail: `Posted by ${p.authorName || "Member"} • ${(p.comments || []).length} comment(s)`
  }));

  const warningItems = unreadModerationWarnings.map((w) => ({
    title: w.title || "Moderation Warning",
    type: "WARNING",
    detail: w.reason || "Please review community guidelines."
  }));

  const combined = [...warningItems, ...recentFeedAlerts];

  if (badge) {
    if (warningItems.length > 0) {
      badge.style.display = "inline-block";
      badge.textContent = warningItems.length;
    } else {
      badge.style.display = "none";
    }
  }

  if (combined.length === 0) {
    list.innerHTML = `<div class="empty-state"><i class="fas fa-bell-slash"></i><h3>No Active Alerts</h3><p>Forum updates and moderation notices appear here.</p></div>`;
    return;
  }

  list.innerHTML = combined
    .map(
      (item) => `
      <div class="inspector-meta-item">
        <div class="panel-toolbar">
          <strong>${escapeHtml(item.title)}</strong>
          <span class="badge-pill">${escapeHtml(item.type)}</span>
        </div>
        <p class="text-muted">${escapeHtml(item.detail)}</p>
      </div>`
    )
    .join("");
}

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
        <article class="glass-panel">
          <div>
            <div class="panel-toolbar">
              <span class="badge-pill">${escapeHtml(itemType)}</span>
              <div class="user-cell-flex">
                ${hasAnswerKey ? `<span class="badge-pill role-pill-student"><i class="fas fa-key"></i> Key to Correct</span>` : ""}
                ${canDelete ? `<button type="button" class="btn-close-modal btn-del-case" data-id="${item.id}" title="Remove Material"><i class="fas fa-trash-alt"></i></button>` : ""}
              </div>
            </div>
            <h3>${escapeHtml(item.title)}</h3>
            <div class="user-cell-flex text-muted">
              <span>By ${escapeHtml(item.authorName || "Faculty")}</span>
              ${renderRoleBadge(item.authorRole || "faculty")}
            </div>
            <p class="text-muted">
              ${escapeHtml(item.body)}
            </p>
          </div>

          <div class="card-footer-bar">
            <span class="text-muted">${item.fileName ? `<i class="fas fa-paperclip"></i> ${escapeHtml(item.fileName)}` : "Case Material"}</span>
            <button type="button" class="btn-secondary btn-open-case-reader" data-id="${item.id}">
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
  document.getElementById("read-case-author").innerHTML = `Uploaded by <strong>${escapeHtml(item.authorName || "Faculty")}</strong> ${renderRoleBadge(item.authorRole || "faculty")}`;
  document.getElementById("read-case-body").textContent = item.body || "";

  const dlBtn = document.getElementById("read-case-download-btn");
  const safeHref = sanitizeUrl(item.downloadUrl, "");
  if (dlBtn) {
    if (safeHref) {
      dlBtn.href = safeHref;
      dlBtn.classList.remove("is-hidden");
    } else {
      dlBtn.classList.add("is-hidden");
    }
  }

  const practiceBox = document.getElementById("practice-case-interactive-box");
  const revealBox = document.getElementById("answer-key-reveal-box");
  const answerInput = document.getElementById("practice-student-answer");
  const keyText = document.getElementById("read-case-answer-key");

  if (itemType === "Practice Case" && item.answerKey) {
    practiceBox?.classList.remove("is-hidden");
    answerInput.value = "";
    keyText.textContent = item.answerKey;
    revealBox?.classList.toggle("is-hidden", !(role === "faculty" || role === "admin"));
  } else {
    practiceBox?.classList.add("is-hidden");
    revealBox?.classList.add("is-hidden");
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
    renderLibraryBellNotifications();
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
        : "Use the post composer above to share a workplace conflict scenario, PNG diagram, or resolution.";

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
          <div class="workspace-action-bar">
            <button type="button" class="btn-secondary btn-archive-feed-post" data-id="${post.id}" data-title="${escapeHtml(post.title || "")}" data-archived="${isArchived}">
              <i class="fas ${isArchived ? "fa-box-open" : "fa-archive"}"></i> ${isArchived ? "Unarchive" : "Archive"}
            </button>
            <button type="button" class="btn-sidebar-action btn-logout btn-del-feed-post" data-id="${post.id}" data-title="${escapeHtml(post.title || "")}">
              <i class="fas fa-trash-alt"></i> Delete
            </button>
          </div>`
        : "";

      const imageBlockHtml = safeImage
        ? `<img src="${safeImage}" alt="Supporting attachment for ${escapeHtml(post.title || "scenario")}" class="admin-post-image btn-open-lightbox" data-src="${safeImage}" data-title="${escapeHtml(post.title || "Attached Evidence")}" />`
        : "";

      return `
        <article class="glass-panel ${isArchived ? "card-archived-border" : ""}">
          <div class="panel-toolbar">
            <div class="user-cell-flex">
              <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(post.authorName || "Member")}&background=1b5375&color=faf2dd" alt="" class="avatar-sm" />
              <div>
                <div class="user-cell-flex">
                  <strong>${escapeHtml(post.authorName || "Participant")}</strong>
                  ${renderRoleBadge(post.authorRole || "student")}
                  ${isArchived ? `<span class="badge-pill status-pill-archived">ARCHIVED</span>` : ""}
                </div>
                <span class="text-muted">${escapeHtml(ts)}</span>
              </div>
            </div>
            ${moderationControlsHtml}
          </div>

          <h3>${escapeHtml(post.title)}</h3>

          <div class="admin-post-grid">
            <div class="inspector-meta-item">
              <span>Workplace Concerns</span>
              <p>${escapeHtml(post.concerns || "")}</p>
            </div>
            <div class="inspector-meta-item">
              <span>Investigation Plan</span>
              <p>${escapeHtml(post.investigation || "")}</p>
            </div>
            <div class="inspector-meta-item">
              <span>Recommended Resolution</span>
              <p>${escapeHtml(post.resolution || "")}</p>
            </div>
          </div>

          ${imageBlockHtml}

          <div class="card-footer-bar">
            <div class="w-full">
              <p class="text-muted">
                <i class="far fa-comment-dots"></i> Comments (${comments.length})
              </p>

              <div class="admin-comments-stack">
                ${comments
                  .map((c) => {
                    const safeCommentImg = sanitizeUrl(c.imageUrl, "");
                    const commentImgHtml = safeCommentImg
                      ? `<img src="${safeCommentImg}" alt="Comment attachment" class="admin-comment-image btn-open-lightbox" data-src="${safeCommentImg}" data-title="Comment Photo by ${escapeHtml(c.authorName || "Member")}" />`
                      : "";

                    return `
                      <div class="admin-comment-row">
                        <div>
                          <div class="user-cell-flex">
                            <strong>${escapeHtml(c.authorName || "Member")}</strong>
                            ${renderRoleBadge(c.authorRole || "student")}
                          </div>
                          ${c.text ? `<p>${escapeHtml(c.text)}</p>` : ""}
                          ${commentImgHtml}
                        </div>
                      </div>`;
                  })
                  .join("")}
              </div>

              ${
                isArchived
                  ? `<div class="text-muted">This post is archived. Unarchive it to reopen comments.</div>`
                  : `<form class="form-feed-comment" data-post-id="${post.id}">
                       <div class="workspace-action-bar">
                         <input type="text" class="form-control input-feed-comment" placeholder="Write a comment..." />
                         <label class="btn-secondary" title="Attach PNG/JPG Photo">
                           <i class="fas fa-camera"></i>
                           <input type="file" class="input-comment-image is-hidden" accept="image/png,image/jpeg,image/webp" />
                         </label>
                         <button type="submit" class="btn-secondary btn-submit-comment">
                           <i class="fas fa-reply"></i> Comment
                         </button>
                       </div>
                       <div class="comment-preview-strip reply-preview-strip">
                         <img class="comment-preview-img reply-preview-thumb" src="" alt="Comment Preview" />
                         <span class="comment-preview-name text-muted"></span>
                         <button type="button" class="btn-clear-comment-img btn-close-modal" title="Remove Photo">&times;</button>
                       </div>
                     </form>`
              }
            </div>
          </div>
        </article>`;
    })
    .join("");

  stream.querySelectorAll(".btn-open-lightbox").forEach((img) => {
    img.addEventListener("click", () => {
      document.getElementById("lightbox-title").textContent = img.dataset.title || "Attached Evidence";
      document.getElementById("lightbox-img").src = img.dataset.src;
      openModal("modal-image-lightbox");
    });
  });

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
          previewStrip.classList.remove("is-visible");
          return;
        }
        if (!file.type.startsWith("image/")) {
          alert("Please select a valid image file (PNG, JPG, or WebP).");
          fileInput.value = "";
          previewStrip.classList.remove("is-visible");
          return;
        }
        previewImg.src = URL.createObjectURL(file);
        previewName.textContent = file.name;
        previewStrip.classList.add("is-visible");
      });
    }

    if (clearBtn && fileInput && previewStrip) {
      clearBtn.addEventListener("click", () => {
        fileInput.value = "";
        if (previewImg) previewImg.src = "";
        previewStrip.classList.remove("is-visible");
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
        if (previewStrip) previewStrip.classList.remove("is-visible");
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

function bindLibraryAndFeedEvents() {
  document.getElementById("library-type-filter")?.addEventListener("change", renderFilteredLibrary);
  document.getElementById("library-search")?.addEventListener("input", renderFilteredLibrary);

  document.querySelectorAll(".feed-view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentFeedView = btn.dataset.feedView;
      document.querySelectorAll(".feed-view-btn").forEach((b) => {
        const isCurrent = b.dataset.feedView === currentFeedView;
        b.classList.toggle("active", isCurrent);
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
        previewBox?.classList.add("is-hidden");
        clearImgBtn?.classList.add("is-hidden");
        return;
      }
      if (!file.type.startsWith("image/")) {
        alert("Please select a valid image file (PNG, JPG, or WebP).");
        feedImgInput.value = "";
        return;
      }
      previewImg.src = URL.createObjectURL(file);
      previewBox?.classList.remove("is-hidden");
      clearImgBtn?.classList.remove("is-hidden");
    });
  }

  if (clearImgBtn) {
    clearImgBtn.addEventListener("click", () => {
      if (feedImgInput) feedImgInput.value = "";
      previewImg.src = "";
      previewBox?.classList.add("is-hidden");
      clearImgBtn?.classList.add("is-hidden");
    });
  }

  document.getElementById("btn-open-case-modal")?.addEventListener("click", () => openModal("modal-case"));

  document.getElementById("form-create-case")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-case");
    const type = document.getElementById("case-type").value;
    const title = document.getElementById("case-title").value.trim();
    const fileInput = document.getElementById("case-file-input");
    const selectedFile = fileInput?.files?.[0] || null;
    const typedUrl = sanitizeUrl(document.getElementById("case-download-url").value.trim(), "");
    const body = document.getElementById("case-body").value.trim();
    const answerKey = document.getElementById("case-answer-key").value.trim();

    btn.disabled = true;
    btn.innerHTML = selectedFile
      ? '<i class="fas fa-spinner fa-spin"></i> Uploading File...'
      : '<i class="fas fa-spinner fa-spin"></i> Submitting...';

    try {
      checkRateLimit("upload_case", 6, 60000);

      let downloadUrl = typedUrl;
      let fileName = "";
      if (selectedFile) {
        downloadUrl = await uploadToCloudinary(selectedFile, "aimser/hr-library");
        fileName = selectedFile.name;
      }

      await addDoc(collection(db, "cases"), {
        type,
        category: type,
        title,
        downloadUrl,
        fileName,
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
      btn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Submit';
    }
  });

  document.getElementById("btn-submit-practice-answer")?.addEventListener("click", async () => {
    const answer = document.getElementById("practice-student-answer").value.trim();
    if (!answer) {
      alert("Write your practice case analysis first before revealing the Key to Correct.");
      return;
    }

    document.getElementById("answer-key-reveal-box")?.classList.remove("is-hidden");

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
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Posting...';

    try {
      checkRateLimit("create_feed_post", 6, 60000);

      let uploadedImageUrl = "";
      if (feedImgInput && feedImgInput.files.length > 0) {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading Photo...';
        uploadedImageUrl = await uploadToCloudinary(feedImgInput.files[0], "aimser/hr-feed");
      }

      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
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
      previewBox?.classList.add("is-hidden");
      clearImgBtn?.classList.add("is-hidden");
      currentFeedView = "active";
      await loadHrFeed();
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-paper-plane"></i> Post';
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