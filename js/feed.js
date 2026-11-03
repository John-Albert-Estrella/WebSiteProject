import { auth, db } from "./firebase-init.js";
import { enforceAuth } from "./auth-guard.js";
import { 
  collection, 
  addDoc, 
  getDoc, 
  doc, 
  query, 
  orderBy, 
  onSnapshot, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// Ensure authenticated access
enforceAuth(["student", "faculty", "admin"]);

const postInput = document.getElementById("post-input-text");
const btnSubmit = document.getElementById("btn-submit-post");
const feedStream = document.getElementById("live-feed-stream");

let currentUserData = null;

document.addEventListener("DOMContentLoaded", () => {
  auth.onAuthStateChanged(async (user) => {
    if (!user) return;

    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (!userDoc.exists()) return;
      currentUserData = userDoc.data();

      // Submit discussion prompt
      if (btnSubmit) {
        btnSubmit.addEventListener("click", () => handleCreatePost(user.uid));
      }

      if (postInput) {
        postInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleCreatePost(user.uid);
          }
        });
      }

      // Stream feed posts in real time
      listenToFeedStream();

    } catch (err) {
      console.error("Feed initialization error:", err);
    }
  });
});

async function handleCreatePost(uid) {
  const text = postInput.value.trim();
  if (!text) return;

  btnSubmit.disabled = true;
  btnSubmit.textContent = "Posting...";

  try {
    await addDoc(collection(db, "feed"), {
      authorUid: uid,
      authorName: `${currentUserData.firstName} ${currentUserData.lastName}`,
      authorRole: currentUserData.role,
      content: text,
      createdAt: serverTimestamp()
    });

    postInput.value = "";
  } catch (error) {
    console.error("Error creating post:", error);
    alert("Could not post: " + error.message);
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.textContent = "Post";
  }
}

function listenToFeedStream() {
  const q = query(collection(db, "feed"), orderBy("createdAt", "desc"));

  onSnapshot(q, (snapshot) => {
    feedStream.innerHTML = "";

    if (snapshot.empty) {
      feedStream.innerHTML = `
        <div class="card" style="text-align: center; color: var(--text-secondary); padding: 40px 20px;">
          <span style="font-size: 32px; display: block; margin-bottom: 8px;">💬</span>
          <strong>No discussions yet.</strong>
          <p style="font-size: 13px; margin-top: 4px;">Share a workplace scenario or question above!</p>
        </div>`;
      return;
    }

    snapshot.forEach((docSnap) => {
      const post = docSnap.data();
      const postId = docSnap.id;
      const isFaculty = post.authorRole === "faculty" || post.authorRole === "admin";
      const initial = (post.authorName || "U").charAt(0).toUpperCase();

      const timeString = post.createdAt && post.createdAt.toDate 
        ? post.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })
        : "Just now";

      const postCard = document.createElement("div");
      postCard.className = "feed-post";
      postCard.innerHTML = `
        <div class="post-header">
          <div class="post-avatar ${isFaculty ? 'faculty-avatar' : ''}">
            ${initial}
          </div>
          <div class="post-meta">
            <h4>
              ${post.authorName} 
              <span class="status-badge ${isFaculty ? 'status-pending' : 'status-graded'}" style="font-size: 10px; margin-left: 8px;">
                ${(post.authorRole || "USER").toUpperCase()}
              </span>
            </h4>
            <span>${timeString}</span>
          </div>
        </div>

        <div class="post-content">
          ${post.content}
        </div>

        <!-- COMMENT THREAD SECTION -->
        <div style="margin-top: 16px; border-top: 1px solid var(--surface-border); padding-top: 14px;">
          <div id="comments-list-${postId}" class="comment-list" style="margin-bottom: 12px; display: flex; flex-direction: column; gap: 8px;">
            <p style="font-size: 12px; color: var(--text-secondary);">Loading replies...</p>
          </div>

          <div style="display: flex; gap: 8px;">
            <input type="text" id="input-reply-${postId}" class="form-control" placeholder="Write a response or policy argument..." style="font-size: 13px;">
            <button class="btn btn-primary" id="btn-reply-${postId}" style="font-size: 12px; padding: 6px 14px; white-space: nowrap;">Reply</button>
          </div>
        </div>
      `;

      const inputReply = postCard.querySelector(`#input-reply-${postId}`);
      const btnReply = postCard.querySelector(`#btn-reply-${postId}`);

      const submitComment = async () => {
        const text = inputReply.value.trim();
        if (!text) return;

        btnReply.disabled = true;
        btnReply.textContent = "Sending...";

        try {
          await addDoc(collection(db, "feed", postId, "comments"), {
            authorName: `${currentUserData.firstName} ${currentUserData.lastName}`,
            authorRole: currentUserData.role,
            content: text,
            createdAt: serverTimestamp()
          });

          inputReply.value = "";
        } catch (err) {
          console.error("Comment submit error:", err);
          alert("Failed to submit reply: " + err.message);
        } finally {
          btnReply.disabled = false;
          btnReply.textContent = "Reply";
        }
      };

      btnReply.addEventListener("click", submitComment);
      inputReply.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submitComment();
        }
      });

      // Stream comments for this post
      listenToComments(postId, postCard.querySelector(`#comments-list-${postId}`));

      feedStream.appendChild(postCard);
    });
  });
}

function listenToComments(postId, listContainer) {
  const commentsQuery = query(collection(db, "feed", postId, "comments"), orderBy("createdAt", "asc"));

  onSnapshot(commentsQuery, (snapshot) => {
    listContainer.innerHTML = "";

    if (snapshot.empty) {
      listContainer.innerHTML = `<p style="font-size: 12px; color: var(--text-secondary); margin: 4px 0;">No responses yet. Be the first to comment!</p>`;
      return;
    }

    snapshot.forEach((commentDoc) => {
      const comment = commentDoc.data();
      const isFaculty = comment.authorRole === "faculty" || comment.authorRole === "admin";

      const commentEl = document.createElement("div");
      commentEl.className = "comment-item";
      commentEl.innerHTML = `
        <div class="comment-content">
          <h5>
            ${comment.authorName}
            <span style="font-size: 10px; font-weight: 700; color: ${isFaculty ? 'var(--faculty-accent)' : 'var(--student-accent)'}; margin-left: 6px;">
              [${(comment.authorRole || 'USER').toUpperCase()}]
            </span>
          </h5>
          <p>${comment.content}</p>
        </div>
      `;
      listContainer.appendChild(commentEl);
    });
  }, (err) => {
    console.error("Comments listener error:", err);
    listContainer.innerHTML = `<p style="font-size: 12px; color: var(--danger);">Unable to load replies (${err.code}).</p>`;
  });
}