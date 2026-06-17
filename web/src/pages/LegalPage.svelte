<script lang="ts">
  import { session } from '../lib/session.svelte';
  import { router } from '../lib/router.svelte';

  function back(): void {
    router.go(session.loggedIn ? '/kalender' : '/login');
  }
</script>

<div class="wrap">
  <div class="legal">
    <button class="ghost back" onclick={back}>← Zurück</button>
    <h1>Impressum &amp; Datenschutz</h1>

    <section>
      <h2>Impressum</h2>
      <p>Angaben gemäß § 5 DDG:</p>
      <p>
        Freiwillige Feuerwehr Essen – Löschgruppe Horst-Eiberg<br />
        Schultenweg 84B<br />
        45279 Essen
      </p>
      <p>
        <strong>Vertreten durch:</strong><br />
        Löschgruppenführer René Schubert<br />
        Stellv. Löschgruppenführer Christian Werner
      </p>
      <p>
        <strong>Kontakt:</strong><br />
        Telefon: 0201 1239<br />
        E-Mail: <a href="mailto:info@ff-horst-eiberg.de">info@ff-horst-eiberg.de</a>
      </p>
      <p><strong>Verantwortlich i.S.d. § 18 Abs. 2 MStV:</strong> René Schubert (Anschrift wie oben)</p>
    </section>

    <section>
      <h2>Datenschutzerklärung</h2>
      <p>
        Diese Anwendung dient ausschließlich der wach-internen Organisation von Fahrzeugbuchungen und
        ist nur für freigeschaltete Mitglieder zugänglich. Verantwortlich für die Datenverarbeitung ist
        die im Impressum genannte Stelle (Kontakt: <a href="mailto:info@ff-horst-eiberg.de">info@ff-horst-eiberg.de</a>).
      </p>

      <h3>Welche Daten werden verarbeitet?</h3>
      <ul>
        <li>Name und E-Mail-Adresse (Anmeldung und Zuordnung von Buchungen)</li>
        <li>Führerscheinklassen (zur Prüfung, wer welches Fahrzeug fahren darf)</li>
        <li>Buchungsdaten: Zeiträume, Zweck, Fahrer:in, Fahrzeug</li>
        <li>Technisch notwendige Sitzungs-Token (Anmeldung)</li>
        <li>Nur bei eigener Aktivierung: Telegram-Chat-ID bzw. Web-Push-Endpunkt für Benachrichtigungen</li>
        <li>Nur bei aktiviertem Passwort-Login: ein Passwort-Hash (PBKDF2, kein Klartext)</li>
      </ul>

      <h3>Zweck und Rechtsgrundlage</h3>
      <p>
        Zweck ist die Verwaltung der Fahrzeugbuchungen und die Benachrichtigung der Mitglieder.
        Rechtsgrundlage ist das berechtigte Interesse an einer geordneten internen Organisation
        (Art. 6 Abs. 1 lit. f DSGVO). Die optionalen Benachrichtigungskanäle Telegram und Web-Push
        werden nur auf deine ausdrückliche Aktivierung hin genutzt (Einwilligung, Art. 6 Abs. 1 lit. a
        DSGVO) und sind jederzeit widerrufbar.
      </p>

      <h3>Empfänger / Auftragsverarbeiter</h3>
      <p>
        Die Anwendung läuft auf <strong>Cloudflare</strong> (Hosting des Servers und der Datenbank,
        Rechenzentren in der EU bzw. weltweit). Anmelde- und Benachrichtigungs-E-Mails werden über
        <strong>Resend</strong> (Region eu-west-1) versendet. Wenn du den Telegram-Bot verknüpfst,
        werden die jeweiligen Nachrichten und deine Chat-ID an <strong>Telegram</strong> (Drittland USA)
        übermittelt.
      </p>

      <h3>Speicherdauer</h3>
      <p>
        Konto- und Buchungsdaten werden gespeichert, solange dein Konto besteht. Abgelaufene
        Sitzungen und Einmal-Anmeldelinks werden automatisch gelöscht.
      </p>

      <h3>Cookies &amp; lokale Speicherung</h3>
      <p>
        Es werden keine Tracking-Cookies eingesetzt. Lokal im Browser werden nur technisch notwendige
        Daten gespeichert (Anmelde-Token, Warenkorb, Hell-/Dunkel-Einstellung).
        Benachrichtigungs-E-Mails kannst du jederzeit in der App unter „Hilfe" abschalten.
      </p>

      <h3>Deine Rechte</h3>
      <p>
        Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung,
        Datenübertragbarkeit und Widerspruch. Wende dich dazu an die im Impressum genannte Stelle
        oder eine:n Administrator:in. Außerdem steht dir ein Beschwerderecht bei der Aufsichtsbehörde
        zu (Landesbeauftragte für Datenschutz und Informationsfreiheit Nordrhein-Westfalen, LDI NRW).
      </p>
      <p class="small muted">Stand: Juni 2026</p>
    </section>
  </div>
</div>

<style>
  .wrap {
    min-height: 100dvh;
    display: flex;
    justify-content: center;
    padding: 24px 16px 80px;
  }
  .legal {
    width: 100%;
    max-width: 720px;
  }
  .back { margin-bottom: 12px; }
  h1 { margin-bottom: 6px; }
  section { margin-top: 22px; }
  section h2 { border-bottom: 1px solid var(--border); padding-bottom: 6px; }
  h3 { margin: 16px 0 4px; font-size: 15px; }
  ul { padding-left: 20px; }
  li { margin-bottom: 4px; }
  p { line-height: 1.6; }
</style>
