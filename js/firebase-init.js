import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// Your new Aimser-Simulator Web App credentials
const firebaseConfig = {
  apiKey: "AIzaSyBY3qdJXyrwQJtYIddGYt1Z8-M9IPA9ZH8",
  authDomain: "aimser-simulator.firebaseapp.com",
  projectId: "aimser-simulator",
  storageBucket: "aimser-simulator.firebasestorage.app",
  messagingSenderId: "123482322329",
  appId: "1:123482322329:web:c36098327c686f7f534f08",
  measurementId: "G-CCDNGV4P25"
};

// Initialize Firebase Core
const app = initializeApp(firebaseConfig);

// Initialize & Export Auth & Firestore
export const auth = getAuth(app);
export const db = getFirestore(app);

console.log("🔥 Firebase Engine Connected Successfully!");