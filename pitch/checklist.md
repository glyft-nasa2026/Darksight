# Submission checklist

**Source:** the official NASA Space Apps
[Project Submission Guide](https://www.spaceappschallenge.org/resources/project-submission-guide/),
dated 13 Nov 2026, read on 15 Nov 2026. The form itself is behind the team login (profile icon → My
Team → Project → Edit), so anything the guide doesn't say, such as a character counter, gets
checked on the form when the text is pasted in.

**Deadline:** press "Submit for Judging" before **Sunday 15 Nov 2026, 23:59 Kuala Lumpur time
(UTC+8)**. Only the last saved submission is judged, and it can be edited and resubmitted until
then. Check local judging times with the Kuala Lumpur Local Lead.

**The demo limit decides the plan:** a video of **30 seconds or less**, or **at most 7 slides**
including the title and intro slides. Over the limit means not eligible for global judging. We
made both. The video is the demo link; the slides are linked from the detailed description.

## Form fields

| Field | Required | Limit or rule (guide) | Our text or file | Status |
|---|---|---|---|---|
| Project Name | yes | none stated | "Darksight" (`submission.md`) | ready |
| High-Level Project Summary | yes | none stated; what, how it addresses the challenge, why it matters | `submission.md` (about 180 words) | ready |
| Link to Project Demo | yes | video ≤ 30 s or ≤ 7 slides; public link, no login; English or English subtitles | `demo/darksight-demo.webm`, 28.8 s, English captions | **needs a person:** upload to YouTube (public or unlisted) and paste the link |
| Link to Final Project | yes | public, no login | https://darksight.space (repo linked in the description) | ready |
| Detailed Project Description | yes | none stated; what, how, benefits, goals, tools | `submission.md` | ready |
| Use of Super Intelligence (SI) | yes | say where and how; AI images and videos need a visible watermark; code and data need a note in text and metadata; judges don't see this answer | `submission.md`; labels on every slide and in the video | ready (see open item 3) |
| NASA Data | yes | at least one NASA dataset or resource, for a Global Award | `submission.md` | ready |
| Space Agency Partner Data and Other References | yes | every data source, resource and tool, open source included | `submission.md`, full list in `references.md` | ready (run the last check below) |
| Images on the Project page | optional | JPG, PNG or GIF up to 10 MB; no video or document uploads | `slides-png/slide-1.png` … `slide-7.png` (1280 × 720) | optional |
| Terms and Conditions box | yes | tick | | at submit |
| "Confirm All Work is Original" box | yes | tick | | at submit |

## Before pressing "Submit for Judging"

- [ ] All five team members are confirmed participants at the same Local Event (Kuala Lumpur); waitlisted means not eligible.
- [ ] Every link opens in a private window without signing in: the YouTube video, darksight.space, the GitHub repo, `pitch/darksight-slides.pdf` and `pitch/references.md` on GitHub (once this branch has merged).
- [ ] No image, video or audio of anyone under 18 (none used).
- [ ] No NASA logo, flag or mission identifier in AI-made content (none used).
- [ ] Optional: request a FortiGuard Web Filter Classification for darksight.space (Category: Education or Web-based application; Company Name: N/A), so judges' networks don't block it.
- [ ] The last check below, after the last pull request has merged.

## Numbers in the pitch and where they come from

Every number in the video, slides and submission is read from the deployed site at the fixed demo
hour (15 Nov 2026 03:00 UTC, the link in `video-script.md`), or from the repo. The video script
reads them from the page while it records.

| Number | Where it shows |
|---|---|
| 100.0 % and 0.0 % lit over the next 30 days (Shackleton rim, crater floor) | Compare table, "Lit % (next 30 days)" |
| −17 days of sunlight in 30 days; no Earth in the next 60 days (1 km north of the rim) | Nudge panel after "1.0 km N" |
| Sunset in 47 d 18 h (rim) | Compare table and readout |
| 0.000001°, 18 cases, 0.1° tolerance | Horizons badge and About panel, from `web/public/data/validation.json` |
| 240 m cells, 150 km skyline, real terrain south of 85° S, 1900–2100 every 3 h | About panel, "Known limits"; `SPEC.md` sections 5, 6 and 8 |
| 20 curated sites | About panel |
| 519 tests | `npm test` on this branch after merging main, 15 Nov 2026 |
| 188 distinct sources, 145 AI-use records | `references.md`, `ai-use.md`, built from `docs/` |

## "Done when" (tasks/T17-pitch.md)

| Line | Status |
|---|---|
| Every field above has its text or file | Pass, except the demo **link**: the file is ready, but a person has to upload it |
| The video runs within the form's limit and shows compare, nudge and the Horizons badge | Pass: 28.8 s; compare 0:07.5, nudge 0:13.5, badge 0:21.5 (`video-script.md`) |
| Someone outside the team can say what the tool does after watching it once | **Not done yet**: needs a person (test below) |
| Slides use the palette in `docs/design.md`; T19's two screenshots or updated ones | Pass: palette tokens copied from `docs/design.md`; updated desktop and phone screenshots of darksight.space in `img/` |
| Last check after the last pull request has merged | **Not yet possible**: other pull requests are still open. Run it as below |

### The outside-viewer test

Show `demo/darksight-demo.webm` once to someone outside the team (a T18 tester is ideal), with no
introduction, then ask: "What does this tool do?" Pass if they say something like "it shows when a
place on the Moon gets sunlight and can see Earth, and compares places." Write their answer, word
for word, under this line with the date.

- _(answer, date)_

### The last check before submitting

After the last pull request has merged into `main` and the site has redeployed:

```bash
git switch main && git pull
cd web && npm ci && cd ..
node pitch/tools/sources.mjs build
node pitch/tools/sources.mjs check --site https://darksight.space/
```

`build` regenerates `references.md` and `ai-use.md` from every file in `docs/sources/` and
`docs/ai-use/`. If either changes, commit it on a new `t17-pitch-b` branch and update the counts in
`submission.md`. `check` fails if a file is missing from the lists, or from the deployed About panel.
If the panel is missing one, arrange one more T16 delivery (or a redeploy of `main`) and check
again; anyone can take it. Then paste the "Space Agency Partner Data and Other References" block
again.

Run on 15 Nov 2026 against this branch (after merging main at 964eca2) and the live site:

```
PASS submission lists: 46 docs/sources files and 47 docs/ai-use files, all collected
FAIL About panel on https://darksight.space/ is missing:
  docs/sources/T17.md
  docs/ai-use/T17.md
```

The only files missing are this branch's own, which aren't deployed yet. Before T17's files had
entries, the same check passed: "PASS About panel on https://darksight.space/ shows every file
with entries".

Files with no entries yet (nothing to cover; recheck at the end): sources issue-58, T14, T23,
T26, T28, T29; ai-use T14, T23, T26, T28, T29. T17's own files reach the About panel once this
branch has merged and deployed, which is one more reason to run the check at the very end.

## Open items for the team

1. **Upload the video** to YouTube (or another public host) and paste the link into the demo
   field. The form can't take the file itself.
2. **"About an hour across three tools"** (video 0:03, slide 2, summary) comes from the T17
   ticket's story, not from a measurement. Confirm it's fair, or soften the wording (the script and
   slides each have it once).
3. **AI-made pictures in the repo.** The guide asks for a visible watermark on AI-generated images.
   `docs/design/*.png` were rendered from an AI-written HTML mock-up (T22). They aren't in the pitch,
   but judges may open the repo. Decide whether to label them (a T22 or T26 follow-up), or rely on
   the note in `docs/ai-use/T22.md` and the SI answer.
4. **Character limits:** none in the guide. If the form has a counter, trim the description first.
5. **Re-record** the video and screenshots after a redeploy that changes the wording on screen:
   `node pitch/tools/record-demo.mjs`, `node pitch/tools/screenshots.mjs`, then
   `node pitch/tools/build-slides.mjs`.

## Files in `pitch/`

| File | What |
|---|---|
| `checklist.md` | This file |
| `submission.md` | The text for every form field |
| `video-script.md` | Scene-by-scene script and timings of the demo video |
| `demo/darksight-demo.webm` | The demo video, 28.8 s, 1280 × 720, VP9 |
| `slides.html`, `darksight-slides.pdf`, `slides-png/` | The 7-slide deck: source, PDF, one PNG per slide |
| `img/` | Screenshots of darksight.space used on the slides |
| `references.md`, `ai-use.md` | Every source and AI-use record, generated from `docs/` |
| `tools/` | Scripts that record the video, take the screenshots, build the slides and check the lists |
