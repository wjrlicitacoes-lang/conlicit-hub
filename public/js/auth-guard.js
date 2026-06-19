(function () {
  const token = localStorage.getItem('token');

  if (!token) {
    window.location.href = '/login.html';
    return;
  }

  // Intercepta todos os fetch para adicionar Authorization em chamadas locais
  const originalFetch = window.fetch;
  window.fetch = function (url, options) {
    options = options || {};
    const urlStr = String(url);
    const isLocal = !urlStr.startsWith('http') ||
      urlStr.includes(window.location.hostname) ||
      urlStr.startsWith('/');

    if (isLocal) {
      options.headers = Object.assign({}, options.headers, {
        'Authorization': 'Bearer ' + token,
      });
    }
    return originalFetch(url, options).then(function (res) {
      if (res.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('usuario');
        window.location.href = '/login.html';
      }
      return res;
    });
  };

  // Expõe usuário logado globalmente
  try {
    window.usuarioLogado = JSON.parse(localStorage.getItem('usuario') || '{}');
  } catch (e) {
    window.usuarioLogado = {};
  }

  // Botão de logout (se existir no HTML com id="btn-logout")
  document.addEventListener('DOMContentLoaded', function () {
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', function () {
        localStorage.removeItem('token');
        localStorage.removeItem('usuario');
        window.location.href = '/login.html';
      });
    }

    // Exibir nome do usuário (se existir elemento com id="usuario-nome")
    const nomeEl = document.getElementById('usuario-nome');
    if (nomeEl && window.usuarioLogado.nome) {
      nomeEl.textContent = window.usuarioLogado.nome;
    }
  });
})();
