const cards = document.querySelectorAll('.card');
const containers = document.querySelectorAll('.cards-container');

cards.forEach(card => {
  card.addEventListener('dragstart', () => {
    card.classList.add('dragging');
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
  });
});

containers.forEach(container => {
  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    const draggingCard = document.querySelector('.dragging');
    if (draggingCard) {
      container.appendChild(draggingCard);
    }
  });
});