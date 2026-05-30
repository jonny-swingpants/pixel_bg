export class Panel {
  constructor() {
    this.panel  = document.getElementById('panel');
    this.toggle = document.getElementById('toggle-btn');
    this.toggle.addEventListener('click', () => this.toggleCollapsed());
  }

  toggleCollapsed() {
    this.panel.classList.toggle('collapsed');
  }
}
