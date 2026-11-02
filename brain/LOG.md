# Log: successes, failures, lessons (newest first)

## 2026-11-02
**Worked**
- Read the real OutLayer and oracle docs and wrote down what they actually say (`docs/ARCHITECTURE.md`).
- Shared types and fingerprint function done and tested.
- Vault contract built: policies, keepers, allowed recipients, rescue lock. 11 tests pass.
- Upgraded to the latest Rust and NEAR toolkit; all 17 tests still pass.

**Failed, then fixed**
- First pull request failed ("no commits between main and branch") because `main` was cleaned after the branch was made. Fixed by restoring the code on a new branch and re-pointing the stacked PR.
- Pull requests #1 and #2 got merged straight into `main` by the human, so `main` briefly had code in it. Fixed with a revert commit; the code now lives on `dev1/staging`.
- Vault would not compile with the newest toolkit on the old Rust (1.94). Temporary fix: older toolkit. Final fix: upgraded Rust.
- Two different "account id" types clashed between our types and the toolkit. Fixed by using the same version in both.
- Latest toolkit test build failed on Windows (a C library, `aws-lc-sys`, would not build with the Visual Studio compiler, and then needed a missing tool called NASM). Fixed with clang and a no-assembly flag (SETUP.md).
- `cargo test` doc-test step fails with a missing `rustdoc.exe` path from an old Chocolatey Rust. Not a code bug. Use `--lib` or remove the old Chocolatey Rust.

**Lessons**
- Check the real docs before copying code from the plan; parts of the plan's sample code were wrong.
- Push small stacked PRs; the order of merging matters.
