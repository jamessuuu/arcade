# Playtests

**This directory is empty, and that is the most important fact in the
repository.**

Pack row G9 asks for at least five dated playtest records per game, each
carrying the 20-second first-run gate timing and a build hash that matches the
shipped build. There are zero. Nobody outside this machine has played Harbor
Watch.

Everything the project says about *fun* is therefore an intention. Everything it
says about *mechanism* — the frame times, the payload, the network capture, the
fairness floors, the accessibility floor — is measured and reproducible, and
those two categories are kept apart on purpose everywhere in this repository.

## What a record must contain when the first one lands

One file per session, `YYYY-MM-DD-<initials>.md`:

- Date, build hash (`git rev-parse --short HEAD`), mode played, seed.
- **The 20-second first-run gate:** did they reach the core verb inside 20
  seconds with no help? Every on-screen word they had to read counts as a
  defect. Harbor Watch renders none on the canvas, so the only words available
  are the mode names on the title sheet — record whether they read them.
- Where they were confused, verbatim, and at what second.
- Whether they finished the shift or stopped early, and why.
- One sentence in their words about what the game was asking of them.
- Whether they wanted to play again, unprompted.

The tester is not told how to play. The observer does not speak. Five strangers
per game, and they are a consumable resource: fresh eyes cannot be spent twice.

## The questions this build most needs answered

1. Is the wordless opening actually understood, or does the waiting first ship
   read as the game being broken?
2. Is ~46 decisions in three minutes engaging or exhausting?
3. Does the lamp changing mid-watch feel like a good beat or like a cheat?
4. Does anyone notice the fog is shortening their decision time, or does it
   just feel like they got worse?
5. Can a seven-year-old play Gentle without an adult explaining anything?
