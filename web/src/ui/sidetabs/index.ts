// The tabs over the side card (T40): Scenarios, or Timeline playback in the same place. Each card
// is its own slot and module (#scenarios, #playback); this only shows one and hides the other, so
// the modules never call each other. The playback keeps playing while Scenarios is shown.
import './sidetabs.css';

const TABS: { id: string; text: string }[] = [
  { id: 'scenarios', text: 'Scenarios' },
  { id: 'playback', text: 'Timeline' },
];

export function mount(el: HTMLElement): void {
  el.setAttribute('role', 'tablist');
  el.setAttribute('aria-label', 'Side card');
  const buttons = TABS.map((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.textContent = t.text;
    b.id = `tab-${t.id}`;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', t.id);
    const panel = document.getElementById(t.id);
    panel?.setAttribute('role', 'tabpanel');
    panel?.setAttribute('aria-labelledby', b.id);
    return b;
  });
  const show = (id: string, focus = false): void => {
    for (const [i, t] of TABS.entries()) {
      const on = t.id === id;
      const b = buttons[i];
      b.classList.toggle('btn-primary', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.id);
      if (panel) panel.hidden = !on;
      if (on && focus) b.focus();
    }
  };
  buttons.forEach((b, i) => {
    b.addEventListener('click', () => show(TABS[i].id));
    // Arrow keys move between the tabs, as a tab list does.
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const next = (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
      show(TABS[next].id, true);
    });
  });
  el.replaceChildren(...buttons);
  show('scenarios');
}
