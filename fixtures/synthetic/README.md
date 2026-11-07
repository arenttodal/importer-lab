# fixtures/synthetic/

`generate.js` writes a deterministic messy catalog: fake Ableton projects (gzipped XML with tempo,
tracks, sample references and clip ends), a Logic bundle, small real WAVs, renamed versions, copies
across folders, stems mixed with bounces, a folder deeper than today's walker reaches, cloud placeholder
stand-ins (sparse files), a dotfile and a symlink. Ground truth goes to `<catalog>.truth.json` beside it.

    npm run fixtures            # writes fixtures/synthetic/out/catalog-a (git-ignored)

Generated output is never committed: git would turn the sparse placeholder stand-ins into real files.
