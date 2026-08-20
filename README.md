# Schadensrechner — League of Legends

Ein timeline-basierter Schadensrechner für League of Legends im Browser. Combo per
Drag & Drop bauen, Items und Runen wählen, Zielwerte setzen — und sehen, wie der
Schaden über die Zeit tatsächlich ankommt.

Erster Champion: **Vi**. Die Architektur ist auf weitere ausgelegt.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Rechenkerne
npm run build      # statischer Build nach dist/
```

## Was der Rechner macht

Die Combo wird nicht aufsummiert, sondern **auf einer Uhr abgespielt**. Jeder
Schritt kostet die Zeit, die er wirklich kostet: eine voll geladene Q ihre
1,25 s Ladezeit plus Sprint, ein Basisangriff sein Windup und danach
1/Angriffstempo bis zum nächsten. Deshalb ändert die Reihenfolge das Ergebnis —
die Rüstungsreduktion des dritten Autoangriffs wirkt auf alles danach und auf
nichts davor.

Modelliert sind unter anderem:

- **Ladezeit-Skalierung** von Tresorknacker (Q), linear zwischen Minimum und Maximum
- **Beulenschläge (W)** als Zähler auf demselben Ziel, mit %-Max-Leben-Schaden,
  Bonus-AD-Skalierung, Monster-Kappe und der 20 %-Rüstungsreduktion zum richtigen
  Zeitpunkt — inklusive Verfall des Zählers, wenn zwischen zwei Treffern mehr Zeit
  liegt als die Markierung hält
- **Übermäßige Gewalt (E)** als ein Schritt, der den verstärkten Angriff enthält:
  In der Combo heißt „E" das, was Spieler damit meinen — draufhauen. Der Schaden
  ersetzt den Angriffsschaden (statt obendrauf zu kommen), mit Angriffstimer-Reset
  und Aufladungslimit; ohne Aufladung bleibt ein gewöhnlicher Angriff übrig
- **Explosionsschild (P)** mit levelabhängiger Abklingzeit
- **Mitigationskette** in der richtigen Reihenfolge: flache Reduktion → prozentuale
  Reduktion → prozentuale Durchdringung → Letalität, mit negativer Rüstung und
  abnehmendem Ertrag
- **Multiplikatives Stapeln** von Rüstungs-/Magiedurchdringung und Zähigkeit
- Runen- und Item-Procs mit eigenen Abklingzeiten, Stapeln und Auslösebedingungen

## Woher die Zahlen kommen

Das ist die wichtigste Frage bei einem Schadensrechner, deshalb macht die App sie
sichtbar. Jeder Wert im **Formel-Inspektor** ist mit seiner Quelle gekennzeichnet:

| Quelle | Was | Warum |
|---|---|---|
| **Spieldaten** | Fähigkeitsformeln: Basisschaden, Ratios, Multiplikatoren, Aufladungen, Dauern, Kappen, Levelkurven | Riots eigene `bin`-Datei des Spiels, über CommunityDragon pro Patch als JSON |
| **Data Dragon** | Champion-Basiswerte und Level-Skalierung, alle Item-Statuswerte, Runenbäume, Abklingzeiten, Kosten | Riots CDN, maschinenlesbar, pro Patch versioniert |
| **Registry** | Runenformeln, Item-Passive — und Fähigkeitswerte nur dann, wenn die Spieldaten sie nicht hergeben | gepflegte Konstanten in diesem Repo |

Beide CDNs werden zur Laufzeit im Browser geladen (beide liefern CORS-Header),
pro Version unveränderlich zwischengespeichert, und die Patch-Version ist in der
Kopfzeile umschaltbar.

### Warum es die Spieldaten braucht

**Data Dragon liefert seit Jahren keinen Fähigkeitsschaden mehr.** Für Vi stehen
dort auf Patch 16.16 in allen vier `effect`-Arrays ausschließlich Nullen, und
Ratios gar nicht — die echten Zahlen sind in Tooltip-Platzhalter gewandert
(`{{ totaldamage }}`), die Data Dragon nie auflöst. Ein Rechner, der sich darauf
verlässt, rechnet mit 0 Basisschaden oder mit handgepflegten Konstanten.

Maschinenlesbar sind die Zahlen trotzdem, nur woanders: die `bin`-Dateien des
Spiels enthalten pro Fähigkeit eine Tabelle benannter Werte und die Formelbäume,
die sie verrechnen. `src/data/bin.ts` übersetzt das in ein kanonisches Modell,
`src/model/spellcalc.ts` wertet es gegen den Statusblock aus. Damit kommt Vis Q
aus derselben Datei, aus der auch der Client liest.

### Die Lesart wird geprüft, nicht geglaubt

Riot indiziert Rang-Arrays in derselben Datei auf zwei Weisen — siebenstellige
Arrays nach Rang (Index 0 ist der „nicht gelernt"-Wert), sechsstellige nach
Rang − 1. Falsch geraten verschiebt das jeden Wert um einen Rang und sieht
plausibel aus.

Deshalb wird beim Laden gegengerechnet: Abklingzeiten, Kosten und Effektwerte
werden aus der `bin`-Datei abgeleitet und gegen Data Dragon verglichen, das
genau diese Felder verlässlich ausliefert. Auf Patch 16.16 sind das 31
übereinstimmende Werte, auf 15.6 sogar 121. **Stimmen sie nicht, verwirft die App
die Spieldaten** und rechnet sichtbar mit Konstanten weiter, statt still um einen
Rang daneben zu liegen. Das Ergebnis der Prüfung steht über der Tabelle.

### Alte Patches

Das Format hat sich innerhalb von Saison 15 mehrfach geändert: benannte Werte
lagen bis 15.6 in `mDataValues` statt `DataValues`, Formeln verwiesen auf
unbenannte Effekt-Slots, und die Statuskennung für „maximales Leben" ist
zwischen 15.6 und 15.7 von 11 auf 12 gewandert. Alle drei Varianten werden
gelesen, die Statuskennungen patchabhängig. Getestet gegen echte Rohdaten von
15.6 und 16.16; geprüft wurde der Parser gegen jeden Patch von 15.1 bis 16.16.

Nicht geraten wird dabei nie: eine unbekannte Statuskennung oder ein unbekannter
Formelteil macht die betroffene Formel *unlesbar* statt teilweise berechnet — der
Wert fällt dann auf die Konstante zurück und sagt im Inspektor, warum.

**Die Registry-Werte sind gepflegte Konstanten, keine Live-Daten.** Sie stehen
gesammelt in `src/model/champions/vi.ts`, `src/model/runes.ts` und
`src/model/itemEffects.ts` und sind gegen Patch 16.16 geprüft. Für Vi vergleicht
`test/vi.test.ts` sie Zeile für Zeile mit den Spieldaten: ändert Riot eine Zahl,
schlägt der Test fehl und nennt die betroffene Zeile.

### Was bewusst *nicht* behauptet wird

- Items ohne modelliertes Passiv sind in der UI als **„nur Werte"** markiert. Ihre
  Statuswerte zählen voll, ihr Passiv nicht — das steht dort, statt still zu fehlen.
- Runen ohne Formel sind als **„nicht modelliert"** markiert und wählbar, wirken
  aber nicht.
- Statuszeilen, die der Item-Parser nicht zuordnen konnte, werden als
  **„ungelesen"** ausgewiesen statt verworfen.
- Animations- und Wirkzeiten veröffentlicht Riot nirgends maschinenlesbar. Sie
  sind editierbare Annahmen im Panel *Simulation* und verschieben nur die
  Zeitachse, nicht die Schadenssummen.

## Aufbau

```
src/
  data/        CDN-Clients und Cache
    http.ts      gemeinsames Laden, Timeout, Fehler
    ddragon.ts   Data Dragon: Basiswerte, Items, Runen
    gamedata.ts  CommunityDragon: Fähigkeitsformeln + Prüfung gegen Data Dragon
    bin.ts       Parser für Riots bin-Format → kanonisches Formelmodell
  model/       Statusmodell, Item-Parser, Runen- und Item-Registry
    spellcalc.ts Formeln auswerten und als Text darstellen
    champions/   pro Champion ein Modul (Metadaten + Laufzeitverhalten)
  engine/      Mitigationskette, Timeline-Simulation, Auswertung
  ui/          React-Komponenten
  state/       Build-Zustand, Persistenz
```

Die Schichten kennen nur die jeweils tiefere. Die Eigenheiten beider CDNs enden
in `data/` und `model/items.ts`; die Engine sieht nur noch das kanonische
Statusmodell, und ein Champion-Modul sieht nur benannte Formeln.

### Einen Champion ergänzen

Ein Champion ist ein Modul, das `ChampionModule` erfüllt:
`abilities` (deklarative Metadaten für die UI) und `createRuntime` (das
Verhalten, das die Simulation antreibt). Kits wehren sich gegen reine
Datenmodellierung — allein Vi hat einen geladenen Sprint, einen Dritt-Treffer-Zähler,
einen verstärkten Angriff mit Munition und ein Schild auf „beliebiger
Fähigkeitsschaden" —, deshalb sind Daten dort Daten und Verhalten dort Code.

Vorlage: `src/model/champions/vi.ts`.

## Item-Statuswerte

Riots `stats`-Objekt kennt kein Fähigkeitstempo, keine Letalität, keine
Rüstungsdurchdringung, keinen kritischen Zusatzschaden. Vollständig sind diese
Werte nur im `<stats>`-Block der HTML-Beschreibung. Der Parser liest deshalb die
Beschreibung als Primärquelle und füllt Lücken aus dem Legacy-Objekt — ohne
doppelt zu zählen. Getestet in `test/items.test.ts`.

## Tests

`npm test` deckt die Rechenkerne ab: Reihenfolge der Mitigationskette, negative
Rüstung, multiplikatives Stapeln von Durchdringung, Riots Level-Wachstumskurve,
Item-Parsing, und die Simulation selbst (Ladezeit-Skalierung, E ersetzt statt
addiert, W procct auf dem dritten Treffer, Reihenfolge ändert das Ergebnis).

Zwei Arten von Fixtures, mit Absicht getrennt:

- `test/fixtures.ts` bildet die *Form* von Data Dragon nach; die Zahlen darin
  sind erfunden und ausdrücklich keine Spieldaten.
- `.data-probe/` enthält echte Rohdaten von Riot und CommunityDragon für zwei
  Patches. `test/gamedata.test.ts` und `test/vi.test.ts` prüfen den Parser damit
  gegen die tatsächlichen Zahlen — jede Erwartung dort ist der Wert, den das
  offizielle Wiki für diesen Patch nennt.

`test/simulate.test.ts` läuft bewusst *ohne* Spieldaten und deckt damit den
Rückfallpfad ab; `test/vi.test.ts` läuft mit. Beide Pfade sind so abgedeckt.

## Rechtliches

Kein offizielles Riot-Games-Produkt. League of Legends und Data Dragon sind
Marken bzw. Dienste von Riot Games, Inc.
