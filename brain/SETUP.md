# Setup (Windows)

## You need
- Rust 1.95 or newer (we use 1.99.1): `rustup update stable`
- Targets: `rustup target add wasm32-unknown-unknown wasm32-wasip1`
- Node 22 and pnpm (for the TypeScript side)
- LLVM clang on your PATH (we use it to build one C dependency)

## Run the tests
Windows only workaround: the newest NEAR toolkit pulls in a C library that the Visual Studio compiler can't build and that wants a tool called NASM. Tell it to use clang and skip assembly:

```bash
AWS_LC_SYS_NO_ASM=1 CC=clang CXX=clang++ cargo test -p aegis-types -p aegis-vault --lib
```

Expected: 6 tests pass in `aegis-types`, 11 in `aegis-vault`.

## Check the contract builds for NEAR
```bash
cargo check -p aegis-vault --target wasm32-unknown-unknown --release
```

## Known quirks
- Plain `cargo test` shows a "rustdoc.exe missing" error at the very end. It comes from an old Chocolatey Rust install and is not a code problem. Use `--lib`.
- Git warns about LF/CRLF line endings. Harmless.
