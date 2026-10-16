# Releasing Screencap

Releases are built by `scripts/release.sh VERSION`, on the maintainer's Mac or in GitHub Actions. The script builds from committed code and writes three files to `build/release/`:

- `Screencap-VERSION.dmg` is the download.
- `Screencap-VERSION.zip` is for updates.
- `Screencap-VERSION.sha256` holds their checksums.

The app and its OCR helper are signed with the Developer ID certificate (`Developer ID Application: Yahor Barkouski (ZY8VMC3J6G)`, valid until January 2031), with the hardened runtime and Apple's secure timestamp. The app is notarized and stapled first, so the copy inside the disk image opens offline; then the disk image is signed, notarized and stapled. A rejection prints Apple's log and stops the release. The build number (`CFBundleVersion`) is the commit count. `SCREENCAP_SKIP_NOTARIZE=1 scripts/release.sh 2.0.0-rc1` does everything except notarization.

The first full run, 2.0.0-rc1 on the maintainer's Mac on 2026-10-16, took about a minute and a half, and Apple accepted each of the two uploads in about 30 seconds. Gatekeeper (`spctl --assess`) accepted a quarantined copy of the disk image, the app inside it and the app in the zip, each as `source=Notarized Developer ID`. The disk image is 5.4 MB and the zip 5.0 MB.

## CI

- `.github/workflows/ci.yml` builds and runs the tests on every push to `main` and every pull request, on GitHub's `macos-26` runner, and assembles an ad hoc signed bundle.
- `.github/workflows/release.yml` runs on a tag such as `v2.0.0`. It imports the certificate from the repository secrets into a throwaway keychain, runs `scripts/release.sh`, and opens a **draft** release with the three files. Nothing is public until you publish the draft. Run it by hand (Actions → Release → Run workflow, version `2.0.0-rc1`) to check signing and notarization: the files are kept as a workflow artifact for 7 days and no release is made.

## Once, by hand

Only you can do these.

1. **Apple agreements.** Done on 2026-10-16, when two were waiting. Apple adds new ones from time to time: accept every agreement shown at [developer.apple.com/account](https://developer.apple.com/account) and in [App Store Connect → Business](https://appstoreconnect.apple.com/business). Until all are accepted, notarytool refuses every request with `HTTP status code: 403. A required agreement is missing or has expired`, and an acceptance takes a few minutes to reach the notary service. The Developer Program membership must also be active.
2. **GitHub secrets.** None to add: `yahorbarkouski/screencap` already holds the five the Electron releases used (`APPLE_CERT_P12_BASE64`, `APPLE_CERT_P12_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, set in January 2026). 2.0.0-rc1 was notarized with the maintainer's Apple ID and app-specific password, passed in the variables of step 5, and has not been built with these secrets yet. The first workflow run shows whether the certificate secret still imports and the notary sign-in still works. If the sign-in fails, make a new app-specific password at [account.apple.com](https://account.apple.com) → Sign-In and Security → App-Specific Passwords and run `gh secret set APPLE_APP_SPECIFIC_PASSWORD -R yahorbarkouski/screencap`.
3. **Release approval** (optional). Settings → Environments → `release` → add yourself as a required reviewer, so every release run waits for your approval. The environment appears after the first run, or create it there first.
4. **Private vulnerability reporting.** Settings → Security → enable it, since the README asks people to report security issues there.
5. **Releases from your Mac** (optional; CI does it too). The script signs in to Apple's notary service from `SCREENCAP_NOTARY_APPLE_ID`, `SCREENCAP_NOTARY_PASSWORD` (the app-specific password) and `SCREENCAP_NOTARY_TEAM_ID`, which `release.yml` fills from the `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` secrets. When those are unset, it uses an App Store Connect API key if `SCREENCAP_NOTARY_KEY` is set (see the top of `scripts/release.sh`), and otherwise the keychain profile `screencap-notary`, made once:

   ```sh
   xcrun notarytool store-credentials screencap-notary --apple-id <your Apple ID> --team-id ZY8VMC3J6G
   ```

## Each release

1. Commit everything; the script refuses to build while `Sources`, `Resources`, `scripts` or the package files have uncommitted changes.
2. Tag and push: `git tag v2.0.0 && git push origin v2.0.0`. Approve the run, wait for the draft (each of the two notarizations took about 30 seconds in the first run, and Apple can take a few minutes), check the files, and publish it with release notes.
3. From your Mac instead: `scripts/release.sh 2.0.0`, then `gh release create v2.0.0 build/release/Screencap-2.0.0.{dmg,zip,sha256} --draft`.

## Decided for the first public release (2026-10-16)

The first two have not been carried out yet.

- **Where the source lives.** `yahorbarkouski/screencap`. Its Electron history is tagged `electron-final`, then `main` is replaced in one commit on top of it, with no force-push. The public tree is cut from the private development repository, without its plans, experiments and progress log.
- **How users of the old app hear about it.** The old Electron app (`com.screencap.app`) updates itself from that repository's releases through `latest-mac.yml`. A last Electron release, 1.36, published before v2.0.0, shows a notice that links to Screencap 2. Once v2.0.0 is the latest release without a `latest-mac.yml`, the old app stays on 1.36. The new app has its own identifier, `com.screencaping.app`, and no history moves over from the old one.
- **Which Macs it runs on.** macOS 26 on Apple Silicon. The old app also ran on Intel and older systems.

## Open

- **Updates after this one.** The new app has no updater yet. [Sparkle](https://sparkle-project.org) is the usual choice outside the App Store: a signing key pair made once on the maintainer's Mac, and an appcast published with each release.
