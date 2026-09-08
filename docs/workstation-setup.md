# Cycleo MCP gebruiken in Codex of Claude

Deze handleiding is voor Cycleo-gebruikers die de gehoste MCP-server vanaf hun
eigen computer willen gebruiken. Je hoeft deze repository niet te clonen en je
hoeft lokaal geen Node.js-, Docker- of systemd-service te draaien.

De gehoste MCP-endpoint is:

```text
https://mcp.cycleo.com/mcp
```

## Wat de MCP-server wel en niet doet

De Cycleo MCP-server is **read-only**. Na verbinden kan je AI-client jouw
ploeg, wedstrijden, klassementen, rennerprofielen, transfergeschiedenis en
TransferAI-advies opvragen — allemaal binnen jouw eigen competitie. De MCP kan
**geen** transfers doen, berichten sturen of instellingen wijzigen.

Je Cycleo-wachtwoord gaat alleen naar Cycleo zelf, nooit naar de MCP-server of
je AI-client. De toegang is een OAuth-token met alleen de scope `cycleo:read`,
die je op elk moment weer kunt intrekken.

De volledige lijst met tools en argumenten staat in [tools.md](tools.md).

## Wat je nodig hebt

- een actief Cycleo-account met toegang tot een ploeg;
- een MCP-client die Streamable HTTP en OAuth met PKCE ondersteunt;
- een browser om bij Cycleo in te loggen en de read-only toegang goed te keuren.

De vaste OAuth-parameters van Cycleo zijn:

| Instelling | Waarde |
| --- | --- |
| Transport | Streamable HTTP |
| MCP-URL | `https://mcp.cycleo.com/mcp` |
| Authenticatie | OAuth authorization code + PKCE-S256 |
| OAuth client-id | `cycleo-mcp-prod` |
| OAuth client-secret | *(geen — publieke client)* |
| OAuth resource | `https://mcp.cycleo.com` |
| Scope | `cycleo:read` |

Cycleo ondersteunt **geen** Dynamic Client Registration. Elke client moet dus
de vaste client-id `cycleo-mcp-prod` en resource `https://mcp.cycleo.com`
meegeven. Clients die dat niet kunnen, werken niet.

---

## Codex (ChatGPT desktop, Codex CLI, Codex IDE)

De ChatGPT desktop-app, de Codex CLI en de Codex IDE-extensie delen op hetzelfde
werkstation dezelfde MCP-configuratie. Voeg Cycleo één keer toe via een
terminal:

```sh
codex mcp add cycleo --url https://mcp.cycleo.com/mcp --oauth-client-id cycleo-mcp-prod --oauth-resource https://mcp.cycleo.com
```

Start daarna de OAuth-login:

```sh
codex mcp login cycleo
```

De browser opent de Cycleo-login en vervolgens het toestemmingsscherm.
Controleer je ploeg en competitie en kies **Toestaan**.

Controleer de verbinding:

```sh
codex mcp list
```

Gebruik in Codex of de ChatGPT desktop-app `/mcp` om de actieve server en tools
te bekijken. Herstart de desktop-app of IDE-extensie als Cycleo niet meteen in
de lijst verschijnt.

### Verbinding stoppen of verwijderen

```sh
codex mcp logout cycleo   # alleen de opgeslagen OAuth-toegang wissen
codex mcp remove cycleo   # Cycleo volledig uit de configuratie halen
```

ChatGPT op het web leest de lokale Codex-configuratie niet. Daarvoor is een
apart gepubliceerde, door de workspace toegestane plugin nodig.

De actuele Codex MCP-configuratie staat in de
[officiële OpenAI-documentatie](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

---

## Claude.ai (web) en Claude Desktop

Claude.ai en de Claude desktop-app delen dezelfde connector-configuratie. Je
voegt Cycleo toe als **custom connector**. Dit vereist een Claude-abonnement
waarop custom connectors zijn toegestaan (Pro, Max, Team of Enterprise; bij Team
en Enterprise moet een beheerder ze eventueel eerst inschakelen).

1. Open **Settings → Connectors** (of **Instellingen → Connectoren**).
2. Klik onderaan op **Add custom connector**.
3. Vul in:
   - **Name**: `Cycleo`
   - **Remote MCP server URL**: `https://mcp.cycleo.com/mcp`
4. Vouw **Advanced settings** open en vul in:
   - **OAuth Client ID**: `cycleo-mcp-prod`
   - **OAuth Client Secret**: *leeg laten*
5. Klik **Add** en daarna **Connect**.
6. De browser opent de Cycleo-login en het toestemmingsscherm. Controleer je
   ploeg en competitie en kies **Toestaan**.

Na het verbinden verschijnen de Cycleo-tools in het gereedschapsmenu van een
chat. Als je ze niet ziet: open de connector-instellingen opnieuw, controleer
dat Cycleo op **Connected** staat en zet de losse tools desnoods handmatig aan.

Claude gebruikt hiervoor de vaste callback-URL
`https://claude.ai/api/mcp/auth_callback`, die Cycleo al accepteert. Er is geen
verdere serverconfiguratie nodig.

### Verbinding stoppen

Open **Settings → Connectors**, klik op **Cycleo** en kies **Disconnect** of
**Remove**. Wil je de toegang ook aan de Cycleo-kant intrekken, log dan in op
Cycleo en verwijder de MCP-sessie bij je account-/beveiligingsinstellingen.

---

## Claude Code (CLI)

Claude Code is een native client en gebruikt een loopback-callback op een
poort die je vastzet met `--callback-port`. Voeg Cycleo toe met de vaste
client-id en een poort naar keuze:

```sh
claude mcp add --transport http --scope user \
  --client-id cycleo-mcp-prod \
  --callback-port 8123 \
  cycleo https://mcp.cycleo.com/mcp
```

Log daarna in:

```sh
claude mcp login cycleo
```

of start Claude Code, voer `/mcp` uit, kies **cycleo** en volg de browserlogin.

`--client-id cycleo-mcp-prod` is verplicht: zonder die vlag identificeert Claude
Code zich met zijn eigen client-metadata-URL, en die accepteert Cycleo niet.
`--callback-port` is optioneel maar handig — met een vaste poort blijft de
callback-URL gelijk tussen sessies. Cycleo accepteert elke loopback-callback op
`127.0.0.1` of `localhost` met pad `/callback`, met of zonder Codex' extra
`/<id>`-segment.

### Beheer

```sh
claude mcp list            # status van alle servers
claude mcp get cycleo      # de configuratie van Cycleo
claude mcp logout cycleo   # opgeslagen OAuth-toegang wissen
claude mcp remove cycleo   # Cycleo uit de configuratie halen
```

---

## Voorbeelden van vragen

Zodra de verbinding staat, kun je in Codex of Claude bijvoorbeeld vragen:

- `Toon mijn huidige Cycleo-ploeg.`
- `Welke renners in mijn ploeg zijn geblesseerd?`
- `Bekijk Cycleo-ploeg 123.`
- `Hoe staat mijn competitie er in de Cycleopunten voor?`
- `Zoek de renner "Van Aert" en toon zijn profiel.`
- `Geef me TransferAI-advies voor wedstrijd 456, maximaal 10 renners.`
- `Wat is de transfer-radar deze week?`

---

## Andere MCP-clients

Een andere desktop- of IDE-client kan Cycleo gebruiken als die deze instellingen
ondersteunt:

| Instelling | Waarde |
| --- | --- |
| Transport | Streamable HTTP |
| MCP-URL | `https://mcp.cycleo.com/mcp` |
| Authenticatie | OAuth authorization code met PKCE-S256 |
| OAuth client-id | `cycleo-mcp-prod` |
| OAuth resource | `https://mcp.cycleo.com` |
| Scope | `cycleo:read` |

De client moet een van deze redirect-URI's gebruiken:

- de vaste web-callback `https://claude.ai/api/mcp/auth_callback`, of
- een loopback-callback op `http://127.0.0.1:<poort>/callback` of
  `http://localhost:<poort>/callback` (poort van 4–5 cijfers), eventueel met een
  extra `/<callback-id>`-segment van 8–128 tekens.

Clients die geen vaste OAuth client-id en resource kunnen meegeven, of die
Dynamic Client Registration vereisen, werken op dit moment niet. Plak nooit
handmatig een access- of refresh-token in een configuratiebestand.

---

## Problemen oplossen

### Is de dienst bereikbaar?

Open <https://mcp.cycleo.com/healthz> in een browser. Een gezonde dienst geeft:

```json
{"ok":true,"service":"cycleo-mcp"}
```

Een `401 Unauthorized` op `/mcp` zónder ingelogde MCP-client is normaal.

### De browserlogin start niet

Controleer eerst of de configuratie bestaat (`codex mcp get cycleo` of
`claude mcp get cycleo`) en of de client-id en resource kloppen. Voer daarna de
login opnieuw uit.

### De verbinding werkte eerder wel

De toegang kan verlopen of ingetrokken zijn (access-tokens leven 15 minuten,
refresh-tokens 90 dagen; hergebruik van een refresh-token trekt de hele
MCP-sessie in). Log lokaal uit en opnieuw in:

```sh
codex mcp logout cycleo && codex mcp login cycleo
# of
claude mcp logout cycleo && claude mcp login cycleo
```

### Tools zijn niet zichtbaar

Controleer `/mcp` in je client, herstart de desktop-app of IDE-extensie en kijk
of `cycleo` is ingeschakeld. De server biedt alleen de expliciet toegestane
read-only tools; een bewerkingstool hoort er dus niet in te staan.

### `redirect_uri` of `invalid_client` bij het inloggen

De client stuurt een callback-URL of client-id die Cycleo niet accepteert. Geef
expliciet `cycleo-mcp-prod` als client-id mee. Bij Claude Code: zie de
opmerking over `--callback-port` en `MCP_OAUTH_REDIRECT_URIS` hierboven.

---

## Technische discovery

Compatibele clients ontdekken de OAuth-configuratie automatisch via:

- <https://mcp.cycleo.com/.well-known/oauth-protected-resource>
- <https://mcp.cycleo.com/.well-known/oauth-protected-resource/mcp>
- <https://www.cycleo.com/.well-known/oauth-authorization-server>

De authorization server adverteert alleen `authorization_code`, `refresh_token`
en de token-exchange grant, `code_challenge_methods_supported: ["S256"]`,
`scopes_supported: ["cycleo:read"]` en `token_endpoint_auth_methods_supported:
["none"]`. Er is geen `registration_endpoint`.
