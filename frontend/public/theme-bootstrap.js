(() => {
  const key = 'devflow-theme';
  let stored = null;
  try { stored = localStorage.getItem(key); } catch { stored = null; }
  const theme = stored === 'light' || stored === 'dark'
    ? stored
    : window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#020617' : '#f8fafc');
})();
