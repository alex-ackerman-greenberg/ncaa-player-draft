## March Madness Player Draft — Points Tracker

This app tracks how many points players score in the NCAA March Madness tournament across **7 entries**. Each entry has a roster of players; every point those players score is aggregated. A **standings** page ranks the 7 entries by total points. The **player pool** is built from tournament games (load by date range); you assign players to entries on **Rosters** (each player can only be on one entry). Scores update in real time during the tournament (refresh every 60 seconds and a manual "Refresh scores now" button).

- **Standings** — View rankings and total points per entry.
- **Rosters** — Name each entry, add/remove players from the pool, edit entry names (✎).
- **Player pool** — Set start/end dates and click "Load players from games" to populate the pool from ESPN box scores; then assign players on Rosters.

Data is stored in the browser (localStorage). Scores come from ESPN’s public API (`site.api.espn.com`).

---

### Optional: Google sign-in

To require sign-in so only people with a Google account can view the app (e.g. on GitLab Pages):

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an **OAuth 2.0 Client ID** (Web application).
2. Under **Authorized JavaScript origins**, add your site URL (e.g. `https://yourname.gitlab.io` or your full GitLab Pages URL).
3. In `public/config.js`, set `window.GOOGLE_CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';`.
4. Deploy. Visitors will see a "Sign in with Google" screen; after signing in they can use the app. Use **Sign out** in the header to sign out.

Auth is client-side only: it controls whether the app UI is shown. It does not protect the HTML/JS files from being fetched. Suitable for "only show the app to signed-in users" on a static host like GitLab Pages.

---

Example plain HTML site using GitLab Pages.

Learn more about GitLab Pages at https://pages.gitlab.io and the official
documentation https://docs.gitlab.com/ce/user/project/pages/.

---

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**  *generated with [DocToc](https://github.com/thlorenz/doctoc)*

- [GitLab CI](#gitlab-ci)
- [GitLab User or Group Pages](#gitlab-user-or-group-pages)
- [Did you fork this project?](#did-you-fork-this-project)
- [Troubleshooting](#troubleshooting)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## GitLab CI

This project's static Pages are built by [GitLab CI][ci], following the steps
defined in [`.gitlab-ci.yml`](.gitlab-ci.yml):

```
image: busybox

pages:
  stage: deploy
  script:
  - echo 'Nothing to do...'
  artifacts:
    paths:
    - public
    expire_in: 1 day
  rules:
    - if: $CI_COMMIT_REF_NAME == $CI_DEFAULT_BRANCH
```

The above example expects to put all your HTML files in the `public/` directory.

## GitLab User or Group Pages

To use this project as your user/group website, you will need one additional
step: just rename your project to `namespace.gitlab.io`, where `namespace` is
your `username` or `groupname`. This can be done by navigating to your
project's **Settings**.

Read more about [user/group Pages][userpages] and [project Pages][projpages].

## Did you fork this project?

If you forked this project for your own use, please go to your project's
**Settings** and remove the forking relationship, which won't be necessary
unless you want to contribute back to the upstream project.

## Troubleshooting

1. CSS is missing! That means that you have wrongly set up the CSS URL in your
   HTML files. Have a look at the [index.html] for an example.

[ci]: https://about.gitlab.com/gitlab-ci/
[index.html]: https://gitlab.com/pages/plain-html/blob/master/public/index.html
[userpages]: https://docs.gitlab.com/ce/user/project/pages/introduction.html#user-or-group-pages
[projpages]: https://docs.gitlab.com/ce/user/project/pages/introduction.html#project-pages
