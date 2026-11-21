# Plan: voice-accuracy

## What the owner asked for

"Start the voice accuracy job": the roadmap item "Voice accuracy: if the tiny model mishears too often,
move to Moonshine base (about 3 times the size)".

## What we found

- Sage's speech file today is **Moonshine tiny** (English, 44 MB). A bigger version, **Moonshine base**
  (141 MB), is published in the same format by the same publisher, under the same MIT licence. Sage's
  speech engine loads it with no code change: the team tried it, and it wrote the test sentence
  correctly.
- **Accuracy:** on the standard English test set Moonshine's makers publish, base makes about 20% fewer
  word mistakes than tiny (10.07% of words wrong against 12.66%). How much better it is for the owner's
  voice and microphone isn't known until he tries it.
- **Cost:** a 141 MB download instead of 44 MB, and each recording takes about twice as long to turn into
  text (about 0.7 seconds instead of 0.4 for a short sentence on the team's slow test computer; less on
  a modern PC). The voice helper uses about 100 MB more memory while it works.
- The model is chosen in one place (`src/core/voice/voice.ts`). Each model has its own folder, so a
  user who already has the tiny file would be offered the new download, and the old 44 MB folder would
  stay on disk unused unless Sage removes it.
- The owner hasn't tried voice on a real PC yet. The review suggested waiting until he has. The team
  builds the switch because he asked for it; **if he would rather try the tiny model first, he can
  comment "wait" on this pull request instead of approving**, and the plan stays on the roadmap with the
  checked file details.

## What we'll change

1. **Use Moonshine base.** `src/core/voice/model.ts` gets the base model: three files pinned to commit
   `8f4d6c58c03d40bcea40043bb7120a878f2bbef6` of
   `csukuangfj2/sherpa-onnx-moonshine-base-en-quantized-2026-02-27` on Hugging Face, with exact sizes and
   SHA-256 fingerprints, checked by the team against Hugging Face's own records and by downloading them:

   | File | Bytes | SHA-256 |
   | --- | --- | --- |
   | `encoder_model.ort` | 31,326,816 | `7c66495948d0d08ec1af454cd4b5514862ae6511e94712a60e6d83eaec8dc8cf` |
   | `decoder_model_merged.ort` | 109,424,400 | `d9d7b333af34bc552580576ddcf248a1c6c839e0d3b43b09afb9376ed009899d` |
   | `tokens.txt` | 549,350 | `2870d843e14c1e187bf1913a521562a63b53933814bd7f2145120468f494a049` |

   Base uses the same three file names and the same engine options as tiny, so the code that loads the
   model doesn't change. Voice uses base in place of tiny, and the tiny model's details are removed.

   *Check:* the tests that pin the model's addresses, sizes and the allowed web addresses are updated
   to the new values, and so are the tests and stand-ins that use tiny's total size.
2. **The size in Sage's messages.** Sage's download box, the Talk button's offer, the "needs its speech
   file first" message and the "damaged file" message say 141 MB instead of 44 MB, and so do the code
   comments that name the size. The box's privacy line stays as it is.

   *Check:* a test that all four messages give the same size as the real total.
3. **Remove the old tiny file.** Right after the base file is downloaded and checked (in Voice's own
   download step, which already makes sure only one download or recording runs at a time), Sage deletes
   the old tiny folder in its own data folder, `models/moonshine-tiny-en-quantized-2026-02-27`, by that
   exact name only, and never anything else. It never deletes the model Voice is using. If the folder is
   missing or can't be deleted (for example, Windows has it locked), Sage notes it in its log and carries
   on: the download still counts as a success. The box's second line adds: "If you already had the
   smaller speech file, Sage removes it once this one is ready."

   *Check:* tests that the folder is deleted only after a checked download, that nothing else in the
   data folder is touched, that a failure to delete still reports a successful download, and that the
   box's new line is there.
4. **Docs.** The README, the install guide, the architecture document, the assurance case (including the
   one-time removal of the old folder), the Windows checklist's Voice section (including the three file
   sizes, about 31, 109 and 0.5 MB), and the repo's guidelines get the new name and size. The changelog
   gets an entry under "Unreleased" (0.1.0 stays as released). The roadmap item is ticked, and the
   decisions log and pass map record the job.

   *Check:* `npm run verify`; a plain-English read before final approval.
5. **The owner's check on Windows** before final approval: the Voice section of the Windows checklist,
   from source (the first press of Ctrl+Space offers the 141 MB download; then a few sentences of
   dictation).

## Who's on it

Researcher (done), Engineer, QA, Security Officer, a second security reviewer (Sage downloads a new
file from the internet), Auditor, and a plain-English read before final approval.

## Risks

- **Slower and bigger:** about twice the time per recording, 141 MB to download, and more memory while
  working. On an older or weaker PC this may feel slow; a later job could add a "faster" choice in
  Settings if needed.
- **A longer first check:** Sage re-checks the speech file's fingerprint once per run, before the first
  recording. With the bigger file that takes about 2 seconds on the team's slow test computer (less on
  a modern PC).
- **Deleting a file:** step 3 removes one fixed folder that only Sage's own download writes. The tests
  make sure nothing else can be deleted. If the deletion fails once, the unused 44 MB folder stays on
  disk; Sage doesn't try again.
- **No resume:** if the network drops during the 141 MB download, it starts again from the beginning
  (as it does today for the 44 MB file).
- **Accuracy for this owner** isn't proven until he tries it.

## Out of scope

- A Settings choice between a faster and a more accurate model (more code, settings and screens; a later
  job if the bigger model is too slow).
- Other speech engines or models (Whisper, NVIDIA Parakeet, Moonshine v2): bigger, a different licence,
  or not yet checked with Sage's engine.
- Any change to the speech engine itself (sherpa-onnx-node stays 2.0.1).
