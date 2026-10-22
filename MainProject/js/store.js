// js/store.js — The Central Memory Bank for Aimser

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize Mock Database if it doesn't exist
  if (!localStorage.getItem('aimser_data')) {
    const initialData = {
      grades: [
        { id: 1, title: "Recruitment Rubric", student: "Sarah Jenkins", score: 95, feedback: "Excellent alignment with core competencies.", status: "graded" },
        { id: 2, title: "Investigation Plan", student: "Mark Taylor", score: null, feedback: "", status: "pending" }
      ],
      jobOrders: [],
      activeCases: [],
      analytics: { classAverage: 88.5 }
    };
    localStorage.setItem('aimser_data', JSON.stringify(initialData));
  }
});

// Helper function to read data
function getAimserData() {
  return JSON.parse(localStorage.getItem('aimser_data'));
}

// Helper function to save data
function saveAimserData(data) {
  localStorage.setItem('aimser_data', JSON.stringify(data));
}