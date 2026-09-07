(function () {
  'use strict';
  try {
    const saved = JSON.parse(localStorage.getItem('listening-vocab-state-v3') || 'null');
    const theme = saved?.settings?.theme;
    if (['neutral', 'apricot', 'sage', 'blue', 'lavender', 'rose'].includes(theme)) {
      document.documentElement.dataset.theme = theme;
    }
  } catch {}
})();
