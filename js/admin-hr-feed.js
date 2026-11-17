// js/admin-hr-feed.js - Isolated Admin HR Feed View, Facebook-Style Cards, PNG Support & Bell Notifications
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
import { uploadToCloudinary } from "./cloudinary-config.js";
import { FastCache, escapeHtml, sanitizeUrl, checkRateLimit, logAuditEvent } from "./security-utils.js";

let currentAdminUser = null;
let adminProfile = null;
let allPosts = [];
let activeStatusFilter = "all";

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindAdminFeedEvents);
} else {
  bindAdminFeedEvents();
}

onAuthStateChanged(auth, async (user) => {
  bindAdminFeedEvents();

  if (!user) {
    window.location.replace("login.html");
    return;
  }

  try {
    const cached = FastCache.get("user_profile");
    if (cached && (cached.role || "").toLowerCase() === "admin") {
      adminProfile = cached;
      renderAdminHeader(user, cached);
    }

    const snap = await getDoc(doc(db, "users", user.uid));
    const data = snap.exists() ? snap.data() : {};
    const role = (data.role || "").toLowerCase();

    if (role !== "admin") {
      alert("Unauthorized Access: Administrator clearance required.");
      window.location.replace("hr-library.html");
      return;
    }

    currentAdminUser = user;
    adminProfile = {
      uid: user.uid,
      email: user.email,
      fullName: data.fullName || user.displayName || "Administrator",
      role: "admin",
      avatarUrl: data.avatarUrl || user.photoURL || ""
    };

    renderAdminHeader(user, adminProfile);

    const cachedFeed = FastCache.get("admin_feed_posts");
    if (cachedFeed) {
      allPosts = cachedFeed;
      updateFeedKPIs();
      renderAdminFeedStream();
      renderAdminFeedNotificationsBell();
    }

    await loadFeedFromFirestore();
  } catch (err) {
    console.error("Admin HR Feed init error:", err);
  }
});

function renderAdminHeader(user, data) {
  const nameEl = document.getElementById("header-user-name");
  const roleEl = document.getElementById("header-user-role");
  const avatarEl = document.getElementById("header-user-avatar");

  const name = data.fullName || user.displayName || "Administrator";
  const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=1b5375&color=faf2dd`;

  if (nameEl) nameEl.textContent = name;
  if (roleEl) roleEl.textContent = "SYSTEM ADMIN";
  if (avatarEl) avatarEl.src = sanitizeUrl(data.avatarUrl || user.photoURL, fallback);
}

function renderRoleBadge(role) {
  const normalized = (role || "student").toLowerCase();
  if (normalized === "admin") {
    return `<span class="badge-pill role-pill-admin">ADMIN</span>`;
  }
  if (normalized === "faculty") {
    return `<span class="badge-pill role-pill-faculty">FACULTY</span>`;
  }
  return `<span class="badge-pill role-pill-student">STUDENT</span>`;
}

function renderAdminFeedNotificationsBell() {
  const badge = document.getElementById("notif-badge");
  const list = document.getElementById("notifications-feed-list");
  if (!list) return;

  const recentPosts = allPosts.slice(0, 6);

  if (badge) {
    if (recentPosts.length > 0) {
      badge.style.display = "inline-block";
      badge.textContent = recentPosts.length;
    } else {
      badge.style.display = "none";
    }
  }

  if (recentPosts.length === 0) {
    list.innerHTML = `<div class="empty-state"><i class="fas fa-bell-slash"></i><h3>No Active Feed Alerts</h3><p>Workplace scenarios and comments appear here.</p></div>`;
    return;
  }

  list.innerHTML = recentPosts
    .map((p) => {
      const commentCount = (p.comments || []).length;
      return `
        <div class="inspector-meta-item">
          <div class="panel-toolbar">
            <strong>${escapeHtml(p.title || "Workplace Scenario")}</strong>
            <span class="badge-pill">${commentCount} comment(s)</span>
          </div>
          <p class="text-muted">By ${escapeHtml(p.authorName || "Member")} • ${escapeHtml(p.concerns || "")}</p>
        </div>`;
    })
    .join("");
}

async function loadFeedFromFirestore() {
  const stream = document.getElementById("admin-hr-feed-stream");
  try {
    let snap;
    try {
      snap = await getDocs(query(collection(db, "hr_feed"), orderBy("createdAt", "desc")));
    } catch {
      snap = await getDocs(collection(db, "hr_feed"));
    }

    allPosts = snap.docs
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

    FastCache.set("admin_feed_posts", allPosts);
    updateFeedKPIs();
    renderAdminFeedStream();
    renderAdminFeedNotificationsBell();
  } catch (err) {
    console.error("Error loading hr_feed:", err);
    if (stream) {
      stream.innerHTML = `
        <div class="glass-panel empty-state">
          <i class="fas fa-exclamation-triangle"></i>
          <h3>Unable to Load HR Feed</h3>
          <p>${escapeHtml(err.message)}</p>
        </div>`;
    }
  }
}

function updateFeedKPIs() {
  const total = allPosts.length;
  const archived = allPosts.filter((p) => Boolean(p.archived)).length;
  const active = total - archived;
  const comments = allPosts.reduce((sum, p) => sum + (p.comments || []).length, 0);

  document.getElementById("feed-stat-total").textContent = total.toLocaleString();
  document.getElementById("feed-stat-active").textContent = active.toLocaleString();
  document.getElementById("feed-stat-archived").textContent = archived.toLocaleString();
  document.getElementById("feed-stat-comments").textContent = comments.toLocaleString();
}

function renderAdminFeedStream() {
  const stream = document.getElementById("admin-hr-feed-stream");
  if (!stream) return;

  const queryTerm = (document.getElementById("admin-feed-search")?.value || "").toLowerCase().trim();

  const filtered = allPosts.filter((post) => {
    const isArchived = Boolean(post.archived);
    if (activeStatusFilter === "active" && isArchived) return false;
    if (activeStatusFilter === "archived" && !isArchived) return false;

    if (!queryTerm) return true;
    return (
      (post.title || "").toLowerCase().includes(queryTerm) ||
      (post.authorName || "").toLowerCase().includes(queryTerm) ||
      (post.authorEmail || "").toLowerCase().includes(queryTerm) ||
      (post.concerns || "").toLowerCase().includes(queryTerm) ||
      (post.investigation || "").toLowerCase().includes(queryTerm) ||
      (post.resolution || "").toLowerCase().includes(queryTerm)
    );
  });

  if (filtered.length === 0) {
    stream.innerHTML = `
      <div class="glass-panel empty-state">
        <i class="fas fa-comments"></i>
        <h3>No HR Feed Posts Found</h3>
        <p>No workplace conflict scenarios match your current filter.</p>
      </div>`;
    return;
  }

  stream.innerHTML = filtered
    .map((post) => {
      const isArchived = Boolean(post.archived);
      const comments = post.comments || [];
      const dateStr = post.tsMillis ? new Date(post.tsMillis).toLocaleString() : "Recent";
      const safeImage = sanitizeUrl(post.imageUrl, "");

      const statusBadge = isArchived
        ? `<span class="badge-pill status-pill-archived">ARCHIVED</span>`
        : `<span class="badge-pill status-pill-active">ACTIVE</span>`;

      const imageBlockHtml = safeImage
        ? `<img src="${safeImage}" alt="Attached evidence" class="admin-post-image btn-open-lightbox" data-src="${safeImage}" data-title="${escapeHtml(post.title || "Attached Evidence")}" />`
        : "";

      return `
        <article class="glass-panel ${isArchived ? "card-archived-border" : ""}">
          <!-- Facebook-Style Post Header & Moderation Actions -->
          <div class="panel-toolbar">
            <div class="user-cell-flex">
              <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(post.authorName || "Participant")}&background=1b5375&color=faf2dd" alt="" class="avatar-sm" />
              <div>
                <div class="user-cell-flex">
                  <strong>${escapeHtml(post.authorName || "Participant")}</strong>
                  ${renderRoleBadge(post.authorRole || "student")}
                  ${statusBadge}
                </div>
                <span class="text-muted">${escapeHtml(post.authorEmail || "")} • ${escapeHtml(dateStr)}</span>
              </div>
            </div>

            <div class="workspace-action-bar">
              <button type="button" class="btn-secondary btn-toggle-archive" data-id="${post.id}" data-title="${escapeHtml(post.title || "")}" data-archived="${isArchived}">
                <i class="fas ${isArchived ? "fa-box-open" : "fa-archive"}"></i> ${isArchived ? "Unarchive" : "Archive"}
              </button>
              <button type="button" class="btn-sidebar-action btn-logout btn-delete-post" data-id="${post.id}" data-title="${escapeHtml(post.title || "")}">
                <i class="fas fa-trash-alt"></i> Delete Post
              </button>
            </div>
          </div>

          <h3>${escapeHtml(post.title || "Untitled Scenario")}</h3>

          <!-- 3-Column Scenario Breakdown -->
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

          <!-- Comments Thread with Photo Display, Warn & Minimal Grey Trash Delete Icon -->
          <div class="card-footer-bar">
            <div class="w-full">
              <p class="text-muted">
                <i class="far fa-comment-dots"></i> Discussion &amp; Opinions (${comments.length})
              </p>

              <div class="admin-comments-stack">
                ${comments
                  .map((c, idx) => {
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
                            ${c.moderatedWarning ? `<span class="badge-pill status-pill-archived"><i class="fas fa-exclamation-triangle"></i> Warned</span>` : ""}
                          </div>
                          ${c.text ? `<p>${escapeHtml(c.text)}</p>` : ""}
                          ${commentImgHtml}
                        </div>
                        <div class="workspace-action-bar">
                          <button type="button" class="btn-secondary btn-open-mod-comment" data-post-id="${post.id}" data-idx="${idx}" title="Moderate Comment & Send Warning">
                            <i class="fas fa-exclamation-triangle"></i> Warn &amp; Moderate
                          </button>
                          <button type="button" class="btn-card-icon btn-del-comment" data-post-id="${post.id}" data-idx="${idx}" title="Delete Comment">
                            <i class="fas fa-trash"></i>
                          </button>
                        </div>
                      </div>`;
                  })
                  .join("")}
              </div>

              <form class="form-admin-reply" data-post-id="${post.id}">
                <div class="workspace-action-bar">
                  <input type="text" class="form-control input-admin-reply" placeholder="Post an official administrator note or guidance..." />
                  <label class="btn-secondary" title="Attach Photo to Admin Reply">
                    <i class="fas fa-camera"></i>
                    <input type="file" class="input-admin-reply-image is-hidden" accept="image/png,image/jpeg,image/webp" />
                  </label>
                  <button type="submit" class="btn-secondary btn-submit-admin-reply">
                    <i class="fas fa-reply"></i> Reply as Admin
                  </button>
                </div>
                <div class="admin-reply-preview-strip reply-preview-strip">
                  <img class="admin-reply-preview-img reply-preview-thumb" src="" alt="Reply Preview" />
                  <span class="admin-reply-preview-name text-muted"></span>
                  <button type="button" class="btn-clear-admin-reply-img btn-close-modal" title="Remove Photo">&times;</button>
                </div>
              </form>
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

  stream.querySelectorAll(".btn-toggle-archive").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const postId = btn.dataset.id;
      const postTitle = btn.dataset.title;
      const nextState = btn.dataset.archived !== "true";

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
        await loadFeedFromFirestore();
      } catch (err) {
        alert("Failed to update archive status: " + err.message);
      } finally {
        btn.disabled = false;
      }
    });
  });

  stream.querySelectorAll(".btn-delete-post").forEach((btn) => {
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
        await loadFeedFromFirestore();
      } catch (err) {
        alert("Failed to delete post: " + err.message);
      } finally {
        btn.disabled = false;
      }
    });
  });

  stream.querySelectorAll(".btn-open-mod-comment").forEach((btn) => {
    btn.addEventListener("click", () => {
      const postId = btn.dataset.postId;
      const idx = Number(btn.dataset.idx);
      const post = allPosts.find((p) => p.id === postId);
      const comment = post?.comments?.[idx];
      if (!post || !comment) return;

      document.getElementById("mod-post-id").value = postId;
      document.getElementById("mod-comment-idx").value = idx;
      document.getElementById("mod-target-user").value = `${comment.authorName || "Member"} (${comment.authorRole || "student"})`;
      const excerptLabel = `${comment.text || ""}${comment.imageUrl ? (comment.text ? " [Attached Photo]" : "[Attached Photo]") : ""}`;
      document.getElementById("mod-comment-excerpt").textContent = excerptLabel;
      document.getElementById("mod-action-type").value = "delete_and_warn";
      document.getElementById("mod-preset-reason").selectedIndex = 0;
      document.getElementById("mod-warning-message").value =
        `Your comment on "${post.title}" was moderated due to unprofessional or inappropriate content. Please keep discussions constructive and aligned with HR simulation standards.`;

      openModal("modal-moderate-comment");
    });
  });

  stream.querySelectorAll(".btn-del-comment").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const postId = btn.dataset.postId;
      const idx = Number(btn.dataset.idx);
      const targetPost = allPosts.find((p) => p.id === postId);
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
        await loadFeedFromFirestore();
      } catch (err) {
        alert("Failed to delete comment: " + err.message);
      } finally {
        btn.disabled = false;
      }
    });
  });

  stream.querySelectorAll(".form-admin-reply").forEach((form) => {
    const fileInput = form.querySelector(".input-admin-reply-image");
    const previewStrip = form.querySelector(".admin-reply-preview-strip");
    const previewImg = form.querySelector(".admin-reply-preview-img");
    const previewName = form.querySelector(".admin-reply-preview-name");
    const clearBtn = form.querySelector(".btn-clear-admin-reply-img");

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
      const input = form.querySelector(".input-admin-reply");
      const submitBtn = form.querySelector(".btn-submit-admin-reply");
      const text = input.value.trim();
      const imageFile = fileInput?.files?.[0] || null;

      if (!text && !imageFile) {
        alert("Please write a reply or attach a photo.");
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
        checkRateLimit("admin_feed_reply", 15, 60000);

        let replyImageUrl = "";
        if (imageFile) {
          replyImageUrl = await uploadToCloudinary(imageFile, "aimser/hr-feed-comments");
        }

        await updateDoc(doc(db, "hr_feed", postId), {
          comments: arrayUnion({
            authorUid: currentAdminUser.uid,
            authorName: adminProfile.fullName,
            authorEmail: currentAdminUser.email,
            authorRole: "admin",
            text,
            imageUrl: replyImageUrl,
            createdAt: new Date().toISOString()
          })
        });

        input.value = "";
        if (fileInput) fileInput.value = "";
        if (previewStrip) previewStrip.classList.remove("is-visible");
        sessionStorage.removeItem("aimser_v2_hr_feed_posts");
        await loadFeedFromFirestore();
      } catch (err) {
        alert(err.message);
      } finally {
        input.disabled = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<i class="fas fa-reply"></i> Reply as Admin';
        }
      }
    });
  });
}

function bindAdminFeedEvents() {
  document.querySelectorAll(".feed-status-tab").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "true";
    btn.addEventListener("click", () => {
      activeStatusFilter = btn.dataset.status;
      document.querySelectorAll(".feed-status-tab").forEach((b) => {
        const isCurrent = b.dataset.status === activeStatusFilter;
        b.classList.toggle("active", isCurrent);
      });
      renderAdminFeedStream();
    });
  });

  const searchEl = document.getElementById("admin-feed-search");
  if (searchEl && !searchEl.dataset.bound) {
    searchEl.dataset.bound = "true";
    searchEl.addEventListener("input", renderAdminFeedStream);
  }

  const refreshEl = document.getElementById("btn-refresh-admin-feed");
  if (refreshEl && !refreshEl.dataset.bound) {
    refreshEl.dataset.bound = "true";
    refreshEl.addEventListener("click", loadFeedFromFirestore);
  }

  const composerWrapper = document.getElementById("admin-composer-wrapper");
  const toggleComposerBtn = document.getElementById("btn-toggle-admin-composer");
  if (toggleComposerBtn && !toggleComposerBtn.dataset.bound) {
    toggleComposerBtn.dataset.bound = "true";
    toggleComposerBtn.addEventListener("click", () => {
      composerWrapper?.classList.toggle("is-hidden");
    });
  }

  const cancelComposerBtn = document.getElementById("btn-cancel-admin-composer");
  if (cancelComposerBtn && !cancelComposerBtn.dataset.bound) {
    cancelComposerBtn.dataset.bound = "true";
    cancelComposerBtn.addEventListener("click", () => {
      composerWrapper?.classList.add("is-hidden");
    });
  }

  const adminFeedImgInput = document.getElementById("admin-feed-image-input");
  const clearAdminImgBtn = document.getElementById("btn-clear-admin-feed-image");
  const adminPreviewBox = document.getElementById("admin-feed-image-preview-box");
  const adminPreviewImg = document.getElementById("admin-feed-image-preview");

  if (adminFeedImgInput && !adminFeedImgInput.dataset.bound) {
    adminFeedImgInput.dataset.bound = "true";
    adminFeedImgInput.addEventListener("change", () => {
      const file = adminFeedImgInput.files[0];
      if (!file) {
        adminPreviewBox?.classList.add("is-hidden");
        clearAdminImgBtn?.classList.add("is-hidden");
        return;
      }
      if (!file.type.startsWith("image/")) {
        alert("Please select a valid image file (PNG, JPG, or WebP).");
        adminFeedImgInput.value = "";
        return;
      }
      if (adminPreviewImg) adminPreviewImg.src = URL.createObjectURL(file);
      adminPreviewBox?.classList.remove("is-hidden");
      clearAdminImgBtn?.classList.remove("is-hidden");
    });
  }

  if (clearAdminImgBtn && !clearAdminImgBtn.dataset.bound) {
    clearAdminImgBtn.dataset.bound = "true";
    clearAdminImgBtn.addEventListener("click", () => {
      if (adminFeedImgInput) adminFeedImgInput.value = "";
      if (adminPreviewImg) adminPreviewImg.src = "";
      adminPreviewBox?.classList.add("is-hidden");
      clearAdminImgBtn.classList.add("is-hidden");
    });
  }

  const presetReasonEl = document.getElementById("mod-preset-reason");
  if (presetReasonEl && !presetReasonEl.dataset.bound) {
    presetReasonEl.dataset.bound = "true";
    presetReasonEl.addEventListener("change", (e) => {
      const val = e.target.value;
      const postId = document.getElementById("mod-post-id").value;
      const post = allPosts.find((p) => p.id === postId);
      const title = post ? post.title : "HR Feed";
      const msgBox = document.getElementById("mod-warning-message");

      if (val !== "Custom" && msgBox) {
        msgBox.value = `Your comment on "${title}" was flagged by an Administrator (${val}). Please adhere to professional HR simulation guidelines.`;
      }
    });
  }

  const modForm = document.getElementById("form-moderate-comment");
  if (modForm && !modForm.dataset.bound) {
    modForm.dataset.bound = "true";
    modForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const postId = document.getElementById("mod-post-id").value;
      const idx = Number(document.getElementById("mod-comment-idx").value);
      const actionType = document.getElementById("mod-action-type").value;
      const warningMsg = document.getElementById("mod-warning-message").value.trim();
      const submitBtn = document.getElementById("btn-submit-moderation");

      const post = allPosts.find((p) => p.id === postId);
      const comment = post?.comments?.[idx];
      if (!post || !comment) return;

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';

      try {
        const existingComments = [...(post.comments || [])];
        if (actionType === "delete_and_warn") {
          existingComments.splice(idx, 1);
        } else {
          existingComments[idx] = {
            ...comment,
            moderatedWarning: true,
            moderatedAt: new Date().toISOString()
          };
        }

        await updateDoc(doc(db, "hr_feed", postId), {
          comments: existingComments
        });

        if (comment.authorUid) {
          const excerptText = `${comment.text || ""}${comment.imageUrl ? (comment.text ? " [Attached Photo]" : "[Attached Photo]") : ""}`;
          await addDoc(collection(db, "notifications"), {
            recipientUid: comment.authorUid,
            recipientName: comment.authorName || "Member",
            type: "MODERATION_WARNING",
            title: "HR Feed Comment Moderation Warning",
            reason: warningMsg,
            commentExcerpt: excerptText.slice(0, 180),
            postId,
            postTitle: post.title || "HR Feed Discussion",
            issuedBy: currentAdminUser.email,
            read: false,
            createdAt: serverTimestamp()
          });
        }

        await logAuditEvent(
          `Admin moderated comment by ${comment.authorName || "user"} (${actionType}) & issued warning on "${post.title}"`,
          "HR_FEED_MODERATION",
          currentAdminUser.email
        );

        closeModal("modal-moderate-comment");
        sessionStorage.removeItem("aimser_v2_hr_feed_posts");
        await loadFeedFromFirestore();
      } catch (err) {
        alert("Moderation failed: " + err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-bell"></i> Execute & Send Warning';
      }
    });
  }

  const createFeedForm = document.getElementById("form-admin-create-feed");
  if (createFeedForm && !createFeedForm.dataset.bound) {
    createFeedForm.dataset.bound = "true";
    createFeedForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById("btn-submit-admin-feed");
      const title = document.getElementById("admin-feed-title").value.trim();
      const concerns = document.getElementById("admin-feed-concerns").value.trim();
      const investigation = document.getElementById("admin-feed-investigation").value.trim();
      const resolution = document.getElementById("admin-feed-resolution").value.trim();
      const imgInput = document.getElementById("admin-feed-image-input");

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Posting...';

      try {
        checkRateLimit("admin_create_feed", 8, 60000);

        let uploadedImageUrl = "";
        if (imgInput && imgInput.files.length > 0) {
          submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading Photo...';
          uploadedImageUrl = await uploadToCloudinary(imgInput.files[0], "aimser/hr-feed");
        }

        await addDoc(collection(db, "hr_feed"), {
          title,
          concerns,
          investigation,
          resolution,
          imageUrl: uploadedImageUrl,
          authorUid: currentAdminUser.uid,
          authorName: adminProfile.fullName,
          authorEmail: currentAdminUser.email,
          authorRole: "admin",
          archived: false,
          comments: [],
          createdAt: serverTimestamp()
        });

        await logAuditEvent(`Admin published HR Feed scenario "${title}"`, "HR_FEED", currentAdminUser.email);
        e.target.reset();
        adminPreviewBox?.classList.add("is-hidden");
        clearAdminImgBtn?.classList.add("is-hidden");
        composerWrapper?.classList.add("is-hidden");
        sessionStorage.removeItem("aimser_v2_hr_feed_posts");
        await loadFeedFromFirestore();
      } catch (err) {
        alert(err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Post';
      }
    });
  }
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