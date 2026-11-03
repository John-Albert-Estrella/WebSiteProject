import { db } from "./firebase-init.js";
import { initAuthGuard } from "./auth-guard.js";
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  orderBy, 
  serverTimestamp, 
  getDocs 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const formCreatePost = document.getElementById("form-create-post");
const postContentInput = document.getElementById("post-content-input");
const btnSubmitPost = document.getElementById("btn-submit-post");
const postsStream = document.getElementById("posts-stream");

let activeUser = null;
let activeRole = "student";
let activeClassCode = "";
let feedUnsubscribe = null;

// Safe Date Formatter to avoid .toDate() on null during optimistic Firestore writes
function formatSafeDate(timestamp) {
  if (!timestamp) return "Just now";
  if (typeof timestamp.toDate === "function") {
    return timestamp.toDate().toLocaleString([], { dateStyle: "short", timeStyle: "short" });
  }
  if (timestamp instanceof Date) {
    return timestamp.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
  }
  return "Just now";
}

// Submit New Post
formCreatePost?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const content = postContentInput?.value.trim();
  if (!content) return;

  if (btnSubmitPost) {
    btnSubmitPost.disabled = true;
    btnSubmitPost.textContent = "Posting...";
  }

  try {
    await addDoc(collection(db, "posts"), {
      content: content,
      authorUid: activeUser.uid,
      authorName: activeUser.displayName || activeUser.email.split("@")[0],
      authorRole: activeRole,
      classroomCode: activeClassCode || "GLOBAL",
      createdAt: serverTimestamp()
    });

    if (formCreatePost) formCreatePost.reset();
  } catch (err) {
    console.error("Failed to publish post:", err);
    alert("Could not post: " + err.message);
  } finally {
    if (btnSubmitPost) {
      btnSubmitPost.disabled = false;
      btnSubmitPost.textContent = "Post to Forum";
    }
  }
});

// Real-Time Feed Listener
function listenToFeed() {
  if (feedUnsubscribe) feedUnsubscribe();

  let q;
  if (activeClassCode) {
    q = query(
      collection(db, "posts"),
      where("classroomCode", "==", activeClassCode),
      orderBy("createdAt", "desc")
    );
  } else {
    q = query(
      collection(db, "posts"),
      orderBy("createdAt", "desc")
    );
  }

  feedUnsubscribe = onSnapshot(q, (snapshot) => {
    if (snapshot.empty) {
      if (postsStream) {
        postsStream.innerHTML = `
          <div class="empty-state">
            <p>No discussion posts yet in this section. Start the conversation above!</p>
          </div>
        `;
      }
      return;
    }

    let postsHtml = "";
    snapshot.forEach((docSnap) => {
      const post = docSnap.data();
      const postId = docSnap.id;
      const formattedDate = formatSafeDate(post.createdAt);
      const isFacultyPost = post.authorRole === "faculty";

      postsHtml += `
        <article class="card" style="gap: 14px;">
          <div class="card-header" style="align-items: center;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="font-weight: 700; color: var(--text-primary); font-size: 15px;">
                ${isFacultyPost ? `Prof. ${escapeHtml(post.authorName)}` : escapeHtml(post.authorName)}
              </span>
              <span class="role-tag ${isFacultyPost ? 'faculty' : ''}" style="font-size: 10px; padding: 2px 8px;">
                ${escapeHtml(post.authorRole || 'Student')}
              </span>
            </div>
            <span style="font-size: 12px; color: var(--text-tertiary);">${formattedDate}</span>
          </div>

          <p style="font-size: 14.5px; color: var(--text-secondary); line-height: 1.55; white-space: pre-wrap;">
            ${escapeHtml(post.content)}
          </p>

          <div style="border-top: 1px solid var(--surface-border); padding-top: 12px; display: flex; flex-direction: column; gap: 10px;">
            <div id="comments-container-${postId}" style="display: flex; flex-direction: column; gap: 8px;"></div>

            <form class="form-reply" data-post-id="${postId}" style="display: flex; gap: 8px; margin-top: 4px;">
              <input 
                type="text" 
                class="form-control input-reply" 
                placeholder="Write a response or policy argument..." 
                required
                style="padding: 8px 12px; font-size: 13px;"
              >
              <button type="submit" class="btn btn-primary" style="padding: 8px 16px; font-size: 13px;">Reply</button>
            </form>
          </div>
        </article>
      `;
    });

    if (postsStream) postsStream.innerHTML = postsHtml;

    snapshot.forEach((docSnap) => {
      loadComments(docSnap.id);
    });

    document.querySelectorAll(".form-reply").forEach((form) => {
      form.addEventListener("submit", handleReplySubmit);
    });

  }, (err) => {
    console.error("Feed listener error:", err);
  });
}

async function loadComments(postId) {
  const container = document.getElementById(`comments-container-${postId}`);
  if (!container) return;

  try {
    const q = query(collection(db, `posts/${postId}/comments`), orderBy("createdAt", "asc"));
    const snap = await getDocs(q);

    if (snap.empty) {
      container.innerHTML = "";
      return;
    }

    let commentsHtml = "";
    snap.forEach((docSnap) => {
      const comment = docSnap.data();
      const timeStr = formatSafeDate(comment.createdAt);
      const isFacultyReply = comment.authorRole === "faculty";

      commentsHtml += `
        <div style="background: var(--bg-surface); border: 1px solid var(--surface-border); border-radius: var(--radius-sm); padding: 10px 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-weight: 700; font-size: 12.5px; color: var(--text-primary);">
                ${isFacultyReply ? `Prof. ${escapeHtml(comment.authorName)}` : escapeHtml(comment.authorName)}
              </span>
              <span class="role-tag ${isFacultyReply ? 'faculty' : ''}" style="font-size: 9px; padding: 1px 6px;">
                ${escapeHtml(comment.authorRole || 'Student')}
              </span>
            </div>
            <span style="font-size: 11px; color: var(--text-tertiary);">${timeStr}</span>
          </div>
          <p style="font-size: 13px; color: var(--text-secondary); line-height: 1.45; margin: 0;">
            ${escapeHtml(comment.text)}
          </p>
        </div>
      `;
    });

    container.innerHTML = commentsHtml;
  } catch (err) {
    console.warn(`Could not load comments for post ${postId}:`, err);
  }
}

async function handleReplySubmit(e) {
  e.preventDefault();
  const form = e.target;
  const postId = form.dataset.postId;
  const input = form.querySelector(".input-reply");
  const text = input?.value.trim();
  const btn = form.querySelector("button[type='submit']");

  if (!text) return;

  if (btn) {
    btn.disabled = true;
    btn.textContent = "...";
  }

  try {
    await addDoc(collection(db, `posts/${postId}/comments`), {
      text: text,
      authorUid: activeUser.uid,
      authorName: activeUser.displayName || activeUser.email.split("@")[0],
      authorRole: activeRole,
      createdAt: serverTimestamp()
    });

    form.reset();
    loadComments(postId);
  } catch (err) {
    console.error("Reply failed:", err);
    alert("Could not post reply: " + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Reply";
    }
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[s]));
}

initAuthGuard({
  onReady: ({ user, userData, role }) => {
    activeUser = user;
    activeRole = role;
    activeClassCode = userData.classroomCode || "";
    listenToFeed();
  }
});