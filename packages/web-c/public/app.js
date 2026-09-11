// Minimal progressive enhancement: everything here is optional; pages work without it.
(function () {
  'use strict';
  document.documentElement.classList.add('js');

  function openDialog(root) {
    var dialog = root.querySelector('dialog');
    if (!dialog) return;
    if (dialog.hasAttribute('open')) dialog.removeAttribute('open');
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    var textarea = dialog.querySelector('textarea');
    if (textarea) {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
    dialog.addEventListener('close', function () {
      if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
    });
  }

  document.body.addEventListener('htmx:afterSwap', function (evt) {
    var target = evt.detail && evt.detail.target;
    if (target && target.id === 'dialog-slot') openDialog(target);
    if (target && target.id === 'toast') scheduleToastHide(target);
  });

  document.body.addEventListener('htmx:oobAfterSwap', function (evt) {
    var target = evt.detail && evt.detail.target;
    if (target && target.id === 'toast') scheduleToastHide(target);
  });

  var toastTimer = null;
  function scheduleToastHide(toast) {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.add('toast-hidden');
    }, 4000);
  }
  var initialToast = document.getElementById('toast');
  if (initialToast && !initialToast.classList.contains('toast-hidden')) scheduleToastHide(initialToast);

  document.body.addEventListener('click', function (evt) {
    var closer = evt.target.closest('[data-dialog-close]');
    if (closer) {
      var dialog = closer.closest('dialog');
      if (dialog) {
        evt.preventDefault();
        dialog.close();
      }
      return;
    }
    // Whole-row navigation on the queue table (the reference link is the no-JS fallback).
    var row = evt.target.closest('tr[data-href]');
    if (row && !evt.target.closest('a')) {
      window.location.href = row.getAttribute('data-href');
    }
  });

  // Surface network failures of htmx requests as a visible toast.
  document.body.addEventListener('htmx:sendError', function () {
    var toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = 'The web server is unreachable. Check your connection and reload.';
    toast.classList.remove('toast-hidden');
    toast.classList.add('toast-error');
  });
})();
