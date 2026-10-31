// js/register.js
import { auth, db } from "./firebase-init.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// 1. Role Selection Logic
let selectedRole = "faculty"; // Default role
const btnFaculty = document.getElementById('btn-reg-faculty');
const btnStudent = document.getElementById('btn-reg-student');
const studentCodeGroup = document.getElementById('student-code-group');

btnFaculty.addEventListener('click', (e) => {
  e.preventDefault();
  selectedRole = "faculty";
  btnFaculty.classList.add('active');
  btnStudent.classList.remove('active');
  studentCodeGroup.style.display = 'none';
});

btnStudent.addEventListener('click', (e) => {
  e.preventDefault();
  selectedRole = "student";
  btnStudent.classList.add('active');
  btnFaculty.classList.remove('active');
  studentCodeGroup.style.display = 'block';
});

// 2. Handle Form Submission
const registerForm = document.getElementById('registerForm');

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault(); // Stop page from refreshing
  
  // Grab the typed values
  const firstName = document.getElementById('firstName').value;
  const lastName = document.getElementById('lastName').value;
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const roomCode = document.getElementById('roomCode').value;

  // Change the button text so the user knows it's loading
  const submitBtn = registerForm.querySelector('button[type="submit"]');
  submitBtn.innerText = "Creating Account...";
  submitBtn.disabled = true;

  try {
    // A. Create the user in Firebase Authentication
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // B. Save additional profile data to Firestore Database
    await setDoc(doc(db, "users", user.uid), {
      firstName: firstName,
      lastName: lastName,
      email: email,
      role: selectedRole,
      roomCode: selectedRole === "student" ? roomCode : null,
      createdAt: serverTimestamp()
    });

    alert("Account created successfully! Welcome to Aimser.");
    
    // C. Send them to the dashboard
    window.location.href = 'index.html';
    
  } catch (error) {
    console.error("Error creating account:", error);
    alert("Error: " + error.message);
    submitBtn.innerText = "Create Account";
    submitBtn.disabled = false;
  }
});