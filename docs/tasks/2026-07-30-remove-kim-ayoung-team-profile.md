# Remove retired instructor from Team Archive

Date: 2026-07-30

## Request

Remove Kim Ayoung from the public Team Archive instructor introduction after
her departure.

## Public-site scope

- Remove the instructor card from `/teams`.
- Remove the individual `/teams/ayoung` profile page.
- Remove the public profile image.
- Remove the profile URL from `sitemap.xml`.
- Permanently redirect the retired profile URL to `/teams`.

Historical class records, internal staff/contact safeguards, member data, and
StudioMate data are outside this public-site task and remain unchanged.

## Release guard

`scripts/validate-official-home-team.mjs` verifies that:

- every visible team card has a profile page and image;
- every profile directory appears as a card;
- the sitemap profile set matches the visible cards;
- the retired public profile and image are absent;
- `/teams/ayoung` has a permanent redirect to `/teams`.

## Production result

- Deployed Firebase Hosting site: `archive-pilates-home`
- Source commit used for deployment: `8c67e34`
- Live `/teams`: HTTP 200 with four current team cards and no retired profile
- Live `/teams/ayoung`: HTTP 301 to `/teams`
- Live sitemap: four current profile URLs and no retired profile URL
- Retired image URL: no longer serves an image
- Responsive QA: two columns at 390px, four columns at 1440px, no horizontal
  overflow, and no browser console warnings
- My Classroom release guard remained unchanged and passed after deployment

No ARCHIVE CORE operating-rule update was needed because this was a public
roster presentation change only. It did not change staff workflow, member
communication, permissions, or canonical operational data.
