# Pixel-Werkstatt

<img src="docs/icon.png" width="96" align="right" alt="">

Eine schlanke Pixel-Art-App für Android zum Zeichnen von Sprites (z. B. für GameMaker).

## Herunterladen

**[Pixel-Werkstatt.apk – neueste Version](https://github.com/DiniSonnenschein/Pixel-Art/releases/latest/download/Pixel-Werkstatt.apk)**

Den Link auf dem Handy öffnen, die Datei herunterladen und antippen. Beim ersten Mal fragt
Android, ob der Browser Apps installieren darf – einmal erlauben. Updates installierst du
genauso über die alte Version drüber, deine Zeichnung bleibt erhalten.

Alle Versionen: [Releases](https://github.com/DiniSonnenschein/Pixel-Art/releases)

## Funktionen (Stand: Schritt 5)

- Leinwand in frei wählbarer Pixelgröße (1–1024 px), nachträglich skalierbar
- Stift (Pixel Perfect), Radierer, Fülleimer, Pipette
- Farbrad mit Deckkraft, Hex- und RGBA-Eingabe, Palette, zuletzt benutzte Farben
- Zoomen und Verschieben mit zwei Fingern, Raster (alle 8 px kräftiger)
- Rückgängig / Wiederherstellen
- Ebenen: anlegen, kopieren, umsortieren, ein-/ausblenden, Deckkraft, umbenennen, zusammenführen, löschen
- Vorlage-Bild zum Abpausen: eigene Ebene, scharf und halbtransparent angezeigt, nie exportiert;
  verschieben, skalieren (Ecken), Breite/Höhe (Kanten), zuschneiden; Pipette nimmt Farben aus der Vorlage
- Animation: Frame-Leiste (neu, kopieren, verschieben, löschen), Onion Skin, Vorschau mit 1–60 FPS
- Export als GameMaker-Streifen `name_stripN.png`, als Einzelbilder `name_0.png …` oder einzelner Frame
- Mehrere Projekte, automatisch gespeichert; Sicherung als `.pxw`-Datei (mit allen Ebenen)
- PNG-Export 1:1 (Pixel für Pixel) mit Transparenz, optional 2×/4×/8× vergrößert
  - Speichern landet in `Dokumente/Pixel-Werkstatt`, „Teilen …“ öffnet das Android-Teilen-Menü

## Fahrplan

1. ✅ Grundgerüst, Stift, Radierer, Undo, Zoom, Export, APK-Build
2. ✅ Farbrad (Farbton, Sättigung, Helligkeit, Transparenz, Hex), Pipette, Fülleimer, letzte Farben
3. ✅ Ebenen, Projekte speichern/laden
4. ✅ Bilder als Vorlage einfügen, zuschneiden, skalieren
5. ✅ Animation: Frames, Vorschau mit FPS, Onion Skin, GameMaker-Export (`name_stripN.png`)
6. Feinschliff

## Entwicklung

```bash
npm install
npm run build      # src/ -> www/app.js
npm test
python3 -m http.server -d www   # im Browser testen
```

Die APK baut GitHub Actions bei jedem Push (`.github/workflows/build-apk.yml`) und hängt sie
an ein neues Release.

Zum Signieren braucht das Repository zwei Secrets (Settings → Secrets and variables → Actions):
`ANDROID_KEYSTORE_BASE64` (der Schlüssel als Base64) und `ANDROID_KEYSTORE_PASSWORD`.
Fehlen sie, läuft nur der Test, die APK wird übersprungen.
