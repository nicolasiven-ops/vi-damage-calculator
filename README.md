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
  Zeitpunkt
- **Übermäßige Gewalt (E)** als Ersetzung des Angriffsschadens (nicht als Bonus
  obendrauf), inklusive Angriffstimer-Reset und Aufladungslimit
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
| **Data Dragon** | Champion-Basiswerte und Level-Skalierung, alle Item-Statuswerte, Runenbäume, Abklingzeiten, Basisschaden pro Rang | Riots eigenes CDN, maschinenlesbar, pro Patch versioniert |
| **Registry** | Fähigkeits-Ratios, Runenformeln, Item-Passive | Data Dragon liefert diese nicht maschinenlesbar — Riot hat Ratios vor Jahren in Tooltip-Prosa verschoben |

Data Dragon wird zur Laufzeit im Browser geladen (Riot liefert CORS-Header),
pro Version unveränderlich zwischengespeichert, und die Patch-Version ist in der
Kopfzeile umschaltbar. Läuft ein Patch, ziehen Basiswerte und Item-Stats
automatisch nach; nur die Registry-Konstanten brauchen dann noch einen Blick.

**Die Registry-Werte sind gepflegte Konstanten, keine Live-Daten.** Sie stehen
gesammelt in `src/model/champions/vi.ts`, `src/model/runes.ts` und
`src/model/itemEffects.ts` und sind zuletzt gegen Patch 26.16 geprüft. Wenn ein
Ratio wandert, ist das die einzige Stelle, die angefasst werden muss.

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
  data/        Data-Dragon-Client, Cache, Offline-Fallback
  model/       Statusmodell, Item-Parser, Runen- und Item-Registry
    champions/ pro Champion ein Modul (Metadaten + Laufzeitverhalten)
  engine/      Mitigationskette, Timeline-Simulation, Auswertung
  ui/          React-Komponenten
  state/       Build-Zustand, Persistenz
```

Die Schichten kennen nur die jeweils tiefere. Data Dragons Eigenheiten enden in
`data/` und `model/items.ts`; die Engine sieht nur noch das kanonische
Statusmodell.

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

Die Fixtures in `test/fixtures.ts` bilden die *Form* von Data Dragon nach; ihre
Zahlen sind erfunden und ausdrücklich keine Spieldaten.

## Rechtliches

Kein offizielles Riot-Games-Produkt. League of Legends und Data Dragon sind
Marken bzw. Dienste von Riot Games, Inc.
