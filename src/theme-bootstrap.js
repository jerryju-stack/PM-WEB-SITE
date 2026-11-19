(() => {
  const key = 'project-station.theme';
  const system = matchMedia('(prefers-color-scheme: dark)');
  const root = document.documentElement;
  const browserColor = document.querySelector('meta[name="theme-color"]');
  const isPreference = value => value === 'light' || value === 'dark' || value === 'system';
  let preference = 'system';

  function readPreference() {
    try {
      const saved = localStorage.getItem(key);
      return isPreference(saved) ? saved : 'system';
    } catch {
      return 'system';
    }
  }

  function apply() {
    const theme = preference === 'system' ? (system.matches ? 'dark' : 'light') : preference;
    root.dataset.themePreference = preference;
    root.dataset.theme = theme;
    browserColor.content = theme === 'light' ? '#f5f6f8' : '#141518';
    for (const select of document.querySelectorAll('[data-theme-control]')) select.value = preference;
  }

  preference = readPreference();
  apply();
  system.addEventListener('change', () => {
    if (preference === 'system') apply();
  });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) {
      preference = readPreference();
      apply();
    }
  });
  document.addEventListener('change', event => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement) || !select.hasAttribute('data-theme-control') || !isPreference(select.value)) return;
    preference = select.value;
    try {
      localStorage.setItem(key, preference);
    } catch {
      // The current page can still use the new preference without storage.
    }
    apply();
  });
})();
