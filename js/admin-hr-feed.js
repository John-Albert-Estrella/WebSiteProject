// js/admin-hr-feed.js - Isolated Admin HR Feed View, Comment Photo Moderation & User Warning Notifications
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
    return `<span style="display:inline-block;padding:0.15rem 0.55rem;border-radius:9999px;font-size:0.68rem;font-weight:700;text-transform:uppercase;background:var(--aimser-blue-700);color:#ffffff;letter-spacing:0.04em;">ADMIN</span>`;
  }
  const isFac = normalized === "faculty";
  const bg = isFac ? "rgba(56, 189, 248, 0.16)" : "rgba(16, 185, 129, 0.16)";
  const color = isFac ? "#38bdf8" : "#10b981";
  return `<span style="display:inline-block;padding:0.15rem 0.55rem;border-radius:9999px;font-size:0.68rem;font-weight:700;text-transform:uppercase;background:${bg};color:${color};letter-spacing:0.04em;">${escapeHtml(normalized)}</span>`;
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
  } catch (err) {
    console.error("Error loading hr_feed:", err);
    if (stream) {
      stream.innerHTML = `
        <div class="glass-panel empty-state">
          <i class="fas fa-exclamation-triangle" style="color: var(--danger);"></i>
          <h3>Unable to Load HR Feed</h3>
          <p style="font-size: 0.82rem;">${escapeHtml(err.message)}</p>
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
        ? `<span class="badge-pill" style="background:rgba(245,158,11,0.18);color:var(--warning);border-color:var(--warning);">ARCHIVED</span>`
        : `<span class="badge-pill" style="background:rgba(16,185,129,0.14);color:var(--success);border-color:rgba(16,185,129,0.35);">ACTIVE</span>`;

      const imageBlockHtml = safeImage
        ? `
          <div style="margin-bottom: 1.15rem;">
            <img src="${safeImage}" alt="Attached evidence" class="btn-open-lightbox" data-src="${safeImage}" data-title="${escapeHtml(post.title || "Attached Evidence")}" style="max-height: 320px; width: 100%; object-fit: cover; border-radius: var(--radius-sm); border: 1px solid var(--border-medium); cursor: zoom-in;" />
          </div>`
        : "";

      return `
        <article class="glass-panel" style="${isArchived ? "border-color: rgba(245, 158, 11, 0.45);" : ""}">
          <!-- Post Header & Moderation Actions -->
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:0.75rem;margin-bottom:0.9rem;">
            <div>
              <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.25rem;">
                <h3 style="font-size:1.1rem;margin:0;color:var(--text-primary);">${escapeHtml(post.title || "Untitled Scenario")}</h3>
                ${statusBadge}
              </div>
              <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;font-size:0.8rem;color:var(--text-secondary);">
                <strong>${escapeHtml(post.authorName || "Participant")}</strong>
                ${renderRoleBadge(post.authorRole || "student")}
                <span>(${escapeHtml(post.authorEmail || "No email")})</span>
                <span>• ${escapeHtml(dateStr)}</span>
              </div>
            </div>

            <div style="display:flex;align-items:center;gap:0.45rem;">
              <button type="button" class="btn-secondary btn-toggle-archive" data-id="${post.id}" data-title="${escapeHtml(post.title || "")}" data-archived="${isArchived}" style="padding:0.38rem 0.78rem;font-size:0.78rem;">
                <i class="fas ${isArchived ? "fa-box-open" : "fa-archive"}"></i> ${isArchived ? "Unarchive" : "Archive"}
              </button>
              <button type="button" class="btn-sidebar-action btn-logout btn-delete-post" data-id="${post.id}" data-title="${escapeHtml(post.title || "")}" style="width:auto;padding:0.38rem 0.78rem;font-size:0.78rem;">
                <i class="fas fa-trash-alt"></i> Delete Post
              </button>
            </div>
          </div>

          ${imageBlockHtml}

          <!-- 3-Column Scenario Breakdown -->
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

          <!-- Comments Thread with Photo Display, Warn & Delete Moderation Controls -->
          <div style="padding-top:0.85rem;border-top:1px solid var(--border-subtle);">
            <div style="font-size:0.8rem;font-weight:600;margin-bottom:0.65rem;color:var(--text-secondary);">
              <i class="far fa-comment-dots"></i> Discussion &amp; Opinions (${comments.length})
            </div>

            <div style="display:flex;flex-direction:column;gap:0.5rem;margin-bottom:0.75rem;">
              ${comments
                .map((c, idx) => {
                  const safeCommentImg = sanitizeUrl(c.imageUrl, "");
                  const commentImgHtml = safeCommentImg
                    ? `<div style="margin-top:0.45rem;">
                         <img src="${safeCommentImg}" alt="Comment attachment" class="btn-open-lightbox" data-src="${safeCommentImg}" data-title="Comment Photo by ${escapeHtml(c.authorName || "Member")}" style="max-height:180px;max-width:100%;border-radius:var(--radius-xs);border:1px solid var(--border-medium);cursor:zoom-in;object-fit:cover;" />
                       </div>`
                    : "";

                  return `
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.75rem;flex-wrap:wrap;padding:0.65rem 0.85rem;border-radius:var(--radius-xs);background:var(--bg-canvas);border:1px solid var(--border-subtle);font-size:0.83rem;">
                      <div style="flex: 1; min-width: 220px;">
                        <div style="display:flex;align-items:center;gap:0.45rem;margin-bottom:0.2rem;flex-wrap:wrap;">
                          <strong>${escapeHtml(c.authorName || "Member")}</strong>
                          ${renderRoleBadge(c.authorRole || "student")}
                          ${c.moderatedWarning ? `<span class="badge-pill" style="font-size:0.65rem;background:rgba(245,158,11,0.18);color:var(--warning);border-color:var(--warning);"><i class="fas fa-exclamation-triangle"></i> Warned</span>` : ""}
                        </div>
                        ${c.text ? `<p style="margin:0;color:var(--text-primary);white-space:pre-wrap;">${escapeHtml(c.text)}</p>` : ""}
                        ${commentImgHtml}
                      </div>
                      <div style="display:flex;align-items:center;gap:0.4rem;">
                        <button type="button" class="btn-secondary btn-open-mod-comment" data-post-id="${post.id}" data-idx="${idx}" style="padding:0.28rem 0.6rem;font-size:0.73rem;border-color:rgba(245,158,11,0.45);color:var(--warning);" title="Moderate Comment & Send Warning">
                          <i class="fas fa-exclamation-triangle"></i> Warn &amp; Moderate
                        </button>
                        <button type="button" class="btn-sidebar-action btn-logout btn-del-comment" data-post-id="${post.id}" data-idx="${idx}" style="width:auto;padding:0.28rem 0.6rem;font-size:0.73rem;" title="Delete Comment">
                          <i class="fas fa-trash"></i> Delete
                        </button>
                      </div>
                    </div>`;
                })
                .join("")}
            </div>

            <form class="form-admin-reply" data-post-id="${post.id}" style="display:flex;flex-direction:column;gap:0.5rem;">
              <div style="display:flex;gap:0.5rem;align-items:center;">
                <input type="text" class="form-control input-admin-reply" placeholder="Post an official administrator note or guidance..." style="font-size:0.83rem;flex:1;" />
                <label class="btn-secondary" style="padding:0.45rem 0.75rem;font-size:0.8rem;cursor:pointer;margin:0;white-space:nowrap;" title="Attach Photo to Admin Reply">
                  <i class="fas fa-camera"></i>
                  <input type="file" class="input-admin-reply-image" accept="image/png,image/jpeg,image/webp" style="display:none;" />
                </label>
                <button type="submit" class="btn-secondary btn-submit-admin-reply" style="padding:0.45rem 0.9rem;font-size:0.8rem;white-space:nowrap;">
                  <i class="fas fa-reply"></i> Reply as Admin
                </button>
              </div>
              <div class="admin-reply-preview-strip" style="display:none;align-items:center;gap:0.6rem;padding:0.4rem 0.65rem;border-radius:var(--radius-xs);background:var(--bg-surface);border:1px solid var(--border-subtle);width:fit-content;">
                <img class="admin-reply-preview-img" src="" alt="Reply Preview" style="height:44px;width:44px;object-fit:cover;border-radius:4px;" />
                <span class="admin-reply-preview-name text-muted" style="font-size:0.75rem;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>
                <button type="button" class="btn-clear-admin-reply-img" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.9rem;line-height:1;" title="Remove Photo">&times;</button>
              </div>
            </form>
          </div>
        </article>`;
    })
    .join("");

  // Lightbox Image Viewer
  stream.querySelectorAll(".btn-open-lightbox").forEach((img) => {
    img.addEventListener("click", () => {
      document.getElementById("lightbox-title").textContent = img.dataset.title || "Attached Evidence";
      document.getElementById("lightbox-img").src = img.dataset.src;
      openModal("modal-image-lightbox");
    });
  });

  // Archive / Unarchive Post
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

  // Permanently Delete Post
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

  // Open Moderate & Warn Modal for a Specific Comment
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

  // Quick Delete Individual Comment
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

  // Reply as Admin (With Optional Photo Upload)
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
        if (previewStrip) previewStrip.style.display = "none";
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
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "true";
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
  });

  document.querySelectorAll(".feed-status-tab").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "true";
    btn.addEventListener("click", () => {
      activeStatusFilter = btn.dataset.status;
      document.querySelectorAll(".feed-status-tab").forEach((b) => {
        const isCurrent = b.dataset.status === activeStatusFilter;
        b.classList.toggle("active", isCurrent);
        b.style.borderColor = isCurrent ? "var(--aimser-blue-500)" : "var(--border-medium)";
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
      if (!composerWrapper) return;
      const isHidden = composerWrapper.style.display === "none";
      composerWrapper.style.display = isHidden ? "block" : "none";
    });
  }

  const cancelComposerBtn = document.getElementById("btn-cancel-admin-composer");
  if (cancelComposerBtn && !cancelComposerBtn.dataset.bound) {
    cancelComposerBtn.dataset.bound = "true";
    cancelComposerBtn.addEventListener("click", () => {
      if (composerWrapper) composerWrapper.style.display = "none";
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
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publishing...';

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
        if (composerWrapper) composerWrapper.style.display = "none";
        sessionStorage.removeItem("aimser_v2_hr_feed_posts");
        await loadFeedFromFirestore();
      } catch (err) {
        alert(err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Publish to Live HR Feed';
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