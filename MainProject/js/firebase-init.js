// js/firebase-init.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDZBvc3XRRRt2hwMaNZaPFcWIREQ6VFsqk",
  authDomain: "aimser-simulator.firebaseapp.com",
  projectId: "aimser-simulator",
  messagingSenderId: "123482322329",
  appId: "1:123482322329:web:0a542be0e45cfbbd534f08",
  measurementId: "G-NWBRPSRHSS"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

console.log("🔥 Firebase Engine Connected Successfully!");