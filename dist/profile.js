function renderMyProfile({name, avatar, details = '', actions = '', administrationHref = ''}) {
  return `<div class="my-profile">
    <header><h1 tabindex="-1">Mój profil</h1></header>
    <section class="my-profile-card">
      ${name ? `<div class="my-profile-identity">
        ${avatar ? `<span class="my-profile-avatar" aria-hidden="true">${avatar}</span>` : ''}
        <h2>${name}</h2>
      </div>` : ''}
      ${details}
      <footer class="my-profile-actions">
        ${administrationHref ? `<a class="button secondary" href="${administrationHref}">Administracja</a>` : ''}
        ${actions}
      </footer>
    </section>
  </div>`;
}
