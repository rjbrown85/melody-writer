# Melody Writer

A browser tool for writing vocal melodies over chord progressions. Pick the changes, drop in scale runs, arpeggios, and riff blocks, trim them down to the notes you want, and see right away which notes fit the chord and which ones clash.

**Open it:** https://rjbrown85.github.io/melody-writer/

It's the writing companion to [Vocallicks](https://github.com/rjbrown85/Vocallicks), the riff practice app, and it shares that app's progressions, riff blocks, and chord-scale engine.

## What it does

- **Chords.** Load any of the 51 Vocallicks progressions in any key, or build your own from a palette of in-key, borrowed, and secondary chords (triads and 7ths). Chords can last 1 to 16 beats and a song can run up to 32 bars. Save your own progressions for later.
- **Blocks.** Pick a block and click the grid where its first note goes:
  - Scales: major, natural minor, major pentatonic, minor pentatonic, blues
  - Arpeggios: major, minor, maj7, m7, dominant 7, plus a "chord tones" block that follows whatever chord is under it
  - The five Crystal Cherelle building blocks and the Vocallicks licks and runs

  Scales and arpeggios let you set the direction, number of notes, rhythm, and whether the last note is held. Every block can be built on the key, the chord under it, or the note you click.
- **Shaping.** Select notes (drag a box, or double-click a note to grab its whole block) and use the tools above the grid: delete, delete and close the gap, close gaps, keep the first N notes, keep every other note, half or double speed, reverse, move by scale step or octave, duplicate.
- **Recording.** Play with your computer keyboard (A W S E D F T G Y H U J K, with Z and X for octaves) or a USB MIDI keyboard. Recording has a count-in, metronome, loop, and adjustable snap.
- **Clash colors.** Each note is graded against the chord it sounds over, taking the beat and the note length into account:
  - green: chord tone
  - white: scale tone
  - blue: blue note
  - dashed: passing tone
  - yellow: avoid note (a half step above a chord tone, held)
  - orange: outside the chord's scale
  - red: a held or strong-beat note grinding a half step against a chord tone

  Row shading shows the same thing before you place anything. Hover a note to read why it got its color. Strict mode flags anything outside the key instead.
- **Saving.** Songs save in your browser. You can also export and import song files (.json) and export MIDI with separate melody and chord tracks for Logic or GarageBand.

## Browser notes

MIDI keyboards need Chrome, Edge, or Firefox. Safari doesn't support Web MIDI, but everything else works there. Saved songs live in the browser you saved them in, so export a song file if you want it somewhere else.

## Files

```
index.html           page shell
css/app.css          styles
js/theory.js         Vocallicks chord-scale engine (synced copy)
js/data.js           Vocallicks progressions and riffs (synced copy)
js/music.js          chords, clash grading, block generators, note tools, MIDI export
js/core.js           state, saving, undo
js/audio.js          piano, scheduler, loop, metronome
js/roll.js           piano roll
js/chords.js         chord chart, palette, progression library
js/blocks.js         block palette
js/input.js          computer keys, MIDI, recording
js/app.js            transport, file menu, shortcuts
piano/               Salamander Grand samples, A0 to C8
tests/music.test.js  node tests/music.test.js
tools/sync_vocallicks.py  copy theory.js and data.js from a Vocallicks checkout
```

No build step. Open `index.html` through any static server (`python3 -m http.server`) and it runs.

## Credits

See [CREDITS.md](CREDITS.md). App code is MIT licensed.
