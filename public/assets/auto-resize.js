// auto-resize.js — Reports iframe content height to parent window
// Allows embedded iframes to auto-resize instead of scrolling
(function() {
  function reportHeight() {
    var h = document.documentElement.scrollHeight;
    if (h > 0) {
      window.parent.postMessage({ type: 'iframe-resize', height: h, src: window.location.pathname }, '*');
    }
  }

  // Report on load
  window.addEventListener('load', reportHeight);

  // Report when DOM changes (search results, commission data, etc.)
  if (typeof MutationObserver !== 'undefined') {
    var observer = new MutationObserver(function() { reportHeight(); });
    observer.observe(document.body, { childList: true, subtree: true, attributes: false, characterData: false });
    // Throttle — MutationObserver fires rapidly during result rendering
    var timer;
    var origReport = reportHeight;
    reportHeight = function() {
      clearTimeout(timer);
      timer = setTimeout(origReport, 50);
    };
    // Re-observe with throttled version
    observer.disconnect();
    observer = new MutationObserver(function() { reportHeight(); });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Fallback interval for edge cases
  setInterval(reportHeight, 500);
})();
