/* MyBizTools: theme-init.js
 * Runs before the page paints. Applies the Light/Dark choice saved on this device, if any.
 * With no saved choice, the page follows the device setting (see styles.css). */
(function () {
  try {
    var t = localStorage.getItem('mbt-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* storage blocked: follow the device setting */ }
})();
