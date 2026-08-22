# Cycleo MCP gebruiken op je eigen werkstation

Deze handleiding is voor Cycleo-gebruikers die de bestaande MCP-server vanaf
hun eigen computer willen gebruiken. Je hoeft daarvoor deze repository niet te
clonen en je hoeft lokaal geen Node.js-, Docker- of systemd-service te draaien.

De remote MCP-endpoint is:

```text
https://mcp.cycleo.com/mcp
```

Je hebt nodig:

- een actief Cycleo-account met toegang tot een ploeg;
- een MCP-client met Streamable HTTP en OAuth met PKCE;
- een browser om bij Cycleo in te loggen en de read-only toegang goed te keuren.

## Aanbevolen: Codex

De ChatGPT desktop-app, Codex CLI en Codex IDE-extensie delen op hetzelfde
werkstation hun MCP-configuratie. Voeg Cycleo eenmaal toe via een terminal:

```sh
codex mcp add cycleo --url https://mcp.cycleo.com/mcp --oauth-client-id cycleo-mcp-prod --oauth-resource https://mcp.cycleo.com
```

Start daarna de OAuth-login:

```sh
codex mcp login cycleo
```

De browser opent de Cycleo-login en vervolgens het toestemmingsscherm. Controleer
je ploeg en competitie en kies **Toestaan**. De toestemming geeft alleen
`cycleo:read`-toegang; de MCP kan geen transfers, berichten of instellingen
wijzigen. Je Cycleo-wachtwoord wordt alleen door Cycleo verwerkt en niet door de
MCP-server.

Controleer na het inloggen de verbinding:

```sh
codex mcp list
```

Gebruik in Codex of de ChatGPT desktop-app `/mcp` om de actieve server en tools
te bekijken. Herstart de desktop-app of IDE-extensie als Cycleo niet direct in
de lijst verschijnt.

Voorbeelden van vragen:

- `Toon mijn huidige Cycleo-ploeg.`
- `Bekijk Cycleo-ploeg 123.`
- `Geef mij TransferAI-advies voor wedstrijd 456, maximaal 10 renners.`

De beschikbare tools en argumenten staan in [tools.md](tools.md).

## Verbinding stoppen of verwijderen

Verwijder de lokaal opgeslagen OAuth-toegang zonder de serverconfiguratie te
verwijderen:

```sh
codex mcp logout cycleo
```

Verwijder Cycleo volledig uit de MCP-configuratie:

```sh
codex mcp remove cycleo
```

## Andere MCP-clients

Een andere desktop- of IDE-client kan Cycleo gebruiken als die de volgende
instellingen ondersteunt:

| Instelling | Waarde |
| --- | --- |
| Transport | Streamable HTTP |
| MCP URL | `https://mcp.cycleo.com/mcp` |
| Authenticatie | OAuth authorization code met PKCE-S256 |
| OAuth client-id | `cycleo-mcp-prod` |
| OAuth resource | `https://mcp.cycleo.com` |
| Scope | `cycleo:read` |

De client moet een tijdelijke loopback-callback gebruiken in de vorm
`http://127.0.0.1:<poort>/callback/<callback-id>` of
`http://localhost:<poort>/callback/<callback-id>`. Clients die geen vaste OAuth
client-id en resource kunnen meegeven, zijn op dit moment niet compatibel. Plak
nooit handmatig een access- of refresh-token in een configuratiebestand.

ChatGPT op het web leest de lokale Codex-configuratie niet. Daarvoor is een
apart gepubliceerde en door de workspace toegestane plugin nodig.

## Problemen oplossen

### Controleren of de dienst bereikbaar is

Open <https://mcp.cycleo.com/healthz> in een browser. Een gezonde dienst geeft:

```json
{"ok":true,"service":"cycleo-mcp"}
```

Een `401 Unauthorized` op `/mcp` zonder ingelogde MCP-client is normaal.

### De browserlogin start niet

Controleer eerst of de configuratie bestaat:

```sh
codex mcp get cycleo
```

Voer daarna opnieuw `codex mcp login cycleo` uit. Gebruik de volledige opdracht
uit deze handleiding als de client-id of OAuth-resource ontbreekt.

### De verbinding werkte eerder wel

De toegang kan verlopen of ingetrokken zijn. Log lokaal uit en opnieuw in:

```sh
codex mcp logout cycleo
codex mcp login cycleo
```

### Tools zijn niet zichtbaar

Controleer `/mcp`, herstart de desktop-app of IDE-extensie en kijk of `cycleo`
is ingeschakeld. De server biedt alleen de expliciet toegestane read-only tools;
een bewerkingstool hoort dus niet in de lijst te staan.

## Technische discovery

Compatibele clients ontdekken de OAuth-configuratie automatisch via:

- <https://mcp.cycleo.com/.well-known/oauth-protected-resource>
- <https://www.cycleo.com/.well-known/oauth-authorization-server>

De actuele Codex MCP-configuratie is beschreven in de
[officiële OpenAI-documentatie](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
